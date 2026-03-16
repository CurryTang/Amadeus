'use client';

import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Theme, Tabs, Button } from '@radix-ui/themes';
import DocumentList from './components/DocumentList';
import NotesModal from './components/NotesModal';
import UserNotesModal from './components/UserNotesModal';
import LoginPage from './components/LoginPage';
import SshServersAdmin from './components/SshServersAdmin';
import TrackerAdmin from './components/TrackerAdmin';
import LibrarySettingsModal from './components/LibrarySettingsModal';
import ObsidianBatchPanel from './components/ObsidianBatchPanel';
import LatestPapers from './components/LatestPapers';
import SendModal from './components/SendModal';
import ArisWorkspace from './components/aris/ArisWorkspace';
import SessionMirror from './components/session-mirror/SessionMirror';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { useAiNotesSettings } from './hooks/useAiNotesSettings';
import { useObsidianExportBatch } from './hooks/useObsidianExportBatch';
import { resolveApiConfig } from './lib/apiConfig';

// API URL strategy:
// - Development: prefer local proxy (/api) unless overridden with NEXT_PUBLIC_DEV_API_URL.
// - Production: use NEXT_PUBLIC_API_URL when provided, otherwise default public endpoint.
const importMetaEnv = import.meta.env || {};
const viteEnv = {
  MODE: importMetaEnv.MODE,
  VITE_DEV_API_URL: importMetaEnv.VITE_DEV_API_URL,
  VITE_API_URL: importMetaEnv.VITE_API_URL,
  VITE_API_TIMEOUT_MS: importMetaEnv.VITE_API_TIMEOUT_MS,
};
const processEnv = {
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_DEV_API_URL: process.env.NEXT_PUBLIC_DEV_API_URL,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_API_TIMEOUT_MS: process.env.NEXT_PUBLIC_API_TIMEOUT_MS,
};
const {
  isDev: IS_DEV,
  apiUrl: API_URL,
  timeoutMs: API_TIMEOUT_MS,
} = resolveApiConfig({ processEnv, viteEnv });

function getApiErrorMessage(err, fallback) {
  if (err?.response?.status === 500) {
    return 'Backend API unavailable. Start backend with: cd backend && npm run dev';
  }
  if (err?.response?.status === 504) {
    return 'Backend query timed out. Retry in a few seconds.';
  }
  if (err?.code === 'ECONNABORTED') {
    return `Request timed out after ${Math.round(API_TIMEOUT_MS / 1000)}s. Please retry.`;
  }
  if (err?.message?.includes('Network Error')) {
    return 'Cannot connect to backend API.';
  }
  return err?.response?.data?.error || err?.response?.data?.message || err?.message || fallback;
}

