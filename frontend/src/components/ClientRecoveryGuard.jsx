'use client';

import { useEffect } from 'react';

const RECOVERY_FLAG_KEY = 'auto_reader_client_recovery_attempted_at';
const RECOVERY_COOLDOWN_MS = 5 * 60 * 1000;
const ERROR_PATTERNS = [
  'Failed to find Server Action',
  'ChunkLoadError',
  'Loading chunk',
  'dynamically imported module',
];

function shouldRecoverFromMessage(message) {
  const text = String(message || '');
  if (!text) return false;
  return ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

function hasRecentRecoveryAttempt() {
  try {
    const raw = sessionStorage.getItem(RECOVERY_FLAG_KEY);
    const ts = Number(raw || 0);
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return Date.now() - ts < RECOVERY_COOLDOWN_MS;
  } catch (_) {
    return false;
  }
}

function markRecoveryAttempt() {
  try {
    sessionStorage.setItem(RECOVERY_FLAG_KEY, String(Date.now()));
  } catch (_) {}
}

async function clearClientCaches() {
  try {
    localStorage.removeItem('latest_papers_cache_v2');
  } catch (_) {}

  try {
    if (typeof caches !== 'undefined' && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key).catch(() => false)));
    }
  } catch (_) {}
}

async function recoverClientState() {
  if (hasRecentRecoveryAttempt()) return;
  markRecoveryAttempt();
  await clearClientCaches();

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set('__recover', String(Date.now()));
  window.location.replace(nextUrl.toString());
}

export default function ClientRecoveryGuard() {
  useEffect(() => {
    const onError = (event) => {
      const message = event?.error?.message || event?.message || '';
      if (!shouldRecoverFromMessage(message)) return;
      recoverClientState().catch(() => {});
    };

    const onUnhandledRejection = (event) => {
      const reason = event?.reason;
      const message =
        (typeof reason === 'string' && reason)
        || reason?.message
        || '';
      if (!shouldRecoverFromMessage(message)) return;
      recoverClientState().catch(() => {});
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, []);

  return null;
}

