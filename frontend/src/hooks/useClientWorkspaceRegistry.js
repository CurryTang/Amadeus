const IDB_DB = 'auto-researcher-client-workspaces';
const IDB_STORE = 'kv';

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, 1);
    req.onupgradeneeded = (event) => {
      event.target.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = (event) => resolve(event.target.result);
    req.onerror = (event) => reject(event.target.error);
  });
}

async function idbGet(key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = (event) => reject(event.target.error);
  });
}

async function idbSet(key, value) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = (event) => reject(event.target.error);
  });
}

async function idbDel(key) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = (event) => reject(event.target.error);
  });
}

function createWorkspaceId() {
  if (globalThis.crypto?.randomUUID) return `cw_${globalThis.crypto.randomUUID()}`;
  return `cw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveWorkspaceLink(workspaceId, handle, meta = {}) {
  if (!workspaceId) throw new Error('workspaceId is required');
  await idbSet(workspaceId, {
    handle,
    meta: {
      ...meta,
      linkedAt: new Date().toISOString(),
    },
  });
}

export async function getWorkspaceLink(workspaceId) {
  if (!workspaceId) return null;
  return idbGet(workspaceId);
}

export async function removeWorkspaceLink(workspaceId) {
  if (!workspaceId) return;
  await idbDel(workspaceId);
}

export async function linkClientWorkspace() {
  if (!('showDirectoryPicker' in window)) {
    throw new Error('File System Access API not supported in this browser. Use Chrome or Edge.');
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  const permission = await handle.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') {
    throw new Error('Folder access was not granted.');
  }
  const workspaceId = createWorkspaceId();
  const meta = {
    displayName: handle.name || 'Linked workspace',
  };
  await saveWorkspaceLink(workspaceId, handle, meta);
  return {
    workspaceId,
    handle,
    meta,
  };
}