function AppContent() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [initialNotesTab, setInitialNotesTab] = useState('paper');
  const [userNotesDocument, setUserNotesDocument] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [allTags, setAllTags] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [readFilter, setReadFilter] = useState('unread'); // 'all', 'unread', 'read'
  const [sortOrder, setSortOrder] = useState('newest'); // 'newest', 'oldest', 'alpha'
  const [showFilters, setShowFilters] = useState(false);

  // Research mode state
  const [researchMode, setResearchMode] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState(new Set());
  const [researchSourceType, setResearchSourceType] = useState('pdf');
  const [researchIncludeCode, setResearchIncludeCode] = useState(true);
  const [useMathpix, setUseMathpix] = useState(false);
  const [researchDownloading, setResearchDownloading] = useState(false);
  const [showPaperList, setShowPaperList] = useState(false);
  const [paperListText, setPaperListText] = useState('');
  const [showSendModal, setShowSendModal] = useState(false);
  const [showSshAdmin, setShowSshAdmin] = useState(false);
  const [showTrackerAdmin, setShowTrackerAdmin] = useState(false);
  const [showAiSettings, setShowAiSettings] = useState(false);

  // Main area tab: 'latest' | 'library'
  const [activeArea, setActiveArea] = useState('latest');

  const { isAuthenticated, isLoading: authLoading, username, logout, getAuthHeaders } = useAuth();

  const {
    rounds, saveRounds,
    provider, model, thinkingBudget, reasoningEffort, saveProviderSettings,
    autoGenerate, saveAutoGenerate,
    vaultHandle, vaultName, vaultReady, connectVault, disconnectVault, exportToVault,
  } = useAiNotesSettings();

  const { batchItems, addToBatch, clearCompleted, clearAll, retryItem, restoreItems, syncFromBackend, pollNow } = useObsidianExportBatch({
    apiUrl: API_URL,
    getAuthHeaders,
    exportToVault,
  });

  const LIMIT = 5;

  // Debounced search value
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceTimer = useRef(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(debounceTimer.current);
  }, [searchQuery]);

  // Build API params from current filter state
  const buildParams = (offsetVal) => {
    const apiSort = sortOrder === 'alpha' ? 'title' : 'createdAt';
    const apiOrder = sortOrder === 'oldest' ? 'asc' : (sortOrder === 'alpha' ? 'asc' : 'desc');
    const params = { limit: LIMIT, offset: offsetVal, sort: apiSort, order: apiOrder };
    if (debouncedSearch) params.search = debouncedSearch;
    if (readFilter !== 'all') params.readFilter = readFilter;
    if (selectedTag) params.tags = selectedTag;
    return params;
  };

  // Fetch docs on mount and when any server-side filter changes
  const fetchIdRef = useRef(0);

  useEffect(() => {
    if (!isAuthenticated) return;
    const id = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    axios.get(`${API_URL}/documents`, {
      params: buildParams(0),
      headers: getAuthHeaders(),
      timeout: API_TIMEOUT_MS,
    })
      .then(response => {
        if (fetchIdRef.current !== id) return; // stale request
        const { documents: newDocs = [], hasMore: apiHasMore } = response.data;
        setDocuments(newDocs);
        setOffset(newDocs.length);
        setHasMore(typeof apiHasMore === 'boolean' ? apiHasMore : newDocs.length === LIMIT);
      })
      .catch(err => {
        if (fetchIdRef.current !== id) return;
        console.error('Failed to fetch documents:', err);
        setError(getApiErrorMessage(err, 'Failed to fetch documents'));
      })
      .finally(() => {
        if (fetchIdRef.current === id) setLoading(false);
      });
  }, [sortOrder, debouncedSearch, readFilter, selectedTag, refreshTrigger, isAuthenticated]);

  // Load more (append)
  const loadMore = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const response = await axios.get(`${API_URL}/documents`, {
        params: buildParams(offset),
        timeout: API_TIMEOUT_MS,
      });
      const { documents: newDocs = [], hasMore: apiHasMore } = response.data;
      setDocuments(prev => [...prev, ...newDocs]);
      setOffset(prev => prev + newDocs.length);
      setHasMore(typeof apiHasMore === 'boolean' ? apiHasMore : newDocs.length === LIMIT);
    } catch (err) {
      console.error('Failed to load more:', err);
      setError(getApiErrorMessage(err, 'Failed to load more'));
    } finally {
      setLoading(false);
    }
  };

  // Fetch available tags
  const fetchTags = async () => {
    try {
      const response = await axios.get(`${API_URL}/tags`, { timeout: API_TIMEOUT_MS });
      setAllTags(response.data.tags || []);
    } catch (err) {
      console.error('Failed to fetch tags:', err);
    }
  };

  // Fetch tags once on mount (only when authenticated)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (isAuthenticated) fetchTags(); }, [isAuthenticated]);

  // Block the entire app until authenticated (after all hooks)
  if (authLoading) return <div className="login-page"><div className="login-page-card" style={{textAlign:'center',color:'#6b7280'}}>Loading…</div></div>;
  if (!isAuthenticated) return <LoginPage />;

  // Documents are already filtered and sorted by the backend
  const filteredDocuments = documents;

  // Get download URL for a document
  const getDownloadUrl = async (document) => {
    try {
      const response = await axios.get(`${API_URL}/documents/${document.id}/download`);
      return response.data.downloadUrl;
    } catch (err) {
      console.error('Failed to get download URL:', err);
      throw err;
    }
  };

  // Toggle read status for a document (requires auth)
  const toggleReadStatus = async (document) => {

    try {
      const response = await axios.patch(
        `${API_URL}/documents/${document.id}/read`,
        {},
        { headers: getAuthHeaders() }
      );
      const { isRead } = response.data;

      // Update the document in state
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === document.id ? { ...doc, isRead } : doc
        )
      );

      return isRead;
    } catch (err) {
      console.error('Failed to toggle read status:', err);
      if (err.response?.status === 401 || err.response?.status === 403) {
      }
      throw err;
    }
  };

  // Trigger code analysis for a document (requires auth)
  const triggerCodeAnalysis = async (document) => {

    try {
      const response = await axios.post(
        `${API_URL}/code-analysis/${document.id}`,
        {},
        { headers: getAuthHeaders() }
      );

      // Update the document in state with new status
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === document.id ? { ...doc, codeAnalysisStatus: 'queued' } : doc
        )
      );

      return response.data;
    } catch (err) {
      console.error('Failed to trigger code analysis:', err);

      if (err.response?.status === 401 || err.response?.status === 403) {
        throw new Error('Authentication required');
      }

      const message = err.response?.data?.message || err.response?.data?.error || 'Failed to queue analysis';

      // If already in progress, update the UI to show processing state
      if (message.includes('already in progress')) {
        setDocuments((prev) =>
          prev.map((doc) =>
            doc.id === document.id ? { ...doc, codeAnalysisStatus: 'processing' } : doc
          )
        );
        // Don't throw error, just return
        return { success: false, message };
      }

      const error = new Error(message);
      error.response = err.response;
      throw error;
    }
  };

  // Update tags for a document (requires auth)
  const updateDocumentTags = async (document, newTags) => {

    try {
      // Update document tags
      await axios.put(
        `${API_URL}/documents/${document.id}`,
        { tags: newTags },
        { headers: getAuthHeaders() }
      );

      // Register any new tag names in the tags table
      if (newTags.length > 0) {
        await axios.post(
          `${API_URL}/tags/bulk`,
          { names: newTags },
          { headers: getAuthHeaders() }
        ).catch(() => {}); // Non-critical, don't fail if bulk create fails
      }

      // Update the document in local state
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === document.id ? { ...doc, tags: newTags } : doc
        )
      );

      // Refresh tags list so new tags appear in filter
      fetchTags();
    } catch (err) {
      console.error('Failed to update tags:', err);
      if (err.response?.status === 401 || err.response?.status === 403) {
      }
      throw err;
    }
  };

  // Update title for a document (requires auth)
  const updateDocumentTitle = async (document, newTitle) => {
    const title = String(newTitle || '').trim();
    if (!title) {
      throw new Error('Title cannot be empty');
    }

    try {
      await axios.put(
        `${API_URL}/documents/${document.id}`,
        { title },
        { headers: getAuthHeaders() }
      );

      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === document.id ? { ...doc, title } : doc
        )
      );
      setSelectedDocument((prev) => (
        prev && prev.id === document.id ? { ...prev, title } : prev
      ));
      setUserNotesDocument((prev) => (
        prev && prev.id === document.id ? { ...prev, title } : prev
      ));
    } catch (err) {
      console.error('Failed to update title:', err);
      if (err.response?.status === 401 || err.response?.status === 403) {
      }
      const message = err.response?.data?.error || err.response?.data?.message || 'Failed to update title';
      throw new Error(message);
    }
  };

  // Delete a document (requires auth)
  const deleteDocument = async (document) => {

    try {
      await axios.delete(
        `${API_URL}/documents/${document.id}`,
        { headers: getAuthHeaders() }
      );

      // Remove the document from state
      setDocuments((prev) => prev.filter((doc) => doc.id !== document.id));
    } catch (err) {
      console.error('Failed to delete document:', err);
      if (err.response?.status === 401 || err.response?.status === 403) {
      }
      throw err;
    }
  };

  // Research mode helpers
  const toggleResearchMode = () => {
    if (researchMode) {
      // Exiting research mode
      setResearchMode(false);
      setSelectedDocIds(new Set());
    } else {
      setResearchMode(true);
      setSelectedDocIds(new Set());
    }
  };

  const toggleDocSelect = (docId) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedDocIds(new Set(filteredDocuments.map((d) => d.id)));
  };

  // Download batch research knowledge pack
  const downloadResearchPack = async () => {
    if (selectedDocIds.size === 0) return;
    setResearchDownloading(true);
    try {
      const response = await axios.post(
        `${API_URL}/documents/research-pack`,
        {
          documentIds: Array.from(selectedDocIds),
          sourceType: researchSourceType,
          includeCode: researchIncludeCode,
          useMathpix: researchSourceType === 'latex' ? useMathpix : false,
        },
        {
          headers: getAuthHeaders(),
          responseType: 'blob',
          timeout: 600000, // 10 min for large batch
        }
      );

      const blob = new Blob([response.data], { type: 'application/zip' });
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      const filename = response.headers['content-disposition']
        ?.match(/filename="?(.+?)"?$/)?.[1]
        || `research_pack_${selectedDocIds.size}_papers.zip`;
      a.href = url;
      a.download = filename;
      window.document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      // Exit research mode after successful download
      setResearchMode(false);
      setSelectedDocIds(new Set());
    } catch (err) {
      console.error('Failed to download research pack:', err);
      if (err.response?.status === 401 || err.response?.status === 403) {
      }
      setError(getApiErrorMessage(err, 'Failed to download research pack'));
    } finally {
      setResearchDownloading(false);
    }
  };

  const generatePaperList = () => {
    const selected = documents.filter((d) => selectedDocIds.has(d.id));
    const lines = selected.map((d) => {
      const url = d.originalUrl || '';
      return url ? `* [${d.title}](${url})` : `* ${d.title}`;
    });
    setPaperListText(lines.join('\n'));
    setShowPaperList(true);
  };

  const buildRefinementRounds = () => {
    return (rounds || [])
      .map((round, idx) => ({
        name: (round?.name || `Round ${idx + 1}`).trim(),
        prompt: typeof round?.prompt === 'string' ? round.prompt.trim() : '',
        input: typeof round?.input === 'string' ? round.input : (typeof round?.prompt === 'string' ? round.prompt : ''),
        type: typeof round?.type === 'string' ? round.type : 'created',
        sourceUrl: typeof round?.sourceUrl === 'string' ? round.sourceUrl : '',
      }))
      .filter((round) => round.prompt.length > 0);
  };

  const handleObsidianBatch = async () => {
    if (selectedDocIds.size === 0 || !vaultReady) return;
    const selected = documents.filter((d) => selectedDocIds.has(d.id));
    const refinementRounds = buildRefinementRounds();
    if (refinementRounds.length === 0) {
      setError('No reading skills configured. Open AI Settings → Generation and save at least one skill.');
      setShowAiSettings(true);
      return;
    }
    setError(null);

    const withNotes = selected.filter((d) => {
      const status = d.processingStatus || d.processing_status || '';
      return status === 'completed';
    });
    const withoutNotes = selected.filter((d) => {
      const status = d.processingStatus || d.processing_status || '';
      return status !== 'completed';
    });

    // Always show queue/progress panel first, including papers already completed.
    if (withNotes.length > 0) {
      restoreItems(withNotes.map((d) => ({ id: d.id, title: d.title })));
    }

    if (withoutNotes.length > 0) {
      await addToBatch(
        withoutNotes.map((d) => ({ id: d.id, title: d.title })),
        refinementRounds,
        { provider, model, thinkingBudget, reasoningEffort },
      );
    }
    pollNow();
  };

  const handleAuthClick = () => {
    if (isAuthenticated) {
      logout();
    } else {
    }
  };

  if (authLoading) {
    return (
      <div className="app">
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-row">
          <div className="header-content">
            <h1>Auto Researcher</h1>
          </div>
          <div className="header-right">
            <Tabs.Root value={activeArea} onValueChange={setActiveArea} className="area-tabs">
              <Tabs.List size="2">
                <Tabs.Trigger value="latest">Latest</Tabs.Trigger>
                <Tabs.Trigger value="library">Library</Tabs.Trigger>
                <Tabs.Trigger value="aris">ARIS</Tabs.Trigger>
                <Tabs.Trigger value="sessions">Sessions</Tabs.Trigger>
              </Tabs.List>
            </Tabs.Root>
            <div className="header-actions">
              {isAuthenticated && (
                <>
                  <Button
                    className="header-btn"
                    variant="soft"
                    size="2"
                    onClick={() => setShowTrackerAdmin(true)}
                    title="Paper Tracker"
                  >
                    Tracker
                  </Button>
                  <Button
                    className="header-btn"
                    variant="soft"
                    size="2"
                    onClick={() => setShowSshAdmin(true)}
                    title="SSH Server Settings"
                  >
                    Servers
                  </Button>
                  {activeArea === 'library' && (
                    <Button
                      className="header-btn"
                      variant="soft"
                      size="2"
                      onClick={() => setShowAiSettings(true)}
                      title="AI and release settings"
                    >
                      Settings
                    </Button>
                  )}
                </>
              )}
              <Button
                className="header-btn auth-btn"
                variant={isAuthenticated ? 'solid' : 'outline'}
                size="2"
                onClick={handleAuthClick}
                title={isAuthenticated ? 'Logout' : 'Login'}
              >
                {username || 'Logout'}
              </Button>
            </div>
          </div>
        </div>

        <div className="header-sub-row">
          <div className="library-sub-controls">
            {activeArea === 'library' ? (
              <>
                <Tabs.Root value={readFilter} onValueChange={setReadFilter} className="sub-tabs">
                  <Tabs.List size="1">
                    <Tabs.Trigger value="all">All</Tabs.Trigger>
                    <Tabs.Trigger value="unread">Unread</Tabs.Trigger>
                    <Tabs.Trigger value="read">Read</Tabs.Trigger>
                  </Tabs.List>
                </Tabs.Root>
                <Button
                  className="header-btn"
                  variant={showFilters ? 'solid' : 'soft'}
                  size="2"
                  onClick={() => setShowFilters(!showFilters)}
                  title="Search & Filter"
                >
                  Search
                </Button>
                <Button
                  className="header-btn"
                  variant={researchMode ? 'solid' : 'soft'}
                  size="2"
                  onClick={toggleResearchMode}
                  title={researchMode ? 'Cancel selection' : 'Select papers for research pack'}
                >
                  {researchMode ? 'Cancel Selection' : 'Research Mode'}
                </Button>
              </>
            ) : activeArea === 'aris' ? (
              <div className="library-sub-placeholder aris-sub-copy">
                Runs execute on the always-on WSL host and keep going if this browser disconnects.
              </div>
            ) : (
              <div className="library-sub-placeholder" />
            )}
          </div>
        </div>
      </header>

      {activeArea === 'library' && showFilters && (
        <div className="filter-panel">
          <div className="search-box">
            <input
              type="text"
              placeholder="Search by title or tag..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
            {searchQuery && (
              <button
                className="clear-search"
                onClick={() => setSearchQuery('')}
              >
                ×
              </button>
            )}
          </div>
          <div className="tag-filter">
            <span className="filter-label">Tag:</span>
            <div className="tag-chips">
              <button
                className={`tag-chip ${!selectedTag ? 'active' : ''}`}
                onClick={() => setSelectedTag(null)}
              >
                All
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag.id}
                  className={`tag-chip ${selectedTag === tag.name ? 'active' : ''}`}
                  onClick={() => setSelectedTag(selectedTag === tag.name ? null : tag.name)}
                  style={selectedTag === tag.name ? { backgroundColor: tag.color, borderColor: tag.color } : {}}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          </div>
          <div className="sort-filter">
            <span className="filter-label">Sort:</span>
            <div className="sort-chips">
              <button
                className={`tag-chip ${sortOrder === 'newest' ? 'active' : ''}`}
                onClick={() => setSortOrder('newest')}
              >
                Newest first
              </button>
              <button
                className={`tag-chip ${sortOrder === 'oldest' ? 'active' : ''}`}
                onClick={() => setSortOrder('oldest')}
              >
                Oldest first
              </button>
              <button
                className={`tag-chip ${sortOrder === 'alpha' ? 'active' : ''}`}
                onClick={() => setSortOrder('alpha')}
              >
                A-Z
              </button>
            </div>
          </div>
          {(searchQuery || selectedTag || readFilter !== 'all') && (
            <div className="active-filters">
              <span className="filter-count">
                Showing {filteredDocuments.length} of {documents.length} documents
              </span>
              <button
                className="clear-filters"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedTag(null);
                  setReadFilter('all');
                }}
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

      <main className={`main${researchMode ? ' research-mode-active' : ''}`}>
        <div style={{ display: activeArea === 'latest' ? 'block' : 'none' }}>
          <LatestPapers
            apiUrl={API_URL}
            isAuthenticated={isAuthenticated}
            getAuthHeaders={getAuthHeaders}
            debug={IS_DEV}
            autoGenerate={autoGenerate}
            analysisProvider={provider}
          />
        </div>

        {activeArea === 'library' && error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => setRefreshTrigger((prev) => prev + 1)}>Retry</button>
          </div>
        )}

        {activeArea === 'library' && <DocumentList
          documents={filteredDocuments}
          onDownload={getDownloadUrl}
          onViewNotes={(doc, tab = 'paper') => {
            setSelectedDocument(doc);
            setInitialNotesTab(tab);
          }}
          onViewUserNotes={(doc) => setUserNotesDocument(doc)}
          onToggleRead={toggleReadStatus}
          onTriggerCodeAnalysis={triggerCodeAnalysis}
          onDelete={deleteDocument}
          onTagsUpdate={updateDocumentTags}
          onTitleUpdate={updateDocumentTitle}
          loading={loading && documents.length === 0}
          isAuthenticated={isAuthenticated}
          allTags={allTags}
          researchMode={researchMode}
          selectedDocIds={selectedDocIds}
          onToggleSelect={toggleDocSelect}
          apiUrl={API_URL}
          getAuthHeaders={getAuthHeaders}
        />}

        {activeArea === 'library' && documents.length > 0 && hasMore && (
          <div className="load-more-container">
            <button
              className="load-more-btn"
              onClick={loadMore}
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}

        {activeArea === 'library' && documents.length > 0 && !hasMore && (
          <p className="end-message">You've reached the end</p>
        )}

        {activeArea === 'library' && filteredDocuments.length === 0 && !loading && !error && (
          <div className="empty-state">
            {documents.length === 0 ? (
              <>
                <p>No documents found</p>
                <p className="hint">Save some papers using the Chrome extension!</p>
              </>
            ) : (
              <>
                <p>No matching documents</p>
                <p className="hint">Try adjusting your search or filters</p>
              </>
            )}
          </div>
        )}

        {activeArea === 'aris' && (
          <ArisWorkspace
            apiUrl={API_URL}
            getAuthHeaders={getAuthHeaders}
          />
        )}

        {activeArea === 'sessions' && (
          <SessionMirror
            apiUrl={API_URL}
            getAuthHeaders={getAuthHeaders}
          />
        )}
      </main>

      {activeArea === 'library' && researchMode && (
        <div className="research-action-bar">
          <div className="research-action-bar-left">
            <span className="research-selection-count">
              {selectedDocIds.size} paper{selectedDocIds.size !== 1 ? 's' : ''} selected
            </span>
            <button className="research-select-all-btn" onClick={selectAllVisible}>
              Select All
            </button>
          </div>
          <div className="research-action-bar-options">
            <label className="research-bar-option">
              <span>Source:</span>
              <select value={researchSourceType} onChange={(e) => setResearchSourceType(e.target.value)}>
                <option value="pdf">PDF</option>
                <option value="latex">LaTeX (arXiv)</option>
              </select>
            </label>
            <label className="research-bar-option">
              <input
                type="checkbox"
                checked={researchIncludeCode}
                onChange={(e) => setResearchIncludeCode(e.target.checked)}
              />
              Include Code
            </label>
            {researchSourceType === 'latex' && (
              <label className="research-bar-option" title="Use Mathpix API to convert PDF to LaTeX for non-arXiv papers (first 15 pages)">
                <input
                  type="checkbox"
                  checked={useMathpix}
                  onChange={(e) => setUseMathpix(e.target.checked)}
                />
                Mathpix for non-arXiv
              </label>
            )}
          </div>
          <div className="research-action-bar-right">
            <button
              className="research-list-btn"
              onClick={generatePaperList}
              disabled={selectedDocIds.size === 0}
              title="Generate a markdown paper list"
            >
              Paper List
            </button>
            <button
              className="research-download-btn"
              onClick={downloadResearchPack}
              disabled={selectedDocIds.size === 0 || researchDownloading}
            >
              {researchDownloading ? 'Packing...' : `Download ZIP (${selectedDocIds.size})`}
            </button>
            <button
              className="research-send-btn"
              onClick={() => setShowSendModal(true)}
              disabled={selectedDocIds.size === 0 || researchDownloading}
              title="Send to remote server via rsync/SSH"
            >
              Send ({selectedDocIds.size})
            </button>
            <button
              className="research-obsidian-btn"
              onClick={handleObsidianBatch}
              disabled={selectedDocIds.size === 0 || !vaultReady}
              title={!vaultReady ? 'Connect vault in AI Settings first' : `Export ${selectedDocIds.size} paper${selectedDocIds.size !== 1 ? 's' : ''} to Obsidian`}
            >
              → Obsidian
            </button>
            <button className="research-cancel-btn" onClick={toggleResearchMode}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <footer className="footer">
        <p>Auto Reader</p>
      </footer>

      {showPaperList && (
        <div className="modal-backdrop" onClick={() => setShowPaperList(false)}>
          <div className="paper-list-modal" onClick={(e) => e.stopPropagation()}>
            <div className="paper-list-modal-header">
              <span>Paper List ({selectedDocIds.size})</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="paper-list-copy-btn"
                  onClick={() => navigator.clipboard.writeText(paperListText)}
                >
                  Copy
                </button>
                <button className="close-btn" onClick={() => setShowPaperList(false)}>×</button>
              </div>
            </div>
            <textarea
              className="paper-list-textarea"
              value={paperListText}
              readOnly
              onClick={(e) => e.target.select()}
            />
          </div>
        </div>
      )}

      {selectedDocument && (
        <NotesModal
          document={selectedDocument}
          apiUrl={API_URL}
          initialTab={initialNotesTab}
          onClose={() => setSelectedDocument(null)}
          isAuthenticated={isAuthenticated}
          getAuthHeaders={getAuthHeaders}
          onAiEditStatusChange={(status) => {
            setDocuments((prev) =>
              prev.map((doc) =>
                doc.id === selectedDocument.id ? { ...doc, aiEditStatus: status } : doc
              )
            );
          }}
          onViewUserNotes={(doc) => {
            setSelectedDocument(null);
            setUserNotesDocument(doc);
          }}
          onDocumentUpdate={(updatedDoc) => {
            setDocuments((prev) =>
              prev.map((doc) =>
                doc.id === updatedDoc.id ? { ...doc, processingStatus: updatedDoc.processingStatus } : doc
              )
            );
            setSelectedDocument((prev) =>
              prev && prev.id === updatedDoc.id ? { ...prev, processingStatus: updatedDoc.processingStatus } : prev
            );
          }}
        />
      )}

      {userNotesDocument && (
        <UserNotesModal
          document={userNotesDocument}
          apiUrl={API_URL}
          onClose={() => setUserNotesDocument(null)}
          isAuthenticated={isAuthenticated}
          getAuthHeaders={getAuthHeaders}
          onViewAiNotes={(doc) => {
            setUserNotesDocument(null);
            setSelectedDocument(doc);
          }}
        />
      )}

      {showSshAdmin && (
        <SshServersAdmin
          apiUrl={API_URL}
          getAuthHeaders={getAuthHeaders}
          onClose={() => setShowSshAdmin(false)}
        />
      )}

      {showTrackerAdmin && (
        <TrackerAdmin
          apiUrl={API_URL}
          getAuthHeaders={getAuthHeaders}
          onClose={() => setShowTrackerAdmin(false)}
        />
      )}

      {showAiSettings && (
        <LibrarySettingsModal
          onClose={() => setShowAiSettings(false)}
          apiUrl={API_URL}
          getAuthHeaders={getAuthHeaders}
          rounds={rounds}
          saveRounds={saveRounds}
          provider={provider}
          model={model}
          thinkingBudget={thinkingBudget}
          reasoningEffort={reasoningEffort}
          saveProviderSettings={saveProviderSettings}
          autoGenerate={autoGenerate}
          saveAutoGenerate={saveAutoGenerate}
          vaultName={vaultName}
          vaultReady={vaultReady}
          connectVault={connectVault}
          disconnectVault={disconnectVault}
          batchItems={batchItems}
          clearCompleted={clearCompleted}
          retryItem={(docId) => retryItem(docId, buildRefinementRounds(), { provider, model, thinkingBudget, reasoningEffort })}
          syncFromBackend={syncFromBackend}
          exportRounds={rounds}
        />
      )}

      {showSendModal && (
        <SendModal
          apiUrl={API_URL}
          getAuthHeaders={getAuthHeaders}
          selectedDocIds={selectedDocIds}
          sourceType={researchSourceType}
          includeCode={researchIncludeCode}
          useMathpix={researchSourceType === 'latex' ? useMathpix : false}
          onClose={() => setShowSendModal(false)}
          onDone={() => {
            setResearchMode(false);
            setSelectedDocIds(new Set());
          }}
        />
      )}

      <ObsidianBatchPanel
        items={batchItems}
        onClearCompleted={clearCompleted}
        onClearAll={clearAll}
        onRetry={(docId) => retryItem(docId, buildRefinementRounds(), { provider, model, thinkingBudget, reasoningEffort })}
      />
    </div>
  );
}

function App() {
  return (
    <Theme accentColor="blue" grayColor="slate" radius="medium">
      <AuthProvider apiUrl={API_URL}>
        <AppContent />
      </AuthProvider>
    </Theme>
  );
}

export default App;
