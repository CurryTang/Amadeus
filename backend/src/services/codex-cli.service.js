const { spawn } = require('child_process');
const config = require('../config');
const path = require('path');
const fs = require('fs').promises;

// Default timeout for Codex CLI (10 minutes - codex can be slower)
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

// Timeout for code analysis (20 minutes)
const CODE_ANALYSIS_TIMEOUT_MS = 20 * 60 * 1000;

// Maximum characters to include from each file
const MAX_FILE_CHARS = 8000;

// Maximum total characters for all source files
const MAX_TOTAL_SOURCE_CHARS = 60000;

/**
 * Check if Codex CLI is available
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
  return new Promise((resolve) => {
    const codexPath = config.codexCli?.path || 'codex';

    const proc = spawn(codexPath, ['--version'], {
      timeout: 5000,
    });

    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Run codex exec with the given prompt and optional file content
 * @param {string} prompt - The full prompt to send
 * @param {object} options - Additional options
 * @returns {Promise<{text: string, raw: object}>}
 */
/**
 * Strip Codex CLI session log from stdout.
 * Codex exec outputs timestamped log lines, headers, thinking blocks,
 * and tool-call traces before/around the actual LLM response.
 */
function stripCodexSessionLog(raw) {
  if (!raw) return raw;
  const lines = raw.split('\n');
  const cleaned = [];
  let inSessionHeader = false;

  for (const line of lines) {
    // Session header lines: "[2026-02-09T03:18:39] OpenAI Codex ..."
    if (/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\]/.test(line)) continue;
    // Separator lines
    if (/^-{6,}$/.test(line.trim())) {
      inSessionHeader = !inSessionHeader;
      continue;
    }
    // Inside header block (workdir, model, provider, etc.)
    if (inSessionHeader) continue;
    // Codex metadata lines
    if (/^(workdir|model|provider|approval|sandbox|reasoning)[:=]/i.test(line.trim())) continue;
    // Bold thinking headers from exec output
    if (/^\*\*(Searching|Preparing|Confirming|Planning|Clarifying)/.test(line.trim())) continue;

    cleaned.push(line);
  }

  return cleaned.join('\n').trim();
}

