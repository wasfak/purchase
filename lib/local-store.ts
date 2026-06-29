// Local-first storage for reviewed spreadsheets, backed by IndexedDB so the
// data lives on this PC, survives reloads, and can hold large sheets.
//
// Storage is kept compact ("smart and saving"): column names are stored ONCE
// per dataset, and every row is a plain values-array aligned to those columns
// instead of repeating the keys on each row. Row data for a dataset is stored
// as a single blob record, so listing saved sheets stays cheap and loading one
// reads a single record.

import type { Cell } from "@/lib/dataset";

const DB_NAME = "purchase-review";
const DB_VERSION = 1;
const STORE_META = "datasets"; // lightweight metadata, one record per sheet
const STORE_ROWS = "rowdata"; // { id, rows } — the heavy row blob, keyed by id

export type SavedRow = {
  /** Cell values aligned to the dataset's `columns`. */
  values: Cell[];
  /** Whether the user marked this row complete (the yellow rows). */
  completed: boolean;
  /** Whether the user marked this row ignored (struck through / dimmed). */
  ignored?: boolean;
};

export type SavedDatasetMeta = {
  id: string;
  name: string;
  fileName: string;
  savedAt: number; // epoch ms
  columns: string[];
  numericColumns: string[];
  rowCount: number;
  completedCount: number;
  ignoredCount: number;
};

export type SavedDataset = SavedDatasetMeta & { rows: SavedRow[] };

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

/** Insert or update a dataset (metadata + rows) and return its id. */
export async function saveDataset(input: {
  id?: string;
  name: string;
  fileName: string;
  columns: string[];
  numericColumns: string[];
  rows: SavedRow[];
}): Promise<string> {
  const db = await openDB();
  const id = input.id ?? crypto.randomUUID();
  const meta: SavedDatasetMeta = {
    id,
    name: input.name.trim() || input.fileName || "Untitled sheet",
    fileName: input.fileName,
    savedAt: Date.now(),
    columns: input.columns,
    numericColumns: input.numericColumns,
    rowCount: input.rows.length,
    completedCount: input.rows.filter((r) => r.completed).length,
    ignoredCount: input.rows.filter((r) => r.ignored).length,
  };

  const tx = db.transaction([STORE_META, STORE_ROWS], "readwrite");
  tx.objectStore(STORE_META).put(meta);
  tx.objectStore(STORE_ROWS).put({ id, rows: input.rows });
  await txDone(tx);
  db.close();
  return id;
}

/** All saved sheets (metadata only), newest first. */
export async function listDatasets(): Promise<SavedDatasetMeta[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_META, "readonly");
  const all = await reqResult(
    tx.objectStore(STORE_META).getAll() as IDBRequest<SavedDatasetMeta[]>,
  );
  db.close();
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

/** Load one saved sheet with its rows, or null if it's gone. */
export async function loadDataset(id: string): Promise<SavedDataset | null> {
  const db = await openDB();
  const tx = db.transaction([STORE_META, STORE_ROWS], "readonly");
  const meta = await reqResult(
    tx.objectStore(STORE_META).get(id) as IDBRequest<SavedDatasetMeta | undefined>,
  );
  const blob = await reqResult(
    tx.objectStore(STORE_ROWS).get(id) as IDBRequest<{ rows: SavedRow[] } | undefined>,
  );
  db.close();
  if (!meta) return null;
  return { ...meta, rows: blob?.rows ?? [] };
}

/** Remove a saved sheet and its rows. */
export async function deleteDataset(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([STORE_META, STORE_ROWS], "readwrite");
  tx.objectStore(STORE_META).delete(id);
  tx.objectStore(STORE_ROWS).delete(id);
  await txDone(tx);
  db.close();
}
