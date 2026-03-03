import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

function QuickBashModal({ apiUrl, headers, projectId, serverId, onClose }) {
  const [cmd, setCmd] = useState('');
  const [runId, setRunId] = useState(null);
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | running | done | error
  const [errorMsg, setErrorMsg] = useState('');
  const logRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // SSE subscription when running
  useEffect(() => {
    if (!runId || status !== 'running') return;
    const url = `${apiUrl}/researchops/runs/${encodeURIComponent(runId)}/events`;
    const es = new EventSource(url);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.eventType === 'LOG_LINE' && data.message) {
          setLogs((prev) => [...prev.slice(-299), data.message]);
        }
        if (['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(data.status)) {
          const isSuccess = data.status === 'SUCCEEDED';
          setStatus(isSuccess ? 'done' : 'error');
          setErrorMsg(isSuccess ? '' : `Run ${data.status}`);
          es.close();
        }
      } catch (_) {}
    };
    es.onerror = () => { es.close(); };
    return () => es.close();
  }, [runId, status, apiUrl]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!cmd.trim()) return;
    setStatus('running');
    setLogs([]);
    setErrorMsg('');
    try {
      const res = await axios.post(
        `${apiUrl}/researchops/runs/enqueue-v2`,
        {
          projectId,
          serverId: serverId || 'local-default',
          runType: 'QUICK_BASH',
          workflow: [{ id: 'bash_step', type: 'bash.run', inputs: { cmd: cmd.trim() } }],
          metadata: { prompt: cmd.trim() },
        },
        { headers }
      );
      const id = res.data?.data?.run?.id || res.data?.run?.id;
      if (!id) throw new Error('No run ID returned');
      setRunId(id);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.response?.data?.error?.message || err.message || 'Failed to enqueue');
    }
  };

  const handleReset = () => {
    setStatus('idle');
    setLogs([]);
    setRunId(null);
    setErrorMsg('');
  };

  return (
    <div className="vibe-modal-backdrop" onClick={onClose}>
      <div className="vibe-modal vibe-quick-bash-modal" onClick={(e) => e.stopPropagation()}>
        <div className="vibe-modal-head">
          <h3 className="vibe-modal-title">Quick Bash</h3>
          <button type="button" className="vibe-modal-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        {status === 'idle' && (
          <form onSubmit={handleSubmit} className="vibe-quick-bash-form">
            <input
              type="text"
              className="vibe-input vibe-quick-bash-input"
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              placeholder="e.g. python3 scripts/run_baseline.py"
              autoFocus
            />
            <button
              type="submit"
              className="vibe-primary-btn"
              disabled={!cmd.trim()}
            >
              Run
            </button>
          </form>
        )}

        {status !== 'idle' && (
          <div className="vibe-quick-bash-output">
            <pre ref={logRef} className="vibe-live-log-pre vibe-quick-bash-log">
              {logs.join('') || 'Waiting for output\u2026'}
            </pre>
            {status === 'running' && (
              <p className="vibe-quick-bash-status">Running\u2026</p>
            )}
            {status === 'done' && (
              <p className="vibe-quick-bash-status is-ok">Completed successfully.</p>
            )}
            {status === 'error' && (
              <p className="vibe-quick-bash-status is-error">{errorMsg}</p>
            )}
            <div className="vibe-quick-bash-actions">
              {(status === 'done' || status === 'error') && (
                <button type="button" className="vibe-secondary-btn" onClick={handleReset}>
                  New Command
                </button>
              )}
              <button type="button" className="vibe-secondary-btn" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default QuickBashModal;
