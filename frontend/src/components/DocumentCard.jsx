import { useState, useRef, useEffect } from 'react';

function DocumentCard({ document, onDownload, onViewNotes, onViewUserNotes, onToggleRead, onTriggerCodeAnalysis, onDelete, onTagsUpdate, isAuthenticated, allTags, researchMode, isSelected, onToggleSelect }) {
  const [downloading, setDownloading] = useState(false);
  const [togglingRead, setTogglingRead] = useState(false);
  const [triggeringAnalysis, setTriggeringAnalysis] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [addingTag, setAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [savingTags, setSavingTags] = useState(false);
  const tagInputRef = useRef(null);

  useEffect(() => {
    if (addingTag && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [addingTag]);

  const tagColorMap = {};
  if (allTags) {
    allTags.forEach(t => { tagColorMap[t.name] = t.color; });
  }

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);

    try {
      const downloadUrl = await onDownload(document);
      window.open(downloadUrl, '_blank');
    } catch (err) {
      setError('Failed to get download link');
      console.error('Download error:', err);
    } finally {
      setDownloading(false);
    }
  };

  const handleToggleRead = async () => {
    setTogglingRead(true);
    try {
      await onToggleRead(document);
    } catch (err) {
      console.error('Toggle read error:', err);
    } finally {
      setTogglingRead(false);
    }
  };

  const handleTriggerCodeAnalysis = async () => {
    if (!onTriggerCodeAnalysis) return;
    setTriggeringAnalysis(true);
    setError(null);
    try {
      await onTriggerCodeAnalysis(document);
    } catch (err) {
      // Show the actual error message from the API
      setError(err.message || 'Failed to queue analysis');
      console.error('Code analysis error:', err);
    } finally {
      setTriggeringAnalysis(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!window.confirm(`Delete "${document.title}"?\n\nThis cannot be undone.`)) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await onDelete(document);
    } catch (err) {
      setError(err.message || 'Failed to delete');
      console.error('Delete error:', err);
    } finally {
      setDeleting(false);
    }
  };

  const handleAddTag = async (tagName) => {
    const normalized = tagName.toLowerCase().trim();
    if (!normalized || !onTagsUpdate) return;
    const currentTags = document.tags || [];
    if (currentTags.includes(normalized)) {
      setTagInput('');
      setAddingTag(false);
      return;
    }
    const newTags = [...currentTags, normalized];
    setSavingTags(true);
    try {
      await onTagsUpdate(document, newTags);
      setTagInput('');
      setAddingTag(false);
    } catch (err) {
      setError('Failed to add tag');
      console.error('Add tag error:', err);
    } finally {
      setSavingTags(false);
    }
  };

  const handleRemoveTag = async (tagName) => {
    if (!onTagsUpdate) return;
    const currentTags = document.tags || [];
    const newTags = currentTags.filter(t => t !== tagName);
    setSavingTags(true);
    try {
      await onTagsUpdate(document, newTags);
    } catch (err) {
      setError('Failed to remove tag');
      console.error('Remove tag error:', err);
    } finally {
      setSavingTags(false);
    }
  };

  const handleTagInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag(tagInput);
    } else if (e.key === 'Escape') {
      setAddingTag(false);
      setTagInput('');
    }
  };

  const filteredSuggestions = allTags
    ? allTags
        .filter(t => t.name.includes(tagInput.toLowerCase()) && !(document.tags || []).includes(t.name))
        .slice(0, 5)
    : [];

  const handleCardClick = (e) => {
    if (!researchMode) return;
    // Don't toggle if clicking on links or buttons
    if (e.target.closest('a') || e.target.closest('button') || e.target.closest('input')) return;
    onToggleSelect?.(document.id);
  };

  const getTypeBadgeClass = (type) => {
    const classes = {
      paper: 'badge-paper',
      book: 'badge-book',
      blog: 'badge-blog',
      other: 'badge-other',
    };
    return classes[type] || 'badge-other';
  };

  const getStatusBadge = (status) => {
    if (!status || status === 'idle') return null;
    const statusConfig = {
      pending: { label: 'Pending', className: 'status-pending' },
      queued: { label: 'Queued', className: 'status-queued' },
      processing: { label: 'Processing', className: 'status-processing' },
      completed: { label: 'Ready', className: 'status-completed' },
      failed: { label: 'Failed', className: 'status-failed' },
    };
    const config = statusConfig[status] || statusConfig.pending;
    return <span className={`status-badge ${config.className}`}>{config.label}</span>;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  const processingStatus = document.processingStatus || 'pending';
  const hasNotes = processingStatus === 'completed';
  const readerMode = document.readerMode || 'vanilla';
  const codeAnalysisStatus = document.codeAnalysisStatus;
  const aiEditInProgress = document.aiEditStatus === 'queued' || document.aiEditStatus === 'processing';

  const getReaderModeBadge = () => {
    if (readerMode === 'auto_reader') {
      return <span className="reader-badge auto-reader" title="Multi-pass deep reading">Auto</span>;
    }
    return null;
  };

  const renderCodeButton = () => {
    if (!document.hasCode || !hasNotes) return null;

    if (codeAnalysisStatus === 'completed') {
      return (
        <button className="action-btn code-btn" onClick={() => onViewNotes(document, 'code')} title="View code analysis">
          Code Notes
        </button>
      );
    }

    if (codeAnalysisStatus === 'queued') {
      return <button className="action-btn waiting-btn" disabled title="Waiting in queue">Waiting...</button>;
    }

    if (codeAnalysisStatus === 'processing') {
      return <button className="action-btn waiting-btn" disabled title="Analysis in progress">Analyzing...</button>;
    }

    if (codeAnalysisStatus === 'failed') {
      return (
        <button className="action-btn code-btn" onClick={handleTriggerCodeAnalysis} disabled={triggeringAnalysis} title="Retry code analysis">
          {triggeringAnalysis ? '...' : 'Retry'}
        </button>
      );
    }

    return (
      <button className="action-btn code-btn" onClick={handleTriggerCodeAnalysis} disabled={triggeringAnalysis} title="Deep code analysis (Opus, ~30 min)">
        {triggeringAnalysis ? '...' : 'Analyze Code'}
      </button>
    );
  };

  const getTagStyle = (tagName) => {
    const color = tagColorMap[tagName];
    if (!color) return {};
    return {
      backgroundColor: color + '20',
      color: color,
      borderColor: color + '40',
    };
  };

  return (
    <div
      className={`document-card ${document.isRead ? 'is-read' : ''}${researchMode ? ' research-mode' : ''}${isSelected ? ' is-selected' : ''}`}
      onClick={handleCardClick}
      style={researchMode ? { cursor: 'pointer' } : undefined}
    >
      {researchMode && (
        <div className="select-checkbox" onClick={(e) => { e.stopPropagation(); onToggleSelect?.(document.id); }}>
          <input type="checkbox" checked={!!isSelected} readOnly />
        </div>
      )}
      <div className="document-info">
        <div className="document-header">
          <span className={`type-badge ${getTypeBadgeClass(document.type)}`}>{document.type}</span>
          {getStatusBadge(processingStatus)}
          {getReaderModeBadge()}
          {document.hasCode && <span className="code-indicator" title="Has code repository">{'</>'}</span>}
          {aiEditInProgress && <span className="status-badge status-processing">AI Editing</span>}
          <span className="document-date">{formatDate(document.createdAt)}</span>
        </div>
        <h3 className="document-title">{document.title}</h3>
        {document.originalUrl && (
          <a href={document.originalUrl} target="_blank" rel="noopener noreferrer" className="document-url">
            {new URL(document.originalUrl).hostname}
          </a>
        )}
        {document.codeUrl && (
          <a href={document.codeUrl} target="_blank" rel="noopener noreferrer" className="document-code-url">
            Code: {new URL(document.codeUrl).pathname.split('/').slice(1, 3).join('/')}
          </a>
        )}
        <div className="document-tags">
          {(document.tags || []).map((tag, index) => (
            <span key={index} className="document-tag" style={getTagStyle(tag)}>
              {tag}
              {isAuthenticated && onTagsUpdate && (
                <button
                  className="tag-remove-btn"
                  onClick={(e) => { e.stopPropagation(); handleRemoveTag(tag); }}
                  disabled={savingTags}
                  title={`Remove tag "${tag}"`}
                >
                  x
                </button>
              )}
            </span>
          ))}
          {isAuthenticated && onTagsUpdate && !addingTag && (
            <button
              className="add-tag-btn"
              onClick={() => setAddingTag(true)}
              disabled={savingTags}
              title="Add tag"
            >
              +
            </button>
          )}
          {addingTag && (
            <div className="tag-input-wrapper">
              <input
                ref={tagInputRef}
                type="text"
                className="tag-input"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagInputKeyDown}
                onBlur={() => {
                  // Delay to allow clicking suggestions
                  setTimeout(() => {
                    if (!tagInput.trim()) {
                      setAddingTag(false);
                      setTagInput('');
                    }
                  }, 200);
                }}
                placeholder="tag name..."
                disabled={savingTags}
              />
              {tagInput && filteredSuggestions.length > 0 && (
                <div className="tag-suggestions">
                  {filteredSuggestions.map(s => (
                    <button
                      key={s.id}
                      className="tag-suggestion"
                      onMouseDown={(e) => { e.preventDefault(); handleAddTag(s.name); }}
                      style={{ borderLeft: `3px solid ${s.color}` }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {!researchMode && (
        <div className="document-actions">
          <button
            className={`action-btn read-btn ${document.isRead ? 'is-read' : ''}`}
            onClick={handleToggleRead}
            disabled={togglingRead}
            title={document.isRead ? 'Mark as unread' : 'Mark as read'}
          >
            {togglingRead ? '...' : document.isRead ? '✓ Read' : 'Mark Read'}
          </button>
          {aiEditInProgress ? (
            <button className="action-btn waiting-btn" disabled title="AI is editing notes">
              {document.aiEditStatus === 'processing' ? 'AI Editing...' : 'AI Queued...'}
            </button>
          ) : hasNotes ? (
            <button className="action-btn paper-btn" onClick={() => onViewNotes(document, 'paper')} title="View AI-generated notes">
              AI Notes
            </button>
          ) : (processingStatus === 'idle' || processingStatus === 'pending' || processingStatus === 'failed') ? (
            <button className="action-btn generate-btn" onClick={() => onViewNotes(document, 'paper')} title="Generate AI notes">
              Generate
            </button>
          ) : (
            <button className="action-btn status-btn" onClick={() => onViewNotes(document, 'paper')} title="View processing status">
              {processingStatus === 'processing' ? 'Processing...' : 'Queued...'}
            </button>
          )}
          <button className="action-btn notes-btn" onClick={() => onViewUserNotes(document)} title="My personal notes">
            User Notes
          </button>
          {!aiEditInProgress && renderCodeButton()}
          <button className="action-btn pdf-btn" onClick={handleDownload} disabled={downloading}>
            {downloading ? '...' : 'PDF'}
          </button>
          {isAuthenticated && (
            <button
              className="action-btn delete-btn"
              onClick={handleDelete}
              disabled={deleting}
              title="Delete document"
            >
              {deleting ? '...' : '×'}
            </button>
          )}
          {error && <span className="download-error">{error}</span>}
        </div>
      )}
    </div>
  );
}

export default DocumentCard;
