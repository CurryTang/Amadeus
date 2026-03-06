const STATUS_MAP = {
  idle: { label: 'Idle', tone: 'success' },
  open: { label: 'Open', tone: 'info' },
  pending: { label: 'Pending', tone: 'warning' },
  queued: { label: 'Queued', tone: 'warning' },
  running: { label: 'Running', tone: 'info' },
  processing: { label: 'Processing', tone: 'info' },
  succeeded: { label: 'Succeeded', tone: 'success' },
  completed: { label: 'Ready', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'warning' },
  stopped: { label: 'Stopped', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
};

function StatusBadge({ status, label, tone, className = '' }) {
  if (!status && !label) return null;
  const normalized = String(status || '').toLowerCase();
  const mapped = STATUS_MAP[normalized] || { label: label || normalized || 'Status', tone: tone || 'info' };
  const finalLabel = label || mapped.label;
  const finalTone = tone || mapped.tone;

  return (
    <span className={`ui-status-badge ui-status-badge--${finalTone} ${className}`.trim()}>
      {finalLabel}
    </span>
  );
}

export default StatusBadge;
