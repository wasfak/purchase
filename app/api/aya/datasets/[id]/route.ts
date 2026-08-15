import { NextResponse } from "next/server";

import { hasFullAccess } from "@/lib/access";
import { connectDB } from "@/lib/db";
import { AyaDataset } from "@/lib/models/AyaDataset";

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

// GET /api/aya/datasets/[id] — one saved sheet with its rows, or null.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await hasFullAccess())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  await connectDB();
  const d = await AyaDataset.findOne({ key: id }).lean<LeanDataset | null>();
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

// DELETE /api/aya/datasets/[id] — remove one saved sheet.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await hasFullAccess())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  await connectDB();
  await AyaDataset.deleteOne({ key: id });
  return NextResponse.json({ ok: true });
}
