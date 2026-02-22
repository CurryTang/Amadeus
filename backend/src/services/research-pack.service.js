const archiver = require('archiver');
const https = require('https');
const s3Service = require('./s3.service');
const arxivService = require('./arxiv.service');
const mathpixService = require('./mathpix.service');

/**
 * Research Pack Service
 *
 * Assembles a ZIP archive containing a paper's source (PDF or LaTeX),
 * associated code repository, and AI-generated notes as a portable
 * "knowledge repo" for offline study.
 */

/**
 * Fetch LaTeX source from arXiv e-print endpoint
 * @param {string} arxivId - arXiv paper ID
 * @returns {Promise<Buffer>}
 */
function fetchArxivSource(arxivId) {
  const url = `https://arxiv.org/e-print/${arxivId}`;

  const fetchWithRedirect = (targetUrl, redirectCount = 0) => {
    return new Promise((resolve, reject) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      https.get(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
        },
      }, (response) => {
        if ([301, 302, 303, 307].includes(response.statusCode)) {
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error('Redirect without location header'));
            return;
          }
          const fullUrl = redirectUrl.startsWith('http') ? redirectUrl : `https://arxiv.org${redirectUrl}`;
          fetchWithRedirect(fullUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to fetch LaTeX source: HTTP ${response.statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      }).on('error', reject);
    });
  };

  return fetchWithRedirect(url);
}

/**
 * Parse a GitHub URL to extract owner and repo
 * @param {string} codeUrl - GitHub URL
 * @returns {{ owner: string, repo: string } | null}
 */
function parseGitHubUrl(codeUrl) {
  const match = codeUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

/**
 * Fetch a GitHub repository as a ZIP archive
 * Tries main branch first, then falls back to master
 * @param {string} codeUrl - GitHub repo URL
 * @returns {Promise<{ buffer: Buffer, repoName: string }>}
 */
async function fetchGitHubRepoZip(codeUrl) {
  const parsed = parseGitHubUrl(codeUrl);
  if (!parsed) {
    throw new Error(`Not a valid GitHub URL: ${codeUrl}`);
  }

  const { owner, repo } = parsed;
  const branches = ['main', 'master'];

  for (const branch of branches) {
    const url = `https://github.com/${owner}/${repo}/archive/refs/heads/${branch}.zip`;
    try {
      const buffer = await fetchUrl(url);
      return { buffer, repoName: `${repo}-${branch}` };
    } catch (err) {
      if (branch === branches[branches.length - 1]) {
        throw new Error(`Failed to download code repo (tried main/master): ${err.message}`);
      }
      // Try next branch
    }
  }
}

/**
 * Generic URL fetcher with redirect support
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
function fetchUrl(url) {
  const fetchWithRedirect = (targetUrl, redirectCount = 0) => {
    return new Promise((resolve, reject) => {
      if (redirectCount > 10) {
        reject(new Error('Too many redirects'));
        return;
      }

      const request = https.get(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
        },
      }, (response) => {
        if ([301, 302, 303, 307].includes(response.statusCode)) {
          const redirectUrl = response.headers.location;
          if (!redirectUrl) {
            reject(new Error('Redirect without location header'));
            return;
          }
          const fullUrl = redirectUrl.startsWith('http') ? redirectUrl : new URL(redirectUrl, targetUrl).href;
          fetchWithRedirect(fullUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      });

      request.on('error', reject);
      request.setTimeout(120000, () => {
        request.destroy();
        reject(new Error('Download timeout'));
      });
    });
  };

  return fetchWithRedirect(url);
}

/**
 * Generate a README.md with paper metadata
 * @param {Object} document - Document object
 * @param {Object} options - Pack options
 * @returns {string}
 */
function generateReadme(document, options) {
  const lines = [
    `# ${document.title}`,
    '',
    `> Research knowledge pack generated on ${new Date().toISOString().split('T')[0]}`,
    '',
    '## Paper Info',
    '',
  ];

  if (document.originalUrl) {
    lines.push(`- **URL**: ${document.originalUrl}`);
  }
  lines.push(`- **Source**: ${options.sourceType === 'latex' ? 'LaTeX source (arXiv e-print)' : 'PDF'}`);
  if (document.codeUrl) {
    lines.push(`- **Code**: ${document.codeUrl}`);
  }
  if (document.tags && document.tags.length > 0) {
    lines.push(`- **Tags**: ${document.tags.join(', ')}`);
  }

  lines.push('', '## Contents', '');

  if (options.sourceType === 'latex') {
    lines.push('- `latex_source.tar.gz` - LaTeX source files from arXiv');
  } else {
    lines.push('- `paper.pdf` - Paper PDF');
  }

  if (options.includeCode && document.codeUrl) {
    lines.push('- `code/` - Associated code repository');
  }

  lines.push('- `notes/` - AI-generated analysis notes (if available)');

  return lines.join('\n') + '\n';
}

/**
 * Check if a URL is a direct PDF link
 * @param {string} url
 * @returns {boolean}
 */
function isDirectPdfUrl(url) {
  if (!url) return false;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith('.pdf');
  } catch (_) {
    return false;
  }
}

