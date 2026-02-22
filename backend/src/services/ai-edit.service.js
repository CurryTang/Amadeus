const { getDb } = require('../db');
const config = require('../config');
const s3Service = require('./s3.service');
const pdfService = require('./pdf.service');
const { cleanLLMResponse } = require('../utils/clean-llm-response');

// Import providers (same as reader.service.js)
let geminiCliService, googleApiService, codexCliService, llmService;
try { geminiCliService = require('./gemini-cli.service'); } catch (e) {}
try { googleApiService = require('./google-api.service'); } catch (e) {}
try { codexCliService = require('./codex-cli.service'); } catch (e) {}
try { llmService = require('./llm.service'); } catch (e) {}

class AiEditService {
  constructor() {
    this.processInterval = null;
    this.isProcessing = false;
  }

  startProcessor() {
    if (this.processInterval) return;
    // Check for queued AI edits every 30 seconds
    this.processInterval = setInterval(() => this.processNext(), 30 * 1000);
    // Run immediately on start
    this.processNext();
    console.log('[AiEdit] Processor started');
  }

  stopProcessor() {
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
    console.log('[AiEdit] Processor stopped');
  }

  async processNext() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const db = getDb();

      // Get next queued AI edit job
      const result = await db.execute(`
        SELECT ae.id, ae.document_id, ae.type, ae.prompt,
               d.s3_key, d.notes_s3_key, d.code_notes_s3_key, d.title
        FROM ai_edit_queue ae
        JOIN documents d ON ae.document_id = d.id
        WHERE ae.status = 'queued'
        ORDER BY ae.created_at ASC
        LIMIT 1
      `);

      if (result.rows.length === 0) {
        return; // Nothing to process
      }

      const job = result.rows[0];
      console.log(`[AiEdit] Processing job ${job.id} for document ${job.document_id} (${job.type})`);

      // Mark as processing
      await db.execute({
        sql: `UPDATE ai_edit_queue SET status = 'processing', started_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [job.id],
      });

      try {
        await this.performEdit(job);

        // Mark as completed
        await db.execute({
          sql: `UPDATE ai_edit_queue SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
          args: [job.id],
        });

        console.log(`[AiEdit] Job ${job.id} completed successfully`);
      } catch (error) {
        console.error(`[AiEdit] Job ${job.id} failed:`, error);
        await db.execute({
          sql: `UPDATE ai_edit_queue SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
          args: [error.message?.substring(0, 500) || 'Unknown error', job.id],
        });
      }
    } catch (error) {
      console.error('[AiEdit] Processor error:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  async performEdit(job) {
    const { document_id, type, prompt, s3_key, notes_s3_key, code_notes_s3_key, title } = job;

    // 1. Download current notes from S3
    const notesS3Key = type === 'paper' ? notes_s3_key : code_notes_s3_key;
    if (!notesS3Key) {
      throw new Error('No notes found for this document');
    }

    const notesBuffer = await s3Service.downloadBuffer(notesS3Key);
    const currentNotes = notesBuffer.toString('utf-8');

    // 2. Download and prepare the original PDF for context
    let pdfContext = '';
    try {
      const pdfInfo = await pdfService.preparePdfForProcessing(s3_key);
      // We'll pass the file path to the AI provider
      pdfContext = pdfInfo.filePath;
    } catch (error) {
      console.warn(`[AiEdit] Could not prepare PDF for context: ${error.message}`);
      // Continue without PDF context - just use the notes
    }

    // 3. Build the AI edit prompt
    const editPrompt = `You are an expert academic assistant. You have been given a set of notes/analysis about a research paper titled "${title}".

The user wants you to edit these notes based on their instructions.

## User's Edit Request:
${prompt}

## Current Notes Content:
${currentNotes}

## Instructions:
- Apply the user's requested changes to the notes
- Keep the overall structure and format (Markdown) intact
- If the user asks to fix mermaid diagrams, ensure the mermaid syntax is valid
- If the user asks to clarify something, improve the explanation while keeping it accurate
- Return the COMPLETE updated notes (not just the changed parts)
- Do NOT add any preamble or explanation - return ONLY the updated markdown content
- Preserve any YAML frontmatter at the beginning of the document`;

    // 4. Send to AI provider
    let editedContent;

    const providerName = config.reader?.defaultProvider || 'gemini-cli';

    if (pdfContext && providerName === 'gemini-cli' && geminiCliService?.isAvailable()) {
      // If we have the PDF and gemini-cli is available, use it with file context
      console.log('[AiEdit] Using Gemini CLI with PDF context');
      const result = await geminiCliService.readDocument(pdfContext, editPrompt);
      editedContent = result.text;
    } else if (providerName === 'google-api' && googleApiService?.isAvailable()) {
      console.log('[AiEdit] Using Google API');
      const result = await googleApiService.readMarkdown(currentNotes, editPrompt);
      editedContent = result.text;
    } else if (providerName === 'codex-cli' && codexCliService?.isAvailable()) {
      console.log('[AiEdit] Using Codex CLI');
      const result = await codexCliService.readMarkdown(currentNotes, editPrompt);
      editedContent = result.text;
    } else if (geminiCliService?.isAvailable()) {
      // Fallback to gemini-cli with markdown
      console.log('[AiEdit] Falling back to Gemini CLI with markdown');
      const result = pdfContext
        ? await geminiCliService.readDocument(pdfContext, editPrompt)
        : await geminiCliService.readMarkdown(currentNotes, editPrompt);
      editedContent = result.text;
    } else if (googleApiService?.isAvailable()) {
      console.log('[AiEdit] Falling back to Google API');
      const result = await googleApiService.readMarkdown(currentNotes, editPrompt);
      editedContent = result.text;
    } else if (llmService) {
      console.log('[AiEdit] Falling back to LLM service');
      const result = await llmService.generateWithFallback(currentNotes, editPrompt);
      editedContent = result.text;
    } else {
      throw new Error('No AI provider available for editing');
    }

    // Cleanup temp PDF file
    if (pdfContext) {
      try { await pdfService.cleanupTmpFile(pdfContext); } catch (e) {}
    }

    // Clean LLM thinking/preamble from the response
    editedContent = cleanLLMResponse(editedContent);

    if (!editedContent || editedContent.trim().length === 0) {
      throw new Error('AI returned empty content');
    }

    // 5. Save edited notes back to S3 (overwrite in place)
    await s3Service.uploadBuffer(Buffer.from(editedContent, 'utf-8'), notesS3Key, 'text/markdown');
    console.log(`[AiEdit] Updated notes saved to S3: ${notesS3Key}`);
  }
}

module.exports = new AiEditService();
