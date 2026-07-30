// Parser + aggregation helpers for the "Expiry" page. These parse the SofTech
// "أصناف إقتربت تواريخ الصلاحية لها" (items with approaching expiry dates)
// report, exported as a .htm file with the fixed layout below.
//
// Each item is a single <tr> with nine logical cells (some carry a colspan):
//
//   الإجمالى | متوسط التكلفة | الكمية | تاريخ الصلاحية | سعر الشراء |
//   سعر البيع | الصنف | كود الصنف | المورد
//
// A parser stays regex-based (no DOMParser) so it can run from either a server
// or client component and chew through large files without freezing the page.

/** Column keys, kept in Arabic to match the source report exactly. */
export const EXPIRY_COLUMNS = {
  code: "كود الصنف",
  product: "الصنف",
  supplier: "المورد",
  expiry: "تاريخ الصلاحية",
  qty: "الكمية",
  avgCost: "متوسط التكلفة",
  buyPrice: "سعر الشراء",
  sellPrice: "سعر البيع",
  total: "الإجمالى",
  source: "ملف المصدر",
} as const;

export type ExpiryRow = {
  code: string;
  product: string;
  supplier: string;
  /** Expiry date as it appears in the report, "YYYY/MM/DD". */
  expiry: string;
  qty: number;
  avgCost: number;
  buyPrice: number;
  sellPrice: number;
  /** الإجمالى — cost value of this line as printed (≈ qty × avgCost). */
  total: number;
  source: string;
};

/**
 * Normalize a company / supplier name for matching: drop Arabic tatweel and
 * diacritics, collapse whitespace, and lowercase (so "PESCADO" == "pescado").
 * Shared by the Expiry and Orders tabs so a company lines up across both.
 */
export const normalizeCompany = (s: string): string =>
  s
    .replace(/ـ/g, "")
    .replace(/[ً-ٟ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

// Decode the handful of entities the report uses and strip any inline tags,
// then collapse whitespace.
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

function extractCells(rowHtml: string): string[] {
  const cells: string[] = [];
  const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(rowHtml)) !== null) cells.push(cellText(m[1]));
  return cells;
}

// Numbers may carry thousands separators (e.g. "3,400.00"); strip them so
// values stay exact and sort numerically.
const num = (s: string): number => Number(s.replace(/,/g, "").trim()) || 0;

const DATE_RE = /^\d{4}\/\d{1,2}\/\d{1,2}$/;

const yieldToEventLoop = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Parse an expiry HTML/HTM export into flat item rows. Item rows are the ones
 * with exactly nine cells whose 4th cell is a date and 8th cell is an all-digit
 * code — this skips the report header block and the "grand total" footer row.
 */
export async function parseExpiryHtml(
  html: string,
  sourceName = "",
): Promise<ExpiryRow[]> {
  const rows: ExpiryRow[] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  let processed = 0;

  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells = extractCells(rowMatch[1]);
    // cells: [total, avgCost, qty, expiry, buyPrice, sellPrice, name, code, supplier]
    if (
      cells.length === 9 &&
      DATE_RE.test(cells[3]) &&
      /^\d+$/.test(cells[7])
    ) {
      rows.push({
        total: num(cells[0]),
        avgCost: num(cells[1]),
        qty: num(cells[2]),
        expiry: cells[3],
        buyPrice: num(cells[4]),
        sellPrice: num(cells[5]),
        product: cells[6],
        code: cells[7],
        supplier: cells[8],
        source: sourceName,
      });
    }
    if (++processed % 500 === 0) await yieldToEventLoop();
  }
  return rows;
}

// --- Report header metadata ----------------------------------------------

export type ExpiryMeta = {
  store: string;
  dateFrom: string;
  dateTo: string;
};

// Strip Arabic tatweel (kashida) elongation so stretched labels like
// "إلــــــى" compare equal to "إلى".
const deTatweel = (s: string) => s.replace(/ـ/g, "");
const normLabel = (s: string) => deTatweel(s).replace(/[:：]/g, "").trim();

/**
 * Pull the store name and the "from / to" expiry range out of the report's
 * header block. Each is a value cell immediately preceding its RTL label cell.
 */
