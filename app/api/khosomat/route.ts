import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { AutoTasfyaUpload } from "@/lib/models/AutoTasfyaUpload";
import { dropExcludedLines } from "@/lib/tasfya/purchases";
import type { PurchaseLine, SupplyOrder } from "@/lib/tasfya/types";

// GET /api/khosomat
// Every month the user uploaded to Auto Tasfya: its supply orders (only what's
// needed to tie items to a company) + its buy lines. The خصومات page compares
// the discount / bonus of each purchase against the usual for that item.
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();
  const docs = await AutoTasfyaUpload.find({ ownerId: userId })
    .select("month pos.orders buy.lines")
    .lean<
      {
        month: string;
        pos?: { orders?: SupplyOrder[] };
        buy?: { lines?: PurchaseLine[] };
      }[]
    >();

  const months = docs
    .map((d) => ({
      month: d.month,
      orders: (d.pos?.orders ?? []).map((o) => ({
        supplier: o.supplier,
        items: (o.items ?? []).map((i) => ({ code: i.code, name: i.name })),
      })),
      lines: dropExcludedLines(d.buy?.lines ?? []),
    }))
    .filter((m) => m.lines.length > 0)
    .sort((a, b) => b.month.localeCompare(a.month));

  return NextResponse.json({ months });
}

export const runtime = "nodejs";
