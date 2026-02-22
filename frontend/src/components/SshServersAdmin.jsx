import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

// Parse SSH config file content (runs entirely in the browser)
function parseSshConfig(content) {
  const hosts = [];
  let current = null;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const spaceIdx = line.search(/\s/);
    if (spaceIdx === -1) continue;
    const key = line.slice(0, spaceIdx).toLowerCase();
    const value = line.slice(spaceIdx).trim();
    if (key === 'host') {
      if (current && current.alias !== '*') hosts.push(current);
      current = { alias: value, host: value, user: '', port: 22, identityFile: '~/.ssh/id_rsa' };
    } else if (current) {
      if (key === 'hostname') current.host = value;
      else if (key === 'user') current.user = value;
      else if (key === 'port') current.port = parseInt(value) || 22;
      else if (key === 'identityfile') current.identityFile = value;
    }
  }
  if (current && current.alias !== '*') hosts.push(current);
  return hosts;
}

const EMPTY_FORM = { name: '', host: '', user: '', port: '22', ssh_key_path: '~/.ssh/id_rsa' };

function SshServersAdmin({ apiUrl, getAuthHeaders, onClose }) {
  // ── Configured servers ───────────────────────────────────────────────────
  const [servers, setServers] = useState([]);
  const [loadingServers, setLoadingServers] = useState(true);
  const [error, setError] = useState(null);

  // ── Add / Edit form ──────────────────────────────────────────────────────
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);

  // ── Public key section ───────────────────────────────────────────────────
  const [publicKey, setPublicKey] = useState(null);  // string or null
  const [pubKeyError, setPubKeyError] = useState(null);
  const [copied, setCopied] = useState(false);

  // ── SSH config import ────────────────────────────────────────────────────
  const [showImport, setShowImport] = useState(false);
  const [configHosts, setConfigHosts] = useState(null); // null = not loaded yet
  const [addingAlias, setAddingAlias] = useState(null); // alias being added
  const fileInputRef = useRef(null);

  // ── Per-server test / authorize state ───────────────────────────────────
  // testResults: { [id]: { status: 'ok'|'fail'|'loading', message } }
  const [testResults, setTestResults] = useState({});
  // authorizeState: { [id]: { open: bool, password: string, loading: bool, result: {ok,msg}|null } }
  const [authorizeState, setAuthorizeState] = useState({});

  const copyTimers = useRef({});

  // ── On mount ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchServers();
    fetchPublicKey();
  }, []);

  const fetchServers = async () => {
    try {
      setLoadingServers(true);
      const res = await axios.get(`${apiUrl}/ssh-servers`, { headers: getAuthHeaders() });
      setServers(res.data.servers || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load servers');
    } finally {
      setLoadingServers(false);
    }
  };

  const fetchPublicKey = async () => {
    try {
      const res = await axios.get(`${apiUrl}/ssh-servers/public-key`, { headers: getAuthHeaders() });
      setPublicKey(res.data.publicKey);
    } catch (err) {
      setPubKeyError(err.response?.data?.error || 'Could not read public key');
    }
  };

  // ── Public key copy ──────────────────────────────────────────────────────
  const copyPublicKey = () => {
    if (!publicKey) return;
    navigator.clipboard.writeText(publicKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const copyText = (text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      clearTimeout(copyTimers.current[key]);
      setTestResults((prev) => ({ ...prev, [key + '_copied']: true }));
      copyTimers.current[key] = setTimeout(() =>
        setTestResults((prev) => ({ ...prev, [key + '_copied']: false })), 2000
      );
    });
  };

  // ── SSH config import ────────────────────────────────────────────────────
  const toggleImport = () => {
    if (showImport) { setShowImport(false); return; }
    setShowImport(true);
  };

  const handleConfigFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const hosts = parseSshConfig(ev.target.result || '');
      setConfigHosts(hosts);
    };
    reader.readAsText(file);
    // reset so the same file can be re-selected
    e.target.value = '';
  };

  const isAlreadyAdded = (host) =>
    servers.some((s) => s.host === host.host && s.user === host.user && s.port === host.port);

  const importHost = async (host) => {
    setAddingAlias(host.alias);
    try {
      const res = await axios.post(`${apiUrl}/ssh-servers`, {
        name: host.alias,
        host: host.host,
        user: host.user,
        port: host.port,
        ssh_key_path: host.identityFile || '~/.ssh/id_rsa',
      }, { headers: getAuthHeaders() });
      setServers((prev) => [...prev, res.data.server]);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to import server');
    } finally {
      setAddingAlias(null);
    }
  };

  // ── CRUD ─────────────────────────────────────────────────────────────────
  const handleEdit = (server) => {
    setForm({
      name: server.name,
      host: server.host,
      user: server.user,
      port: String(server.port || 22),
      ssh_key_path: server.ssh_key_path || '~/.ssh/id_rsa',
    });
    setEditingId(server.id);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this server?')) return;
    try {
      await axios.delete(`${apiUrl}/ssh-servers/${id}`, { headers: getAuthHeaders() });
      setServers((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete server');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = { ...form, port: parseInt(form.port) || 22 };
      if (editingId) {
        const res = await axios.put(`${apiUrl}/ssh-servers/${editingId}`, payload, { headers: getAuthHeaders() });
        setServers((prev) => prev.map((s) => s.id === editingId ? res.data.server : s));
      } else {
        const res = await axios.post(`${apiUrl}/ssh-servers`, payload, { headers: getAuthHeaders() });
        setServers((prev) => [...prev, res.data.server]);
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      setShowForm(false);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save server');
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

  // ── Test connection ───────────────────────────────────────────────────────
  const testConnection = async (id) => {
    setTestResults((prev) => ({ ...prev, [id]: { status: 'loading' } }));
    try {
      const res = await axios.post(`${apiUrl}/ssh-servers/${id}/test`, {}, { headers: getAuthHeaders(), timeout: 20000 });
      setTestResults((prev) => ({
        ...prev,
        [id]: { status: res.data.success ? 'ok' : 'fail', message: res.data.message },
      }));
      // Auto-clear after 8s
      setTimeout(() => setTestResults((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      }), 8000);
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { status: 'fail', message: err.response?.data?.error || 'Request failed' },
      }));
    }
  };

  // ── Authorize key ─────────────────────────────────────────────────────────
  const toggleAuthorize = (id) => {
    setAuthorizeState((prev) => ({
      ...prev,
      [id]: prev[id]?.open
        ? { open: false, password: '', loading: false, result: null }
        : { open: true, password: '', loading: false, result: null },
    }));
  };

  const authorizeKey = async (id) => {
    const state = authorizeState[id];
    if (!state?.password) return;
    setAuthorizeState((prev) => ({ ...prev, [id]: { ...prev[id], loading: true, result: null } }));
    try {
      const res = await axios.post(
        `${apiUrl}/ssh-servers/${id}/authorize-key`,
        { password: state.password },
        { headers: getAuthHeaders(), timeout: 30000 }
      );
      if (res.data.success) {
        setAuthorizeState((prev) => ({
          ...prev,
          [id]: { open: false, password: '', loading: false, result: { ok: true, msg: res.data.message } },
        }));
        setTimeout(() => setAuthorizeState((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        }), 5000);
      } else {
        setAuthorizeState((prev) => ({
          ...prev,
          [id]: { ...prev[id], loading: false, result: { ok: false, msg: res.data.message } },
        }));
      }
    } catch (err) {
      const data = err.response?.data;
      const msg = data?.hint ? `${data.error} — ${data.hint}` : (data?.error || 'Request failed');
      setAuthorizeState((prev) => ({
        ...prev,
        [id]: { ...prev[id], loading: false, result: { ok: false, msg } },
      }));
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="admin-panel-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="admin-panel">
        <div className="admin-panel-header">
          <h3>SSH Servers</h3>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="admin-panel-body">
          {error && <p className="admin-error">{error}</p>}

          {/* ── Section 1: Public key ──────────────────────────────────── */}
          <div className="ssh-auth-notice">
            <p className="ssh-auth-notice-title">How SSH authorization works</p>
            <p className="ssh-auth-notice-body">
              rsync runs <strong>from this backend server</strong>. Each remote server must trust this server's SSH public key.
            </p>
            {publicKey ? (
              <>
                <div className="ssh-pubkey-display">
                  <code className="ssh-pubkey-text">{publicKey}</code>
                  <button className="ssh-copy-btn" onClick={copyPublicKey}>
                    {copied ? '✓' : 'Copy'}
                  </button>
                </div>
                <p className="ssh-auth-notice-body" style={{ marginTop: 6 }}>
                  Or run on this server:&nbsp;
                  <code className="ssh-inline-cmd">
                    ssh-copy-id -i ~/.ssh/id_rsa.pub user@remotehost
                  </code>
                  &nbsp;— then use <strong>Authorize Key</strong> below to do it from the UI.
                </p>
              </>
            ) : pubKeyError ? (
              <p className="ssh-pubkey-missing">
                {pubKeyError}. Generate a key pair: <code>ssh-keygen -t ed25519</code>
              </p>
            ) : (
              <p className="ssh-auth-notice-body">Loading key…</p>
            )}
          </div>

          {/* ── Section 2: Import from SSH config file ────────────────── */}
          <div className="ssh-import-section">
            <div className="ssh-import-toggle-row">
              <button className="ssh-import-toggle" onClick={toggleImport}>
                {showImport ? '▾' : '▸'} Import from SSH config file
              </button>
              {showImport && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="text/plain,*"
                    style={{ display: 'none' }}
                    onChange={handleConfigFileChange}
                  />
                  <button
                    className="ssh-btn-edit"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Select file…
                  </button>
                </>
              )}
            </div>
            {showImport && (
              <div className="ssh-import-body">
                {!configHosts ? (
                  <p className="admin-empty">Select your <code>~/.ssh/config</code> file to import hosts.</p>
                ) : configHosts.length === 0 ? (
                  <p className="admin-empty">No hosts found in the selected file.</p>
                ) : (
                  configHosts.map((h) => {
                    const already = isAlreadyAdded(h);
                    return (
                      <div key={h.alias} className="ssh-import-host-item">
                        <div className="ssh-import-host-info">
                          <span className="ssh-import-alias">{h.alias}</span>
                          <span className="ssh-import-detail">{h.user}@{h.host}:{h.port}</span>
                          <span className="ssh-import-key">{h.identityFile}</span>
                        </div>
                        {already ? (
                          <span className="ssh-import-added">Already added</span>
                        ) : (
                          <button
                            className="ssh-btn-edit"
                            onClick={() => importHost(h)}
                            disabled={addingAlias === h.alias}
                          >
                            {addingAlias === h.alias ? '…' : 'Add'}
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* ── Section 3: Configured servers ─────────────────────────── */}
          {loadingServers ? (
            <p className="admin-loading">Loading servers…</p>
          ) : (
            <>
              {servers.length === 0 && !showForm && (
                <p className="admin-empty">No SSH servers configured yet.</p>
              )}

              {servers.length > 0 && (
                <div className="ssh-server-list">
                  {servers.map((s) => {
                    const test = testResults[s.id];
                    const auth = authorizeState[s.id];
                    return (
                      <div key={s.id} className="ssh-server-item-wrap">
                        <div className="ssh-server-item">
                          <div className="ssh-server-info">
                            <span className="ssh-server-name">{s.name}</span>
                            <span className="ssh-server-details">{s.user}@{s.host}:{s.port}</span>
                            <span className="ssh-server-key" title={s.ssh_key_path}>{s.ssh_key_path}</span>
                          </div>
                          <div className="ssh-server-actions">
                            <button className="ssh-btn-edit" onClick={() => handleEdit(s)}>Edit</button>
                            <button className="ssh-btn-delete" onClick={() => handleDelete(s.id)}>Delete</button>
                            <button
                              className="ssh-btn-test"
                              onClick={() => testConnection(s.id)}
                              disabled={test?.status === 'loading'}
                            >
                              {test?.status === 'loading' ? '…' : 'Test'}
                            </button>
                            <button
                              className="ssh-btn-authorize"
                              onClick={() => toggleAuthorize(s.id)}
                            >
                              {auth?.open ? 'Cancel' : 'Auth Key'}
                            </button>
                          </div>
                        </div>

                        {/* Test result */}
                        {test && test.status !== 'loading' && (
                          <p className={test.status === 'ok' ? 'ssh-test-result-ok' : 'ssh-test-result-fail'}>
                            {test.status === 'ok' ? '✓' : '✗'} {test.message}
                          </p>
                        )}

                        {/* Authorize key form */}
                        {auth?.open && (
                          <div className="ssh-authorize-form">
                            <p className="ssh-authorize-hint">
                              Enter the remote user's password to push this server's public key to <strong>{s.host}</strong>.
                              Requires <code>sshpass</code> on the backend server.
                            </p>
                            <div className="ssh-authorize-row">
                              <input
                                type="password"
                                placeholder="Remote user password"
                                value={auth.password}
                                onChange={(e) => setAuthorizeState((prev) => ({
                                  ...prev, [s.id]: { ...prev[s.id], password: e.target.value },
                                }))}
                                onKeyDown={(e) => e.key === 'Enter' && authorizeKey(s.id)}
                                disabled={auth.loading}
                                autoFocus
                              />
                              <button
                                className="ssh-btn-save"
                                onClick={() => authorizeKey(s.id)}
                                disabled={auth.loading || !auth.password}
                              >
                                {auth.loading ? 'Pushing…' : 'Push Key'}
                              </button>
                            </div>
                            {auth.result && (
                              <p className={auth.result.ok ? 'ssh-test-result-ok' : 'ssh-test-result-fail'}>
                                {auth.result.ok ? '✓' : '✗'} {auth.result.msg}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Authorize success flash (when form is closed) */}
                        {auth && !auth.open && auth.result?.ok && (
                          <p className="ssh-test-result-ok">✓ {auth.result.msg}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── Section 4: Add server form ─────────────────────────── */}
              {showForm ? (
                <form className="ssh-server-form" onSubmit={handleSubmit}>
                  <h4>{editingId ? 'Edit Server' : 'Add Server'}</h4>
                  <div className="ssh-form-row">
                    <label>Name</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Lab Server"
                      required
                    />
                  </div>
                  <div className="ssh-form-row">
                    <label>Host</label>
                    <input
                      type="text"
                      value={form.host}
                      onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                      placeholder="e.g. 192.168.1.100 or server.example.com"
                      required
                    />
                  </div>
                  <div className="ssh-form-row">
                    <label>User</label>
                    <input
                      type="text"
                      value={form.user}
                      onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
                      placeholder="e.g. ubuntu"
                      required
                    />
                  </div>
                  <div className="ssh-form-row">
                    <label>Port</label>
                    <input
                      type="number"
                      value={form.port}
                      onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                      placeholder="22"
                      min="1"
                      max="65535"
                    />
                  </div>
                  <div className="ssh-form-row">
                    <label>SSH Key Path</label>
                    <input
                      type="text"
                      value={form.ssh_key_path}
                      onChange={(e) => setForm((f) => ({ ...f, ssh_key_path: e.target.value }))}
                      placeholder="~/.ssh/id_rsa"
                    />
                    <p className="ssh-form-hint">Path on the backend server's filesystem</p>
                  </div>
                  <div className="ssh-form-actions">
                    <button type="button" className="ssh-btn-cancel" onClick={handleCancelForm}>Cancel</button>
                    <button type="submit" className="ssh-btn-save" disabled={saving}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </form>
              ) : (
                <button className="ssh-btn-add" onClick={() => setShowForm(true)}>
                  + Add Server
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default SshServersAdmin;