export function extractExpiryMeta(html: string): ExpiryMeta {
  const meta: ExpiryMeta = { store: "", dateFrom: "", dateTo: "" };
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  const prevValue = (cells: string[], i: number): string => {
    for (let j = i - 1; j >= 0; j--) if (cells[j] !== "") return cells[j];
    return "";
  };

  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells = extractCells(rowMatch[1]);
    cells.forEach((raw, i) => {
      const label = normLabel(raw);
      if (label === "المخزن" && !meta.store) meta.store = prevValue(cells, i);
      else if (label === "تاريخ صلاحية من" && !meta.dateFrom)
        meta.dateFrom = prevValue(cells, i);
      else if (label === "إلى" && !meta.dateTo)
        meta.dateTo = prevValue(cells, i);
    });
  }
  return meta;
}

// --- Netting duplicate / offsetting lines --------------------------------

const round2 = (v: number) => Math.round(v * 100) / 100;

// Sortable number for a "YYYY/MM/DD" expiry (soonest = smallest).
const expiryOrder = (s: string): number => {
  const [y, m, d] = s.split("/").map(Number);
  return (y || 0) * 10000 + (m || 0) * 100 + (d || 0);
};

/**
 * Collapse all lines of the same item (same supplier + code) into one, summing
 * quantity and cost value across expiry batches. This nets an item that appears
 * as both a negative and a positive line — a -0.67 and a +0.67 cancel to 0, a
 * -2 and a +5 become +3 — so each item shows its true remaining exposure.
 *
 * Items whose net quantity is 0 (fully offsetting +/- lines) are dropped: there
 * is nothing at risk. For the ones that remain, the displayed expiry is the
 * soonest batch that HASN'T expired yet (relative to `today`) — so the "days
 * remaining" reflects the next stock actually coming due, not a stale already-
 * expired batch. Only when every batch is already past do we fall back to the
 * most recent (least-expired) one.
 */
export function aggregateItems(rows: ExpiryRow[], today: Date): ExpiryRow[] {
  const todayOrder =
    today.getFullYear() * 10000 +
    (today.getMonth() + 1) * 100 +
    today.getDate();

  const map = new Map<
    string,
    { qty: number; total: number; positive: ExpiryRow[]; all: ExpiryRow[] }
  >();
  for (const r of rows) {
    const key = `${r.supplier} ${r.code}`;
    let g = map.get(key);
    if (!g) {
      g = { qty: 0, total: 0, positive: [], all: [] };
      map.set(key, g);
    }
    g.qty += r.qty;
    g.total += r.total;
    g.all.push(r);
    if (r.qty > 0) g.positive.push(r);
  }

  const out: ExpiryRow[] = [];
  for (const g of map.values()) {
    const qty = round2(g.qty);
    // Net ~0 — fully offsetting +/- lines, nothing at risk. The 0.05 cutoff
    // also drops rounding residue from third-of-a-pack quantities that the
    // source prints as 0.67 (e.g. 0.67 + 0.67 - 1.33 = 0.01). Real holdings are
    // never below 0.10, so no genuine stock is lost.
    if (Math.abs(qty) < 0.05) continue;
    const pool = g.positive.length > 0 ? g.positive : g.all;
    const future = pool.filter((l) => expiryOrder(l.expiry) >= todayOrder);
    const rep =
      future.length > 0
        ? // soonest batch still to come
          future.reduce((a, b) =>
            expiryOrder(b.expiry) < expiryOrder(a.expiry) ? b : a,
          )
        : // all expired — the most recent (least-expired) batch
          pool.reduce((a, b) =>
            expiryOrder(b.expiry) > expiryOrder(a.expiry) ? b : a,
          );
    out.push({ ...rep, qty, total: round2(g.total) });
  }
  return out;
}

// --- Per-company roll-up --------------------------------------------------

export type CompanyGroup = {
  company: string;
  /** Number of item lines (after aggregation). */
  items: number;
  /** Net units across the company's items. */
  units: number;
  /** Cost value at risk = Σ الإجمالى. */
  costValue: number;
  /** Retail value at risk = Σ (qty × sell price). */
  retailValue: number;
  /** How many item lines are already past their expiry date. */
  expired: number;
  /**
   * Soonest days-to-expiry among the company's items that HAVEN'T expired yet
   * (>= today). Null when the company has no upcoming (only expired) items.
   */
  nearestDays: number | null;
  /** The company's own item rows, for the detail popup. */
  rows: ExpiryRow[];
};

