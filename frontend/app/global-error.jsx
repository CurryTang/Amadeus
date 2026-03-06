'use client';

import { useEffect } from 'react';

const RECOVERY_KEY = 'auto_reader_global_error_recovery_at';
const COOLDOWN_MS = 60_000;

function isRecoverable(message) {
  const text = String(message || '');
  return (
    text.includes('Failed to find Server Action') ||
    text.includes('ChunkLoadError') ||
    text.includes('Loading chunk') ||
    text.includes('dynamically imported module') ||
    text.includes('Hydration') ||
    text.includes('hydration')
  );
}

function hasRecentRecovery() {
  try {
    const ts = Number(sessionStorage.getItem(RECOVERY_KEY) || 0);
    return Number.isFinite(ts) && ts > 0 && Date.now() - ts < COOLDOWN_MS;
  } catch (_) { return false; }
}

function markRecovery() {
  try { sessionStorage.setItem(RECOVERY_KEY, String(Date.now())); } catch (_) {}
}

async function clearAndReload() {
  markRecovery();
  try {
    if (typeof caches !== 'undefined' && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => {})));
    }
  } catch (_) {}
  const url = new URL(window.location.href);
  url.searchParams.set('__recover', String(Date.now()));
  window.location.replace(url.toString());
}

export default function GlobalError({ error, reset }) {
  const message = error?.message || '';
  const autoRecover = isRecoverable(message) && !hasRecentRecovery();

  useEffect(() => {
    if (autoRecover) {
      clearAndReload().catch(() => {});
    }
  }, [autoRecover]);

  if (autoRecover) {
    return (
      <html lang="en">
        <body style={{ fontFamily: 'system-ui,sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', margin: 0, background: '#f8fafc' }}>
          <div style={{ textAlign: 'center', color: '#64748b' }}>
            <p style={{ fontSize: '1rem', marginBottom: 8 }}>Refreshing&hellip;</p>
          </div>
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui,sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', margin: 0, background: '#f8fafc' }}>
        <div style={{ textAlign: 'center', maxWidth: 400, padding: 32 }}>
          <h2 style={{ fontSize: '1.2rem', color: '#1e293b', marginBottom: 12 }}>Something went wrong</h2>
          {message && (
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: 20, wordBreak: 'break-word' }}>{message}</p>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button
              onClick={() => clearAndReload()}
              style={{ padding: '8px 18px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: '0.9rem' }}
            >
              Reload &amp; Clear Cache
            </button>
            <button
              onClick={() => reset()}
              style={{ padding: '8px 18px', background: '#fff', color: '#334155', border: '1px solid #e2e8f0', borderRadius: 7, cursor: 'pointer', fontSize: '0.9rem' }}
            >
              Try Again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
