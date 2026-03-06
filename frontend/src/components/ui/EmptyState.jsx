function EmptyState({ title, hint, actionLabel, onAction, className = '' }) {
  return (
    <div className={`ui-empty-state ui-surface ui-surface--muted ${className}`.trim()} role="status" aria-live="polite">
      <p className="ui-empty-state-title">{title}</p>
      {hint ? <p className="ui-empty-state-hint">{hint}</p> : null}
      {actionLabel && onAction ? (
        <div className="ui-empty-state-actions">
          <button type="button" onClick={onAction}>{actionLabel}</button>
        </div>
      ) : null}
    </div>
  );
}

export default EmptyState;
