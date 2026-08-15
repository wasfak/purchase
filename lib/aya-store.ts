// Storage for the "Review Aya" tab.
//
// Unlike the main Review tab (which is local-only, in the browser's IndexedDB),
// Review Aya is a SHARED, SERVER-BACKED workspace: every saved sheet, the
// current working session, and the cross-sheet code history live in MongoDB via
// the /api/aya/* routes. That way a sheet uploaded on one device (e.g. the PC)
// is visible to anyone who opens Review Aya on any other device — the data is
// the same everywhere and preserved. It is NOT scoped per user: it's a single
// shared space that all full-access users see identically.
//
// It implements the exact same ReviewStore interface as the local store, so the
// shared ReviewWorkspace component uses it with no changes.

import type {
  CodeMeta,
  ReviewStore,
  SavedDataset,
  SavedDatasetMeta,
  WorkingSession,
} from "@/lib/local-store";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const msg =
      res.status === 403
        ? "You don't have access to the shared Review Aya data."
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const ayaReviewStore: ReviewStore = {
  async saveDataset(input) {
    const res = await fetch("/api/aya/datasets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const { id } = await jsonOrThrow<{ id: string }>(res);
    return id;
  },

  async listDatasets() {
    const res = await fetch("/api/aya/datasets", { cache: "no-store" });
    const { datasets } = await jsonOrThrow<{ datasets: SavedDatasetMeta[] }>(res);
    return datasets;
  },

  async loadDataset(id) {
    const res = await fetch(`/api/aya/datasets/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    const { dataset } = await jsonOrThrow<{ dataset: SavedDataset | null }>(res);
    return dataset;
  },

  async loadAllDatasets() {
    const res = await fetch("/api/aya/datasets?full=1", { cache: "no-store" });
    const { datasets } = await jsonOrThrow<{ datasets: SavedDataset[] }>(res);
    return datasets;
  },

  async deleteDataset(id) {
    const res = await fetch(`/api/aya/datasets/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await jsonOrThrow(res);
  },

  async saveSession(session: WorkingSession) {
    const res = await fetch("/api/aya/session", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session),
    });
    await jsonOrThrow(res);
  },

  async loadSession() {
    const res = await fetch("/api/aya/session", { cache: "no-store" });
    const { session } = await jsonOrThrow<{ session: WorkingSession | null }>(res);
    return session;
  },

  async clearSession() {
    const res = await fetch("/api/aya/session", { method: "DELETE" });
    await jsonOrThrow(res);
  },

  async getCodeStatuses() {
    const res = await fetch("/api/aya/codes", { cache: "no-store" });
    const { codes } = await jsonOrThrow<{ codes: Record<string, CodeMeta> }>(res);
    return codes;
  },

  async clearCodeStatuses() {
    const res = await fetch("/api/aya/codes", { method: "DELETE" });
    await jsonOrThrow(res);
  },

  async mergeCodeStatuses(updates) {
    const res = await fetch("/api/aya/codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });
    await jsonOrThrow(res);
  },
};
