const DATABASE_NAME = 'apka-planning-drafts';
const STORE_NAME = 'drafts';
let opening: Promise<IDBDatabase> | null = null;
const writes = new Map<string, Promise<void>>();

const openDatabase = (): Promise<IDBDatabase> => {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('INDEXED_DB_UNAVAILABLE')); return; }
    const request = indexedDB.open(DATABASE_NAME, 1);
    let settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('INDEXED_DB_UNAVAILABLE'));
    };
    const timer = setTimeout(fail, 3000);
    request.onerror = fail;
    request.onblocked = fail;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      clearTimeout(timer);
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
  }).catch(error => { opening = null; throw error; });
  return opening;
};

const readIndexed = async (key: string) => {
  const db = await openDatabase();
  return new Promise<string | null>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
    request.onerror = () => reject(request.error);
  });
};

const writeIndexed = async (key: string, value: string | null) => {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    if (value === null) store.delete(key);
    else store.put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('CACHE_WRITE_ABORTED'));
  });
};

const enqueue = (key: string, operation: () => Promise<void>) => {
  const pending = (writes.get(key) ?? Promise.resolve()).catch(() => undefined).then(operation);
  writes.set(key, pending);
  const cleanup = () => { if (writes.get(key) === pending) writes.delete(key); };
  void pending.then(cleanup, cleanup);
  return pending;
};

export const readPlanningDraftCache = async (key: string): Promise<string | null> => {
  await writes.get(key)?.catch(() => undefined);
  try {
    const cached = await readIndexed(key);
    if (cached !== null) return cached;
  } catch { /* Fall back to older localStorage backups. */ }
  return window.localStorage.getItem(key);
};

export const writePlanningDraftCache = (key: string, value: string) => enqueue(key, async () => {
  try {
    await writeIndexed(key, value);
  } catch {
    window.localStorage.setItem(key, value);
    return;
  }
  // Remove only the migrated key, and only after the larger backup committed.
  try { window.localStorage.removeItem(key); } catch { /* IndexedDB already holds the backup. */ }
});

export const removePlanningDraftCache = (key: string) => enqueue(key, async () => {
  try { await writeIndexed(key, null); } catch { /* The fallback may still be available. */ }
  window.localStorage.removeItem(key);
});
