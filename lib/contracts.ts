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
 * Buy value of a line = كمية الوارد × سعر الوحدة شامل الضريبة. Bonus lines —
 * where أساسي (basic discount) is 100%, i.e. the item was free (بونص) — are
 * excluded.
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
      (Number(r[CONTRACT_COLUMNS.priceIncTax]) || 0);

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
 * Buy value of a paid line = كمية الوارد × سعر الوحدة شامل الضريبة; bonus lines
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
    const value = qty * (Number(r[CONTRACT_COLUMNS.priceIncTax]) || 0);
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

// --- Supplier margin (best deal per supplier / per item) ------------------
//
// In this report price ≈ cost on nearly every line, so profit does NOT come
// from a price−cost gap. It comes from the discounts (أساسي base, plus إضافي /
// خاص) and بونص (free units, أساسي = 100%). The "best" supplier is the one that
// hands back the most margin on the same items:
//
//   discount% of a paid line = 1 − (1−أساسي)(1−إضافي)(1−خاص)  [compounded]
//   bonus%   of a supplier   = free units ÷ paid units × 100
//   bonus value (EGP)        = free units × سعر الجمهور
//     where سعر الجمهور = price ÷ [(1−أساسي)(1−إضافي)(1−خاص)] — the report's
//     price column is the cost, so we divide the discounts back out.
//   credit%  of a supplier   = credit months (آجل) × monthly rate (≈1.4%)
//   margin%                  = weighted-avg discount% + bonus% + credit%
//
// discount% is weighted by line value (كمية الوارد × سعر الوحدة شامل الضريبة) so
// large buys count more than a single-unit line. credit% is the time value of
// deferred payment: a supplier that lets us pay 3 months later at 1.4%/month is
// effectively handing back ~4.2% — real margin, entered per supplier since the
// report carries no payment terms.

/** Per-supplier payment terms fed into the margin calc. */
export type CreditConfig = {
  /** Extra effective discount earned per month of credit, e.g. 1.4 (%). */
  monthlyRate: number;
  /** Supplier name → months of credit (آجل) they grant. */
  months: Record<string, number>;
};

export type SupplierMargin = {
  name: string;
  /** Units bought on paid (non-bonus) lines. */
  paidUnits: number;
  /** Σ qty × سعر الوحدة شامل الضريبة over paid lines (value bought). */
  spend: number;
  /** Value-weighted average of (أساسي + إضافي + خاص). */
  avgDiscountPct: number;
  /** Free units received on بونص lines (أساسي = 100%). */
  bonusUnits: number;
  /** bonusUnits ÷ paidUnits × 100. */
  bonusPct: number;
  /** EGP value of the free units (bonusUnits × the item's paid unit price). */
  bonusValue: number;
  /** Months of credit (آجل) configured for this supplier. */
  creditMonths: number;
  /** creditMonths × monthlyRate — margin from deferred payment. */
  creditPct: number;
  /** avgDiscountPct + bonusPct + creditPct — the headline margin figure. */
  marginPct: number;
  /** Distinct item codes bought from this supplier. */
  items: number;
};

export type ItemSupplierMargin = {
  supplier: string;
  paidUnits: number;
  spend: number;
  avgDiscountPct: number;
  bonusUnits: number;
  bonusPct: number;
  creditMonths: number;
  creditPct: number;
  marginPct: number;
};

export type ItemMargin = {
  code: string;
  product: string;
  /** Every supplier this code was bought from, best margin% first. */
  suppliers: ItemSupplierMargin[];
  /** The best-margin supplier, or null if the code had no paid lines. */
  best: ItemSupplierMargin | null;
  /** Margin% lead of the best supplier over the runner-up (0 if only one). */
  gap: number;
  /** Σ spend across suppliers — used to surface high-value items first. */
  spend: number;
};

type MarginAccum = {
  paidUnits: number;
  spend: number;
  discWeighted: number; // Σ discount% × lineValue
  bonusUnits: number;
};

const newAccum = (): MarginAccum => ({
  paidUnits: 0,
  spend: 0,
  discWeighted: 0,
  bonusUnits: 0,
});

function finishAccum(a: MarginAccum): {
  paidUnits: number;
  spend: number;
  avgDiscountPct: number;
  bonusUnits: number;
  bonusPct: number;
  marginPct: number;
} {
  const avgDiscountPct = a.spend > 0 ? a.discWeighted / a.spend : 0;
  const bonusPct = a.paidUnits > 0 ? (a.bonusUnits / a.paidUnits) * 100 : 0;
  return {
    paidUnits: round2(a.paidUnits),
    spend: round2(a.spend),
    avgDiscountPct: round2(avgDiscountPct),
    bonusUnits: round2(a.bonusUnits),
    bonusPct: round2(bonusPct),
    marginPct: round2(avgDiscountPct + bonusPct),
  };
}

/**
 * Roll purchase lines up into per-supplier and per-item margin figures so the
 * "Margin" view can rank who gives the best deal overall and for each code.
 */
