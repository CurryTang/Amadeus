(function initArxivSaveHelpers(globalScope) {
  function normalizeTitle(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function isPlaceholderTitle(title, arxivId = '') {
    const normalized = normalizeTitle(title).toLowerCase();
    if (!normalized) return true;
    if (/^fetching title for arxiv:/i.test(normalized)) return true;
    if (/^arxiv[:\s]/i.test(normalized)) return true;
    if (arxivId && normalized === `arxiv:${String(arxivId).toLowerCase()}`) return true;
    return false;
  }

  function shouldFetchArxivMetadata(arxivInfo = {}) {
    if (!arxivInfo || !arxivInfo.arxivId) return false;
    if (isPlaceholderTitle(arxivInfo.title, arxivInfo.arxivId)) return true;
    const hasAuthors = Array.isArray(arxivInfo.authors) && arxivInfo.authors.length > 0;
    const hasAbstract = String(arxivInfo.abstract || '').trim().length > 0;
    return !hasAuthors && !hasAbstract;
  }

  function buildArxivSaveRequest(arxivInfo = {}, formData = {}) {
    const arxivId = String(arxivInfo?.arxivId || '').trim();
    if (!arxivId) return null;

    const authors = Array.isArray(arxivInfo?.authors) ? arxivInfo.authors.filter(Boolean) : [];
    const categories = Array.isArray(arxivInfo?.categories) ? arxivInfo.categories.filter(Boolean) : [];
    const absUrl = String(arxivInfo?.absUrl || `https://arxiv.org/abs/${arxivId}`).trim();
    const title = normalizeTitle(formData?.title || arxivInfo?.title || '');

    return {
      paperId: arxivId,
      title,
      tags: Array.isArray(formData?.tags) ? formData.tags : [],
      notes: String(formData?.notes || '').trim(),
      analysisProvider: String(formData?.analysisProvider || '').trim(),
      abstract: String(arxivInfo?.abstract || '').trim(),
      authors,
      publishedAt: String(arxivInfo?.publishedAt || arxivInfo?.published || '').trim(),
      primaryCategory: String(arxivInfo?.primaryCategory || categories[0] || '').trim(),
      absUrl,
    };
  }

  function resolveApiBaseUrl(rawValue) {
    const trimmed = String(rawValue || '').trim();
    return trimmed || 'http://localhost:3000/api';
  }

  const api = {
    buildArxivSaveRequest,
    resolveApiBaseUrl,
    shouldFetchArxivMetadata,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  globalScope.AutoReaderArxivSave = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
