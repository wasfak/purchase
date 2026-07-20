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
const DB_VERSION = 2;
const STORE_META = "datasets"; // lightweight metadata, one record per sheet
const STORE_ROWS = "rowdata"; // { id, rows } — the heavy row blob, keyed by id
const STORE_SESSION = "session"; // the current in-progress sheet (single record)
const SESSION_KEY = "current";

export type SavedRow = {
  /** Cell values aligned to the dataset's `columns`. */
  values: Cell[];
  /** Whether the user marked this row complete (the yellow rows). */
  completed: boolean;
  /** Whether the user marked this row ignored (struck through / dimmed). */
  ignored?: boolean;
  /** Epoch ms of when this row was marked done/ignored, if it was. */
  statusAt?: number;
  /** User-picked category for this row (pharma / sena / sherktha). */
  category?: string;
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
      if (!db.objectStoreNames.contains(STORE_SESSION)) {
        db.createObjectStore(STORE_SESSION, { keyPath: "id" });
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

// The current working sheet, auto-persisted so a page reload (or a dev-server
// refresh) picks up exactly where the user left off — no re-uploading.
export type WorkingSession = {
  fileName: string | null;
  name: string;
  columns: string[];
  rows: Record<string, Cell>[];
  completed: string[];
  ignored: string[];
  currentId: string | null;
  /** Per-row-id epoch ms of when it was marked done/ignored. */
  statusAt?: [string, number][];
  /** Per-row-id category pick (pharma / sena / sherktha). */
  category?: [string, string][];
};

export async function saveSession(session: WorkingSession): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_SESSION, "readwrite");
  tx.objectStore(STORE_SESSION).put({ id: SESSION_KEY, ...session });
  await txDone(tx);
  db.close();
}

export async function loadSession(): Promise<WorkingSession | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_SESSION, "readonly");
  const rec = await reqResult(
    tx.objectStore(STORE_SESSION).get(SESSION_KEY) as IDBRequest<
      (WorkingSession & { id: string }) | undefined
    >,
  );
  db.close();
  if (!rec) return null;
  const { id: _id, ...session } = rec;
  return session;
}

export async function clearSession(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_SESSION, "readwrite");
  tx.objectStore(STORE_SESSION).delete(SESSION_KEY);
  await txDone(tx);
  db.close();
}

// A running history of each code across every sheet, so a newly uploaded sheet
// can flag codes that were already ordered (done) or skipped (ignored) before,
// remember WHEN that happened, and carry over the code's category. Stored as one
// record in the session store.
const CODES_KEY = "codes";
export type CodeStatus = "done" | "ignored";

/** What we remember about one code across sheets. */
export type CodeMeta = {
  status?: CodeStatus;
  /** Epoch ms of when the status was first set. */
  at?: number;
  /** The code's category (pharma / sena / sherktha). */
  category?: string;
};

// Older records stored the bare status string per code; newer ones store a
// CodeMeta object. Accept both on read.
type StoredCode = CodeStatus | CodeMeta;
type CodesRecord = { id: string; map: Record<string, StoredCode> };

const normalizeMeta = (v: StoredCode | undefined): CodeMeta =>
  v == null ? {} : typeof v === "string" ? { status: v } : v;

const isEmptyMeta = (m: CodeMeta) => !m.status && !m.category;

export async function getCodeStatuses(): Promise<Record<string, CodeMeta>> {
  const db = await openDB();
  const tx = db.transaction(STORE_SESSION, "readonly");
  const rec = await reqResult(
    tx.objectStore(STORE_SESSION).get(CODES_KEY) as IDBRequest<
      CodesRecord | undefined
    >,
  );
  db.close();
  const out: Record<string, CodeMeta> = {};
  for (const [code, v] of Object.entries(rec?.map ?? {})) {
    out[code] = normalizeMeta(v);
  }
  return out;
}

/** Wipe the entire cross-sheet code history — used to start a fresh baseline. */
export async function clearCodeStatuses(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_SESSION, "readwrite");
  tx.objectStore(STORE_SESSION).delete(CODES_KEY);
  await txDone(tx);
  db.close();
}

/**
 * Merge per-code updates into the history. Each update is field-merged onto the
 * existing entry; passing `null`, or an entry that ends up with neither a status
 * nor a category, removes that code.
 */
export async function mergeCodeStatuses(
  updates: Record<string, CodeMeta | null>,
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_SESSION, "readwrite");
  const store = tx.objectStore(STORE_SESSION);
  const rec = await reqResult(
    store.get(CODES_KEY) as IDBRequest<CodesRecord | undefined>,
  );
  const map = rec?.map ?? {};
  for (const [code, update] of Object.entries(updates)) {
    if (update === null) {
      delete map[code];
      continue;
    }
    const merged: CodeMeta = { ...normalizeMeta(map[code]), ...update };
    if (isEmptyMeta(merged)) delete map[code];
    else map[code] = merged;
  }
  store.put({ id: CODES_KEY, map });
  await txDone(tx);
  db.close();
}
