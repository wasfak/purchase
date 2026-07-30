import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import {
  ExpirySnapshot,
  type ExpiryItemDoc,
  type MonthSnapshotDoc,
} from "@/lib/models/ExpirySnapshot";

const NUM_FIELDS = ["qty", "avgCost", "buyPrice", "sellPrice", "total"] as const;
const STR_FIELDS = ["company", "code", "product", "expiry"] as const;

const round2 = (v: number) => Math.round(v * 100) / 100;

// Which "YYYY-MM" cycle a save belongs to.
const monthOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

// Keep only the known item fields, coercing types.
function sanitizeItem(input: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!input || typeof input !== "object") return out;
  const obj = input as Record<string, unknown>;
  for (const f of STR_FIELDS) out[f] = String(obj[f] ?? "").trim();
  for (const f of NUM_FIELDS) out[f] = Number(obj[f]) || 0;
  return out;
}

// Roll a month's items up into the stored summary. "Expired" is measured at save
// time, so the trend reflects what was expired when the snapshot was taken.
function summarizeItems(items: Array<Record<string, string | number>>) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let units = 0;
  let costValue = 0;
  let retailValue = 0;
  let expiredItems = 0;
  let expiredCost = 0;
  for (const it of items) {
    const qty = Number(it.qty) || 0;
    const total = Number(it.total) || 0;
    units += qty;
    costValue += total;
    retailValue += qty * (Number(it.sellPrice) || 0);
    const [y, m, d] = String(it.expiry ?? "").split("/").map(Number);
    if (y) {
      const exp = new Date(y, (m || 1) - 1, d || 1);
      if (exp.getTime() < today.getTime()) {
        expiredItems += 1;
        expiredCost += total;
      }
    }
  }
  return {
    items: items.length,
    units: round2(units),
    costValue: round2(costValue),
    retailValue: round2(retailValue),
    expiredItems,
    expiredCost: round2(expiredCost),
  };
}

// GET /api/expiry           → the latest month's items (Orders tab reads this).
// GET /api/expiry?history=1 → every saved month's summary, oldest → newest.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();
  const wantsHistory = new URL(request.url).searchParams.get("history");

  if (wantsHistory) {
    const snap = await ExpirySnapshot.findOne(
      { ownerId: userId },
      { "months.month": 1, "months.savedAt": 1, "months.summary": 1 },
    ).lean<{ months?: MonthSnapshotDoc[] }>();
    return NextResponse.json({ months: snap?.months ?? [] });
  }

  const snap = await ExpirySnapshot.findOne({ ownerId: userId }).lean<{
    months?: MonthSnapshotDoc[];
    items?: ExpiryItemDoc[];
    savedAt?: Date;
  }>();
  if (!snap) {
    return NextResponse.json({ items: [], savedAt: null, month: null });
  }

  const months = snap.months ?? [];
  if (months.length > 0) {
    const latest = months[months.length - 1];
    return NextResponse.json({
      items: latest.items ?? [],
      savedAt: latest.savedAt ?? null,
      month: latest.month ?? null,
    });
  }
  // Legacy single-snapshot record — not yet migrated into `months`.
  return NextResponse.json({
    items: snap.items ?? [],
    savedAt: snap.savedAt ?? null,
    month: null,
  });
}

// POST /api/expiry — save { items: [...], month?: "YYYY-MM" } as this month's
// snapshot, replacing any existing snapshot for that month.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const month =
    typeof body.month === "string" && /^\d{4}-\d{2}$/.test(body.month)
      ? body.month
      : monthOf(new Date());
  const items = body.items
    .map(sanitizeItem)
    .filter((i: Record<string, string | number>) => i.code || i.company);
  const savedAt = new Date();
  const entry = { month, savedAt, summary: summarizeItems(items), items };

  await connectDB();
  const snap =
    (await ExpirySnapshot.findOne({ ownerId: userId })) ??
    new ExpirySnapshot({ ownerId: userId, months: [] });

  const months: MonthSnapshotDoc[] = snap.months ?? [];

  // One-time migration: fold a pre-history record's top-level snapshot into
  // `months` (under the month it was saved) so it isn't lost.
  if (
    months.length === 0 &&
    Array.isArray(snap.items) &&
    snap.items.length > 0 &&
    snap.savedAt
  ) {
    const legacyMonth = monthOf(new Date(snap.savedAt));
    if (legacyMonth !== month) {
      const legacyItems = snap.items as unknown as Array<
        Record<string, string | number>
      >;
      months.push({
        month: legacyMonth,
        savedAt: snap.savedAt,
        summary: summarizeItems(legacyItems),
        items: snap.items,
      } as unknown as MonthSnapshotDoc);
    }
  }

  const idx = months.findIndex((m) => m.month === month);
  if (idx >= 0) months[idx] = entry as unknown as MonthSnapshotDoc;
  else months.push(entry as unknown as MonthSnapshotDoc);
  months.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

  snap.months = months;
  snap.set("items", undefined); // legacy field now folded into `months`
  snap.set("savedAt", undefined);
  await snap.save();

  return NextResponse.json({ count: items.length, savedAt, month });
}
