import { useState, useEffect } from 'react';
import axios from 'axios';

function SendModal({ apiUrl, getAuthHeaders, selectedDocIds, sourceType, includeCode, useMathpix, onClose, onDone }) {
  const [servers, setServers] = useState([]);
  const [loadingServers, setLoadingServers] = useState(true);
  const [selectedServerId, setSelectedServerId] = useState('');
  const [remotePath, setRemotePath] = useState('');
  const [createSymlink, setCreateSymlink] = useState(false);
  const [symlinkName, setSymlinkName] = useState('latest.zip');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // { success, message }
  const [error, setError] = useState(null);

  useEffect(() => {
    axios.get(`${apiUrl}/ssh-servers`, { headers: getAuthHeaders() })
      .then((res) => {
        const list = res.data.servers || [];
        setServers(list);
        if (list.length > 0) setSelectedServerId(String(list[0].id));
      })
      .catch(() => setError('Failed to load SSH servers'))
      .finally(() => setLoadingServers(false));
  }, []);

  const handleSend = async () => {
    if (!selectedServerId) { setError('Please select a server'); return; }
    if (!remotePath.trim()) { setError('Please enter a remote directory path'); return; }
    setSending(true);
    setError(null);
    try {
      const res = await axios.post(
        `${apiUrl}/documents/research-pack/rsync`,
        {
          documentIds: Array.from(selectedDocIds),
          sourceType,
          includeCode,
          useMathpix,
          serverId: parseInt(selectedServerId),
          remotePath: remotePath.trim(),
          symlinkName: createSymlink && symlinkName.trim() ? symlinkName.trim() : undefined,
        },
        { headers: getAuthHeaders(), timeout: 600000 }
      );
      setResult({ success: true, message: res.data.message });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send files');
    } finally {
      setSending(false);
    }
  };

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget && !sending) onClose();
  };

  return (
    <div className="send-modal-overlay" onClick={handleOverlayClick}>
      <div className="send-modal">
        <div className="send-modal-header">
          <h3>Send to Remote Server</h3>
          {!sending && <button className="close-btn" onClick={onClose}>×</button>}
        </div>

        <div className="send-modal-body">
          {result ? (
            <div className="send-result-success">
              <div className="send-result-icon">✓</div>
              <p>{result.message}</p>
              <button className="ssh-btn-save" onClick={() => { onDone(); onClose(); }}>
                Done
              </button>
            </div>
          ) : (
            <>
              <p className="send-modal-info">
                Sending <strong>{selectedDocIds.size}</strong> paper{selectedDocIds.size !== 1 ? 's' : ''} as a ZIP via rsync/SSH.
              </p>

              {error && <p className="admin-error">{error}</p>}

              {loadingServers ? (
                <p className="admin-loading">Loading servers...</p>
              ) : servers.length === 0 ? (
                <div className="send-no-servers">
                  <p>No SSH servers configured.</p>
                  <p>Add one via the <strong>⚙ Settings</strong> button in the header.</p>
                </div>
              ) : (
                <>
                  <div className="ssh-form-row">
                    <label>Server</label>
                    <select
                      value={selectedServerId}
                      onChange={(e) => setSelectedServerId(e.target.value)}
                      disabled={sending}
                    >
                      {servers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.user}@{s.host}:{s.port})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="ssh-form-row">
                    <label>Remote Directory</label>
                    <input
                      type="text"
                      value={remotePath}
                      onChange={(e) => setRemotePath(e.target.value)}
                      placeholder="/home/user/papers"
                      disabled={sending}
                    />
                    <p className="ssh-form-hint">Absolute path on the remote server</p>
                  </div>

                  <div className="ssh-form-row">
                    <label className="send-symlink-toggle">
                      <input
                        type="checkbox"
                        checked={createSymlink}
                        onChange={(e) => setCreateSymlink(e.target.checked)}
                        disabled={sending}
                      />
                      Create symlink after send
                    </label>
                    {createSymlink && (
                      <input
                        type="text"
                        value={symlinkName}
                        onChange={(e) => setSymlinkName(e.target.value)}
                        placeholder="e.g. latest.zip"
                        disabled={sending}
                        style={{ marginTop: 6 }}
                      />
                    )}
                    {createSymlink && (
                      <p className="ssh-form-hint">
                        Creates <code>{remotePath.trim() || '/path'}/{symlinkName || 'latest.zip'}</code> → the sent ZIP
                      </p>
                    )}
                  </div>

                  <div className="send-modal-actions">
                    <button className="ssh-btn-cancel" onClick={onClose} disabled={sending}>
                      Cancel
                    </button>
                    <button
                      className="ssh-btn-save"
                      onClick={handleSend}
                      disabled={sending || !selectedServerId || !remotePath.trim()}
                    >
                      {sending ? 'Sending...' : 'Send'}
                    </button>
                  </div>

                  {sending && (
                    <p className="send-modal-progress">
                      Building pack and transferring via rsync — this may take a minute...
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default SendModal;
