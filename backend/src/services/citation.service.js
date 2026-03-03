const crypto = require('crypto');
const cheerio = require('cheerio');
const { getDb } = require('../db');
const arxivService = require('./arxiv.service');

const SUPPORTED_FORMATS = ['bibtex', 'apa', 'mla'];
const SUPPORTED_FORMATS_SET = new Set(SUPPORTED_FORMATS);
const LOOKUP_TIMEOUT_MS = 15000;

const MONTH_NAMES_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_NAMES_SHORT = [
  'Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.',
  'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.',
];

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function firstNonEmpty(values = []) {
  for (const value of values) {
    const cleaned = cleanText(value);
    if (cleaned) return cleaned;
  }
  return '';
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch (_) {
    return String(value || '');
  }
}

function normalizeUrl(rawUrl) {
  const value = cleanText(rawUrl);
  if (!value) return '';
  try {
    return new URL(value).href;
  } catch (_) {
    return '';
  }
}

function getHostName(rawUrl) {
  try {
    const host = new URL(rawUrl).hostname.replace(/^www\./i, '');
    return host || '';
  } catch (_) {
    return '';
  }
}

function parseDateParts(rawValue) {
  const value = cleanText(rawValue);
  if (!value) return null;

  const yearOnlyMatch = value.match(/^(\d{4})$/);
  if (yearOnlyMatch) {
    return { year: Number(yearOnlyMatch[1]), month: null, day: null };
  }

  const numericMatch = value.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/);
  if (numericMatch) {
    const year = Number(numericMatch[1]);
    const month = Number(numericMatch[2]);
    const day = numericMatch[3] ? Number(numericMatch[3]) : null;
    if (!Number.isFinite(year) || year < 1000 || year > 3000) return null;
    if (!Number.isFinite(month) || month < 1 || month > 12) return null;
    if (day !== null && (!Number.isFinite(day) || day < 1 || day > 31)) return null;
    return { year, month, day };
  }

  const textualMatch = value.match(/\b(\d{1,2})?\s*([A-Za-z]+)\s*,?\s*(\d{4})\b|\b([A-Za-z]+)\s+(\d{1,2})?,?\s*(\d{4})\b/);
  if (textualMatch) {
    const monthToken = cleanText(textualMatch[2] || textualMatch[4]).toLowerCase();
    const monthIndex = MONTH_NAMES_LONG.map((m) => m.toLowerCase()).findIndex((m) => m.startsWith(monthToken.slice(0, 3)));
    const dayRaw = textualMatch[1] || textualMatch[5] || '';
    const yearRaw = textualMatch[3] || textualMatch[6] || '';
    if (monthIndex >= 0 && yearRaw) {
      const year = Number(yearRaw);
      const day = dayRaw ? Number(dayRaw) : null;
      if (!Number.isFinite(year) || year < 1000 || year > 3000) return null;
      if (day !== null && (!Number.isFinite(day) || day < 1 || day > 31)) return null;
      return { year, month: monthIndex + 1, day };
    }
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return { year: parsed.getUTCFullYear(), month: null, day: null };
  }

  const fallbackYear = value.match(/(\d{4})/);
  if (fallbackYear) {
    const year = Number(fallbackYear[1]);
    if (Number.isFinite(year) && year >= 1000 && year <= 3000) {
      return { year, month: null, day: null };
    }
  }

  return null;
}

function toIsoDate(dateParts) {
  if (!dateParts || !dateParts.year) return '';
  const month = dateParts.month ? `-${String(dateParts.month).padStart(2, '0')}` : '';
  const day = dateParts.day ? `-${String(dateParts.day).padStart(2, '0')}` : '';
  return `${dateParts.year}${month}${day}`;
}

function datePrecision(dateParts) {
  if (!dateParts || !dateParts.year) return 0;
  let score = 1;
  if (dateParts.month) score += 1;
  if (dateParts.day) score += 1;
  return score;
}

function extractDoi(text) {
  const decoded = decodeURIComponentSafe(text);
  const match = decoded.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
  if (!match) return '';
  return cleanText(match[0]).replace(/[),.;]+$/, '').toLowerCase();
}

