import { normalizeCompany } from "@/lib/expiry";
import { productKey } from "@/lib/tasfya/productKey";
import type { PurchaseLine, StockItem, SupplyOrder } from "@/lib/tasfya/types";

// The Orders page "Received" column: for one company, the FIRST date each
// distributor (إسم المورد on the Buy file) delivered that company's items.
//
// The Buy file doesn't carry the product's company, so a purchase line is
// attributed to the company when either:
//  - its code is one of the company's codes in the stock master (المورد), or
//  - its code / product key (تشغيلات-aware: price-generation tag stripped)
//    matches an item on the company's supply orders that month.
// When the company has supply orders, purchases before the earliest order date
// are ignored (same cutoff as the tasfya engine) so last cycle's deliveries
// don't show up as this order's. `since` ("YYYY/MM/DD", e.g. the order's send
// date) raises that cutoff further.

// `invoices` = the invoice numbers on that first date (a distributor can send
// more than one invoice the same day).
export type ReceivedDate = { supplier: string; date: string; invoices: string[] };

export function firstReceivedBySupplier(
  company: string,
  orders: SupplyOrder[],
  lines: PurchaseLine[],
  stock: StockItem[],
  since = "",
): ReceivedDate[] {
  const target = normalizeCompany(company);
  if (!target || lines.length === 0) return [];

  const codes = new Set<string>();
  const keys = new Set<string>();
  for (const it of stock) {
    if (normalizeCompany(it.supplier) === target) codes.add(it.code);
  }
  let cutoff = "";
  for (const o of orders) {
    if (normalizeCompany(o.supplier ?? "") !== target) continue;
    if (o.date && (!cutoff || o.date < cutoff)) cutoff = o.date;
    for (const it of o.items ?? []) {
      if (it.code) codes.add(String(it.code));
      const k = productKey(String(it.name ?? ""));
      if (k) keys.add(k);
    }
  }
  if (codes.size === 0 && keys.size === 0) return [];
  if (since > cutoff) cutoff = since;

  const first = new Map<string, { date: string; invoices: Set<string> }>();
  for (const line of lines) {
    if (!line.date || (cutoff && line.date < cutoff)) continue;
    const match =
      codes.has(String(line.code)) || keys.has(productKey(String(line.name ?? "")));
    if (!match) continue;
    const supplier = (line.company ?? "").trim() || "—";
    const invoice = String(line.invoice ?? "").trim();
    const prev = first.get(supplier);
    if (!prev || line.date < prev.date) {
      first.set(supplier, {
        date: line.date,
        invoices: new Set(invoice ? [invoice] : []),
      });
    } else if (line.date === prev.date && invoice) {
      prev.invoices.add(invoice);
    }
  }

  return [...first.entries()]
    .map(([supplier, f]) => ({
      supplier,
      date: f.date,
      invoices: [...f.invoices],
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.supplier.localeCompare(b.supplier, "ar"));
}
