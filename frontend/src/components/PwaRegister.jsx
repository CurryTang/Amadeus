'use client';

import { useEffect } from 'react';

export default function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        // Check for updates every time the page regains focus
        const checkUpdate = () => reg.update().catch(() => {});
        window.addEventListener('focus', checkUpdate, { passive: true });
        return () => window.removeEventListener('focus', checkUpdate);
      })
      .catch(() => {});
  }, []);

  return null;
}
