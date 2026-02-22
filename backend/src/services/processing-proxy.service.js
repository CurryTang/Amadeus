const config = require('../config');

/**
 * Processing Proxy Service
 *
 * Routes heavy processing tasks to desktop via FRP tunnel
 * Falls back to local processing if desktop is unavailable
 */
class ProcessingProxyService {
  constructor() {
    this.desktopUrl = config.processing?.desktopUrl || 'http://127.0.0.1:7001';
    this.timeout = config.processing?.timeout || 300000; // 5 minutes
    this.enabled = config.processing?.enabled !== false;
  }

  /**
   * Check if desktop processing is available
   * @returns {Promise<boolean>}
   */
  async isDesktopAvailable() {
    if (!this.enabled) return false;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.desktopUrl}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      console.warn('[ProcessingProxy] Desktop unavailable:', error.message);
      return false;
    }
  }

  /**
   * Process document via desktop
   * @param {object} item - Queue item with document info
   * @param {object} options - Processing options
   * @returns {Promise<object>}
   */
  async processDocument(item, options = {}) {
    const available = await this.isDesktopAvailable();

    if (!available) {
      throw new Error('Desktop processing service is not available');
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.desktopUrl}/api/process/document`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ item, options }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Desktop processing failed: ${error}`);
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Desktop processing timeout');
      }
      throw error;
    }
  }

  /**
   * Analyze code via desktop
   * @param {number} documentId
   * @param {string} codeUrl
   * @param {string} title
   * @returns {Promise<object>}
   */
  async analyzeCode(documentId, codeUrl, title) {
    const available = await this.isDesktopAvailable();

    if (!available) {
      throw new Error('Desktop processing service is not available');
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.desktopUrl}/api/process/code-analysis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ documentId, codeUrl, title }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Desktop code analysis failed: ${error}`);
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Desktop code analysis timeout');
      }
      throw error;
    }
  }

  /**
   * Generate LLM completion via desktop
   * @param {string} content - Document content
   * @param {string} prompt - The prompt
   * @param {string} providerName - Provider name
   * @returns {Promise<object>}
   */
  async generateCompletion(content, prompt, providerName = 'gemini') {
    const available = await this.isDesktopAvailable();

    if (!available) {
      throw new Error('Desktop processing service is not available');
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.desktopUrl}/api/process/llm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content, prompt, provider: providerName }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Desktop LLM generation failed: ${error}`);
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Desktop LLM generation timeout');
      }
      throw error;
    }
  }
}

module.exports = new ProcessingProxyService();
