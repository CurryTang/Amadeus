'use strict';

/**
 * Superpowers (brainstorm extension) installation helpers.
 *
 * - Codex: prepends the INSTALL.md fetch instruction to every prompt so the
 *   agent bootstraps the extension before doing any real work.
 * - Claude Code: provides a preflight that runs the two /plugin commands once
 *   before the main agent session begins.
 */

const { spawn } = require('child_process');

const CODEX_INSTALL_INSTRUCTION =
  'Fetch and follow instructions from https://raw.githubusercontent.com/obra/superpowers/refs/heads/main/.codex/INSTALL.md';

const CLAUDE_PLUGIN_COMMANDS = [
  '/plugin marketplace add obra/superpowers-marketplace',
  '/plugin install superpowers@superpowers-marketplace',
];

const SUPERPOWERS_MARKER = '[superpowers-installed]';

/**
 * Returns the Codex superpowers prompt prefix.
 * Safe to call for any provider — returns '' for non-codex.
 */
function codexSuperpowersPrefix() {
  return `${CODEX_INSTALL_INSTRUCTION}\n\n`;
}

/**
 * Prepends the superpowers install instruction to a prompt for Codex runs.
 * For Claude / Gemini / unknown providers, returns the prompt unchanged.
 *
 * @param {string} command  Resolved CLI command, e.g. 'codex', 'claude'.
 * @param {string} prompt   The full agent prompt.
 * @returns {string}
 */
function applySuperpowersPrefix(command, prompt) {
  const cmd = String(command || '').toLowerCase().trim();
  if (cmd !== 'codex') return String(prompt || '');
  const text = String(prompt || '');
  // Idempotent — don't double-inject.
  if (text.includes(CODEX_INSTALL_INSTRUCTION)) return text;
  return `${codexSuperpowersPrefix()}${text}`;
}

/**
 * Builds the two claude preflight shell lines for local execution.
 * Each line runs a /plugin command in headless mode and swallows errors so
 * the main run is never blocked.
 *
 * @param {boolean} isRoot  Whether the process is running as root.
 * @param {string}  model   Claude model to use for preflight (may be empty).
 * @returns {string[]}  Array of bash -lc-compatible shell lines.
 */
function claudePreflightShellLines(isRoot = false, model = '') {
  const permFlag = isRoot ? '' : '--dangerously-skip-permissions ';
  const modelFlag = model ? `--model ${model} ` : '';
  return CLAUDE_PLUGIN_COMMANDS.map(
    (cmd) => `claude ${permFlag}${modelFlag}-p ${JSON.stringify(cmd)} 2>/dev/null || true`
  );
}

/**
 * Runs the Claude superpowers preflight on the local machine (v1 / WSL runs).
 * Fire-and-forget is intentional — plugin install failures must never abort the
 * main agent run.
 *
 * @param {string} model   Claude model string (may be empty).
 */
function runLocalClaudePreflight(model = '') {
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const lines = claudePreflightShellLines(isRoot, model);
  for (const line of lines) {
    try {
      const child = spawn('bash', ['-lc', line], {
        stdio: ['ignore', 'ignore', 'ignore'],
        detached: process.platform !== 'win32',
      });
      if (typeof child.unref === 'function') child.unref();
    } catch (_) {
      // preflight is best-effort
    }
  }
}

/**
 * Returns the preflight bash lines suitable for injection into the remote
 * script that runs on an SSH server (inside buildRemoteScript's header).
 * Each line is self-contained and swallows errors via `|| true`.
 *
 * Usage: prepend these lines before the main $SHELL_CMD execution in the
 * remote script so superpowers is installed on the server before the agent.
 *
 * @param {boolean} isRoot
 * @param {string}  model
 * @returns {string[]}
 */
function remoteClaudePreflightLines(isRoot = false, model = '') {
  return [
    '# --- superpowers preflight ---',
    ...claudePreflightShellLines(isRoot, model),
    '# --- end superpowers preflight ---',
  ];
}

module.exports = {
  CODEX_INSTALL_INSTRUCTION,
  CLAUDE_PLUGIN_COMMANDS,
  SUPERPOWERS_MARKER,
  applySuperpowersPrefix,
  claudePreflightShellLines,
  remoteClaudePreflightLines,
  runLocalClaudePreflight,
};