export function computeSupplierMargins(
  rows: PurchaseRow[],
  credit?: CreditConfig,
): {
  bySupplier: SupplierMargin[];
  byItem: ItemMargin[];
} {
  const rate = credit?.monthlyRate ?? 0;
  const monthsOf = (name: string) => credit?.months?.[name] ?? 0;
  const creditPctOf = (name: string) => round2(monthsOf(name) * rate);
  const supplierMap = new Map<string, MarginAccum & { codes: Set<string> }>();
  const itemMap = new Map<
    string,
    { product: string; publicPrice: number; suppliers: Map<string, MarginAccum> }
  >();

  for (const r of rows) {
    const supplier = (r[CONTRACT_COLUMNS.supplier] ?? "").trim();
    if (!supplier) continue;
    const code = r[CONTRACT_COLUMNS.code];
    const qty = Number(r[CONTRACT_COLUMNS.qty]) || 0;
    const isBonus = Number(r[CONTRACT_COLUMNS.basic]) === 100;

    let sAcc = supplierMap.get(supplier);
    if (!sAcc) {
      sAcc = { ...newAccum(), codes: new Set() };
      supplierMap.set(supplier, sAcc);
    }
    let item = itemMap.get(code);
    if (!item) {
      item = {
        product: r[CONTRACT_COLUMNS.product] || "",
        publicPrice: 0,
        suppliers: new Map(),
      };
      itemMap.set(code, item);
    }
    let iAcc = item.suppliers.get(supplier);
    if (!iAcc) {
      iAcc = newAccum();
      item.suppliers.set(supplier, iAcc);
    }
    if (code) sAcc.codes.add(code);

    if (isBonus) {
      sAcc.bonusUnits += qty;
      iAcc.bonusUnits += qty;
      continue;
    }

    const price = Number(r[CONTRACT_COLUMNS.priceIncTax]) || 0;
    const lineValue = qty * price;
    // Discounts compound, they don't add: إضافي is taken off the price *after*
    // أساسي, and خاص after that. So the effective discount is
    //   1 − (1−أساسي)(1−إضافي)(1−خاص)
    // e.g. 10% + 5% + 2% = 16.21% effective, not 17%.
    const b = (Number(r[CONTRACT_COLUMNS.basic]) || 0) / 100;
    const e = (Number(r[CONTRACT_COLUMNS.extra]) || 0) / 100;
    const s = (Number(r[CONTRACT_COLUMNS.special]) || 0) / 100;
    const keptFraction = (1 - b) * (1 - e) * (1 - s);
    const discountPct = (1 - keptFraction) * 100;

    // The report's price column is the COST (سعر الجمهور × (1 − discounts)), not
    // the public price. Recover سعر الجمهور by dividing the discounts back out:
    //   سعر الجمهور = price ÷ [(1−أساسي)(1−إضافي)(1−خاص)]
    // It's invariant per item, so we keep the highest seen (guards rounding /
    // mid-year price changes). Bonus units are valued at this price.
    const publicPrice = keptFraction > 0 ? price / keptFraction : price;
    if (publicPrice > item.publicPrice) item.publicPrice = publicPrice;

    sAcc.paidUnits += qty;
    sAcc.spend += lineValue;
    sAcc.discWeighted += discountPct * lineValue;

    iAcc.paidUnits += qty;
    iAcc.spend += lineValue;
    iAcc.discWeighted += discountPct * lineValue;
  }

  // Bonus value (EGP) per supplier, summed across codes as we build byItem —
  // each code's free units × its سعر الجمهور (the item's highest unit price).
  const supplierBonusValue = new Map<string, number>();

  const byItem: ItemMargin[] = [...itemMap.entries()]
    .map(([code, e]) => {
      const publicPrice = e.publicPrice; // سعر الجمهور for this code
      const suppliers: ItemSupplierMargin[] = [...e.suppliers.entries()]
        .map(([supplier, a]) => {
          const base = finishAccum(a);
          const creditMonths = monthsOf(supplier);
          const creditPct = creditPctOf(supplier);
          const bonusValue = round2(a.bonusUnits * publicPrice);
          supplierBonusValue.set(
            supplier,
            (supplierBonusValue.get(supplier) ?? 0) + bonusValue,
          );
          return {
            supplier,
            ...base,
            bonusValue,
            creditMonths,
            creditPct,
            marginPct: round2(base.marginPct + creditPct),
          };
        })
        .sort((x, y) => y.marginPct - x.marginPct);
      const spend = round2(suppliers.reduce((s, x) => s + x.spend, 0));
      // Only suppliers with paid volume can be "best"; bonus-only rows still
      // show in the breakdown but never win the code on their own.
      const ranked = suppliers.filter((s) => s.paidUnits > 0);
      const best = ranked[0] ?? null;
      const gap =
        ranked.length >= 2
          ? round2(ranked[0].marginPct - ranked[1].marginPct)
          : 0;
      return { code, product: e.product, suppliers, best, gap, spend };
    })
    .filter((it) => it.best !== null)
    .sort((a, b) => b.spend - a.spend);

  const bySupplier: SupplierMargin[] = [...supplierMap.entries()]
    .map(([name, a]) => {
      const base = finishAccum(a);
      const creditMonths = monthsOf(name);
      const creditPct = creditPctOf(name);
      return {
        name,
        items: a.codes.size,
        ...base,
        bonusValue: round2(supplierBonusValue.get(name) ?? 0),
        creditMonths,
        creditPct,
        marginPct: round2(base.marginPct + creditPct),
      };
    })
    .sort((x, y) => y.marginPct - x.marginPct);

  return { bySupplier, byItem };
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
