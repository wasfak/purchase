import type { SupplyOrder, SupplyOrderItem } from "./types";

/** Normalize "YYYY/M/D" → zero-padded "YYYY/MM/DD" so dates sort as strings. */
function normDate(value: string): string {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value.trim());
  if (!m) return value.trim();
  return `${m[1]}/${m[2].padStart(2, "0")}/${m[3].padStart(2, "0")}`;
}

const isDate = (s: string): boolean => /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s.trim());

/** Truncate a SofTech numeric cell (strips thousands separators) to an int. */
function toInt(value: string): number {
  return Math.trunc(Number((value || "0").replace(/,/g, "")) || 0);
}

/**
 * Parses the "أوامر توريد الأصناف" multi-order supply report into its orders.
 *
 * After colspan expansion the body alternates two row shapes:
 *
 *  - Order-header row: date at col[10], supplier (المورد) at col[12], order
 *    number (رقم أمر التوريد) at col[16].
 *  - Item row: requested quantity (الكمية المطلوبة) at col[7], item name at
 *    col[14] (spans 8–15), item code at col[16] (spans 16–17).
 *
 * Header rows are recognized by a real date in col[10] (on item rows col[10]
 * holds part of the item name, never a date). Items attach to the most recent
 * order. Orders that end up with no items (e.g. stray header-like metadata rows)
 * are dropped, and lines for the same order number are merged.
 */
export function parseSupplyOrders(matrix: string[][]): SupplyOrder[] {
  const orders: SupplyOrder[] = [];
  const byNumber = new Map<string, SupplyOrder>();
  let current: SupplyOrder | null = null;

  for (const row of matrix) {
    if (!row || row.length === 0) continue;
    const col10 = (row[10] ?? "").trim();
    const col16 = (row[16] ?? "").trim();
    const codeIsNumeric = col16 !== "" && !Number.isNaN(Number(col16));

    // Header row: a date in col[10] plus an order number in col[16].
    if (isDate(col10) && codeIsNumeric) {
      const orderNumber = String(Number(col16));
      let order = byNumber.get(orderNumber);
      if (!order) {
        order = {
          orderNumber,
          supplier: (row[12] ?? "").trim(),
          date: normDate(col10),
          items: [],
        };
        byNumber.set(orderNumber, order);
        orders.push(order);
      }
      current = order;
      continue;
    }

    // Item row: numeric code in col[16], no date, a name present, under an order.
    if (!isDate(col10) && codeIsNumeric && current) {
      const name = (row[14] ?? "").trim();
      if (!name) continue;
      const item: SupplyOrderItem = {
        code: String(Number(col16)),
        name,
        order: toInt(row[7] ?? ""),
      };
      current.items.push(item);
    }
  }

  return orders.filter((o) => o.items.length > 0);
}
