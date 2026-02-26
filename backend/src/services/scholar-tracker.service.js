/**
 * Google Scholar email alerts tracker
 * Connects to Gmail via IMAP and extracts paper arXiv IDs
 * from Google Scholar alert emails (scholaralerts-noreply@google.com)
 *
 * Credentials are resolved from backend environment variables by default:
 *   - SCHOLAR_GMAIL_EMAIL (or SCHOLAR_EMAIL / GMAIL_EMAIL / GMAIL_NAME)
 *   - SCHOLAR_GMAIL_APP_PASSWORD (or SCHOLAR_APP_PASSWORD / GMAIL_APP_PASSWORD / GMAIL_PASSWORD)
 * Config payload no longer needs email/password from frontend.
 */

let ImapFlow, simpleParser, cheerio;
try {
  ImapFlow = require('imapflow').ImapFlow;
  simpleParser = require('mailparser').simpleParser;
  cheerio = require('cheerio');
} catch (e) {
  // Dependencies not installed yet; handled gracefully in getNewPapers()
}

const SCHOLAR_SENDER = 'scholaralerts-noreply@google.com';
const DEFAULT_IMAP_CONNECT_TIMEOUT_MS = 15000;
const DEFAULT_IMAP_SOCKET_TIMEOUT_MS = 30000;
const DEFAULT_GMAIL_API_TIMEOUT_MS = 15000;

function firstNonEmpty(...values) {
  for (const value of values) {
    const v = String(value || '').trim();
    if (v) return v;
  }
  return '';
}

function normalizeEmail(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value.includes('@')) return value;
  return `${value}@gmail.com`;
}

function resolveScholarCredentials(config = {}) {
  const emailRaw = firstNonEmpty(
    config.email,
    process.env.SCHOLAR_GMAIL_EMAIL,
    process.env.SCHOLAR_EMAIL,
    process.env.GMAIL_EMAIL,
    process.env.GMAIL_USER,
    process.env.GMAIL_USERNAME,
    process.env.GMAIL_NAME
  );
  const password = firstNonEmpty(
    config.password,
    process.env.SCHOLAR_GMAIL_APP_PASSWORD,
    process.env.SCHOLAR_APP_PASSWORD,
    process.env.GMAIL_APP_PASSWORD,
    process.env.GMAIL_PASSWORD
  );
  return {
    email: normalizeEmail(emailRaw),
    password,
  };
}

function resolveScholarOAuthConfig(config = {}) {
  return {
    clientId: firstNonEmpty(config.gmailClientId, process.env.SCHOLAR_GMAIL_CLIENT_ID),
    clientSecret: firstNonEmpty(config.gmailClientSecret, process.env.SCHOLAR_GMAIL_CLIENT_SECRET),
    refreshToken: firstNonEmpty(config.gmailRefreshToken, process.env.SCHOLAR_GMAIL_REFRESH_TOKEN),
    query: firstNonEmpty(config.gmailQuery, process.env.SCHOLAR_GMAIL_QUERY, `from:${SCHOLAR_SENDER} is:unread`),
  };
}

function hasScholarOAuthConfig(config = {}) {
  const oauth = resolveScholarOAuthConfig(config);
  return !!(oauth.clientId && oauth.clientSecret && oauth.refreshToken);
}

function decodeBase64Url(raw) {
  const normalized = String(raw || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

async function fetchGmailAccessToken({ clientId, clientSecret, refreshToken }, timeoutMs) {
  const payload = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload.toString(),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.access_token) {
      throw new Error(json.error_description || json.error || `oauth_token_http_${response.status}`);
    }
    return json.access_token;
  } finally {
    clearTimeout(timer);
  }
}