/** Group items by supplier (company) and roll up the value at risk per company. */
export function groupByCompany(
  rows: ExpiryRow[],
  today: Date,
): CompanyGroup[] {
  const map = new Map<string, CompanyGroup>();
  for (const r of rows) {
    const key = r.supplier || "—";
    let g = map.get(key);
    if (!g) {
      g = {
        company: key,
        items: 0,
        units: 0,
        costValue: 0,
        retailValue: 0,
        expired: 0,
        nearestDays: null,
        rows: [],
      };
      map.set(key, g);
    }
    const days = daysUntilExpiry(r, today);
    g.items += 1;
    g.units += r.qty;
    g.costValue += r.total;
    g.retailValue += r.qty * r.sellPrice;
    if (days < 0) g.expired += 1;
    // "Soonest" only tracks upcoming (not-yet-expired) items.
    if (days >= 0 && (g.nearestDays === null || days < g.nearestDays))
      g.nearestDays = days;
    g.rows.push(r);
  }
  return [...map.values()]
    .map((g) => ({
      ...g,
      units: round2(g.units),
      costValue: round2(g.costValue),
      retailValue: round2(g.retailValue),
    }))
    .sort((a, b) => b.costValue - a.costValue);
}

// --- Urgency / value-at-risk roll-ups ------------------------------------

/** Whole days from `today` until the row's expiry (negative = already past). */
export function daysUntilExpiry(row: ExpiryRow, today: Date): number {
  const [y, m, d] = row.expiry.split("/").map(Number);
  const expiry = new Date(y, (m || 1) - 1, d || 1);
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return Math.round((expiry.getTime() - start.getTime()) / 86_400_000);
}

export type UrgencyKey = "expired" | "d30" | "d60" | "d90" | "later";

export const URGENCY_ORDER: UrgencyKey[] = [
  "expired",
  "d30",
  "d60",
  "d90",
  "later",
];

export const URGENCY_LABELS: Record<UrgencyKey, string> = {
  expired: "Expired",
  d30: "≤ 30 days",
  d60: "31–60 days",
  d90: "61–90 days",
  later: "> 90 days",
};

export function urgencyOf(days: number): UrgencyKey {
  if (days < 0) return "expired";
  if (days <= 30) return "d30";
  if (days <= 60) return "d60";
  if (days <= 90) return "d90";
  return "later";
}

export type Bucket = {
  key: UrgencyKey;
  items: number;
  units: number;
  /** Cost value (الإجمالى) of the items in this bucket. */
  costValue: number;
};

export type SupplierRisk = {
  supplier: string;
  items: number;
  units: number;
  costValue: number;
  retailValue: number;
};

export type ExpirySummary = {
  items: number;
  units: number;
  /** Total cost value at risk = Σ الإجمالى. */
  costValue: number;
  /** Total retail value at risk = Σ (qty × sell price). */
  retailValue: number;
  buckets: Bucket[];
  bySupplier: SupplierRisk[];
};

/**
 * One pass over the parsed rows to produce the headline totals, urgency
 * buckets, and per-supplier risk — all relative to `today`.
 */
export function summarizeExpiry(
  rows: ExpiryRow[],
  today: Date,
): ExpirySummary {
  const buckets = new Map<UrgencyKey, Bucket>(
    URGENCY_ORDER.map((k) => [k, { key: k, items: 0, units: 0, costValue: 0 }]),
  );
  const supplier = new Map<string, SupplierRisk>();

  let units = 0;
  let costValue = 0;
  let retailValue = 0;

  for (const r of rows) {
    const retail = r.qty * r.sellPrice;
    units += r.qty;
    costValue += r.total;
    retailValue += retail;

    const b = buckets.get(urgencyOf(daysUntilExpiry(r, today)))!;
    b.items += 1;
    b.units += r.qty;
    b.costValue += r.total;

    const key = r.supplier || "—";
    let s = supplier.get(key);
    if (!s) {
      s = { supplier: key, items: 0, units: 0, costValue: 0, retailValue: 0 };
      supplier.set(key, s);
    }
    s.items += 1;
    s.units += r.qty;
    s.costValue += r.total;
    s.retailValue += retail;
  }

  return {
    items: rows.length,
    units: round2(units),
    costValue: round2(costValue),
    retailValue: round2(retailValue),
    buckets: URGENCY_ORDER.map((k) => {
      const b = buckets.get(k)!;
      return { ...b, units: round2(b.units), costValue: round2(b.costValue) };
    }),
    bySupplier: [...supplier.values()]
      .map((s) => ({
        ...s,
        units: round2(s.units),
        costValue: round2(s.costValue),
        retailValue: round2(s.retailValue),
      }))
      .sort((a, b) => b.costValue - a.costValue),
  };
}
