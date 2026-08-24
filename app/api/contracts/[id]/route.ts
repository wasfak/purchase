import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { ContractDoc } from "@/lib/models/ContractDoc";

export const runtime = "nodejs";

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

// GET /api/contracts/[id] — one saved contract with its rows, or null.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await connectDB();
  const d = await ContractDoc.findOne({
    ownerId: userId,
    key: id,
  }).lean<LeanContract | null>();
  if (!d) return NextResponse.json({ contract: null });
  return NextResponse.json({
    contract: {
      id: d.key,
      name: d.name ?? "",
      savedAt: d.savedAt,
      purchaseFileNames: d.purchaseFileNames ?? [],
      stockFileName: d.stockFileName ?? "",
      stockCodeCount: d.stockCodeCount ?? 0,
      totalLineCount: d.totalLineCount ?? 0,
      matchedLineCount: d.matchedLineCount ?? 0,
      columns: d.columns ?? [],
      rows: d.rows ?? [],
    },
  });
}

// DELETE /api/contracts/[id] — remove one saved contract.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await connectDB();
  await ContractDoc.deleteOne({ ownerId: userId, key: id });
  return NextResponse.json({ ok: true });
}
