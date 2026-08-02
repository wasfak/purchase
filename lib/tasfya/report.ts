import type {
  ExtraItem,
  OrderData,
  PurchaseDetail,
  PurchaseLine,
  ReportRow,
  StockSlice,
  SupplyOrderItem,
  TasfyaResult,
} from "./types";

// The settlement ("tasfya") engine, ported from the tasfya app. Dates here are
// normalized "YYYY/MM/DD" strings (zero-padded), so chronological comparison is
// a plain string compare — no Date objects needed.

/** A purchase line is a بونص (free goods) when أساسي = 100%. */
function isBonus(line: PurchaseLine): boolean {
  return line.basicPct === 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * بونص %: free units as a percentage of the *paid* units (paid = received −
 * bonus). Returns 0 when there's no bonus or nothing was paid for.
 */
export function bonusPercent(received: number, bonus: number): number {
  const paid = received - bonus;
  if (bonus <= 0 || paid <= 0) return 0;
  return Math.round((bonus / paid) * 10000) / 100;
}

/**
 * Keep only purchases dated on or after the reference date (the earliest order's
 * date). An empty reference date keeps everything. Matching to orders is by item
 * code only — the distributor is intentionally ignored.
 */
function normalizeByDate(
  purchases: PurchaseLine[],
  referenceDate: string,
): PurchaseLine[] {
  if (!referenceDate) return purchases;
  return purchases.filter((line) => line.date >= referenceDate);
}

interface Aggregate {
  code: string;
  name: string;
  supplier: string;
  received: number;
  bonus: number;
  basicPct: number;
  extraPct: number;
  specialPct: number;
  lines: PurchaseDetail[];
}

interface AggBuilder {
  code: string;
  name: string;
  suppliers: Set<string>;
  received: number;
  bonus: number;
  wBasic: number;
  wExtra: number;
  wSpecial: number;
  nonBonusQty: number;
  lines: Map<string, PurchaseDetail>;
}

function aggregateByCode(lines: PurchaseLine[]): Map<string, Aggregate> {
  const builders = new Map<string, AggBuilder>();

  for (const line of lines) {
    let b = builders.get(line.code);
    if (!b) {
      b = {
        code: line.code,
        name: line.name,
        suppliers: new Set(),
        received: 0,
        bonus: 0,
        wBasic: 0,
        wExtra: 0,
        wSpecial: 0,
        nonBonusQty: 0,
        lines: new Map(),
      };
      builders.set(line.code, b);
    }

    if (line.company) b.suppliers.add(line.company);
    const basicPct = round2(line.basicPct);
    const extraPct = round2(line.extraPct);
    const specialPct = round2(line.specialPct);
    // Merge lines from the same invoice sharing supplier, date and rates (i.e.
    // one purchase split across batches) into one, summing quantities.
    const key = `${line.company}||${line.invoice}||${line.date}||${basicPct}||${extraPct}||${specialPct}`;
    const existing = b.lines.get(key);
    if (existing) {
      existing.received += line.kmya;
    } else {
      b.lines.set(key, {
        supplier: line.company,
        invoice: line.invoice,
        date: line.date,
        received: line.kmya,
        basicPct,
        extraPct,
        specialPct,
      });
    }
    b.received += line.kmya;
    if (isBonus(line)) {
      b.bonus += line.kmya;
    } else {
      b.wBasic += line.basicPct * line.kmya;
      b.wExtra += line.extraPct * line.kmya;
      b.wSpecial += line.specialPct * line.kmya;
      b.nonBonusQty += line.kmya;
    }
  }

  const byCode = new Map<string, Aggregate>();
  for (const b of builders.values()) {
    const q = b.nonBonusQty || 1;
    byCode.set(b.code, {
      code: b.code,
      name: b.name,
      supplier: [...b.suppliers].join("، "),
      received: b.received,
      bonus: b.bonus,
      basicPct: b.nonBonusQty ? round2(b.wBasic / q) : 0,
      extraPct: b.nonBonusQty ? round2(b.wExtra / q) : 0,
      specialPct: b.nonBonusQty ? round2(b.wSpecial / q) : 0,
      lines: [...b.lines.values()],
    });
  }
  return byCode;
}

export function computeReport(
  order: OrderData,
  purchases: PurchaseLine[],
  stock: StockSlice,
): TasfyaResult {
  const normalized = normalizeByDate(purchases, order.referenceDate);
  const aggregates = aggregateByCode(normalized);

  const orderCodes = new Set(order.items.map((i) => i.code));

  // The same code can appear on more than one order line (a real line plus a
  // stray duplicate). Merge duplicates, summing the ordered quantity, so a
  // phantom surplus isn't invented.
  const mergedItems: SupplyOrderItem[] = [];
  const itemByCode = new Map<string, SupplyOrderItem>();
  for (const item of order.items) {
    const existing = itemByCode.get(item.code);
    if (existing) {
      existing.order += item.order;
    } else {
      const copy = { ...item };
      itemByCode.set(item.code, copy);
      mergedItems.push(copy);
    }
  }

  const report: ReportRow[] = mergedItems.map((item) => {
    const agg = aggregates.get(item.code);
    const received = agg?.received ?? 0;
    const bonus = agg?.bonus ?? 0;
    return {
      code: item.code,
      name: item.name,
      supplier: agg?.supplier ?? "",
      order: item.order,
      received,
      basicPct: agg?.basicPct ?? 0,
      extraPct: agg?.extraPct ?? 0,
      specialPct: agg?.specialPct ?? 0,
      bonus,
      tasfya: received - bonus - item.order,
      lines: agg?.lines ?? [],
    };
  });

  // Extra items: codes purchased this period that belong to the company (present
  // in its stock slice) but weren't ordered.
  const extraItems: ExtraItem[] = [];
  for (const agg of aggregates.values()) {
    if (orderCodes.has(agg.code)) continue;
    if (!stock.codes.has(agg.code)) continue;
    extraItems.push({
      code: agg.code,
      name: stock.byCode.get(agg.code)?.name || agg.name,
      supplier: agg.supplier,
      received: agg.received,
      basicPct: agg.basicPct,
      extraPct: agg.extraPct,
      specialPct: agg.specialPct,
      bonus: agg.bonus,
      lines: agg.lines,
    });
  }

  return {
    report,
    extraItems,
    supplierCompany: order.supplierCompany,
    referenceDate: order.referenceDate,
    orderNumber: order.orderNumber,
  };
}
