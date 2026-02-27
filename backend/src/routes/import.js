const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const cheerio = require('cheerio');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db');
const s3Service = require('../services/s3.service');
const documentService = require('../services/document.service');
const arxivService = require('../services/arxiv.service');
const converterService = require('../services/converter.service');
const codexCliService = require('../services/codex-cli.service');
const geminiCliService = require('../services/gemini-cli.service');
const llmService = require('../services/llm.service');

const router = express.Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

function getUserId(req) {
  return req.userId || 'czk';
}

function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  return String(raw)
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeTitle(raw, fallback = 'Untitled') {
  const value = String(raw || '').trim();
  return value || fallback;
}

function safeFilename(raw, fallback = 'note') {
  const base = String(raw || fallback).trim().slice(0, 80) || fallback;
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function trimPunctuation(url) {
  return String(url || '').replace(/[)\],.;!?]+$/g, '');
}

function parseOpenReviewId(url) {
  const match = String(url || '').match(/openreview\.net\/(?:forum|pdf)\?id=([^&#\s]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function extractJsonArrayFromResponse(text) {
  const source = String(text || '').trim();
  if (!source) return [];

  try {
    const parsed = JSON.parse(source);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {}

  const fenceMatch = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {}
  }

  const bracketMatch = source.match(/\[[\s\S]*\]/);
  if (bracketMatch) {
    try {
      const parsed = JSON.parse(bracketMatch[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {}
  }

  return [];
}

function normalizeCandidate(candidate = {}) {
  const typeRaw = String(candidate.type || candidate.kind || '').toLowerCase().trim();
  const paperIdRaw = String(candidate.paperId || candidate.id || candidate.identifier || '').trim();
  const urlRaw = trimPunctuation(candidate.url || candidate.link || '');
  const titleRaw = String(candidate.title || '').trim();

  let type = typeRaw;
  if (!type && paperIdRaw) type = 'arxiv';
  if (!type && urlRaw.includes('arxiv.org')) type = 'arxiv';
  if (!type && urlRaw.includes('openreview.net')) type = 'openreview';
  if (!type && urlRaw) type = 'url';

  if (type === 'arxiv') {
    const parsedId = paperIdRaw || arxivService.parseArxivUrl(urlRaw || '');
    if (!parsedId) return null;
    return { type: 'arxiv', paperId: parsedId, title: titleRaw || null };
  }

  if (type === 'openreview') {
    const parsedId = paperIdRaw || parseOpenReviewId(urlRaw || '');
    if (!parsedId) return null;
    return { type: 'openreview', paperId: parsedId, url: urlRaw || null, title: titleRaw || null };
  }

  if (type === 'url') {
    if (!urlRaw) return null;
    return { type: 'url', url: urlRaw, title: titleRaw || null };
  }

  return null;
}

function extractCandidatesRegex(text) {
  const input = String(text || '');
  const collected = [];
  const seen = new Set();

  const addCandidate = (candidate) => {
    const normalized = normalizeCandidate(candidate);
    if (!normalized) return;
    const key = `${normalized.type}:${normalized.paperId || normalized.url}`;
    if (seen.has(key)) return;
    seen.add(key);
    collected.push(normalized);
  };

  const arxivIdRegex = /\b\d{4}\.\d{4,5}(?:v\d+)?\b/g;
  for (const match of input.matchAll(arxivIdRegex)) {
    addCandidate({ type: 'arxiv', paperId: match[0] });
  }

  const oldArxivRegex = /\b[a-z-]+\/\d{7}(?:v\d+)?\b/gi;
  for (const match of input.matchAll(oldArxivRegex)) {
    addCandidate({ type: 'arxiv', paperId: match[0] });
  }

  const urlRegex = /https?:\/\/[^\s<>"']+/g;
  for (const match of input.matchAll(urlRegex)) {
    const url = trimPunctuation(match[0]);
    const arxivId = arxivService.parseArxivUrl(url);
    if (arxivId) {
      addCandidate({ type: 'arxiv', paperId: arxivId, url });
      continue;
    }

    const openreviewId = parseOpenReviewId(url);
    if (openreviewId) {
      addCandidate({ type: 'openreview', paperId: openreviewId, url });
      continue;
    }

    if (/\.pdf(\?|$)/i.test(url)) {
      addCandidate({ type: 'url', url });
    }
  }

  return collected;
}

async function extractCandidatesAgent(text) {
  const payload = String(text || '').slice(0, 120000);
  if (!payload.trim()) return [];

  const prompt = `You extract academic paper references from user content.
Return ONLY a JSON array. No prose.

Each item must be one of:
{"type":"arxiv","paperId":"2501.01234","title":"optional"}
{"type":"openreview","paperId":"abc123","url":"optional","title":"optional"}
{"type":"url","url":"https://example.com/paper.pdf","title":"optional"}

Rules:
- Include only likely academic papers.
- Prefer arxiv/openreview when detected.
- Deduplicate.
- Max 20 items.

Input:
${payload}`;

  let responseText = '';

  try {
    if (await codexCliService.isAvailable()) {
      const result = await codexCliService.readMarkdown(payload, prompt, { timeout: 120000 });
      responseText = result.text || '';
    } else if (await geminiCliService.isAvailable()) {
      const result = await geminiCliService.readMarkdown(payload, prompt, { timeout: 120000 });
      responseText = result.text || '';
    } else {
      const result = await llmService.generateWithFallback(payload, prompt);
      responseText = result.text || '';
    }
  } catch (error) {
    console.warn('[ImportAgent] Agent extraction failed, using regex fallback:', error.message);
    return [];
  }

  const parsed = extractJsonArrayFromResponse(responseText);
  return parsed.map(normalizeCandidate).filter(Boolean);
}

async function extractPaperCandidates(text) {
  const regexCandidates = extractCandidatesRegex(text);
  const agentCandidates = await extractCandidatesAgent(text);
  const merged = [];
  const seen = new Set();

  for (const candidate of [...agentCandidates, ...regexCandidates]) {
    const key = `${candidate.type}:${candidate.paperId || candidate.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
    if (merged.length >= 20) break;
  }

  return merged;
}

async function findExistingByOriginalUrl(userId, originalUrl) {
  if (!originalUrl) return null;
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT id FROM documents WHERE user_id = ? AND original_url = ? LIMIT 1',
    args: [userId, originalUrl],
  });
  if (!result.rows.length) return null;
  return documentService.getDocumentById(result.rows[0].id);
}

async function downloadUrl(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'application/pdf,*/*',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Failed to download URL: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function importArxivCandidate(candidate, context) {
  const { userId, tags, analysisProvider } = context;
  const metadata = await arxivService.fetchMetadata(candidate.paperId);
  const existing = await findExistingByOriginalUrl(userId, metadata.absUrl);
  if (existing) return { status: 'skipped', reason: 'already_exists', document: existing };

  const pdfBuffer = await arxivService.fetchPdf(candidate.paperId);
  const codeUrl = await arxivService.findCodeUrl(candidate.paperId, metadata.abstract);
  const title = normalizeTitle(candidate.title, metadata.title);
  const filename = `arxiv_${candidate.paperId.replace('/', '_')}_${safeFilename(title, 'paper')}.pdf`;
  const s3Key = s3Service.generateS3Key(filename, userId);
  const { location } = await s3Service.uploadBuffer(pdfBuffer, s3Key, 'application/pdf');

  const notes = [
    `Imported via agent extraction`,
    `Authors: ${metadata.authors.join(', ')}`,
    `Category: ${metadata.primaryCategory || 'N/A'}`,
    `Published: ${metadata.published || 'N/A'}`,
    codeUrl ? `Code: ${codeUrl}` : '',
    '',
    `Abstract: ${metadata.abstract || ''}`,
  ].filter(Boolean).join('\n');

  const document = await documentService.createDocument({
    title,
    type: 'paper',
    originalUrl: metadata.absUrl,
    s3Key,
    s3Url: location,
    fileSize: pdfBuffer.length,
    mimeType: 'application/pdf',
    tags,
    notes,
    userId,
    analysisProvider,
  });

  if (codeUrl) {
    await documentService.updateDocument(document.id, { codeUrl, hasCode: true });
    document.codeUrl = codeUrl;
    document.hasCode = true;
  }

  return { status: 'imported', document };
}

async function importOpenReviewCandidate(candidate, context) {
  const { userId, tags, analysisProvider } = context;
  const forumUrl = `https://openreview.net/forum?id=${candidate.paperId}`;
  const existing = await findExistingByOriginalUrl(userId, forumUrl);
  if (existing) return { status: 'skipped', reason: 'already_exists', document: existing };

  const pdfUrl = candidate.url || `https://openreview.net/pdf?id=${candidate.paperId}`;
  const response = await fetch(pdfUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'application/pdf,*/*',
      Referer: forumUrl,
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch OpenReview PDF: HTTP ${response.status}`);
  }

  const pdfBuffer = Buffer.from(await response.arrayBuffer());
  const title = normalizeTitle(candidate.title, `OpenReview_${candidate.paperId}`);
  const filename = `openreview_${candidate.paperId}_${safeFilename(title, 'paper')}.pdf`;
  const s3Key = s3Service.generateS3Key(filename, userId);
  const { location } = await s3Service.uploadBuffer(pdfBuffer, s3Key, 'application/pdf');

  const notes = [`Imported via agent extraction`, `OpenReview Paper ID: ${candidate.paperId}`, `Forum: ${forumUrl}`].join('\n');
  const document = await documentService.createDocument({
    title,
    type: 'paper',
    originalUrl: forumUrl,
    s3Key,
    s3Url: location,
    fileSize: pdfBuffer.length,
    mimeType: 'application/pdf',
    tags,
    notes,
    userId,
    analysisProvider,
  });

  return { status: 'imported', document };
}

async function importUrlCandidate(candidate, context) {
  const { userId, tags, analysisProvider } = context;
  const existing = await findExistingByOriginalUrl(userId, candidate.url);
  if (existing) return { status: 'skipped', reason: 'already_exists', document: existing };

  let buffer;
  let title = normalizeTitle(candidate.title, 'Imported Web Paper');
  let mimeType = 'application/pdf';
  let type = 'paper';

  if (/\.pdf(\?|$)/i.test(candidate.url)) {
    buffer = await downloadUrl(candidate.url);
    const fileNameFromUrl = decodeURIComponent(candidate.url.split('/').pop().split('?')[0] || '');
    if (fileNameFromUrl) title = normalizeTitle(candidate.title, fileNameFromUrl.replace(/\.pdf$/i, ''));
  } else {
    const converted = await converterService.convertUrlToPdf(candidate.url);
    buffer = converted.buffer;
    title = normalizeTitle(candidate.title, converted.title || 'Imported Web Paper');
    mimeType = 'application/pdf';
    type = 'blog';
  }

  const filename = `${safeFilename(title, 'imported')}.pdf`;
  const s3Key = s3Service.generateS3Key(filename, userId);
  const { location } = await s3Service.uploadBuffer(buffer, s3Key, mimeType);

  const document = await documentService.createDocument({
    title,
    type,
    originalUrl: candidate.url,
    s3Key,
    s3Url: location,
    fileSize: buffer.length,
    mimeType,
    tags,
    notes: 'Imported via agent extraction',
    userId,
    analysisProvider,
  });

  return { status: 'imported', document };
}

async function importCandidate(candidate, context) {
  if (candidate.type === 'arxiv') return importArxivCandidate(candidate, context);
  if (candidate.type === 'openreview') return importOpenReviewCandidate(candidate, context);
  if (candidate.type === 'url') return importUrlCandidate(candidate, context);
  throw new Error(`Unsupported candidate type: ${candidate.type}`);
}

async function importCandidates(candidates, context) {
  const results = [];
  for (const candidate of candidates) {
    try {
      const result = await importCandidate(candidate, context);
      results.push({
        candidate,
        status: result.status,
        reason: result.reason || null,
        document: result.document || null,
      });
    } catch (error) {
      results.push({
        candidate,
        status: 'failed',
        reason: error.message,
        document: null,
      });
    }
  }
  return results;
}

async function fileToText(file) {
  if (!file) return '';
  const mime = String(file.mimetype || '').toLowerCase();

  if (mime === 'text/html') {
    const html = file.buffer.toString('utf-8');
    const $ = cheerio.load(html);
    return $.text();
  }

  if (mime.includes('text/') || mime === 'application/json' || mime.includes('csv') || mime.includes('markdown')) {
    return file.buffer.toString('utf-8');
  }

  if (mime === 'application/pdf') {
    const parsed = await pdfParse(file.buffer);
    return parsed.text || '';
  }

  // Fallback: try utf-8 decode for unknown text-like files
  return file.buffer.toString('utf-8');
}

router.post('/extract-text', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    const tags = parseTags(req.body?.tags);
    const analysisProvider = String(req.body?.analysisProvider || 'codex-cli');
    if (!text) return res.status(400).json({ error: 'text is required' });

    const candidates = await extractPaperCandidates(text);
    const importResults = await importCandidates(candidates, {
      userId: getUserId(req),
      tags,
      analysisProvider,
    });

    return res.json({
      candidates,
      results: importResults,
      summary: {
        extracted: candidates.length,
        imported: importResults.filter((r) => r.status === 'imported').length,
        skipped: importResults.filter((r) => r.status === 'skipped').length,
        failed: importResults.filter((r) => r.status === 'failed').length,
      },
    });
  } catch (error) {
    console.error('[Import] extract-text failed:', error);
    return res.status(500).json({ error: error.message || 'Failed to extract/import papers' });
  }
});

router.post('/extract-file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    const tags = parseTags(req.body?.tags);
    const analysisProvider = String(req.body?.analysisProvider || 'codex-cli');
    const text = (await fileToText(req.file)).trim();

    if (!text) {
      return res.status(400).json({ error: 'No extractable text found in uploaded file' });
    }

    const candidates = await extractPaperCandidates(text);
    const importResults = await importCandidates(candidates, {
      userId: getUserId(req),
      tags,
      analysisProvider,
    });

    return res.json({
      file: { name: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size },
      candidates,
      results: importResults,
      summary: {
        extracted: candidates.length,
        imported: importResults.filter((r) => r.status === 'imported').length,
        skipped: importResults.filter((r) => r.status === 'skipped').length,
        failed: importResults.filter((r) => r.status === 'failed').length,
      },
    });
  } catch (error) {
    console.error('[Import] extract-file failed:', error);
    return res.status(500).json({ error: error.message || 'Failed to process uploaded file' });
  }
});

// ─── Deep Research ──────────────────────────────────────────────────────────

const https = require('https');

/**
 * Use LLM to distill a proposal into a short arXiv search query.
 */
async function extractSearchKeywordsFromProposal(proposalText) {
  const content = proposalText.slice(0, 4000);
  const prompt = [
    'Extract 3-5 key technical concepts or topics from this research proposal for an arXiv paper search.',
    'Return ONLY a concise search query string (no explanation, no quotes), suitable for the arXiv API `all:` field.',
  ].join('\n');
  try {
    let text = '';
    if (await codexCliService.isAvailable()) {
      const r = await codexCliService.readMarkdown(content, prompt, { timeout: 30000 });
      text = String(r?.text || '').trim();
    } else if (await geminiCliService.isAvailable()) {
      const r = await geminiCliService.readMarkdown(content, prompt, { timeout: 30000 });
      text = String(r?.text || '').trim();
    } else {
      const r = await llmService.generateWithFallback(content, prompt);
      text = String(r?.text || '').trim();
    }
    return (text.split('\n')[0] || '').slice(0, 200) || content.slice(0, 100);
  } catch {
    return content.slice(0, 100);
  }
}

/**
 * Search arXiv for papers matching a query.
 * Returns lightweight metadata; does NOT download PDFs.
 */
async function searchArxivForPapers(query, maxResults = 15) {
  const encoded = encodeURIComponent(`all:${query}`);
  const apiUrl = `https://export.arxiv.org/api/query?search_query=${encoded}&sortBy=relevance&sortOrder=descending&max_results=${maxResults}&start=0`;

  const data = await new Promise((resolve, reject) => {
    const req = https.get(apiUrl, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body));
      response.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('arXiv search timeout')));
  });

  const papers = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = entryRegex.exec(data)) !== null) {
    const xml = match[1];
    const idMatch = xml.match(/<id>([\s\S]*?)<\/id>/);
    const arxivId = idMatch ? arxivService.parseArxivUrl(idMatch[1].trim()) : null;
    if (!arxivId) continue;

    const titleMatch = xml.match(/<title>([\s\S]*?)<\/title>/);
    const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : '';

    const authorsXml = xml.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g) || [];
    const authors = authorsXml
      .map((a) => { const nm = a.match(/<name>([\s\S]*?)<\/name>/); return nm ? nm[1].trim() : ''; })
      .filter(Boolean);

    const abstractMatch = xml.match(/<summary>([\s\S]*?)<\/summary>/);
    const abstract = abstractMatch ? abstractMatch[1].trim().replace(/\s+/g, ' ') : '';

    const publishedMatch = xml.match(/<published>([\s\S]*?)<\/published>/);
    const published = publishedMatch ? publishedMatch[1].trim() : '';

    const categoryMatch = xml.match(/<arxiv:primary_category[^>]*term="([^"]+)"/);
    const category = categoryMatch ? categoryMatch[1] : '';

    // Quick GitHub check from abstract only (no extra network call)
    const githubMatch = abstract.match(/https?:\/\/github\.com\/[\w-]+\/[\w.-]+/i);
    const codeUrl = githubMatch ? githubMatch[0].replace(/\.+$/, '') : null;

    papers.push({
      arxivId,
      title,
      authors,
      abstract,
      published: published.slice(0, 10), // YYYY-MM-DD
      category,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
      texUrl: `https://arxiv.org/e-print/${arxivId}`,
      absUrl: `https://arxiv.org/abs/${arxivId}`,
      codeUrl,
    });
  }
  return papers;
}

/**
 * POST /import/deep-research
 * body: { query: string, maxResults?: number }
 * Returns a list of paper metadata for user selection. Does NOT download.
 */
router.post('/deep-research', async (req, res) => {
  try {
    const queryRaw = String(req.body?.query || '').trim();
    if (!queryRaw) return res.status(400).json({ error: 'query is required' });
    const maxResults = Math.min(Math.max(1, Number(req.body?.maxResults) || 15), 30);

    // If long text (proposal), extract key terms first
    const searchQuery = queryRaw.length > 250
      ? await extractSearchKeywordsFromProposal(queryRaw)
      : queryRaw;

    const papers = await searchArxivForPapers(searchQuery, maxResults);
    return res.json({ papers, searchQuery, originalQuery: queryRaw });
  } catch (error) {
    console.error('[Import] deep-research failed:', error);
    return res.status(500).json({ error: error.message || 'Search failed' });
  }
});

/**
 * POST /import/save-selected
 * body: { arxivIds: string[], tags?: string[] }
 * Downloads and imports the selected papers into the library.
 */
router.post('/save-selected', async (req, res) => {
  try {
    const userId = getUserId(req);
    const arxivIds = Array.isArray(req.body?.arxivIds) ? req.body.arxivIds.map(String).filter(Boolean) : [];
    const tags = parseTags(req.body?.tags);
    const analysisProvider = String(req.body?.analysisProvider || 'codex-cli');

    if (arxivIds.length === 0) return res.status(400).json({ error: 'No papers selected' });
    if (arxivIds.length > 20) return res.status(400).json({ error: 'Maximum 20 papers per import' });

    const context = { userId, tags, analysisProvider };
    const results = [];
    for (const arxivId of arxivIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await importArxivCandidate({ type: 'arxiv', paperId: arxivId, title: '' }, context);
        results.push({ arxivId, status: result.status, reason: result.reason || null, document: result.document || null });
      } catch (err) {
        results.push({ arxivId, status: 'failed', reason: err.message, document: null });
      }
    }

    return res.json({
      results,
      summary: {
        total: results.length,
        imported: results.filter((r) => r.status === 'imported').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
        failed: results.filter((r) => r.status === 'failed').length,
      },
    });
  } catch (error) {
    console.error('[Import] save-selected failed:', error);
    return res.status(500).json({ error: error.message || 'Import failed' });
  }
});

router.post('/save-note', async (req, res) => {
  try {
    const title = normalizeTitle(req.body?.title, `Quick Note ${new Date().toISOString().slice(0, 10)}`);
    const content = String(req.body?.content || '').trim();
    const tags = parseTags(req.body?.tags);
    const analysisProvider = String(req.body?.analysisProvider || 'codex-cli');
    const userId = getUserId(req);

    if (!content) return res.status(400).json({ error: 'content is required' });

    const filename = `${safeFilename(title, 'quick_note')}.md`;
    const s3Key = s3Service.generateS3Key(filename, userId);
    const buffer = Buffer.from(content, 'utf-8');
    const { location } = await s3Service.uploadBuffer(buffer, s3Key, 'text/markdown');

    const document = await documentService.createDocument({
      title,
      type: 'other',
      originalUrl: null,
      s3Key,
      s3Url: location,
      fileSize: buffer.length,
      mimeType: 'text/markdown',
      tags,
      notes: content,
      userId,
      analysisProvider,
    });

    return res.status(201).json({ document });
  } catch (error) {
    console.error('[Import] save-note failed:', error);
    return res.status(500).json({ error: error.message || 'Failed to save note' });
  }
});

module.exports = router;
