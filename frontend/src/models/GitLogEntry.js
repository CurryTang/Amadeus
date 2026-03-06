const COMMIT_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function toValidDate(rawValue) {
  if (!rawValue) return null;
  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

class GitLogEntry {
  constructor(payload = {}) {
    this.hash = String(payload.hash || '');
    this.shortHash = String(payload.shortHash || this.hash.slice(0, 7) || '');
    this.authorName = String(payload.authorName || 'Unknown author');
    this.authorEmail = String(payload.authorEmail || '');
    this.authoredAt = String(payload.authoredAt || '');
    this.subject = String(payload.subject || '');
  }

  static fromApi(payload = {}) {
    return new GitLogEntry(payload);
  }

  get displayTime() {
    const parsed = toValidDate(this.authoredAt);
    if (!parsed) return this.authoredAt || 'Unknown time';
    return COMMIT_DATE_FORMATTER.format(parsed);
  }

  get subtitle() {
    return `${this.authorName} · ${this.displayTime}`;
  }
}

export default GitLogEntry;
