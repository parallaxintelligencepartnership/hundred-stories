// Browser save slot. IndexedDB first, localStorage as the fallback, both wrapped so a private window never throws.
const DB = 'hundred-stories';
const STORE = 'saves';
const KEY = 'autosave';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function writeSave(text: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(text, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return;
  } catch {
    // fall through to localStorage
  }
  try {
    localStorage.setItem(`${DB}:${KEY}`, text);
  } catch {
    throw new Error('The browser refused to store the save.');
  }
}

export async function readSave(): Promise<string | null> {
  try {
    const db = await openDb();
    const text = await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as string | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    if (text) return text;
  } catch {
    // fall through
  }
  try {
    return localStorage.getItem(`${DB}:${KEY}`);
  } catch {
    return null;
  }
}
