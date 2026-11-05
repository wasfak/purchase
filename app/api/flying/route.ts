import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { FlyingSheet } from "@/lib/models/FlyingSheet";
import { ShortSheet } from "@/lib/models/ShortSheet";
import { DEFAULT_DISTRIBUTORS } from "@/lib/tasfya/flying";

const isMonth = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}$/.test(v);

// kind=short selects the "تصفية لم يصل" sheets; anything else is a flying sheet.
const sheetModel = (kind: unknown) =>
  kind === "short" ? ShortSheet : FlyingSheet;

// GET /api/flying?month=YYYY-MM&company=<name>[&kind=short]
// Returns the saved worksheet for a company/month, or null if none.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const Sheet = sheetModel(params.get("kind"));

  // GET /api/flying?list=1 — the user's saved sheets (summary only), newest first.
  if (params.get("list")) {
    await connectDB();
    const docs = await Sheet.find(
      { ownerId: userId },
      { month: 1, company: 1, orderNumber: 1, referenceDate: 1, updatedAt: 1 },
    )
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean();
    return NextResponse.json({ sheets: docs });
  }

  const month = params.get("month");
  const company = (params.get("company") ?? "").trim();
  if (!isMonth(month) || !company) {
    return NextResponse.json({ error: "Invalid month/company" }, { status: 400 });
  }

  await connectDB();
  const doc = await Sheet.findOne({
    ownerId: userId,
    month,
    company,
  }).lean();

  return NextResponse.json({ sheet: doc ?? null });
}

// PATCH /api/flying — add Auto Tasfya لم يصل items to a company/month's short
// sheet, creating it if needed. Codes already on the sheet are left untouched so
// what was recorded against them survives, and their `order` is not re-based.
// Body: { month, company, referenceDate, orderNumber, items: [{ code, name, order }] }
export async function PATCH(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const company = (body?.company ?? "").trim();
  if (!body || !isMonth(body.month) || !company || !Array.isArray(body.items)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const filter = { ownerId: userId, month: body.month, company };

  await connectDB();
  const doc = (await ShortSheet.findOne(filter, { "rows.code": 1 }).lean()) as {
    rows?: { code?: string }[];
  } | null;

  const seen = new Set((doc?.rows ?? []).map((r) => (r.code ?? "").trim()));
  const fresh = [];
  for (const it of body.items as Record<string, unknown>[]) {
    const code = String(it?.code ?? "").trim();
    const order = Math.trunc(Number(it?.order) || 0);
    if (!code || order <= 0 || seen.has(code)) continue;
    seen.add(code);
    fresh.push({
      code,
      name: String(it?.name ?? ""),
      order,
      cells: {},
      note: "",
      remainingOverride: null,
    });
  }

  if (fresh.length > 0) {
    const stamp = Date.now().toString(36);
    await ShortSheet.updateOne(
      filter,
      {
        $push: { rows: { $each: fresh } },
        $set: {
          referenceDate: String(body.referenceDate ?? ""),
          orderNumber: String(body.orderNumber ?? ""),
        },
        $setOnInsert: {
          columns: DEFAULT_DISTRIBUTORS.map((name, i) => ({
            id: `c${stamp}${i}`,
            name,
          })),
        },
      },
      { upsert: true },
    );
  }

  return NextResponse.json({ ok: true, added: fresh.length });
}

// POST /api/flying — save (upsert) a worksheet for a company/month.
// Body: { kind?, month, company, supplier, referenceDate, orderNumber, columns, rows }
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
          sent: Boolean(c?.sent),
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
  await sheetModel(body.kind).updateOne(
    { ownerId: userId, month: body.month, company },
    { $set: update },
    { upsert: true },
  );

  return NextResponse.json({ ok: true, savedAt: new Date() });
}

export const runtime = "nodejs";