/**
 * Get PDF buffer for a document - tries S3 first, then direct URL download
 * @param {Object} doc - Document with s3Key and originalUrl
 * @returns {Promise<Buffer>}
 */
async function getDocPdfBuffer(doc) {
  if (doc.s3Key) {
    return s3Service.downloadBuffer(doc.s3Key);
  }
  if (isDirectPdfUrl(doc.originalUrl)) {
    console.log(`[ResearchPack] No S3 key, fetching PDF directly from ${doc.originalUrl}`);
    return fetchUrl(doc.originalUrl);
  }
  throw new Error('No PDF source available (no S3 key and no direct PDF URL)');
}

/**
 * Check if a document has any PDF source available
 * @param {Object} doc
 * @returns {boolean}
 */
function hasPdfSource(doc) {
  return !!(doc.s3Key || isDirectPdfUrl(doc.originalUrl));
}

/**
 * Convert a PDF to LaTeX via Mathpix, with fallback to raw PDF
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {string} prefix - Archive path prefix
 * @param {string} title - Document title for logging
 * @param {archiver.Archiver} archive - Archive to append to
 * @returns {Promise<void>}
 */
async function mathpixLatexFallback(pdfBuffer, prefix, title, archive) {
  if (!mathpixService.isConfigured()) {
    console.warn(`[ResearchPack] Mathpix not configured, using PDF for "${title}"`);
    archive.append(pdfBuffer, { name: `${prefix}/paper.pdf` });
    return;
  }

  try {
    const { buffer } = await mathpixService.convertPdfToLatex(pdfBuffer, 15);
    archive.append(buffer, { name: `${prefix}/latex_source_mathpix.tex.zip` });
    console.log(`[ResearchPack] Added Mathpix LaTeX for "${title}" (${buffer.length} bytes)`);
  } catch (err) {
    console.warn(`[ResearchPack] Mathpix failed for "${title}": ${err.message}, using PDF`);
    archive.append(pdfBuffer, { name: `${prefix}/paper.pdf` });
  }
}

/**
 * Create a research knowledge pack as a ZIP archive stream
 * @param {Object} document - Full document object from DB
 * @param {Object} options
 * @param {string} options.sourceType - 'pdf' | 'latex'
 * @param {boolean} options.includeCode - whether to include code repo
 * @param {boolean} options.useMathpix - use Mathpix for non-arXiv LaTeX conversion
 * @returns {Promise<{ archive: archiver.Archiver, prefix: string }>}
 */
