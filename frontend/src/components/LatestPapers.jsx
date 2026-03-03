import { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';

const CACHE_KEY = 'latest_papers_cache_v2';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h client-side guard
const CATEGORY_FILTER_KEY = 'tracker_category_filter';
const PAGE_SIZE = 5;
const SOURCE_LABELS = {
  hf: 'HF Daily',
  alphaxiv: 'AlphaXiv',
  twitter: 'Twitter/X',
  finance: 'Finance',
  arxiv_authors: 'Authors',
  arxiv: 'arXiv',
};
const CATEGORY_ORDER = ['hf', 'alphaxiv', 'arxiv_authors', 'twitter', 'finance'];

function formatFeedError(error, fallback = 'Failed to load latest papers') {
  const status = Number(error?.response?.status || 0);
  const apiMessage = String(error?.response?.data?.error || '').trim();
  if (status === 504) {
    return 'Tracker feed timed out (504). Please retry in a few seconds and check Tracker source errors.';
  }
  return apiMessage || error?.message || fallback;
}

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
  const [shuffled, setShuffled] = useState(false);

  // Filters
  const [activeCategory, setActiveCategory] = useState(() => {
    try { return localStorage.getItem(CATEGORY_FILTER_KEY) || ''; } catch (_) { return ''; }
  });
  const [keywordSearch, setKeywordSearch] = useState('');

  useEffect(() => {
    try { localStorage.setItem(CATEGORY_FILTER_KEY, activeCategory); } catch (_) {}
  }, [activeCategory]);

  const availableCategories = useMemo(() => {
    const counts = {};
    for (const p of papers) {
      const types = new Set([
        String(p.sourceType || '').toLowerCase(),
        ...(p.sourceTypes || []).map((t) => String(t).toLowerCase()),
      ].filter(Boolean));
      for (const t of types) counts[t] = (counts[t] || 0) + 1;
    }
    return CATEGORY_ORDER.filter((t) => counts[t] > 0);
  }, [papers]);

  const filteredPapers = useMemo(() => {
    let result = papers;
    if (activeCategory) {
      result = result.filter((p) => {
        const primary = String(p.sourceType || '').toLowerCase();
        const all = (p.sourceTypes || []).map((t) => String(t).toLowerCase());
        return primary === activeCategory || all.includes(activeCategory);
      });
    }
    if (keywordSearch.trim()) {
      const kw = keywordSearch.trim().toLowerCase();
      result = result.filter((p) => {
        const text = `${p.title || ''} ${p.abstract || ''} ${(p.authors || []).join(' ')}`.toLowerCase();
        return text.includes(kw);
      });
    }
    return result;
  }, [papers, activeCategory, keywordSearch]);

  const isFiltered = !!(activeCategory || keywordSearch.trim());

  const [sortOrder, setSortOrder] = useState('default'); // 'default' | 'newest' | 'oldest'

  const sortedFilteredPapers = useMemo(() => {
    if (sortOrder === 'default') return filteredPapers;
    return [...filteredPapers].sort((a, b) => {
      const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return sortOrder === 'newest' ? tb - ta : ta - tb;
    });
  }, [filteredPapers, sortOrder]);

  const fetchFeed = useCallback(async ({
    offset = 0,
    append = false,
    forceRefresh = false,
    forceCrawl = false,
    shuffle = false,
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
        ...(shuffle && offset === 0 ? { shuffle: '1' } : {}),
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
        shuffled: isShuffled,
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
      if (!append) setShuffled(Boolean(isShuffled));
      // Always write client cache on initial page load (not append).
      // Previously this was skipped when server returned cached:true, which
      // meant every tab switch re-fetched from the server instead of using
      // the 24h localStorage cache.
      if (!append) {
        writeClientCache(nextPage, ft, {
          hasMore: Boolean(apiHasMore),
          total: Number.isFinite(apiTotal) ? apiTotal : nextPage.length,
        });
      }
    } catch (e) {
      setError(formatFeedError(e, 'Failed to load latest papers'));
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
    setShuffled(false);
    fetchFeed({ offset: 0, append: false, forceRefresh: true, forceCrawl: true, shuffle: true });
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

  const displayCount = isFiltered
    ? `${sortedFilteredPapers.length}/${papers.length}`
    : `${papers.length}${total ? `/${total}` : ''}`;

  return (
    <div className="latest-papers-container">
      <div className="latest-papers-toolbar">
        <div className="latest-papers-toolbar-left">
          <select
            className="latest-category-select"
            value={activeCategory}
            onChange={(e) => setActiveCategory(e.target.value)}
            title="Filter by source"
          >
            <option value="">All Sources</option>
            {availableCategories.map((type) => (
              <option key={type} value={type}>{SOURCE_LABELS[type] || type}</option>
            ))}
          </select>
          <input
            className="latest-keyword-input"
            type="text"
            placeholder="Search…"
            value={keywordSearch}
            onChange={(e) => setKeywordSearch(e.target.value)}
          />
          <select
            className="latest-category-select"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            title="Sort order"
          >
            <option value="default">By Relevance</option>
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
          </select>
          {isFiltered && (
            <button
              className="latest-filter-clear"
              onClick={() => { setActiveCategory(''); setKeywordSearch(''); }}
              title="Clear filters"
            >×</button>
          )}
        </div>
        <div className="latest-papers-toolbar-info">
          {fetchedAt && (
            <span className="latest-papers-cache-info">
              {cached ? 'Cached' : 'Live'} · {new Date(fetchedAt).toLocaleString()}
              {` · ${displayCount}`}
              {shuffled && <span className="latest-shuffled-badge"> · Reordered</span>}
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

      {!loading && sortedFilteredPapers.length === 0 && !error && (
        <div className="empty-state">
          {isFiltered ? (
            <>
              <p>No papers match the current filter</p>
              <p className="hint">Try a different keyword or source.</p>
            </>
          ) : (
            <>
              <p>No tracker items found</p>
              <p className="hint">Add tracker sources to start seeing research, Twitter, or finance updates.</p>
            </>
          )}
        </div>
      )}

      <div className="latest-papers-list">
        {sortedFilteredPapers.map((paper, idx) => (
          <PaperCard
            key={getFeedItemKey(paper) || `${paper.title || 'item'}-${idx}`}
            paper={paper}
            onSave={handleSave}
            saving={savingIds.has(paper.arxivId)}
            isAuthenticated={isAuthenticated}
          />
        ))}
      </div>

      {!error && !isFiltered && papers.length > 0 && hasMore && (
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
