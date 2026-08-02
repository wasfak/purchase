import type { StockItem } from "./types";

/** Parses a SofTech numeric cell (strips thousands separators). */
function toNumber(value: string): number {
  return Number((value || "0").replace(/,/g, "")) || 0;
}

/**
 * Parses the store-wide stock / inventory export (رصيد المخزن). Unlike a single-
 * supplier file, this holds EVERY company's items, each row carrying its own
 * المورد (supplier) at col[5], so it can be sliced per company at settlement.
 *
 * Layout (after colspan expansion): each item is a ROWSPAN=2 pair — a 14+ column
 * data row followed by a short continuation row. Per data row:
 *   purchasePrice = col[3], salePrice = col[4], supplier (المورد) = col[5],
 *   balance = col[10], item name = col[12], code = col[13].
 * Header rows and 1-cell continuation rows (fewer than 14 columns, or a
 * non-numeric code) are skipped.
 */
export function parseStock(matrix: string[][]): StockItem[] {
  const items: StockItem[] = [];
  for (const row of matrix) {
    if (!row || row.length < 14) continue; // continuation row
    const rawCode = (row[13] ?? "").trim();
    if (!rawCode || Number.isNaN(Number(rawCode))) continue; // header row

    items.push({
      code: String(Number(rawCode)),
      name: (row[12] ?? "").trim(),
      supplier: (row[5] ?? "").trim(),
      purchasePrice: toNumber(row[3] ?? ""),
      salePrice: toNumber(row[4] ?? ""),
      balance: toNumber(row[10] ?? ""),
    });
  }
  return items;
}

/**
 * The codes (and by-code lookup) belonging to one company, matched on المورد
 * **exactly** (trimmed). Used to flag that company's over-order / extra items at
 * settlement time. First occurrence of a code wins.
 */
export function stockForCompany(
  items: StockItem[],
  company: string,
): { byCode: Map<string, StockItem>; codes: Set<string> } {
  const target = company.trim();
  const byCode = new Map<string, StockItem>();
  for (const it of items) {
    if (it.supplier.trim() !== target) continue;
    if (!byCode.has(it.code)) byCode.set(it.code, it);
  }
  return { byCode, codes: new Set(byCode.keys()) };
}
