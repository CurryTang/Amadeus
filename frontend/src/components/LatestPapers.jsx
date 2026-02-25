import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const CACHE_KEY = 'latest_papers_cache_v2';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h client-side guard
const PAGE_SIZE = 5;
const SOURCE_LABELS = {
  hf: 'HF Daily',
  alphaxiv: 'AlphaXiv',
  twitter: 'Twitter/X',
  finance: 'Finance',
  arxiv_authors: 'Authors',
  arxiv: 'arXiv',
};

function getFeedItemKey(item) {
  if (!item) return '';
  if (item.itemType === 'finance') {
    return String(item.externalId || item.url || item.title || '').trim();
  }
  return String(item.arxivId || '').trim();
}

function readClientCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, fetchedAt, hasMore, total } = JSON.parse(raw);
    if (Date.now() - fetchedAt > CACHE_TTL_MS) return null;
    return { data, fetchedAt, hasMore, total };
  } catch (_) {
    return null;
  }
}

function writeClientCache(data, fetchedAt, extra = {}) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      data,
      fetchedAt: new Date(fetchedAt).getTime(),
      hasMore: !!extra.hasMore,
      total: Number.isFinite(extra.total) ? extra.total : data.length,
    }));
  } catch (_) {}
}

function PaperCard({ paper, onSave, saving, isAuthenticated }) {
  const abstract = paper.summary || paper.abstract || '';
  const shortAbstract = abstract.length > 140 ? abstract.slice(0, 140) + '…' : abstract;
  const sourceNames = Array.isArray(paper.sourceNames) ? paper.sourceNames.filter(Boolean) : [];
  const sourceTypes = Array.isArray(paper.sourceTypes) ? paper.sourceTypes.filter(Boolean) : [];
  const sourceType = String(paper.sourceType || sourceTypes[0] || '').toLowerCase();
  const primarySourceName = paper.sourceName || sourceNames[0] || SOURCE_LABELS[sourceType] || 'Tracker';
  const extraSourceCount = Math.max(0, sourceNames.length - 1);
  const upvotes = Number(paper.upvotes || 0) || 0;
  const views = Number(paper.views || 0) || 0;
  const isPaperItem = (paper.itemType || 'paper') !== 'finance' && !!paper.arxivId;
  const titleHref = isPaperItem
    ? `https://arxiv.org/abs/${paper.arxivId}`
    : (paper.url || '');

  return (
    <div className={`latest-paper-card ${paper.saved ? 'already-saved' : ''}`}>
      <div className="latest-paper-header">
        <div className="latest-paper-meta">
          <span className="latest-paper-source">
            {primarySourceName}
            {extraSourceCount > 0 ? ` +${extraSourceCount}` : ''}
          </span>
          {upvotes > 0 && (
            <span className="latest-paper-upvotes" title="Source upvotes">
              ▲ {upvotes}
            </span>
          )}
          {upvotes <= 0 && views > 0 && (
            <span className="latest-paper-upvotes" title="AlphaXiv views">
              Views {views}
            </span>
          )}
          {paper.publishedAt && (
            <span className="latest-paper-date">
              {new Date(paper.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
        <div className="latest-paper-actions">
          {isPaperItem && paper.saved ? (
            <span className="latest-paper-saved-badge">Saved</span>
          ) : isPaperItem && isAuthenticated ? (
            <button
              className="latest-paper-save-btn"
              onClick={() => onSave(paper)}
              disabled={saving}
              title="Add to library"
            >
              {saving ? 'Saving…' : '+ Save'}
            </button>
          ) : null}
        </div>
      </div>

      {titleHref ? (
        <a
          className="latest-paper-title"
          href={titleHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          {paper.title}
        </a>
      ) : (
        <span className="latest-paper-title">{paper.title}</span>
      )}

      {paper.authors && paper.authors.length > 0 && (
        <p className="latest-paper-authors">
          {paper.authors.slice(0, 5).join(', ')}
          {paper.authors.length > 5 && ` +${paper.authors.length - 5} more`}
        </p>
      )}

      {abstract && (
        <div className="latest-paper-abstract">
          <p>{shortAbstract}</p>
        </div>
      )}
    </div>
  );
}

function LatestPapers({ apiUrl, isAuthenticated, getAuthHeaders, debug = false }) {
  const [papers, setPapers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [cached, setCached] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [savingIds, setSavingIds] = useState(new Set());

  const fetchFeed = useCallback(async ({
    offset = 0,
    append = false,
    forceRefresh = false,
    forceCrawl = false,
  } = {}) => {
    // Try client-side cache first for initial page only
    if (!append && offset === 0 && !forceRefresh && !forceCrawl && !debug) {
      const clientCache = readClientCache();
      if (clientCache) {
        setPapers(clientCache.data);
        setFetchedAt(clientCache.fetchedAt);
        setHasMore(clientCache.hasMore);
        setTotal(clientCache.total || clientCache.data.length);
        setCached(true);
        return;
      }
    }

    setLoading(true);
    setError(null);
    try {
      const params = {
        limit: PAGE_SIZE,
        offset,
        ...((debug || forceRefresh || forceCrawl) ? { debug: '1' } : {}),
      };
      const res = await axios.get(`${apiUrl}/tracker/feed`, { params });
      const {
        data,
        fetchedAt: ft,
        cached: isCached,
        hasMore: apiHasMore,
        total: apiTotal,
        warming,
        message,
      } = res.data;
      const nextPage = data || [];

      if (warming) {
        setPapers([]);
        setFetchedAt(null);
        setHasMore(false);
        setTotal(0);
        setCached(false);
        setError(message || 'Tracker feed is warming up. Please retry in a few seconds.');
        return;
      }

      if (append) {
        setPapers((prev) => {
          const existing = new Set(prev.map((p) => getFeedItemKey(p)).filter(Boolean));
          const merged = [...prev];
          for (const paper of nextPage) {
            const key = getFeedItemKey(paper);
            if (key && !existing.has(key)) {
              existing.add(key);
              merged.push(paper);
            }
          }
          return merged;
        });
      } else {
        setPapers(nextPage);
      }
      setFetchedAt(ft);
      setHasMore(Boolean(apiHasMore));
      setTotal(Number.isFinite(apiTotal) ? apiTotal : nextPage.length);
      setCached(isCached && !(forceRefresh || forceCrawl));
      if (!append && (!isCached || forceRefresh || forceCrawl)) {
        writeClientCache(nextPage, ft, {
          hasMore: Boolean(apiHasMore),
          total: Number.isFinite(apiTotal) ? apiTotal : nextPage.length,
        });
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load latest papers');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, debug]);

  useEffect(() => {
    fetchFeed({ offset: 0, append: false, forceRefresh: false, forceCrawl: false });
  }, [fetchFeed]);

  const handleSave = async (paper) => {
    if (!isAuthenticated || !paper?.arxivId) return;
    setSavingIds((prev) => new Set([...prev, paper.arxivId]));
    try {
      await axios.post(
        `${apiUrl}/upload/arxiv`,
        { paperId: paper.arxivId, title: paper.title },
        { headers: getAuthHeaders() }
      );
      // Mark as saved in local list
      setPapers((prev) => {
        const next = prev.map((p) => (p.arxivId === paper.arxivId ? { ...p, saved: true } : p));
        if (fetchedAt) {
          writeClientCache(next, fetchedAt, { hasMore, total });
        }
        return next;
      });
    } catch (e) {
      console.error('Save paper error:', e);
      alert(e.response?.data?.error || 'Failed to save paper');
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(paper.arxivId);
        return next;
      });
    }
  };

  const handleForceRefresh = () => {
    localStorage.removeItem(CACHE_KEY);
    setPapers([]);
    setHasMore(false);
    setTotal(0);
    fetchFeed({ offset: 0, append: false, forceRefresh: true, forceCrawl: true });
  };

  const handleLoadMore = () => {
    if (loading || !hasMore) return;
    fetchFeed({
      offset: papers.length,
      append: true,
      forceRefresh: false,
      forceCrawl: false,
    });
  };

  return (
    <div className="latest-papers-container">
      <div className="latest-papers-toolbar">
        <div className="latest-papers-toolbar-info">
          {fetchedAt && (
            <span className="latest-papers-cache-info">
              {cached ? 'Cached' : 'Live'} · updated {new Date(fetchedAt).toLocaleString()}
              {` · showing ${papers.length}${total ? `/${total}` : ''}`}
            </span>
          )}
        </div>
        <button
          className="latest-refresh-btn"
          onClick={handleForceRefresh}
          disabled={loading}
          title={debug ? 'Debug mode: always live' : 'Force refresh (bypasses 24h cache)'}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button
            onClick={() => fetchFeed({
              offset: 0,
              append: false,
              forceRefresh: true,
              forceCrawl: true,
            })}
          >
            Retry
          </button>
        </div>
      )}

      {loading && papers.length === 0 && (
        <div className="latest-papers-loading">
          <div className="spinner" />
          <p>Loading today's papers…</p>
        </div>
      )}

      {!loading && papers.length === 0 && !error && (
        <div className="empty-state">
          <p>No tracker items found</p>
          <p className="hint">Add tracker sources to start seeing research, Twitter, or finance updates.</p>
        </div>
      )}

      <div className="latest-papers-list">
        {papers.map((paper, idx) => (
          <PaperCard
            key={getFeedItemKey(paper) || `${paper.title || 'item'}-${idx}`}
            paper={paper}
            onSave={handleSave}
            saving={savingIds.has(paper.arxivId)}
            isAuthenticated={isAuthenticated}
          />
        ))}
      </div>

      {!error && papers.length > 0 && hasMore && (
        <div className="load-more-container">
          <button
            className="load-more-btn"
            onClick={handleLoadMore}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Load More'}
          </button>
        </div>
      )}
    </div>
  );
}

export default LatestPapers;
