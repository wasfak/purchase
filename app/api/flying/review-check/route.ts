import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { FlyingSheet } from "@/lib/models/FlyingSheet";
import {
  effRemaining,
  type FlyingColumn,
  type FlyingRow,
} from "@/lib/tasfya/flying";

// How recently a flying (ع الطاير) sheet must have been worked on for its codes
// to be flagged on the Review page — so it reflects the current cycle and old
// sheets don't hide a code you genuinely need to reorder now. Measured against
// today via the sheet's updatedAt. 0 / non-positive means "no window".
const DEFAULT_DAYS = 7;

// Same normalization the Review page uses so codes match across sheets: strip
// invisible bidi/formatting marks + whitespace, and compare purely-numeric codes
// as numbers ("143354", " 143354 " and "143354.0" all resolve to "143354").
const normCode = (raw: unknown): string => {
  const s = String(raw ?? "")
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .trim();
  if (s === "") return "";
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
};

type FlyingHit = {
  month: string;
  company: string;
  savedAt: number;
  name: string;
  order: number; // الكمية المطلوبة
  remaining: number; // الباقى (effective — override wins)
  note: string;
  columns: { id: string; name: string }[];
  cells: Record<string, string>;
};

// POST /api/flying/review-check
// Body: { codes: string[], days?: number }
// For each requested code, returns every recent flying (ع الطاير) sheet it
// appears on — which month/company it's coming from, the distributor columns +
// this row's cells, the ordered quantity, and its الباقى — so the Review page can
// flag already-covered codes and show the breakdown on click. Newest first.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const rawCodes = Array.isArray(body?.codes) ? body.codes : [];
  const wanted = new Set<string>();
  for (const c of rawCodes) {
    const n = normCode(c);
    if (n) wanted.add(n);
  }

  const reqDays = Number(body?.days);
  const days = Number.isFinite(reqDays) ? reqDays : DEFAULT_DAYS;

  if (wanted.size === 0) {
    return NextResponse.json({ results: [], days });
  }

  await connectDB();

  const query: Record<string, unknown> = { ownerId: userId };
  if (days > 0) {
    query.updatedAt = { $gte: new Date(Date.now() - days * 86_400_000) };
  }
  const docs = await FlyingSheet.find(query).lean();

  const byCode = new Map<string, FlyingHit[]>();

  for (const doc of docs as Record<string, unknown>[]) {
    const savedAt = new Date(
      (doc.updatedAt as Date) ?? (doc.createdAt as Date) ?? Date.now(),
    ).getTime();
    const company = String(doc.company ?? "");
    const month = String(doc.month ?? "");
    const columns: FlyingColumn[] = (
      (doc.columns as { id?: unknown; name?: unknown }[]) ?? []
    ).map((c) => ({ id: String(c?.id ?? ""), name: String(c?.name ?? "") }));

    for (const r of (doc.rows ?? []) as Record<string, unknown>[]) {
      const key = normCode(r.code);
      if (!key || !wanted.has(key)) continue;

      const ov = Number(r.remainingOverride);
      const cells =
        r.cells && typeof r.cells === "object"
          ? (r.cells as Record<string, string>)
          : {};
      const row: FlyingRow = {
        code: String(r.code ?? ""),
        name: String(r.name ?? ""),
        order: Number(r.order) || 0,
        cells,
        remainingOverride:
          r.remainingOverride == null || !Number.isFinite(ov) ? null : ov,
      };

      const list = byCode.get(key) ?? [];
      list.push({
        month,
        company,
        savedAt,
        name: row.name,
        order: row.order,
        remaining: effRemaining(row, columns),
        note: typeof r.note === "string" ? r.note : "",
        columns,
        cells,
      });
      byCode.set(key, list);
    }
  }

  const results = [...byCode.entries()].map(([code, hits]) => ({
    code,
    hits: hits.sort((a, b) => b.savedAt - a.savedAt),
  }));

  return NextResponse.json({ results, days });
}

export const runtime = "nodejs";
