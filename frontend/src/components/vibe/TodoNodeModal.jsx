'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import axios from 'axios';
import ClarificationChat from './ClarificationChat';

const KIND_OPTIONS = ['experiment', 'analysis', 'knowledge', 'setup', 'milestone', 'patch', 'search'];

function NodeField({ label, value, onChange, multiline = false }) {
  if (multiline) {
    return (
      <div className="tnm-field">
        <label className="tnm-label">{label}</label>
        <textarea
          className="tnm-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      </div>
    );
  }
  return (
    <div className="tnm-field">
      <label className="tnm-label">{label}</label>
      <input className="tnm-input" type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ArrayField({ label, items, onChange }) {
  const addItem = () => onChange([...items, '']);
  const updateItem = (i, val) => {
    const next = [...items];
    next[i] = val;
    onChange(next);
  };
  const removeItem = (i) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div className="tnm-field">
      <label className="tnm-label">{label}</label>
      <div className="tnm-array">
        {items.map((item, i) => (
          <div key={i} className="tnm-array-row">
            <input
              className="tnm-input"
              type="text"
              value={typeof item === 'object' ? (item.cmd || item.condition || '') : item}
              onChange={(e) => {
                if (typeof item === 'object') {
                  const next = [...items];
                  const key = 'cmd' in item ? 'cmd' : 'condition';
                  next[i] = { ...item, [key]: e.target.value };
                  onChange(next);
                } else {
                  updateItem(i, e.target.value);
                }
              }}
            />
            {typeof item === 'object' && (
              <input
                className="tnm-input tnm-input--label"
                type="text"
                placeholder="label"
                value={item.label || ''}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = { ...item, label: e.target.value };
                  onChange(next);
                }}
              />
            )}
            <button type="button" className="tnm-remove-btn" onClick={() => removeItem(i)} title="Remove">×</button>
          </div>
        ))}
        <button type="button" className="tnm-add-btn" onClick={addItem}>+ Add</button>
      </div>
    </div>
  );
}

