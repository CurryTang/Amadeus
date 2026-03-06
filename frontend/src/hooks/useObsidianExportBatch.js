import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

const LS_KEY = 'auto-researcher:obsidian-batch';
const POLL_MS = 5000;
const SYNC_LIMIT = 5;

function loadItems() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw).items || [];
  } catch (_) {}
  return [];
}

function persist(items) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ items })); } catch (_) {}
}

export function useObsidianExportBatch({ apiUrl, getAuthHeaders, exportToVault }) {
  const [items, setItemsRaw] = useState(() => loadItems());
  const exportRef = useRef(exportToVault);
  useEffect(() => { exportRef.current = exportToVault; }, [exportToVault]);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const pollingRef = useRef(false);

  const setItems = useCallback((updater) => {
    setItemsRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      persist(next);
      return next;
    });
  }, []);

  const pollNow = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const pending = itemsRef.current.filter((i) => i.status === 'queued' || i.status === 'generating');
      if (pending.length === 0) return;

      for (const item of pending) {
        try {
          const docRes = await axios.get(`${apiUrl}/documents/${item.docId}`, { headers: getAuthHeaders() });
          const ps = docRes.data?.processingStatus || docRes.data?.processing_status || '';
          const processingError = docRes.data?.processingError || docRes.data?.processing_error || '';

          if (ps === 'completed') {
            try {
              const notesRes = await axios.get(
                `${apiUrl}/documents/${item.docId}/notes?inline=true`,
                { headers: getAuthHeaders() },
              );
              const content = notesRes.data?.notesContent || notesRes.data?.content || notesRes.data?.notes || '';
              const text = typeof content === 'string' ? content : JSON.stringify(content);
              if (!text.trim()) {
                throw new Error('No note content found for export');
              }
              await exportRef.current(item.title, text);
              setItems((prev) => prev.map((i) => i.docId === item.docId ? { ...i, status: 'exported', error: null } : i));
            } catch (exportErr) {
              console.error('[ObsidianBatch] vault write failed', item.docId, exportErr);
              setItems((prev) => prev.map((i) =>
                i.docId === item.docId
                  ? { ...i, status: 'failed', error: exportErr.message || 'Vault export failed' }
                  : i
              ));
            }
          } else if (ps === 'failed' || ps === 'error') {
            setItems((prev) => prev.map((i) =>
              i.docId === item.docId
                ? { ...i, status: 'failed', error: processingError || 'Generation failed' }
                : i
            ));
          } else {
            setItems((prev) => prev.map((i) =>
              i.docId === item.docId && i.status === 'queued'
                ? { ...i, status: 'generating', error: null }
                : i
            ));
          }
        } catch (err) {
          console.error('[ObsidianBatch] poll error', item.docId, err);
        }
      }
    } finally {
      pollingRef.current = false;
    }
  }, [apiUrl, getAuthHeaders, setItems]);

  // addToBatch: docs is array of { id, title } that need notes generated
  const addToBatch = useCallback(async (docs, rounds, providerSettings = {}) => {
    const { provider, model, thinkingBudget } = providerSettings;
    let added = 0;
    for (const doc of docs) {
      const existing = itemsRef.current.find((i) => i.docId === doc.id);
      if (existing && (existing.status === 'queued' || existing.status === 'generating')) continue;

      // Show queue status immediately, then queue on backend.
      setItems((prev) => {
        const idx = prev.findIndex((i) => i.docId === doc.id);
        const nextItem = {
          docId: doc.id,
          title: doc.title,
          status: 'queued',
          error: null,
          addedAt: idx >= 0 ? prev[idx].addedAt : Date.now(),
        };
        if (idx < 0) return [...prev, nextItem];
        const next = [...prev];
        next[idx] = { ...prev[idx], ...nextItem };
        return next;
      });

      try {
        await axios.post(
          `${apiUrl}/reader/queue/${doc.id}`,
          {
            readerMode: 'auto_reader_v2',
            refinementRounds: rounds,
            ...(provider && { provider }),
            ...(model && { model }),
            ...(thinkingBudget !== undefined && { thinkingBudget }),
          },
          { headers: getAuthHeaders() },
        );
        added++;
      } catch (err) {
        console.error('[ObsidianBatch] failed to queue', doc.id, err);
        setItems((prev) => prev.map((i) =>
          i.docId === doc.id
            ? { ...i, status: 'failed', error: err?.response?.data?.error || err.message || 'Queue failed' }
            : i
        ));
      }
    }
    pollNow();
    return added;
  }, [apiUrl, getAuthHeaders, setItems, pollNow]);

  const clearCompleted = useCallback(() => {
    setItems((prev) => prev.filter((i) => i.status !== 'exported'));
  }, [setItems]);

  const clearAll = useCallback(() => {
    setItems([]);
  }, [setItems]);

  // Directly restore items into the batch (no backend re-queue).
  // Use for docs already being processed — poller will export them when ready.
  const restoreItems = useCallback((docs) => {
    setItems((prev) => {
      let changed = false;
      const next = [...prev];

      for (const d of docs) {
        const idx = next.findIndex((i) => i.docId === d.id);
        if (idx < 0) {
          next.push({ docId: d.id, title: d.title, status: 'queued', error: null, addedAt: Date.now() });
          changed = true;
          continue;
        }

        if (next[idx].status === 'failed' || next[idx].status === 'exported') {
          next[idx] = { ...next[idx], title: d.title, status: 'queued', error: null };
          changed = true;
        } else if (next[idx].title !== d.title) {
          next[idx] = { ...next[idx], title: d.title };
          changed = true;
        }
      }

      return changed ? next : prev;
    });
    setTimeout(() => { pollNow(); }, 0);
  }, [setItems, pollNow]);

  // Fetch recent active docs from backend and restore them into the batch.
  // Returns { count, error } for UI feedback.
  const syncFromBackend = useCallback(async () => {
    try {
      const res = await axios.get(`${apiUrl}/documents?limit=${SYNC_LIMIT}`, { headers: getAuthHeaders() });
      const docs = res.data?.documents || res.data || [];
      const active = docs
        .map((d) => ({
          id: d.id,
          title: d.title,
          processingStatus: d.processingStatus || d.processing_status || '',
        }))
        .filter((d) => d.processingStatus === 'queued' || d.processingStatus === 'processing');

      setItems((prev) => {
        const activeIds = new Set(active.map((d) => d.id));
        const prevById = new Map(prev.map((i) => [i.docId, i]));
        const keptTerminal = prev.filter((i) =>
          (i.status === 'exported' || i.status === 'failed') && !activeIds.has(i.docId)
        );
        const syncedActive = active.map((d) => {
          const existing = prevById.get(d.id);
          return {
            docId: d.id,
            title: d.title,
            status: d.processingStatus === 'processing' ? 'generating' : 'queued',
            error: null,
            addedAt: existing?.addedAt || Date.now(),
          };
        });
        return [...keptTerminal, ...syncedActive];
      });

      pollNow();
      return { count: active.length, error: null };
    } catch (err) {
      console.error('[ObsidianBatch] syncFromBackend failed', err);
      const status = err?.response?.status;
      const message = String(err?.message || '').toLowerCase();
      if (status === 504 || message.includes('timeout') || message.includes('timed out')) {
        return { count: 0, error: null };
      }
      return { count: 0, error: err.message || 'Request failed' };
    }
  }, [apiUrl, getAuthHeaders, pollNow, setItems]);

  const retryItem = useCallback(async (docId, rounds, providerSettings = {}) => {
    const item = itemsRef.current.find((i) => i.docId === docId);
    if (!item) return;
    const { provider, model, thinkingBudget } = providerSettings;
    try {
      await axios.post(
        `${apiUrl}/reader/queue/${docId}`,
        {
          readerMode: 'auto_reader_v2',
          refinementRounds: rounds,
          ...(provider && { provider }),
          ...(model && { model }),
          ...(thinkingBudget !== undefined && { thinkingBudget }),
        },
        { headers: getAuthHeaders() },
      );
      setItems((prev) => prev.map((i) =>
        i.docId === docId ? { ...i, status: 'queued', error: null } : i
      ));
      pollNow();
    } catch (err) {
      console.error('[ObsidianBatch] retry failed', docId, err);
      setItems((prev) => prev.map((i) =>
        i.docId === docId
          ? { ...i, status: 'failed', error: err?.response?.data?.error || err.message || 'Retry failed' }
          : i
      ));
    }
  }, [apiUrl, getAuthHeaders, setItems, pollNow]);

  // Background poller
  useEffect(() => {
    pollNow();
    const id = setInterval(pollNow, POLL_MS);
    return () => clearInterval(id);
  }, [pollNow]);

  return { batchItems: items, addToBatch, clearCompleted, clearAll, retryItem, restoreItems, syncFromBackend, pollNow };
}
