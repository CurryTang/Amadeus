const { spawn } = require('child_process');
const config = require('../config');
const path = require('path');
const fs = require('fs').promises;

// Default timeout for Gemini CLI (5 minutes)
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// Timeout for code analysis (15 minutes)
const CODE_ANALYSIS_TIMEOUT_MS = 15 * 60 * 1000;

// Maximum characters to include from each file
const MAX_FILE_CHARS = 8000;

// Maximum total characters for all source files
const MAX_TOTAL_SOURCE_CHARS = 60000;

/**
 * Check if Gemini CLI is available
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
  return new Promise((resolve) => {
    const geminiPath = config.geminiCli?.path || 'gemini';

    const proc = spawn(geminiPath, ['--version'], {
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
 * Read a document using Gemini CLI
 * @param {string} filePath - Path to the PDF file
 * @param {string} prompt - The prompt to use
 * @param {object} options - Additional options
 * @returns {Promise<{text: string, raw: object}>}
 */
async function readDocument(filePath, prompt, options = {}) {
  const geminiPath = config.geminiCli?.path || 'gemini';
  const timeoutMs = options.timeout || DEFAULT_TIMEOUT_MS;
  const model = config.geminiCli?.model || 'gemini-3-flash-preview';

  return new Promise((resolve, reject) => {
    // Build the full prompt with file reference using @ syntax
    // Gemini CLI uses @filepath to attach files to the prompt
    const fullPrompt = `${prompt}\n\n@${filePath}`;

    // Use positional prompt with model flag
    const args = ['-m', model, fullPrompt];

    console.log(`[Gemini CLI] Running: ${geminiPath} -m ${model} with prompt referencing: ${filePath}`);

    // Session isolation is handled by concurrency=1 in config (only one CLI
    // process at a time). Overriding HOME/XDG_CONFIG_HOME breaks auth since
    // Gemini CLI stores credentials in ~/.config/gemini or ~/.gemini.
    const proc = spawn(geminiPath, args, {
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large outputs
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
          // Not JSON, return as plain text
          resolve({
            text: stdout.trim(),
            raw: null,
          });
        }
      } else {
        reject(new Error(`Gemini CLI exited with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on('error', (error) => {
      if (error.code === 'ETIMEDOUT') {
        reject(new Error('Gemini CLI timeout'));
      } else if (error.code === 'ENOENT') {
        reject(new Error(`Gemini CLI not found at path: ${geminiPath}`));
      } else {
        reject(error);
      }
    });

    // Handle timeout
    setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Gemini CLI timeout'));
    }, timeoutMs);
  });
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
  // Combine system and user prompts
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
  const geminiPath = config.geminiCli?.path || 'gemini';
  const timeoutMs = options.timeout || DEFAULT_TIMEOUT_MS;
  const model = config.geminiCli?.model || 'gemini-3-flash-preview';

  return new Promise((resolve, reject) => {
    const fullPrompt = `${prompt}\n\n---\n\nDocument content:\n\n${markdownContent}`;

    const args = ['-m', model, fullPrompt];

    console.log(`[Gemini CLI] Running with markdown content (${markdownContent.length} chars), model: ${model}`);

    const proc = spawn(geminiPath, args, {
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
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
        try {
          const parsed = JSON.parse(stdout);
          resolve({
            text: parsed.text || parsed.response || parsed.content || stdout,
            raw: parsed,
          });
        } catch {
          resolve({
            text: stdout.trim(),
            raw: null,
          });
        }
      } else {
        reject(new Error(`Gemini CLI exited with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on('error', (error) => {
      if (error.code === 'ETIMEDOUT') {
        reject(new Error('Gemini CLI timeout'));
      } else if (error.code === 'ENOENT') {
        reject(new Error(`Gemini CLI not found at path: ${geminiPath}`));
      } else {
        reject(error);
      }
    });

    setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Gemini CLI timeout'));
    }, timeoutMs);
  });
}

/**
 * Read key repository files for context
 * @param {string} repoDir - Repository directory
 * @returns {Promise<string>} - Combined file contents
 */
async function readKeyFiles(repoDir) {
  const keyFiles = [
    'README.md',
    'README.rst',
    'README',
    'requirements.txt',
    'setup.py',
    'pyproject.toml',
    'package.json',
    'Cargo.toml',
    'go.mod',
    'Makefile',
    'CMakeLists.txt',
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
 * Analyze a code repository using Gemini CLI
 * @param {string} repoDir - Path to the cloned repository
 * @param {string} prompt - The analysis prompt
 * @param {object} options - Additional options
 * @returns {Promise<{text: string, raw: object}>}
 */
async function analyzeRepository(repoDir, prompt, options = {}) {
  const geminiPath = config.geminiCli?.path || 'gemini';
  const timeoutMs = options.timeout || CODE_ANALYSIS_TIMEOUT_MS;
  // Use gemini-3-flash-preview for code analysis (fast and capable)
  const model = options.model || 'gemini-3-flash-preview';

  console.log(`[Gemini CLI] Analyzing repository: ${repoDir}`);

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

  console.log(`[Gemini CLI] Prompt size: ${fullPrompt.length} chars, model: ${model}`);

  return new Promise((resolve, reject) => {
    const args = ['-m', model, fullPrompt];

    const proc = spawn(geminiPath, args, {
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
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
        console.log(`[Gemini CLI] Response received: ${stdout.length} chars`);
        resolve({
          text: stdout.trim(),
          raw: null,
        });
      } else {
        reject(new Error(`Gemini CLI exited with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on('error', (error) => {
      if (error.code === 'ETIMEDOUT') {
        reject(new Error('Gemini CLI timeout'));
      } else if (error.code === 'ENOENT') {
        reject(new Error(`Gemini CLI not found at path: ${geminiPath}`));
      } else {
        reject(error);
      }
    });

    // Handle timeout
    const timeoutHandle = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Gemini CLI timeout'));
    }, timeoutMs);

    proc.on('close', () => {
      clearTimeout(timeoutHandle);
    });
  });
}

/**
 * Run Gemini CLI with a prompt file (no file attachment)
 * @param {string} promptFilePath - Path to the prompt file
 * @param {object} options - Additional options
 * @returns {Promise<{text: string, raw: object}>}
 */
async function runWithPromptFile(promptFilePath, options = {}) {
  const geminiPath = config.geminiCli?.path || 'gemini';
  const timeoutMs = options.timeout || DEFAULT_TIMEOUT_MS;
  const model = options.model || config.geminiCli?.model || 'gemini-3-flash-preview';

  // Read prompt from file
  const prompt = await fs.readFile(promptFilePath, 'utf-8');

  return new Promise((resolve, reject) => {
    const args = ['-m', model, prompt];

    console.log(`[Gemini CLI] Running prompt file: ${promptFilePath} (${prompt.length} chars)`);

    const proc = spawn(geminiPath, args, {
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024,
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
        resolve({
          text: stdout.trim(),
          raw: null,
        });
      } else {
        reject(new Error(`Gemini CLI exited with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on('error', (error) => {
      if (error.code === 'ETIMEDOUT') {
        reject(new Error('Gemini CLI timeout'));
      } else if (error.code === 'ENOENT') {
        reject(new Error(`Gemini CLI not found at path: ${geminiPath}`));
      } else {
        reject(error);
      }
    });

    const timeoutHandle = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error('Gemini CLI timeout'));
    }, timeoutMs);

    proc.on('close', () => {
      clearTimeout(timeoutHandle);
    });
  });
}

module.exports = {
  isAvailable,
  readDocument,
  readWithPrompts,
  readMarkdown,
  analyzeRepository,
  runWithPromptFile,
};
