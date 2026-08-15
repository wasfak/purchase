import { NextResponse } from "next/server";

import { hasFullAccess } from "@/lib/access";
import { connectDB } from "@/lib/db";
import { AyaDataset } from "@/lib/models/AyaDataset";

export const runtime = "nodejs";

// Shape returned to the client — matches SavedDatasetMeta (+ optional rows).
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

function toMeta(d: LeanDataset, withRows: boolean) {
  const meta = {
    id: d.key,
    name: d.name ?? "",
    fileName: d.fileName ?? "",
    savedAt: d.savedAt,
    uploadedAt: d.uploadedAt,
    columns: d.columns ?? [],
    numericColumns: d.numericColumns ?? [],
    rowCount: d.rowCount ?? 0,
    completedCount: d.completedCount ?? 0,
    ignoredCount: d.ignoredCount ?? 0,
  };
  return withRows ? { ...meta, rows: d.rows ?? [] } : meta;
}

// GET /api/aya/datasets        → saved-sheet metadata only (fast listing)
// GET /api/aya/datasets?full=1 → every saved sheet WITH its rows (code search)
export async function GET(request: Request) {
  if (!(await hasFullAccess())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const full = new URL(request.url).searchParams.get("full") === "1";
  await connectDB();
  const docs = await AyaDataset.find({}, full ? {} : { rows: 0 })
    .sort({ savedAt: -1 })
    .lean<LeanDataset[]>();
  return NextResponse.json({ datasets: docs.map((d) => toMeta(d, full)) });
}

type SavedRow = {
  values: unknown[];
  completed?: boolean;
  ignored?: boolean;
  statusAt?: number;
  category?: string;
};

// POST /api/aya/datasets — insert or update one sheet (upsert by client id).
// Body: { id?, name, fileName, columns, numericColumns, rows, uploadedAt? }
export async function POST(request: Request) {
  if (!(await hasFullAccess())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.rows) || !Array.isArray(body.columns)) {
    return NextResponse.json({ error: "Invalid dataset" }, { status: 400 });
  }

  const id: string =
    typeof body.id === "string" && body.id ? body.id : crypto.randomUUID();
  const now = Date.now();
  const rows: SavedRow[] = body.rows;

  const doc = {
    key: id,
    name: (String(body.name ?? "").trim() || body.fileName || "Untitled sheet") as string,
    fileName: String(body.fileName ?? ""),
    savedAt: now,
    uploadedAt: typeof body.uploadedAt === "number" ? body.uploadedAt : now,
    columns: body.columns as string[],
    numericColumns: Array.isArray(body.numericColumns) ? body.numericColumns : [],
    rows,
    rowCount: rows.length,
    completedCount: rows.filter((r) => r.completed).length,
    ignoredCount: rows.filter((r) => r.ignored).length,
  };

  await connectDB();
  await AyaDataset.updateOne({ key: id }, { $set: doc }, { upsert: true });
  return NextResponse.json({ id });
}
