import { NextResponse } from "next/server";

import { hasFullAccess } from "@/lib/access";
import { connectDB } from "@/lib/db";
import { AyaState } from "@/lib/models/AyaState";

export const runtime = "nodejs";

const SESSION_KEY = "session";

// GET /api/aya/session — the shared current working sheet, or null.
export async function GET() {
  if (!(await hasFullAccess())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await connectDB();
  const rec = await AyaState.findOne({ key: SESSION_KEY }).lean<{
    data: unknown;
  } | null>();
  return NextResponse.json({ session: rec?.data ?? null });
}

// PUT /api/aya/session — replace the shared working sheet.
export async function PUT(request: Request) {
  if (!(await hasFullAccess())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const session = await request.json().catch(() => null);
  if (session == null) {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  }
  await connectDB();
  await AyaState.updateOne(
    { key: SESSION_KEY },
    { $set: { data: session } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true });
}

// DELETE /api/aya/session — clear the shared working sheet.
export async function DELETE() {
  if (!(await hasFullAccess())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await connectDB();
  await AyaState.deleteOne({ key: SESSION_KEY });
  return NextResponse.json({ ok: true });
}
