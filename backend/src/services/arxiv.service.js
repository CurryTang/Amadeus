const https = require('https');
const http = require('http');

/**
 * Parse arXiv URL to extract paper ID
 * Supports formats:
 * - https://arxiv.org/abs/2505.10960
 * - https://arxiv.org/pdf/2505.10960
 * - https://arxiv.org/abs/2505.10960v1
 * - https://arxiv.org/pdf/2505.10960v2.pdf
 * @param {string} url - arXiv URL
 * @returns {string|null} Paper ID or null if not an arXiv URL
 */
function parseArxivUrl(url) {
  const patterns = [
    /arxiv\.org\/abs\/(\d+\.\d+(?:v\d+)?)/i,
    /arxiv\.org\/pdf\/(\d+\.\d+(?:v\d+)?)/i,
    /arxiv\.org\/abs\/([a-z-]+\/\d+(?:v\d+)?)/i,
    /arxiv\.org\/pdf\/([a-z-]+\/\d+(?:v\d+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return match[1].replace('.pdf', '');
    }
  }

  return null;
}

/**
 * Check if URL is an arXiv URL
 * @param {string} url - URL to check
 * @returns {boolean}
 */
function isArxivUrl(url) {
  return /arxiv\.org\/(abs|pdf)\//.test(url);
}

/**
 * Get the PDF download URL for an arXiv paper
 * @param {string} paperId - arXiv paper ID
 * @returns {string}
 */
function getPdfUrl(paperId) {
  return `https://arxiv.org/pdf/${paperId}.pdf`;
}

/**
 * Get the abstract page URL for an arXiv paper
 * @param {string} paperId - arXiv paper ID
 * @returns {string}
 */
function getAbsUrl(paperId) {
  return `https://arxiv.org/abs/${paperId}`;
}

/**
 * Fetch paper metadata from arXiv API
 * @param {string} paperId - arXiv paper ID
 * @returns {Promise<{title: string, authors: string[], abstract: string, categories: string[], published: string}>}
 */
async function fetchMetadata(paperId) {
  const apiUrl = `https://export.arxiv.org/api/query?id_list=${paperId}`;

  return new Promise((resolve, reject) => {
    const request = https.get(apiUrl, (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        reject(new Error(`arXiv metadata request failed: HTTP ${response.statusCode}`));
        return;
      }
      let data = '';

      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', () => {
        try {
          // Parse the first <entry> block to avoid picking feed-level metadata.
          const entryMatch = data.match(/<entry>([\s\S]*?)<\/entry>/);
          const entryXml = entryMatch ? entryMatch[1] : data;

          const titleMatch = entryXml.match(/<title>([\s\S]*?)<\/title>/);
          const title = titleMatch && titleMatch[1]
            ? titleMatch[1].trim().replace(/\s+/g, ' ')
            : `arXiv:${paperId}`;

          const authorsMatch = entryXml.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g);
          const authors = authorsMatch
            ? authorsMatch.map(a => {
                const nameMatch = a.match(/<name>([\s\S]*?)<\/name>/);
                return nameMatch ? nameMatch[1].trim() : '';
              }).filter(Boolean)
            : [];

          const abstractMatch = entryXml.match(/<summary>([\s\S]*?)<\/summary>/);
          const abstract = abstractMatch
            ? abstractMatch[1].trim().replace(/\s+/g, ' ')
            : '';

          const categoryMatch = entryXml.match(/<arxiv:primary_category[^>]*term="([^"]+)"/);
          const primaryCategory = categoryMatch ? categoryMatch[1] : '';

          const publishedMatch = entryXml.match(/<published>([\s\S]*?)<\/published>/);
          const published = publishedMatch ? publishedMatch[1].trim() : '';

          resolve({
            id: paperId,
            title,
            authors,
            abstract,
            primaryCategory,
            published,
            pdfUrl: getPdfUrl(paperId),
            absUrl: getAbsUrl(paperId),
          });
        } catch (error) {
          reject(new Error('Failed to parse arXiv metadata'));
        }
      });

      response.on('error', reject);
    });

    request.on('error', reject);
    request.setTimeout(15000, () => {
      request.destroy(new Error('arXiv metadata request timeout'));
    });
  });
}

/**
 * Fetch PDF buffer from arXiv
 * @param {string} paperId - arXiv paper ID
 * @returns {Promise<Buffer>}
 */
