const { getDb } = require('../db');
const config = require('../config');
const pdfService = require('./pdf.service');
const geminiCliService = require('./gemini-cli.service');
const googleApiService = require('./google-api.service');
const codexCliService = require('./codex-cli.service');
const mathpixService = require('./mathpix.service');
const llmService = require('./llm.service');
const s3Service = require('./s3.service');
const autoReaderService = require('./auto-reader.service');
const processingProxyService = require('./processing-proxy.service');

/**
 * Available analysis providers
 */
const PROVIDERS = {
  'gemini-cli': {
    name: 'Gemini CLI',
    description: 'Google Gemini CLI (local installation required)',
    isAvailable: () => geminiCliService.isAvailable(),
    readDocument: (filePath, prompt, options) => geminiCliService.readDocument(filePath, prompt, options),
    readMarkdown: (content, prompt, options) => geminiCliService.readMarkdown(content, prompt, options),
    analyzeRepository: (repoDir, prompt, options) => geminiCliService.analyzeRepository(repoDir, prompt, options),
  },
  'google-api': {
    name: 'Google API',
    description: 'Google Generative AI API (gemini-2.0-flash)',
    isAvailable: () => googleApiService.isAvailable(),
    readDocument: (filePath, prompt, options) => googleApiService.readDocument(filePath, prompt, options),
    readMarkdown: (content, prompt, options) => googleApiService.readMarkdown(content, prompt, options),
    analyzeRepository: (repoDir, prompt, options) => googleApiService.analyzeRepository(repoDir, prompt, options),
  },
  'codex-cli': {
    name: 'Codex CLI',
    description: 'OpenAI Codex CLI (gpt-5.1-codex-mini)',
    isAvailable: () => codexCliService.isAvailable(),
    readDocument: (filePath, prompt, options) => codexCliService.readDocument(filePath, prompt, options),
    readMarkdown: (content, prompt, options) => codexCliService.readMarkdown(content, prompt, options),
    analyzeRepository: (repoDir, prompt, options) => codexCliService.analyzeRepository(repoDir, prompt, options),
  },
  'claude-code': {
    name: 'Claude Code',
    description: 'Claude Code CLI in headless mode',
    isAvailable: async () => {
      // Claude Code is available if ANTHROPIC_API_KEY is set
      return !!config.claudeCli?.apiKey;
    },
    readDocument: async (filePath, prompt, options) => {
      // For Claude Code, we need to convert PDF to text first or use Mathpix
      throw new Error('Claude Code direct PDF reading not supported. Use Mathpix conversion.');
    },
    readMarkdown: async (content, prompt, options) => {
      // Use Anthropic API directly for markdown
      return llmService.generateCompletion(content, prompt, 'anthropic');
    },
    analyzeRepository: async (repoDir, prompt, options) => {
      // For code analysis, Claude Code could use its native capabilities
      // For now, fall back to Anthropic API
      return llmService.generateCompletion('', prompt, 'anthropic');
    },
  },
};

/**
 * Default prompt template for paper summary
 */
const DEFAULT_PROMPT = `You are an expert academic research assistant. Your task is to summarize research papers clearly and concisely.

Please summarize the following research paper. Include:

## Summary
A brief 2-3 sentence overview of the paper.

## Key Contributions
- List the main contributions (3-5 bullet points)

## Methodology
Brief description of the methods used.

## Results
Key findings and results.

## Limitations
Any limitations mentioned or observed.

## Relevance
Why this paper might be important for researchers.`;

