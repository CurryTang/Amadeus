const config = require('../config');
const fs = require('fs').promises;
const path = require('path');

// Default timeout for Google API (5 minutes)
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

// Maximum characters to include from markdown content
const MAX_CONTENT_CHARS = 100000;

/**
 * Check if Google API is available (API key is configured)
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
  return !!config.googleApi?.apiKey;
}

/**
 * Get the configured model name
 * @returns {string}
 */
function getModel() {
  return config.googleApi?.model || 'gemini-3-flash-preview';
}

/**
 * Read a document using Google Generative AI API
 * @param {string} filePath - Path to the PDF file
 * @param {string} prompt - The prompt to use
 * @param {object} options - Additional options
 * @returns {Promise<{text: string, raw: object, provider: string, model: string}>}
 */
async function readDocument(filePath, prompt, options = {}) {
  const apiKey = config.googleApi?.apiKey;
  
  if (!apiKey) {
    throw new Error('Google API key not configured. Set GOOGLE_API_KEY in environment variables.');
  }

  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  
  const model = options.model || getModel();
  const generativeModel = genAI.getGenerativeModel({ model });

  console.log(`[Google API] Processing document: ${filePath} with model: ${model}`);

  // Read the file as base64 for inline data
  const fileBuffer = await fs.readFile(filePath);
  const base64Data = fileBuffer.toString('base64');
  
  // Determine mime type from file extension
  const ext = path.extname(filePath).toLowerCase();
  let mimeType = 'application/pdf';
  if (ext === '.png') mimeType = 'image/png';
  else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
  else if (ext === '.gif') mimeType = 'image/gif';
  else if (ext === '.webp') mimeType = 'image/webp';

  try {
    const result = await generativeModel.generateContent([
      {
        inlineData: {
          mimeType,
          data: base64Data,
        },
      },
      { text: prompt },
    ]);

    const response = await result.response;
    const text = response.text();

    console.log(`[Google API] Response received: ${text.length} chars`);

    return {
      text,
      raw: response,
      provider: 'google-api',
      model,
    };
  } catch (error) {
    console.error('[Google API] Error:', error.message);
    throw new Error(`Google API error: ${error.message}`);
  }
}

/**
 * Read a document with a system prompt and user prompt
 * @param {string} filePath - Path to the PDF file
 * @param {string} systemPrompt - System prompt for context
 * @param {string} userPrompt - User prompt with the actual request
 * @param {object} options - Additional options
 * @returns {Promise<{text: string, raw: object, provider: string, model: string}>}
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
 * @returns {Promise<{text: string, raw: object, provider: string, model: string}>}
 */
async function readMarkdown(markdownContent, prompt, options = {}) {
  const apiKey = config.googleApi?.apiKey;
  
  if (!apiKey) {
    throw new Error('Google API key not configured. Set GOOGLE_API_KEY in environment variables.');
  }

  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  
  const model = options.model || getModel();
  const generativeModel = genAI.getGenerativeModel({ model });

  // Truncate content if too long
  let content = markdownContent;
  if (content.length > MAX_CONTENT_CHARS) {
    content = content.substring(0, MAX_CONTENT_CHARS);
    console.log(`[Google API] Content truncated from ${markdownContent.length} to ${MAX_CONTENT_CHARS} chars`);
  }

  const fullPrompt = `${prompt}\n\n---\n\nDocument content:\n\n${content}`;

  console.log(`[Google API] Processing markdown content (${content.length} chars), model: ${model}`);

  try {
    const result = await generativeModel.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    console.log(`[Google API] Response received: ${text.length} chars`);

    return {
      text,
      raw: response,
      provider: 'google-api',
      model,
    };
  } catch (error) {
    console.error('[Google API] Error:', error.message);
    throw new Error(`Google API error: ${error.message}`);
  }
}

/**
 * Analyze a code repository using Google API
 * @param {string} repoDir - Path to the cloned repository
 * @param {string} prompt - The analysis prompt
 * @param {object} options - Additional options
 * @returns {Promise<{text: string, raw: object, provider: string, model: string}>}
 */
async function analyzeRepository(repoDir, prompt, options = {}) {
  const apiKey = config.googleApi?.apiKey;
  
  if (!apiKey) {
    throw new Error('Google API key not configured. Set GOOGLE_API_KEY in environment variables.');
  }

  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  
  // Use gemini-3-flash-preview for code analysis
  const model = options.model || getModel();
  const generativeModel = genAI.getGenerativeModel({ model });

  console.log(`[Google API] Analyzing repository: ${repoDir}`);

  // Read repository contents
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

  console.log(`[Google API] Prompt size: ${fullPrompt.length} chars, model: ${model}`);

  try {
    const result = await generativeModel.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    console.log(`[Google API] Response received: ${text.length} chars`);

    return {
      text,
      raw: response,
      provider: 'google-api',
      model,
    };
  } catch (error) {
    console.error('[Google API] Error:', error.message);
    throw new Error(`Google API error: ${error.message}`);
  }
}

// Helper functions for repository analysis

const MAX_FILE_CHARS = 8000;
const MAX_TOTAL_SOURCE_CHARS = 60000;
const { spawn } = require('child_process');

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

module.exports = {
  isAvailable,
  getModel,
  readDocument,
  readWithPrompts,
  readMarkdown,
  analyzeRepository,
};
