const config = require('../config');

/**
 * Claude Code Service (Deprecated)
 *
 * This service has been replaced by gemini-cli.service.js for code analysis.
 * Keeping stub functions for backward compatibility.
 */

/**
 * Check if Claude Code is available (always returns false now)
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
  // Claude Code wrapper is no longer used, return false
  return false;
}

/**
 * Analyze a code repository (deprecated - use geminiCliService.analyzeRepository instead)
 * @param {string} repoDir - Path to the cloned repository
 * @param {string} prompt - The analysis prompt
 * @param {object} options - Additional options
 * @returns {Promise<{text: string, raw: object}>}
 */
async function analyzeRepository(repoDir, prompt, options = {}) {
  throw new Error('Claude Code service is deprecated. Use gemini-cli.service.js instead.');
}

/**
 * Analyze code with file context (deprecated)
 */
async function analyzeWithContext(repoDir, prompt, contextFiles = [], options = {}) {
  throw new Error('Claude Code service is deprecated. Use gemini-cli.service.js instead.');
}

/**
 * Run multi-round code analysis (deprecated)
 */
async function multiRoundAnalysis(repoDir, rounds, options = {}) {
  throw new Error('Claude Code service is deprecated. Use gemini-cli.service.js instead.');
}

module.exports = {
  isAvailable,
  analyzeRepository,
  analyzeWithContext,
  multiRoundAnalysis,
};
