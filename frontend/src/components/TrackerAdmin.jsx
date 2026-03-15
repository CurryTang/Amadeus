import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const SOURCE_TYPES = ['twitter', 'rss', 'arxiv_authors', 'hf', 'alphaxiv', 'finance'];
const SOURCE_TYPE_LABELS = {
  alphaxiv: 'Research Domain (arXiv)',
  twitter: 'Twitter/X',
  rss: 'RSS / Blogs',
  finance: 'Finance',
  hf: 'HuggingFace Daily',
  arxiv_authors: 'Scholar Authors (arXiv)',
};

const POPULAR_ARXIV_CATEGORIES = [
  { code: 'cs.AI', label: 'AI' },
  { code: 'cs.LG', label: 'ML' },
  { code: 'cs.CV', label: 'CV' },
  { code: 'cs.CL', label: 'NLP' },
  { code: 'cs.RO', label: 'Robotics' },
  { code: 'stat.ML', label: 'stat.ML' },
  { code: 'cs.NE', label: 'Neural' },
  { code: 'cs.IR', label: 'IR' },
];

const EMPTY_FORM = { type: 'hf', name: '', config: {} };

function formatTrackerRequestError(error, fallback = 'Tracker request failed') {
  const status = Number(error?.response?.status || 0);
  const apiMessage = String(error?.response?.data?.error || '').trim();
  if (status === 504) {
    return 'Tracker request timed out (504). Check source status/errors and retry.';
  }
  return apiMessage || error?.message || fallback;
}

function formatSourceError(rawError = '') {
  const text = String(rawError || '').trim();
  if (!text) return '';
  const normalized = text.toLowerCase();
  if (normalized.includes('source_timeout') || normalized.includes('timed out') || normalized.includes('timeout')) {
    return 'Source timed out while refreshing feed metadata.';
  }
  return text;
}

// Config fields per source type
// Filter fields appended to paper-based sources
const PAPER_FILTER_FIELDS = [
  {
    key: 'keywords',
    label: 'Keyword Filter (optional)',
    type: 'textarea',
    placeholder: 'LLM\ntransformer\ndiffusion model',
    hint: 'Only show papers whose title or abstract contains at least one keyword. One per line.',
  },
  {
    key: 'watchedAuthors',
    label: 'Author Filter (optional)',
    type: 'textarea',
    placeholder: 'Yann LeCun\nAndrej Karpathy',
    hint: 'Only show papers by these authors. One name per line. Matched as substring.',
  },
];