function runCodex(prompt, options = {}) {
  const codexPath = config.codexCli?.path || 'codex';
  const timeoutMs = options.timeout || DEFAULT_TIMEOUT_MS;
  const model = options.model || config.codexCli?.model || 'gpt-5.1-codex-mini';
  return new Promise((resolve, reject) => {
    // codex exec --full-auto -m <model> "<prompt>"
    // --full-auto = automatic execution with workspace-write sandbox, no approval prompts
    const args = [
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      '-m', model,
      prompt,
    ];

    console.log(`[Codex CLI] Running: ${codexPath} exec --dangerously-bypass-approvals-and-sandbox -m ${model} (prompt: ${prompt.length} chars)`);

    // Session isolation is handled by concurrency=1 in config (only one Codex
    // process at a time). Overriding HOME or XDG_CONFIG_HOME would break auth
    // since Codex stores credentials in ~/.codex/auth.json.
    const proc = spawn(codexPath, args, {
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        // Try to parse as JSON first
        try {
          const parsed = JSON.parse(stdout);
          resolve({
            text: parsed.text || parsed.response || parsed.content || stdout,
            raw: parsed,
          });
        } catch {
          // Strip Codex session log noise from plain text output
          const cleaned = stripCodexSessionLog(stdout);
          resolve({
            text: cleaned,
            raw: null,
          });
        }
      } else {
        reject(new Error(`Codex CLI exited with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on('error', (error) => {
      if (error.code === 'ETIMEDOUT') {
        reject(new Error('Codex CLI timeout'));
      } else if (error.code === 'ENOENT') {
        reject(new Error(`Codex CLI not found at path: ${codexPath}`));
      } else {
        reject(error);
      }
    });

    // Handle timeout
    const timeoutHandle = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Codex CLI timeout'));
    }, timeoutMs);

    proc.on('close', () => {
      clearTimeout(timeoutHandle);
    });
  });
}

/**
 * Extract text from a PDF file using pdf-parse (lazy-loaded to avoid
 * crashing on import if pdfjs-dist requires a newer Node version).
 * @param {string} filePath - Path to the PDF file
 * @returns {Promise<string>} - Extracted text
 */
async function extractPdfText(filePath) {
  const pdfParse = require('pdf-parse');
  const buffer = await fs.readFile(filePath);
  const data = await pdfParse(buffer);
  return data.text;
}

/**
 * Read a document using Codex CLI
 * Codex CLI cannot read PDFs natively (unlike Gemini CLI which has @file support),
 * so we extract the text from the PDF and embed it in the prompt.
 * @param {string} filePath - Path to the PDF file
 * @param {string} prompt - The prompt to use
 * @param {object} options - Additional options
 * @returns {Promise<{text: string, raw: object}>}
 */
async function readDocument(filePath, prompt, options = {}) {
  let fileContent = '';

  if (filePath.toLowerCase().endsWith('.pdf')) {
    // Extract text from PDF since Codex can't read binary files
    try {
      fileContent = await extractPdfText(filePath);
      console.log(`[Codex CLI] Extracted ${fileContent.length} chars from PDF`);
    } catch (err) {
      console.error(`[Codex CLI] PDF text extraction failed: ${err.message}`);
      throw new Error(`Cannot extract text from PDF for Codex CLI: ${err.message}`);
    }
  } else {
    // For non-PDF files, read as text
    try {
      fileContent = await fs.readFile(filePath, 'utf-8');
    } catch {
      throw new Error(`Cannot read file: ${filePath}`);
    }
  }

  // Truncate if too long (Codex has prompt limits)
  const maxContentChars = 120000;
  if (fileContent.length > maxContentChars) {
    fileContent = fileContent.substring(0, maxContentChars) + '\n\n... (content truncated)';
    console.log(`[Codex CLI] Content truncated to ${maxContentChars} chars`);
  }

  const fullPrompt = `${prompt}\n\n---\n\nDocument content:\n\n${fileContent}`;
  return runCodex(fullPrompt, options);
}

/**
 * Read a document with a system prompt and user prompt
 * @param {string} filePath - Path to the PDF file
 * @param {string} systemPrompt - System prompt for context
 * @param {string} userPrompt - User prompt with the actual request
 * @param {object} options - Additional options
 * @returns {Promise<{text: string, raw: object}>}
 */
async function readWithPrompts(filePath, systemPrompt, userPrompt, options = {}) {
  let fullPrompt = '';
  if (systemPrompt) {
    fullPrompt += `${systemPrompt}\n\n`;
  }
  fullPrompt += userPrompt;
  return readDocument(filePath, fullPrompt, options);
}

/**
 * Read markdown content (for Mathpix-converted files)
 * @param {string} markdownContent - Markdown content to analyze
 * @param {string} prompt - The prompt to use
 * @param {object} options - Additional options
 * @returns {Promise<{text: string, raw: object}>}
 */
async function readMarkdown(markdownContent, prompt, options = {}) {
  const fullPrompt = `${prompt}\n\n---\n\nDocument content:\n\n${markdownContent}`;
  console.log(`[Codex CLI] Running with markdown content (${markdownContent.length} chars)`);
  return runCodex(fullPrompt, options);
}

/**
 * Read key repository files for context
 * @param {string} repoDir - Repository directory
 * @returns {Promise<string>} - Combined file contents
 */
async function readKeyFiles(repoDir) {
  const keyFiles = [
    'README.md', 'README.rst', 'README',
    'requirements.txt', 'setup.py', 'pyproject.toml',
    'package.json', 'Cargo.toml', 'go.mod',
    'Makefile', 'CMakeLists.txt',
  ];

  let context = '';

  for (const file of keyFiles) {
    try {
      const filePath = path.join(repoDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const truncated = content.substring(0, MAX_FILE_CHARS);
      context += `\n\n### File: ${file}\n\`\`\`\n${truncated}\n\`\`\``;
      if (content.length > MAX_FILE_CHARS) {
        context += `\n(truncated, original ${content.length} chars)`;
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  return context;
}

/**
 * Find source files in the repository
 * @param {string} repoDir - Repository directory
 * @returns {Promise<string[]>} - List of source file paths
 */
async function findSourceFiles(repoDir) {
  return new Promise((resolve) => {
    const proc = spawn('find', [
      '.', '-type', 'f',
      '(', '-name', '*.py', '-o', '-name', '*.js', '-o', '-name', '*.ts', '-o',
      '-name', '*.rs', '-o', '-name', '*.go', '-o', '-name', '*.java', '-o',
      '-name', '*.cpp', '-o', '-name', '*.c', '-o', '-name', '*.h', ')',
      '-not', '-path', '*/.*',
      '-not', '-path', '*node_modules*',
      '-not', '-path', '*__pycache__*',
      '-not', '-path', '*target*',
      '-not', '-path', '*build*',
      '-not', '-path', '*dist*',
    ], { cwd: repoDir });

    let output = '';
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.on('close', () => {
      const files = output.trim().split('\n').filter(Boolean).slice(0, 40);
      resolve(files);
    });
    proc.on('error', () => { resolve([]); });
  });
}

/**
 * Read specific source files (up to limit)
 * @param {string} repoDir - Repository directory
 * @param {string[]} files - List of files to read
 * @param {number} totalLimit - Total character limit
 * @returns {Promise<string>} - Combined file contents
 */
async function readSourceFiles(repoDir, files, totalLimit = MAX_TOTAL_SOURCE_CHARS) {
  let context = '';
  let totalChars = 0;

  for (const file of files) {
    if (totalChars >= totalLimit) break;

    try {
      const filePath = path.join(repoDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const remaining = totalLimit - totalChars;
      const maxPerFile = Math.min(6000, remaining);
      const truncated = content.substring(0, maxPerFile);
      context += `\n\n### File: ${file}\n\`\`\`\n${truncated}\n\`\`\``;
      totalChars += truncated.length;
      if (content.length > maxPerFile) {
        context += `\n(truncated, original ${content.length} chars)`;
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return context;
}

/**
 * Get directory tree structure
 * @param {string} repoDir - Repository directory
 * @returns {Promise<string>} - Tree structure
 */
async function getDirectoryTree(repoDir) {
  return new Promise((resolve) => {
    const proc = spawn('find', [
      '.', '-type', 'f',
      '-not', '-path', '*/.*',
      '-not', '-path', '*node_modules*',
      '-not', '-path', '*__pycache__*',
      '-not', '-path', '*target*',
      '-not', '-path', '*.git*',
      '-not', '-path', '*build*',
      '-not', '-path', '*dist*',
    ], { cwd: repoDir });

    let output = '';
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.on('close', () => {
      const files = output.trim().split('\n').filter(Boolean).slice(0, 150);
      resolve(files.join('\n'));
    });
    proc.on('error', () => { resolve(''); });
  });
}

/**
 * Analyze a code repository using Codex CLI
 * @param {string} repoDir - Path to the cloned repository
 * @param {string} prompt - The analysis prompt
 * @param {object} options - Additional options
 * @returns {Promise<{text: string, raw: object}>}
 */
async function analyzeRepository(repoDir, prompt, options = {}) {
  const timeoutMs = options.timeout || CODE_ANALYSIS_TIMEOUT_MS;

  console.log(`[Codex CLI] Analyzing repository: ${repoDir}`);

  // Read repository contents to include in the prompt
  const keyFilesContent = await readKeyFiles(repoDir);
  const sourceFiles = await findSourceFiles(repoDir);
  const sourceFilesContent = await readSourceFiles(repoDir, sourceFiles);
  const directoryTree = await getDirectoryTree(repoDir);

  // Build full prompt with file contents
  const fullPrompt = `${prompt}

## 仓库目录结构
\`\`\`
${directoryTree}
\`\`\`

## 关键配置文件
${keyFilesContent}

## 源代码文件
${sourceFilesContent}

请基于以上内容进行分析。`;

  console.log(`[Codex CLI] Prompt size: ${fullPrompt.length} chars`);

  return runCodex(fullPrompt, { ...options, timeout: timeoutMs });
}

module.exports = {
  isAvailable,
  readDocument,
  readWithPrompts,
  readMarkdown,
  analyzeRepository,
};
