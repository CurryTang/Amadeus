/**
 * Google Scholar email alerts tracker
 * Connects to Gmail via IMAP and extracts paper arXiv IDs
 * from Google Scholar alert emails (scholaralerts-noreply@google.com)
 *
 * Requires config:
 *   email    - Gmail address
 *   password - Gmail app password (not main password)
 *              Create at: https://myaccount.google.com/apppasswords
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
  if (!ImapFlow || !simpleParser || !cheerio) {
    throw new Error(
      'Scholar tracker requires imapflow, mailparser, and cheerio. ' +
      'Run: npm install imapflow mailparser cheerio'
    );
  }

  const { email, password, markRead = true, maxEmails = 20 } = config;

  if (!email || !password) {
    throw new Error('Scholar tracker requires email and password in config');
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: email, pass: password },
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
