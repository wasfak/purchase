// Local-first storage for saved contracts (matched purchase lines), backed by
// IndexedDB so results live on this PC and survive reloads. Kept in its own
// database so it never mixes with the review page's saved sheets.
//
// As in the review store, column names are stored ONCE per contract and each
// row is a plain values-array aligned to those columns; row data lives in a
// single blob record keyed by id so listing stays cheap.

import type { Cell } from "@/lib/dataset";

const DB_NAME = "purchase-contracts";
const DB_VERSION = 1;
const STORE_META = "contracts"; // lightweight metadata, one record per contract
const STORE_ROWS = "rowdata"; // { id, rows } — the heavy row blob, keyed by id

export type ContractMeta = {
  id: string;
  name: string;
  savedAt: number; // epoch ms
  purchaseFileNames: string[];
  stockFileName: string;
  stockCodeCount: number;
  totalLineCount: number; // purchase lines parsed before filtering
  matchedLineCount: number; // lines kept (code found in stock)
  columns: string[];
};

export type Contract = ContractMeta & { rows: Cell[][] };

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Local storage isn't available in this browser."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_ROWS)) {
        db.createObjectStore(STORE_ROWS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Insert or update a contract (metadata + rows) and return its id. */
export async function saveContract(input: {
  id?: string;
  name: string;
  purchaseFileNames: string[];
  stockFileName: string;
  stockCodeCount: number;
  totalLineCount: number;
  columns: string[];
  rows: Cell[][];
}): Promise<string> {
  const db = await openDB();
  const id = input.id ?? crypto.randomUUID();
  const meta: ContractMeta = {
    id,
    name: input.name.trim() || "Untitled contract",
    savedAt: Date.now(),
    purchaseFileNames: input.purchaseFileNames,
    stockFileName: input.stockFileName,
    stockCodeCount: input.stockCodeCount,
    totalLineCount: input.totalLineCount,
    matchedLineCount: input.rows.length,
    columns: input.columns,
  };

  const tx = db.transaction([STORE_META, STORE_ROWS], "readwrite");
  tx.objectStore(STORE_META).put(meta);
  tx.objectStore(STORE_ROWS).put({ id, rows: input.rows });
  await txDone(tx);
  db.close();
  return id;
}

/** All saved contracts (metadata only), newest first. */
export async function listContracts(): Promise<ContractMeta[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_META, "readonly");
  const all = await reqResult(
    tx.objectStore(STORE_META).getAll() as IDBRequest<ContractMeta[]>,
  );
  db.close();
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

/** Load one saved contract with its rows, or null if it's gone. */
export async function loadContract(id: string): Promise<Contract | null> {
  const db = await openDB();
  const tx = db.transaction([STORE_META, STORE_ROWS], "readonly");
  const meta = await reqResult(
    tx.objectStore(STORE_META).get(id) as IDBRequest<ContractMeta | undefined>,
  );
  const blob = await reqResult(
    tx.objectStore(STORE_ROWS).get(id) as IDBRequest<{ rows: Cell[][] } | undefined>,
  );
  db.close();
  if (!meta) return null;
  return { ...meta, rows: blob?.rows ?? [] };
}

/** Remove a saved contract and its rows. */
export async function deleteContract(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([STORE_META, STORE_ROWS], "readwrite");
  tx.objectStore(STORE_META).delete(id);
  tx.objectStore(STORE_ROWS).delete(id);
  await txDone(tx);
  db.close();
}
