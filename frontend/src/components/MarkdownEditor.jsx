import { useState, useRef, useCallback } from 'react';
import MarkdownContent from './shared/MarkdownRenderer';

function MarkdownEditor({ value, onChange, onSave, onCancel, saving = false }) {
  const [showPreview, setShowPreview] = useState(false);
  const textareaRef = useRef(null);

  const insertMarkdown = useCallback((before, after = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.substring(start, end);
    const newText = value.substring(0, start) + before + selected + after + value.substring(end);
    onChange(newText);

    // Restore cursor position after React re-render
    requestAnimationFrame(() => {
      textarea.focus();
      const cursorPos = start + before.length + selected.length + after.length;
      textarea.setSelectionRange(
        selected ? cursorPos : start + before.length,
        selected ? cursorPos : start + before.length
      );
    });
  }, [value, onChange]);

  const toolbar = [
    { label: 'B', title: 'Bold', action: () => insertMarkdown('**', '**') },
    { label: 'I', title: 'Italic', action: () => insertMarkdown('*', '*') },
    { label: 'H', title: 'Heading', action: () => insertMarkdown('\n## ') },
    { label: '</>', title: 'Code', action: () => insertMarkdown('`', '`') },
    { label: '```', title: 'Code Block', action: () => insertMarkdown('\n```\n', '\n```\n') },
    { label: '---', title: 'Horizontal Rule', action: () => insertMarkdown('\n---\n') },
    { label: 'Link', title: 'Link', action: () => insertMarkdown('[', '](url)') },
    { label: 'List', title: 'List', action: () => insertMarkdown('\n- ') },
  ];

  return (
    <div className="markdown-editor">
      <div className="editor-toolbar">
        <div className="toolbar-buttons">
          {toolbar.map((item) => (
            <button
              key={item.label}
              className="toolbar-btn"
              onClick={item.action}
              title={item.title}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <button
            className={`toolbar-btn preview-toggle ${showPreview ? 'active' : ''}`}
            onClick={() => setShowPreview(!showPreview)}
            type="button"
          >
            {showPreview ? 'Edit' : 'Preview'}
          </button>
          <button
            className="toolbar-btn save-btn"
            onClick={onSave}
            disabled={saving}
            type="button"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            className="toolbar-btn cancel-btn"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>

      <div className="editor-body">
        {showPreview ? (
          <div className="editor-preview notes-markdown">
            <MarkdownContent content={value} />
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            className="editor-textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Write your notes in Markdown..."
            spellCheck={false}
          />
        )}
      </div>
    </div>
  );
}

export default MarkdownEditor;
