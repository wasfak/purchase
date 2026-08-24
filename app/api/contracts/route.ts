import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { ContractDoc } from "@/lib/models/ContractDoc";

export const runtime = "nodejs";

// Shape returned to the client — matches ContractMeta (+ optional rows).
type LeanContract = {
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
};

function toMeta(d: LeanContract) {
  return {
    id: d.key,
    name: d.name ?? "",
    savedAt: d.savedAt,
    purchaseFileNames: d.purchaseFileNames ?? [],
    stockFileName: d.stockFileName ?? "",
    stockCodeCount: d.stockCodeCount ?? 0,
    totalLineCount: d.totalLineCount ?? 0,
    matchedLineCount: d.matchedLineCount ?? 0,
    columns: d.columns ?? [],
  };
}

// GET /api/contracts        → saved-contract metadata only (fast listing)
// GET /api/contracts?full=1 → every saved contract WITH its rows (backup export)
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const full = new URL(request.url).searchParams.get("full") === "1";
  await connectDB();
  const docs = await ContractDoc.find(
    { ownerId: userId },
    full ? {} : { rows: 0 },
  )
    .sort({ savedAt: -1 })
    .lean<LeanContract[]>();
  return NextResponse.json({
    contracts: docs.map((d) =>
      full ? { ...toMeta(d), rows: d.rows ?? [] } : toMeta(d),
    ),
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
  };

  await connectDB();
  await ContractDoc.updateOne(
    { ownerId: userId, key: id },
    { $set: doc },
    { upsert: true },
  );
  return NextResponse.json({ id });
}
