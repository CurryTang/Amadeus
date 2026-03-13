export function buildArxivSavePayload(paper = {}) {
  const arxivId = String(paper?.arxivId || '').trim();
  if (!arxivId) {
    return null;
  }

  const abstract = String(paper?.summary || paper?.abstract || '').trim();
  const publishedAt = String(paper?.publishedAt || '').trim();
  const primaryCategory = String(paper?.primaryCategory || '').trim();

  return {
    paperId: arxivId,
    title: String(paper?.title || '').trim(),
    abstract,
    authors: Array.isArray(paper?.authors) ? paper.authors.filter(Boolean) : [],
    publishedAt,
    primaryCategory,
    absUrl: `https://arxiv.org/abs/${arxivId}`,
  };
}