class ReaderService {
  /**
   * Process a document through the AI reader pipeline
   * Routes to appropriate service based on reader_mode
   * @param {object} item - Queue item with document info
   * @param {object} options - Processing options
   * @returns {Promise<{notesS3Key: string, pageCount: number, codeNotesS3Key?: string}>}
   */
  async processDocument(item, options = {}) {
    const { documentId, s3Key, title, readerMode, codeUrl, hasCode } = item;

    // Check if desktop processing is available
    const desktopAvailable = await processingProxyService.isDesktopAvailable();

    if (desktopAvailable) {
      console.log(`[Reader] Forwarding to desktop for processing: ${title}`);
      try {
        return await processingProxyService.processDocument(item, options);
      } catch (error) {
        console.error('[Reader] Desktop processing failed, falling back to local:', error.message);
        // Continue to local processing
      }
    }

    console.log(`[Reader] Processing locally: ${title}`);

    // Route to appropriate reader based on mode
    const mode = readerMode || options.readerMode || 'vanilla';

    if (mode === 'auto_reader') {
      console.log(`[Reader] Using auto_reader mode for: ${title}`);
      return await autoReaderService.processDocument(item, options);
    }

    if (mode === 'auto_reader_v2') {
      console.log(`[Reader] Using auto_reader_v2 mode for: ${title}`);
      return await autoReaderService.processDocumentV2(item, options);
    }

    if (mode === 'auto_reader_v3') {
      console.log(`[Reader] Using auto_reader_v3 mode for: ${title}`);
      return await autoReaderService.processDocumentV3(item, options);
    }

    // Default: vanilla mode
    return await this.processVanilla(item, options);
  }

  /**
   * Process document in vanilla mode (simple summary)
   * @param {object} item - Queue item with document info
   * @param {object} options - Processing options
   * @returns {Promise<{notesS3Key: string, pageCount: number}>}
   */
  async processVanilla(item, options = {}) {
    const { documentId, s3Key, title } = item;
    let tempFilePath = null;

    try {
      console.log(`[Reader] Starting vanilla processing for: ${title} (ID: ${documentId})`);

      // Step 1: Prepare PDF (download, truncate if needed)
      const pdfInfo = await pdfService.preparePdfForProcessing(s3Key);
      tempFilePath = pdfInfo.filePath;

      console.log(`[Reader] PDF prepared: ${pdfInfo.pageCount} pages, ${pdfInfo.fileSizeMb.toFixed(2)} MB, truncated: ${pdfInfo.wasTruncated}, needsMathpix: ${pdfInfo.needsMathpix}`);

      // Step 2: Get prompt template
      const prompt = await this.getPromptTemplate(options.promptTemplateId);

      // Step 3: Read the document using the specified provider
      let result;
      const providerOptions = {
        ...options,
        provider: item.analysisProvider || options.provider || config.reader?.defaultProvider,
      };

      if (pdfInfo.needsMathpix) {
        // Large PDF: Convert with Mathpix first
        result = await this.readWithMathpix(pdfInfo.buffer, prompt, providerOptions);
      } else {
        // Normal PDF: Direct AI reading
        result = await this.readWithAI(pdfInfo.filePath, prompt, providerOptions);
      }

      console.log(`[Reader] AI reading complete, output length: ${result.text.length} chars`);

      // Step 4: Save notes to S3
      const notesS3Key = await this.saveNotesToS3(documentId, result.text, title);

      console.log(`[Reader] Notes saved to S3: ${notesS3Key}`);

      return {
        notesS3Key,
        pageCount: pdfInfo.pageCount,
        originalPageCount: pdfInfo.originalPageCount,
        wasTruncated: pdfInfo.wasTruncated,
        usedMathpix: pdfInfo.needsMathpix,
      };
    } finally {
      // Cleanup temp file
      if (tempFilePath) {
        await pdfService.cleanupTmpFile(tempFilePath);
      }
    }
  }

  /**
   * Get list of available providers
   * @returns {Promise<Array<{id: string, name: string, description: string, available: boolean}>>}
   */
  async getAvailableProviders() {
    const providerList = [];
    
    for (const [id, provider] of Object.entries(PROVIDERS)) {
      const available = await provider.isAvailable();
      providerList.push({
        id,
        name: provider.name,
        description: provider.description,
        available,
      });
    }
    
    return providerList;
  }

