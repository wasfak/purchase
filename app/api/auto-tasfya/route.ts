import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { AutoTasfyaUpload } from "@/lib/models/AutoTasfyaUpload";

// The three uploadable file slots.
type Kind = "pos" | "buy" | "stock";
const KINDS: Kind[] = ["pos", "buy", "stock"];
const isKind = (v: unknown): v is Kind =>
  typeof v === "string" && (KINDS as string[]).includes(v);

const isMonth = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}$/.test(v);

const str = (v: unknown): string => String(v ?? "").trim();
const numOf = (v: unknown): number => Number(v) || 0;

// Coerce one uploaded row into the shape its slot stores, dropping anything
// unknown so a malformed client payload can't inject arbitrary fields.
function sanitizeRow(kind: Kind, input: unknown): Record<string, unknown> {
  const o = (input ?? {}) as Record<string, unknown>;
  if (kind === "pos") {
    const items = Array.isArray(o.items) ? o.items : [];
    return {
      orderNumber: str(o.orderNumber),
      supplier: str(o.supplier),
      date: str(o.date),
      items: items.map((it) => {
        const r = (it ?? {}) as Record<string, unknown>;
        return { code: str(r.code), name: str(r.name), order: numOf(r.order) };
      }),
    };
  }
  if (kind === "buy") {
    return {
      code: str(o.code),
      name: str(o.name),
      company: str(o.company),
      invoice: str(o.invoice),
      date: str(o.date),
      kmya: numOf(o.kmya),
      basicPct: numOf(o.basicPct),
      extraPct: numOf(o.extraPct),
      specialPct: numOf(o.specialPct),
    };
  }
  return {
    code: str(o.code),
    name: str(o.name),
    supplier: str(o.supplier),
    purchasePrice: numOf(o.purchasePrice),
    salePrice: numOf(o.salePrice),
    balance: numOf(o.balance),
  };
}

// The array field name inside each slot.
const ROWS_FIELD: Record<Kind, "orders" | "lines" | "items"> = {
  pos: "orders",
  buy: "lines",
  stock: "items",
};

// GET /api/auto-tasfya?month=YYYY-MM
// Returns a light summary of each slot for the month (file name, saved-at, and
// row counts) — never the full arrays.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const month = new URL(request.url).searchParams.get("month");
  if (!isMonth(month)) {
    return NextResponse.json({ error: "Invalid month" }, { status: 400 });
  }

  await connectDB();
  const rows = await AutoTasfyaUpload.aggregate([
    { $match: { ownerId: userId, month } },
    {
      $project: {
        _id: 0,
        posFileName: "$pos.fileName",
        posSavedAt: "$pos.savedAt",
        posOrders: { $size: { $ifNull: ["$pos.orders", []] } },
        posItems: {
          $sum: {
            $map: {
              input: { $ifNull: ["$pos.orders", []] },
              as: "o",
              in: { $size: { $ifNull: ["$$o.items", []] } },
            },
          },
        },
        buyFileName: "$buy.fileName",
        buySavedAt: "$buy.savedAt",
        buyLines: { $size: { $ifNull: ["$buy.lines", []] } },
        stockFileName: "$stock.fileName",
        stockSavedAt: "$stock.savedAt",
        stockItems: { $size: { $ifNull: ["$stock.items", []] } },
      },
    },
  ]);

  const r = rows[0];
  const slot = (
    fileName: string | undefined,
    savedAt: unknown,
    count: number,
    countLabel: string,
  ) =>
    fileName
      ? { fileName, savedAt: savedAt ?? null, [countLabel]: count }
      : null;

  return NextResponse.json({
    month,
    pos: r?.posFileName
      ? {
          fileName: r.posFileName,
          savedAt: r.posSavedAt ?? null,
          orders: r.posOrders ?? 0,
          items: r.posItems ?? 0,
        }
      : null,
    buy: slot(r?.buyFileName, r?.buySavedAt, r?.buyLines ?? 0, "lines"),
    stock: slot(r?.stockFileName, r?.stockSavedAt, r?.stockItems ?? 0, "items"),
  });
}

// POST /api/auto-tasfya
// Body: { month, kind, fileName, data: [...] } — replaces that slot for the
// month (upserting the month document).
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !isMonth(body.month) || !isKind(body.kind)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!Array.isArray(body.data)) {
    return NextResponse.json({ error: "Missing data" }, { status: 400 });
  }

  const kind = body.kind as Kind;
  const fileName = str(body.fileName) || `${kind}.htm`;
  const rows = body.data.map((row: unknown) => sanitizeRow(kind, row));
  const slot = {
    fileName,
    savedAt: new Date(),
    [ROWS_FIELD[kind]]: rows,
  };

  await connectDB();
  await AutoTasfyaUpload.updateOne(
    { ownerId: userId, month: body.month },
    { $set: { [kind]: slot }, $setOnInsert: { ownerId: userId, month: body.month } },
    { upsert: true },
  );

  const count =
    kind === "pos"
      ? rows.reduce(
          (a: number, o: Record<string, unknown>) =>
            a + (Array.isArray(o.items) ? o.items.length : 0),
          0,
        )
      : rows.length;

  return NextResponse.json({
    ok: true,
    kind,
    fileName,
    rows: rows.length,
    items: count,
    savedAt: slot.savedAt,
  });
}

// DELETE /api/auto-tasfya?month=YYYY-MM[&kind=pos|buy|stock]
// Without `kind`, deletes the whole month document.
export async function DELETE(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const month = params.get("month");
  const kind = params.get("kind");
  if (!isMonth(month)) {
    return NextResponse.json({ error: "Invalid month" }, { status: 400 });
  }

  await connectDB();
  if (kind) {
    if (!isKind(kind)) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }
    await AutoTasfyaUpload.updateOne(
      { ownerId: userId, month },
      { $set: { [kind]: null } },
    );
  } else {
    await AutoTasfyaUpload.deleteOne({ ownerId: userId, month });
  }

  return NextResponse.json({ ok: true });
}

// Keep the Node runtime (Mongoose needs it), matching the app's other routes.
export const runtime = "nodejs";
