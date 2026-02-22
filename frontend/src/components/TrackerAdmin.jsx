import { useState, useEffect } from 'react';
import axios from 'axios';

const SOURCE_TYPES = ['hf', 'alphaxiv', 'twitter', 'scholar'];
const SOURCE_TYPE_LABELS = {
  hf: 'HuggingFace Daily',
  alphaxiv: 'arXiv Categories',
  twitter: 'Twitter/X',
  scholar: 'Google Scholar',
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

// Config fields per source type
const CONFIG_FIELDS = {
  hf: [
    { key: 'minUpvotes', label: 'Min Upvotes', type: 'number', placeholder: '10', hint: 'Only import papers with at least this many upvotes' },
    { key: 'lookbackDays', label: 'Lookback Days', type: 'number', placeholder: '7', hint: 'How many past days to check each run' },
  ],
  alphaxiv: [
    { key: 'categories', label: 'Categories', type: 'categories', hint: 'arXiv category codes to monitor, comma-separated (e.g. cs.LG, cs.AI)' },
    { key: 'interval', label: 'Time Window', type: 'select', options: ['3 Days', '7 Days', '30 Days', '90 Days'], placeholder: '7 Days', hint: 'Time window for ranking papers on AlphaXiv' },
    { key: 'sortBy', label: 'Sort By', type: 'select', options: ['Views', 'Hot', 'Likes', 'GitHub', 'Comments'], placeholder: 'Views', hint: 'How to rank papers — Views is most reliable' },
    { key: 'minViews', label: 'Min Views', type: 'number', placeholder: '0', hint: 'Only import papers with at least this many views on AlphaXiv' },
  ],
  twitter: [
    {
      key: 'trackingMode',
      label: 'Tracking Mode',
      type: 'select',
      options: [{ value: 'paper', label: 'Paper Mode' }],
      placeholder: 'paper',
      hint: 'Current mode detects paper-related links/arXiv IDs. Additional modes (finance/web3/etc.) can be added later.',
    },
    {
      key: 'profileLinksText',
      label: 'Twitter Accounts',
      type: 'textarea',
      placeholder: 'karpathy\nylecun\nhttps://x.com/AndrewYNg',
      hint: 'One handle or x.com/twitter.com URL per line.',
    },
    {
      key: 'storageStatePath',
      label: 'Browser Session File',
      type: 'text',
      placeholder: '/home/user/.playwright/x-session.json',
      hint: 'Path to Playwright storage state JSON (saved login session for X/Twitter).',
    },
    {
      key: 'maxPostsPerProfile',
      label: 'Max Posts Per Profile',
      type: 'number',
      placeholder: '15',
      hint: 'How many recent posts to scan per user.',
    },
    {
      key: 'crawlIntervalHours',
      label: 'Crawl Interval (hours)',
      type: 'number',
      placeholder: '24',
      hint: 'Minimum hours between runs (default: 24). Playwright scraping is slow — daily is recommended.',
    },
    {
      key: 'onlyWithModeMatches',
      label: 'Only import mode-matching posts',
      type: 'checkbox',
      defaultChecked: false,
      hint: 'In paper mode, skip posts without detected arXiv/paper links.',
    },
  ],
  scholar: [
    { key: 'email', label: 'Gmail Address', type: 'email', placeholder: 'you@gmail.com', hint: 'Gmail account that receives Scholar alerts' },
    { key: 'password', label: 'App Password', type: 'password', placeholder: '16-char app password', hint: 'Gmail App Password (not your main password). Create at myaccount.google.com/apppasswords' },
    { key: 'markRead', label: 'Mark emails as read', type: 'checkbox', hint: 'Mark Scholar alert emails as read after processing' },
  ],
};

function ConfigField({ field, value, onChange }) {
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

function TrackerAdmin({ apiUrl, getAuthHeaders, onClose }) {
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [runningId, setRunningId] = useState(null); // source id being run
  const [runningAll, setRunningAll] = useState(false);

  useEffect(() => {
    fetchSources();
    fetchStatus();
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
    } catch (_) {}
  };

  const handleEdit = (source) => {
    const config = { ...source.config };
    if (source.type === 'twitter') {
      config.mode = 'playwright';
      if (!config.trackingMode) config.trackingMode = 'paper';
      config.profileLinksText = (config.profileLinks || []).join('\n');
      if (config.onlyWithModeMatches === undefined) {
        config.onlyWithModeMatches = config.onlyWithPaperLinks === true;
      }
      if (config.crawlIntervalHours === undefined) config.crawlIntervalHours = 24;
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
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to delete source');
    }
  };

  const handleToggleEnabled = async (source) => {
    try {
      await axios.put(`${apiUrl}/tracker/sources/${source.id}`, { enabled: !source.enabled }, { headers: getAuthHeaders() });
      setSources((prev) => prev.map((s) => s.id === source.id ? { ...s, enabled: !s.enabled } : s));
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to update source');
    }
  };

  const handleRunSource = async (source) => {
    setRunningId(source.id);
    try {
      await axios.post(`${apiUrl}/tracker/sources/${source.id}/run`, {}, { headers: getAuthHeaders() });
      setTimeout(fetchStatus, 3000);
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
      setTimeout(fetchStatus, 3000);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to run tracker');
    } finally {
      setTimeout(() => setRunningAll(false), 2000);
    }
  };

  const handleConfigChange = (key, value) => {
    setForm((f) => ({ ...f, config: { ...f.config, [key]: value } }));
  };

  const handleTypeChange = (type) => {
    setForm({
      type,
      name: '',
      config: type === 'twitter' ? { mode: 'playwright', trackingMode: 'paper' } : {},
    });
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
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to save source');
    } finally {
      setSaving(false);
    }
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

          {/* Source list */}
          <div className="tracker-info">
            <p>All tracker sources are discovery-only and won&apos;t auto-add papers to your library. Papers are saved only when you click save. Tracker checks run every 6 hours.</p>
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
                  {sources.map((source) => (
                    <div key={source.id} className={`tracker-source-item ${source.enabled ? '' : 'disabled'}`}>
                      <div className="tracker-source-info">
                        <span className={`tracker-type-badge tracker-type-${source.type}`}>
                          {SOURCE_TYPE_LABELS[source.type] || source.type}
                        </span>
                        <span className="tracker-source-name">{source.name}</span>
                        {source.lastCheckedAt && (
                          <span className="tracker-source-last-check">
                            checked {new Date(source.lastCheckedAt).toLocaleDateString()}
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
                  ))}
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
                        form.type === 'alphaxiv' ? 'arXiv cs.LG + cs.AI' :
                        form.type === 'twitter' ? '@karpathy' :
                        'My Scholar Alerts'
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

                  {form.type === 'scholar' && (
                    <div className="ssh-form-row">
                      <p className="ssh-form-hint" style={{ color: '#f59e0b' }}>
                        Gmail App Password required. Create one at{' '}
                        <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">
                          myaccount.google.com/apppasswords
                        </a>
                      </p>
                    </div>
                  )}

                  {form.type === 'twitter' && (
                    <div className="ssh-form-row">
                      <div className="tracker-requirement-note">
                        <strong>Requirements:</strong>
                        <ol style={{ margin: '6px 0 0 16px', padding: 0 }}>
                          <li>A <strong>Codex CLI</strong> (or Claude Code) with <strong>Playwright MCP</strong> support must be running on this server to operate the browser.</li>
                          <li>A <strong>Chrome / Chromium</strong> instance already <strong>logged into X/Twitter</strong> — use Playwright MCP to sign in once and export the session to the path above.</li>
                        </ol>
                      </div>
                    </div>
                  )}

                  <div className="ssh-form-actions">
                    <button type="button" className="ssh-btn-cancel" onClick={handleCancelForm}>Cancel</button>
                    <button type="submit" className="ssh-btn-save" disabled={saving}>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </form>
              ) : (
                <button className="ssh-btn-add" onClick={() => setShowForm(true)}>
                  + Add Source
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function normalizeFormConfig(type, config) {
  if (type !== 'twitter') return config;

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
