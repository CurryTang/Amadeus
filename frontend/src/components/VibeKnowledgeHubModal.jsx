import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import KnowledgeAsset from '../models/KnowledgeAsset';
import KnowledgeAssetCard from './KnowledgeAssetCard';

const SOURCE_PROVIDER_OPTIONS = [
  { value: '', label: 'Any Source' },
  { value: 'claude_opus_4_6', label: 'Claude Opus 4.6' },
  { value: 'gpt_5_pro', label: 'GPT-5 Pro' },
  { value: 'manual', label: 'Manual' },
  { value: 'run', label: 'Run-generated' },
];

const ASSET_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'insight', label: 'Insight' },
  { value: 'file', label: 'File' },
  { value: 'note', label: 'Note' },
  { value: 'report', label: 'Report' },
  { value: 'document', label: 'Document' },
];

const RESOURCE_SEED_FILES = [
  'paper_assets_index.md',
  'paper_assets_index.json',
  'notes.md',
  'research_questions.md',
  'proposal_zh.md',
];
const RESOURCE_QUERY_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'for',
  'of',
  'in',
  'on',
  'with',
  'from',
  'about',
  'how',
  'what',
  'which',
  'when',
  'where',
  'why',
  'is',
  'are',
  'be',
  'can',
  'should',
  'could',
  'would',
  'please',
  'compare',
  'comparison',
  'differences',
  'difference',
  'scope',
  'summarize',
  'summary',
  'cite',
  'citation',
  'citations',
  'path',
  'paths',
  'file',
  'files',
  'resource',
  'resources',
  'between',
  'across',
]);
const SSH_RESOURCE_ERROR_CODES = new Set([
  'SSH_SERVER_NOT_FOUND',
  'SSH_AUTH_FAILED',
  'SSH_HOST_UNREACHABLE',
  'SSH_TIMEOUT',
  'SSH_COMMAND_FAILED',
  'REMOTE_PATH_NOT_FOUND',
  'REMOTE_NOT_DIRECTORY',
]);
const KB_LOCATOR_COOLDOWN_MS = 30 * 60 * 1000;
const kbLocatorCooldownByProject = new Map();

function normalizeTags(raw = '') {
  return String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeResourceMatch(item = null) {
  if (typeof item === 'string') {
    const path = String(item || '').trim();
    return path ? { path, score: 0, matchedTerms: [], reasons: [], preview: null } : null;
  }
  const path = String(item?.path || item?.relativePath || '').trim();
  if (!path) return null;
  return {
    path,
    score: Number(item?.score || 0),
    matchedTerms: Array.isArray(item?.matchedTerms) ? item.matchedTerms : [],
    reasons: Array.isArray(item?.reasons) ? item.reasons : [],
    preview: item?.preview && typeof item.preview === 'object' ? item.preview : null,
  };
}

function tokenizeResourceQuery(query = '', maxTokens = 8) {
  const normalized = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9_\-./\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];
  const rawTokens = normalized
    .split(' ')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length >= 2)
    .filter((item) => !RESOURCE_QUERY_STOPWORDS.has(item));
  const out = [];
  const seen = new Set();
  for (const token of rawTokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= maxTokens) break;
  }
  return out;
}

