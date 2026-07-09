// Client-side parsers for the "Contracts" page. These rely on the browser's
// DOMParser, so they must only be called from client components.
//
// Two kinds of file are involved:
//   1. Purchase-invoice exports ("سجل فواتير شراء الأصناف") — the same layout as
//      the sample the user provided: each product is a wide header row carrying
//      the item name + numeric code, followed by one or more purchase lines.
//   2. A "stock" export containing item codes. We extract those codes and use
//      them to filter the purchase lines down to items that exist in stock.

/** Column keys, kept in Arabic to match the source report exactly. */
export const CONTRACT_COLUMNS = {
  code: "كود الصنف",
  product: "اسم الصنف",
  branch: "الفرع",
  date: "تاريخ الحركة",
  supplier: "اسم المورد",
  invoice: "رقم فاتورة الشراء",
  qty: "كمية الوارد",
  basic: "أساسي",
  extra: "إضافي",
  special: "خاص",
  costNoTax: "تكلفة الوحدة بدون ض مبيعات",
  totalCost: "إجمالي تكلفة الوحدة",
  priceIncTax: "سعر الوحدة شامل الضريبة",
  salesTax: "ض مبيعات الوحدة",
  source: "ملف المصدر",
} as const;

/** Display order for the results table. */
export const CONTRACT_COLUMN_ORDER: string[] = [
  CONTRACT_COLUMNS.code,
  CONTRACT_COLUMNS.product,
  CONTRACT_COLUMNS.branch,
  CONTRACT_COLUMNS.date,
  CONTRACT_COLUMNS.supplier,
  CONTRACT_COLUMNS.invoice,
  CONTRACT_COLUMNS.qty,
  CONTRACT_COLUMNS.basic,
  CONTRACT_COLUMNS.extra,
  CONTRACT_COLUMNS.special,
  CONTRACT_COLUMNS.costNoTax,
  CONTRACT_COLUMNS.totalCost,
  CONTRACT_COLUMNS.priceIncTax,
  CONTRACT_COLUMNS.salesTax,
  CONTRACT_COLUMNS.source,
];

export type PurchaseRow = Record<string, string>;

const yieldToEventLoop = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

// Decode the handful of entities the report uses and strip any inline tags,
// then collapse whitespace. Avoids DOMParser so this stays fast and can run in
// chunks without blocking the UI on large files.
function cellText(inner: string): string {
  return inner
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

type Cellish = { colspan: number; text: string };

function extractCells(rowHtml: string): Cellish[] {
  const cells: Cellish[] = [];
  const cellRe = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(rowHtml)) !== null) {
    const span = /colspan\s*=\s*"?(\d+)/i.exec(m[1]);
    cells.push({ colspan: span ? Number(span[1]) : 1, text: cellText(m[2]) });
  }
  return cells;
}

// Numbers in the report use thousands separators (e.g. "3,400.0000"); strip
// them so values stay exact and sort numerically without rounding.
const cleanNumber = (s: string): string => s.replace(/,/g, "").trim();

/**
 * Parse a purchase-invoice HTML/HTM export into flat rows — one per purchase
 * line, with the product's code and name carried down from the header row
 * above it.
 *
 * Rows are processed incrementally and the loop yields to the event loop every
 * few hundred rows, so even multi-megabyte files never freeze the page.
 */
export async function parsePurchaseHtml(
  html: string,
  sourceName = "",
): Promise<PurchaseRow[]> {
  const rows: PurchaseRow[] = [];
  let currentCode = "";
  let currentProduct = "";

  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  let processed = 0;

  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells = extractCells(rowMatch[1]);
    if (cells.length > 0) {
      // Product header row: a wide (colspan=7) cell holds the item name, and
      // the item code sits in the last all-digits cell.
      const nameCell = cells.find((c) => c.colspan === 7 && c.text !== "");
      if (nameCell) {
        currentProduct = nameCell.text;
        const codeCell = [...cells].reverse().find((c) => /^\d+$/.test(c.text));
        currentCode = codeCell ? codeCell.text : "";
      } else if (cells.length === 12 && /\d{4}\/\d{2}\/\d{2}/.test(cells[10].text)) {
        // Purchase line: 12 cells with a date in the movement-date column.
        rows.push({
          [CONTRACT_COLUMNS.code]: currentCode,
          [CONTRACT_COLUMNS.product]: currentProduct,
          [CONTRACT_COLUMNS.branch]: cells[11].text,
          [CONTRACT_COLUMNS.date]: cells[10].text,
          [CONTRACT_COLUMNS.supplier]: cells[9].text,
          [CONTRACT_COLUMNS.invoice]: cells[8].text,
          [CONTRACT_COLUMNS.qty]: cleanNumber(cells[7].text),
          [CONTRACT_COLUMNS.basic]: cleanNumber(cells[6].text),
          [CONTRACT_COLUMNS.extra]: cleanNumber(cells[5].text),
          [CONTRACT_COLUMNS.special]: cleanNumber(cells[4].text),
          [CONTRACT_COLUMNS.costNoTax]: cleanNumber(cells[3].text),
          [CONTRACT_COLUMNS.totalCost]: cleanNumber(cells[2].text),
          [CONTRACT_COLUMNS.priceIncTax]: cleanNumber(cells[1].text),
          [CONTRACT_COLUMNS.salesTax]: cleanNumber(cells[0].text),
          [CONTRACT_COLUMNS.source]: sourceName,
        });
      }
    }
    if (++processed % 500 === 0) await yieldToEventLoop();
  }
  return rows;
}

