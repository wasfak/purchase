import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { ReviewDataset } from "@/lib/models/ReviewDataset";

export const runtime = "nodejs";

type LeanDataset = {
  key: string;
  name?: string;
  fileName?: string;
  savedAt: number;
  uploadedAt?: number;
  columns?: string[];
  numericColumns?: string[];
  rows?: unknown[];
  rowCount?: number;
  completedCount?: number;
  ignoredCount?: number;
};

// GET /api/review/datasets/[id] — one saved sheet with its rows, or null.
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
  const d = await ReviewDataset.findOne({
    ownerId: userId,
    key: id,
  }).lean<LeanDataset | null>();
  if (!d) return NextResponse.json({ dataset: null });
  return NextResponse.json({
    dataset: {
      id: d.key,
      name: d.name ?? "",
      fileName: d.fileName ?? "",
      savedAt: d.savedAt,
      uploadedAt: d.uploadedAt,
      columns: d.columns ?? [],
      numericColumns: d.numericColumns ?? [],
      rows: d.rows ?? [],
      rowCount: d.rowCount ?? 0,
      completedCount: d.completedCount ?? 0,
      ignoredCount: d.ignoredCount ?? 0,
    },
  });
}

// DELETE /api/review/datasets/[id] — remove one saved sheet.
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
  await ReviewDataset.deleteOne({ ownerId: userId, key: id });
  return NextResponse.json({ ok: true });
}