function scoreResourcePath(relativePath = '', query = '', tokens = []) {
  const rel = String(relativePath || '').trim();
  if (!rel) return 0;
  const relLower = rel.toLowerCase();
  const segments = relLower.split('/').filter(Boolean);
  const fileLower = segments[segments.length - 1] || relLower;
  const extMatch = fileLower.match(/\.[a-z0-9]+$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : '';
  const depth = segments.length;
  const q = String(query || '').trim().toLowerCase();
  const paperIntent = /\b(paper|benchmark|bench|compare|comparison|scope|dataset|datasets|result|results|analysis|review|evidence|citation)\b/.test(q);
  const codeIntent = /\b(code|script|implementation|api|function|class|module|debug|fix|patch)\b/.test(q);
  let score = 0;
  if (q && relLower.includes(q)) score += 9;
  tokens.forEach((token) => {
    if (!token) return;
    if (relLower.includes(token)) {
      score += 2;
      if (fileLower.includes(token)) score += 1.2;
      if (fileLower.startsWith(token)) score += 0.8;
    }
  });
  if (RESOURCE_SEED_FILES.some((seed) => seed.toLowerCase() === fileLower)) score += 1.8;
  if (fileLower === 'readme.md') score += 4.6;
  if (fileLower.endsWith('meta.json')) score += 1.8;
  if (relLower.includes('/arxiv_source/meta.json')) score += 2.2;
  if (fileLower.endsWith('.pdf')) score += 3.4;
  if (fileLower === 'paper.pdf') score += 4.0;
  if (fileLower.endsWith('bench.pdf')) score += 2.0;
  if (fileLower.endsWith('.md')) score += 0.9;
  if (depth <= 2) score += 1.4;
  if (depth > 4) score -= (depth - 4) * 0.45;
  if (relLower.includes('/arxiv_source/src/')) score -= 3.4;
  if (fileLower.endsWith('.pdf') && relLower.includes('/arxiv_source/src/')) score -= 3.2;
  if (/(^|\/)(fig|figs|images|img|plots)\//.test(relLower)) score -= 3.4;
  if (fileLower.includes('favicon')) score -= 3.0;
  if (fileLower.includes('source.bundle')) score -= 4.2;
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.sty'].includes(ext)) score -= 2.6;
  if (['.tex', '.bib', '.bst', '.bbl', '.cls', '.aux', '.log', '.toc', '.out'].includes(ext)) score -= 3.4;
  if (paperIntent && ['.md', '.pdf', '.json', '.txt'].includes(ext)) score += 2.2;
  if (paperIntent && ['.py', '.sh', '.ipynb'].includes(ext)) score -= 1.6;
  if (codeIntent && ['.py', '.sh', '.ipynb'].includes(ext)) score += 1.4;
  return Number(score.toFixed(3));
}

function isEligibleResourcePath(relativePath = '') {
  const rel = String(relativePath || '').trim();
  if (!rel) return false;
  const relLower = rel.toLowerCase();
  const fileLower = relLower.split('/').filter(Boolean).pop() || relLower;
  const extMatch = fileLower.match(/\.[a-z0-9]+$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : '';
  if (relLower.includes('/arxiv_source/src/')) return false;
  if (/(^|\/)(fig|figs|images|img|plots|assets)\//.test(relLower)) return false;
  if (fileLower.includes('source.bundle') || fileLower.includes('favicon')) return false;
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.sty', '.ipynb'].includes(ext)) return false;
  if (['.tex', '.bib', '.bst', '.bbl', '.cls', '.aux', '.log', '.toc', '.out'].includes(ext)) return false;
  return true;
}

function rankResourceCandidates(paths = [], query = '', tokens = [], limit = 30) {
  const cap = Math.min(Math.max(Number(limit) || 30, 1), 80);
  const scored = new Map();
  paths.forEach((item) => {
    const filePath = String(item || '').trim();
    if (!filePath) return;
    if (!isEligibleResourcePath(filePath)) return;
    const score = scoreResourcePath(filePath, query, tokens);
    if (score <= 0) return;
    if (!scored.has(filePath) || score > scored.get(filePath)) {
      scored.set(filePath, score);
    }
  });
  const ranked = Array.from(scored.entries())
    .map(([path, score]) => ({ path, score }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.path.localeCompare(b.path);
    });
  const perFolderLimit = 3;
  const folderCount = new Map();
  const out = [];
  for (const item of ranked) {
    const topFolder = String(item.path || '').split('/')[0] || item.path;
    const used = folderCount.get(topFolder) || 0;
    if (used >= perFolderLimit) continue;
    folderCount.set(topFolder, used + 1);
    out.push(item);
    if (out.length >= cap) break;
  }
  return out;
}

function isSshResourceAccessFailure(error) {
  const code = String(error?.response?.data?.code || '').trim().toUpperCase();
  if (code && SSH_RESOURCE_ERROR_CODES.has(code)) return true;
  const status = Number(error?.response?.status || 0);
  if (status === 401 || status === 502) return true;
  const message = String(error?.response?.data?.error || error?.message || '').toUpperCase();
  return message.includes('SSH_') || message.includes('REMOTE_PATH');
}

function isKbLocatorCoolingDown(projectId = '') {
  const pid = String(projectId || '').trim();
  if (!pid) return false;
  const until = Number(kbLocatorCooldownByProject.get(pid) || 0);
  return Number.isFinite(until) && until > Date.now();
}

function markKbLocatorCoolingDown(projectId = '') {
  const pid = String(projectId || '').trim();
  if (!pid) return;
  kbLocatorCooldownByProject.set(pid, Date.now() + KB_LOCATOR_COOLDOWN_MS);
}

// ─── Module-level resource search cache ──────────────────────────────────────
const _RES_CACHE_TTL = 5 * 60 * 1000; // 5 min
const _resCache = new Map(); // key: "pid:q" → { items: array, ts: number }

function _resCacheGet(pid, q) {
  const hit = _resCache.get(`${pid}:${q}`);
  return hit && Date.now() - hit.ts < _RES_CACHE_TTL ? hit.items : null;
}
function _resCacheSet(pid, q, items) {
  _resCache.set(`${pid}:${q}`, { items, ts: Date.now() });
  if (_resCache.size > 200) {
    const oldest = [..._resCache.keys()].slice(0, 40);
    oldest.forEach((k) => _resCache.delete(k));
  }
}
// ─────────────────────────────────────────────────────────────────────────────

function VibeKnowledgeHubModal({
  open = false,
  onClose,
  apiUrl,
  headers = {},
  selectedProject,
  pinnedAssetIds = [],
  onPinnedAssetIdsChange,
}) {
  const [groups, setGroups] = useState([]);
  const [groupLoading, setGroupLoading] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [assets, setAssets] = useState([]);
  const [assetLoading, setAssetLoading] = useState(false);
  const [linkedAssetIds, setLinkedAssetIds] = useState(new Set());
  const [linkBusyId, setLinkBusyId] = useState(null);
  const [pinBusyId, setPinBusyId] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [assetTypeFilter, setAssetTypeFilter] = useState('');
  const [providerFilter, setProviderFilter] = useState('');
  const [linkFilter, setLinkFilter] = useState('all'); // all | linked | unlinked

  const [createAssetType, setCreateAssetType] = useState('insight');
  const [createTitle, setCreateTitle] = useState('');
  const [createSummary, setCreateSummary] = useState('');
  const [createBodyMd, setCreateBodyMd] = useState('');
  const [createProvider, setCreateProvider] = useState('manual');
  const [createSourceSessionId, setCreateSourceSessionId] = useState('');
  const [createSourceMessageId, setCreateSourceMessageId] = useState('');
  const [createSourceUrl, setCreateSourceUrl] = useState('');
  const [createTags, setCreateTags] = useState('');
  const [creatingAsset, setCreatingAsset] = useState(false);

  const [uploadFile, setUploadFile] = useState(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadType, setUploadType] = useState('file');
  const [uploadProvider, setUploadProvider] = useState('manual');
  const [uploadSourceSessionId, setUploadSourceSessionId] = useState('');
  const [uploadSourceMessageId, setUploadSourceMessageId] = useState('');
  const [uploadSourceUrl, setUploadSourceUrl] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadingAsset, setUploadingAsset] = useState(false);

  const [assetsDisplayCount, setAssetsDisplayCount] = useState(10);

  const [previewAsset, setPreviewAsset] = useState(null);
  const [resourceMatches, setResourceMatches] = useState([]);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourceError, setResourceError] = useState('');
  const [resourcePreview, setResourcePreview] = useState(null);
  const [resourceImporting, setResourceImporting] = useState(false);
  const pinnedSet = useMemo(() => new Set((pinnedAssetIds || []).map((id) => Number(id))), [pinnedAssetIds]);

  const loadGroups = useCallback(async () => {
    if (!open) return;
    setGroupLoading(true);
    setError('');
    try {
      const projectGroupRes = selectedProject?.id
        ? await axios.get(`${apiUrl}/researchops/projects/${selectedProject.id}/knowledge-groups`, { headers })
        : { data: { items: [] } };
      const allGroupsRes = await axios.get(`${apiUrl}/researchops/knowledge-groups`, {
        headers,
        params: { limit: 200, offset: 0 },
      });
      const projectGroups = Array.isArray(projectGroupRes.data?.items) ? projectGroupRes.data.items : [];
      const allGroups = Array.isArray(allGroupsRes.data?.items) ? allGroupsRes.data.items : [];
      const merged = [...projectGroups];
      const seen = new Set(projectGroups.map((item) => Number(item.id)));
      for (const item of allGroups) {
        const id = Number(item.id);
        if (!seen.has(id)) merged.push(item);
      }
      setGroups(merged);
      if (!selectedGroupId) {
        const defaultId = projectGroups[0]?.id || merged[0]?.id || '';
        setSelectedGroupId(defaultId ? String(defaultId) : '');
      }
    } catch (err) {
      console.error('Failed to load knowledge groups for hub:', err);
      setError(err?.response?.data?.error || 'Failed to load knowledge groups');
    } finally {
      setGroupLoading(false);
    }
  }, [open, apiUrl, headers, selectedProject, selectedGroupId]);

  const loadAssets = useCallback(async () => {
    if (!open) return;
    setAssetLoading(true);
    setError('');
    try {
      const response = await axios.get(`${apiUrl}/researchops/knowledge/assets`, {
        headers,
        params: {
          limit: 200,
          offset: 0,
          q: query.trim() || undefined,
          assetType: assetTypeFilter || undefined,
          provider: providerFilter || undefined,
        },
      });
      const items = Array.isArray(response.data?.items)
        ? response.data.items.map((item) => KnowledgeAsset.fromApi(item))
        : [];
      setAssets(items);
    } catch (err) {
      console.error('Failed to load knowledge assets:', err);
      setError(err?.response?.data?.error || 'Failed to load knowledge assets');
    } finally {
      setAssetLoading(false);
    }
  }, [open, apiUrl, headers, query, assetTypeFilter, providerFilter]);

  const loadLinkedAssets = useCallback(async () => {
    if (!open || !selectedGroupId) {
      setLinkedAssetIds(new Set());
      return;
    }
    try {
      const response = await axios.get(`${apiUrl}/researchops/knowledge/groups/${selectedGroupId}/assets`, {
        headers,
        params: { limit: 200, offset: 0 },
      });
      const ids = new Set(
        (response.data?.items || [])
          .map((item) => Number(item.id))
          .filter((id) => Number.isFinite(id) && id > 0)
      );
      setLinkedAssetIds(ids);
    } catch (err) {
      console.error('Failed to load group assets:', err);
      setError(err?.response?.data?.error || 'Failed to load group assets');
    }
  }, [open, selectedGroupId, apiUrl, headers]);

  const loadResourceMatches = useCallback(async () => {
    if (!open || !selectedProject?.id) return;
    const q = query.trim();
    if (!q) {
      setResourceMatches([]);
      setResourceError('');
      return;
    }

    // Serve cached result instantly (skips SSH round-trip entirely)
    const cached = _resCacheGet(String(selectedProject.id), q);
    if (cached !== null) {
      setResourceMatches(cached);
      return;
    }

    setResourceLoading(true);
    setResourceError('');
    try {
      if (!isKbLocatorCoolingDown(selectedProject.id)) {
        try {
          const response = await axios.get(
            `${apiUrl}/researchops/projects/${selectedProject.id}/kb/resource-locate`,
            {
              headers,
              params: { q, limit: 30 },
              timeout: 9000,
            }
          );
          const items = Array.isArray(response.data?.items) ? response.data.items : [];
          const normalized = items.map(normalizeResourceMatch).filter(Boolean);
          _resCacheSet(String(selectedProject.id), q, normalized);
          setResourceMatches(normalized);
          return;
        } catch (locatorError) {
          if (Number(locatorError?.response?.status || 0) === 404) {
            markKbLocatorCoolingDown(selectedProject.id);
          } else {
            console.warn(
              'KB resource locator failed, falling back to files/search:',
              locatorError?.message || locatorError
            );
          }
        }
      }

      const candidates = [];
      const tokenized = tokenizeResourceQuery(q, 8);
      const searchTerms = [q, ...tokenized].slice(0, 6);
      for (const term of searchTerms) {
        let response = null;
        try {
          // eslint-disable-next-line no-await-in-loop
          response = await axios.get(
            `${apiUrl}/researchops/projects/${selectedProject.id}/files/search`,
            {
              headers,
              params: { scope: 'kb', q: term, limit: 30 },
              timeout: 9000,
            }
          );
        } catch (searchError) {
          if (isSshResourceAccessFailure(searchError)) {
            const seedMatches = RESOURCE_SEED_FILES
              .slice(0, 8)
              .map((path) => ({ path, score: 1 }));
            setResourceMatches(seedMatches.map(normalizeResourceMatch).filter(Boolean));
            return;
          }
          continue;
        }
        const items = Array.isArray(response?.data?.items) ? response.data.items : [];
        items.forEach((item) => {
          const path = String(item || '').trim();
          if (!path) return;
          candidates.push(path);
        });
      }
      let ranked = rankResourceCandidates(candidates, q, tokenized, 30);
      if (ranked.length === 0) {
        ranked = RESOURCE_SEED_FILES.map((path) => ({ path, score: 1 })).slice(0, 8);
      }
      const result = ranked.map(normalizeResourceMatch).filter(Boolean);
      _resCacheSet(String(selectedProject.id), q, result);
      setResourceMatches(result);
    } catch (err) {
      console.error('Failed to search project resource files:', err);
      setResourceError(err?.response?.data?.error || 'Failed to search resource files');
      setResourceMatches([]);
    } finally {
      setResourceLoading(false);
    }
  }, [open, selectedProject, query, apiUrl, headers]);

  const previewResourceFile = useCallback(async (relativePath) => {
    if (!selectedProject?.id || !relativePath) return;
    setResourcePreview({
      path: relativePath,
      loading: true,
      error: '',
      content: '',
      truncated: false,
    });
    try {
      const response = await axios.get(
        `${apiUrl}/researchops/projects/${selectedProject.id}/files/content`,
        {
          headers,
          params: {
            scope: 'kb',
            path: relativePath,
            maxBytes: 180000,
          },
        }
      );
      setResourcePreview({
        path: relativePath,
        loading: false,
        error: '',
        content: String(response.data?.content || ''),
        truncated: Boolean(response.data?.truncated),
      });
    } catch (err) {
      console.error('Failed to preview resource file:', err);
      setResourcePreview({
        path: relativePath,
        loading: false,
        error: err?.response?.data?.error || err?.message || 'Failed to preview resource file',
        content: '',
        truncated: false,
      });
    }
  }, [apiUrl, headers, selectedProject]);

  const saveResourcePreviewAsNote = useCallback(async () => {
    if (!resourcePreview?.path || !resourcePreview?.content || resourceImporting) return;
    setResourceImporting(true);
    setError('');
    try {
      await axios.post(`${apiUrl}/researchops/knowledge/assets`, {
        assetType: 'note',
        title: `Resource Extract: ${resourcePreview.path}`,
        summary: `Imported from resource repository path ${resourcePreview.path}`,
        bodyMd: resourcePreview.content.slice(0, 180000),
        source: {
          provider: 'manual',
          url: `kb://${resourcePreview.path}`,
        },
        tags: ['resource', 'kb-extract'],
        groupIds: selectedGroupId ? [Number(selectedGroupId)] : [],
      }, { headers });
      await Promise.all([loadAssets(), loadLinkedAssets()]);
    } catch (err) {
      console.error('Failed to save resource preview as note:', err);
      setError(err?.response?.data?.error || 'Failed to save resource preview to knowledge assets');
    } finally {
      setResourceImporting(false);
    }
  }, [
    apiUrl,
    headers,
    loadAssets,
    loadLinkedAssets,
    resourceImporting,
    resourcePreview,
    selectedGroupId,
  ]);

  useEffect(() => {
    if (!open) return;
    loadGroups();
    loadAssets();
  }, [open, loadGroups, loadAssets]);

  useEffect(() => {
    if (!open) return;
    loadLinkedAssets();
  }, [open, selectedGroupId, loadLinkedAssets]);

  useEffect(() => {
    if (!open || !selectedProject?.id) return;
    if (!query.trim()) {
      setResourceMatches([]);
      setResourceError('');
      return;
    }
    const timer = setTimeout(() => {
      loadResourceMatches();
    }, 250);
    return () => clearTimeout(timer);
  }, [open, selectedProject, query, loadResourceMatches]);

  // Reset display count when filters or asset list changes (side-effect kept out of useMemo)
  useEffect(() => { setAssetsDisplayCount(10); }, [assets, linkedAssetIds, linkFilter]);

  const filteredAssets = useMemo(() => {
    if (linkFilter === 'linked') return assets.filter((asset) => linkedAssetIds.has(Number(asset.id)));
    if (linkFilter === 'unlinked') return assets.filter((asset) => !linkedAssetIds.has(Number(asset.id)));
    return assets;
  }, [assets, linkedAssetIds, linkFilter]);

  const togglePin = async (assetId, currentlyPinned) => {
    setPinBusyId(Number(assetId));
    try {
      const next = new Set(pinnedSet);
      if (currentlyPinned) next.delete(Number(assetId));
      else next.add(Number(assetId));
      onPinnedAssetIdsChange?.(Array.from(next));
    } finally {
      setPinBusyId(null);
    }
  };

  const toggleLink = async (assetId, currentlyLinked) => {
    if (!selectedGroupId) {
      setError('Select a knowledge group first.');
      return;
    }
    setLinkBusyId(Number(assetId));
    try {
      if (currentlyLinked) {
        await axios.delete(`${apiUrl}/researchops/knowledge/groups/${selectedGroupId}/assets/${assetId}`, { headers });
      } else {
        await axios.post(`${apiUrl}/researchops/knowledge/groups/${selectedGroupId}/assets`, {
          assetIds: [assetId],
        }, { headers });
      }
      await loadLinkedAssets();
    } catch (err) {
      console.error('Failed to toggle asset group link:', err);
      setError(err?.response?.data?.error || 'Failed to update asset group link');
    } finally {
      setLinkBusyId(null);
    }
  };

  const handleCreateAsset = async (event) => {
    event.preventDefault();
    if (!createTitle.trim()) return;
    setCreatingAsset(true);
    setError('');
    try {
      await axios.post(`${apiUrl}/researchops/knowledge/assets`, {
        assetType: createAssetType,
        title: createTitle.trim(),
        summary: createSummary.trim() || undefined,
        bodyMd: createBodyMd || undefined,
        source: {
          provider: createProvider || undefined,
          sessionId: createSourceSessionId.trim() || undefined,
          messageId: createSourceMessageId.trim() || undefined,
          url: createSourceUrl.trim() || undefined,
        },
        tags: normalizeTags(createTags),
        groupIds: selectedGroupId ? [Number(selectedGroupId)] : [],
      }, { headers });

      setCreateTitle('');
      setCreateSummary('');
      setCreateBodyMd('');
      setCreateSourceSessionId('');
      setCreateSourceMessageId('');
      setCreateSourceUrl('');
      setCreateTags('');
      await Promise.all([loadAssets(), loadLinkedAssets()]);
    } catch (err) {
      console.error('Failed to create knowledge asset:', err);
      setError(err?.response?.data?.error || 'Failed to create knowledge asset');
    } finally {
      setCreatingAsset(false);
    }
  };

  const handleUploadAsset = async (event) => {
    event.preventDefault();
    if (!uploadFile) return;
    setUploadingAsset(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      if (uploadTitle.trim()) formData.append('title', uploadTitle.trim());
      formData.append('assetType', uploadType);
      formData.append('sourceProvider', uploadProvider || 'manual');
      if (uploadSourceSessionId.trim()) formData.append('sourceSessionId', uploadSourceSessionId.trim());
      if (uploadSourceMessageId.trim()) formData.append('sourceMessageId', uploadSourceMessageId.trim());
      if (uploadSourceUrl.trim()) formData.append('sourceUrl', uploadSourceUrl.trim());
      if (uploadTags.trim()) formData.append('tags', JSON.stringify(normalizeTags(uploadTags)));
      if (selectedGroupId) formData.append('groupIds', JSON.stringify([Number(selectedGroupId)]));

      await axios.post(`${apiUrl}/researchops/knowledge/assets/upload`, formData, {
        headers: {
          ...headers,
          'Content-Type': 'multipart/form-data',
        },
      });
      setUploadFile(null);
      setUploadTitle('');
      setUploadSourceSessionId('');
      setUploadSourceMessageId('');
      setUploadSourceUrl('');
      setUploadTags('');
      await Promise.all([loadAssets(), loadLinkedAssets()]);
    } catch (err) {
      console.error('Failed to upload knowledge asset:', err);
      setError(err?.response?.data?.error || 'Failed to upload knowledge asset');
    } finally {
      setUploadingAsset(false);
    }
  };

  if (!open) return null;

  return (
    <div className="vibe-modal-backdrop" onClick={onClose}>
      <article
        className="vibe-modal vibe-knowledge-hub-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vibe-knowledge-hub-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="vibe-knowledge-header">
          <h3 id="vibe-knowledge-hub-title">
            Knowledge Hub
            {selectedProject?.name ? ` · ${selectedProject.name}` : ''}
          </h3>
          <div className="vibe-knowledge-header-actions">
            <span className="vibe-empty">{pinnedSet.size} pinned</span>
            <button type="button" className="vibe-secondary-btn" onClick={onClose}>Close</button>
          </div>
        </div>

        {error && <div className="vibe-error">{error}</div>}

        <div className="vibe-knowledge-layout">
          <section className="vibe-knowledge-card">
            <h4>Filters</h4>
            <select value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)}>
              <option value="">{groupLoading ? 'Loading groups...' : 'No group selected'}</option>
              {groups.map((group) => (
                <option key={group.id} value={String(group.id)}>
                  {group.name}
                </option>
              ))}
            </select>
            <input
              placeholder="Search title/summary/body"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select value={assetTypeFilter} onChange={(e) => setAssetTypeFilter(e.target.value)}>
              {ASSET_TYPE_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}>
              {SOURCE_PROVIDER_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select value={linkFilter} onChange={(e) => setLinkFilter(e.target.value)}>
              <option value="all">All</option>
              <option value="linked">Linked to selected group</option>
              <option value="unlinked">Unlinked</option>
            </select>
            <button
              type="button"
              className="vibe-secondary-btn"
              onClick={() => {
                loadAssets();
                loadLinkedAssets();
                loadResourceMatches();
              }}
              disabled={assetLoading || resourceLoading}
            >
              {assetLoading || resourceLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </section>

          <section className="vibe-knowledge-card">
            <h4>Create Insight / Note</h4>
            <form className="vibe-form" onSubmit={handleCreateAsset}>
              <select value={createAssetType} onChange={(e) => setCreateAssetType(e.target.value)}>
                <option value="insight">Insight</option>
                <option value="note">Note</option>
                <option value="report">Report</option>
              </select>
              <input
                placeholder="Title"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                required
              />
              <input
                placeholder="Summary (optional)"
                value={createSummary}
                onChange={(e) => setCreateSummary(e.target.value)}
              />
              <textarea
                placeholder="Markdown body"
                value={createBodyMd}
                onChange={(e) => setCreateBodyMd(e.target.value)}
                rows={8}
              />
              <select value={createProvider} onChange={(e) => setCreateProvider(e.target.value)}>
                {SOURCE_PROVIDER_OPTIONS.filter((item) => item.value !== '').map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <input
                placeholder="Source session ID (optional)"
                value={createSourceSessionId}
                onChange={(e) => setCreateSourceSessionId(e.target.value)}
              />
              <input
                placeholder="Source message ID (optional)"
                value={createSourceMessageId}
                onChange={(e) => setCreateSourceMessageId(e.target.value)}
              />
              <input
                placeholder="Source URL (optional)"
                value={createSourceUrl}
                onChange={(e) => setCreateSourceUrl(e.target.value)}
              />
              <input
                placeholder="Tags (comma-separated)"
                value={createTags}
                onChange={(e) => setCreateTags(e.target.value)}
              />
              <button type="submit" disabled={creatingAsset}>
                {creatingAsset ? 'Creating...' : 'Create Asset'}
              </button>
            </form>
          </section>

          <section className="vibe-knowledge-card">
            <h4>Upload File Asset</h4>
            <form className="vibe-form" onSubmit={handleUploadAsset}>
              <input
                type="file"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                required
              />
              <input
                placeholder="Optional title override"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
              />
              <select value={uploadType} onChange={(e) => setUploadType(e.target.value)}>
                <option value="file">File</option>
                <option value="note">Note</option>
                <option value="report">Report</option>
              </select>
              <select value={uploadProvider} onChange={(e) => setUploadProvider(e.target.value)}>
                {SOURCE_PROVIDER_OPTIONS.filter((item) => item.value !== '').map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <input
                placeholder="Source session ID (optional)"
                value={uploadSourceSessionId}
                onChange={(e) => setUploadSourceSessionId(e.target.value)}
              />
              <input
                placeholder="Source message ID (optional)"
                value={uploadSourceMessageId}
                onChange={(e) => setUploadSourceMessageId(e.target.value)}
              />
              <input
                placeholder="Source URL (optional)"
                value={uploadSourceUrl}
                onChange={(e) => setUploadSourceUrl(e.target.value)}
              />
              <input
                placeholder="Tags (comma-separated)"
                value={uploadTags}
                onChange={(e) => setUploadTags(e.target.value)}
              />
              <button type="submit" disabled={uploadingAsset}>
                {uploadingAsset ? 'Uploading...' : 'Upload Asset'}
              </button>
            </form>
          </section>
        </div>

        <div className="vibe-knowledge-asset-list">
          {assetLoading ? (
            <p className="vibe-empty">Loading assets...</p>
          ) : filteredAssets.length === 0 ? (
            <p className="vibe-empty">No assets found for current filters.</p>
          ) : (
            <>
              {filteredAssets.slice(0, assetsDisplayCount).map((asset) => (
                <KnowledgeAssetCard
                  key={asset.id}
                  asset={asset}
                  pinned={pinnedSet.has(Number(asset.id))}
                  linked={linkedAssetIds.has(Number(asset.id))}
                  pinBusy={Number(pinBusyId) === Number(asset.id)}
                  linkBusy={Number(linkBusyId) === Number(asset.id)}
                  onTogglePin={togglePin}
                  onToggleLink={toggleLink}
                  onPreview={(item) => setPreviewAsset(item)}
                />
              ))}
              {filteredAssets.length > assetsDisplayCount && (
                <button
                  type="button"
                  className="vibe-loadmore-btn"
                  onClick={() => setAssetsDisplayCount((c) => c + 10)}
                >
                  Load more ({filteredAssets.length - assetsDisplayCount} remaining)
                </button>
              )}
            </>
          )}
        </div>

        <div className="vibe-resource-search-panel">
          <div className="vibe-card-head">
            <h3>Resource Repository Matches</h3>
            <button
              type="button"
              className="vibe-secondary-btn"
              onClick={loadResourceMatches}
              disabled={resourceLoading || !query.trim()}
            >
              {resourceLoading ? 'Searching...' : 'Search Resource'}
            </button>
          </div>
          {!query.trim() ? (
            <p className="vibe-empty">Enter a query above to search `resource/` files directly (scope=kb).</p>
          ) : resourceError ? (
            <p className="vibe-empty">{resourceError}</p>
          ) : resourceMatches.length === 0 ? (
            <p className="vibe-empty">No resource file paths matched this query.</p>
          ) : (
            <div className="vibe-resource-match-list">
              {resourceMatches.map((item) => (
                <button
                  key={item.path}
                  type="button"
                  className="vibe-resource-match-btn"
                  title={item.path}
                  onClick={() => previewResourceFile(item.path)}
                >
                  {item.path}
                </button>
              ))}
            </div>
          )}
          <div className="vibe-resource-seed-list">
            {RESOURCE_SEED_FILES.map((filePath) => (
              <button
                key={filePath}
                type="button"
                className="vibe-resource-seed-btn"
                onClick={() => previewResourceFile(filePath)}
              >
                Open {filePath}
              </button>
            ))}
          </div>
        </div>

        {previewAsset && (
          <div className="vibe-asset-preview">
            <div className="vibe-card-head">
              <h3>{previewAsset.title}</h3>
              <button type="button" className="vibe-secondary-btn" onClick={() => setPreviewAsset(null)}>Close Preview</button>
            </div>
            <pre>{previewAsset.bodyMd || previewAsset.summary || 'No textual preview available.'}</pre>
          </div>
        )}

        {resourcePreview && (
          <div className="vibe-asset-preview">
            <div className="vibe-card-head">
              <h3>Resource Preview · {resourcePreview.path}</h3>
              <div className="vibe-asset-actions">
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={saveResourcePreviewAsNote}
                  disabled={resourceImporting || !resourcePreview.content}
                >
                  {resourceImporting ? 'Saving...' : 'Save as Note Asset'}
                </button>
                <button
                  type="button"
                  className="vibe-secondary-btn"
                  onClick={() => setResourcePreview(null)}
                >
                  Close Preview
                </button>
              </div>
            </div>
            {resourcePreview.loading ? (
              <p className="vibe-empty">Loading resource preview...</p>
            ) : resourcePreview.error ? (
              <p className="vibe-empty">{resourcePreview.error}</p>
            ) : (
              <pre>
                {resourcePreview.content}
                {resourcePreview.truncated ? '\n\n[truncated]' : ''}
              </pre>
            )}
          </div>
        )}
      </article>
    </div>
  );
}

export default VibeKnowledgeHubModal;