// --- Quarterly buy totals -------------------------------------------------

export const QUARTER_LABELS = ["Q1", "Q2", "Q3", "Q4"] as const;
export const QUARTER_TOTAL_LABEL = "الإجمالي";

/** Column order for the quarterly totals table. */
export const QUARTERLY_COLUMNS: string[] = [
  CONTRACT_COLUMNS.code,
  CONTRACT_COLUMNS.product,
  ...QUARTER_LABELS,
  QUARTER_TOTAL_LABEL,
];

export type QuarterlyTotal = {
  code: string;
  product: string;
  /** Buy value per calendar quarter [Q1, Q2, Q3, Q4]. */
  quarters: [number, number, number, number];
  total: number;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Aggregate purchase lines into per-code buy totals split by calendar quarter
 * (from the month of تاريخ الحركة, year ignored).
 *
 * Buy value of a line = كمية الوارد × إجمالي تكلفة الوحدة. Bonus lines — where
 * أساسي (basic discount) is 100%, i.e. the item was free (بونص) — are excluded.
 */
export function computeQuarterlyTotals(rows: PurchaseRow[]): {
  totals: QuarterlyTotal[];
  bonusExcluded: number;
} {
  const map = new Map<string, { product: string; q: number[] }>();
  let bonusExcluded = 0;

  for (const r of rows) {
    if (Number(r[CONTRACT_COLUMNS.basic]) === 100) {
      bonusExcluded++;
      continue; // بونص — 100% discount, free of charge
    }
    const dm = /\d{4}\/(\d{2})\/\d{2}/.exec(r[CONTRACT_COLUMNS.date] ?? "");
    if (!dm) continue;
    const qi = Math.ceil(Number(dm[1]) / 3) - 1;
    if (qi < 0 || qi > 3) continue;

    const value =
      (Number(r[CONTRACT_COLUMNS.qty]) || 0) *
      (Number(r[CONTRACT_COLUMNS.totalCost]) || 0);

    const code = r[CONTRACT_COLUMNS.code];
    let entry = map.get(code);
    if (!entry) {
      entry = { product: r[CONTRACT_COLUMNS.product], q: [0, 0, 0, 0] };
      map.set(code, entry);
    }
    entry.q[qi] += value;
  }

  const totals: QuarterlyTotal[] = [...map.entries()].map(([code, e]) => ({
    code,
    product: e.product,
    quarters: [round2(e.q[0]), round2(e.q[1]), round2(e.q[2]), round2(e.q[3])],
    total: round2(e.q[0] + e.q[1] + e.q[2] + e.q[3]),
  }));

  return { totals, bonusExcluded };
}

// --- Per-code roll-ups (received qty / bonus) -----------------------------

export type CodeAggregate = {
  code: string;
  product: string;
  /** Distinct suppliers this code was received from, within the given rows. */
  suppliers: string[];
  /** Sum of كمية الوارد across the matching lines. */
  qty: number;
  /** Number of purchase lines that contributed. */
  lines: number;
};

/**
 * Group purchase lines by item code and sum كمية الوارد, keeping only lines
 * that satisfy `keep`. Used for the two "Purchase lines" sub-tabs:
 *   - received: paid lines (أساسي ≠ 100)
 *   - bonus (بونص): free lines (أساسي = 100)
 * Results are sorted by summed quantity, highest first.
 */
function aggregateByCode(
  rows: PurchaseRow[],
  keep: (row: PurchaseRow) => boolean,
): CodeAggregate[] {
  const map = new Map<
    string,
    { product: string; suppliers: Set<string>; qty: number; lines: number }
  >();

  for (const r of rows) {
    if (!keep(r)) continue;
    const code = r[CONTRACT_COLUMNS.code];
    let entry = map.get(code);
    if (!entry) {
      entry = {
        product: r[CONTRACT_COLUMNS.product],
        suppliers: new Set(),
        qty: 0,
        lines: 0,
      };
      map.set(code, entry);
    }
    const supplier = r[CONTRACT_COLUMNS.supplier];
    if (supplier) entry.suppliers.add(supplier);
    entry.qty += Number(r[CONTRACT_COLUMNS.qty]) || 0;
    entry.lines += 1;
  }

  return [...map.entries()]
    .map(([code, e]) => ({
      code,
      product: e.product,
      suppliers: [...e.suppliers].sort((a, b) => a.localeCompare(b, "ar")),
      qty: round2(e.qty),
      lines: e.lines,
    }))
    .sort((a, b) => b.qty - a.qty);
}

const isBonusLine = (r: PurchaseRow) =>
  Number(r[CONTRACT_COLUMNS.basic]) === 100;

/** Per-code received quantity from paid lines (أساسي ≠ 100). */
export function computeCodeReceipts(rows: PurchaseRow[]): CodeAggregate[] {
  return aggregateByCode(rows, (r) => !isBonusLine(r));
}

/** Per-code free quantity from bonus lines (بونص — أساسي = 100). */
export function computeCodeBonus(rows: PurchaseRow[]): CodeAggregate[] {
  return aggregateByCode(rows, isBonusLine);
}

// --- Insight metrics ------------------------------------------------------

export const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

export type Insights = {
  /** Buy value (EGP) per supplier, highest first. */
  bySupplier: { name: string; value: number }[];
  /** Buy value (EGP) per item, highest first. */
  topItems: { code: string; product: string; value: number }[];
  /** Buy value (EGP) per calendar month, index 0 = Jan … 11 = Dec. */
  byMonth: number[];
  /** Value (EGP) of bonus lines (أساسي = 100%), i.e. free goods received. */
  bonusValue: number;
  /** Units received on bonus lines. */
  bonusUnits: number;
  /** Units received on paid (non-bonus) lines. */
  paidUnits: number;
  /** Highest month index (0-based) that has any purchases, or -1 if none. */
  lastMonthWithData: number;
};

/**
 * One-pass roll-up of the matched purchase lines into the insight metrics.
 * Buy value of a paid line = كمية الوارد × إجمالي تكلفة الوحدة; bonus lines
 * (أساسي = 100%) are tracked separately as free-goods value.
 */
export function computeInsights(rows: PurchaseRow[]): Insights {
  const supplier = new Map<string, number>();
  const item = new Map<string, { product: string; value: number }>();
  const byMonth = new Array(12).fill(0) as number[];
  let bonusValue = 0;
  let bonusUnits = 0;
  let paidUnits = 0;
  let lastMonthWithData = -1;

  for (const r of rows) {
    const qty = Number(r[CONTRACT_COLUMNS.qty]) || 0;
    const value = qty * (Number(r[CONTRACT_COLUMNS.totalCost]) || 0);
    const isBonus = Number(r[CONTRACT_COLUMNS.basic]) === 100;

    if (isBonus) {
      bonusValue += value;
      bonusUnits += qty;
      continue;
    }
    paidUnits += qty;

    supplier.set(
      r[CONTRACT_COLUMNS.supplier],
      (supplier.get(r[CONTRACT_COLUMNS.supplier]) || 0) + value,
    );

    const code = r[CONTRACT_COLUMNS.code];
    const it = item.get(code);
    if (it) it.value += value;
    else item.set(code, { product: r[CONTRACT_COLUMNS.product], value });

    const dm = /\d{4}\/(\d{2})\/\d{2}/.exec(r[CONTRACT_COLUMNS.date] ?? "");
    if (dm) {
      const mi = Number(dm[1]) - 1;
      if (mi >= 0 && mi < 12) {
        byMonth[mi] += value;
        if (mi > lastMonthWithData) lastMonthWithData = mi;
      }
    }
  }

  const round2 = (v: number) => Math.round(v * 100) / 100;

  return {
    bySupplier: [...supplier.entries()]
      .map(([name, value]) => ({ name, value: round2(value) }))
      .sort((a, b) => b.value - a.value),
    topItems: [...item.entries()]
      .map(([code, e]) => ({ code, product: e.product, value: round2(e.value) }))
      .sort((a, b) => b.value - a.value),
    byMonth: byMonth.map(round2),
    bonusValue: round2(bonusValue),
    bonusUnits: round2(bonusUnits),
    paidUnits: round2(paidUnits),
    lastMonthWithData,
  };
}

/**
 * Extract item codes from a stock HTML/HTM export. In these reports the code
 * lives in the LAST column ("الكود") of each row — we must read only that cell.
 * The item-name column is full of embedded numbers (barcodes, "مثيل 131736"
 * equivalent-drug references, etc.); scanning the whole file would treat those
 * as codes and match almost everything, so we deliberately take just the last
 * non-empty cell of each row when it's all digits.
 */
export function extractStockCodes(html: string): string[] {
  const set = new Set<string>();
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells = extractCells(rowMatch[1]);
    for (let i = cells.length - 1; i >= 0; i--) {
      const t = cells[i].text;
      if (t === "") continue; // skip trailing empties
      if (/^\d+$/.test(t)) set.add(t); // the code column
      break; // only the last non-empty cell counts (never the name column)
    }
  }
  return [...set];
}
