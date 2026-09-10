import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { AutoTasfyaUpload } from "@/lib/models/AutoTasfyaUpload";
import { productKey } from "@/lib/tasfya/productKey";

// GET /api/alama
// The "علامة" flag: scans every month the user has uploaded and returns each
// ordered product whose name carries one of the price/bonus markers (#B / #C /
// #N) AND whose bought quantity exactly equals the ordered quantity.
//
// تشغيلات-aware: a product can live under several codes (old price code + new
// price generations). Matching is therefore by product key (base name with the
// price-generation tag stripped), NOT by raw code — so an order placed under an
// old code and a purchase invoiced under the new code aggregate into one logical
// product. Both quantities are summed across every variant code in the group.
//
// Matching is per-month. "Bought" = total received (كمية الوارد) across the
// product's purchase lines (بونص included); the bonus is reported separately.

const BONUS_BASIC_PCT = 100; // أساسي = 100% marks a بونص (free goods) line.

const MARKERS = ["#B", "#C", "#N"] as const;
type Marker = (typeof MARKERS)[number];

function markersIn(name: string): Marker[] {
  return MARKERS.filter((m) => name.includes(m));
}

type PosItem = { code?: unknown; name?: unknown; order?: unknown };
type PosOrder = {
  orderNumber?: unknown;
  supplier?: unknown;
  date?: unknown;
  items?: PosItem[];
};
type BuyLine = { code?: unknown; name?: unknown; kmya?: unknown; basicPct?: unknown };

// One product group within a month, keyed by productKey.
type Group = {
  order: number;
  received: number;
  bonus: number;
  codes: Set<string>;
  markers: Set<Marker>;
  // A display name — the first ordered item's name that carries a marker.
  name: string;
  orderNumbers: Set<string>;
  suppliers: Set<string>;
  date: string; // earliest order date in the group
};

type AlamaRow = {
  month: string;
  orderNumbers: string[];
  suppliers: string[];
  date: string;
  codes: string[];
  name: string;
  order: number;
  received: number;
  bonus: number;
  markers: Marker[];
};

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();
  const docs = await AutoTasfyaUpload.find({ ownerId: userId })
    .select("month pos buy")
    .lean();

  const rows: AlamaRow[] = [];

  for (const doc of docs as unknown as Record<string, unknown>[]) {
    const month = String(doc.month ?? "");
    const orders = ((doc.pos as { orders?: PosOrder[] } | null)?.orders ??
      []) as PosOrder[];
    const buyLines = ((doc.buy as { lines?: BuyLine[] } | null)?.lines ??
      []) as BuyLine[];
    if (orders.length === 0) continue;

    const groups = new Map<string, Group>();
    const ensure = (key: string): Group => {
      let g = groups.get(key);
      if (!g) {
        g = {
          order: 0,
          received: 0,
          bonus: 0,
          codes: new Set(),
          markers: new Set(),
          name: "",
          orderNumbers: new Set(),
          suppliers: new Set(),
          date: "",
        };
        groups.set(key, g);
      }
      return g;
    };

    // Order side: sum ordered qty per product, remembering which products were
    // actually ordered (only these can be flagged).
    const orderedKeys = new Set<string>();
    for (const order of orders) {
      const orderNumber = String(order.orderNumber ?? "");
      const supplier = String(order.supplier ?? "");
      const date = String(order.date ?? "");
      for (const item of order.items ?? []) {
        const name = String(item.name ?? "");
        const key = productKey(name);
        if (!key) continue;
        const g = ensure(key);
        orderedKeys.add(key);
        g.order += Number(item.order) || 0;
        const code = String(item.code ?? "");
        if (code) g.codes.add(code);
        for (const m of markersIn(name)) g.markers.add(m);
        if (!g.name && markersIn(name).length > 0) g.name = name;
        if (!g.name) g.name = name;
        else if (markersIn(name).length > 0 && !markersIn(g.name).length) {
          g.name = name; // prefer a marker-bearing name for display
        }
        if (orderNumber) g.orderNumbers.add(orderNumber);
        if (supplier) g.suppliers.add(supplier);
        if (date && (!g.date || date < g.date)) g.date = date;
      }
    }

    // Buy side: attribute each purchase line to its product group by name. Only
    // lines whose product was ordered this month contribute (an unordered
    // purchase can't make an order "fully bought").
    for (const line of buyLines) {
      const key = productKey(String(line.name ?? ""));
      if (!key || !orderedKeys.has(key)) continue;
      const g = ensure(key);
      const qty = Number(line.kmya) || 0;
      g.received += qty;
      if ((Number(line.basicPct) || 0) === BONUS_BASIC_PCT) g.bonus += qty;
      const code = String(line.code ?? "");
      if (code) g.codes.add(code);
      for (const m of markersIn(String(line.name ?? ""))) g.markers.add(m);
    }

    for (const g of groups.values()) {
      if (g.markers.size === 0) continue;
      if (g.order <= 0) continue;
      if (g.received !== g.order) continue;
      rows.push({
        month,
        orderNumbers: [...g.orderNumbers],
        suppliers: [...g.suppliers],
        date: g.date,
        codes: [...g.codes],
        name: g.name,
        order: g.order,
        received: g.received,
        bonus: g.bonus,
        markers: MARKERS.filter((m) => g.markers.has(m)),
      });
    }
  }

  // Newest month first, then by order date, then by name.
  rows.sort(
    (a, b) =>
      b.month.localeCompare(a.month) ||
      b.date.localeCompare(a.date) ||
      a.name.localeCompare(b.name, "ar"),
  );

  return NextResponse.json({ rows });
}

export const runtime = "nodejs";
