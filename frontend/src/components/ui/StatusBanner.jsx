function StatusBanner({ type = 'info', message, actionLabel, onAction, dismissLabel = 'Dismiss', onDismiss }) {
  if (!message) return null;
  const normalizedType = ['success', 'error', 'info'].includes(type) ? type : 'info';

  return (
    <div className={`ui-status-banner ui-status-banner--${normalizedType}`} role={normalizedType === 'error' ? 'alert' : 'status'}>
      <p>{message}</p>
      {(onAction || onDismiss) ? (
        <div className="ui-status-banner-actions">
          {onAction ? (
            <button type="button" onClick={onAction}>{actionLabel || 'Retry'}</button>
          ) : null}
          {onDismiss ? (
            <button type="button" onClick={onDismiss}>{dismissLabel}</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default StatusBanner;
