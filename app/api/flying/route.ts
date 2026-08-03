import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { FlyingSheet } from "@/lib/models/FlyingSheet";

const isMonth = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}$/.test(v);

// GET /api/flying?month=YYYY-MM&company=<name>
// Returns the saved flying worksheet for a company/month, or null if none.
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
  const doc = await FlyingSheet.findOne({
    ownerId: userId,
    month,
    company,
  }).lean();

  return NextResponse.json({ sheet: doc ?? null });
}

// POST /api/flying — save (upsert) a flying worksheet for a company/month.
// Body: { month, company, supplier, referenceDate, orderNumber, columns, rows }
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

  const columns = Array.isArray(body.columns)
    ? body.columns
        .map((c: Record<string, unknown>) => ({
          id: String(c?.id ?? ""),
          name: String(c?.name ?? ""),
        }))
        .filter((c: { id: string }) => c.id)
    : [];
  const rows = Array.isArray(body.rows)
    ? body.rows.map((r: Record<string, unknown>) => {
        const ov = Number(r?.remainingOverride);
        return {
          code: String(r?.code ?? ""),
          name: String(r?.name ?? ""),
          order: Math.trunc(Number(r?.order) || 0),
          cells: r?.cells && typeof r.cells === "object" ? r.cells : {},
          note: String(r?.note ?? ""),
          remainingOverride:
            r?.remainingOverride == null || !Number.isFinite(ov)
              ? null
              : Math.trunc(ov),
        };
      })
    : [];

  const update = {
    ownerId: userId,
    month: body.month,
    company,
    supplier: String(body.supplier ?? ""),
    referenceDate: String(body.referenceDate ?? ""),
    orderNumber: String(body.orderNumber ?? ""),
    columns,
    rows,
  };

  await connectDB();
  await FlyingSheet.updateOne(
    { ownerId: userId, month: body.month, company },
    { $set: update },
    { upsert: true },
  );

  return NextResponse.json({ ok: true, savedAt: new Date() });
}

export const runtime = "nodejs";