const CONFIG_FIELDS = {
  hf: [
    { key: 'minUpvotes', label: 'Min Upvotes', type: 'number', placeholder: '10', hint: 'Only import papers with at least this many upvotes' },
    { key: 'lookbackDays', label: 'Lookback Days', type: 'number', placeholder: '7', hint: 'How many past days to check each run' },
    ...PAPER_FILTER_FIELDS,
  ],
  alphaxiv: [
    { key: 'categories', label: 'Categories', type: 'categories', hint: 'arXiv category codes to monitor, comma-separated (e.g. cs.LG, cs.AI)' },
    { key: 'interval', label: 'Time Window', type: 'select', options: ['3 Days', '7 Days', '30 Days', '90 Days'], placeholder: '7 Days', hint: 'Time window for ranking papers on AlphaXiv' },
    { key: 'sortBy', label: 'Sort By', type: 'select', options: ['Views', 'Hot', 'Likes', 'GitHub', 'Comments'], placeholder: 'Views', hint: 'How to rank papers — Views is most reliable' },
    { key: 'minViews', label: 'Min Views', type: 'number', placeholder: '0', hint: 'Only import papers with at least this many views on AlphaXiv' },
    ...PAPER_FILTER_FIELDS,
  ],
  twitter: [
    {
      key: 'mode',
      label: 'Source Mode',
      type: 'select',
      options: [
        { value: 'nitter', label: 'Username (Nitter RSS)' },
        { value: 'playwright', label: 'Playwright Browser' },
      ],
      placeholder: 'nitter',
      hint: 'Use username mode for lightweight tracking. Playwright mode is heavier but supports richer extraction.',
    },
    {
      key: 'username',
      label: 'Twitter Username',
      type: 'text',
      placeholder: 'karpathy',
      hint: 'Handle only, with or without @.',
      showWhen: (config) => String(config.mode || 'nitter').toLowerCase() === 'nitter',
    },
    {
      key: 'nitterInstance',
      label: 'Nitter Instance (optional)',
      type: 'text',
      placeholder: 'https://nitter.privacydev.net',
      hint: 'Leave empty to use built-in fallback instances.',
      showWhen: (config) => String(config.mode || 'nitter').toLowerCase() === 'nitter',
    },
    {
      key: 'trackingMode',
      label: 'Tracking Mode',
      type: 'select',
      options: [{ value: 'paper', label: 'Paper Mode' }],
      placeholder: 'paper',
      hint: 'Current mode detects paper-related links/arXiv IDs. Additional modes (finance/web3/etc.) can be added later.',
      showWhen: (config) => String(config.mode || 'nitter').toLowerCase() === 'playwright',
    },
    {
      key: 'profileLinksText',
      label: 'Twitter Accounts',
      type: 'textarea',
      placeholder: 'karpathy\nylecun\nhttps://x.com/AndrewYNg',
      hint: 'One handle or x.com/twitter.com URL per line.',
      showWhen: (config) => String(config.mode || 'nitter').toLowerCase() === 'playwright',
    },
    {
      key: 'storageStatePath',
      type: 'hidden', // rendered by SessionPathField below the generic fields
      showWhen: () => false,
    },
    {
      key: 'maxPostsPerProfile',
      label: 'Max Posts Per Profile',
      type: 'number',
      placeholder: '15',
      hint: 'How many recent posts to scan per user.',
      showWhen: (config) => String(config.mode || 'nitter').toLowerCase() === 'playwright',
    },
    {
      key: 'crawlIntervalHours',
      label: 'Crawl Interval (hours)',
      type: 'number',
      placeholder: '24',
      hint: 'Minimum hours between runs (default: 24). Playwright scraping is slow — daily is recommended.',
      showWhen: (config) => String(config.mode || 'nitter').toLowerCase() === 'playwright',
    },
    {
      key: 'onlyWithModeMatches',
      label: 'Only import mode-matching posts',
      type: 'checkbox',
      defaultChecked: false,
      hint: 'In paper mode, skip posts without detected arXiv/paper links.',
      showWhen: (config) => String(config.mode || 'nitter').toLowerCase() === 'playwright',
    },
    {
      key: 'keywords',
      label: 'Keyword Filter (optional)',
      type: 'textarea',
      placeholder: 'LLM\ntransformer\ndiffusion model',
      hint: 'Only show papers whose title or abstract contains at least one keyword. One per line.',
    },
  ],
  rss: [
    {
      key: 'feedUrlsText',
      label: 'Feed URLs',
      type: 'textarea',
      placeholder: 'https://lmsys.org/rss.xml\nhttps://spaces.ac.cn/feed',
      hint: 'One RSS/Atom URL per line.',
    },
    {
      key: 'maxItemsPerFeed',
      label: 'Max Articles Per Feed',
      type: 'number',
      placeholder: '20',
      hint: 'How many latest entries to fetch from each feed per refresh.',
    },
    {
      key: 'timeoutMs',
      label: 'Timeout (ms)',
      type: 'number',
      placeholder: '15000',
      hint: 'Network timeout per feed request.',
    },
    {
      key: 'lookbackDays',
      label: 'Lookback Days',
      type: 'number',
      placeholder: '180',
      hint: 'Only include RSS entries published within this many days (default: 180 = ~6 months).',
    },
    {
      key: 'keywords',
      label: 'Keyword Filter (optional)',
      type: 'textarea',
      placeholder: 'LLM\ninference\noptimization',
      hint: 'Only show RSS entries whose title or summary contains at least one keyword.',
    },
  ],
  finance: [
    {
      key: 'provider',
      label: 'Source',
      type: 'select',
      options: [
        { value: 'yahoo_rss', label: 'Yahoo Finance RSS (Free)' },
        { value: 'finnhub', label: 'Finnhub (Free Tier API Key)' },
        { value: 'alpha_vantage', label: 'Alpha Vantage (Free Tier API Key)' },
        { value: 'polygon', label: 'Polygon (Free Tier API Key)' },
        { value: 'eastmoney_cn', label: 'Eastmoney China Market (Free)' },
        { value: 'cryptocompare_crypto', label: 'CryptoCompare Crypto News (Free)' },
      ],
      placeholder: 'yahoo_rss',
      hint: 'Select provider. Finnhub/Alpha Vantage/Polygon require API keys on free plans.',
    },
    {
      key: 'symbolsText',
      label: 'Symbols',
      type: 'textarea',
      placeholder: 'AAPL\nTSLA\nNVDA\nSPY',
      hint: 'One symbol per line.',
      showWhen: (config) => ['yahoo_rss', 'finnhub', 'alpha_vantage', 'polygon'].includes(String(config.provider || 'yahoo_rss').toLowerCase()),
    },
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      placeholder: 'Enter provider API key',
      hint: 'Required for Finnhub / Alpha Vantage / Polygon. You can also set env keys on backend.',
      showWhen: (config) => ['finnhub', 'alpha_vantage', 'polygon'].includes(String(config.provider || 'yahoo_rss').toLowerCase()),
    },
    {
      key: 'lookbackDays',
      label: 'Lookback Days',
      type: 'number',
      placeholder: '7',
      hint: 'For Finnhub company news, how many days of history to query.',
      showWhen: (config) => String(config.provider || 'yahoo_rss').toLowerCase() === 'finnhub',
    },
    {
      key: 'cnSecidsText',
      label: 'China Market IDs',
      type: 'textarea',
      placeholder: '1.000001\n0.399001\n0.399006',
      hint: 'Eastmoney secid list. Format: market.code (1=SH, 0=SZ), e.g. 1.000001.',
      showWhen: (config) => String(config.provider || 'yahoo_rss').toLowerCase() === 'eastmoney_cn',
    },
    {
      key: 'categoriesText',
      label: 'Crypto Categories',
      type: 'text',
      placeholder: 'BTC,ETH,DeFi,Exchange',
      hint: 'Optional for CryptoCompare. Comma-separated category filters.',
      showWhen: (config) => String(config.provider || 'yahoo_rss').toLowerCase() === 'cryptocompare_crypto',
    },
    {
      key: 'maxItemsPerSymbol',
      label: 'Max Headlines / Symbol',
      type: 'number',
      placeholder: '8',
      hint: 'How many latest items to fetch each run.',
    },
    {
      key: 'region',
      label: 'Region',
      type: 'text',
      placeholder: 'US',
      hint: 'Yahoo region code (default: US).',
      showWhen: (config) => String(config.provider || 'yahoo_rss').toLowerCase() === 'yahoo_rss',
    },
    {
      key: 'lang',
      label: 'Language',
      type: 'text',
      placeholder: 'en-US',
      hint: 'Language code (Yahoo default: en-US; CryptoCompare uses EN).',
      showWhen: (config) => ['yahoo_rss', 'cryptocompare_crypto'].includes(String(config.provider || 'yahoo_rss').toLowerCase()),
    },
  ],
  arxiv_authors: [
    { key: 'maxPerAuthor', label: 'Max papers per author', type: 'number', placeholder: '5', hint: 'How many recent papers to fetch per scholar per run (1–20).' },
    { key: 'lookbackDays', label: 'Lookback days', type: 'number', placeholder: '30', hint: 'Only include papers published within this many days (1–90).' },
    {
      key: 'keywords',
      label: 'Keyword Filter (optional)',
      type: 'textarea',
      placeholder: 'LLM\ntransformer',
      hint: 'Only show papers whose title or abstract contains at least one keyword. One per line.',
    },
  ],
};