  /**
   * Read a document using the specified provider
   * @param {string} filePath - Path to PDF file
   * @param {string} prompt - The prompt to use
   * @param {object} options - Additional options including provider selection
   * @returns {Promise<{text: string, provider?: string, model?: string}>}
   */
  async readWithAI(filePath, prompt, options = {}) {
    const requestedProvider = options.provider || config.reader?.defaultProvider || 'gemini-cli';
    
    console.log(`[Reader] Requested provider: ${requestedProvider}`);

    // Try the requested provider first
    if (PROVIDERS[requestedProvider]) {
      const provider = PROVIDERS[requestedProvider];
      const available = await provider.isAvailable();
      
      if (available) {
        console.log(`[Reader] Using ${provider.name}`);
        try {
          return await provider.readDocument(filePath, prompt, options);
        } catch (error) {
          console.error(`[Reader] ${provider.name} failed:`, error.message);
          // Continue to fallback
        }
      } else {
        console.log(`[Reader] ${provider.name} not available`);
      }
    }

    // Fallback order: gemini-cli -> google-api -> claude-code
    const fallbackOrder = ['gemini-cli', 'google-api', 'codex-cli', 'claude-code'];
    
    for (const providerId of fallbackOrder) {
      if (providerId === requestedProvider) continue; // Already tried
      
      const provider = PROVIDERS[providerId];
      if (!provider) continue;
      
      const available = await provider.isAvailable();
      if (!available) continue;
      
      console.log(`[Reader] Falling back to ${provider.name}`);
      try {
        return await provider.readDocument(filePath, prompt, options);
      } catch (error) {
        console.error(`[Reader] ${provider.name} fallback failed:`, error.message);
        // Continue to next fallback
      }
    }

    // Final fallback to LLM API
    const configuredProviders = llmService.getConfiguredProviders();

    if (configuredProviders.length === 0) {
      throw new Error('No AI providers available. Configure one of: Gemini CLI, Google API key, or Anthropic API key.');
    }

    throw new Error('All document reading providers failed. Please check your configuration.');
  }

  /**
   * Read a document using Mathpix conversion + AI
   * @param {Buffer} pdfBuffer - PDF buffer
   * @param {string} prompt - The prompt to use
   * @param {object} options - Additional options including provider selection
   * @returns {Promise<{text: string, provider?: string, model?: string}>}
   */
  async readWithMathpix(pdfBuffer, prompt, options = {}) {
    if (!mathpixService.isConfigured()) {
      throw new Error('Mathpix is not configured. Cannot process large PDFs without Mathpix API keys.');
    }

    console.log('[Reader] Converting PDF with Mathpix...');

    // Convert PDF to markdown
    const { markdown } = await mathpixService.convertPdfToMarkdown(pdfBuffer);

    console.log(`[Reader] Mathpix conversion complete, markdown length: ${markdown.length} chars`);

    const requestedProvider = options.provider || config.reader?.defaultProvider || 'gemini-cli';
    
    // Try the requested provider first for markdown processing
    if (PROVIDERS[requestedProvider]) {
      const provider = PROVIDERS[requestedProvider];
      const available = await provider.isAvailable();
      
      if (available && provider.readMarkdown) {
        console.log(`[Reader] Using ${provider.name} for markdown processing`);
        try {
          return await provider.readMarkdown(markdown, prompt, options);
        } catch (error) {
          console.error(`[Reader] ${provider.name} markdown processing failed:`, error.message);
        }
      }
    }

    // Fallback order for markdown processing
    const fallbackOrder = ['gemini-cli', 'google-api', 'codex-cli', 'claude-code'];
    
    for (const providerId of fallbackOrder) {
      if (providerId === requestedProvider) continue;
      
      const provider = PROVIDERS[providerId];
      if (!provider || !provider.readMarkdown) continue;
      
      const available = await provider.isAvailable();
      if (!available) continue;
      
      console.log(`[Reader] Falling back to ${provider.name} for markdown`);
      try {
        return await provider.readMarkdown(markdown, prompt, options);
      } catch (error) {
        console.error(`[Reader] ${provider.name} markdown fallback failed:`, error.message);
      }
    }

    // Final fallback to generic LLM API
    console.log('[Reader] Using LLM API for markdown processing');
    return await llmService.generateWithFallback(markdown, prompt);
  }

