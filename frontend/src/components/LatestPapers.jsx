import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import {
  clearLatestPapersSession,
  readLatestPapersSession,
  resolveLatestPapersSessionUpdate,
  shouldTreatTrackerFetchAsManualRefresh,
  writeLatestPapersSession,
} from './latestPapersSession.js';
import { buildArxivSavePayload } from './latestPaperSavePayload.js';

const CACHE_BACKGROUND_REFRESH_GAP_MS = 25 * 1000; // avoid repeated revalidate bursts
const CATEGORY_FILTER_KEY = 'tracker_category_filter_v2';
const TRACKER_ANON_SESSION_KEY = 'tracker_anon_session_id_v1';
const SHOW_SAVED_KEY = 'tracker_show_saved_v1';
const PAGE_SIZE = 20;
const SOURCE_LABELS = {
  hf: 'HF Daily',
  alphaxiv: 'AlphaXiv',
  twitter: 'Twitter/X',
  rss: 'RSS/Blogs',
  finance: 'Finance',
  arxiv_authors: 'Authors',
  arxiv: 'arXiv',
};
const CATEGORY_ORDER = ['hf', 'alphaxiv', 'arxiv_authors', 'twitter', 'rss', 'finance'];

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
  if (item.itemType === 'finance' || item.itemType === 'article') {
    return String(item.externalId || item.url || item.title || '').trim();
  }
  return String(item.arxivId || '').trim();
}

function buildTrackerEventPayload(type, paper, extra = {}) {
  if (!paper) return null;
  const itemKey = getFeedItemKey(paper);
  if (!itemKey) return null;
  const abstract = String(paper.summary || paper.abstract || '').trim();
  return {
    type,
    itemKey,
    itemType: String(paper.itemType || (paper.arxivId ? 'paper' : 'article')).toLowerCase(),
    arxivId: paper.arxivId || '',
    externalId: paper.externalId || '',
    url: paper.url || '',
    sourceType: paper.sourceType || '',
    sourceName: paper.sourceName || (Array.isArray(paper.sourceNames) ? paper.sourceNames[0] : '') || '',
    title: paper.title || '',
    abstract: abstract.length > 1200 ? `${abstract.slice(0, 1200)}…` : abstract,
    authors: Array.isArray(paper.authors) ? paper.authors.slice(0, 8) : [],
    position: Number.isFinite(Number(extra.position)) ? Number(extra.position) : 0,
    score: Number(paper.score || 0) || 0,
  };
}

function partitionSavedOrReadToEnd(items = []) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const active = [];
  const deprioritized = [];
  for (const item of items) {
    if (item?.saved || item?.isRead) deprioritized.push(item);
    else active.push(item);
  }
  return [...active, ...deprioritized];
}

