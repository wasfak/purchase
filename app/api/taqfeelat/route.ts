import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { TaqfeelaFlag } from "@/lib/models/TaqfeelaFlag";
import { normalizeCompany } from "@/lib/expiry";

// GET /api/taqfeelat — every auto-display flag for the current user. The page
// derives the company list from the orders and overlays these flags.
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();
  const flags = await TaqfeelaFlag.find({ ownerId: userId }).lean();
  return NextResponse.json({ flags });
}

// POST /api/taqfeelat — upsert one company's row. Only the fields present in
// the body are changed, so saving a date doesn't clobber the auto-display flag
// (and vice versa).
// Body: { company: string, autoDisplay?: boolean,
//         dateOfDoing?: string, dateToAccounts?: string }
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

  const set: Record<string, string | boolean> = { companyName: company };
  if (body?.autoDisplay !== undefined) set.autoDisplay = Boolean(body.autoDisplay);
  if (body?.dateOfDoing !== undefined)
    set.dateOfDoing = String(body.dateOfDoing).trim();
  if (body?.dateToAccounts !== undefined)
    set.dateToAccounts = String(body.dateToAccounts).trim();

  await connectDB();
  await TaqfeelaFlag.updateOne(
    { ownerId: userId, key },
    { $set: set },
    { upsert: true },
  );

  return NextResponse.json({ ok: true });
}

export const runtime = "nodejs";
