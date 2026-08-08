import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { ZeroCodeUpload } from "@/lib/models/ZeroCodeUpload";

const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

const str = (v: unknown): string => String(v ?? "").trim();

// GET /api/zero-codes
// Lists the saved daily files for the signed-in user (newest first) with row
// counts — never the full row arrays.
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();
  const files = await ZeroCodeUpload.aggregate([
    { $match: { ownerId: userId } },
    {
      $project: {
        _id: 0,
        date: 1,
        fileName: 1,
        savedAt: 1,
        rows: { $size: { $ifNull: ["$rows", []] } },
        marked: {
          $size: {
            $filter: {
              input: { $ifNull: ["$rows", []] },
              as: "r",
              cond: { $eq: ["$$r.marked", true] },
            },
          },
        },
      },
    },
    { $sort: { date: -1 } },
  ]);

  return NextResponse.json({ files });
}

// POST /api/zero-codes
// Body: { date, fileName, rows: [{code,name,order,supplier,marked}] }
// Replaces (upserts) that day's list for the user.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !isDate(body.date) || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const rows = body.rows.map((row: unknown) => {
    const o = (row ?? {}) as Record<string, unknown>;
    return {
      code: str(o.code),
      name: str(o.name),
      order: str(o.order),
      supplier: str(o.supplier),
      marked: Boolean(o.marked),
    };
  });

  await connectDB();
  await ZeroCodeUpload.updateOne(
    { ownerId: userId, date: body.date },
    {
      $set: {
        fileName: str(body.fileName) || `${body.date}.csv`,
        savedAt: new Date(),
        rows,
      },
      $setOnInsert: { ownerId: userId, date: body.date },
    },
    { upsert: true },
  );

  return NextResponse.json({
    ok: true,
    date: body.date,
    rows: rows.length,
    marked: rows.filter((r: { marked: boolean }) => r.marked).length,
  });
}

// DELETE /api/zero-codes?date=YYYY-MM-DD
export async function DELETE(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const date = new URL(request.url).searchParams.get("date");
  if (!isDate(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  await connectDB();
  await ZeroCodeUpload.deleteOne({ ownerId: userId, date });
  return NextResponse.json({ ok: true });
}

// Mongoose needs the Node runtime, matching the app's other routes.
export const runtime = "nodejs";