function PaperCard({ paper, onSave, onOpen, saving, isAuthenticated, position }) {
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
  const canSave = Boolean(
    isAuthenticated
    && String(paper.itemType || '').toLowerCase() !== 'finance'
    && (paper.arxivId || paper.url)
  );
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
          {canSave && paper.saved ? (
            <span className="latest-paper-saved-badge">Saved</span>
          ) : canSave ? (
            <button
              className="latest-paper-save-btn"
              onClick={() => onSave(paper, position)}
              disabled={saving}
              title={paper.arxivId ? 'Add paper to library' : 'Save article to library'}
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
          onClick={() => onOpen(paper, position)}
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
  const [newFeedAvailable, setNewFeedAvailable] = useState(false);
  const [savingKeys, setSavingKeys] = useState(new Set());
  const [shuffled, setShuffled] = useState(false);
  const impressionEventKeysRef = useRef(new Set());
  const eventsEndpointUnavailableRef = useRef(false);
  const papersCountRef = useRef(0);
  const lastBackgroundRefreshAtRef = useRef(0);
  const currentSessionRef = useRef({
    papers: [],
    fetchedAt: 0,
    hasMore: false,
    total: 0,
    snapshotId: '',
  });
  const anonSessionId = useMemo(() => {
    if (isAuthenticated) return '';
    try {
      const existing = localStorage.getItem(TRACKER_ANON_SESSION_KEY);
      if (existing && /^[a-z0-9_-]{8,80}$/i.test(existing)) return existing.toLowerCase();
      const generated = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.slice(0, 40).toLowerCase();
      localStorage.setItem(TRACKER_ANON_SESSION_KEY, generated);
      return generated;
    } catch (_) {
      return '';
    }
  }, [isAuthenticated]);

  // Filters
  const [activeCategory, setActiveCategory] = useState(() => {
    try { return localStorage.getItem(CATEGORY_FILTER_KEY) || ''; } catch (_) { return ''; }
  });
  const [keywordSearch, setKeywordSearch] = useState('');
  const [showSaved, setShowSaved] = useState(() => {
    try { return localStorage.getItem(SHOW_SAVED_KEY) === '1'; } catch (_) { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(CATEGORY_FILTER_KEY, activeCategory); } catch (_) {}
  }, [activeCategory]);

  useEffect(() => {
    try { localStorage.setItem(SHOW_SAVED_KEY, showSaved ? '1' : '0'); } catch (_) {}
  }, [showSaved]);

  useEffect(() => {
    papersCountRef.current = papers.length;
  }, [papers.length]);

  useEffect(() => {
    currentSessionRef.current = {
      papers,
      fetchedAt: fetchedAt ? new Date(fetchedAt).getTime() : 0,
      hasMore,
      total,
      snapshotId: currentSessionRef.current.snapshotId || '',
    };
  }, [fetchedAt, hasMore, papers, total]);

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
    if (!showSaved) {
      result = result.filter((p) => !p?.saved);
    }
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
  }, [papers, showSaved, activeCategory, keywordSearch]);

  const isFiltered = !!(activeCategory || keywordSearch.trim());

  const [sortOrder, setSortOrder] = useState('default'); // 'default' | 'newest' | 'oldest'

  const sortedFilteredPapers = useMemo(() => {
    const ordered = partitionSavedOrReadToEnd(filteredPapers);
    if (sortOrder === 'default') return ordered;
    const byDate = (a, b) => {
      const ta = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
      const tb = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
      return sortOrder === 'newest' ? tb - ta : ta - tb;
    };
    const active = ordered.filter((item) => !item?.saved && !item?.isRead).sort(byDate);
    const deprioritized = ordered.filter((item) => item?.saved || item?.isRead).sort(byDate);
    return [...active, ...deprioritized];
  }, [filteredPapers, sortOrder]);

  const trackEvents = useCallback(async (events = []) => {
    if (eventsEndpointUnavailableRef.current) return;
    const payloadEvents = (Array.isArray(events) ? events : []).filter(Boolean);
    if (payloadEvents.length === 0) return;
    const requestBody = {
      events: payloadEvents,
      ...(anonSessionId ? { anonSessionId } : {}),
    };
    try {
      if (isAuthenticated) {
        await axios.post(`${apiUrl}/tracker/events`, requestBody, { headers: getAuthHeaders() });
      } else {
        await axios.post(`${apiUrl}/tracker/events`, requestBody);
      }
    } catch (error) {
      const status = Number(error?.response?.status || 0);
      if ([404, 405, 410, 501].includes(status)) {
        eventsEndpointUnavailableRef.current = true;
      }
      // Personalization telemetry should never block UX.
    }
  }, [apiUrl, anonSessionId, getAuthHeaders, isAuthenticated]);

  const fetchFeed = useCallback(async ({
    offset = 0,
    append = false,
    forceRefresh = false,
    forceCrawl = false,
    shuffle = false,
    background = false,
  } = {}) => {
    // Stale-while-revalidate for first page: serve client cache immediately.
    if (!append && offset === 0 && !forceRefresh && !forceCrawl && !debug) {
      const clientCache = readLatestPapersSession(undefined, { allowStale: false });
      if (clientCache?.papers?.length) {
        currentSessionRef.current = {
          papers: clientCache.papers,
          fetchedAt: clientCache.fetchedAt,
          hasMore: Boolean(clientCache.hasMore),
          total: clientCache.total || clientCache.papers.length,
          snapshotId: String(clientCache.snapshotId || '').trim(),
        };
        setPapers(clientCache.papers);
        setFetchedAt(clientCache.fetchedAt);
        setHasMore(Boolean(clientCache.hasMore));
        setTotal(clientCache.total || clientCache.papers.length);
        setCached(true);
        if (
          clientCache.isSoftExpired
          && !background
          && (Date.now() - lastBackgroundRefreshAtRef.current) > CACHE_BACKGROUND_REFRESH_GAP_MS
        ) {
          lastBackgroundRefreshAtRef.current = Date.now();
          fetchFeed({
            offset: 0,
            append: false,
            forceRefresh: false,
            forceCrawl: false,
            background: true,
          });
        }
        return;
      }
    }

    if (!background) {
      setLoading(true);
      setError(null);
    }
    try {
      const params = {
        limit: PAGE_SIZE,
        offset,
        ...((debug || forceRefresh || forceCrawl) ? { debug: '1' } : {}),
        ...(shuffle && offset === 0 ? { shuffle: '1' } : {}),
        ...(currentSessionRef.current.snapshotId ? { snapshotId: currentSessionRef.current.snapshotId } : {}),
        ...(!isAuthenticated && anonSessionId ? { anonSessionId } : {}),
      };
      const res = await axios.get(`${apiUrl}/tracker/feed`, { params });
      const {
        data,
        fetchedAt: ft,
        snapshotId,
        snapshotChanged,
        cached: isCached,
        hasMore: apiHasMore,
        total: apiTotal,
        warming,
        message,
        shuffled: isShuffled,
      } = res.data;
      const nextPage = data || [];

      if (warming) {
        if (background && papersCountRef.current > 0) return;
        setPapers([]);
        setFetchedAt(null);
        setHasMore(false);
        setTotal(0);
        setCached(false);
        setError(message || 'Tracker feed is warming up. Please retry in a few seconds.');
        return;
      }

      const incomingSession = {
        papers: nextPage,
        fetchedAt: ft ? new Date(ft).getTime() : Date.now(),
        hasMore: Boolean(apiHasMore),
        total: Number.isFinite(apiTotal) ? apiTotal : nextPage.length,
        snapshotId: String(snapshotId || '').trim(),
      };
      const resolved = resolveLatestPapersSessionUpdate({
        currentSession: currentSessionRef.current,
        incomingSession,
        append,
        background,
        manualRefresh: shouldTreatTrackerFetchAsManualRefresh({
          background,
          forceRefresh,
          forceCrawl,
          shuffle,
        }),
      });
      const visibleSession = resolved.session || incomingSession;
      currentSessionRef.current = visibleSession;

      setPapers(visibleSession.papers);
      setFetchedAt(visibleSession.fetchedAt);
      setHasMore(Boolean(visibleSession.hasMore));
      setTotal(Number.isFinite(visibleSession.total) ? visibleSession.total : visibleSession.papers.length);
      setCached(isCached && !(forceRefresh || forceCrawl));
      if (!append && resolved.replaced) setShuffled(Boolean(isShuffled));
      if (forceRefresh || forceCrawl || resolved.replaced || append) {
        setNewFeedAvailable(false);
      } else if (resolved.newFeedAvailable || snapshotChanged) {
        setNewFeedAvailable(true);
      }
      writeLatestPapersSession(undefined, visibleSession);
    } catch (e) {
      if (background) return;
      if (!append && offset === 0) {
        const fallbackCache = readLatestPapersSession(undefined, { allowStale: true });
        if (fallbackCache?.papers?.length) {
          currentSessionRef.current = {
            papers: fallbackCache.papers,
            fetchedAt: fallbackCache.fetchedAt,
            hasMore: Boolean(fallbackCache.hasMore),
            total: fallbackCache.total || fallbackCache.papers.length,
            snapshotId: String(fallbackCache.snapshotId || '').trim(),
          };
          setPapers(fallbackCache.papers);
          setFetchedAt(fallbackCache.fetchedAt);
          setHasMore(Boolean(fallbackCache.hasMore));
          setTotal(fallbackCache.total || fallbackCache.papers.length);
          setCached(true);
          setError(`${formatFeedError(e, 'Failed to load latest papers')} Showing recent cached results.`);
          return;
        }
      }
      setError(formatFeedError(e, 'Failed to load latest papers'));
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }, [apiUrl, anonSessionId, debug, isAuthenticated]);

  useEffect(() => {
    fetchFeed({ offset: 0, append: false, forceRefresh: false, forceCrawl: false });
  }, [fetchFeed]);

  useEffect(() => {
    if (!fetchedAt || sortedFilteredPapers.length === 0) return;
    const fetchStamp = String(new Date(fetchedAt).getTime() || fetchedAt);
    const events = [];
    sortedFilteredPapers.forEach((paper, index) => {
      const key = getFeedItemKey(paper);
      if (!key) return;
      const eventKey = `${fetchStamp}:${key}`;
      if (impressionEventKeysRef.current.has(eventKey)) return;
      impressionEventKeysRef.current.add(eventKey);
      events.push(buildTrackerEventPayload('impression', paper, { position: index + 1 }));
    });
    if (impressionEventKeysRef.current.size > 6000) {
      impressionEventKeysRef.current.clear();
    }
    if (events.length > 0) {
      trackEvents(events);
    }
  }, [fetchedAt, sortedFilteredPapers, trackEvents]);

  const handleSave = async (paper, position = 0) => {
    if (!isAuthenticated) return;
    const saveKey = getFeedItemKey(paper);
    if (!saveKey) return;
    setSavingKeys((prev) => new Set([...prev, saveKey]));
    try {
      if (paper?.arxivId) {
        const payload = buildArxivSavePayload(paper);
        if (!payload) {
          return;
        }
        await axios.post(
          `${apiUrl}/upload/arxiv`,
          payload,
          { headers: getAuthHeaders() }
        );
      } else if (paper?.url) {
        const sourceLabel = paper.sourceName
          || (Array.isArray(paper.sourceNames) ? paper.sourceNames[0] : '')
          || 'tracker';
        await axios.post(
          `${apiUrl}/upload/webpage`,
          {
            url: paper.url,
            title: paper.title,
            type: 'blog',
            tags: ['tracker:rss', `source:${String(sourceLabel).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`],
            notes: paper.summary || paper.abstract || '',
          },
          { headers: getAuthHeaders() }
        );
      } else {
        return;
      }
      // Mark as saved in local list
      setPapers((prev) => {
        const next = prev.map((p) => (
          getFeedItemKey(p) === saveKey ? { ...p, saved: true } : p
        ));
        if (fetchedAt) {
          writeLatestPapersSession(undefined, {
            papers: next,
            fetchedAt: new Date(fetchedAt).getTime(),
            hasMore,
            total,
          });
        }
        return next;
      });
      const saveEvent = buildTrackerEventPayload('save', paper, { position });
      if (saveEvent) trackEvents([saveEvent]);
    } catch (e) {
      console.error('Save paper error:', e);
      alert(e.response?.data?.error || 'Failed to save paper');
    } finally {
      setSavingKeys((prev) => {
        const next = new Set(prev);
        next.delete(saveKey);
        return next;
      });
    }
  };

  const handleOpen = useCallback((paper, position = 0) => {
    const openEvent = buildTrackerEventPayload('open', paper, { position });
    if (openEvent) trackEvents([openEvent]);
  }, [trackEvents]);

  const handleForceRefresh = () => {
    clearLatestPapersSession();
    localStorage.removeItem('latest_papers_cache_v4');
    localStorage.removeItem('latest_papers_cache_v5');
    setPapers([]);
    setHasMore(false);
    setTotal(0);
    setShuffled(false);
    setNewFeedAvailable(false);
    currentSessionRef.current = {
      papers: [],
      fetchedAt: 0,
      hasMore: false,
      total: 0,
      snapshotId: '',
    };
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
          <label
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13 }}
            title="Show papers already saved to your library"
          >
            <input
              type="checkbox"
              checked={showSaved}
              onChange={(e) => setShowSaved(e.target.checked)}
            />
            Show Saved
          </label>
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
              {newFeedAvailable && <span className="latest-shuffled-badge"> · New items available</span>}
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
          {!showSaved && papers.some((p) => p?.saved) && !isFiltered ? (
            <>
              <p>Saved papers are hidden</p>
              <p className="hint">Enable <strong>Show Saved</strong> to view them.</p>
            </>
          ) : isFiltered ? (
            <>
              <p>No papers match the current filter</p>
              <p className="hint">Try a different keyword or source.</p>
            </>
          ) : (
            <>
              <p>No tracker items found</p>
              <p className="hint">Add tracker sources to start seeing research, Twitter, RSS, or finance updates.</p>
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
            onOpen={handleOpen}
            saving={savingKeys.has(getFeedItemKey(paper))}
            isAuthenticated={isAuthenticated}
            position={idx + 1}
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
