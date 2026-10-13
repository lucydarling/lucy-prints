/**
 * Cropped photos in IndexedDB. localStorage holds about 10 real photos before
 * it fills; IndexedDB holds hundreds of MB (measured 2026-10-13: 400 MB of
 * crop-sized blobs written and read back on Chromium and WebKit). Each crop is
 * a Blob keyed `<product>/<slot key or extra id>`, or its data URL string
 * where Blobs can't be stored (WebKit private browsing refuses Blobs in
 * IndexedDB but takes strings; checked 2026-10-13). Browser only.
 */

export type StoredCrop = Blob | string;

const DB_NAME = "lucy-prints-crops";
const STORE = "crops";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
      req.onblocked = () => reject(new Error("IndexedDB open blocked"));
    }).catch((e) => {
      dbPromise = null; // allow a later retry
      throw e;
    });
  }
  return dbPromise;
}

/** True when IndexedDB can be opened here (false in some private modes). */
export async function cropDbAvailable(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
  });
}

/** Write crops in one transaction: all land, or none do (the promise rejects). */
export async function putCrops(entries: Array<[string, StoredCrop]>): Promise<void> {
  if (entries.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const [key, blob] of entries) store.put(blob, key);
  await done(tx);
}

/** Read crops; a key that isn't stored is simply absent from the result. */
export async function getCrops(keys: string[]): Promise<Map<string, StoredCrop>> {
  const found = new Map<string, StoredCrop>();
  if (keys.length === 0) return found;
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  for (const key of keys) {
    const req = store.get(key);
    req.onsuccess = () => {
      if (req.result instanceof Blob || typeof req.result === "string") found.set(key, req.result);
    };
  }
  await done(tx);
  return found;
}

export async function allCropKeys(): Promise<string[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const req = tx.objectStore(STORE).getAllKeys();
  await done(tx);
  return (req.result as IDBValidKey[]).map(String);
}

export async function deleteCrops(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const key of keys) store.delete(key);
  await done(tx);
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
