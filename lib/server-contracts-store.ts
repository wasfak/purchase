// Server-backed, PER-USER storage for saved contracts.
//
// This is the durable replacement for the old browser-only IndexedDB store
// (lib/contracts-store.ts): saved contracts live in MongoDB via the
// /api/contracts routes, scoped to the signed-in Clerk user. Same function
// signatures as the local store, so the Contracts client uses it unchanged.

import type { Cell } from "@/lib/dataset";
import type {
  Contract,
  ContractMeta,
  ContractSettings,
} from "@/lib/contracts-store";

/** Which contracts tool a contract belongs to; each lists only its own. */
export type ContractKind = "normal" | "cosmo";

const kindQuery = (kind: ContractKind) => (kind === "cosmo" ? "kind=cosmo" : "");

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg =
      res.status === 401
        ? "Please sign in to use your saved contracts."
        : `Request failed (${res.status})`;
    if (res.status === 403) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (body?.error) msg = body.error;
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
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
  settings?: ContractSettings;
  achieved?: number;
  dataThrough?: string;
  kind?: ContractKind;
}): Promise<string> {
  const res = await fetch("/api/contracts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const { id } = await jsonOrThrow<{ id: string }>(res);
  return id;
}

/** All saved contracts (metadata only), newest first. */
export async function listContracts(
  kind: ContractKind = "normal",
): Promise<ContractMeta[]> {
  const q = kindQuery(kind);
  const res = await fetch(`/api/contracts${q ? `?${q}` : ""}`, {
    cache: "no-store",
  });
  const { contracts } = await jsonOrThrow<{ contracts: ContractMeta[] }>(res);
  return contracts;
}

/** Load one saved contract with its rows, or null if it's gone. */
export async function loadContract(id: string): Promise<Contract | null> {
  const res = await fetch(`/api/contracts/${encodeURIComponent(id)}`, {
    cache: "no-store",
  });
  const { contract } = await jsonOrThrow<{ contract: Contract | null }>(res);
  return contract;
}

/** Remove a saved contract and its rows. */
export async function deleteContract(id: string): Promise<void> {
  const res = await fetch(`/api/contracts/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await jsonOrThrow(res);
}

/** Every saved contract WITH its rows, in one request (used by backup export). */
export async function loadAllContracts(
  kind: ContractKind = "normal",
): Promise<Contract[]> {
  const q = kindQuery(kind);
  const res = await fetch(`/api/contracts?full=1${q ? `&${q}` : ""}`, {
    cache: "no-store",
  });
  const { contracts } = await jsonOrThrow<{ contracts: Contract[] }>(res);
  return contracts;
}
