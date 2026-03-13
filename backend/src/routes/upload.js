const express = require('express');
const router = express.Router();
const multer = require('multer');
const s3Service = require('../services/s3.service');
const documentService = require('../services/document.service');
const converterService = require('../services/converter.service');
const arxivService = require('../services/arxiv.service');
const { requireAuth } = require('../middleware/auth');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'application/epub+zip',
      'text/plain',
      'text/html',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, EPUB, TXT, and HTML are allowed.'));
    }
  },
});

function normalizeProvidedArxivMetadata(arxivId, providedMetadata = {}) {
  const rawTitle = String(providedMetadata?.title || '').trim();
  const rawAbstract = String(providedMetadata?.abstract || providedMetadata?.summary || '').trim();
  const rawAuthors = Array.isArray(providedMetadata?.authors)
    ? providedMetadata.authors.map((author) => String(author || '').trim()).filter(Boolean)
    : [];
  const rawPublished = String(providedMetadata?.published || providedMetadata?.publishedAt || '').trim();
  const rawPrimaryCategory = String(providedMetadata?.primaryCategory || '').trim();
  const rawAbsUrl = String(providedMetadata?.absUrl || '').trim();

  return {
    metadata: {
      id: arxivId,
      title: rawTitle || `arXiv:${arxivId}`,
      authors: rawAuthors,
      abstract: rawAbstract,
      primaryCategory: rawPrimaryCategory,
      published: rawPublished,
      pdfUrl: arxivService.getPdfUrl(arxivId),
      absUrl: rawAbsUrl || arxivService.getAbsUrl(arxivId),
    },
    hasStrongMetadata: Boolean(rawTitle && rawAbstract),
    hasFallbackMetadata: Boolean(rawTitle || rawAbstract || rawAuthors.length || rawPublished || rawPrimaryCategory || rawAbsUrl),
  };
}

async function resolveArxivUploadMetadata({
  arxivId,
  providedMetadata = {},
  fetchMetadata = arxivService.fetchMetadata,
}) {
  const normalized = normalizeProvidedArxivMetadata(arxivId, providedMetadata);
  if (normalized.hasStrongMetadata) {
    return normalized.metadata;
  }

  try {
    return await fetchMetadata(arxivId);
  } catch (error) {
    if (/HTTP 429/i.test(String(error?.message || '')) && normalized.hasFallbackMetadata) {
      return normalized.metadata;
    }
    throw error;
  }
}

