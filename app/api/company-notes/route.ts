import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import {
  COMPANY_DETAIL_FIELDS,
  CompanyNote,
} from "@/lib/models/CompanyNote";
import { normalizeCompany } from "@/lib/expiry";

// GET /api/company-notes?company=<name> — the notes for one company, or null.
// GET /api/company-notes                — every company note (for searching).
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const company = (
    new URL(request.url).searchParams.get("company") ?? ""
  ).trim();

  await connectDB();

  if (company) {
    const key = normalizeCompany(company);
    const doc = await CompanyNote.findOne({ ownerId: userId, key }).lean();
    return NextResponse.json({ note: doc ?? null });
  }

  const notes = await CompanyNote.find({ ownerId: userId })
    .sort({ updatedAt: -1 })
    .lean();
  return NextResponse.json({ notes });
}

// POST /api/company-notes — upsert a company's note entries and/or details.
// Body: { company, entries?: [{ text, at }], details?: { discount, … } }
// Only the parts sent are updated, so saving notes never wipes details.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const company = (body?.company ?? "").trim();
  if (!company) {
    return NextResponse.json({ error: "Missing company" }, { status: 400 });
  }
  const key = normalizeCompany(company);
  const set: Record<string, unknown> = { companyName: company };
  if (Array.isArray(body?.entries)) {
    set.entries = body.entries
      .map((e: Record<string, unknown>) => ({
        text: String(e?.text ?? ""),
        at: Number(e?.at) || Date.now(),
      }))
      .filter((e: { text: string }) => e.text.trim());
  }
  if (body?.details && typeof body.details === "object") {
    for (const f of COMPANY_DETAIL_FIELDS) {
      if (f in body.details) {
        set[`details.${f}`] = String(body.details[f] ?? "").trim();
      }
    }
  }

  await connectDB();
  await CompanyNote.updateOne(
    { ownerId: userId, key },
    { $set: set },
    { upsert: true },
  );

  return NextResponse.json({ ok: true });
}

export const runtime = "nodejs";
