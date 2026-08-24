import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { ReviewState } from "@/lib/models/ReviewState";

export const runtime = "nodejs";

const SESSION_KEY = "session";

// GET /api/review/session — this user's current working sheet, or null.
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await connectDB();
  const rec = await ReviewState.findOne({
    ownerId: userId,
    key: SESSION_KEY,
  }).lean<{ data: unknown } | null>();
  return NextResponse.json({ session: rec?.data ?? null });
}

// PUT /api/review/session — replace this user's working sheet.
export async function PUT(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await request.json().catch(() => null);
  if (session == null) {
    return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  }
  await connectDB();
  await ReviewState.updateOne(
    { ownerId: userId, key: SESSION_KEY },
    { $set: { data: session } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true });
}

// DELETE /api/review/session — clear this user's working sheet.
export async function DELETE() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await connectDB();
  await ReviewState.deleteOne({ ownerId: userId, key: SESSION_KEY });
  return NextResponse.json({ ok: true });
}
