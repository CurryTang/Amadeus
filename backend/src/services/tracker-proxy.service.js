const config = require('../config');

class TrackerProxyService {
  constructor() {
    this.desktopUrl = config.tracker?.desktopUrl || config.processing?.desktopUrl || 'http://127.0.0.1:7001';
    this.timeout = config.tracker?.timeout || 120000;
    this.enabled = config.tracker?.proxyHeavyOps === true;
  }

  async isDesktopAvailable() {
    if (!this.enabled) return false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${this.desktopUrl}/health`, { signal: controller.signal });
      clearTimeout(timer);
      return response.ok;
    } catch (error) {
      console.warn('[TrackerProxy] Desktop unavailable:', error.message);
      return false;
    }
  }

  async request(path, { method = 'GET', body } = {}) {
    const available = await this.isDesktopAvailable();
    if (!available) {
      throw new Error('Desktop tracker service is not available');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.desktopUrl}${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Desktop tracker request failed (${response.status}): ${text}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return response.json();
      }
      return { ok: true };
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Desktop tracker request timeout');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  runAll() {
    return this.request('/api/tracker/run', { method: 'POST' });
  }

  runSource(sourceId) {
    return this.request(`/api/tracker/sources/${sourceId}/run`, { method: 'POST' });
  }

  getStatus() {
    return this.request('/api/tracker/status', { method: 'GET' });
  }

  previewTwitter(configBody) {
    return this.request('/api/tracker/twitter/playwright/preview', {
      method: 'POST',
      body: configBody || {},
    });
  }
}

module.exports = new TrackerProxyService();
