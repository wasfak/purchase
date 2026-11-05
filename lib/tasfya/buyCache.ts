import type { PurchaseLine } from "./types";

// On-this-PC storage for the large buy history file uploaded on the خصومات page.
// It can be far bigger than a month's Buy file, so like the stock file it stays
// in the browser's IndexedDB; only the lines matching reviewed codes go to the
// server. Uploading a new file replaces it.

const DB_NAME = "purchase-buy-history";
const STORE = "buy";
const KEY = "current";

export interface CachedBuy {
  fileName: string;
  savedAt: number;
  lines: PurchaseLine[];
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveBuy(
  fileName: string,
  lines: PurchaseLine[],
): Promise<CachedBuy> {
  const db = await openDB();
  const data: CachedBuy = { fileName, savedAt: Date.now(), lines };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(data, KEY);
    tx.oncomplete = () => resolve(data);
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadBuy(): Promise<CachedBuy | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as CachedBuy) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}