export default function TodoNodeModal({
  apiUrl,
  headers,
  projectId,
  todo,
  onInsertNode,
  onClose,
}) {
  // Clarification phase state
  const [clarifyMessages, setClarifyMessages] = useState([]);
  const [clarifyQuestion, setClarifyQuestion] = useState('');
  const [clarifyOptions, setClarifyOptions] = useState([]);
  const [clarifyDone, setClarifyDone] = useState(false);
  const [clarifyBusy, setClarifyBusy] = useState(false);
  const [clarifySkipped, setClarifySkipped] = useState(false);

  // Generation phase state
  const [status, setStatus] = useState('idle'); // idle | generating | done | error
  const [error, setError] = useState('');
  const [node, setNode] = useState(null);
  const [messages, setMessages] = useState([]);
  const [refineInput, setRefineInput] = useState('');
  const [inserting, setInserting] = useState(false);
  const refineRef = useRef(null);

  // Fetch next clarification question
  const fetchNextQuestion = useCallback(async (msgs) => {
    if (!projectId || !todo) return;
    setClarifyBusy(true);
    try {
      const res = await axios.post(
        `${apiUrl}/researchops/projects/${projectId}/tree/nodes/from-todo/clarify`,
        { todo, messages: msgs },
        { headers },
      );
      const { done, question, options } = res.data;
      setClarifyDone(!!done);
      setClarifyQuestion(done ? '' : (question || ''));
      setClarifyOptions(done ? [] : (options || []));
    } catch (_) {
      // On error, just mark done so user can proceed
      setClarifyDone(true);
    } finally {
      setClarifyBusy(false);
    }
  }, [apiUrl, headers, projectId, todo]);

  // Kick off clarification on mount
  useEffect(() => {
    fetchNextQuestion([]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClarifySend = useCallback(async (text) => {
    const userMsg = { role: 'user', content: text };
    const nextMsgs = [...clarifyMessages, userMsg];
    setClarifyMessages(nextMsgs);
    await fetchNextQuestion(nextMsgs);
  }, [clarifyMessages, fetchNextQuestion]);

  const handleClarifySkip = useCallback(() => {
    setClarifySkipped(true);
    // Skip directly to generation with no context
    generate([]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClarifyUnskip = useCallback(() => {
    // Return to Q&A (reset generation state)
    setClarifySkipped(false);
    setStatus('idle');
    setNode(null);
    setError('');
  }, []);

  const handleClarifyProceed = useCallback(() => {
    // Proceed to generate with accumulated context
    generate(clarifyMessages);
  }, [clarifyMessages]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = useCallback(async (msgs = []) => {
    if (!projectId || !todo) return;
    setStatus('generating');
    setError('');
    try {
      const res = await axios.post(
        `${apiUrl}/researchops/projects/${projectId}/tree/nodes/from-todo`,
        { todo, messages: msgs },
        { headers },
      );
      const generated = res.data?.node;
      if (!generated) throw new Error('No node returned');
      setNode({
        id: String(generated.id || ''),
        title: String(generated.title || ''),
        kind: String(generated.kind || 'experiment'),
        assumption: Array.isArray(generated.assumption) ? generated.assumption : [],
        target: Array.isArray(generated.target) ? generated.target : [],
        commands: Array.isArray(generated.commands) ? generated.commands : [],
        checks: Array.isArray(generated.checks) ? generated.checks : [],
        tags: Array.isArray(generated.tags) ? generated.tags : [],
        ...(generated.parent ? { parent: generated.parent } : {}),
      });
      setStatus('done');
      return generated;
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Generation failed');
      setStatus('error');
      return null;
    }
  }, [apiUrl, headers, projectId, todo]);

  const handleRefine = useCallback(async () => {
    if (!refineInput.trim() || status === 'generating') return;
    const userMsg = { role: 'user', content: refineInput.trim() };
    const assistantMsg = node ? { role: 'assistant', content: JSON.stringify(node, null, 2) } : null;
    const nextMessages = [
      ...messages,
      ...(assistantMsg ? [assistantMsg] : []),
      userMsg,
    ];
    setMessages(nextMessages);
    setRefineInput('');
    const generated = await generate(nextMessages);
    if (generated) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: JSON.stringify(generated, null, 2) },
      ]);
    }
  }, [generate, messages, node, refineInput, status]);

  const handleInsert = useCallback(async () => {
    if (!node || inserting) return;
    setInserting(true);
    try {
      await onInsertNode(node);
      onClose();
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Insert failed');
    } finally {
      setInserting(false);
    }
  }, [inserting, node, onClose, onInsertNode]);

  const updateNode = (field, value) => setNode((prev) => ({ ...prev, [field]: value }));

  // Whether we're still in clarification phase (before generation started)
  const inClarifyPhase = status === 'idle' || (status === 'generating' && !node && !clarifySkipped);

  return (
    <div className="tnm-overlay" role="dialog" aria-modal="true" aria-labelledby="tnm-title">
      <div className="tnm-modal">
        <div className="tnm-header">
          <div>
            <h3 id="tnm-title" className="tnm-title">Generate Tree Node</h3>
            <p className="tnm-subtitle">
              <strong>{todo?.title}</strong>
              {todo?.hypothesis ? <span> — {todo.hypothesis.slice(0, 100)}{todo.hypothesis.length > 100 ? '…' : ''}</span> : null}
            </p>
          </div>
          <button type="button" className="tnm-close-btn" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="tnm-body">
          {/* Clarification Q&A phase */}
          {inClarifyPhase && (
            <ClarificationChat
              messages={clarifyMessages}
              currentQuestion={clarifyQuestion}
              options={clarifyOptions}
              done={clarifyDone}
              busy={clarifyBusy}
              skipped={clarifySkipped}
              onSend={handleClarifySend}
              onSkip={handleClarifySkip}
              onUnskip={handleClarifyUnskip}
              onProceed={handleClarifyProceed}
              proceedLabel="Generate Node"
            />
          )}

          {status === 'generating' && (
            <div className="tnm-generating">
              <span className="tnm-spinner" />
              Generating node…
            </div>
          )}

          {status === 'error' && (
            <div className="tnm-error">
              <p>{error}</p>
              <button type="button" className="vibe-secondary-btn" onClick={() => generate(messages)}>
                Retry
              </button>
            </div>
          )}

          {(status === 'done' || (status === 'generating' && node)) && node && (
            <div className="tnm-node-editor">
              <div className="tnm-fields-row">
                <NodeField label="ID" value={node.id} onChange={(v) => updateNode('id', v)} />
                <div className="tnm-field">
                  <label className="tnm-label">Kind</label>
                  <select className="tnm-select" value={node.kind} onChange={(e) => updateNode('kind', e.target.value)}>
                    {KIND_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </div>
              </div>

              <NodeField label="Title" value={node.title} onChange={(v) => updateNode('title', v)} />

              <ArrayField label="Assumptions" items={node.assumption} onChange={(v) => updateNode('assumption', v)} />
              <ArrayField label="Success Criteria (target)" items={node.target} onChange={(v) => updateNode('target', v)} />
              <ArrayField label="Commands" items={node.commands} onChange={(v) => updateNode('commands', v)} />
              <ArrayField label="Checks" items={node.checks} onChange={(v) => updateNode('checks', v)} />
              <ArrayField label="Tags" items={node.tags} onChange={(v) => updateNode('tags', v)} />
            </div>
          )}

          {/* Chat refinement */}
          {(status === 'done' || status === 'error') && (
            <div className="tnm-refine">
              <label className="tnm-label">Refine with LLM</label>
              <div className="tnm-refine-row">
                <textarea
                  ref={refineRef}
                  className="tnm-textarea tnm-refine-input"
                  placeholder='e.g. "Add a validation step" or "Use python3 for commands"'
                  value={refineInput}
                  onChange={(e) => setRefineInput(e.target.value)}
                  rows={2}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleRefine();
                  }}
                />
                <button
                  type="button"
                  className="vibe-secondary-btn tnm-refine-btn"
                  onClick={handleRefine}
                  disabled={!refineInput.trim() || status === 'generating'}
                >
                  ↺ Refine
                </button>
              </div>
              {messages.length > 0 && (
                <p className="tnm-turn-count">{Math.ceil(messages.filter((m) => m.role === 'user').length)} refinement{messages.filter((m) => m.role === 'user').length !== 1 ? 's' : ''} applied</p>
              )}
            </div>
          )}
        </div>

        <div className="tnm-footer">
          <button type="button" className="vibe-secondary-btn" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="vibe-launch-btn"
            onClick={handleInsert}
            disabled={!node || inserting || status === 'generating'}
          >
            {inserting ? 'Inserting…' : '+ Insert Node'}
          </button>
        </div>
      </div>
    </div>
  );
}
