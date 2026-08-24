// Server-backed, PER-USER storage for the main "Review" tab.
//
// This is the durable replacement for the old browser-only IndexedDB store
// (lib/local-store.ts): every saved sheet, the current working session, and the
// cross-sheet code history live in MongoDB via the /api/review/* routes, scoped
// to the signed-in Clerk user. So a PC change / browser wipe no longer loses
// review data, and the same user sees their sheets on any device.
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
      res.status === 401
        ? "Please sign in to use your saved review data."
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export const serverReviewStore: ReviewStore = {
  async saveDataset(input) {
    const res = await fetch("/api/review/datasets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const { id } = await jsonOrThrow<{ id: string }>(res);
    return id;
  },

  async listDatasets() {
    const res = await fetch("/api/review/datasets", { cache: "no-store" });
    const { datasets } = await jsonOrThrow<{ datasets: SavedDatasetMeta[] }>(res);
    return datasets;
  },

  async loadDataset(id) {
    const res = await fetch(`/api/review/datasets/${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    const { dataset } = await jsonOrThrow<{ dataset: SavedDataset | null }>(res);
    return dataset;
  },

  async loadAllDatasets() {
    const res = await fetch("/api/review/datasets?full=1", { cache: "no-store" });
    const { datasets } = await jsonOrThrow<{ datasets: SavedDataset[] }>(res);
    return datasets;
  },

  async deleteDataset(id) {
    const res = await fetch(`/api/review/datasets/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    await jsonOrThrow(res);
  },

  async saveSession(session: WorkingSession) {
    const res = await fetch("/api/review/session", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session),
    });
    await jsonOrThrow(res);
  },

  async loadSession() {
    const res = await fetch("/api/review/session", { cache: "no-store" });
    const { session } = await jsonOrThrow<{ session: WorkingSession | null }>(res);
    return session;
  },

  async clearSession() {
    const res = await fetch("/api/review/session", { method: "DELETE" });
    await jsonOrThrow(res);
  },

  async getCodeStatuses() {
    const res = await fetch("/api/review/codes", { cache: "no-store" });
    const { codes } = await jsonOrThrow<{ codes: Record<string, CodeMeta> }>(res);
    return codes;
  },

  async clearCodeStatuses() {
    const res = await fetch("/api/review/codes", { method: "DELETE" });
    await jsonOrThrow(res);
  },

  async mergeCodeStatuses(updates) {
    const res = await fetch("/api/review/codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });
    await jsonOrThrow(res);
  },
};