async function createResearchPack(document, options = {}) {
  const { sourceType = 'pdf', includeCode = true, useMathpix = false } = options;

  const sanitizedTitle = document.title
    .replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 60);
  const prefix = `${sanitizedTitle}_research`;

  const archive = archiver('zip', { zlib: { level: 6 } });

  // Collect all content in parallel where possible
  const tasks = [];

  // 1. Paper source
  if (sourceType === 'latex') {
    const arxivId = arxivService.parseArxivUrl(document.originalUrl);
    if (arxivId) {
      tasks.push(
        fetchArxivSource(arxivId)
          .then((buffer) => {
            archive.append(buffer, { name: `${prefix}/latex_source.tar.gz` });
            console.log(`[ResearchPack] Added LaTeX source (${buffer.length} bytes)`);
          })
          .catch(async (err) => {
            console.warn(`[ResearchPack] arXiv fetch failed: ${err.message}`);
            if (useMathpix && hasPdfSource(document)) {
              const pdfBuffer = await getDocPdfBuffer(document);
              await mathpixLatexFallback(pdfBuffer, prefix, document.title, archive);
            } else if (hasPdfSource(document)) {
              const pdfBuffer = await getDocPdfBuffer(document);
              archive.append(pdfBuffer, { name: `${prefix}/paper.pdf` });
            }
          })
      );
    } else if (useMathpix && hasPdfSource(document)) {
      tasks.push(
        getDocPdfBuffer(document).then((pdfBuffer) =>
          mathpixLatexFallback(pdfBuffer, prefix, document.title, archive)
        )
      );
    } else if (hasPdfSource(document)) {
      tasks.push(
        getDocPdfBuffer(document).then((buffer) => {
          archive.append(buffer, { name: `${prefix}/paper.pdf` });
        })
      );
    } else {
      throw new Error('No PDF or arXiv source available for this document');
    }
  } else {
    if (!hasPdfSource(document)) {
      throw new Error('No PDF file available for this document');
    }
    tasks.push(
      getDocPdfBuffer(document).then((buffer) => {
        archive.append(buffer, { name: `${prefix}/paper.pdf` });
        console.log(`[ResearchPack] Added PDF (${buffer.length} bytes)`);
      })
    );
  }

  // 2. Code repository
  if (includeCode && document.codeUrl) {
    tasks.push(
      fetchGitHubRepoZip(document.codeUrl)
        .then(({ buffer, repoName }) => {
          archive.append(buffer, { name: `${prefix}/code/${repoName}.zip` });
          console.log(`[ResearchPack] Added code repo (${buffer.length} bytes)`);
        })
        .catch((err) => {
          console.warn(`[ResearchPack] Failed to fetch code repo: ${err.message}`);
          archive.append(`Failed to download: ${err.message}\nURL: ${document.codeUrl}\n`, {
            name: `${prefix}/code/DOWNLOAD_FAILED.txt`,
          });
        })
    );
  }

  // 3. AI notes
  if (document.notesS3Key) {
    tasks.push(
      s3Service.downloadBuffer(document.notesS3Key)
        .then((buffer) => {
          archive.append(buffer, { name: `${prefix}/notes/ai-paper-notes.md` });
          console.log(`[ResearchPack] Added paper notes`);
        })
        .catch((err) => {
          console.warn(`[ResearchPack] Failed to fetch paper notes: ${err.message}`);
        })
    );
  }

  if (document.codeNotesS3Key) {
    tasks.push(
      s3Service.downloadBuffer(document.codeNotesS3Key)
        .then((buffer) => {
          archive.append(buffer, { name: `${prefix}/notes/code-analysis.md` });
          console.log(`[ResearchPack] Added code analysis notes`);
        })
        .catch((err) => {
          console.warn(`[ResearchPack] Failed to fetch code notes: ${err.message}`);
        })
    );
  }

  // Wait for all fetches to complete
  await Promise.all(tasks);

  // 4. README
  const readme = generateReadme(document, { sourceType, includeCode });
  archive.append(readme, { name: `${prefix}/README.md` });

  // Finalize the archive (this signals that no more files will be added)
  archive.finalize();

  return { archive, prefix };
}

/**
 * Create a batch research pack for multiple documents
 * Each document gets its own subfolder inside the archive
 * @param {Object[]} documents - Array of full document objects from DB
 * @param {Object} options
 * @param {string} options.sourceType - 'pdf' | 'latex'
 * @param {boolean} options.includeCode - whether to include code repos
 * @param {boolean} options.useMathpix - use Mathpix for non-arXiv LaTeX conversion
 * @returns {Promise<{ archive: archiver.Archiver }>}
 */
