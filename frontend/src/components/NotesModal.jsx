import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import MarkdownContent, { parseFrontmatter, cleanNotesContent } from './shared/MarkdownRenderer';
import MarkdownEditor from './MarkdownEditor';

function NotesModal({ document, apiUrl, initialTab = 'paper', onClose, isAuthenticated, getAuthHeaders, onAiEditStatusChange, onViewUserNotes, onDocumentUpdate }) {
  const [notes, setNotes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);

  // AI Edit state
  const [showAiEdit, setShowAiEdit] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiEditStatus, setAiEditStatus] = useState(null); // null | 'submitting' | 'queued' | 'processing'
  const aiPollRef = useRef(null);

  // Generate Notes state
  const [readerModes, setReaderModes] = useState([]);
  const [providers, setProviders] = useState([]);
  const [selectedMode, setSelectedMode] = useState(document.readerMode || 'auto_reader_v2');
  const [selectedProvider, setSelectedProvider] = useState(document.analysisProvider || 'codex-cli');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);
  const generatePollRef = useRef(null);

  const parsedPaperNotes = useMemo(() => {
    if (!notes?.notesContent) return null;
    const parsed = parseFrontmatter(notes.notesContent);
    parsed.content = cleanNotesContent(parsed.content);
    return parsed;
  }, [notes?.notesContent]);

  const parsedCodeNotes = useMemo(() => {
    if (!notes?.codeNotesContent) return null;
    const parsed = parseFrontmatter(notes.codeNotesContent);
    parsed.content = cleanNotesContent(parsed.content);
    return parsed;
  }, [notes?.codeNotesContent]);

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/documents/${document.id}/notes?inline=true`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch notes');
      }

      setNotes(data);
      if (initialTab === 'code' && data.hasCodeNotes) {
        setActiveTab('code');
      } else if (initialTab === 'paper' && data.hasNotes) {
        setActiveTab('paper');
      } else if (data.hasCodeNotes && !data.hasNotes) {
        setActiveTab('code');
      } else if (data.hasNotes) {
        setActiveTab('paper');
      }
    } catch (err) {
      console.error('Error fetching notes:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [document.id, apiUrl, initialTab]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // Fetch reader modes and providers for generate panel
  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const [modesRes, providersRes] = await Promise.all([
          fetch(`${apiUrl}/reader/modes`),
          fetch(`${apiUrl}/reader/providers`),
        ]);
        const modesData = await modesRes.json();
        const providersData = await providersRes.json();
        setReaderModes(modesData.modes || []);
        setProviders(providersData.providers || []);
      } catch (err) {
        console.error('Error fetching reader options:', err);
      }
    };
    fetchOptions();
  }, [apiUrl]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (aiPollRef.current) clearInterval(aiPollRef.current);
      if (generatePollRef.current) clearInterval(generatePollRef.current);
    };
  }, []);

  const handleBackdropClick = (e) => {
    if (e.target.classList.contains('modal-backdrop')) {
      onClose();
    }
  };

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        if (showAiEdit) {
          setShowAiEdit(false);
        } else if (isEditing) {
          setIsEditing(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, isEditing, showAiEdit]);

  const getReaderModeBadge = (mode) => {
    if (mode === 'auto_reader') {
      return <span className="reader-mode-badge auto-reader">Auto Reader</span>;
    }
    return <span className="reader-mode-badge vanilla">Vanilla</span>;
  };

  // Check if the current tab has content to show edit buttons
  const currentTabHasContent = notes && (
    (activeTab === 'paper' && notes.hasNotes) ||
    (activeTab === 'code' && notes.hasCodeNotes)
  );

  const handleStartEdit = () => {
    const currentContent = activeTab === 'paper'
      ? notes?.notesContent || ''
      : notes?.codeNotesContent || '';
    setEditContent(currentContent);
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!getAuthHeaders) return;
    setSaving(true);
    try {
      const response = await fetch(`${apiUrl}/documents/${document.id}/notes/content`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          type: activeTab === 'paper' ? 'paper' : 'code',
          content: editContent,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save');
      }

      setNotes(prev => ({
        ...prev,
        ...(activeTab === 'paper'
          ? { notesContent: editContent }
          : { codeNotesContent: editContent }),
      }));
      setIsEditing(false);
    } catch (err) {
      console.error('Error saving notes:', err);
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
  };

  const handleTabSwitch = (tab) => {
    setIsEditing(false);
    setShowAiEdit(false);
    setActiveTab(tab);
  };

  // AI Edit: submit prompt to queue
  const handleAiEditSubmit = async () => {
    if (!aiPrompt.trim() || !getAuthHeaders) return;
    setAiEditStatus('submitting');

    try {
      const response = await fetch(`${apiUrl}/documents/${document.id}/notes/ai-edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          type: activeTab === 'paper' ? 'paper' : 'code',
          prompt: aiPrompt.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to submit AI edit');
      }

      setAiEditStatus('queued');
      setAiPrompt('');
      onAiEditStatusChange?.('queued');

      // Start polling for completion
      startAiEditPolling();
    } catch (err) {
      console.error('Error submitting AI edit:', err);
      alert('Failed to submit: ' + err.message);
      setAiEditStatus(null);
    }
  };

  const startAiEditPolling = () => {
    if (aiPollRef.current) clearInterval(aiPollRef.current);

    aiPollRef.current = setInterval(async () => {
      try {
        const response = await fetch(`${apiUrl}/documents/${document.id}/notes/ai-edit/status`);
        const data = await response.json();

        if (data.status === 'processing') {
          setAiEditStatus('processing');
          onAiEditStatusChange?.('processing');
        } else if (data.status === 'completed') {
          clearInterval(aiPollRef.current);
          aiPollRef.current = null;
          setAiEditStatus(null);
          setShowAiEdit(false);
          onAiEditStatusChange?.(null);
          // Reload notes to get the updated content
          await fetchNotes();
        } else if (data.status === 'failed') {
          clearInterval(aiPollRef.current);
          aiPollRef.current = null;
          setAiEditStatus(null);
          onAiEditStatusChange?.(null);
          alert('AI edit failed: ' + (data.error || 'Unknown error'));
        } else if (!data.status || data.status === 'idle') {
          // No active job, might have completed between requests
          clearInterval(aiPollRef.current);
          aiPollRef.current = null;
          setAiEditStatus(null);
          onAiEditStatusChange?.(null);
          await fetchNotes();
        }
      } catch (err) {
        console.error('Error polling AI edit status:', err);
      }
    }, 5000); // Poll every 5 seconds
  };

  const aiEditInProgress = aiEditStatus === 'queued' || aiEditStatus === 'processing';

  // Generate notes: queue and poll
  const handleGenerateNotes = async () => {
    if (!getAuthHeaders) return;
    setGenerating(true);
    setGenerateError(null);

    try {
      const response = await fetch(`${apiUrl}/reader/queue/${document.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          readerMode: selectedMode,
          provider: selectedProvider,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to queue generation');
      }

      // Update parent document status
      onDocumentUpdate?.({ ...document, processingStatus: 'queued' });

      // Start polling for completion
      startGeneratePoll();
    } catch (err) {
      console.error('Error generating notes:', err);
      setGenerateError(err.message);
      setGenerating(false);
    }
  };

  const startGeneratePoll = () => {
    if (generatePollRef.current) clearInterval(generatePollRef.current);

    generatePollRef.current = setInterval(async () => {
      try {
        const response = await fetch(`${apiUrl}/documents/${document.id}/notes?inline=true`);
        const data = await response.json();

        if (data.processingStatus === 'completed') {
          clearInterval(generatePollRef.current);
          generatePollRef.current = null;
          setGenerating(false);
          setNotes(data);
          onDocumentUpdate?.({ ...document, processingStatus: 'completed' });
        } else if (data.processingStatus === 'failed') {
          clearInterval(generatePollRef.current);
          generatePollRef.current = null;
          setGenerating(false);
          setGenerateError('Processing failed. Please try again.');
          onDocumentUpdate?.({ ...document, processingStatus: 'failed' });
        } else {
          onDocumentUpdate?.({ ...document, processingStatus: data.processingStatus });
        }
      } catch (err) {
        console.error('Error polling generation status:', err);
      }
    }, 10000); // Poll every 10 seconds
  };

  const processingStatus = notes?.processingStatus || document.processingStatus || 'idle';
  const canGenerate = processingStatus === 'idle' || processingStatus === 'pending' || processingStatus === 'failed';

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className={`notes-modal ${isMaximized ? 'maximized' : ''}`}>
        <div className="notes-modal-header">
          <div className="header-title-row">
            <h2>Notes: {document.title}</h2>
            {notes?.readerMode && getReaderModeBadge(notes.readerMode)}
          </div>
          <div className="header-actions">
            {isAuthenticated && currentTabHasContent && !isEditing && !showAiEdit && (
              <>
                <button
                  className="edit-btn"
                  onClick={handleStartEdit}
                  title="Manual edit"
                >
                  Edit
                </button>
                <button
                  className="edit-btn ai-edit-btn"
                  onClick={() => setShowAiEdit(true)}
                  title="AI-powered edit"
                  disabled={aiEditInProgress}
                >
                  {aiEditInProgress ? (aiEditStatus === 'processing' ? 'Processing...' : 'Queued...') : 'AI Edit'}
                </button>
              </>
            )}
            <button
              className="maximize-btn"
              onClick={() => setIsMaximized(!isMaximized)}
              title={isMaximized ? 'Restore' : 'Maximize'}
            >
              {isMaximized ? '⊖' : '⊕'}
            </button>
            <button className="close-btn" onClick={onClose}>
              &times;
            </button>
          </div>
        </div>

        {notes && (notes.hasNotes || notes.hasCodeNotes) && (
          <div className="notes-tabs">
            <button
              className={`notes-tab ${activeTab === 'paper' ? 'active' : ''}`}
              onClick={() => handleTabSwitch('paper')}
              disabled={!notes.hasNotes}
            >
              Paper Notes
            </button>
            {onViewUserNotes && (
              <button
                className="notes-tab user-notes-tab"
                onClick={() => { onClose(); onViewUserNotes(document); }}
              >
                User Notes
              </button>
            )}
            <button
              className={`notes-tab ${activeTab === 'code' ? 'active' : ''}`}
              onClick={() => handleTabSwitch('code')}
              disabled={!notes.hasCodeNotes}
            >
              Code Notes
              {notes.hasCodeNotes && <span className="code-badge">Available</span>}
            </button>
          </div>
        )}

        {notes?.codeUrl && (
          <div className="code-url-info">
            <span className="code-label">Code Repository:</span>
            <a href={notes.codeUrl} target="_blank" rel="noopener noreferrer" className="code-link">
              {notes.codeUrl}
            </a>
          </div>
        )}

        {/* AI Edit prompt panel */}
        {showAiEdit && !isEditing && (
          <div className="ai-edit-panel">
            <div className="ai-edit-header">
              <span className="ai-edit-label">AI Edit ({activeTab === 'paper' ? 'Paper' : 'Code'} Notes)</span>
              <button className="ai-edit-close" onClick={() => setShowAiEdit(false)}>&times;</button>
            </div>
            <p className="ai-edit-hint">
              Describe what you want the AI to fix or change. The AI will use the original PDF and current notes as context.
            </p>
            <textarea
              className="ai-edit-prompt"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="e.g., Fix the mermaid diagrams that fail to render, or Rewrite the methodology section to be more clear..."
              rows={3}
              disabled={aiEditInProgress}
            />
            <div className="ai-edit-actions">
              {aiEditInProgress && (
                <span className={`ai-edit-status ${aiEditStatus}`}>
                  {aiEditStatus === 'queued' && 'Queued - waiting for processing...'}
                  {aiEditStatus === 'processing' && 'Processing - AI is editing your notes...'}
                </span>
              )}
              <button
                className="ai-edit-submit"
                onClick={handleAiEditSubmit}
                disabled={!aiPrompt.trim() || aiEditInProgress || aiEditStatus === 'submitting'}
              >
                {aiEditStatus === 'submitting' ? 'Submitting...' : 'Submit AI Edit'}
              </button>
            </div>
          </div>
        )}

        <div className="notes-modal-content">
          {loading && (
            <div className="notes-loading">
              <div className="spinner"></div>
              <p>Loading notes...</p>
            </div>
          )}

          {error && (
            <div className="notes-error">
              <p>Error: {error}</p>
            </div>
          )}

          {notes && !notes.hasNotes && !notes.hasCodeNotes && (
            <div className="notes-empty">
              {(processingStatus === 'queued' || processingStatus === 'processing' || generating) ? (
                <>
                  <div className="spinner"></div>
                  <p>{processingStatus === 'processing' || generating ? 'Generating notes...' : 'Waiting in queue...'}</p>
                  <p className="hint">This may take a few minutes depending on the paper length.</p>
                </>
              ) : (
                <>
                  <p>No AI notes yet.</p>
                  {processingStatus === 'failed' && (
                    <p className="hint error">Previous generation failed. Try again with different settings.</p>
                  )}
                  {isAuthenticated && (
                    <div className="generate-panel">
                      <h3>Generate AI Notes</h3>
                      <div className="generate-options">
                        <div className="generate-option">
                          <label>Reader Mode</label>
                          <select value={selectedMode} onChange={(e) => setSelectedMode(e.target.value)}>
                            {readerModes.map((mode) => (
                              <option key={mode.id} value={mode.id}>{mode.name}</option>
                            ))}
                          </select>
                          {readerModes.find(m => m.id === selectedMode) && (
                            <span className="option-desc">{readerModes.find(m => m.id === selectedMode).description}</span>
                          )}
                        </div>
                        <div className="generate-option">
                          <label>LLM Provider</label>
                          <select value={selectedProvider} onChange={(e) => setSelectedProvider(e.target.value)}>
                            {providers.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {generateError && <p className="hint error">{generateError}</p>}
                      <button
                        className="generate-btn-action"
                        onClick={handleGenerateNotes}
                        disabled={generating}
                      >
                        {generating ? 'Queuing...' : 'Generate Notes'}
                      </button>
                    </div>
                  )}
                  {!isAuthenticated && (
                    <p className="hint">Login to generate AI notes.</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Editing mode */}
          {isEditing && (
            <div className="notes-editor-container">
              <MarkdownEditor
                value={editContent}
                onChange={setEditContent}
                onSave={handleSaveEdit}
                onCancel={handleCancelEdit}
                saving={saving}
              />
            </div>
          )}

          {/* Paper Notes Tab (view mode) */}
          {!isEditing && activeTab === 'paper' && notes && notes.hasNotes && parsedPaperNotes && (
            <div className="notes-markdown">
              <MarkdownContent content={parsedPaperNotes.content} />
            </div>
          )}

          {/* Code Notes Tab (view mode) */}
          {!isEditing && activeTab === 'code' && notes && notes.hasCodeNotes && parsedCodeNotes && (
            <div className="notes-markdown code-notes">
              <MarkdownContent content={parsedCodeNotes.content} />
            </div>
          )}

          {/* Empty state for selected tab */}
          {!isEditing && activeTab === 'paper' && notes && !notes.hasNotes && notes.hasCodeNotes && (
            <div className="notes-empty">
              <p>No paper notes available.</p>
              <p className="hint">Switch to Code Notes tab to view code analysis.</p>
            </div>
          )}

          {!isEditing && activeTab === 'code' && notes && !notes.hasCodeNotes && notes.hasNotes && (
            <div className="notes-empty">
              <p>No code notes available.</p>
              {notes.hasCode ? (
                <p className="hint">Code analysis is being processed or encountered an error.</p>
              ) : (
                <p className="hint">This paper does not have associated code.</p>
              )}
            </div>
          )}
        </div>

        <div className="notes-modal-footer">
          {activeTab === 'paper' && notes && notes.notesUrl && (
            <a
              href={notes.notesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="download-notes-btn"
            >
              Download Paper Notes (.md)
            </a>
          )}
          {activeTab === 'code' && notes && notes.codeNotesUrl && (
            <a
              href={notes.codeNotesUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="download-notes-btn"
            >
              Download Code Notes (.md)
            </a>
          )}
          <button className="close-modal-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default NotesModal;
