const IDB_DB = 'auto-researcher-client-workspaces';
const IDB_STORE = 'kv';
const DEFAULT_MANAGED_BLOCK_ID = 'AUTO_RESEARCHER_ARIS';

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

export function mergeManagedBlock(existingContent, incomingContent, blockId = DEFAULT_MANAGED_BLOCK_ID) {
  const startMarker = `<!-- ${blockId} START -->`;
  const endMarker = `<!-- ${blockId} END -->`;
  const blockBody = `${startMarker}\n${incomingContent}\n${endMarker}`;
  const pattern = new RegExp(
    `${startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    'm'
  );
  const trimmedExisting = String(existingContent || '').trimEnd();

  if (!trimmedExisting) {
    return `${blockBody}\n`;
  }
  if (pattern.test(trimmedExisting)) {
    return `${trimmedExisting.replace(pattern, blockBody)}\n`;
  }
  return `${trimmedExisting}\n\n${blockBody}\n`;
}

async function ensureWorkspacePermission(handle) {
  const permission = await handle.requestPermission({ mode: 'readwrite' });
  if (permission !== 'granted') {
    throw new Error('Folder access was not granted.');
  }
}

async function ensureDirectoryHandle(rootHandle, relativeDirectory) {
  let currentHandle = rootHandle;
  const segments = String(relativeDirectory || '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  for (const segment of segments) {
    currentHandle = await currentHandle.getDirectoryHandle(segment, { create: true });
  }

  return currentHandle;
}

async function writeWorkspaceTextFile(rootHandle, relativePath, content) {
  const segments = String(relativePath || '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const fileName = segments.pop();
  if (!fileName) {
    throw new Error('A relative file path is required.');
  }

  const directoryHandle = await ensureDirectoryHandle(rootHandle, segments.join('/'));
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function materializeProjectFiles(rootHandle, files = []) {
  if (!rootHandle) {
    throw new Error('Linked local workspace handle not found.');
  }

  await ensureWorkspacePermission(rootHandle);

  for (const file of Array.isArray(files) ? files : []) {
    if (!file?.path) continue;
    if (file.writeMode === 'managed_block') {
      const existingFile = await ensureDirectoryHandle(rootHandle, file.path.split('/').slice(0, -1).join('/'));
      const fileName = file.path.split('/').filter(Boolean).slice(-1)[0];
      const fileHandle = await existingFile.getFileHandle(fileName, { create: true });
      const existingContent = await fileHandle.getFile().then((current) => current.text()).catch(() => '');
      const merged = mergeManagedBlock(existingContent, String(file.content || ''), file.blockId || DEFAULT_MANAGED_BLOCK_ID);
      const writable = await fileHandle.createWritable();
      await writable.write(merged);
      await writable.close();
      continue;
    }

    await writeWorkspaceTextFile(rootHandle, file.path, String(file.content || ''));
  }
}

export async function clearWorkspaceContents(workspaceId) {
  const linked = await getWorkspaceLink(workspaceId);
  const handle = linked?.handle;
  if (!handle) {
    throw new Error('Linked local workspace handle not found.');
  }

  await ensureWorkspacePermission(handle);

  const removals = [];
  for await (const [name] of handle.entries()) {
    removals.push(handle.removeEntry(name, { recursive: true }));
  }
  await Promise.all(removals);
}

export async function linkClientWorkspace() {
  if (!('showDirectoryPicker' in window)) {
    throw new Error('File System Access API not supported in this browser. Use Chrome or Edge.');
  }
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await ensureWorkspacePermission(handle);
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
