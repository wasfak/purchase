import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { normalizeCompany } from "@/lib/expiry";
import { AutoTasfyaUpload } from "@/lib/models/AutoTasfyaUpload";
import { ItemHistory } from "@/lib/models/ItemHistory";
import { linesForCodes, mergeLines } from "@/lib/tasfya/itemHistory";
import { dropExcludedLines } from "@/lib/tasfya/purchases";
import type { PurchaseLine } from "@/lib/tasfya/types";

type Doc = { company?: string; codes?: string[]; lines?: PurchaseLine[] };

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map((c) => String(c).trim()).filter(Boolean))] : [];

function toLine(input: unknown): PurchaseLine {
  const o = (input ?? {}) as Record<string, unknown>;
  return {
    code: String(o.code ?? "").trim(),
    name: String(o.name ?? "").trim(),
    company: String(o.company ?? "").trim(),
    invoice: String(o.invoice ?? "").trim(),
    date: String(o.date ?? "").trim(),
    kmya: Number(o.kmya) || 0,
    basicPct: Number(o.basicPct) || 0,
    extraPct: Number(o.extraPct) || 0,
    specialPct: Number(o.specialPct) || 0,
  };
}

// GET /api/khosomat/history — companies with a saved history (summary only).
// GET /api/khosomat/history?company=<name> — that company's codes and lines.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();
  const company = new URL(request.url).searchParams.get("company");
  if (company !== null) {
    const doc = await ItemHistory.findOne({
      ownerId: userId,
      companyKey: normalizeCompany(company),
    }).lean<Doc | null>();
    return NextResponse.json({
      codes: doc?.codes ?? [],
      lines: doc?.lines ?? [],
    });
  }

  const companies = await ItemHistory.aggregate([
    { $match: { ownerId: userId } },
    {
      $project: {
        _id: 0,
        company: 1,
        codes: { $size: "$codes" },
        updatedAt: 1,
      },
    },
    { $sort: { updatedAt: -1 } },
  ]);
  return NextResponse.json({ companies });
}

// POST /api/khosomat/history — add codes and buy lines to a company's history,
// then search every Buy file saved in Auto Tasfya for those codes. With no codes
// it re-searches the ones already saved, picking up newer Buy files. The browser
// sends a large history file's matches in batches with search: false, then a last
// call that searches.
// Body: { company, codes, lines?, search? }
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const company = String(body?.company ?? "").trim();
  const companyKey = normalizeCompany(company);
  if (!companyKey) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const filter = { ownerId: userId, companyKey };
  await connectDB();
  const [doc, uploads] = await Promise.all([
    ItemHistory.findOne(filter).lean<Doc | null>(),
    body.search === false
      ? []
      : AutoTasfyaUpload.find({ ownerId: userId })
          .select("buy.lines")
          .lean<{ buy?: { lines?: PurchaseLine[] } }[]>(),
  ]);

  const codes = [...new Set([...(doc?.codes ?? []), ...strings(body.codes)])];
  const fromBody = mergeLines(
    (doc?.lines ?? []).map(toLine),
    (Array.isArray(body.lines) ? body.lines : []).map(toLine),
  );
  const saved = fromBody.lines;

  // Matched over all files together so تشغيلات variants link across months, then
  // merged file by file: an invoice in two months' files must not count twice.
  const files = uploads.map((u) => (u.buy?.lines ?? []).map(toLine));
  const matched = new Set(
    linesForCodes(dropExcludedLines(files.flat()), codes, saved),
  );
  let lines = saved;
  let added = fromBody.added;
  for (const file of files) {
    const merged = mergeLines(
      lines,
      file.filter((l) => matched.has(l)),
    );
    lines = merged.lines;
    added += merged.added;
  }

  await ItemHistory.updateOne(
    filter,
    { $set: { company, codes, lines } },
    { upsert: true },
  );

  const found = new Set(lines.map((l) => l.code));
  return NextResponse.json({
    ok: true,
    added,
    codes: codes.length,
    missing: codes.filter((c) => !found.has(c)).length,
  });
}

// DELETE /api/khosomat/history — forget items: their codes and their buy lines.
// Body: { company, codes }
export async function DELETE(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const companyKey = normalizeCompany(String(body?.company ?? ""));
  const codes = strings(body?.codes);
  if (!companyKey || codes.length === 0) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  await connectDB();
  await ItemHistory.updateOne(
    { ownerId: userId, companyKey },
    { $pull: { codes: { $in: codes }, lines: { code: { $in: codes } } } },
  );
  return NextResponse.json({ ok: true });
}

export const runtime = "nodejs";
