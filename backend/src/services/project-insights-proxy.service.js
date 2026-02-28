const config = require('../config');

class ProjectInsightsProxyService {
  constructor() {
    this.desktopUrl = config.projectInsights?.desktopUrl || config.processing?.desktopUrl || 'http://127.0.0.1:7001';
    this.timeout = config.projectInsights?.timeout || 45000;
    this.enabled = config.projectInsights?.proxyHeavyOps === true;
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
      console.warn('[ProjectInsightsProxy] Desktop unavailable:', error.message);
      return false;
    }
  }

  async request(path, { method = 'POST', body } = {}) {
    const available = await this.isDesktopAvailable();
    if (!available) {
      throw new Error('Desktop project-insights service is not available');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const hasBody = body !== undefined && method !== 'GET' && method !== 'HEAD';
      const response = await fetch(`${this.desktopUrl}${path}`, {
        method,
        headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Desktop project-insights request failed (${response.status}): ${text}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return response.json();
      }
      return { ok: true };
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Desktop project-insights request timeout');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  getGitLog({ projectPath, branch = '', limit = 30 } = {}) {
    return this.request('/api/researchops/insights/git-log', {
      method: 'POST',
      body: {
        projectPath,
        branch,
        limit,
      },
    });
  }

  getServerFiles({ projectPath, sampleLimit = 48 } = {}) {
    return this.request('/api/researchops/insights/server-files', {
      method: 'POST',
      body: {
        projectPath,
        sampleLimit,
      },
    });
  }

  getChangedFiles({ projectPath, limit = 200 } = {}) {
    return this.request('/api/researchops/insights/changed-files', {
      method: 'POST',
      body: {
        projectPath,
        limit,
      },
    });
  }

  checkPath({ projectPath } = {}) {
    return this.request('/api/researchops/insights/path-check', {
      method: 'POST',
      body: { projectPath },
    });
  }

  ensurePath({ projectPath } = {}) {
    return this.request('/api/researchops/insights/ensure-path', {
      method: 'POST',
      body: { projectPath },
    });
  }

  ensureGitRepo({ projectPath } = {}) {
    return this.request('/api/researchops/insights/ensure-git', {
      method: 'POST',
      body: { projectPath },
    });
  }

  getAgentSessions({ projectPath } = {}) {
    const qs = projectPath ? `?projectPath=${encodeURIComponent(projectPath)}` : '';
    return this.request(`/api/agent-sessions${qs}`, { method: 'GET' });
  }
}

module.exports = new ProjectInsightsProxyService();
