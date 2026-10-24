import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { AutoTasfyaUpload } from "@/lib/models/AutoTasfyaUpload";
import { combineCompanyOrders } from "@/lib/tasfya/supplyOrders";
import type { PurchaseLine, SupplyOrder } from "@/lib/tasfya/types";

const isMonth = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}$/.test(v);

// GET /api/auto-tasfya/data?month=YYYY-MM&company=<name>
// Returns the settlement inputs for one company: its combined ordered items
// (across all of its pos orders), the earliest order date as the cutoff, and the
// full buy lines for the month. Stock is NOT here — it lives on the client (PC).
//
// GET /api/auto-tasfya/data?month=YYYY-MM&all=1
// Returns every pos order + the buy lines for the month in one go, so the batch
// page can settle many companies without re-downloading the lines per company.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const month = params.get("month");
  const all = params.get("all") === "1";
  const company = (params.get("company") ?? "").trim();
  if (!isMonth(month) || (!all && !company)) {
    return NextResponse.json({ error: "Invalid month/company" }, { status: 400 });
  }

  await connectDB();
  const doc = await AutoTasfyaUpload.findOne({ ownerId: userId, month }).lean<{
    pos?: { orders?: SupplyOrder[] };
    buy?: { lines?: PurchaseLine[] };
  }>();

  const allOrders = doc?.pos?.orders ?? [];
  const lines = doc?.buy?.lines ?? [];

  if (all) {
    return NextResponse.json({
      month,
      hasPos: allOrders.length > 0,
      hasBuy: lines.length > 0,
      orders: allOrders,
      lines,
    });
  }

  const combined = combineCompanyOrders(allOrders, company);

  return NextResponse.json({
    company,
    month,
    hasPos: allOrders.length > 0,
    hasBuy: lines.length > 0,
    matchedOrders: combined.matched,
    orderNumbers: combined.orderNumbers,
    referenceDate: combined.referenceDate,
    items: combined.items,
    lines,
  });
}

export const runtime = "nodejs";
