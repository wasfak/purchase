import { NextResponse } from "next/server";

import { hasFullAccess } from "@/lib/access";
import { connectDB } from "@/lib/db";
import { AyaState } from "@/lib/models/AyaState";

export const runtime = "nodejs";

const CODES_KEY = "codes";

type CodeMeta = {
  status?: "done" | "ignored";
  at?: number;
  category?: string;
};

const isEmptyMeta = (m: CodeMeta) => !m.status && !m.category;

async function loadMap(): Promise<Record<string, CodeMeta>> {
  const rec = await AyaState.findOne({ key: CODES_KEY }).lean<{
    data: Record<string, CodeMeta> | null;
  } | null>();
  return rec?.data ?? {};
}

// GET /api/aya/codes — the shared cross-sheet code history map.
export async function GET() {
  if (!(await hasFullAccess())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await connectDB();
  return NextResponse.json({ codes: await loadMap() });
}

// POST /api/aya/codes — field-merge per-code updates into the history.
// Body: { updates: Record<string, CodeMeta | null> } — null (or an entry that
// ends up empty) removes that code. This mirrors mergeCodeStatuses on the client.
export async function POST(request: Request) {
  if (!(await hasFullAccess())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const updates = body?.updates as Record<string, CodeMeta | null> | undefined;
  if (!updates || typeof updates !== "object") {
    return NextResponse.json({ error: "Invalid updates" }, { status: 400 });
  }

  await connectDB();
  const map = await loadMap();
  for (const [code, update] of Object.entries(updates)) {
    if (update === null) {
      delete map[code];
      continue;
    }
    const merged: CodeMeta = { ...(map[code] ?? {}), ...update };
    if (isEmptyMeta(merged)) delete map[code];
    else map[code] = merged;
  }
  await AyaState.updateOne(
    { key: CODES_KEY },
    { $set: { data: map } },
    { upsert: true },
  );
  return NextResponse.json({ ok: true });
}

// DELETE /api/aya/codes — wipe the entire code history (fresh baseline).
export async function DELETE() {
  if (!(await hasFullAccess())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  await connectDB();
  await AyaState.deleteOne({ key: CODES_KEY });
  return NextResponse.json({ ok: true });
}
