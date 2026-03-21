const { spawn } = require('child_process');
const fs = require('fs').promises;
const config = require('../config');

// Default timeout: 10 minutes
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Check if Claude Code CLI is available
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
  return new Promise((resolve) => {
    const claudePath = config.claudeCli?.path || 'claude';
    const proc = spawn(claudePath, ['--version'], { timeout: 5000 });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

/**
 * Run Claude Code CLI in headless (--print) mode.
 * Prompt is passed via stdin to avoid shell arg-length limits.
 * @param {string} prompt - Full prompt to send
 * @param {object} options - { model, thinkingBudget, timeout }
 * @returns {Promise<{text: string, raw: null}>}
 */
function runClaudeHeadless(prompt, options = {}) {
  const claudePath = config.claudeCli?.path || 'claude';
  const model = options.model || config.claudeCli?.model || 'claude-sonnet-4-6';
  const timeoutMs = options.timeout || DEFAULT_TIMEOUT_MS;
  const thinkingBudget = options.thinkingBudget || 0;

  const args = ['--print', '--model', model, '--dangerously-skip-permissions'];

  const env = { ...process.env };
  if (config.claudeCli?.apiKey) {
    env.ANTHROPIC_API_KEY = config.claudeCli.apiKey;
  }

  console.log(`[Claude CLI] Running: ${claudePath} --print --model ${model}${thinkingBudget > 0 ? ' --think' : ''} (prompt: ${prompt.length} chars)`);

  return new Promise((resolve, reject) => {
    const proc = spawn(claudePath, args, {
      env,
      maxBuffer: 50 * 1024 * 1024, // 50MB
    });

    // Pass prompt via stdin
    proc.stdin.write(prompt);
    proc.stdin.end();

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    const timeoutHandle = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Claude CLI timeout'));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeoutHandle);
      if (code === 0) {
        resolve({ text: stdout.trim(), raw: null });
      } else {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on('error', (error) => {
      clearTimeout(timeoutHandle);
      if (error.code === 'ENOENT') {
        reject(new Error(`Claude CLI not found at path: ${claudePath}`));
      } else {
        reject(error);
      }
    });
  });
}

/**
 * Extract plain text from a PDF file using pdf-parse (lazy-loaded).
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function extractPdfText(filePath) {
  const { PDFParse } = require('pdf-parse');
  const buffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy().catch(() => {});
  return result.text;
}

/**
 * Read a PDF document using Claude Code CLI in headless mode.
 * Extracts text from the PDF and embeds it in the prompt.
 * @param {string} filePath - Path to the PDF file
 * @param {string} prompt - The prompt to use
 * @param {object} options - { model, thinkingBudget, timeout }
 * @returns {Promise<{text: string, raw: null}>}
 */
async function readDocument(filePath, prompt, options = {}) {
  let fileContent = '';

  if (filePath.toLowerCase().endsWith('.pdf')) {
    try {
      fileContent = await extractPdfText(filePath);
      console.log(`[Claude CLI] Extracted ${fileContent.length} chars from PDF`);
    } catch (err) {
      throw new Error(`Cannot extract text from PDF for Claude CLI: ${err.message}`);
    }
  } else {
    fileContent = await fs.readFile(filePath, 'utf-8');
  }

  // Truncate to avoid prompt size issues
  const maxContentChars = 120000;
  if (fileContent.length > maxContentChars) {
    fileContent = fileContent.substring(0, maxContentChars) + '\n\n... (content truncated)';
    console.log(`[Claude CLI] Content truncated to ${maxContentChars} chars`);
  }

  const fullPrompt = `${prompt}\n\n---\n\nDocument content:\n\n${fileContent}`;
  return runClaudeHeadless(fullPrompt, options);
}

/**
 * Read markdown content using Claude Code CLI in headless mode
 * @param {string} markdownContent - Document content as markdown
 * @param {string} prompt - The prompt to use
 * @param {object} options - { model, thinkingBudget, timeout }
 * @returns {Promise<{text: string, raw: null}>}
 */
async function readMarkdown(markdownContent, prompt, options = {}) {
  const fullPrompt = `${prompt}\n\n---\n\nDocument content:\n\n${markdownContent}`;
  return runClaudeHeadless(fullPrompt, options);
}

module.exports = {
  isAvailable,
  runClaudeHeadless,
  readDocument,
  readMarkdown,
};
