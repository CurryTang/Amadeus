import { useState } from 'react';
import axios from 'axios';

function ImportModal({ apiUrl, getAuthHeaders, onClose, onImported }) {
  const [mode, setMode] = useState('file'); // file | extract | note | research
  const [file, setFile] = useState(null);
  const [extractText, setExtractText] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  // Deep Research state
  const [researchQuery, setResearchQuery] = useState('');
  const [researchResults, setResearchResults] = useState(null); // null | []
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [researchSearchQuery, setResearchSearchQuery] = useState(''); // effective query used
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [expandedAbstracts, setExpandedAbstracts] = useState(new Set());

  const parseTags = () =>
    tagsText
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);

  const handleExtractFile = async () => {
    if (!file) { setError('Please select a file.'); return; }
    setLoading(true); setError(''); setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (tagsText.trim()) formData.append('tags', tagsText.trim());
      const response = await axios.post(`${apiUrl}/import/extract-file`, formData, { headers: getAuthHeaders() });
      setResult(response.data);
      onImported?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to import file');
    } finally { setLoading(false); }
  };

  const handleExtractText = async () => {
    if (!extractText.trim()) { setError('Please paste text content.'); return; }
    setLoading(true); setError(''); setResult(null);
    try {
      const response = await axios.post(
        `${apiUrl}/import/extract-text`,
        { text: extractText, tags: parseTags() },
        { headers: getAuthHeaders() }
      );
      setResult(response.data);
      onImported?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to extract/import text');
    } finally { setLoading(false); }
  };

  const handleSaveNote = async () => {
    if (!noteContent.trim()) { setError('Please enter note content.'); return; }
    setLoading(true); setError(''); setResult(null);
    try {
      const response = await axios.post(
        `${apiUrl}/import/save-note`,
        { title: noteTitle, content: noteContent, tags: parseTags() },
        { headers: getAuthHeaders() }
      );
      setResult({
        summary: { extracted: 0, imported: 1, skipped: 0, failed: 0 },
        results: [{ status: 'imported', document: response.data.document }],
      });
      setNoteTitle(''); setNoteContent('');
      onImported?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save note');
    } finally { setLoading(false); }
  };

  // ── Deep Research handlers ──────────────────────────────────────────────

  const handleDeepResearch = async () => {
    if (!researchQuery.trim()) { setError('Enter a topic or paste a proposal.'); return; }
    setLoading(true); setError(''); setResearchResults(null); setSelectedIds(new Set()); setImportResult(null);
    try {
      const response = await axios.post(
        `${apiUrl}/import/deep-research`,
        { query: researchQuery.trim(), maxResults: 15 },
        { headers: getAuthHeaders() }
      );
      setResearchResults(response.data.papers || []);
      setResearchSearchQuery(response.data.searchQuery || researchQuery.trim());
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Search failed');
    } finally { setLoading(false); }
  };

  const toggleSelect = (arxivId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(arxivId)) next.delete(arxivId); else next.add(arxivId);
      return next;
    });
  };

  const toggleAll = () => {
    if (!researchResults) return;
    if (selectedIds.size === researchResults.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(researchResults.map((p) => p.arxivId)));
    }
  };

  const toggleAbstract = (arxivId) => {
    setExpandedAbstracts((prev) => {
      const next = new Set(prev);
      if (next.has(arxivId)) next.delete(arxivId); else next.add(arxivId);
      return next;
    });
  };

  const handleImportSelected = async () => {
    if (selectedIds.size === 0) { setError('Select at least one paper.'); return; }
    setImporting(true); setError(''); setImportResult(null);
    try {
      const response = await axios.post(
        `${apiUrl}/import/save-selected`,
        { arxivIds: [...selectedIds], tags: parseTags() },
        { headers: getAuthHeaders(), timeout: 180000 }
      );
      setImportResult(response.data);
      onImported?.();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Import failed');
    } finally { setImporting(false); }
  };

  return (
    <div className="import-modal-backdrop" onClick={onClose}>
      <div className="import-modal import-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="import-modal-header">
          <h3>Import</h3>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>

        <div className="import-mode-tabs">
          <button className={`import-mode-tab ${mode === 'file' ? 'active' : ''}`} onClick={() => setMode('file')}>
            File &rarr; Extract Papers
          </button>
          <button className={`import-mode-tab ${mode === 'extract' ? 'active' : ''}`} onClick={() => setMode('extract')}>
            Text &rarr; Extract Papers
          </button>
          <button className={`import-mode-tab ${mode === 'note' ? 'active' : ''}`} onClick={() => setMode('note')}>
            Text &rarr; Save Note
          </button>
          <button className={`import-mode-tab ${mode === 'research' ? 'active' : ''}`} onClick={() => { setMode('research'); setError(''); setResult(null); }}>
            &#128269; Deep Research
          </button>
        </div>

        <div className="import-modal-body">
          <div className="import-common-row">
            <label>Tags (optional, comma-separated)</label>
            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="imported, survey, reading-list"
            />
          </div>

          {mode === 'file' && (
            <div className="import-panel">
              <label>Upload file</label>
              <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} accept=".txt,.md,.csv,.json,.pdf,.html" />
              <p className="import-hint">Supported: txt, md, csv, json, pdf, html</p>
              <button disabled={loading} onClick={handleExtractFile}>{loading ? 'Importing...' : 'Extract and Import'}</button>
            </div>
          )}

          {mode === 'extract' && (
            <div className="import-panel">
              <label>Paste text</label>
              <textarea rows={10} value={extractText} onChange={(e) => setExtractText(e.target.value)}
                placeholder="Paste notes, references, tweet threads, or links. Backend agent will extract papers." />
              <button disabled={loading} onClick={handleExtractText}>{loading ? 'Importing...' : 'Extract and Import'}</button>
            </div>
          )}

          {mode === 'note' && (
            <div className="import-panel">
              <label>Title (optional)</label>
              <input value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} placeholder="Quick Note" />
              <label>Note content</label>
              <textarea rows={10} value={noteContent} onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Write your note here. It will be saved directly to the library." />
              <button disabled={loading} onClick={handleSaveNote}>{loading ? 'Saving...' : 'Save Note to Library'}</button>
            </div>
          )}

          {mode === 'research' && (
            <div className="import-panel import-research-panel">
              <label>Research topic or project proposal</label>
              <textarea
                rows={4}
                value={researchQuery}
                onChange={(e) => setResearchQuery(e.target.value)}
                placeholder={'Enter a topic (e.g. "diffusion models for protein design")\nor paste a full project proposal — the agent will extract key terms.'}
              />
              <button className="import-research-search-btn" disabled={loading || !researchQuery.trim()} onClick={handleDeepResearch}>
                {loading ? 'Searching arXiv...' : '&#128269; Search Papers'}
              </button>

              {researchResults !== null && (
                <div className="import-research-results">
                  <div className="import-research-results-header">
                    <span>
                      {researchResults.length} result{researchResults.length !== 1 ? 's' : ''}
                      {researchSearchQuery && researchSearchQuery !== researchQuery.trim() && (
                        <span className="import-research-query-note"> (searched: &ldquo;{researchSearchQuery}&rdquo;)</span>
                      )}
                    </span>
                    {researchResults.length > 0 && (
                      <button className="import-research-toggle-all" onClick={toggleAll}>
                        {selectedIds.size === researchResults.length ? 'Deselect all' : 'Select all'}
                      </button>
                    )}
                  </div>

                  {researchResults.length === 0 ? (
                    <p className="import-hint">No papers found. Try a different query.</p>
                  ) : (
                    <div className="import-research-list">
                      {researchResults.map((paper) => (
                        <div
                          key={paper.arxivId}
                          className={`import-research-item ${selectedIds.has(paper.arxivId) ? 'is-selected' : ''}`}
                          onClick={() => toggleSelect(paper.arxivId)}
                        >
                          <input
                            type="checkbox"
                            className="import-research-check"
                            checked={selectedIds.has(paper.arxivId)}
                            onChange={() => toggleSelect(paper.arxivId)}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="import-research-item-body">
                            <div className="import-research-title">{paper.title}</div>
                            <div className="import-research-meta">
                              <span>{paper.authors.slice(0, 3).join(', ')}{paper.authors.length > 3 ? ' et al.' : ''}</span>
                              {paper.published && <span className="import-research-date">{paper.published}</span>}
                              {paper.category && <span className="import-research-cat">{paper.category}</span>}
                            </div>
                            {paper.abstract && (
                              <div className="import-research-abstract">
                                {expandedAbstracts.has(paper.arxivId)
                                  ? paper.abstract
                                  : `${paper.abstract.slice(0, 180)}${paper.abstract.length > 180 ? '...' : ''}`}
                                {paper.abstract.length > 180 && (
                                  <button
                                    className="import-research-toggle-abstract"
                                    onClick={(e) => { e.stopPropagation(); toggleAbstract(paper.arxivId); }}
                                  >
                                    {expandedAbstracts.has(paper.arxivId) ? 'less' : 'more'}
                                  </button>
                                )}
                              </div>
                            )}
                            <div className="import-research-links" onClick={(e) => e.stopPropagation()}>
                              <a href={paper.absUrl} target="_blank" rel="noreferrer" className="import-research-link import-research-link--abs">arXiv</a>
                              <a href={paper.pdfUrl} target="_blank" rel="noreferrer" className="import-research-link import-research-link--pdf">PDF</a>
                              <a href={paper.texUrl} target="_blank" rel="noreferrer" className="import-research-link import-research-link--tex">TeX</a>
                              {paper.codeUrl && (
                                <a href={paper.codeUrl} target="_blank" rel="noreferrer" className="import-research-link import-research-link--code">Code</a>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {researchResults.length > 0 && (
                    <div className="import-research-footer">
                      <span className="import-research-count">{selectedIds.size} selected</span>
                      <button
                        className="import-research-import-btn"
                        disabled={importing || selectedIds.size === 0}
                        onClick={handleImportSelected}
                      >
                        {importing ? `Importing ${selectedIds.size} paper${selectedIds.size !== 1 ? 's' : ''}...` : `Import ${selectedIds.size} Selected`}
                      </button>
                    </div>
                  )}

                  {importResult && (
                    <div className="import-summary import-summary--research">
                      Imported {importResult.summary.imported}, skipped {importResult.summary.skipped}, failed {importResult.summary.failed}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {error && <div className="import-error">{error}</div>}

          {result?.summary && mode !== 'research' && (
            <div className="import-summary">
              <strong>Result:</strong>{' '}
              {result.summary.imported} imported, {result.summary.skipped} skipped, {result.summary.failed} failed
              {typeof result.summary.extracted === 'number' ? `, ${result.summary.extracted} extracted` : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ImportModal;
