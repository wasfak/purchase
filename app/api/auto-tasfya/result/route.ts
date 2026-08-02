import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { AutoTasfyaResult } from "@/lib/models/AutoTasfyaResult";

const isMonth = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}$/.test(v);

// GET /api/auto-tasfya/result?month=YYYY-MM&company=<name>
// Returns the saved settlement (report + extras + edits) for a company/month,
// or null if none saved.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const month = params.get("month");
  const company = (params.get("company") ?? "").trim();
  if (!isMonth(month) || !company) {
    return NextResponse.json({ error: "Invalid month/company" }, { status: 400 });
  }

  await connectDB();
  const doc = await AutoTasfyaResult.findOne({
    ownerId: userId,
    month,
    company,
  }).lean();

  return NextResponse.json({ result: doc ?? null });
}

// POST /api/auto-tasfya/result — save (upsert) a settlement for a company/month.
// Body: { month, company, referenceDate, orderNumber, report, extraItems, edits }
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const company = (body?.company ?? "").trim();
  if (!body || !isMonth(body.month) || !company) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const update = {
    ownerId: userId,
    month: body.month,
    company,
    referenceDate: String(body.referenceDate ?? ""),
    orderNumber: String(body.orderNumber ?? ""),
    report: Array.isArray(body.report) ? body.report : [],
    extraItems: Array.isArray(body.extraItems) ? body.extraItems : [],
    edits:
      body.edits && typeof body.edits === "object" ? body.edits : {},
  };

  await connectDB();
  await AutoTasfyaResult.updateOne(
    { ownerId: userId, month: body.month, company },
    { $set: update },
    { upsert: true },
  );

  return NextResponse.json({ ok: true, savedAt: new Date() });
}

export const runtime = "nodejs";