function parseOpenReviewId(url) {
  const match = String(url || '').match(/openreview\.net\/(?:forum|pdf)\?id=([^&#\s]+)/i);
  return match ? decodeURIComponentSafe(match[1]) : '';
}

function parseArxivId(text) {
  const input = String(text || '');
  const fromUrl = arxivService.parseArxivUrl(input);
  if (fromUrl) return fromUrl;
  const rawMatch = input.match(/\b([a-z-]+\/\d{7}(?:v\d+)?|\d{4}\.\d{4,5}(?:v\d+)?)\b/i);
  return rawMatch ? rawMatch[1] : '';
}

function normalizeAuthorName(rawName) {
  return cleanText(String(rawName || '').replace(/\.$/, ''));
}

function normalizeAuthors(input) {
  const seen = new Set();
  const output = [];

  const push = (rawName) => {
    const name = normalizeAuthorName(rawName);
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(name);
  };

  if (Array.isArray(input)) {
    for (const item of input) {
      if (!item) continue;
      if (typeof item === 'string') {
        push(item);
        continue;
      }
      if (typeof item === 'object') {
        const combined = firstNonEmpty([
          item.name,
          item.literal,
          [item.given, item.family].filter(Boolean).join(' '),
          [item.firstName, item.lastName].filter(Boolean).join(' '),
        ]);
        push(combined);
      }
    }
    return output;
  }

  if (typeof input === 'string') {
    push(input);
    return output;
  }

  return output;
}

function splitAuthorsLine(rawLine) {
  const value = cleanText(rawLine);
  if (!value) return [];

  if (value.includes(';')) {
    return value.split(';').map((s) => cleanText(s)).filter(Boolean);
  }
  if (/\band\b/i.test(value)) {
    return value.split(/\band\b/i).map((s) => cleanText(s)).filter(Boolean);
  }
  return value.split(',').map((s) => cleanText(s)).filter(Boolean);
}

function extractMetadataFromNotes(notes) {
  const source = String(notes || '');
  const lines = source.split(/\r?\n/);
  const metadata = {
    authors: [],
    publishedRaw: '',
    venue: '',
    doi: '',
    arxivId: '',
    openreviewId: '',
  };

  for (const line of lines) {
    const authorsMatch = line.match(/^authors?\s*:\s*(.+)$/i);
    if (authorsMatch && metadata.authors.length === 0) {
      metadata.authors = normalizeAuthors(splitAuthorsLine(authorsMatch[1]));
      continue;
    }

    const publishedMatch = line.match(/^(published|date)\s*:\s*(.+)$/i);
    if (publishedMatch && !metadata.publishedRaw) {
      metadata.publishedRaw = cleanText(publishedMatch[2]);
      continue;
    }

    const venueMatch = line.match(/^(venue|journal|conference)\s*:\s*(.+)$/i);
    if (venueMatch && !metadata.venue) {
      metadata.venue = cleanText(venueMatch[2]);
      continue;
    }

    const doiMatch = line.match(/^doi\s*:\s*(.+)$/i);
    if (doiMatch && !metadata.doi) {
      metadata.doi = extractDoi(doiMatch[1]);
      continue;
    }

    const openreviewMatch = line.match(/^openreview paper id\s*:\s*(.+)$/i);
    if (openreviewMatch && !metadata.openreviewId) {
      metadata.openreviewId = cleanText(openreviewMatch[1]);
    }
  }

  if (!metadata.doi) metadata.doi = extractDoi(source);
  if (!metadata.arxivId) metadata.arxivId = parseArxivId(source);
  if (!metadata.openreviewId) metadata.openreviewId = parseOpenReviewId(source);
  return metadata;
}

function parseDatePartsFromCrossrefMessage(message = {}) {
  const candidates = [
    message.issued,
    message.published,
    message['published-print'],
    message['published-online'],
  ];

  for (const candidate of candidates) {
    const dateParts = candidate && candidate['date-parts'];
    if (!Array.isArray(dateParts) || !Array.isArray(dateParts[0])) continue;
    const parts = dateParts[0];
    const year = Number(parts[0]);
    if (!Number.isFinite(year)) continue;
    const month = Number.isFinite(Number(parts[1])) ? Number(parts[1]) : null;
    const day = Number.isFinite(Number(parts[2])) ? Number(parts[2]) : null;
    return { year, month, day };
  }

  return null;
}

function getConfidenceRank(confidence) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium') return 2;
  return 1;
}

function buildDocumentSignature(document) {
  const payload = JSON.stringify({
    id: document.id,
    title: document.title,
    type: document.type,
    originalUrl: document.originalUrl,
    notes: document.notes,
    updatedAt: document.updatedAt,
    createdAt: document.createdAt,
  });
  return crypto.createHash('sha1').update(payload).digest('hex');
}

function normalizeFormats(formatsInput) {
  if (!Array.isArray(formatsInput)) {
    return [...SUPPORTED_FORMATS];
  }
  const values = formatsInput;
  const normalized = values
    .map((format) => cleanText(format).toLowerCase())
    .filter((format) => SUPPORTED_FORMATS_SET.has(format));
  return [...new Set(normalized)];
}

function mergeMetadata(baseMetadata, incomingMetadata) {
  if (!incomingMetadata) return baseMetadata;
  const merged = { ...baseMetadata };

  const overwriteFields = ['title', 'venue', 'publisher', 'doi', 'url', 'arxivId', 'openreviewId', 'siteName', 'itemType'];
  for (const field of overwriteFields) {
    const value = cleanText(incomingMetadata[field]);
    if (value) merged[field] = value;
  }

  if (Array.isArray(incomingMetadata.authors) && incomingMetadata.authors.length > 0) {
    merged.authors = normalizeAuthors(incomingMetadata.authors);
  }

  const existingDatePrecision = datePrecision(merged.dateParts);
  const incomingDatePrecision = datePrecision(incomingMetadata.dateParts);
  if (incomingDatePrecision > existingDatePrecision) {
    merged.dateParts = incomingMetadata.dateParts;
  }

  const mergedConfidence = getConfidenceRank(incomingMetadata.confidence) >= getConfidenceRank(merged.confidence)
    ? cleanText(incomingMetadata.confidence)
    : merged.confidence;
  if (mergedConfidence) merged.confidence = mergedConfidence;

  const useIncomingSource = getConfidenceRank(incomingMetadata.confidence) >= getConfidenceRank(merged.confidence)
    || !cleanText(merged.sourceType)
    || cleanText(merged.sourceType) === 'document';
  if (useIncomingSource && cleanText(incomingMetadata.sourceType)) {
    merged.sourceType = cleanText(incomingMetadata.sourceType);
  }

  const warnings = [
    ...(Array.isArray(baseMetadata.warnings) ? baseMetadata.warnings : []),
    ...(Array.isArray(incomingMetadata.warnings) ? incomingMetadata.warnings : []),
  ];
  merged.warnings = [...new Set(warnings.filter(Boolean))];
  return merged;
}

function readMetaContent($, key, attr = 'name') {
  return cleanText($(`meta[${attr}="${key}"]`).first().attr('content'));
}

async function fetchJsonWithTimeout(url, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'auto-researcher/1.0',
        Accept: 'application/json',
        ...headers,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithTimeout(url, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,*/*',
        ...headers,
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const text = await response.text();
    return {
      text,
      contentType: response.headers.get('content-type') || '',
      finalUrl: response.url || url,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCrossrefMetadata(doi) {
  const normalizedDoi = cleanText(doi).toLowerCase();
  if (!normalizedDoi) return null;

  try {
    const payload = await fetchJsonWithTimeout(`https://api.crossref.org/works/${encodeURIComponent(normalizedDoi)}`);
    const message = payload?.message;
    if (!message || typeof message !== 'object') return null;

    const title = firstNonEmpty([
      Array.isArray(message.title) ? message.title[0] : '',
      message.title,
    ]);

    const authors = normalizeAuthors(
      Array.isArray(message.author)
        ? message.author.map((author) => firstNonEmpty([
            author.name,
            [author.given, author.family].filter(Boolean).join(' '),
          ]))
        : []
    );

    const venue = firstNonEmpty([
      Array.isArray(message['container-title']) ? message['container-title'][0] : '',
      Array.isArray(message['short-container-title']) ? message['short-container-title'][0] : '',
      message.publisher,
    ]);

    return {
      sourceType: 'crossref',
      confidence: 'high',
      itemType: 'paper',
      title,
      authors,
      venue,
      publisher: cleanText(message.publisher),
      dateParts: parseDatePartsFromCrossrefMessage(message),
      doi: cleanText(message.DOI || normalizedDoi).toLowerCase(),
      url: normalizeUrl(firstNonEmpty([message.URL, `https://doi.org/${normalizedDoi}`])),
    };
  } catch (error) {
    return {
      sourceType: 'crossref',
      confidence: 'low',
      warnings: [`crossref_lookup_failed:${error.message}`],
    };
  }
}

async function fetchArxivMetadata(arxivId) {
  const normalizedId = cleanText(arxivId);
  if (!normalizedId) return null;

  try {
    const metadata = await arxivService.fetchMetadata(normalizedId);
    return {
      sourceType: 'arxiv',
      confidence: 'high',
      itemType: 'paper',
      title: cleanText(metadata.title),
      authors: normalizeAuthors(metadata.authors || []),
      dateParts: parseDateParts(metadata.published),
      venue: metadata.primaryCategory ? `arXiv:${metadata.primaryCategory}` : 'arXiv',
      doi: '',
      arxivId: normalizedId,
      url: normalizeUrl(metadata.absUrl || arxivService.getAbsUrl(normalizedId)),
    };
  } catch (error) {
    return {
      sourceType: 'arxiv',
      confidence: 'low',
      warnings: [`arxiv_lookup_failed:${error.message}`],
    };
  }
}

async function fetchWebMetadata(url) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return null;

  try {
    const { text, contentType, finalUrl } = await fetchTextWithTimeout(normalizedUrl);
    const finalNormalizedUrl = normalizeUrl(finalUrl) || normalizedUrl;
    const typeLower = String(contentType || '').toLowerCase();

    if (!typeLower.includes('html')) {
      const fallbackTitle = decodeURIComponentSafe(new URL(finalNormalizedUrl).pathname.split('/').pop() || '');
      const looksLikePaper = /\.pdf(\?|$)/i.test(finalNormalizedUrl);
      return {
        sourceType: 'web',
        confidence: looksLikePaper ? 'medium' : 'low',
        itemType: looksLikePaper ? 'paper' : 'website',
        title: cleanText(fallbackTitle.replace(/[_-]/g, ' ')),
        authors: [],
        dateParts: null,
        venue: '',
        doi: extractDoi(finalNormalizedUrl),
        url: finalNormalizedUrl,
        siteName: getHostName(finalNormalizedUrl),
      };
    }

    const $ = cheerio.load(text);

    const citationTitle = readMetaContent($, 'citation_title');
    const title = firstNonEmpty([
      citationTitle,
      readMetaContent($, 'og:title', 'property'),
      readMetaContent($, 'twitter:title'),
      cleanText($('title').first().text()),
    ]);

    const citationAuthors = $('meta[name="citation_author"]')
      .map((_, element) => cleanText($(element).attr('content')))
      .get()
      .filter(Boolean);
    const genericAuthor = firstNonEmpty([
      readMetaContent($, 'author'),
      readMetaContent($, 'article:author', 'property'),
      readMetaContent($, 'twitter:creator'),
    ]);
    const authors = normalizeAuthors(citationAuthors.length ? citationAuthors : [genericAuthor]);

    const publishedRaw = firstNonEmpty([
      readMetaContent($, 'citation_publication_date'),
      readMetaContent($, 'citation_date'),
      readMetaContent($, 'article:published_time', 'property'),
      readMetaContent($, 'og:pubdate', 'property'),
      readMetaContent($, 'date'),
      readMetaContent($, 'pubdate'),
    ]);

    const doi = firstNonEmpty([
      extractDoi(readMetaContent($, 'citation_doi')),
      extractDoi(readMetaContent($, 'dc.identifier')),
      extractDoi(finalNormalizedUrl),
    ]);

    const venue = firstNonEmpty([
      readMetaContent($, 'citation_journal_title'),
      readMetaContent($, 'citation_conference_title'),
      readMetaContent($, 'citation_dissertation_institution'),
      readMetaContent($, 'og:site_name', 'property'),
    ]);

    const siteName = firstNonEmpty([
      readMetaContent($, 'og:site_name', 'property'),
      readMetaContent($, 'application-name'),
      getHostName(finalNormalizedUrl),
    ]);

    const canonicalHref = cleanText($('link[rel="canonical"]').first().attr('href'));
    let canonicalUrl = finalNormalizedUrl;
    if (canonicalHref) {
      try {
        canonicalUrl = new URL(canonicalHref, finalNormalizedUrl).href;
      } catch (_) {
        canonicalUrl = finalNormalizedUrl;
      }
    }

    const looksLikePaper = Boolean(
      citationTitle
      || readMetaContent($, 'citation_journal_title')
      || readMetaContent($, 'citation_conference_title')
      || doi
      || parseArxivId(finalNormalizedUrl)
      || parseOpenReviewId(finalNormalizedUrl)
    );

    return {
      sourceType: 'web',
      confidence: title ? 'medium' : 'low',
      itemType: looksLikePaper ? 'paper' : 'website',
      title,
      authors,
      dateParts: parseDateParts(publishedRaw),
      venue,
      doi,
      url: normalizeUrl(canonicalUrl) || finalNormalizedUrl,
      siteName,
      arxivId: parseArxivId(finalNormalizedUrl),
      openreviewId: parseOpenReviewId(finalNormalizedUrl),
    };
  } catch (error) {
    return {
      sourceType: 'web',
      confidence: 'low',
      warnings: [`web_lookup_failed:${error.message}`],
    };
  }
}

function buildBaseMetadata(document, notesMetadata) {
  const normalizedUrl = normalizeUrl(document.originalUrl);
  const arxivId = parseArxivId(normalizedUrl || notesMetadata.arxivId);
  const openreviewId = parseOpenReviewId(normalizedUrl || notesMetadata.openreviewId);
  const doi = firstNonEmpty([
    notesMetadata.doi,
    extractDoi(normalizedUrl),
    extractDoi(document.title),
  ]);
  const isPaper = String(document.type || '').toLowerCase() === 'paper' || !!arxivId || !!doi || !!openreviewId;
  const publishedFromNotes = parseDateParts(notesMetadata.publishedRaw);
  const publishedFromCreatedAt = parseDateParts(document.createdAt);

  return {
    itemType: isPaper ? 'paper' : 'website',
    sourceType: 'document',
    confidence: 'low',
    title: cleanText(document.title),
    authors: normalizeAuthors(notesMetadata.authors),
    dateParts: publishedFromNotes || publishedFromCreatedAt || null,
    venue: cleanText(notesMetadata.venue),
    publisher: '',
    doi,
    arxivId,
    openreviewId,
    url: normalizedUrl,
    siteName: getHostName(normalizedUrl),
    accessedDate: new Date().toISOString().slice(0, 10),
    warnings: [],
  };
}

async function resolveCitationMetadata(document) {
  const notesMetadata = extractMetadataFromNotes(document.notes);
  let metadata = buildBaseMetadata(document, notesMetadata);

  if (metadata.itemType === 'paper') {
    if (metadata.arxivId) {
      metadata = mergeMetadata(metadata, await fetchArxivMetadata(metadata.arxivId));
    }

    if (metadata.doi) {
      metadata = mergeMetadata(metadata, await fetchCrossrefMetadata(metadata.doi));
    }

    if (metadata.url && (metadata.sourceType === 'document' || getConfidenceRank(metadata.confidence) < 3)) {
      metadata = mergeMetadata(metadata, await fetchWebMetadata(metadata.url));
    }

    if (metadata.doi && metadata.sourceType !== 'crossref') {
      metadata = mergeMetadata(metadata, await fetchCrossrefMetadata(metadata.doi));
    }
  } else if (metadata.url) {
    metadata = mergeMetadata(metadata, await fetchWebMetadata(metadata.url));
  }

  if (!metadata.title) metadata.title = cleanText(document.title) || 'Untitled';
  if (!metadata.url && document.originalUrl) metadata.url = normalizeUrl(document.originalUrl);
  if (!metadata.siteName && metadata.url) metadata.siteName = getHostName(metadata.url);
  if (!metadata.dateParts) metadata.dateParts = parseDateParts(document.createdAt);
  if (!Array.isArray(metadata.authors)) metadata.authors = [];
  metadata.authors = normalizeAuthors(metadata.authors);

  if (!metadata.authors.length) metadata.warnings.push('authors_missing');
  if (!metadata.dateParts?.year) metadata.warnings.push('date_missing');
  if (!metadata.url) metadata.warnings.push('url_missing');
  metadata.warnings = [...new Set(metadata.warnings.filter(Boolean))];
  metadata.date = toIsoDate(metadata.dateParts);
  return metadata;
}

function splitName(name) {
  const normalized = normalizeAuthorName(name);
  if (!normalized) return { given: '', family: '', literal: '' };

  if (normalized.includes(',')) {
    const [familyPart, ...givenParts] = normalized.split(',');
    return {
      given: cleanText(givenParts.join(' ')),
      family: cleanText(familyPart),
      literal: normalized,
    };
  }

  const tokens = normalized.split(/\s+/);
  if (tokens.length === 1) {
    return { given: '', family: tokens[0], literal: normalized };
  }
  const family = tokens[tokens.length - 1];
  const given = tokens.slice(0, -1).join(' ');
  return { given, family, literal: normalized };
}

function toInitials(givenName) {
  const tokens = cleanText(givenName).split(/\s+/).filter(Boolean);
  if (!tokens.length) return '';
  return tokens.map((token) => `${token[0].toUpperCase()}.`).join(' ');
}

function formatApaAuthor(name) {
  const parts = splitName(name);
  if (!parts.family && !parts.given) return parts.literal || '';
  if (!parts.given) return parts.family || parts.literal;
  const initials = toInitials(parts.given);
  return `${parts.family}, ${initials}`.trim();
}

function formatApaAuthors(authors = []) {
  const formatted = normalizeAuthors(authors).map(formatApaAuthor).filter(Boolean);
  if (!formatted.length) return '';
  if (formatted.length === 1) return formatted[0];
  if (formatted.length === 2) return `${formatted[0]}, & ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(', ')}, & ${formatted[formatted.length - 1]}`;
}

function formatMlaPrimaryAuthor(name) {
  const parts = splitName(name);
  if (!parts.family && !parts.given) return parts.literal || '';
  if (!parts.given) return parts.family || parts.literal;
  return `${parts.family}, ${parts.given}`;
}

function formatMlaAuthors(authors = []) {
  const normalized = normalizeAuthors(authors);
  if (!normalized.length) return '';
  if (normalized.length === 1) return formatMlaPrimaryAuthor(normalized[0]);
  if (normalized.length === 2) return `${formatMlaPrimaryAuthor(normalized[0])}, and ${normalized[1]}`;
  return `${formatMlaPrimaryAuthor(normalized[0])}, et al.`;
}

function ensureTrailingPeriod(text) {
  const value = cleanText(text);
  if (!value) return '';
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function formatApaDate(dateParts) {
  if (!dateParts || !dateParts.year) return 'n.d.';
  if (dateParts.month && dateParts.day) {
    return `${dateParts.year}, ${MONTH_NAMES_LONG[dateParts.month - 1]} ${dateParts.day}`;
  }
  if (dateParts.month) {
    return `${dateParts.year}, ${MONTH_NAMES_LONG[dateParts.month - 1]}`;
  }
  return `${dateParts.year}`;
}

function formatMlaDate(dateParts) {
  if (!dateParts || !dateParts.year) return '';
  if (dateParts.month && dateParts.day) {
    return `${dateParts.day} ${MONTH_NAMES_SHORT[dateParts.month - 1]} ${dateParts.year}`;
  }
  if (dateParts.month) {
    return `${MONTH_NAMES_SHORT[dateParts.month - 1]} ${dateParts.year}`;
  }
  return `${dateParts.year}`;
}

function buildApaCitation(metadata) {
  const date = formatApaDate(metadata.dateParts);
  const title = ensureTrailingPeriod(metadata.title);
  const locator = metadata.doi ? `https://doi.org/${metadata.doi}` : cleanText(metadata.url);
  const authorPart = formatApaAuthors(metadata.authors);

  if (metadata.itemType === 'paper') {
    const pieces = [];
    if (authorPart) {
      pieces.push(authorPart);
      pieces.push(`(${date}).`);
      pieces.push(title);
    } else {
      pieces.push(title);
      pieces.push(`(${date}).`);
    }
    if (metadata.venue) pieces.push(ensureTrailingPeriod(metadata.venue));
    if (locator) pieces.push(locator);
    return cleanText(pieces.join(' '));
  }

  const websitePieces = [];
  const authorOrSite = authorPart || metadata.siteName || '';
  if (authorOrSite) websitePieces.push(authorOrSite);
  websitePieces.push(`(${date}).`);
  websitePieces.push(title);
  if (metadata.siteName && metadata.siteName !== authorOrSite) {
    websitePieces.push(ensureTrailingPeriod(metadata.siteName));
  }
  if (locator) websitePieces.push(locator);
  return cleanText(websitePieces.join(' '));
}

function buildMlaCitation(metadata) {
  const title = cleanText(metadata.title);
  const quotedTitle = title ? `"${title.replace(/[.]+$/, '')}."` : '';
  const locator = metadata.doi ? `https://doi.org/${metadata.doi}` : cleanText(metadata.url);
  const date = formatMlaDate(metadata.dateParts);
  const authorPart = formatMlaAuthors(metadata.authors);

  if (metadata.itemType === 'paper') {
    const pieces = [];
    if (authorPart) pieces.push(`${authorPart}.`);
    if (quotedTitle) pieces.push(quotedTitle);
    if (metadata.venue) pieces.push(`${metadata.venue},`);
    if (date) pieces.push(`${date},`);
    if (locator) pieces.push(locator);
    return ensureTrailingPeriod(cleanText(pieces.join(' ')).replace(/\s+,/g, ','));
  }

  const websitePieces = [];
  const authorOrSite = authorPart || metadata.siteName || '';
  if (authorOrSite) websitePieces.push(`${authorOrSite}.`);
  if (quotedTitle) websitePieces.push(quotedTitle);
  if (metadata.siteName && metadata.siteName !== authorOrSite) websitePieces.push(`${metadata.siteName},`);
  if (date) websitePieces.push(`${date},`);
  if (locator) websitePieces.push(`${locator}.`);
  if (metadata.accessedDate) {
    const accessedDate = formatMlaDate(parseDateParts(metadata.accessedDate));
    if (accessedDate) websitePieces.push(`Accessed ${accessedDate}.`);
  }
  return cleanText(websitePieces.join(' ')).replace(/\s+,/g, ',');
}

function escapeBibtex(value) {
  return cleanText(value).replace(/[{}]/g, '').replace(/\\/g, '\\\\');
}

function toBibtexAuthor(name) {
  const parts = splitName(name);
  if (!parts.family && !parts.given) return parts.literal || '';
  if (!parts.given) return parts.family || parts.literal;
  return `${parts.family}, ${parts.given}`;
}

function buildBibtexKey(metadata) {
  const firstAuthor = normalizeAuthors(metadata.authors)[0] || '';
  const firstAuthorParts = splitName(firstAuthor);
  const authorSeed = firstAuthorParts.family || 'ref';
  const yearSeed = metadata.dateParts?.year ? String(metadata.dateParts.year) : 'nd';
  const titleSeed = (cleanText(metadata.title).split(/\s+/)[0] || 'item');
  return `${authorSeed}${yearSeed}${titleSeed}`
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
}

function buildBibtexCitation(metadata) {
  const looksLikeArticle = metadata.itemType === 'paper' && (metadata.venue || metadata.doi);
  const entryType = looksLikeArticle ? 'article' : 'misc';
  const key = buildBibtexKey(metadata);
  const fields = [];

  if (metadata.title) fields.push(['title', `{${escapeBibtex(metadata.title)}}`]);
  if (Array.isArray(metadata.authors) && metadata.authors.length) {
    const authors = normalizeAuthors(metadata.authors).map(toBibtexAuthor).filter(Boolean).join(' and ');
    if (authors) fields.push(['author', `{${escapeBibtex(authors)}}`]);
  }
  if (looksLikeArticle && metadata.venue) fields.push(['journal', `{${escapeBibtex(metadata.venue)}}`]);
  if (metadata.dateParts?.year) fields.push(['year', `${metadata.dateParts.year}`]);
  if (metadata.doi) fields.push(['doi', `{${metadata.doi}}`]);
  if (metadata.arxivId) {
    fields.push(['eprint', `{${metadata.arxivId}}`]);
    fields.push(['archivePrefix', '{arXiv}']);
  }
  if (metadata.url) fields.push(['url', `{${metadata.url}}`]);
  if (metadata.itemType !== 'paper' && metadata.accessedDate) {
    fields.push(['note', `{Accessed: ${metadata.accessedDate}}`]);
  }

  const body = fields.map(([name, value]) => `  ${name} = ${value}`).join(',\n');
  return `@${entryType}{${key},\n${body}\n}`;
}

function buildCitations(metadata) {
  return {
    bibtex: buildBibtexCitation(metadata),
    apa: buildApaCitation(metadata),
    mla: buildMlaCitation(metadata),
  };
}

function safeJsonParse(rawText, fallback) {
  try {
    return JSON.parse(rawText);
  } catch (_) {
    return fallback;
  }
}

async function readCitationCache(userId, documentId) {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT document_signature, metadata_json, citations_json, source_type, updated_at
          FROM citation_cache
          WHERE user_id = ? AND document_id = ?
          LIMIT 1`,
    args: [userId, documentId],
  });
  return result.rows[0] || null;
}

async function writeCitationCache({
  userId,
  documentId,
  documentSignature,
  sourceType,
  metadata,
  citations,
}) {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO citation_cache (
            user_id, document_id, document_signature, source_type, metadata_json, citations_json
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, document_id) DO UPDATE SET
            document_signature = excluded.document_signature,
            source_type = excluded.source_type,
            metadata_json = excluded.metadata_json,
            citations_json = excluded.citations_json,
            updated_at = CURRENT_TIMESTAMP`,
    args: [
      userId,
      documentId,
      documentSignature,
      cleanText(sourceType) || 'document',
      JSON.stringify(metadata || {}),
      JSON.stringify(citations || {}),
    ],
  });
}

function pickCitations(citations, formats) {
  const result = {};
  for (const format of formats) {
    result[format] = typeof citations?.[format] === 'string'
      ? citations[format]
      : '';
  }
  return result;
}

function sanitizeMetadataForResponse(metadata) {
  return {
    title: cleanText(metadata.title),
    authors: Array.isArray(metadata.authors) ? metadata.authors : [],
    date: cleanText(metadata.date || toIsoDate(metadata.dateParts)),
    venue: cleanText(metadata.venue),
    doi: cleanText(metadata.doi),
    url: cleanText(metadata.url),
    sourceType: cleanText(metadata.sourceType),
    warnings: Array.isArray(metadata.warnings) ? metadata.warnings : [],
  };
}

async function generateCitationForDocument({
  userId,
  document,
  formats,
  forceRefresh = false,
}) {
  const normalizedFormats = normalizeFormats(formats);
  const signature = buildDocumentSignature(document);
  const cacheRow = await readCitationCache(userId, document.id);

  if (!forceRefresh && cacheRow && cleanText(cacheRow.document_signature) === signature) {
    const cachedMetadata = safeJsonParse(cacheRow.metadata_json, {});
    const cachedCitations = safeJsonParse(cacheRow.citations_json, {});
    return {
      documentId: document.id,
      title: document.title,
      type: document.type,
      itemType: cleanText(cachedMetadata.itemType) || (document.type === 'paper' ? 'paper' : 'website'),
      sourceType: cleanText(cacheRow.source_type) || cleanText(cachedMetadata.sourceType) || 'cache',
      cached: true,
      cacheUpdatedAt: cacheRow.updated_at,
      metadata: sanitizeMetadataForResponse(cachedMetadata),
      citations: pickCitations(cachedCitations, normalizedFormats),
    };
  }

  let metadata;
  try {
    metadata = await resolveCitationMetadata(document);
  } catch (error) {
    const fallbackMeta = buildBaseMetadata(document, extractMetadataFromNotes(document.notes));
    fallbackMeta.warnings = [...new Set([...(fallbackMeta.warnings || []), `generation_failed:${error.message}`])];
    metadata = fallbackMeta;
  }

  const citations = buildCitations(metadata);
  await writeCitationCache({
    userId,
    documentId: document.id,
    documentSignature: signature,
    sourceType: metadata.sourceType || 'document',
    metadata,
    citations,
  });

  return {
    documentId: document.id,
    title: document.title,
    type: document.type,
    itemType: metadata.itemType || (document.type === 'paper' ? 'paper' : 'website'),
    sourceType: metadata.sourceType || 'document',
    cached: false,
    cacheUpdatedAt: null,
    metadata: sanitizeMetadataForResponse(metadata),
    citations: pickCitations(citations, normalizedFormats),
  };
}

async function generateCitationsForDocuments({
  userId,
  documents = [],
  formats = [],
  forceRefresh = false,
}) {
  const normalizedFormats = normalizeFormats(formats);
  const results = [];

  // Process documents one-by-one in sequence to avoid mixed provenance and keep
  // deterministic cache behavior per item.
  for (const document of documents) {
    const citation = await generateCitationForDocument({
      userId,
      document,
      formats: normalizedFormats,
      forceRefresh,
    });
    results.push(citation);
  }

  const cachedCount = results.filter((item) => item.cached).length;
  return {
    formats: normalizedFormats,
    items: results,
    stats: {
      total: results.length,
      cached: cachedCount,
      generated: results.length - cachedCount,
    },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  SUPPORTED_FORMATS,
  normalizeFormats,
  generateCitationForDocument,
  generateCitationsForDocuments,
};
