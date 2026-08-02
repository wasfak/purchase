import type { StockItem } from "./types";

// Client-side (on-this-PC) storage for the store-wide stock file. The stock
// export is large and machine-local, so — unlike the pos/buy files (MongoDB) —
// it lives in IndexedDB in the browser and is never sent to the server. Only one
// stock file is kept; uploading a new one replaces it.

const DB_NAME = "purchase-tasfya";
const STORE = "stock";
const KEY = "current";

export interface CachedStock {
  fileName: string;
  savedAt: number;
  items: StockItem[];
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveStock(
  fileName: string,
  items: StockItem[],
): Promise<void> {
  const db = await openDB();
  const data: CachedStock = { fileName, savedAt: Date.now(), items };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(data, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadStock(): Promise<CachedStock | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as CachedStock) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function clearStock(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
