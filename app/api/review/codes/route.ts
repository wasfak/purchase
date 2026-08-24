import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { ReviewState } from "@/lib/models/ReviewState";

export const runtime = "nodejs";

const CODES_KEY = "codes";

type CodeMeta = {
  status?: "done" | "ignored";
  at?: number;
  category?: string;
  note?: string;
};

const isEmptyMeta = (m: CodeMeta) => !m.status && !m.category && !m.note;

async function loadMap(userId: string): Promise<Record<string, CodeMeta>> {
  const rec = await ReviewState.findOne({
    ownerId: userId,
    key: CODES_KEY,
  }).lean<{ data: Record<string, CodeMeta> | null } | null>();
  return rec?.data ?? {};
}

// GET /api/review/codes — this user's cross-sheet code history map.
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await connectDB();
  return NextResponse.json({ codes: await loadMap(userId) });
}

// POST /api/review/codes — field-merge per-code updates into the history.
// Body: { updates: Record<string, CodeMeta | null> } — null (or an entry that
// ends up empty) removes that code. This mirrors mergeCodeStatuses on the client.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  const updates = body?.updates as Record<string, CodeMeta | null> | undefined;
  if (!updates || typeof updates !== "object") {
    return NextResponse.json({ error: "Invalid updates" }, { status: 400 });
  }

  await connectDB();
  const map = await loadMap(userId);
  for (const [code, update] of Object.entries(updates)) {
    if (update === null) {
      delete map[code];
      continue;
    }
    const merged: CodeMeta = { ...(map[code] ?? {}), ...update };
    if (isEmptyMeta(merged)) delete map[code];
    else map[code] = merged;
  }
  await ReviewState.updateOne(
    { ownerId: userId, key: CODES_KEY },
    { $set: { data: map } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true });
}

// DELETE /api/review/codes — wipe the entire code history (fresh baseline).
export async function DELETE() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await connectDB();
  await ReviewState.deleteOne({ ownerId: userId, key: CODES_KEY });
  return NextResponse.json({ ok: true });
}