async function createBatchResearchPack(documents, options = {}) {
  const { sourceType = 'pdf', includeCode = true, useMathpix = false } = options;

  const archive = archiver('zip', { zlib: { level: 6 } });
  const tasks = [];

  for (const doc of documents) {
    const sanitizedTitle = doc.title
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 60);
    const prefix = sanitizedTitle;

    // Paper source
    if (sourceType === 'latex') {
      const arxivId = doc.originalUrl ? arxivService.parseArxivUrl(doc.originalUrl) : null;
      if (arxivId) {
        tasks.push(
          fetchArxivSource(arxivId)
            .then((buffer) => {
              archive.append(buffer, { name: `${prefix}/latex_source.tar.gz` });
              console.log(`[ResearchPack] Added LaTeX source for "${doc.title}"`);
            })
            .catch(async (err) => {
              console.warn(`[ResearchPack] Failed LaTeX for "${doc.title}": ${err.message}`);
              if (useMathpix && hasPdfSource(doc)) {
                try {
                  const pdfBuffer = await getDocPdfBuffer(doc);
                  await mathpixLatexFallback(pdfBuffer, prefix, doc.title, archive);
                } catch (e) {
                  console.warn(`[ResearchPack] Mathpix fallback also failed for "${doc.title}": ${e.message}`);
                }
              } else if (hasPdfSource(doc)) {
                try {
                  const buffer = await getDocPdfBuffer(doc);
                  archive.append(buffer, { name: `${prefix}/paper.pdf` });
                } catch (_) {}
              }
            })
        );
      } else if (useMathpix && hasPdfSource(doc)) {
        // Not arXiv, use Mathpix to convert PDF to LaTeX
        tasks.push(
          getDocPdfBuffer(doc)
            .then((pdfBuffer) => mathpixLatexFallback(pdfBuffer, prefix, doc.title, archive))
            .catch((err) => {
              console.warn(`[ResearchPack] Failed Mathpix for "${doc.title}": ${err.message}`);
            })
        );
      } else if (hasPdfSource(doc)) {
        // Not arXiv, no Mathpix, fallback to PDF
        tasks.push(
          getDocPdfBuffer(doc)
            .then((buffer) => {
              archive.append(buffer, { name: `${prefix}/paper.pdf` });
            })
            .catch((err) => {
              console.warn(`[ResearchPack] Failed PDF for "${doc.title}": ${err.message}`);
            })
        );
      }
    } else if (hasPdfSource(doc)) {
      tasks.push(
        getDocPdfBuffer(doc)
          .then((buffer) => {
            archive.append(buffer, { name: `${prefix}/paper.pdf` });
            console.log(`[ResearchPack] Added PDF for "${doc.title}"`);
          })
          .catch((err) => {
            console.warn(`[ResearchPack] Failed PDF for "${doc.title}": ${err.message}`);
          })
      );
    }

    // Code repository
    if (includeCode && doc.codeUrl) {
      tasks.push(
        fetchGitHubRepoZip(doc.codeUrl)
          .then(({ buffer, repoName }) => {
            archive.append(buffer, { name: `${prefix}/code/${repoName}.zip` });
            console.log(`[ResearchPack] Added code for "${doc.title}"`);
          })
          .catch((err) => {
            console.warn(`[ResearchPack] Failed code for "${doc.title}": ${err.message}`);
          })
      );
    }

    // AI notes
    if (doc.notesS3Key) {
      tasks.push(
        s3Service.downloadBuffer(doc.notesS3Key)
          .then((buffer) => {
            archive.append(buffer, { name: `${prefix}/notes/ai-paper-notes.md` });
          })
          .catch(() => {})
      );
    }

    if (doc.codeNotesS3Key) {
      tasks.push(
        s3Service.downloadBuffer(doc.codeNotesS3Key)
          .then((buffer) => {
            archive.append(buffer, { name: `${prefix}/notes/code-analysis.md` });
          })
          .catch(() => {})
      );
    }

    // Per-paper README
    const readme = generateReadme(doc, { sourceType, includeCode });
    archive.append(readme, { name: `${prefix}/README.md` });
  }

  await Promise.all(tasks);
  archive.finalize();

  return { archive };
}

module.exports = {
  createResearchPack,
  createBatchResearchPack,
  fetchArxivSource,
  fetchGitHubRepoZip,
};