function ConfigField({ field, value, onChange }) {
  if (field.type === 'hidden') return null;
  if (field.type === 'select') {
    const options = field.options || [];
    const firstOption = options[0];
    const firstValue = typeof firstOption === 'string' ? firstOption : (firstOption?.value || '');
    const selectedValue = value || field.placeholder || firstValue;
    return (
      <div className="ssh-form-row">
        <label>{field.label}</label>
        <select value={selectedValue} onChange={(e) => onChange(field.key, e.target.value)}>
          {options.map((opt) => {
            const optValue = typeof opt === 'string' ? opt : opt.value;
            const optLabel = typeof opt === 'string' ? opt : opt.label;
            return (
              <option key={optValue} value={optValue}>{optLabel}</option>
            );
          })}
        </select>
        {field.hint && <p className="ssh-form-hint">{field.hint}</p>}
      </div>
    );
  }

  if (field.type === 'checkbox') {
    const checked = value !== undefined ? !!value : field.defaultChecked !== false;
    return (
      <div className="ssh-form-row">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(field.key, e.target.checked)}
          />
          {field.label}
        </label>
        {field.hint && <p className="ssh-form-hint">{field.hint}</p>}
      </div>
    );
  }

  if (field.type === 'categories') {
    const current = (value || '').toString();
    const selected = new Set(current.split(',').map((s) => s.trim()).filter(Boolean));

    const toggleCategory = (code) => {
      const next = new Set(selected);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      onChange(field.key, [...next].join(', '));
    };

    return (
      <div className="ssh-form-row">
        <label>{field.label}</label>
        <div className="tracker-category-chips">
          {POPULAR_ARXIV_CATEGORIES.map(({ code, label }) => (
            <button
              key={code}
              type="button"
              className={`tracker-category-chip ${selected.has(code) ? 'selected' : ''}`}
              onClick={() => toggleCategory(code)}
              title={code}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={current}
          onChange={(e) => onChange(field.key, e.target.value)}
          placeholder="cs.LG, cs.AI, cs.CV"
          style={{ marginTop: 6 }}
        />
        {field.hint && <p className="ssh-form-hint">{field.hint}</p>}
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div className="ssh-form-row">
        <label>{field.label}</label>
        <textarea
          value={value || ''}
          onChange={(e) => onChange(field.key, e.target.value)}
          placeholder={field.placeholder}
          rows={5}
        />
        {field.hint && <p className="ssh-form-hint">{field.hint}</p>}
      </div>
    );
  }

  return (
    <div className="ssh-form-row">
      <label>{field.label}</label>
      <input
        type={field.type}
        value={value || ''}
        onChange={(e) => onChange(field.key, e.target.value)}
        placeholder={field.placeholder}
      />
      {field.hint && <p className="ssh-form-hint">{field.hint}</p>}
    </div>
  );
}

function detectCrossOsPath(p) {
  if (!p) return false;
  // Mac path on any server, or Windows path anywhere
  if (p.startsWith('/Users/')) return true;
  if (/^[A-Za-z]:[/\\]/.test(p)) return true;
  return false;
}

function SessionPathField({ value, onChange, apiUrl, getAuthHeaders }) {
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadedPath, setUploadedPath] = useState('');

  const isCrossOs = detectCrossOsPath(value);
  const isSet = Boolean(value);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      const text = await file.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch (_) {
        throw new Error('File is not valid JSON');
      }
      if (!Array.isArray(parsed.cookies) && !Array.isArray(parsed.origins)) {
        throw new Error('Not a valid Playwright session file (no cookies or origins)');
      }
      const res = await axios.post(
        `${apiUrl}/tracker/twitter/playwright/session-upload`,
        { sessionJson: parsed },
        { headers: getAuthHeaders() },
      );
      const serverPath = res.data?.path;
      if (!serverPath) throw new Error('Server did not return a path');
      onChange('storageStatePath', serverPath);
      setUploadedPath(serverPath);
    } catch (err) {
      setUploadError(err?.response?.data?.error || err.message || 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="ssh-form-row">
      <label>Browser Session File</label>

      {isSet && (
        <div className={`session-path-display ${isCrossOs ? 'is-cross-os' : 'is-ok'}`}>
          <code className="session-path-value">{value}</code>
          {isCrossOs
            ? <span className="session-path-badge warn">⚠ Mac/Windows path — upload below to fix</span>
            : <span className="session-path-badge ok">✓ Server path</span>}
        </div>
      )}

      <div className="session-upload-row">
        <input ref={fileRef} type="file" accept=".json" onChange={handleFileChange} style={{ display: 'none' }} />
        <button
          type="button"
          className={`ssh-btn-test session-upload-btn${isCrossOs ? ' is-urgent' : ''}`}
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Select the Playwright session JSON from your device to upload it to the server"
        >
          {uploading ? 'Uploading…' : '📁 Upload Session File from this device'}
        </button>
      </div>

      {/* Manual path override */}
      <input
        type="text"
        className="session-path-manual-input"
        value={value || ''}
        onChange={(e) => onChange('storageStatePath', e.target.value)}
        placeholder="/home/user/.playwright/x-session.json"
      />

      {uploadError && <p className="admin-error" style={{ margin: '4px 0 0' }}>{uploadError}</p>}
      {uploadedPath && !uploadError && (
        <p className="session-upload-success">✓ Saved to server at <code>{uploadedPath}</code></p>
      )}

      <p className="ssh-form-hint">
        <strong>Quick setup:</strong> Run <code>cd backend && npm run setup:x-session</code> — it opens a browser, you log in, and it uploads to the server automatically.<br />
        Or upload a session file manually with the button above.
      </p>
    </div>
  );
}

function TrackerAdmin({ apiUrl, getAuthHeaders, onClose }) {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [feedPerSource, setFeedPerSource] = useState([]);
  const [twitterPlaywrightSetup, setTwitterPlaywrightSetup] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [draggingSourceId, setDraggingSourceId] = useState(null);

  // Scholar import modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [importParsed, setImportParsed] = useState(null); // string[] after parse
  const [importParsing, setImportParsing] = useState(false);
  const [importError, setImportError] = useState('');

  const [runningId, setRunningId] = useState(null); // source id being run
  const [runningAll, setRunningAll] = useState(false);
  const lastRunErrors = Array.isArray(status?.lastRunResult)
    ? status.lastRunResult.filter((entry) => {
      if (!entry) return false;
      const errStr = String(entry.error || '').trim();
      if (!errStr && Number(entry.failed || 0) <= 0) return false;
      // Suppress stale session errors when setup-status already says ready
      if (twitterPlaywrightSetup?.ready && /storage state not found|setup:x-session/i.test(errStr)) return false;
      return true;
    })
    : [];
  const hasPlaywrightTwitterSource = sources.some((source) => (
    String(source?.type || '').toLowerCase() === 'twitter'
    && String(source?.config?.mode || 'nitter').toLowerCase() === 'playwright'
  ));

  useEffect(() => {
    fetchSources();
    fetchStatus();
    fetchFeedSummary();
    fetchTwitterPlaywrightSetupStatus();
  }, []);

  const fetchSources = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${apiUrl}/tracker/sources`, { headers: getAuthHeaders() });
      setSources(res.data || []);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load sources');
    } finally {
      setLoading(false);
    }
  };

  const fetchStatus = async () => {
    try {
      const res = await axios.get(`${apiUrl}/tracker/status`, { headers: getAuthHeaders() });
      setStatus(res.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load tracker status');
    }
  };

  const fetchFeedSummary = async () => {
    try {
      const res = await axios.get(`${apiUrl}/tracker/feed`, {
        params: { limit: 1, offset: 0 },
        headers: getAuthHeaders(),
      });
      setFeedPerSource(Array.isArray(res.data?.perSource) ? res.data.perSource : []);
    } catch (e) {
      setError(formatTrackerRequestError(e, 'Failed to load tracker feed summary'));
    }
  };

  const fetchTwitterPlaywrightSetupStatus = async () => {
    try {
      const res = await axios.get(`${apiUrl}/tracker/twitter/playwright/setup-status`, {
        headers: getAuthHeaders(),
      });
      setTwitterPlaywrightSetup(res.data || null);
    } catch (_) {
      // Optional diagnostics endpoint; ignore hard failures here.
      setTwitterPlaywrightSetup(null);
    }
  };

  const handleEdit = (source) => {
    const config = { ...source.config };
    if (source.type === 'twitter') {
      const mode = String(config.mode || (config.username ? 'nitter' : 'playwright')).toLowerCase();
      config.mode = mode;
      if (mode === 'playwright') {
        if (!config.trackingMode) config.trackingMode = 'paper';
        config.profileLinksText = (config.profileLinks || []).join('\n');
        if (config.onlyWithModeMatches === undefined) {
          config.onlyWithModeMatches = config.onlyWithPaperLinks === true;
        }
        if (config.crawlIntervalHours === undefined) config.crawlIntervalHours = 24;
      } else {
        config.username = config.username || '';
        config.nitterInstance = config.nitterInstance || '';
      }
    }
    if (source.type === 'finance') {
      config.provider = config.provider || 'yahoo_rss';
      config.symbolsText = Array.isArray(config.symbols) ? config.symbols.join('\n') : '';
      config.cnSecidsText = Array.isArray(config.cnSecids) ? config.cnSecids.join('\n') : '';
      config.categoriesText = Array.isArray(config.categories) ? config.categories.join(', ') : (config.categoriesText || '');
      if (config.maxItemsPerSymbol === undefined) config.maxItemsPerSymbol = 8;
      if (config.lookbackDays === undefined) config.lookbackDays = 7;
      if (!config.region) config.region = 'US';
      if (!config.lang) config.lang = 'en-US';
      if (!config.apiKey) config.apiKey = '';
    }
    if (source.type === 'rss') {
      config.feedUrlsText = Array.isArray(config.feedUrls) ? config.feedUrls.join('\n') : '';
      if (config.maxItemsPerFeed === undefined) config.maxItemsPerFeed = 20;
      if (config.timeoutMs === undefined) config.timeoutMs = 15000;
      if (config.lookbackDays === undefined) config.lookbackDays = 180;
    }
    if (source.type === 'arxiv_authors') {
      // authorsText is the editable textarea; authors is the stored array
      config.authorsText = Array.isArray(config.authors) ? config.authors.join('\n') : '';
      if (config.maxPerAuthor === undefined) config.maxPerAuthor = 5;
      if (config.lookbackDays === undefined) config.lookbackDays = 30;
    }
    setForm({ type: source.type, name: source.name, config });
    setEditingId(source.id);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this tracker source?')) return;
    try {
      await axios.delete(`${apiUrl}/tracker/sources/${id}`, { headers: getAuthHeaders() });
      setSources((prev) => prev.filter((s) => s.id !== id));
      fetchTwitterPlaywrightSetupStatus();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to delete source');
    }
  };

  const handleToggleEnabled = async (source) => {
    try {
      await axios.put(`${apiUrl}/tracker/sources/${source.id}`, { enabled: !source.enabled }, { headers: getAuthHeaders() });
      setSources((prev) => prev.map((s) => s.id === source.id ? { ...s, enabled: !s.enabled } : s));
      fetchTwitterPlaywrightSetupStatus();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to update source');
    }
  };

  const handleRunSource = async (source) => {
    setRunningId(source.id);
    try {
      await axios.post(`${apiUrl}/tracker/sources/${source.id}/run`, {}, { headers: getAuthHeaders() });
      setTimeout(() => {
        fetchStatus();
        fetchTwitterPlaywrightSetupStatus();
      }, 3000);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to run source');
    } finally {
      setTimeout(() => setRunningId(null), 2000);
    }
  };

  const handleRunAll = async () => {
    setRunningAll(true);
    try {
      await axios.post(`${apiUrl}/tracker/run`, {}, { headers: getAuthHeaders() });
      setTimeout(() => {
        fetchStatus();
        fetchTwitterPlaywrightSetupStatus();
      }, 3000);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to run tracker');
    } finally {
      setTimeout(() => setRunningAll(false), 2000);
    }
  };

  const persistSourceOrder = async (orderedSources) => {
    const sourceIds = orderedSources.map((source) => source.id);
    await axios.post(
      `${apiUrl}/tracker/sources/reorder`,
      { sourceIds },
      { headers: getAuthHeaders() },
    );
  };

  const handleDragStart = (sourceId) => {
    setDraggingSourceId(sourceId);
  };

  const handleDragEnd = () => {
    setDraggingSourceId(null);
  };

  const handleDropOnSource = async (targetSourceId) => {
    if (!draggingSourceId || draggingSourceId === targetSourceId) {
      setDraggingSourceId(null);
      return;
    }

    const current = [...sources];
    const fromIndex = current.findIndex((source) => source.id === draggingSourceId);
    const toIndex = current.findIndex((source) => source.id === targetSourceId);
    if (fromIndex < 0 || toIndex < 0) {
      setDraggingSourceId(null);
      return;
    }

    const next = [...current];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    setSources(next);
    setDraggingSourceId(null);

    try {
      await persistSourceOrder(next);
      fetchStatus();
      fetchFeedSummary();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to persist source order');
      fetchSources();
    }
  };

  const handleConfigChange = (key, value) => {
    setForm((f) => ({ ...f, config: { ...f.config, [key]: value } }));
  };

  const handleTypeChange = (type) => {
    setForm({
      type,
      name: '',
      config: (
        type === 'twitter'
          ? { mode: 'nitter' }
          : type === 'rss'
            ? { feedUrlsText: '', maxItemsPerFeed: 20, timeoutMs: 15000, lookbackDays: 180 }
          : type === 'finance'
            ? { provider: 'yahoo_rss', region: 'US', lang: 'en-US', maxItemsPerSymbol: 8, lookbackDays: 7 }
            : type === 'arxiv_authors'
              ? { authorsText: '', maxPerAuthor: 5, lookbackDays: 30 }
              : {}
      ),
    });
  };

  const handleParseAuthorNames = async () => {
    if (!importText.trim()) return;
    setImportParsing(true);
    setImportError('');
    try {
      const res = await axios.post(
        `${apiUrl}/tracker/parse-author-names`,
        { text: importText },
        { headers: getAuthHeaders() },
      );
      setImportParsed(Array.isArray(res.data?.authors) ? res.data.authors : []);
    } catch (e) {
      setImportError(e.response?.data?.error || 'Parse failed');
    } finally {
      setImportParsing(false);
    }
  };

  const handleImportAuthors = () => {
    const names = Array.isArray(importParsed) ? importParsed : [];
    if (names.length === 0) return;
    // Merge into current form's authorsText (if editing) or start a new arxiv_authors form
    const existing = String(form.config.authorsText || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const merged = [...new Set([...existing, ...names])];
    setForm((f) => ({
      ...f,
      type: 'arxiv_authors',
      config: { ...f.config, authorsText: merged.join('\n') },
    }));
    setShowImportModal(false);
    setImportParsed(null);
    setImportText('');
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        type: form.type,
        name: form.name,
        config: normalizeFormConfig(form.type, form.config),
      };
      if (editingId) {
        await axios.put(`${apiUrl}/tracker/sources/${editingId}`, payload, { headers: getAuthHeaders() });
        setSources((prev) => prev.map((s) => s.id === editingId ? { ...s, ...payload } : s));
      } else {
        const res = await axios.post(`${apiUrl}/tracker/sources`, payload, { headers: getAuthHeaders() });
        setSources((prev) => [...prev, res.data]);
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      setShowForm(false);
      fetchTwitterPlaywrightSetupStatus();
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save source');
    } finally {
      setSaving(false);
    }
  };

  const getSourceLastError = (source) => {
    const sourceType = String(source?.type || '').toLowerCase();
    const sourceName = String(source?.name || '').trim();
    const isStaleSessionErr = (errStr) =>
      twitterPlaywrightSetup?.ready && /storage state not found|setup:x-session/i.test(errStr);
    if (Array.isArray(status?.lastRunResult)) {
      const match = status.lastRunResult.find((entry) => (
        String(entry?.type || '').toLowerCase() === sourceType
        && String(entry?.source || '').trim() === sourceName
        && (String(entry?.error || '').trim() || Number(entry?.failed || 0) > 0)
      ));
      if (match) {
        const errStr = String(match.error || '').trim();
        if (errStr && !isStaleSessionErr(errStr)) return formatSourceError(errStr);
        if (!errStr) return 'Last run failed';
      }
    }
    const feedMatch = feedPerSource.find((entry) => (
      String(entry?.type || '').toLowerCase() === sourceType
      && String(entry?.source || '').trim() === sourceName
      && entry?.reason
    ));
    if (feedMatch?.reason && !isStaleSessionErr(String(feedMatch.reason))) {
      return formatSourceError(String(feedMatch.reason));
    }
    return '';
  };

  const handleCancelForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(false);
    setError(null);
  };

  return (
    <div className="admin-panel-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="admin-panel">
        <div className="admin-panel-header">
          <h3>Paper Tracker</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="admin-panel-body">
          {error && <p className="admin-error">{error}</p>}

          {/* Status banner */}
          {status && (
            <div className="tracker-status-bar">
              <span className={`tracker-status-dot ${status.running ? 'running' : 'idle'}`} />
              {status.running ? 'Running...' : (
                status.lastRunAt
                  ? `Last run: ${new Date(status.lastRunAt).toLocaleString()}`
                  : 'Never run'
              )}
              {status.lastRunResult && status.lastRunResult.length > 0 && (
                <span className="tracker-status-summary">
                  &nbsp;— {status.lastRunResult.map((r) =>
                    `${r.source}: +${r.imported || 0}`
                  ).join(', ')}
                </span>
              )}
              <button
                className="tracker-run-all-btn"
                onClick={handleRunAll}
                disabled={runningAll || status.running}
              >
                {runningAll ? 'Starting...' : 'Run Now'}
              </button>
            </div>
          )}

          {lastRunErrors.length > 0 && (
            <div className="tracker-info" style={{ marginTop: 8 }}>
              {lastRunErrors.map((entry, idx) => (
                <p key={`tracker-run-error-${idx}`} className="admin-error" style={{ margin: '2px 0' }}>
                  {entry.source || entry.type || 'tracker source'}: {entry.error || 'Last run failed'}
                </p>
              ))}
            </div>
          )}

          {hasPlaywrightTwitterSource && twitterPlaywrightSetup && (
            <div className={`tracker-info ${twitterPlaywrightSetup.ready ? 'tracker-setup-ok' : 'tracker-setup-warning'}`} style={{ marginTop: 8 }}>
              {twitterPlaywrightSetup.ready ? (
                <p style={{ margin: 0 }}>
                  <span className="session-path-badge ok">&#10003; X session OK</span>
                  &nbsp;{twitterPlaywrightSetup.totalTwitterPlaywrightSources} source(s) configured
                  <button
                    type="button"
                    className="tracker-recheck-btn"
                    onClick={fetchTwitterPlaywrightSetupStatus}
                    style={{ marginLeft: 8, fontSize: '0.85em', cursor: 'pointer', background: 'none', border: '1px solid #ccc', borderRadius: 4, padding: '1px 8px' }}
                  >
                    Re-check
                  </button>
                </p>
              ) : (
                <>
                  <p style={{ margin: '0 0 4px' }}><strong>Twitter/X session needs setup</strong></p>
                  {!twitterPlaywrightSetup.chromiumExecutableExists && (
                    <p className="admin-error" style={{ margin: '2px 0' }}>
                      Chromium missing on server. Run: <code>npx playwright install chromium</code>
                    </p>
                  )}
                  {twitterPlaywrightSetup.sourceStatuses?.some((s) => !s.storageStatePathExists) && (
                    <div style={{ margin: '4px 0' }}>
                      <p className="admin-error" style={{ margin: '2px 0' }}>
                        Session file missing. Fix: <code>cd backend && npm run setup:x-session</code>
                      </p>
                      <SessionPathField
                        value={twitterPlaywrightSetup.envStorageStatePath || ''}
                        onChange={async (_key, newPath) => {
                          // Update all broken sources at once
                          const broken = (twitterPlaywrightSetup.sourceStatuses || []).filter((s) => !s.storageStatePathExists);
                          for (const s of broken) {
                            try {
                              await axios.put(`${apiUrl}/tracker/sources/${s.id}`, {
                                config: { storageStatePath: newPath },
                              }, { headers: getAuthHeaders() });
                            } catch (_) {}
                          }
                          await fetchTwitterPlaywrightSetupStatus();
                        }}
                        apiUrl={apiUrl}
                        getAuthHeaders={getAuthHeaders}
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    className="tracker-recheck-btn"
                    onClick={fetchTwitterPlaywrightSetupStatus}
                    style={{ marginTop: 4, fontSize: '0.85em', cursor: 'pointer', background: 'none', border: '1px solid #ccc', borderRadius: 4, padding: '2px 10px' }}
                  >
                    Re-check
                  </button>
                </>
              )}
            </div>
          )}

          {/* Source list */}
          <div className="tracker-info">
            <p>All tracker sources are discovery-only and won&apos;t auto-add papers to your library. Papers are saved only when you click save. Server-side metadata refresh runs daily by default.</p>
            <p style={{ marginTop: 4 }}>Drag sources to set weight (top = higher priority in tracker feed).</p>
          </div>

          {loading ? (
            <p className="admin-loading">Loading sources...</p>
          ) : (
            <>
              {sources.length === 0 && !showForm && (
                <p className="admin-empty">No tracker sources configured yet.</p>
              )}

              {sources.length > 0 && (
                <div className="tracker-source-list">
                  {sources.map((source) => {
                    const sourceError = getSourceLastError(source);
                    return (
                    <div
                      key={source.id}
                      className={`tracker-source-item ${source.enabled ? '' : 'disabled'} ${draggingSourceId === source.id ? 'is-dragging' : ''}`}
                      draggable={sources.length > 1}
                      onDragStart={() => handleDragStart(source.id)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDropOnSource(source.id)}
                    >
                      <div className="tracker-source-info">
                        <span className="tracker-drag-handle" title="Drag to change weight">⋮⋮</span>
                        <span className={`tracker-type-badge tracker-type-${source.type}`}>
                          {SOURCE_TYPE_LABELS[source.type] || source.type}
                        </span>
                        <span className="tracker-source-name">{source.name}</span>
                        {source.type === 'arxiv_authors' && Array.isArray(source.config?.authors) && (
                          <span className="tracker-source-last-check">
                            {source.config.authors.length} scholar{source.config.authors.length !== 1 ? 's' : ''}
                          </span>
                        )}
                        {source.lastCheckedAt && (
                          <span className="tracker-source-last-check">
                            checked {new Date(source.lastCheckedAt).toLocaleDateString()}
                          </span>
                        )}
                        {sourceError && (
                          <span className="tracker-source-last-check" style={{ color: '#b91c1c' }}>
                            error: {sourceError}
                          </span>
                        )}
                      </div>
                      <div className="tracker-source-actions">
                        <button
                          className={`tracker-toggle-btn ${source.enabled ? 'enabled' : 'disabled'}`}
                          onClick={() => handleToggleEnabled(source)}
                          title={source.enabled ? 'Disable' : 'Enable'}
                        >
                          {source.enabled ? 'On' : 'Off'}
                        </button>
                        <button
                          className="ssh-btn-test"
                          onClick={() => handleRunSource(source)}
                          disabled={runningId === source.id}
                        >
                          {runningId === source.id ? '...' : 'Run'}
                        </button>
                        <button className="ssh-btn-edit" onClick={() => handleEdit(source)}>Edit</button>
                        <button className="ssh-btn-delete" onClick={() => handleDelete(source.id)}>Delete</button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}

              {/* Add / Edit form */}
              {showForm ? (
                <form className="ssh-server-form" onSubmit={handleSubmit}>

                  <h4>{editingId ? 'Edit Source' : 'Add Source'}</h4>

                  {!editingId && (
                    <div className="ssh-form-row">
                      <label>Source Type</label>
                      <select value={form.type} onChange={(e) => handleTypeChange(e.target.value)}>
                        {SOURCE_TYPES.map((t) => (
                          <option key={t} value={t}>{SOURCE_TYPE_LABELS[t]}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="ssh-form-row">
                    <label>Name</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder={
                        form.type === 'hf' ? 'HuggingFace Daily Papers' :
                        form.type === 'alphaxiv' ? 'Research Domain: cs.LG + cs.AI' :
                        form.type === 'twitter' ? '@karpathy' :
                        form.type === 'rss' ? 'Blogs: LMSYS + Scientific Spaces' :
                        form.type === 'finance' ? 'Finance: AAPL + NVDA' :
                        form.type === 'arxiv_authors' ? 'My Research Group' :
                        'Source name'
                      }
                      required
                    />
                  </div>

                  {(CONFIG_FIELDS[form.type] || []).map((field) => (
                    (!field.showWhen || field.showWhen(form.config)) && (
                    <ConfigField
                      key={field.key}
                      field={field}
                      value={form.config[field.key]}
                      onChange={handleConfigChange}
                    />
                    )
                  ))}

                  {form.type === 'alphaxiv' && (
                    <div className="ssh-form-row">
                      <p className="ssh-form-hint">
                        Fetches directly from the official arXiv API. Click category chips to toggle, or type codes manually. Papers are deduplicated across all your sources.
                      </p>
                    </div>
                  )}

                  {form.type === 'arxiv_authors' && (
                    <div className="ssh-form-row">
                      <label>Scholar Names</label>
                      <textarea
                        value={form.config.authorsText || ''}
                        onChange={(e) => handleConfigChange('authorsText', e.target.value)}
                        placeholder={'Yann LeCun\nAndrej Karpathy\nGeoffrey Hinton'}
                        rows={6}
                      />
                      <p className="ssh-form-hint">One scholar name per line. Used to search arXiv author field.</p>
                      <button
                        type="button"
                        className="ssh-btn-test"
                        style={{ marginTop: 6 }}
                        onClick={() => {
                          setImportText(form.config.authorsText || '');
                          setImportParsed(null);
                          setShowImportModal(true);
                        }}
                      >
                        Parse &amp; Clean Names with AI
                      </button>
                    </div>
                  )}

                  {form.type === 'finance' && (
                    <div className="ssh-form-row">
                      <p className="ssh-form-hint">
                        Free market providers now include <strong>Finnhub</strong>, <strong>Alpha Vantage</strong>, <strong>Polygon</strong>, plus free no-key sources for <strong>China market</strong> (Eastmoney) and <strong>crypto-specific</strong> news (CryptoCompare).
                      </p>
                    </div>
                  )}

                  {form.type === 'rss' && (
                    <div className="ssh-form-row">
                      <p className="ssh-form-hint">
                        RSS mode tracks generic blogs/news feeds. Each feed entry appears as a separate article in <strong>Latest</strong>.
                      </p>
                    </div>
                  )}

                  {form.type === 'twitter' && String(form.config.mode || 'nitter').toLowerCase() === 'playwright' && (
                    <>
                      <SessionPathField
                        value={form.config.storageStatePath || ''}
                        onChange={handleConfigChange}
                        apiUrl={apiUrl}
                        getAuthHeaders={getAuthHeaders}
                      />
                      <div className="ssh-form-row">
                        <div className="tracker-requirement-note">
                          <strong>Server requirements:</strong>
                          <ol style={{ margin: '6px 0 0 16px', padding: 0 }}>
                            <li>Playwright + Chromium installed on backend (<code>npx playwright install chromium</code>).</li>
                            <li>A session file uploaded above (login session for X/Twitter).</li>
                          </ol>
                        </div>
                      </div>
                    </>
                  )}

                  <div className="ssh-form-actions">
                    <button type="button" className="ssh-btn-cancel" onClick={handleCancelForm}>Cancel</button>
                    <button type="submit" className="ssh-btn-save" disabled={saving}>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </form>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="ssh-btn-add" onClick={() => setShowForm(true)}>
                    + Add Source
                  </button>
                  <button
                    className="ssh-btn-test"
                    onClick={() => {
                      setImportText('');
                      setImportParsed(null);
                      setImportError('');
                      setShowImportModal(true);
                    }}
                  >
                    Import Scholar List
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Scholar import modal */}
      {showImportModal && (
        <div className="admin-panel-overlay" style={{ zIndex: 1100 }} onClick={(e) => e.target === e.currentTarget && setShowImportModal(false)}>
          <div className="admin-panel" style={{ maxWidth: 520 }}>
            <div className="admin-panel-header">
              <h3>Import Scholar Names</h3>
              <button className="close-btn" onClick={() => setShowImportModal(false)}>×</button>
            </div>
            <div className="admin-panel-body">
              <p style={{ marginBottom: 10, fontSize: '0.85rem', color: '#555' }}>
                Paste a list of researcher names — one per line, comma-separated, or mixed formats.
                Click &ldquo;Parse with AI&rdquo; to clean and normalize the list.
              </p>
              <textarea
                style={{ width: '100%', minHeight: 140, fontFamily: 'inherit', fontSize: '0.85rem', boxSizing: 'border-box' }}
                value={importText}
                onChange={(e) => { setImportText(e.target.value); setImportParsed(null); }}
                placeholder={'Yann LeCun\nAndrej Karpathy, Geoffrey Hinton\nProf. Yoshua Bengio (Mila)'}
              />
              {importError && <p className="admin-error">{importError}</p>}
              <div className="ssh-form-actions" style={{ marginTop: 8 }}>
                <button type="button" className="ssh-btn-cancel" onClick={() => setShowImportModal(false)}>Cancel</button>
                <button
                  type="button"
                  className="ssh-btn-test"
                  onClick={handleParseAuthorNames}
                  disabled={importParsing || !importText.trim()}
                >
                  {importParsing ? 'Parsing…' : 'Parse with AI'}
                </button>
              </div>
              {Array.isArray(importParsed) && (
                <div style={{ marginTop: 16 }}>
                  <p style={{ fontSize: '0.8rem', color: '#374151', marginBottom: 6 }}>
                    <strong>{importParsed.length}</strong> names parsed — review and confirm:
                  </p>
                  <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 12px', maxHeight: 200, overflowY: 'auto' }}>
                    {importParsed.map((name, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 0', borderBottom: i < importParsed.length - 1 ? '1px solid #f3f4f6' : 'none' }}>
                        <span style={{ fontSize: '0.85rem' }}>{name}</span>
                        <button
                          type="button"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: '0.8rem' }}
                          onClick={() => setImportParsed((prev) => prev.filter((_, j) => j !== i))}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="ssh-form-actions" style={{ marginTop: 10 }}>
                    <button type="button" className="ssh-btn-cancel" onClick={() => setImportParsed(null)}>Re-parse</button>
                    <button
                      type="button"
                      className="ssh-btn-save"
                      onClick={handleImportAuthors}
                      disabled={importParsed.length === 0}
                    >
                      Add to Source ({importParsed.length})
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function normalizeFormConfig(type, config) {
  if (type === 'arxiv_authors') {
    const authors = String(config.authorsText || '')
      .split(/[\n;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const maxPerAuthorRaw = parseInt(config.maxPerAuthor || '5', 10);
    const lookbackDaysRaw = parseInt(config.lookbackDays || '30', 10);
    return {
      authors,
      maxPerAuthor: Number.isFinite(maxPerAuthorRaw) ? Math.max(1, Math.min(maxPerAuthorRaw, 20)) : 5,
      lookbackDays: Number.isFinite(lookbackDaysRaw) ? Math.max(1, Math.min(lookbackDaysRaw, 90)) : 30,
    };
  }

  if (type === 'rss') {
    const feedUrls = String(config.feedUrlsText || '')
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const maxRaw = parseInt(config.maxItemsPerFeed || '20', 10);
    const timeoutRaw = parseInt(config.timeoutMs || '15000', 10);
    const lookbackRaw = parseInt(config.lookbackDays || '180', 10);
    return {
      feedUrls,
      maxItemsPerFeed: Number.isFinite(maxRaw) ? maxRaw : 20,
      timeoutMs: Number.isFinite(timeoutRaw) ? timeoutRaw : 15000,
      lookbackDays: Number.isFinite(lookbackRaw) ? Math.max(1, Math.min(lookbackRaw, 3650)) : 180,
      keywords: String(config.keywords || '').trim(),
    };
  }

  if (type === 'finance') {
    const provider = String(config.provider || 'yahoo_rss').toLowerCase();
    const symbols = String(config.symbolsText || '')
      .split(/[\n,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const cnSecids = String(config.cnSecidsText || '')
      .split(/[\n,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const categories = String(config.categoriesText || '')
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const maxRaw = parseInt(config.maxItemsPerSymbol || '8', 10);
    const lookbackRaw = parseInt(config.lookbackDays || '7', 10);
    return {
      provider,
      symbols,
      cnSecids,
      categories,
      apiKey: String(config.apiKey || '').trim(),
      maxItemsPerSymbol: Number.isFinite(maxRaw) ? maxRaw : 8,
      lookbackDays: Number.isFinite(lookbackRaw) ? lookbackRaw : 7,
      region: String(config.region || 'US').trim() || 'US',
      lang: String(config.lang || 'en-US').trim() || 'en-US',
    };
  }

  if (type !== 'twitter') return config;

  const mode = String(config.mode || 'nitter').toLowerCase();
  if (mode === 'nitter') {
    return {
      mode: 'nitter',
      username: String(config.username || '').trim().replace(/^@/, ''),
      nitterInstance: String(config.nitterInstance || '').trim(),
    };
  }

  const profileLinks = String(config.profileLinksText || '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const maxPostsRaw = parseInt(config.maxPostsPerProfile || '15', 10);
  const crawlIntervalRaw = parseInt(config.crawlIntervalHours || '24', 10);
  return {
    mode: 'playwright',
    trackingMode: String(config.trackingMode || 'paper').toLowerCase(),
    profileLinks,
    maxPostsPerProfile: Number.isFinite(maxPostsRaw) ? maxPostsRaw : 15,
    onlyWithModeMatches: config.onlyWithModeMatches === true,
    // Backward compatibility while backend migrates.
    onlyWithPaperLinks: config.onlyWithModeMatches === true,
    crawlIntervalHours: Number.isFinite(crawlIntervalRaw) ? crawlIntervalRaw : 24,
    storageStatePath: (config.storageStatePath || '').trim(),
  };
}

export default TrackerAdmin;