// POST /api/upload/presigned - Get presigned URL for direct upload (requires auth)
router.post('/presigned', requireAuth, async (req, res) => {
  try {
    const { filename, contentType } = req.body;

    if (!filename || !contentType) {
      return res.status(400).json({ error: 'filename and contentType are required' });
    }

    const userId = req.userId || 'czk';
    const key = s3Service.generateS3Key(filename, userId);

    const { uploadUrl } = await s3Service.generatePresignedUploadUrl(key, contentType);

    res.json({
      uploadUrl,
      key,
      expiresIn: 3600,
    });
  } catch (error) {
    console.error('Error generating presigned URL:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

// POST /api/upload/direct - Direct file upload through server (requires auth)
router.post('/direct', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { title, type, tags, notes, analysisProvider } = req.body;
    const userId = req.userId || 'czk';

    // Generate S3 key and upload
    const key = s3Service.generateS3Key(req.file.originalname, userId);
    const { location } = await s3Service.uploadBuffer(
      req.file.buffer,
      key,
      req.file.mimetype
    );

    // Create document record
    const document = await documentService.createDocument({
      title: title || req.file.originalname,
      type: type || 'other',
      s3Key: key,
      s3Url: location,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      tags: tags ? JSON.parse(tags) : [],
      notes,
      userId,
      analysisProvider: analysisProvider || 'gemini-cli',
    });

    res.status(201).json(document);
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

/**
 * Check if a URL points directly to a PDF file
 */
function isDirectPdfUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('.pdf');
  } catch (_) {
    return false;
  }
}

/**
 * Download a file from a URL with redirect support
 */
async function downloadUrl(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/pdf,*/*',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`Failed to download: HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// POST /api/upload/webpage - Convert webpage to PDF and save (requires auth)
router.post('/webpage', requireAuth, async (req, res) => {
  try {
    const { url, title, type, tags, notes, analysisProvider } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const userId = req.userId || 'czk';

    let buffer, pageTitle;

    if (isDirectPdfUrl(url)) {
      // Direct PDF URL — download it directly, skip Puppeteer
      console.log(`[Upload] Direct PDF URL detected, downloading: ${url}`);
      buffer = await downloadUrl(url);
      // Extract title from URL filename
      const urlPath = new URL(url).pathname;
      pageTitle = decodeURIComponent(urlPath.split('/').pop().replace('.pdf', '').replace(/[_-]/g, ' '));
    } else {
      // Convert webpage to PDF via Puppeteer
      const result = await converterService.convertUrlToPdf(url);
      buffer = result.buffer;
      pageTitle = result.title;
    }

    // Generate filename from title
    const filename = `${(title || pageTitle).slice(0, 50).replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

    // Upload to S3
    const key = s3Service.generateS3Key(filename, userId);
    const { location } = await s3Service.uploadBuffer(buffer, key, 'application/pdf');

    // Create document record
    const document = await documentService.createDocument({
      title: title || pageTitle,
      type: type || 'blog',
      originalUrl: url,
      s3Key: key,
      s3Url: location,
      fileSize: buffer.length,
      mimeType: 'application/pdf',
      tags: tags || [],
      notes,
      userId,
      analysisProvider: analysisProvider || 'gemini-cli',
    });

    res.status(201).json(document);
  } catch (error) {
    console.error('Error converting webpage:', error);
    res.status(500).json({ error: 'Failed to convert webpage to PDF' });
  }
});

// POST /api/upload/arxiv - Fetch arXiv paper PDF and save (requires auth)
router.post('/arxiv', requireAuth, async (req, res) => {
  try {
    const {
      url,
      paperId,
      title,
      tags,
      notes,
      analysisProvider,
      abstract,
      summary,
      authors,
      published,
      publishedAt,
      primaryCategory,
      absUrl,
    } = req.body;

    // Get paper ID from URL or directly
    let arxivId = paperId;
    if (!arxivId && url) {
      arxivId = arxivService.parseArxivUrl(url);
    }

    if (!arxivId) {
      return res.status(400).json({ error: 'Invalid arXiv URL or paper ID' });
    }

    const userId = req.userId || 'czk';

    const providedMetadata = {
      title,
      abstract,
      summary,
      authors,
      published,
      publishedAt,
      primaryCategory,
      absUrl,
    };

    // Prefer feed metadata when it is already sufficient, and fall back gracefully on arXiv 429s.
    console.log(`Resolving arXiv metadata for ${arxivId}...`);
    const metadata = await resolveArxivUploadMetadata({
      arxivId,
      providedMetadata,
    });

    // Fetch PDF from arXiv
    console.log(`Fetching arXiv PDF for ${arxivId}...`);
    const pdfBuffer = await arxivService.fetchPdf(arxivId);

    // Generate filename from title
    const paperTitle = title || metadata.title;
    const filename = `arxiv_${arxivId.replace('/', '_')}_${paperTitle.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

    // Upload to S3
    const key = s3Service.generateS3Key(filename, userId);
    const { location } = await s3Service.uploadBuffer(pdfBuffer, key, 'application/pdf');

    // Try to find code repository URL
    console.log(`Searching for code URL for ${arxivId}...`);
    const codeUrl = await arxivService.findCodeUrl(arxivId, metadata.abstract);

    // Build notes with metadata
    const fullNotes = [
      notes || '',
      `Authors: ${metadata.authors.join(', ')}`,
      `Category: ${metadata.primaryCategory}`,
      `Published: ${metadata.published}`,
      codeUrl ? `Code: ${codeUrl}` : '',
      '',
      `Abstract: ${metadata.abstract}`,
    ].filter(Boolean).join('\n');

    // Create document record
    const document = await documentService.createDocument({
      title: paperTitle,
      type: 'paper',
      originalUrl: metadata.absUrl,
      s3Key: key,
      s3Url: location,
      fileSize: pdfBuffer.length,
      mimeType: 'application/pdf',
      tags: tags || [],
      notes: fullNotes,
      userId,
      analysisProvider: analysisProvider || 'gemini-cli',
    });

    // Update document with code URL if found
    if (codeUrl) {
      await documentService.updateDocument(document.id, {
        codeUrl: codeUrl,
        hasCode: true,
      });
      document.codeUrl = codeUrl;
      document.hasCode = true;
    }

    res.status(201).json({
      ...document,
      arxivMetadata: metadata,
    });
  } catch (error) {
    console.error('Error fetching arXiv paper:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch arXiv paper' });
  }
});

// GET /api/upload/arxiv/metadata - Get arXiv paper metadata without downloading
router.get('/arxiv/metadata', async (req, res) => {
  try {
    const { url, paperId } = req.query;

    let arxivId = paperId;
    if (!arxivId && url) {
      arxivId = arxivService.parseArxivUrl(url);
    }

    if (!arxivId) {
      return res.status(400).json({ error: 'Invalid arXiv URL or paper ID' });
    }

    const metadata = await arxivService.fetchMetadata(arxivId);
    res.json(metadata);
  } catch (error) {
    console.error('Error fetching arXiv metadata:', error);
    res.status(500).json({ error: 'Failed to fetch arXiv metadata' });
  }
});

// POST /api/upload/openreview - Fetch OpenReview paper PDF and save (requires auth)
router.post('/openreview', requireAuth, async (req, res) => {
  try {
    const { paperId, pdfUrl, title, tags, notes, analysisProvider } = req.body;

    if (!paperId && !pdfUrl) {
      return res.status(400).json({ error: 'Paper ID or PDF URL is required' });
    }

    const userId = req.userId || 'czk';

    // Construct PDF URL if not provided
    const openReviewPdfUrl = pdfUrl || `https://openreview.net/pdf?id=${paperId}`;
    const forumUrl = `https://openreview.net/forum?id=${paperId}`;

    console.log(`Fetching OpenReview PDF from ${openReviewPdfUrl}...`);

    // Fetch PDF from OpenReview with proper headers
    const response = await fetch(openReviewPdfUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/pdf,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': forumUrl,
      },
    });
    if (!response.ok) {
      console.error(`OpenReview fetch failed: ${response.status} ${response.statusText}`);
      throw new Error(`Failed to fetch OpenReview PDF: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    // Generate filename from title
    const paperTitle = title || `OpenReview_${paperId}`;
    const filename = `openreview_${paperId}_${paperTitle.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;

    // Upload to S3
    const key = s3Service.generateS3Key(filename, userId);
    const { location } = await s3Service.uploadBuffer(pdfBuffer, key, 'application/pdf');

    // Build notes with metadata
    const fullNotes = [
      notes || '',
      `OpenReview Paper ID: ${paperId}`,
      `Forum: ${forumUrl}`,
    ].filter(Boolean).join('\n');

    // Create document record
    const document = await documentService.createDocument({
      title: paperTitle,
      type: 'paper',
      originalUrl: forumUrl,
      s3Key: key,
      s3Url: location,
      fileSize: pdfBuffer.length,
      mimeType: 'application/pdf',
      tags: tags || [],
      notes: fullNotes,
      userId,
      analysisProvider: analysisProvider || 'gemini-cli',
    });

    res.status(201).json(document);
  } catch (error) {
    console.error('Error fetching OpenReview paper:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch OpenReview paper' });
  }
});

module.exports = router;
router.resolveArxivUploadMetadata = resolveArxivUploadMetadata;
router.normalizeProvidedArxivMetadata = normalizeProvidedArxivMetadata;