  /**
   * Get a prompt template from the database
   * @param {number|null} templateId - Template ID (null for default)
   * @returns {Promise<string>}
   */
  async getPromptTemplate(templateId = null) {
    const db = getDb();

    let query;
    let args = [];

    if (templateId) {
      query = 'SELECT system_prompt, user_prompt FROM prompt_templates WHERE id = ?';
      args = [templateId];
    } else {
      query = "SELECT system_prompt, user_prompt FROM prompt_templates WHERE is_default = 1 AND user_id = 'default_user' LIMIT 1";
    }

    const result = await db.execute({ sql: query, args });

    if (result.rows.length === 0) {
      return DEFAULT_PROMPT;
    }

    const template = result.rows[0];
    let prompt = '';

    if (template.system_prompt) {
      prompt += template.system_prompt + '\n\n';
    }

    prompt += template.user_prompt;

    return prompt;
  }

  /**
   * Save generated notes to S3
   * @param {number} documentId - Document ID
   * @param {string} notesContent - Markdown notes content
   * @param {string} title - Document title
   * @returns {Promise<string>} - S3 key
   */
  async saveNotesToS3(documentId, notesContent, title) {
    const timestamp = Date.now();
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
    const s3Key = `default_user/notes/${timestamp}-${documentId}-${sanitizedTitle}.md`;

    // Add metadata header to notes
    const fullNotes = `---
document_id: ${documentId}
title: ${title}
generated_at: ${new Date().toISOString()}
---

${notesContent}`;

    const buffer = Buffer.from(fullNotes, 'utf-8');
    await s3Service.uploadBuffer(buffer, s3Key, 'text/markdown');

    return s3Key;
  }

  /**
   * List all available prompt templates
   * @param {string} userId - User ID
   * @returns {Promise<Array>}
   */
  async listPromptTemplates(userId = 'default_user') {
    const db = getDb();

    const result = await db.execute({
      sql: `SELECT id, name, description, is_default, created_at
            FROM prompt_templates
            WHERE user_id = ?
            ORDER BY is_default DESC, name ASC`,
      args: [userId],
    });

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      isDefault: row.is_default === 1,
      createdAt: row.created_at,
    }));
  }

  /**
   * Create a new prompt template
   * @param {object} data - Template data
   * @returns {Promise<object>}
   */
  async createPromptTemplate(data) {
    const db = getDb();

    const result = await db.execute({
      sql: `INSERT INTO prompt_templates (name, description, system_prompt, user_prompt, is_default, user_id)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        data.name,
        data.description || null,
        data.systemPrompt || null,
        data.userPrompt,
        data.isDefault ? 1 : 0,
        data.userId || 'default_user',
      ],
    });

    return {
      id: Number(result.lastInsertRowid),
      ...data,
    };
  }

  /**
   * Update a prompt template
   * @param {number} id - Template ID
   * @param {object} data - Updated data
   * @returns {Promise<object>}
   */
  async updatePromptTemplate(id, data) {
    const db = getDb();

    await db.execute({
      sql: `UPDATE prompt_templates
            SET name = COALESCE(?, name),
                description = COALESCE(?, description),
                system_prompt = COALESCE(?, system_prompt),
                user_prompt = COALESCE(?, user_prompt),
                is_default = COALESCE(?, is_default),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
      args: [
        data.name || null,
        data.description || null,
        data.systemPrompt || null,
        data.userPrompt || null,
        data.isDefault !== undefined ? (data.isDefault ? 1 : 0) : null,
        id,
      ],
    });

    return { id, ...data };
  }

  /**
   * Delete a prompt template
   * @param {number} id - Template ID
   */
  async deletePromptTemplate(id) {
    const db = getDb();

    await db.execute({
      sql: 'DELETE FROM prompt_templates WHERE id = ?',
      args: [id],
    });
  }
}

module.exports = new ReaderService();
