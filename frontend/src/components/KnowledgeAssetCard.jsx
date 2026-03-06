import React from 'react';

function formatDate(iso = '') {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function truncate(value = '', max = 220) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function KnowledgeAssetCard({
  asset,
  pinned = false,
  linked = false,
  pinBusy = false,
  linkBusy = false,
  onTogglePin,
  onToggleLink,
  onPreview,
}) {
  return (
    <div className="vibe-asset-card">
      <div className="vibe-asset-card-head">
        <div className="vibe-asset-title-wrap">
          <strong>{asset.title || `Asset #${asset.id}`}</strong>
          <span>{asset.subtitle}</span>
        </div>
        <code>#{asset.id}</code>
      </div>
      {asset.summary ? (
        <p className="vibe-asset-summary">{truncate(asset.summary, 220)}</p>
      ) : (
        <p className="vibe-asset-summary">{truncate(asset.bodyMd || '', 220) || 'No summary yet.'}</p>
      )}
      <div className="vibe-asset-meta">
        {asset.source?.provider && <span>{asset.source.provider}</span>}
        {asset.file?.mimeType && <span>{asset.file.mimeType}</span>}
        {asset.updatedAt && <span>{formatDate(asset.updatedAt)}</span>}
      </div>
      <div className="vibe-asset-actions">
        <button
          type="button"
          className="vibe-secondary-btn"
          onClick={() => onTogglePin?.(asset.id, pinned)}
          disabled={pinBusy}
        >
          {pinBusy ? 'Updating...' : (pinned ? 'Unpin' : 'Pin')}
        </button>
        <button
          type="button"
          className="vibe-secondary-btn"
          onClick={() => onToggleLink?.(asset.id, linked)}
          disabled={linkBusy}
        >
          {linkBusy ? 'Updating...' : (linked ? 'Unlink' : 'Link')}
        </button>
        <button
          type="button"
          className="vibe-secondary-btn"
          onClick={() => onPreview?.(asset)}
        >
          Preview
        </button>
      </div>
    </div>
  );
}

export default KnowledgeAssetCard;
