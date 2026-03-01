import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

const EMPTY_FORM = {
  name: '',
  host: '',
  user: '',
  port: '22',
  proxy_jump: '',
  shared_fs_enabled: false,
};

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
  const [formSharedFsPeers, setFormSharedFsPeers] = useState([]);
  const [formSharedFsPeerCandidate, setFormSharedFsPeerCandidate] = useState('');

  // ── Public key section ───────────────────────────────────────────────────
  const [publicKey, setPublicKey] = useState(null);  // string or null
  const [pubKeyError, setPubKeyError] = useState(null);
  const [copied, setCopied] = useState(false);

  // ── SSH config import ────────────────────────────────────────────────────
  const [showImport, setShowImport] = useState(false);
  const [importPath, setImportPath] = useState('~/.ssh/config');
  const [loadingConfigHosts, setLoadingConfigHosts] = useState(false);
  const [configHosts, setConfigHosts] = useState(null); // null = not loaded yet
  const [loadedConfigLabel, setLoadedConfigLabel] = useState('');
  const [addingAlias, setAddingAlias] = useState(null); // alias being added
  const [importUsers, setImportUsers] = useState({});
  const [importProxyJumps, setImportProxyJumps] = useState({});

  // ── Per-server test / authorize state ───────────────────────────────────
  // testResults: { [id]: { status: 'ok'|'fail'|'loading', message } }
  const [testResults, setTestResults] = useState({});
  // sharedFsResults: { [id]: { status: 'ok'|'fail'|'loading', message } }
  const [sharedFsResults, setSharedFsResults] = useState({});
  // sharedFsPeerByServer: { [id]: peerServerId }
  const [sharedFsPeerByServer, setSharedFsPeerByServer] = useState({});
  // authorizeState: { [id]: { open: bool, password: string, loading: bool, result: {ok,msg}|null } }
  const [authorizeState, setAuthorizeState] = useState({});

  const copyTimers = useRef({});
  const configFileInputRef = useRef(null);
  const panelBodyRef = useRef(null);
  const formRef = useRef(null);
  const hostKey = (host) => `${host.alias}|${host.host}|${host.port}|${host.identityFile || ''}`;
  const resolvedImportUser = (host) => String(importUsers[hostKey(host)] ?? host.user ?? '').trim();
  const resolvedImportProxyJump = (host) =>
    String(importProxyJumps[hostKey(host)] ?? host.proxyJump ?? '').trim();
  const normalize = (value) => String(value ?? '').trim();
  const parsePeerIds = (value) => {
    if (Array.isArray(value)) {
      return Array.from(new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean)));
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) return [];
        return Array.from(new Set(parsed.map((item) => String(item ?? '').trim()).filter(Boolean)));
      } catch {
        return [];
      }
    }
    return [];
  };
  const isSharedFsEnabled = (server) => Number(server?.shared_fs_enabled) === 1 || server?.shared_fs_enabled === true;
  const isSharedFsVerified = (server) => Number(server?.shared_fs_verified) === 1 || server?.shared_fs_verified === true;
  const sharedFsPeerIds = (server) => parsePeerIds(server?.shared_fs_peers);
  const sharedFsVerifiedPeerIds = (server) => parsePeerIds(server?.shared_fs_verified_peers);
  const formatCheckedAt = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  };
  const getServerById = (id) => servers.find((server) => String(server.id) === String(id));
  const getSharedFsPeerCandidates = (server) => {
    const peerIds = sharedFsPeerIds(server);
    if (!peerIds.length) return [];
    return peerIds
      .map((peerId) => getServerById(peerId))
      .filter(Boolean);
  };
  const formPeerOptions = servers.filter((candidate) => {
    if (editingId && String(candidate.id) === String(editingId)) return false;
    if (!form.shared_fs_enabled) return false;
    return true;
  });
  const formPeerOptionItems = formPeerOptions.filter(
    (candidate) => !formSharedFsPeers.includes(String(candidate.id))
  );

  // ── On mount ─────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchServers();
    fetchPublicKey();
  }, []);

  useEffect(() => {
    if (!showForm || !editingId) return;
    const raf = requestAnimationFrame(() => {
      if (panelBodyRef.current) {
        panelBodyRef.current.scrollTo({
          top: panelBodyRef.current.scrollHeight,
          behavior: 'smooth',
        });
      }
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
    return () => cancelAnimationFrame(raf);
  }, [showForm, editingId]);

  const fetchServers = async () => {
    try {
      setLoadingServers(true);
      const res = await axios.get(`${apiUrl}/ssh-servers`, { headers: getAuthHeaders() });
      const nextServers = res.data.servers || [];
      setServers(nextServers);
      setSharedFsPeerByServer((prev) => {
        const next = { ...prev };
        nextServers.forEach((server) => {
          const sid = String(server.id);
          const current = String(next[sid] || '').trim();
          const configuredPeerIds = parsePeerIds(server.shared_fs_peers);
          const peers = configuredPeerIds
            .map((peerId) => nextServers.find((candidate) => String(candidate.id) === String(peerId)))
            .filter(Boolean);
          if (!peers.length) {
            delete next[sid];
            return;
          }
          if (!current || !peers.some((candidate) => String(candidate.id) === current)) {
            next[sid] = String(peers[0].id);
          }
        });
        return next;
      });
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

  // When importing ~/.ssh/config, auto backfill ProxyJump into existing saved servers.
  const syncExistingServersFromConfig = async (hosts) => {
    if (!Array.isArray(hosts) || hosts.length === 0 || servers.length === 0) return;

    const candidates = hosts
      .map((h) => {
        const host = normalize(h.host);
        const user = normalize(h.user);
        const proxyJump = normalize(h.proxyJump);
        const port = parseInt(h.port, 10) || 22;
        if (!host || !user || !proxyJump) return null;
        const existing = servers.find((s) =>
          normalize(s.host) === host &&
          normalize(s.user) === user &&
          (parseInt(s.port, 10) || 22) === port
        );
        if (!existing) return null;
        if (normalize(existing.proxy_jump)) return null;
        return { existing, proxyJump };
      })
      .filter(Boolean);

    if (candidates.length === 0) return;

    const updates = {};
    await Promise.all(candidates.map(async ({ existing, proxyJump }) => {
      try {
        const payload = {
          name: existing.name,
          host: existing.host,
          user: existing.user,
          port: parseInt(existing.port, 10) || 22,
          proxy_jump: proxyJump,
        };
        const res = await axios.put(
          `${apiUrl}/ssh-servers/${existing.id}`,
          payload,
          { headers: getAuthHeaders() }
        );
        updates[existing.id] = res.data.server;
      } catch (err) {
        console.warn(`[SSH] Failed to auto-sync ProxyJump for ${existing.name}:`, err?.response?.data || err?.message);
      }
    }));

    if (Object.keys(updates).length > 0) {
      setServers((prev) => prev.map((s) => updates[s.id] || s));
    }
  };

  // ── SSH config import ────────────────────────────────────────────────────
  const loadConfigHosts = async (pathOverride) => {
    const normalizedPath = String(pathOverride ?? importPath).trim() || '~/.ssh/config';
    setImportPath(normalizedPath);
    setLoadingConfigHosts(true);
    try {
      const res = await axios.get(`${apiUrl}/ssh-servers/config-hosts`, {
        headers: getAuthHeaders(),
        params: { configPath: normalizedPath },
      });
      const hosts = res.data?.hosts || [];
      const nextUsers = {};
      const nextProxyJumps = {};
      hosts.forEach((h) => {
        nextUsers[hostKey(h)] = h.user || '';
        nextProxyJumps[hostKey(h)] = h.proxyJump || '';
      });
      setImportUsers(nextUsers);
      setImportProxyJumps(nextProxyJumps);
      setConfigHosts(hosts);
      await syncExistingServersFromConfig(hosts);
      setLoadedConfigLabel(res.data?.path || normalizedPath);
      setError(null);
    } catch (err) {
      setConfigHosts([]);
      setLoadedConfigLabel(normalizedPath);
      setError(err.response?.data?.error || 'Failed to load SSH config hosts');
    } finally {
      setLoadingConfigHosts(false);
    }
  };

  const openConfigFilePicker = () => {
    configFileInputRef.current?.click();
  };

  const handleConfigFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoadingConfigHosts(true);
    try {
      const formData = new FormData();
      formData.append('configFile', file);
      const res = await axios.post(
        `${apiUrl}/ssh-servers/config-hosts/upload`,
        formData,
        { headers: getAuthHeaders() }
      );
      const hosts = res.data?.hosts || [];
      const nextUsers = {};
      const nextProxyJumps = {};
      hosts.forEach((h) => {
        nextUsers[hostKey(h)] = h.user || '';
        nextProxyJumps[hostKey(h)] = h.proxyJump || '';
      });
      setImportUsers(nextUsers);
      setImportProxyJumps(nextProxyJumps);
      setConfigHosts(hosts);
      await syncExistingServersFromConfig(hosts);
      setLoadedConfigLabel(res.data?.filename || file.name || 'uploaded file');
      setError(null);
    } catch (err) {
      setConfigHosts([]);
      setLoadedConfigLabel(file.name || 'uploaded file');
      setError(err.response?.data?.error || 'Failed to upload SSH config');
    } finally {
      setLoadingConfigHosts(false);
      if (e.target) e.target.value = '';
    }
  };

  const toggleImport = () => {
    if (showImport) {
      setShowImport(false);
      return;
    }
    setShowImport(true);
  };

  const handleImportPathSubmit = (e) => {
    e.preventDefault();
    loadConfigHosts(importPath);
  };

  const isAlreadyAdded = (host) =>
    servers.some((s) => s.host === host.host && s.user === resolvedImportUser(host) && s.port === host.port);

  const importHost = async (host) => {
    setAddingAlias(host.alias);
    const user = resolvedImportUser(host);
    if (!user) {
      setError(`Username is required for "${host.alias}"`);
      setAddingAlias(null);
      return;
    }
    try {
      const res = await axios.post(`${apiUrl}/ssh-servers`, {
        name: host.alias,
        host: host.host,
        user,
        port: host.port,
        proxy_jump: resolvedImportProxyJump(host),
      }, { headers: getAuthHeaders() });
      setServers((prev) => [...prev, res.data.server]);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to import server');
    } finally {
      setAddingAlias(null);
    }
  };

  // ── CRUD ─────────────────────────────────────────────────────────────────
  const handleEdit = (server) => {
    const defaultPeers = sharedFsPeerIds(server)
      .filter((peerId) => String(peerId) !== String(server.id));
    setForm({
      name: server.name,
      host: server.host,
      user: server.user,
      port: String(server.port || 22),
      proxy_jump: server.proxy_jump || '',
      shared_fs_enabled: isSharedFsEnabled(server),
    });
    setEditingId(server.id);
    setFormSharedFsPeers(defaultPeers);
    setFormSharedFsPeerCandidate('');
    setShowForm(true);
    requestAnimationFrame(() => {
      if (panelBodyRef.current) {
        panelBodyRef.current.scrollTo({
          top: panelBodyRef.current.scrollHeight,
          behavior: 'smooth',
        });
      }
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });
  };

  const openCreateForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormSharedFsPeers([]);
    setFormSharedFsPeerCandidate('');
    setShowForm(true);
    setError(null);
  };

  const buildServerPayload = (server) => {
    const peers = sharedFsPeerIds(server);
    const sharedFsEnabled = isSharedFsEnabled(server) && peers.length > 0;
    return {
      name: server.name,
      host: server.host,
      user: server.user,
      port: parseInt(server.port, 10) || 22,
      proxy_jump: server.proxy_jump || '',
      shared_fs_enabled: sharedFsEnabled,
      shared_fs_peers: sharedFsEnabled ? peers : [],
    };
  };

  const addFormSharedFsPeer = () => {
    const selected = String(formSharedFsPeerCandidate || '').trim();
    if (!selected) return;
    if (editingId && selected === String(editingId)) return;
    if (!getServerById(selected)) return;
    setFormSharedFsPeers((prev) => (prev.includes(selected) ? prev : [...prev, selected]));
    setFormSharedFsPeerCandidate('');
  };

  const removeFormSharedFsPeer = (peerId) => {
    const target = String(peerId || '').trim();
    if (!target) return;
    setFormSharedFsPeers((prev) => prev.filter((id) => String(id) !== target));
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
    const selectedPeerIds = Array.from(
      new Set(
        formSharedFsPeers
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      )
    );
    let persistedServer = null;
    const isCreate = !editingId;
    const previousServer = editingId
      ? servers.find((server) => String(server.id) === String(editingId)) || null
      : null;
    try {
      const payload = {
        ...form,
        port: parseInt(form.port, 10) || 22,
        shared_fs_enabled: Boolean(form.shared_fs_enabled),
        shared_fs_peers: selectedPeerIds,
      };
      if (payload.shared_fs_enabled && selectedPeerIds.length === 0) {
        throw new Error('Select at least one peer server for shared filesystem verification');
      }
      if (!payload.shared_fs_enabled) {
        payload.shared_fs_peers = [];
      }
      if (editingId) {
        const res = await axios.put(`${apiUrl}/ssh-servers/${editingId}`, payload, { headers: getAuthHeaders() });
        persistedServer = res.data.server;
      } else {
        const res = await axios.post(`${apiUrl}/ssh-servers`, payload, { headers: getAuthHeaders() });
        persistedServer = res.data.server;
      }

      if (payload.shared_fs_enabled && selectedPeerIds.length > 0) {
        const sourceId = String(persistedServer?.id || '').trim();
        for (const peerServerId of selectedPeerIds) {
          if (!sourceId || peerServerId === sourceId) continue;
          const peer = getServerById(peerServerId);
          const verifyRes = await axios.post(
            `${apiUrl}/ssh-servers/${sourceId}/shared-fs/check`,
            { peerServerId },
            { headers: getAuthHeaders(), timeout: 60000 }
          );
          const result = verifyRes.data || {};
          if (!result.success) {
            throw new Error(`Shared FS verification failed with ${peer?.name || `server ${peerServerId}`}: ${result.message || 'unknown error'}`);
          }
        }
      }

      await fetchServers();
      setForm(EMPTY_FORM);
      setEditingId(null);
      setFormSharedFsPeers([]);
      setFormSharedFsPeerCandidate('');
      setShowForm(false);
    } catch (err) {
      let message = err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to save server';
      if (persistedServer?.id && isCreate) {
        try {
          await axios.delete(`${apiUrl}/ssh-servers/${persistedServer.id}`, { headers: getAuthHeaders() });
          message = `${message}. Save aborted and new server was rolled back.`;
        } catch (rollbackErr) {
          message = `${message}. Save failed, and automatic rollback also failed.`;
        }
      } else if (persistedServer?.id && previousServer) {
        try {
          await axios.put(
            `${apiUrl}/ssh-servers/${persistedServer.id}`,
            buildServerPayload(previousServer),
            { headers: getAuthHeaders() }
          );
          message = `${message}. Previous server configuration was restored.`;
        } catch (rollbackErr) {
          message = `${message}. Save failed, and restoring the previous configuration also failed.`;
        }
      }
      await fetchServers();
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormSharedFsPeers([]);
    setFormSharedFsPeerCandidate('');
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

  const verifySharedFs = async (server, peerServerId) => {
    const id = server.id;
    if (!isSharedFsEnabled(server)) {
      setError('Enable shared filesystem on this server before verification');
      return;
    }
    const selectedPeerId = String(peerServerId || '').trim();
    if (!selectedPeerId) {
      setError('Select a configured peer server before verification');
      return;
    }
    setSharedFsResults((prev) => ({ ...prev, [id]: { status: 'loading' } }));
    try {
      const res = await axios.post(
        `${apiUrl}/ssh-servers/${id}/shared-fs/check`,
        { peerServerId: selectedPeerId },
        { headers: getAuthHeaders(), timeout: 45000 }
      );
      const result = res.data || {};
      if (result.server || result.peerServer) {
        setServers((prev) => prev.map((item) => {
          if (result.server && String(item.id) === String(result.server.id)) return result.server;
          if (result.peerServer && String(item.id) === String(result.peerServer.id)) return result.peerServer;
          return item;
        }));
      } else {
        await fetchServers();
      }
      setSharedFsResults((prev) => ({
        ...prev,
        [id]: {
          status: result.success ? 'ok' : 'fail',
          message: result.message || (result.success ? 'Shared filesystem verified' : 'Verification failed'),
        },
      }));
      if (!result.success) {
        setError(result.message || 'Shared filesystem check failed');
      } else {
        setError(null);
        if (result.peerServer?.id) {
          setSharedFsResults((prev) => ({
            ...prev,
            [result.peerServer.id]: {
              status: 'ok',
              message: `Verified with ${server.name}`,
            },
          }));
        }
      }
      setTimeout(() => setSharedFsResults((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      }), 10000);
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.message || 'Shared filesystem check request failed';
      setSharedFsResults((prev) => ({
        ...prev,
        [id]: { status: 'fail', message: msg },
      }));
      setError(msg);
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

        <div className="admin-panel-body" ref={panelBodyRef}>
          {error && <p className="admin-error">{error}</p>}

          {/* ── Section 1: Public key ──────────────────────────────────── */}
          <div className="ssh-auth-notice">
            <p className="ssh-auth-notice-title">How SSH authorization works</p>
            <p className="ssh-auth-notice-body">
              rsync runs <strong>from the active backend runtime</strong> (recommended: local WSL executor via FRP). Each remote target must trust that runtime's SSH public key.
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
                {pubKeyError}. Restart the backend to auto-generate the managed keypair.
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
            </div>
            {showImport && (
              <div className="ssh-import-body">
                <div className="ssh-import-upload-row">
                  <input
                    ref={configFileInputRef}
                    type="file"
                    onChange={handleConfigFileSelected}
                    style={{ display: 'none' }}
                  />
                  <button
                    type="button"
                    className="ssh-btn-edit"
                    onClick={openConfigFilePicker}
                    disabled={loadingConfigHosts}
                  >
                    {loadingConfigHosts ? 'Reading…' : 'Upload SSH config file'}
                  </button>
                </div>
                <p className="ssh-import-hint">
                  Use this for client-side SSH files (for example local <code>~/.ssh/config</code>).
                </p>
                <div className="ssh-import-divider">or load from backend path</div>
                <form className="ssh-import-path-row" onSubmit={handleImportPathSubmit}>
                  <input
                    type="text"
                    value={importPath}
                    onChange={(e) => setImportPath(e.target.value)}
                    placeholder="~/.ssh/config"
                  />
                  <button
                    type="submit"
                    className="ssh-btn-edit"
                    disabled={loadingConfigHosts}
                  >
                    {loadingConfigHosts ? 'Loading…' : 'Load Path'}
                  </button>
                </form>
                <p className="ssh-import-hint">
                  Enter path on backend server (hidden files like <code>~/.ssh/config</code> supported).
                </p>

                {loadingConfigHosts ? (
                  <p className="admin-empty">Reading <code>{loadedConfigLabel || importPath}</code>…</p>
                ) : !configHosts ? (
                  <p className="admin-empty">Upload a file or enter a path and click <strong>Load Path</strong>.</p>
                ) : configHosts.length === 0 ? (
                  <p className="admin-empty">No hosts found in <code>{loadedConfigLabel || importPath}</code>.</p>
                ) : (
                  configHosts.map((h) => {
                    const importUser = resolvedImportUser(h);
                    const already = isAlreadyAdded(h);
                    return (
                      <div key={hostKey(h)} className="ssh-import-host-item">
                        <div className="ssh-import-host-info">
                          <span className="ssh-import-alias">{h.alias}</span>
                          <span className="ssh-import-detail">{importUser || '<username>'}@{h.host}:{h.port}</span>
                          <span className="ssh-import-key">{h.identityFile}</span>
                          <div className="ssh-import-user-row">
                            <label>SSH user</label>
                            <input
                              type="text"
                              value={importUser}
                              onChange={(e) => {
                                const value = e.target.value;
                                setImportUsers((prev) => ({ ...prev, [hostKey(h)]: value }));
                              }}
                              placeholder="e.g. root / ubuntu"
                            />
                          </div>
                          <div className="ssh-import-user-row">
                            <label>ProxyJump</label>
                            <input
                              type="text"
                              value={resolvedImportProxyJump(h)}
                              onChange={(e) => {
                                const value = e.target.value;
                                setImportProxyJumps((prev) => ({ ...prev, [hostKey(h)]: value }));
                              }}
                              placeholder="optional, e.g. user@jump-host"
                            />
                          </div>
                        </div>
                        {already ? (
                          <span className="ssh-import-added">Already added</span>
                        ) : (
                          <button
                            className="ssh-btn-edit"
                            onClick={() => importHost(h)}
                            disabled={addingAlias === h.alias || !importUser}
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
                    const sharedFs = sharedFsResults[s.id];
                    const auth = authorizeState[s.id];
                    const sharedEnabled = isSharedFsEnabled(s);
                    const sharedVerified = isSharedFsVerified(s);
                    const peerCandidates = getSharedFsPeerCandidates(s);
                    const configuredPeerIds = sharedFsPeerIds(s);
                    const verifiedPeerIdSet = new Set(sharedFsVerifiedPeerIds(s));
                    const selectedPeerServerId = String(
                      sharedFsPeerByServer[s.id]
                      || peerCandidates[0]?.id
                      || ''
                    ).trim();
                    return (
                      <div key={s.id} className="ssh-server-item-wrap">
                        <div className="ssh-server-item">
                          <div className="ssh-server-info">
                            <span className="ssh-server-name" title={s.name}>{s.name}</span>
                            <span className="ssh-server-details" title={`${s.user}@${s.host}:${s.port}`}>{s.user}@{s.host}:{s.port}</span>
                            {s.proxy_jump ? (
                              <span className="ssh-server-key">via {s.proxy_jump}</span>
                            ) : null}
                            <span className="ssh-server-key">managed key</span>
                            {sharedEnabled ? (
                              <>
                                <span className={sharedVerified ? 'ssh-sharedfs-status-ok' : 'ssh-sharedfs-status-warn'}>
                                  Shared FS {sharedVerified ? 'verified' : 'not verified'}
                                </span>
                                <span className="ssh-server-key">
                                  peers configured: {configuredPeerIds.length}
                                </span>
                                <span className="ssh-server-key">
                                  peers verified: {verifiedPeerIdSet.size}
                                </span>
                                {s.shared_fs_last_checked_at ? (
                                  <span className="ssh-server-key">
                                    checked {formatCheckedAt(s.shared_fs_last_checked_at)}
                                  </span>
                                ) : null}
                                {s.shared_fs_last_status ? (
                                  <span className="ssh-server-key">{s.shared_fs_last_status}</span>
                                ) : null}
                              </>
                            ) : (
                              <span className="ssh-sharedfs-status-muted">Shared FS disabled</span>
                            )}
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
                              className="ssh-btn-sharedfs"
                              onClick={() => verifySharedFs(s, selectedPeerServerId)}
                              disabled={!sharedEnabled || !selectedPeerServerId || sharedFs?.status === 'loading'}
                              title={sharedEnabled
                                ? (selectedPeerServerId ? 'Verify shared filesystem with selected peer server' : 'Pick a configured peer server')
                                : 'Enable shared filesystem first'}
                            >
                              {sharedFs?.status === 'loading' ? 'Checking…' : 'Verify FS'}
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
                        {sharedEnabled && (
                          <div className="ssh-sharedfs-peer-row">
                            <label>Peer server</label>
                            <select
                              value={selectedPeerServerId}
                              onChange={(e) => setSharedFsPeerByServer((prev) => ({
                                ...prev,
                                [s.id]: e.target.value,
                              }))}
                            >
                              {peerCandidates.length === 0 ? (
                                <option value="">No configured peers</option>
                              ) : (
                                peerCandidates.map((peer) => (
                                  <option key={`peer-${s.id}-${peer.id}`} value={String(peer.id)}>
                                    {peer.name} ({peer.user}@{peer.host})
                                    {verifiedPeerIdSet.has(String(peer.id)) ? ' [verified]' : ' [not verified]'}
                                  </option>
                                ))
                              )}
                            </select>
                          </div>
                        )}
                        {sharedFs && sharedFs.status !== 'loading' && (
                          <p className={sharedFs.status === 'ok' ? 'ssh-test-result-ok' : 'ssh-test-result-fail'}>
                            {sharedFs.status === 'ok' ? '✓' : '✗'} {sharedFs.message}
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
                <form className="ssh-server-form" onSubmit={handleSubmit} ref={formRef}>
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
                    <label>SSH Username</label>
                    <input
                      type="text"
                      value={form.user}
                      onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
                      placeholder="e.g. ubuntu"
                      required
                    />
                    <p className="ssh-form-hint">Login account on target server (for example: root, ubuntu).</p>
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
                    <label>ProxyJump (optional)</label>
                    <input
                      type="text"
                      value={form.proxy_jump}
                      onChange={(e) => setForm((f) => ({ ...f, proxy_jump: e.target.value }))}
                      placeholder="e.g. user@bastion.example.edu"
                    />
                    <p className="ssh-form-hint">Use when target host must be reached via a jump/bastion host.</p>
                  </div>
                  <div className="ssh-form-row">
                    <label>Authorize access</label>
                    <div className="ssh-form-oneliner">
                      <code>{`curl -fsSL ${window.location.origin.replace(/:\d+$/, '')}/api/public-key >> ~/.ssh/authorized_keys`}</code>
                    </div>
                    <p className="ssh-form-hint">Run this command on the target server to grant access. The system manages its own SSH key automatically.</p>
                  </div>
                  <div className="ssh-form-row">
                    <label className="ssh-form-checkbox-label">
                      <input
                        type="checkbox"
                        checked={Boolean(form.shared_fs_enabled)}
                        onChange={(e) => setForm((f) => ({ ...f, shared_fs_enabled: e.target.checked }))}
                      />
                      Enable shared filesystem mapping
                    </label>
                    <p className="ssh-form-hint">
                      Enable this when this server shares a filesystem with other compute servers.
                    </p>
                  </div>
                  {form.shared_fs_enabled && (
                    <>
                      <div className="ssh-form-row">
                        <label>Peer servers to verify on Save</label>
                        <div className="ssh-sharedfs-form-picker">
                          <select
                            value={formSharedFsPeerCandidate}
                            onChange={(e) => setFormSharedFsPeerCandidate(e.target.value)}
                          >
                            <option value="">Select server…</option>
                            {formPeerOptionItems.map((peer) => (
                              <option key={`form-peer-${peer.id}`} value={String(peer.id)}>
                                {peer.name} ({peer.user}@{peer.host})
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="ssh-btn-test"
                            onClick={addFormSharedFsPeer}
                            disabled={!formSharedFsPeerCandidate}
                          >
                            Add
                          </button>
                        </div>
                        {formSharedFsPeers.length > 0 ? (
                          <div className="ssh-sharedfs-form-peer-list">
                            {formSharedFsPeers.map((peerId) => {
                              const peer = getServerById(peerId);
                              return (
                                <span className="ssh-sharedfs-form-peer-tag" key={`selected-peer-${peerId}`}>
                                  {peer ? peer.name : `server-${peerId}`}
                                  <button
                                    type="button"
                                    className="ssh-sharedfs-form-peer-remove"
                                    onClick={() => removeFormSharedFsPeer(peerId)}
                                    title="Remove peer"
                                  >
                                    ×
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="ssh-form-hint">
                            Select one or more peer servers. Save will verify shared filesystem with each peer; if any check fails, the save is rejected.
                          </p>
                        )}
                      </div>
                    </>
                  )}
                  <div className="ssh-form-actions">
                    <button type="button" className="ssh-btn-cancel" onClick={handleCancelForm}>Cancel</button>
                    <button type="submit" className="ssh-btn-save" disabled={saving}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </form>
              ) : (
                <button className="ssh-btn-add" onClick={openCreateForm}>
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
