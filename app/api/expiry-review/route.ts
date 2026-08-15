import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { ExpiryReview } from "@/lib/models/ExpiryReview";
import { normalizeCompany } from "@/lib/expiry";

// GET /api/expiry-review?month=YYYY-MM — every company's review state for that
// month (status + note), so the expiry page can show them beside each company.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const month = (new URL(request.url).searchParams.get("month") ?? "").trim();
  await connectDB();

  const query: Record<string, string> = { ownerId: userId };
  if (/^\d{4}-\d{2}$/.test(month)) query.month = month;

  const reviews = await ExpiryReview.find(query).lean<
    { month: string; key: string; companyName: string; status: string; note: string }[]
  >();
  return NextResponse.json({ reviews });
}

// POST /api/expiry-review — upsert one company's review for a month.
// Body: { month, company, status?, note? }
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const month = (body?.month ?? "").trim();
  const company = (body?.company ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(month) || !company) {
    return NextResponse.json({ error: "Missing month or company" }, { status: 400 });
  }
  const key = normalizeCompany(company);
  const status = body?.status === "done" ? "done" : "pending";
  const note = String(body?.note ?? "");

  await connectDB();
  await ExpiryReview.updateOne(
    { ownerId: userId, month, key },
    { $set: { companyName: company, status, note } },
    { upsert: true },
  );

  return NextResponse.json({ ok: true });
}

export const runtime = "nodejs";