async function fetchPdf(paperId) {
  const pdfUrl = getPdfUrl(paperId);

  const fetchWithRedirect = (url, redirectCount = 0) => {
    return new Promise((resolve, reject) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/pdf,*/*',
        },
      };

      const request = https.get(url, options, (response) => {
        // Handle redirects
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303 || response.statusCode === 307) {
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error('Redirect without location header'));
            return;
          }
          // Handle relative URLs
          const fullUrl = redirectUrl.startsWith('http') ? redirectUrl : `https://arxiv.org${redirectUrl}`;
          console.log(`Redirecting to: ${fullUrl}`);
          fetchWithRedirect(fullUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to fetch PDF: HTTP ${response.statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          // Verify it's a PDF (starts with %PDF)
          if (buffer.length > 4 && buffer.slice(0, 4).toString() === '%PDF') {
            resolve(buffer);
          } else {
            reject(new Error('Downloaded file is not a valid PDF'));
          }
        });
        response.on('error', reject);
      });

      request.on('error', reject);
      request.setTimeout(120000, () => {
        request.destroy();
        reject(new Error('PDF download timeout'));
      });
    });
  };

  return fetchWithRedirect(pdfUrl);
}

/**
 * Try to find code repository URL for an arXiv paper
 * Uses Papers with Code API and abstract parsing
 * @param {string} paperId - arXiv paper ID
 * @param {string} abstract - Paper abstract (optional)
 * @returns {Promise<string|null>} - GitHub URL or null
 */
async function findCodeUrl(paperId, abstract = '') {
  // Method 1: Try Papers with Code API
  try {
    const pwcUrl = `https://paperswithcode.com/api/v1/papers/?arxiv_id=${paperId}`;
    const codeUrl = await new Promise((resolve) => {
      https.get(pwcUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      }, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.results && result.results.length > 0) {
              const paper = result.results[0];
              // Get the repository URL if available
              if (paper.repository_url) {
                resolve(paper.repository_url);
                return;
              }
            }
            resolve(null);
          } catch {
            resolve(null);
          }
        });
        response.on('error', () => resolve(null));
      }).on('error', () => resolve(null));
    });

    if (codeUrl) {
      console.log(`[arXiv] Found code URL via Papers with Code: ${codeUrl}`);
      return codeUrl;
    }

    // Try to get repo from paper's repos endpoint
    const reposUrl = `https://paperswithcode.com/api/v1/papers/${paperId}/repositories/`;
    const repoUrl = await new Promise((resolve) => {
      https.get(reposUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      }, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.results && result.results.length > 0) {
              // Get the first official or most starred repo
              const official = result.results.find(r => r.is_official);
              const repo = official || result.results[0];
              if (repo && repo.url) {
                resolve(repo.url);
                return;
              }
            }
            resolve(null);
          } catch {
            resolve(null);
          }
        });
        response.on('error', () => resolve(null));
      }).on('error', () => resolve(null));
    });

    if (repoUrl) {
      console.log(`[arXiv] Found code URL via PWC repos: ${repoUrl}`);
      return repoUrl;
    }
  } catch (error) {
    console.log(`[arXiv] Papers with Code API error: ${error.message}`);
  }

  // Method 2: Extract GitHub links from abstract
  if (abstract) {
    const githubPattern = /https?:\/\/github\.com\/[\w-]+\/[\w.-]+/gi;
    const matches = abstract.match(githubPattern);
    if (matches && matches.length > 0) {
      const githubUrl = matches[0].replace(/\.+$/, ''); // Remove trailing dots
      console.log(`[arXiv] Found code URL in abstract: ${githubUrl}`);
      return githubUrl;
    }
  }

  return null;
}

/**
 * Search arXiv for papers by author name.
 * Uses the arXiv Atom API with the `au:` field prefix.
 * Results are filtered to the given lookback window.
 *
 * @param {string} authorName - Full name (e.g. "Yann LeCun") or LastName_FirstInitial
 * @param {{ maxResults?: number, lookbackDays?: number }} options
 * @returns {Promise<Array<{arxivId, title, authors, abstract, published, publishedAt}>>}
 */
async function searchByAuthor(authorName, { maxResults = 10, lookbackDays = 30 } = {}) {
  const trimmed = String(authorName || '').trim();
  if (!trimmed) return [];

  // Quoted full-name search is more precise than the LastName_Initial format
  const query = `au:"${trimmed}"`;
  const safeMax = Math.min(Math.max(1, maxResults), 50);
  const apiUrl = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(query)}&sortBy=submittedDate&sortOrder=descending&max_results=${safeMax}&start=0`;
  const cutoffMs = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

  return new Promise((resolve, reject) => {
    const request = https.get(apiUrl, (response) => {
      if (response.statusCode && response.statusCode >= 400) {
        reject(new Error(`arXiv author search failed: HTTP ${response.statusCode}`));
        return;
      }
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        try {
          const papers = [];
          const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
          let match;
          // eslint-disable-next-line no-cond-assign
          while ((match = entryRegex.exec(data)) !== null) {
            const xml = match[1];
            const idMatch = xml.match(/<id>([\s\S]*?)<\/id>/);
            const arxivId = idMatch ? parseArxivUrl(idMatch[1].trim()) : null;
            if (!arxivId) continue;

            const publishedMatch = xml.match(/<published>([\s\S]*?)<\/published>/);
            const published = publishedMatch ? publishedMatch[1].trim() : '';
            if (published && new Date(published).getTime() < cutoffMs) continue;

            const titleMatch = xml.match(/<title>([\s\S]*?)<\/title>/);
            const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : '';

            const authorsXml = xml.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g) || [];
            const authors = authorsXml.map((a) => {
              const nm = a.match(/<name>([\s\S]*?)<\/name>/);
              return nm ? nm[1].trim() : '';
            }).filter(Boolean);

            const abstractMatch = xml.match(/<summary>([\s\S]*?)<\/summary>/);
            const abstract = abstractMatch ? abstractMatch[1].trim().replace(/\s+/g, ' ') : '';

            papers.push({ arxivId, title, authors, abstract, published, publishedAt: published });
          }
          resolve(papers);
        } catch (error) {
          reject(new Error('Failed to parse arXiv author search results'));
        }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(20000, () => {
      request.destroy(new Error('arXiv author search timeout'));
    });
  });
}

module.exports = {
  parseArxivUrl,
  isArxivUrl,
  getPdfUrl,
  getAbsUrl,
  fetchMetadata,
  fetchPdf,
  findCodeUrl,
  searchByAuthor,
};
