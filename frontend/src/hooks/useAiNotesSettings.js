import { useState, useEffect, useCallback } from 'react';

const LS_KEY = 'auto-researcher:aiNotesSettings';

export const PROVIDER_OPTIONS = [
  { value: 'claude-code', label: 'Claude (claude code)' },
  { value: 'codex-cli',   label: 'Codex CLI' },
  { value: 'gemini-cli',  label: 'Gemini CLI' },
];

export const MODEL_OPTIONS = {
  'claude-code': [
    { value: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6' },
    { value: 'claude-opus-4-6',            label: 'Claude Opus 4.6' },
    { value: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5' },
  ],
  'codex-cli': [
    { value: 'gpt-5.4-codex',       label: 'GPT-5.4-Codex' },
    { value: 'gpt-5.3-codex',       label: 'GPT-5.3-Codex' },
    { value: 'gpt-5.3-codex-spark', label: 'GPT-5.3-Codex-Spark' },
    { value: 'gpt-5.2-codex',       label: 'GPT-5.2-Codex' },
    { value: 'gpt-5.1-codex-max',   label: 'GPT-5.1-Codex-Max' },
    { value: 'gpt-5.2',             label: 'GPT-5.2' },
    { value: 'gpt-5.1-codex-mini',  label: 'GPT-5.1-Codex-Mini' },
  ],
  'gemini-cli': [
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro' },
  ],
};

export const THINKING_OPTIONS = [
  { value: 0,     label: 'None' },
  { value: 8000,  label: 'Standard (8k tokens)' },
  { value: 32000, label: 'Deep (32k tokens)' },
];

export const REASONING_OPTIONS = [
  { value: 'low',        label: 'Low' },
  { value: 'medium',     label: 'Medium' },
  { value: 'high',       label: 'High' },
  { value: 'extra-high', label: 'Extra High' },
];

export const DEFAULT_ROUNDS = [
  {
    name: '',
    prompt: '',
    input: '',
    type: 'created',
    sourceUrl: '',
  },
];

// Migrate old-format round { prompt } to new skill format
function migrateRound(r) {
  if (r && r.name && r.input !== undefined) return r; // already new format
  const prompt = (r && r.prompt) || '';
  return {
    name: 'Custom Skill',
    prompt,
    input: prompt,
    type: 'created',
    sourceUrl: '',
  };
}

const IDB_DB = 'auto-researcher-settings';
const IDB_STORE = 'kv';
const IDB_VAULT_KEY = 'obsidianVaultHandle';

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbGet(key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbSet(key, value) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

async function idbDel(key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

export function useAiNotesSettings() {
  const [rounds, setRoundsState] = useState(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed.refinementRounds) && parsed.refinementRounds.length > 0) {
          return parsed.refinementRounds.map(migrateRound);
        }
      }
    } catch (_) {}
    return DEFAULT_ROUNDS;
  });

  const [provider, setProviderState] = useState(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) return JSON.parse(stored).provider || 'codex-cli';
    } catch (_) {}
    return 'codex-cli';
  });

  const [model, setModelState] = useState(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) return JSON.parse(stored).model || 'gpt-5.3-codex';
    } catch (_) {}
    return 'gpt-5.3-codex';
  });

  const [thinkingBudget, setThinkingBudgetState] = useState(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) return JSON.parse(stored).thinkingBudget ?? 0;
    } catch (_) {}
    return 0;
  });

  const [reasoningEffort, setReasoningEffortState] = useState(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) return JSON.parse(stored).reasoningEffort || 'extra-high';
    } catch (_) {}
    return 'extra-high';
  });

  const [autoGenerate, setAutoGenerateState] = useState(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) return JSON.parse(stored).autoGenerate ?? false;
    } catch (_) {}
    return false;
  });

  const [vaultHandle, setVaultHandle] = useState(null);
  const [vaultName, setVaultName] = useState(null);
  const [vaultReady, setVaultReady] = useState(false);

  useEffect(() => {
    idbGet(IDB_VAULT_KEY)
      .then(async (handle) => {
        if (!handle) return;
        try {
          const perm = await handle.requestPermission({ mode: 'readwrite' });
          if (perm === 'granted') {
            setVaultHandle(handle);
            setVaultName(handle.name);
            setVaultReady(true);
          }
        } catch (_) {}
      })
      .catch(() => {});
  }, []);

  const saveRounds = useCallback((newRounds) => {
    setRoundsState(newRounds);
    try {
      const stored = localStorage.getItem(LS_KEY);
      const parsed = stored ? JSON.parse(stored) : {};
      localStorage.setItem(LS_KEY, JSON.stringify({ ...parsed, refinementRounds: newRounds }));
    } catch (_) {}
  }, []);

  const saveAutoGenerate = useCallback((value) => {
    setAutoGenerateState(value);
    try {
      const stored = localStorage.getItem(LS_KEY);
      const parsed = stored ? JSON.parse(stored) : {};
      localStorage.setItem(LS_KEY, JSON.stringify({ ...parsed, autoGenerate: value }));
    } catch (_) {}
  }, []);

  const saveProviderSettings = useCallback((newProvider, newModel, newThinkingBudget, newReasoningEffort) => {
    setProviderState(newProvider);
    setModelState(newModel);
    setThinkingBudgetState(newThinkingBudget);
    setReasoningEffortState(newReasoningEffort || 'extra-high');
    try {
      const stored = localStorage.getItem(LS_KEY);
      const parsed = stored ? JSON.parse(stored) : {};
      localStorage.setItem(LS_KEY, JSON.stringify({
        ...parsed,
        provider: newProvider,
        model: newModel,
        thinkingBudget: newThinkingBudget,
        reasoningEffort: newReasoningEffort || 'extra-high',
      }));
    } catch (_) {}
  }, []);

  const connectVault = useCallback(async () => {
    if (!('showDirectoryPicker' in window)) {
      throw new Error('File System Access API not supported in this browser. Use Chrome or Edge.');
    }
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await idbSet(IDB_VAULT_KEY, handle);
    setVaultHandle(handle);
    setVaultName(handle.name);
    setVaultReady(true);
  }, []);

  const disconnectVault = useCallback(async () => {
    await idbDel(IDB_VAULT_KEY);
    setVaultHandle(null);
    setVaultName(null);
    setVaultReady(false);
  }, []);

  const exportToVault = useCallback(
    async (title, notesContent) => {
      if (!vaultHandle) throw new Error('No vault connected');
      const safeName = title
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200);
      const fileName = `${safeName}.md`;
      const fileHandle = await vaultHandle.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(notesContent);
      await writable.close();
      return fileName;
    },
    [vaultHandle],
  );

  return {
    rounds,
    saveRounds,
    provider,
    model,
    thinkingBudget,
    reasoningEffort,
    autoGenerate,
    saveAutoGenerate,
    saveProviderSettings,
    vaultHandle,
    vaultName,
    vaultReady,
    connectVault,
    disconnectVault,
    exportToVault,
  };
}
