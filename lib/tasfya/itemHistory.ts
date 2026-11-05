// Helpers for the خصومات page: comparing a buy with the usual, and the saved
// per-company item history (which buy lines to keep, how they merge, and how
// they roll up into one row per purchase).

import { productKey } from "./productKey";
import { bonusPercent } from "./report";
import { parseStock } from "./stock";
import { parseSupplyOrders } from "./supplyOrders";
import type { PurchaseLine } from "./types";

export type Status = "first" | "same" | "lower" | "higher";

export const round2 = (n: number) => Math.round(n * 100) / 100;

// Most common value; ties go to the most recent of the tied values (the
// purchases are passed newest first).
export function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  let bestCount = 0;
  for (const v of values) {
    const c = counts.get(v) ?? 0;
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

// Discount differences within ±1.5% of the usual count as the same.
export const DISCOUNT_MARGIN = 1.5;

export function compare(value: number, usual: number | null, margin = 0): Status {
  if (usual === null) return "first";
  if (Math.abs(value - usual) <= margin + 0.005) return "same";
  return value < usual ? "lower" : "higher";
}

/** The company and codes in an uploaded htm, per company: a supply order (أوامر
 *  توريد) names it as the order's المورد, a stock export on each row. */
export function companyCodes(
  matrix: string[][],
): { company: string; codes: string[] }[] {
  const orders = parseSupplyOrders(matrix);
  const rows =
    orders.length > 0
      ? orders.flatMap((o) =>
          o.items.map((it) => ({ company: o.supplier, code: it.code })),
        )
      : parseStock(matrix).map((it) => ({
          company: it.supplier,
          code: it.code,
        }));

  const byCompany = new Map<string, Set<string>>();
  for (const { company, code } of rows) {
    const name = company.trim();
    if (!name || !code) continue;
    const codes = byCompany.get(name);
    if (codes) codes.add(code);
    else byCompany.set(name, new Set([code]));
  }
  return [...byCompany].map(([company, codes]) => ({
    company,
    codes: [...codes],
  }));
}

/** The buy lines of the given codes, plus every other code of the same product
 *  (تشغيلات): the buy file can hold a code the user didn't list. `saved` lines
 *  count too, so a new price code is picked up even when the old code it replaced
 *  is no longer in the file. */
export function linesForCodes(
  lines: PurchaseLine[],
  codes: string[],
  saved: PurchaseLine[] = [],
): PurchaseLine[] {
  const wanted = new Set(codes);
  const keys = new Set(saved.map((l) => productKey(l.name)));
  for (const l of lines) {
    if (wanted.has(l.code)) keys.add(productKey(l.name));
  }
  return lines.filter(
    (l) => wanted.has(l.code) || keys.has(productKey(l.name)),
  );
}

const lineId = (l: PurchaseLine) =>
  [
    l.code,
    l.company,
    l.invoice,
    l.date,
    l.kmya,
    l.basicPct,
    l.extraPct,
    l.specialPct,
  ].join("|");

/** Adds incoming lines to the saved ones without double-counting an invoice that
 *  appears in more than one upload. A line legitimately repeated within one file
 *  is kept as many times as that file has it. */
export function mergeLines(
  saved: PurchaseLine[],
  incoming: PurchaseLine[],
): { lines: PurchaseLine[]; added: number } {
  const have = new Map<string, number>();
  for (const l of saved) {
    const id = lineId(l);
    have.set(id, (have.get(id) ?? 0) + 1);
  }
  const lines = [...saved];
  let added = 0;
  for (const l of incoming) {
    const id = lineId(l);
    const left = have.get(id) ?? 0;
    if (left > 0) {
      have.set(id, left - 1);
      continue;
    }
    lines.push(l);
    added++;
  }
  return { lines, added };
}

/** Splits lines into upload-sized batches. Identical lines stay in one batch,
 *  because mergeLines only tells repeats apart within a single merge. */
export function chunkLines(
  lines: PurchaseLine[],
  size: number,
): PurchaseLine[][] {
  const sorted = lines
    .map((l) => ({ l, id: lineId(l) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const chunks: PurchaseLine[][] = [];
  let current: PurchaseLine[] = [];
  let lastId = "";
  for (const { l, id } of sorted) {
    if (current.length >= size && id !== lastId) {
      chunks.push(current);
      current = [];
    }
    current.push(l);
    lastId = id;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** One purchase of one product on one invoice: its paid + بونص lines together. */
export type HistoryBuy = {
  id: string;
  date: string;
  invoice: string;
  distributor: string;
  codes: string[];
  paid: number;
  bonus: number;
  basic: number;
  extra: number;
  special: number;
  bonusPct: number;
  usualBasic: number | null;
  usualExtra: number | null;
  usualSpecial: number | null;
  usualBonus: number | null;
  basicStatus: Status;
  extraStatus: Status;
  specialStatus: Status;
  bonusStatus: Status;
};

/** One product (all its تشغيلات codes) with its purchases, newest first. */
export type HistoryItem = {
  key: string;
  name: string;
  codes: string[];
  buys: HistoryBuy[];
  /** Buys that came with less discount or bonus than usual. */
  issues: number;
};

export const isLowerBuy = (b: HistoryBuy) =>
  b.basicStatus === "lower" ||
  b.extraStatus === "lower" ||
  b.specialStatus === "lower" ||
  b.bonusStatus === "lower";

/** Rolls saved lines into items. The usual is per distributor, as on the
 *  Purchases tab; a bonus-only invoice has no discount to compare, so it is
 *  shown but left out of the usual. */
export function buildItems(lines: PurchaseLine[]): HistoryItem[] {
  const items = new Map<string, HistoryItem>();
  const buys = new Map<string, HistoryBuy>();

  for (const line of lines) {
    const key = productKey(line.name);
    if (!key) continue;
    let item = items.get(key);
    if (!item) {
      item = { key, name: line.name, codes: [], buys: [], issues: 0 };
      items.set(key, item);
    }
    const code = String(line.code ?? "").trim();
    if (code && !item.codes.includes(code)) item.codes.push(code);

    const distributor = (line.company ?? "").trim() || "—";
    const id = `${key}|${distributor}|${line.invoice}|${line.date}`;
    let buy = buys.get(id);
    if (!buy) {
      buy = {
        id,
        date: line.date,
        invoice: line.invoice,
        distributor,
        codes: [],
        paid: 0,
        bonus: 0,
        basic: 0,
        extra: 0,
        special: 0,
        bonusPct: 0,
        usualBasic: null,
        usualExtra: null,
        usualSpecial: null,
        usualBonus: null,
        basicStatus: "first",
        extraStatus: "first",
        specialStatus: "first",
        bonusStatus: "first",
      };
      buys.set(id, buy);
      item.buys.push(buy);
    }
    if (code && !buy.codes.includes(code)) buy.codes.push(code);
    if (line.basicPct === 100) {
      buy.bonus += line.kmya;
    } else {
      // Qty-weighted sums; turned into averages below.
      buy.paid += line.kmya;
      buy.basic += line.basicPct * line.kmya;
      buy.extra += line.extraPct * line.kmya;
      buy.special += line.specialPct * line.kmya;
    }
  }

  for (const item of items.values()) {
    for (const b of item.buys) {
      if (b.paid > 0) {
        b.basic = round2(b.basic / b.paid);
        b.extra = round2(b.extra / b.paid);
        b.special = round2(b.special / b.paid);
        b.bonusPct = bonusPercent(b.paid + b.bonus, b.bonus);
      }
    }
    // Newest first, so `mode` ties favour the latest terms.
    item.buys.sort((a, b) => b.date.localeCompare(a.date));

    const byDistributor = new Map<string, HistoryBuy[]>();
    for (const b of item.buys) {
      if (b.paid <= 0) continue;
      const list = byDistributor.get(b.distributor);
      if (list) list.push(b);
      else byDistributor.set(b.distributor, [b]);
    }
    for (const list of byDistributor.values()) {
      if (list.length < 2) continue;
      const usualBasic = mode(list.map((b) => b.basic));
      const usualExtra = mode(list.map((b) => b.extra));
      const usualSpecial = mode(list.map((b) => b.special));
      const usualBonus = mode(list.map((b) => b.bonusPct));
      for (const b of list) {
        b.usualBasic = usualBasic;
        b.usualExtra = usualExtra;
        b.usualSpecial = usualSpecial;
        b.usualBonus = usualBonus;
        b.basicStatus = compare(b.basic, usualBasic, DISCOUNT_MARGIN);
        b.extraStatus = compare(b.extra, usualExtra, DISCOUNT_MARGIN);
        b.specialStatus = compare(b.special, usualSpecial, DISCOUNT_MARGIN);
        b.bonusStatus = compare(b.bonusPct, usualBonus);
      }
    }
    item.issues = item.buys.filter(isLowerBuy).length;
  }

  return [...items.values()].sort(
    (a, b) => b.issues - a.issues || a.name.localeCompare(b.name, "ar"),
  );
}
