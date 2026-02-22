import { useState, useEffect, useCallback } from 'react';
import MarkdownContent from './shared/MarkdownRenderer';
import MarkdownEditor from './MarkdownEditor';

function UserNotesModal({ document, apiUrl, onClose, isAuthenticated, getAuthHeaders, onViewAiNotes }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('list'); // 'list' | 'editor' | 'preview'
  const [currentNote, setCurrentNote] = useState(null); // note being viewed/edited
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/documents/${document.id}/user-notes`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to fetch notes');
      setNotes(data.notes || []);
    } catch (err) {
      console.error('Error fetching user notes:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [apiUrl, document.id]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleBackdropClick = (e) => {
    if (e.target.classList.contains('modal-backdrop')) {
      onClose();
    }
  };

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        if (view === 'editor' || view === 'preview') {
          setView('list');
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, view]);

  const handleAddNew = () => {
    setCurrentNote(null);
    setEditTitle('');
    setEditContent('');
    setView('editor');
  };

  const handleViewNote = (note) => {
    setCurrentNote(note);
    setView('preview');
  };

  const handleEditNote = (note) => {
    setCurrentNote(note);
    setEditTitle(note.title);
    setEditContent(note.content);
    setView('editor');
  };

  const handleSave = async () => {
    if (!getAuthHeaders) return;
    setSaving(true);
    try {
      const isNew = !currentNote;
      const url = isNew
        ? `${apiUrl}/documents/${document.id}/user-notes`
        : `${apiUrl}/documents/${document.id}/user-notes/${currentNote.id}`;

      const response = await fetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          title: editTitle || 'Untitled Note',
          content: editContent,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save note');
      }

      await fetchNotes();
      setView('list');
    } catch (err) {
      console.error('Error saving note:', err);
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (noteId) => {
    if (!window.confirm('Delete this note?')) return;
    if (!getAuthHeaders) return;

    try {
      const response = await fetch(`${apiUrl}/documents/${document.id}/user-notes/${noteId}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete note');
      }

      await fetchNotes();
      if (view !== 'list') setView('list');
    } catch (err) {
      console.error('Error deleting note:', err);
      alert('Failed to delete: ' + err.message);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getPreviewText = (content) => {
    if (!content) return 'Empty note';
    // Strip markdown syntax for preview
    const plain = content
      .replace(/#{1,6}\s/g, '')
      .replace(/\*\*|__/g, '')
      .replace(/\*|_/g, '')
      .replace(/`{1,3}[^`]*`{1,3}/g, '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/\n/g, ' ')
      .trim();
    return plain.length > 120 ? plain.substring(0, 120) + '...' : plain;
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className={`notes-modal user-notes-modal ${isMaximized ? 'maximized' : ''}`}>
        <div className="notes-modal-header">
          <div className="header-title-row">
            <h2>
              {view === 'list' && `My Notes: ${document.title}`}
              {view === 'editor' && (currentNote ? 'Edit Note' : 'New Note')}
              {view === 'preview' && (currentNote?.title || 'Note')}
            </h2>
          </div>
          <div className="header-actions">
            {view !== 'list' && (
              <button className="back-btn" onClick={() => setView('list')} title="Back to list">
                Back
              </button>
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

        {onViewAiNotes && (
          <div className="notes-tabs">
            <button
              className="notes-tab"
              onClick={() => onViewAiNotes(document)}
            >
              Paper Notes
            </button>
            <button className="notes-tab active user-notes-tab">
              User Notes
            </button>
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

          {/* List View */}
          {!loading && !error && view === 'list' && (
            <div className="user-notes-list">
              {isAuthenticated && (
                <button className="add-note-btn" onClick={handleAddNew}>
                  + Add New Note
                </button>
              )}

              {notes.length === 0 && (
                <div className="notes-empty">
                  <p>No notes yet for this paper.</p>
                  {isAuthenticated && <p className="hint">Click "+ Add New Note" to create one.</p>}
                </div>
              )}

              {notes.map((note) => (
                <div key={note.id} className="note-card" onClick={() => handleViewNote(note)}>
                  <div className="note-card-header">
                    <h4 className="note-card-title">{note.title || 'Untitled Note'}</h4>
                    <span className="note-card-date">{formatDate(note.updatedAt)}</span>
                  </div>
                  <p className="note-card-preview">{getPreviewText(note.content)}</p>
                  {isAuthenticated && (
                    <div className="note-card-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="note-action-btn" onClick={() => handleEditNote(note)}>Edit</button>
                      <button className="note-action-btn delete" onClick={() => handleDelete(note.id)}>Delete</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Editor View */}
          {view === 'editor' && (
            <div className="user-note-editor">
              <div className="note-title-input">
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="Note title..."
                  className="note-title-field"
                />
              </div>
              <MarkdownEditor
                value={editContent}
                onChange={setEditContent}
                onSave={handleSave}
                onCancel={() => setView('list')}
                saving={saving}
              />
            </div>
          )}

          {/* Preview View */}
          {view === 'preview' && currentNote && (
            <div className="user-note-preview">
              <div className="note-preview-header">
                <span className="note-preview-date">{formatDate(currentNote.updatedAt)}</span>
                {isAuthenticated && (
                  <div className="note-preview-actions">
                    <button className="note-action-btn" onClick={() => handleEditNote(currentNote)}>Edit</button>
                    <button className="note-action-btn delete" onClick={() => handleDelete(currentNote.id)}>Delete</button>
                  </div>
                )}
              </div>
              <div className="notes-markdown">
                <MarkdownContent content={currentNote.content || ''} />
              </div>
            </div>
          )}
        </div>

        <div className="notes-modal-footer">
          <button className="close-modal-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default UserNotesModal;
