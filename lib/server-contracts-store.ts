// Server-backed, PER-USER storage for saved contracts.
//
// This is the durable replacement for the old browser-only IndexedDB store
// (lib/contracts-store.ts): saved contracts live in MongoDB via the
// /api/contracts routes, scoped to the signed-in Clerk user. Same function
// signatures as the local store, so the Contracts client uses it unchanged.

import type { Cell } from "@/lib/dataset";
import type { Contract, ContractMeta } from "@/lib/contracts-store";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const msg =
      res.status === 401
        ? "Please sign in to use your saved contracts."
        : `Request failed (${res.status})`;
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
export async function listContracts(): Promise<ContractMeta[]> {
  const res = await fetch("/api/contracts", { cache: "no-store" });
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
export async function loadAllContracts(): Promise<Contract[]> {
  const res = await fetch("/api/contracts?full=1", { cache: "no-store" });
  const { contracts } = await jsonOrThrow<{ contracts: Contract[] }>(res);
  return contracts;
}
