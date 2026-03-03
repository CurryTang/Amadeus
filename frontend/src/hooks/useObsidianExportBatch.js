import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

const LS_KEY = 'auto-researcher:obsidian-batch';
const POLL_MS = 20000;

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

  const setItems = useCallback((updater) => {
    setItemsRaw((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      persist(next);
      return next;
    });
  }, []);

  // addToBatch: docs is array of { id, title } that need notes generated
  const addToBatch = useCallback(async (docs, rounds) => {
    let added = 0;
    for (const doc of docs) {
      if (itemsRef.current.some((i) => i.docId === doc.id)) continue;
      try {
        await axios.post(
          `${apiUrl}/reader/queue/${doc.id}`,
          { readerMode: 'auto_reader_v2', refinementRounds: rounds },
          { headers: getAuthHeaders() },
        );
        setItems((prev) => {
          if (prev.some((i) => i.docId === doc.id)) return prev;
          return [...prev, { docId: doc.id, title: doc.title, status: 'queued', addedAt: Date.now() }];
        });
        added++;
      } catch (err) {
        console.error('[ObsidianBatch] failed to queue', doc.id, err);
      }
    }
    return added;
  }, [apiUrl, getAuthHeaders, setItems]);

  const clearCompleted = useCallback(() => {
    setItems((prev) => prev.filter((i) => i.status !== 'exported'));
  }, [setItems]);

  const retryItem = useCallback(async (docId, rounds) => {
    const item = items.find((i) => i.docId === docId);
    if (!item) return;
    try {
      await axios.post(
        `${apiUrl}/reader/queue/${docId}`,
        { readerMode: 'auto_reader_v2', refinementRounds: rounds },
        { headers: getAuthHeaders() },
      );
      setItems((prev) => prev.map((i) => i.docId === docId ? { ...i, status: 'queued' } : i));
    } catch (err) {
      console.error('[ObsidianBatch] retry failed', docId, err);
    }
  }, [apiUrl, getAuthHeaders, items, setItems]);

  // Background poller
  useEffect(() => {
    const pending = itemsRef.current.filter((i) => i.status === 'queued' || i.status === 'generating');
    if (pending.length === 0) return;

    const poll = async () => {
      for (const item of pending) {
        try {
          const docRes = await axios.get(`${apiUrl}/documents/${item.docId}`, { headers: getAuthHeaders() });
          const ps = docRes.data?.processingStatus || docRes.data?.processing_status || '';
          if (ps === 'completed') {
            try {
              const notesRes = await axios.get(
                `${apiUrl}/documents/${item.docId}/notes?inline=true`,
                { headers: getAuthHeaders() },
              );
              const content = notesRes.data?.content || notesRes.data?.notes || '';
              await exportRef.current(item.title, typeof content === 'string' ? content : JSON.stringify(content));
              setItems((prev) => prev.map((i) => i.docId === item.docId ? { ...i, status: 'exported' } : i));
            } catch (exportErr) {
              console.error('[ObsidianBatch] vault write failed', item.docId, exportErr);
              setItems((prev) => prev.map((i) => i.docId === item.docId ? { ...i, status: 'failed' } : i));
            }
          } else if (ps === 'failed' || ps === 'error') {
            setItems((prev) => prev.map((i) => i.docId === item.docId ? { ...i, status: 'failed' } : i));
          } else {
            setItems((prev) => prev.map((i) =>
              i.docId === item.docId && i.status === 'queued' ? { ...i, status: 'generating' } : i
            ));
          }
        } catch (err) {
          console.error('[ObsidianBatch] poll error', item.docId, err);
        }
      }
    };

    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [apiUrl, getAuthHeaders, setItems]);

  return { batchItems: items, addToBatch, clearCompleted, retryItem };
}
