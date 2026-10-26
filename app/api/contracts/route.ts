import { NextResponse } from "next/server";
import { auth, clerkClient } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { ContractDoc } from "@/lib/models/ContractDoc";

export const runtime = "nodejs";

// Shape returned to the client — matches ContractMeta (+ optional rows).
type LeanContract = {
  ownerId: string;
  key: string;
  name?: string;
  savedAt: number;
  purchaseFileNames?: string[];
  stockFileName?: string;
  stockCodeCount?: number;
  totalLineCount?: number;
  matchedLineCount?: number;
  columns?: string[];
  rows?: unknown[];
  settings?: unknown;
  achieved?: number | null;
};

// Keep only the known ContractSettings fields, as strings.
function cleanSettings(v: unknown) {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const strs = (x: unknown) =>
    Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : [];
  return {
    companies: strs(o.companies),
    target: typeof o.target === "string" ? o.target : "",
    excludedSuppliers: strs(o.excludedSuppliers),
    excludedCodes: strs(o.excludedCodes),
  };
}

// Display names for the given Clerk user ids (full name, else email).
async function ownerNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  try {
    const client = await clerkClient();
    const { data } = await client.users.getUserList({
      userId: ids,
      limit: Math.min(ids.length, 500),
    });
    for (const u of data) {
      const name =
        [u.firstName, u.lastName].filter(Boolean).join(" ") ||
        u.primaryEmailAddress?.emailAddress ||
        u.emailAddresses[0]?.emailAddress ||
        "";
      out.set(u.id, name);
    }
  } catch {
    // Names are cosmetic — cards just show no owner.
  }
  return out;
}

function toMeta(d: LeanContract, userId: string, names?: Map<string, string>) {
  return {
    id: d.key,
    mine: d.ownerId === userId,
    ownerName: names?.get(d.ownerId) ?? "",
    name: d.name ?? "",
    savedAt: d.savedAt,
    purchaseFileNames: d.purchaseFileNames ?? [],
    stockFileName: d.stockFileName ?? "",
    stockCodeCount: d.stockCodeCount ?? 0,
    totalLineCount: d.totalLineCount ?? 0,
    matchedLineCount: d.matchedLineCount ?? 0,
    columns: d.columns ?? [],
    settings: cleanSettings(d.settings) ?? undefined,
    achieved: typeof d.achieved === "number" ? d.achieved : undefined,
  };
}

// GET /api/contracts        → EVERY user's saved-contract metadata (shared,
//                              view-only for non-owners; fast listing)
// GET /api/contracts?full=1 → the caller's own contracts WITH rows (backup)
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const full = new URL(request.url).searchParams.get("full") === "1";
  await connectDB();
  if (full) {
    const docs = await ContractDoc.find({ ownerId: userId })
      .sort({ savedAt: -1 })
      .lean<LeanContract[]>();
    return NextResponse.json({
      contracts: docs.map((d) => ({ ...toMeta(d, userId), rows: d.rows ?? [] })),
    });
  }
  const docs = await ContractDoc.find({}, { rows: 0 })
    .sort({ savedAt: -1 })
    .lean<LeanContract[]>();
  const names = await ownerNames([...new Set(docs.map((d) => d.ownerId))]);
  return NextResponse.json({
    contracts: docs.map((d) => toMeta(d, userId, names)),
  });
}

// POST /api/contracts — insert or update one contract (upsert by client id).
// Body: { id?, name, purchaseFileNames, stockFileName, stockCodeCount,
//         totalLineCount, columns, rows }
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.rows) || !Array.isArray(body.columns)) {
    return NextResponse.json({ error: "Invalid contract" }, { status: 400 });
  }

  const id: string =
    typeof body.id === "string" && body.id ? body.id : crypto.randomUUID();
  const rows = body.rows as unknown[];

  const doc = {
    ownerId: userId,
    key: id,
    name: (String(body.name ?? "").trim() || "Untitled contract") as string,
    savedAt: Date.now(),
    purchaseFileNames: Array.isArray(body.purchaseFileNames)
      ? body.purchaseFileNames
      : [],
    stockFileName: String(body.stockFileName ?? ""),
    stockCodeCount: Number(body.stockCodeCount) || 0,
    totalLineCount: Number(body.totalLineCount) || 0,
    matchedLineCount: rows.length,
    columns: body.columns as string[],
    rows,
    settings: cleanSettings(body.settings),
    achieved: Number.isFinite(Number(body.achieved))
      ? Number(body.achieved)
      : null,
  };

  await connectDB();
  // Contracts are visible to everyone but only the owner may overwrite one.
  const existing = await ContractDoc.findOne({ key: id }, { ownerId: 1 }).lean<{
    ownerId: string;
  } | null>();
  if (existing && existing.ownerId !== userId) {
    return NextResponse.json(
      { error: "Only the person who saved this contract can update it." },
      { status: 403 },
    );
  }
  await ContractDoc.updateOne(
    { ownerId: userId, key: id },
    { $set: doc },
    { upsert: true },
  );
  return NextResponse.json({ id });
}