async function gmailApiRequest(path, accessToken, { method = 'GET', body, timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(json.error?.message || `gmail_api_http_${response.status}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function getNewPapersViaGmailApi(config = {}) {
  const { markRead = true, maxEmails = 20 } = config;
  const timeoutRaw = parseInt(config.gmailApiTimeoutMs, 10);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.max(5000, Math.min(timeoutRaw, 120000))
    : DEFAULT_GMAIL_API_TIMEOUT_MS;
  const oauth = resolveScholarOAuthConfig(config);
  if (!oauth.clientId || !oauth.clientSecret || !oauth.refreshToken) {
    throw new Error('Scholar OAuth config missing in backend .env');
  }

  const accessToken = await fetchGmailAccessToken(oauth, timeoutMs);
  const safeMax = Number.isFinite(parseInt(maxEmails, 10))
    ? Math.max(1, Math.min(parseInt(maxEmails, 10), 200))
    : 20;

  const list = await gmailApiRequest(
    `messages?q=${encodeURIComponent(oauth.query)}&maxResults=${safeMax}`,
    accessToken,
    { timeoutMs }
  );
  const messages = Array.isArray(list.messages) ? list.messages : [];

  if (messages.length === 0) {
    console.log('[ScholarTracker] No unread Scholar alert emails found (Gmail API)');
    return [];
  }

  console.log(`[ScholarTracker] Processing ${messages.length} Scholar alert email(s) via Gmail API`);
  const papers = [];
  for (const message of messages) {
    try {
      const detail = await gmailApiRequest(`messages/${message.id}?format=raw`, accessToken, { timeoutMs });
      if (!detail?.raw) continue;
      const parsed = await simpleParser(decodeBase64Url(detail.raw));
      const html = parsed.html || parsed.textAsHtml || parsed.text || '';
      const found = parseScholarEmail(html);
      papers.push(...found);

      if (markRead) {
        await gmailApiRequest(
          `messages/${message.id}/modify`,
          accessToken,
          { method: 'POST', body: { removeLabelIds: ['UNREAD'] }, timeoutMs }
        );
      }
    } catch (e) {
      console.warn(`[ScholarTracker] Failed to parse Gmail API message ${message.id}: ${e.message}`);
    }
  }

  const seen = new Set();
  return papers.filter((p) => {
    if (seen.has(p.arxivId)) return false;
    seen.add(p.arxivId);
    return true;
  });
}

// Extract arXiv ID from any URL string
function extractArxivId(url) {
  const m = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
  return m ? m[1].replace(/v\d+$/, '') : null;
}

// Follow Google Scholar redirect URL to get the real URL
// Redirect URLs look like: https://scholar.google.com/scholar_url?url=https://arxiv.org/...&...
function extractRealUrl(redirectUrl) {
  try {
    const u = new URL(redirectUrl);
    const realUrl = u.searchParams.get('url');
    return realUrl || redirectUrl;
  } catch (_) {
    return redirectUrl;
  }
}

/**
 * Parse a single Scholar alert email HTML body and extract papers
 * @param {string} html - Email HTML body
 * @returns {Array} Array of { arxivId, title, url }
 */
function parseScholarEmail(html) {
  if (!cheerio) return [];
  const $ = cheerio.load(html);
  const papers = [];

  // Each paper in Scholar alert has an <h3> with a link titled gse_alrt_title
  $('h3').each((_, el) => {
    const link = $(el).find('a').first();
    if (!link.length) return;

    const title = link.text().trim();
    const href = link.attr('href') || '';
    const realUrl = extractRealUrl(href);
    const arxivId = extractArxivId(realUrl);

    if (arxivId) {
      papers.push({ arxivId, title, url: realUrl });
    } else if (realUrl.includes('arxiv')) {
      // Might be a different arxiv URL format — include for logging
      console.log(`[ScholarTracker] Non-standard arXiv URL: ${realUrl}`);
    }
  });

  return papers;
}

/**
 * Fetch unread Scholar alert emails and extract paper arXiv IDs
 * @param {Object} config - { email, password, markRead, maxEmails }
 * @returns {Promise<Array>} Array of paper objects
 */
async function getNewPapers(config = {}) {
  if (hasScholarOAuthConfig(config)) {
    if (!simpleParser || !cheerio) {
      throw new Error(
        'Scholar tracker requires mailparser and cheerio. Run: npm install mailparser cheerio'
      );
    }
    return getNewPapersViaGmailApi(config);
  }

  if (!ImapFlow || !simpleParser || !cheerio) {
    throw new Error(
      'Scholar tracker requires imapflow, mailparser, and cheerio. ' +
      'Run: npm install imapflow mailparser cheerio'
    );
  }

  const { markRead = true, maxEmails = 20 } = config;
  const { email, password } = resolveScholarCredentials(config);
  const connectTimeoutMsRaw = parseInt(config.connectTimeoutMs, 10);
  const socketTimeoutMsRaw = parseInt(config.socketTimeoutMs, 10);
  const connectTimeoutMs = Number.isFinite(connectTimeoutMsRaw)
    ? Math.max(5000, Math.min(connectTimeoutMsRaw, 120000))
    : DEFAULT_IMAP_CONNECT_TIMEOUT_MS;
  const socketTimeoutMs = Number.isFinite(socketTimeoutMsRaw)
    ? Math.max(10000, Math.min(socketTimeoutMsRaw, 300000))
    : DEFAULT_IMAP_SOCKET_TIMEOUT_MS;

  if (!email || !password) {
    throw new Error(
      'Scholar credentials missing: set SCHOLAR_GMAIL_EMAIL and SCHOLAR_GMAIL_APP_PASSWORD in backend .env'
    );
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: email, pass: password },
    connectionTimeout: connectTimeoutMs,
    socketTimeout: socketTimeoutMs,
    logger: false,
  });

  // Prevent unhandled 'error' event from crashing the process on socket timeout.
  // The error still propagates via promise rejection in the try block below.
  client.on('error', () => {});

  const papers = [];

  try {
    await client.connect();

    await client.mailboxOpen('INBOX');

    // Search for unread Scholar alert emails
    const uids = await client.search({
      unseen: true,
      from: SCHOLAR_SENDER,
    });

    if (uids.length === 0) {
      console.log('[ScholarTracker] No unread Scholar alert emails found');
      return [];
    }

    const toProcess = uids.slice(0, maxEmails);
    console.log(`[ScholarTracker] Processing ${toProcess.length} Scholar alert email(s)`);

    for await (const message of client.fetch(toProcess, { source: true })) {
      try {
        const parsed = await simpleParser(message.source);
        const html = parsed.html || '';
        const found = parseScholarEmail(html);
        papers.push(...found);

        if (markRead) {
          await client.messageFlagsAdd(message.uid, ['\\Seen'], { uid: true });
        }
      } catch (e) {
        console.warn(`[ScholarTracker] Failed to parse email UID ${message.uid}: ${e.message}`);
      }
    }

  } finally {
    await client.logout().catch(() => {});
  }

  // Deduplicate by arxivId
  const seen = new Set();
  return papers.filter((p) => {
    if (seen.has(p.arxivId)) return false;
    seen.add(p.arxivId);
    return true;
  });
}

module.exports = { getNewPapers, parseScholarEmail };
