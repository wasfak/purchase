import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { AutoTasfyaUpload } from "@/lib/models/AutoTasfyaUpload";
import type { PurchaseLine, SupplyOrder, SupplyOrderItem } from "@/lib/tasfya/types";

const isMonth = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}$/.test(v);

// GET /api/auto-tasfya/data?month=YYYY-MM&company=<name>
// Returns the settlement inputs for one company: its combined ordered items
// (across all of its pos orders), the earliest order date as the cutoff, and the
// full buy lines for the month. Stock is NOT here — it lives on the client (PC).
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
  const doc = await AutoTasfyaUpload.findOne({ ownerId: userId, month }).lean<{
    pos?: { orders?: SupplyOrder[] };
    buy?: { lines?: PurchaseLine[] };
  }>();

  const allOrders = doc?.pos?.orders ?? [];
  const lines = doc?.buy?.lines ?? [];

  // All pos orders whose supplier matches the company EXACTLY (trimmed).
  const target = company;
  const matched = allOrders.filter((o) => (o.supplier ?? "").trim() === target);

  // Combine items across the matched orders; earliest date = the cutoff.
  const items: SupplyOrderItem[] = [];
  const orderNumbers: string[] = [];
  let referenceDate = "";
  for (const o of matched) {
    if (o.orderNumber) orderNumbers.push(o.orderNumber);
    if (o.date && (referenceDate === "" || o.date < referenceDate)) {
      referenceDate = o.date;
    }
    for (const it of o.items ?? []) {
      items.push({
        code: String(it.code ?? ""),
        name: String(it.name ?? ""),
        order: Number(it.order) || 0,
      });
    }
  }

  return NextResponse.json({
    company,
    month,
    hasPos: allOrders.length > 0,
    hasBuy: lines.length > 0,
    matchedOrders: matched.length,
    orderNumbers,
    referenceDate,
    items,
    lines,
  });
}

export const runtime = "nodejs";
