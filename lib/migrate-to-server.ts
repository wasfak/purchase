// One-time, NON-DESTRUCTIVE migration of the old browser-local (IndexedDB) data
// up to the server (MongoDB Atlas), so nothing is lost when the PC changes.
//
// Safety guarantees:
//  * It only ever COPIES: it reads from IndexedDB and writes to the server. It
//    never deletes the local copy — that stays behind as a fallback.
//  * It runs at most once per browser (guarded by a localStorage flag), so it
//    can't clobber later server-side edits by re-uploading stale local data.
//  * A partial/failed run does NOT set the flag, so it retries next load.
//
// After migration the app reads/writes the server stores; the local IndexedDB
// data is left intact and can be cleared manually once you've confirmed the
// cloud copy on this and another device.

import { defaultReviewStore } from "@/lib/local-store";
import { serverReviewStore } from "@/lib/server-review-store";
import {
  listContracts as listLocalContracts,
  loadContract as loadLocalContract,
} from "@/lib/contracts-store";
import { saveContract as saveServerContract } from "@/lib/server-contracts-store";

const REVIEW_FLAG = "review-migrated-to-server-v1";
const CONTRACTS_FLAG = "contracts-migrated-to-server-v1";

function done(flag: string): boolean {
  try {
    return localStorage.getItem(flag) === "1";
  } catch {
    return false;
  }
}

function markDone(flag: string) {
  try {
    localStorage.setItem(flag, "1");
  } catch {
    // No localStorage — the migration will simply run again next time, which is
    // harmless (it upserts by id).
  }
}

export type MigrationResult = { sheets: number; contracts: number };

/**
 * Copy the local Review data (saved sheets + working session + code history) to
 * the server for the signed-in user. Idempotent and non-destructive. Returns
 * how many sheets were copied (0 if already migrated or nothing local).
 */
export async function migrateReviewToServer(): Promise<number> {
  if (done(REVIEW_FLAG)) return 0;

  // Pull everything local in one go.
  const [datasets, codes, session] = await Promise.all([
    defaultReviewStore.loadAllDatasets(),
    defaultReviewStore.getCodeStatuses(),
    defaultReviewStore.loadSession(),
  ]);

  // Upload each saved sheet, preserving its id + upload time so re-runs upsert
  // in place rather than duplicating.
  for (const ds of datasets) {
    await serverReviewStore.saveDataset({
      id: ds.id,
      name: ds.name,
      fileName: ds.fileName,
      columns: ds.columns,
      numericColumns: ds.numericColumns,
      rows: ds.rows,
      uploadedAt: ds.uploadedAt,
    });
  }

  // Carry over the cross-sheet code history and the in-progress working sheet.
  if (codes && Object.keys(codes).length > 0) {
    await serverReviewStore.mergeCodeStatuses(codes);
  }
  if (session && session.columns.length > 0) {
    await serverReviewStore.saveSession(session);
  }

  markDone(REVIEW_FLAG);
  return datasets.length;
}

/**
 * Copy the local saved contracts to the server for the signed-in user.
 * Idempotent and non-destructive. Returns how many contracts were copied.
 */
export async function migrateContractsToServer(): Promise<number> {
  if (done(CONTRACTS_FLAG)) return 0;

  const metas = await listLocalContracts();
  let copied = 0;
  for (const meta of metas) {
    const full = await loadLocalContract(meta.id);
    if (!full) continue;
    await saveServerContract({
      id: full.id,
      name: full.name,
      purchaseFileNames: full.purchaseFileNames,
      stockFileName: full.stockFileName,
      stockCodeCount: full.stockCodeCount,
      totalLineCount: full.totalLineCount,
      columns: full.columns,
      rows: full.rows,
    });
    copied++;
  }

  markDone(CONTRACTS_FLAG);
  return copied;
}
