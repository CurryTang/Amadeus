import DocumentCard from './DocumentCard';

function DocumentList({ documents, onDownload, onViewNotes, onViewUserNotes, onToggleRead, onTriggerCodeAnalysis, onDelete, onTagsUpdate, onTitleUpdate, loading, isAuthenticated, allTags, researchMode, selectedDocIds, onToggleSelect, apiUrl, getAuthHeaders }) {
  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading documents...</p>
      </div>
    );
  }

  return (
    <div className="document-list">
      {documents.map((doc) => (
        <DocumentCard
          key={doc.id}
          document={doc}
          onDownload={onDownload}
          onViewNotes={onViewNotes}
          onViewUserNotes={onViewUserNotes}
          onToggleRead={onToggleRead}
          onTriggerCodeAnalysis={onTriggerCodeAnalysis}
          onDelete={onDelete}
          onTagsUpdate={onTagsUpdate}
          onTitleUpdate={onTitleUpdate}
          isAuthenticated={isAuthenticated}
          allTags={allTags}
          researchMode={researchMode}
          isSelected={selectedDocIds?.has(doc.id)}
          onToggleSelect={onToggleSelect}
          apiUrl={apiUrl}
          getAuthHeaders={getAuthHeaders}
        />
      ))}
    </div>
  );
}

export default DocumentList;
