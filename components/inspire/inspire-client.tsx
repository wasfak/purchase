"use client";

import * as React from "react";
import { toast } from "sonner";
import { Boxes, ChevronDown, ChevronRight, FileText, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  CONTRACT_COLUMNS,
  extractStockCodes,
  parsePurchaseHtml,
  type PurchaseRow,
} from "@/lib/contracts";

const HTML_ACCEPT = ".htm,.html";
const isHtml = (f: File) => /\.html?$/i.test(f.name);

const money = (v: number) =>
  `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} EGP`;
const qtyFmt = (v: number) =>
  v.toLocaleString(undefined, { maximumFractionDigits: 2 });

const isBonusLine = (r: PurchaseRow) =>
  Number(r[CONTRACT_COLUMNS.basic]) === 100;

/**
 * Whether a supplier name is فارما اوفر سيز. SofTech spellings vary (spaces,
 * أ/ا), so compare with spaces removed and alef forms unified.
 */
const PHARMA_OVERSEAS = "فارمااوفرسيز";
function isPharmaOverseas(name: string): boolean {
  const n = name.replace(/\s+/g, "").replace(/[أإآ]/g, "ا").toLowerCase();
  return n.includes(PHARMA_OVERSEAS) || n.includes("pharmaoverseas");
}

/**
 * Inspire offer slabs (letter of 2025/10/05). Each slab gives free goods on all
 * company items, and a higher rate on Vonaspire. Ordered by threshold.
 */
const SLABS = [
  { name: "الشريحة الأولى", min: 150_000, allPct: 3, vonaPct: 5 },
  { name: "الشريحة الثانية", min: 300_000, allPct: 5, vonaPct: 7 },
  { name: "الشريحة الثالثة", min: 500_000, allPct: 6, vonaPct: 10 },
] as const;

/**
 * The slab a value reaches (or null), and how much is left to the next one.
 * The value is rounded to the nearest 1,000 EGP first, so a month a few pounds
 * short (499,844) still reaches the slab; `shortBy` is what rounding covered.
 */
const SLAB_ROUNDING = 1_000;
function slabOf(value: number) {
  const rounded = Math.round(value / SLAB_ROUNDING) * SLAB_ROUNDING;
  let reached: (typeof SLABS)[number] | null = null;
  for (const s of SLABS) if (rounded >= s.min) reached = s;
  const next = SLABS.find((s) => rounded < s.min) ?? null;
  const shortBy = reached && value < reached.min ? reached.min - value : 0;
  return { reached, next, toNext: next ? next.min - value : 0, shortBy };
}

function SlabBadge({ value }: { value: number }) {
  const { reached, next, toNext, shortBy } = slabOf(value);
  return (
    <div className="flex flex-col items-start gap-0.5" dir="rtl">
      {reached ? (
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          ✓ {reached.name} · {reached.allPct}% (Vonaspire {reached.vonaPct}%)
        </span>
      ) : (
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
          لم تتحقق شريحة
        </span>
      )}
      {shortBy > 0 && (
        <span className="text-[11px] text-amber-700 dark:text-amber-400">
          بالتقريب · ناقص {money(shortBy)} فقط
        </span>
      )}
      {next && (
        <span className="text-[11px] text-muted-foreground">
          باقي {money(toNext)} لـ{next.name}
        </span>
      )}
    </div>
  );
}

/**
 * Free-goods rules per slab, exactly as in the offer letter: a % on every
 * Inspire item, a higher % on Vonaspire, and the minimum paid quantity the
 * rate starts from ("ابتداءً من 30+1" → minimum 30).
 */
const SLAB_RULES: Record<
  (typeof SLABS)[number]["name"],
  { all: { pct: number; min: number }; vona: { pct: number; min: number } }
> = {
  "الشريحة الأولى": { all: { pct: 3, min: 30 }, vona: { pct: 5, min: 20 } },
  "الشريحة الثانية": { all: { pct: 5, min: 20 }, vona: { pct: 7, min: 15 } },
  "الشريحة الثالثة": { all: { pct: 6, min: 15 }, vona: { pct: 10, min: 10 } },
};

const isVonaspire = (product: string) =>
  /vona\s*spire|فونا\s*سبير/i.test(product);

/**
 * Bonus owed on one item of an invoice. Below the minimum quantity nothing is
 * owed; from it on, qty × % rounded to the nearest unit — which reproduces
 * every ratio in the letter (30+1, 20+1, 15+1, 10+1, 30+2, 50+3).
 */
function expectedBonus(qty: number, rule: { pct: number; min: number }): number {
  if (qty < rule.min) return 0;
  return Math.round((qty * rule.pct) / 100);
}

/** "2026/8/7" → "2026/08/07", so dates compare correctly as strings. */
function normDate(d: string): string {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(d.trim());
  return m ? `${m[1]}/${m[2].padStart(2, "0")}/${m[3].padStart(2, "0")}` : d.trim();
}

/** "YYYY/MM" of a normalized date. */
const monthOf = (d: string) => d.slice(0, 7);

/** The last day ("YYYY/MM/31" is fine for comparison) of the month after `d`. */
function endOfNextMonth(d: string): string {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}/${String(nm).padStart(2, "0")}/31`;
}

/**
 * تشغيلات: when the price rises, the same product gets a NEW item code with a
 * price tag in its name — ت.ق (old price), ت.ج / ت.ج2 / ت.ج3 … (new prices),
 * ن.ج1 …, sometimes "كود جديد 139639". Strip those so every code of one
 * product groups into a single item (paid under ت.ق, بونص under ت.ج, etc.).
 */
const PRICE_TAG = /(^|\s)(ت\s*\.?\s*ق|ت\s*\.?\s*ج\s*\d*|ن\s*\.?\s*ج\s*\d*)(?=\s|$)/g;
/** The dotted forms, which are often glued to a word ("TABت.ج2", "ت.ج.1"). */
const DOTTED_PRICE_TAG = /ت\s*\.\s*ق|ت\s*\.\s*ج(?:\s*\.?\s*\d+)?|ن\s*\.\s*ج\s*\d*/g;
/** Arabic-Indic digits (ت.ج٢, ١١٤٤٥٣) → ASCII, so tags and codes match either way. */
const asciiDigits = (s: string) =>
  s.replace(/[٠-٩۰-۹]/g, (c) => String((c.charCodeAt(0) & 0xf) % 10));

/** The price tags found in a name (ت.ق, ت.ج2 …), for display. */
function priceTags(name: string): string[] {
  const product = asciiDigits(name);
  const tags = new Set<string>();
  for (const m of product.matchAll(DOTTED_PRICE_TAG)) tags.add(m[0].replace(/\s+/g, ""));
  for (const m of product.matchAll(PRICE_TAG)) tags.add(m[2].replace(/\s+/g, ""));
  return [...tags];
}

/**
 * مثيل: the codes after it are OTHER companies' equivalents (e.g. ARIPIPREX,
 * SCHIZOFY for ARIPIPRAZOLE) — never merged. The clause is cut off because its
 * text differs between codes of one product ("مثيل131065-…" vs "مثيل11").
 */
const MATHIL = /مثيل[\s\S]*$/;
/** Arabic dosage-form words some codes carry and others don't. */
const FORM_WORDS =
  /اقراص|أقراص|قرص|مغلفة|مغلفه|مغلقة|مكسوة|مكسوه|فوارة|فوار|كبسولات|كبسول|شراب|امبولات|امبول/g;
/** Cross-reference codes left at the end ("… TAB 133994 , 133701 , 131"). */
const TRAILING_CODES = /[\s,/-]*\d{5,}[\s\d,/-]*$/;
/**
 * Pack sizes: the same product in another pack size is one item, e.g.
 * "ARIPIPRAZOLE 10 MG 20 TAB" and "… 30 TAB", or "VONASPIRE 20 MG 28 TABح.ا"
 * and "… 30 TABح.ا". ح.ا (حجم آخر) marks some of them, but not reliably, so
 * every name groups without its pack count and quantities are converted by
 * tablet count (see buildMonths). The tag is often glued to the word before it.
 */
const SIZE_TAG = /ح\s*\.\s*[اأ]/g;
const PACK = /(\d+)\s*(?=(?:TABS?|CAPS?|AMPS?|VIALS?|SACHETS?|SUPP\w*)\b)/i;
/** Pack count of a name ("… 28 TAB" → 28), or 0 if it has none. */
function packSize(product: string): number {
  const m = PACK.exec(asciiDigits(product).replace(MATHIL, " "));
  return m ? Number(m[1]) : 0;
}
/** Short label telling one code of a product from its others: "30 TAB ح.ا ت.ج2". */
function codeLabel(product: string): string {
  const name = asciiDigits(product).replace(MATHIL, " ");
  const pack = /(\d+)\s*(TABS?|CAPS?|AMPS?|VIALS?|SACHETS?|SUPP\w*)\b/i.exec(name);
  return [
    pack ? `${pack[1]} ${pack[2].toUpperCase()}` : "",
    /ح\s*\.\s*[اأ]/.test(name) ? "ح.ا" : "",
    ...priceTags(name),
  ]
    .filter(Boolean)
    .join(" ");
}
/**
 * The product's name shared by all its codes: without the مثيل clause, تشغيلات
 * price tags, ح.ا, the pack count, dosage-form words, #…# markers and
 * trailing codes.
 * e.g. "ARIPIPRAZOLE 10 MG 20 TAB اقراص مغلفة ت.ج1 مثيل11" → "ARIPIPRAZOLE 10 MG TAB".
 */
function groupName(product: string): string {
  return asciiDigits(product)
    .replace(MATHIL, " ")
    .replace(SIZE_TAG, " ")
    .replace(PACK, " ")
    .replace(/كود\s*جديد\s*\d*/g, " ")
    .replace(DOTTED_PRICE_TAG, " ")
    .replace(PRICE_TAG, " ")
    .replace(FORM_WORDS, " ")
    .replace(/#[^#]*#/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(TRAILING_CODES, "")
    .replace(/[\s(,/.-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Grouping key for a purchase line: group name, or the code if nameless. */
const itemKey = (r: PurchaseRow) =>
  groupName(r[CONTRACT_COLUMNS.product] ?? "") || r[CONTRACT_COLUMNS.code];

/** A بونص delivery counted against a month's item. */
type BonusReceipt = { invoice: string; date: string; qty: number; code: string };

/** One Inspire item within a month: paid vs bonus owed vs bonus received. */
type MonthItem = {
  /** Grouping key (base name, تشغيلات merged). */
  key: string;
  /** Every item code of this product seen this month (ت.ق, ت.ج, …). */
  codes: string[];
  /**
   * Every code of this product in the data (any month, paid or بونص), with a
   * label telling them apart (pack size, ح.ا, price tag).
   */
  allCodes: { code: string; label: string; thisMonth: boolean }[];
  /** Base name, without the تشغيلات price tag. */
  product: string;
  /** Price tags seen on the merged codes, e.g. ["ت.ق", "ت.ج"]. */
  tags: string[];
  /** Pack sizes merged (e.g. [20, 30]); empty if the name has no pack count. */
  packs: number[];
  /** The pack size every quantity is expressed in (0 if none). */
  basePack: number;
  vonaspire: boolean;
  /** Paid units of this item across all the month's invoices. */
  paidUnits: number;
  /** Bonus % this item is owed this month (0 if the month has no slab). */
  pct: number;
  /** Minimum paid qty for the rate to apply. */
  min: number;
  expected: number;
  /** بونص allocated to this item (from this or any later month). */
  received: number;
  receipts: BonusReceipt[];
  /** max(0, expected − received). */
  missing: number;
  /**
   * Still within the waiting window: the data doesn't yet cover the end of the
   * month after this one, so a missing بونص may simply not have arrived.
   */
  pending: boolean;
};

/** One purchase invoice: the paid Inspire lines sharing supplier + number. */
type Invoice = {
  key: string;
  supplier: string;
  invoice: string;
  date: string;
  itemCount: number;
  paidUnits: number;
  /** بونص lines booked on this invoice number. */
  bonusUnits: number;
  /** Σ qty × سعر الوحدة شامل الضريبة over paid lines (أساسي ≠ 100). */
  value: number;
};

/** One calendar month ("YYYY/MM", by invoice date) and its offer result. */
type MonthTotal = {
  month: string;
  invoices: Invoice[];
  paidUnits: number;
  value: number;
  /** The slab the month's total value reaches. */
  slab: (typeof SLABS)[number] | null;
  items: MonthItem[];
  expected: number;
  /** بونص received (in this or any later month) against this month. */
  bonusUnits: number;
  missing: number;
  /** Missing units still inside the waiting window. */
  pendingMissing: number;
};

/**
 * Apply the offer per calendar month: the month's total paid value picks the
 * slab, and each item's بونص owed comes from its total paid qty that month.
 *
 * بونص usually arrives LATER, often the next month. So بونص lines are pooled
 * per item code and allocated oldest-first to that item's months still owed
 * بونص — never to a month after the بونص itself. Anything left over is surplus.
 * Invoices are kept (paid lines only) for the per-invoice listing.
 */
function buildMonths(rows: PurchaseRow[]): {
  months: MonthTotal[];
  invoices: Invoice[];
  surplus: number;
} {
  type InvAcc = Invoice & { codes: Set<string> };
  const invMap = new Map<string, InvAcc>();
  const monthItems = new Map<
    string,
    Map<
      string,
      { product: string; paid: number; codes: Set<string>; tags: Set<string>; packs: Set<number> }
    >
  >();
  const bonusByCode = new Map<string, BonusReceipt[]>();
  let dataEnd = "";

  // Pack sizes: each item's quantities are expressed in its most-bought pack
  // size, by tablet count (5 × 30 TAB = 150 tablets = 7.5 × 20 TAB).
  const packQty = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const pack = packSize(r[CONTRACT_COLUMNS.product] ?? "");
    if (!pack) continue;
    const group = itemKey(r);
    const sizes = packQty.get(group) ?? new Map<number, number>();
    sizes.set(pack, (sizes.get(pack) ?? 0) + (Number(r[CONTRACT_COLUMNS.qty]) || 0));
    packQty.set(group, sizes);
  }
  const basePack = new Map<string, number>();
  for (const [group, sizes] of packQty)
    basePack.set(group, [...sizes.entries()].sort((a, b) => b[1] - a[1])[0][0]);

  // Every code of each product, labelled, so merged codes show side by side.
  const productCodes = new Map<string, Map<string, string>>();
  for (const r of rows) {
    const group = itemKey(r);
    const codes = productCodes.get(group) ?? new Map<string, string>();
    const code = r[CONTRACT_COLUMNS.code];
    if (!codes.has(code)) codes.set(code, codeLabel(r[CONTRACT_COLUMNS.product] ?? ""));
    productCodes.set(group, codes);
  }

  for (const r of rows) {
    const date = normDate(r[CONTRACT_COLUMNS.date] ?? "");
    if (date > dataEnd) dataEnd = date;
    const code = r[CONTRACT_COLUMNS.code];
    const group = itemKey(r);
    // Boxes as booked (invoice listing, value) vs item units (بونص check).
    const qty = Number(r[CONTRACT_COLUMNS.qty]) || 0;
    const pack = packSize(r[CONTRACT_COLUMNS.product] ?? "");
    const base = basePack.get(group);
    const units = pack && base ? (qty * pack) / base : qty;
    const supplier = r[CONTRACT_COLUMNS.supplier] ?? "";
    const invoice = r[CONTRACT_COLUMNS.invoice] ?? "";
    const key = `${supplier}||${invoice}`;
    const bonus = isBonusLine(r);

    // Register the invoice on its first line, paid or بونص, so bonus-only
    // invoices are listed and bonus lines read before paid ones still count.
    let inv = invMap.get(key);
    if (!inv) {
      inv = {
        key,
        supplier,
        invoice,
        date,
        itemCount: 0,
        paidUnits: 0,
        bonusUnits: 0,
        value: 0,
        codes: new Set(),
      };
      invMap.set(key, inv);
    }
    inv.codes.add(code);

    if (bonus) {
      inv.bonusUnits += qty;
      const list = bonusByCode.get(group) ?? [];
      list.push({ invoice, date, qty: units, code });
      bonusByCode.set(group, list);
      continue;
    }

    inv.paidUnits += qty;
    inv.value += qty * (Number(r[CONTRACT_COLUMNS.priceIncTax]) || 0);

    const month = monthOf(date);
    let items = monthItems.get(month);
    if (!items) {
      items = new Map();
      monthItems.set(month, items);
    }
    const product = r[CONTRACT_COLUMNS.product] ?? "";
    const item = items.get(group) ?? {
      product: groupName(product) || product,
      paid: 0,
      codes: new Set<string>(),
      tags: new Set<string>(),
      packs: new Set<number>(),
    };
    item.paid += units;
    item.codes.add(code);
    for (const t of priceTags(product)) item.tags.add(t);
    if (pack) item.packs.add(pack);
    items.set(group, item);
  }

  const invoices: Invoice[] = [...invMap.values()]
    .map(({ codes, ...inv }) => ({ ...inv, itemCount: codes.size }))
    .sort((a, b) => b.value - a.value);

  // Months, with each item's بونص owed from the month's slab.
  // Bonus-only invoices stay out of the months: their بونص is allocated to the
  // months it pays for, and they'd otherwise add an empty month row.
  const monthMap = new Map<string, MonthTotal>();
  for (const inv of invoices) {
    if (inv.paidUnits === 0) continue;
    const month = monthOf(inv.date);
    let m = monthMap.get(month);
    if (!m) {
      m = {
        month,
        invoices: [],
        paidUnits: 0,
        value: 0,
        slab: null,
        items: [],
        expected: 0,
        bonusUnits: 0,
        missing: 0,
        pendingMissing: 0,
      };
      monthMap.set(month, m);
    }
    m.invoices.push(inv);
    m.paidUnits += inv.paidUnits;
    m.value += inv.value;
  }
  const months = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));
  for (const m of months) {
    m.slab = slabOf(m.value).reached;
    const rules = m.slab ? SLAB_RULES[m.slab.name] : null;
    m.items = [...(monthItems.get(m.month) ?? new Map()).entries()].map(
      ([key, it]) => {
        const vonaspire = isVonaspire(it.product);
        const rule = rules ? (vonaspire ? rules.vona : rules.all) : null;
        return {
          key,
          codes: [...it.codes].sort(),
          allCodes: [...(productCodes.get(key) ?? new Map<string, string>())]
            .map(([code, label]) => ({ code, label, thisMonth: it.codes.has(code) }))
            .sort((a, b) => a.label.localeCompare(b.label) || a.code.localeCompare(b.code)),
          product: it.product,
          tags: [...it.tags],
          packs: [...it.packs].sort((a, b) => a - b),
          basePack: basePack.get(key) ?? 0,
          vonaspire,
          paidUnits: it.paid,
          pct: rule?.pct ?? 0,
          min: rule?.min ?? 0,
          expected: rule ? expectedBonus(it.paid, rule) : 0,
          received: 0,
          receipts: [],
          missing: 0,
          pending: false,
        };
      },
    );
  }

  // Allocate each item's بونص, oldest first, to its oldest months still owed.
  const owedByCode = new Map<string, { month: string; item: MonthItem }[]>();
  for (const m of months)
    for (const item of m.items)
      if (item.expected > 0) {
        const list = owedByCode.get(item.key) ?? [];
        list.push({ month: m.month, item });
        owedByCode.set(item.key, list);
      }

  let surplus = 0;
  for (const [group, bonuses] of bonusByCode) {
    const owed = owedByCode.get(group) ?? []; // already in month order
    for (const b of [...bonuses].sort((x, y) => x.date.localeCompare(y.date))) {
      let left = b.qty;
      for (const o of owed) {
        if (left <= 0) break;
        if (o.month > monthOf(b.date)) break; // بونص can't pay for a later month
        const need = o.item.expected - o.item.received;
        if (need <= 0) continue;
        const take = Math.min(need, left);
        o.item.received += take;
        o.item.receipts.push({ invoice: b.invoice, date: b.date, qty: take, code: b.code });
        left -= take;
      }
      surplus += left;
    }
  }

  for (const m of months) {
    const waiting = dataEnd < endOfNextMonth(`${m.month}/01`);
    for (const item of m.items) {
      // Rounded: ح.ا conversions leave float dust (e.g. 6 − 5.999999).
      item.missing = Math.max(0, Math.round((item.expected - item.received) * 100) / 100);
      item.pending = item.missing > 0 && waiting;
    }
    m.items.sort((a, b) => b.missing - a.missing || b.paidUnits - a.paidUnits);
    m.expected = m.items.reduce((s, i) => s + i.expected, 0);
    m.bonusUnits = m.items.reduce((s, i) => s + i.received, 0);
    m.missing = m.items.reduce((s, i) => s + (i.pending ? 0 : i.missing), 0);
    m.pendingMissing = m.items.reduce((s, i) => s + (i.pending ? i.missing : 0), 0);
  }

  return { months, invoices, surplus };
}

/** Status pill: did the supplier send the بونص owed? */
function BonusStatus({
  expected,
  missing,
  pending,
}: {
  expected: number;
  missing: number;
  pending: number;
}) {
  if (expected === 0)
    return <span className="text-xs text-muted-foreground">لا يوجد بونص مستحق</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {missing > 0 && (
        <span className="rounded-full bg-red-500/15 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:text-red-400">
          ✗ لم يلتزم المورد · ناقص {qtyFmt(missing)}
        </span>
      )}
      {pending > 0 && (
        <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
          ⏳ في انتظار البونص · {qtyFmt(pending)}
        </span>
      )}
      {missing === 0 && pending === 0 && (
        <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
          ✓ البونص مستلم
        </span>
      )}
    </span>
  );
}

/** The expanded detail of one month: each item's بونص owed vs received. */
function MonthDetail({
  month,
  onRemove,
}: {
  month: MonthTotal;
  /** Drop item codes (all تشغيلات of a product) from the whole analysis. */
  onRemove: (codes: string[]) => void;
}) {
  if (!month.slab)
    return (
      <p className="bg-muted/20 px-4 py-3 text-xs text-muted-foreground" dir="rtl">
        إجمالي الشهر أقل من {money(SLABS[0].min)} — لا يوجد بونص مستحق حسب العرض.
      </p>
    );
  return (
    <div className="bg-muted/20 p-3">
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th className="whitespace-nowrap px-3 py-1.5 text-left">Code</th>
              <th className="min-w-64 px-3 py-1.5 text-left">Item</th>
              <th className="whitespace-nowrap px-3 py-1.5 text-left">Units bought (paid)</th>
              <th className="whitespace-nowrap px-3 py-1.5 text-left">Bonus rate</th>
              <th className="whitespace-nowrap px-3 py-1.5 text-left">Free units due</th>
              <th className="whitespace-nowrap px-3 py-1.5 text-left">Free units received</th>
              <th className="whitespace-nowrap px-3 py-1.5 text-left">How the free units arrived</th>
              <th className="whitespace-nowrap px-3 py-1.5 text-left">Shortfall</th>
              <th className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {month.items.map((it) => (
              <tr
                key={it.key}
                className={cn(
                  "border-t",
                  it.missing > 0 && (it.pending ? "bg-amber-500/5" : "bg-red-500/5"),
                )}
              >
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs tabular-nums text-muted-foreground">
                  {it.allCodes.length > 1
                    ? it.allCodes.map((c) => (
                        <div
                          key={c.code}
                          className={cn(!c.thisMonth && "opacity-50")}
                          title={c.thisMonth ? undefined : "Not bought (paid) this month"}
                        >
                          {c.code}
                          {c.label && (
                            <span className="ms-1.5 font-sans text-[11px]" dir="auto">
                              {c.label}
                            </span>
                          )}
                        </div>
                      ))
                    : it.codes.map((c) => <div key={c}>{c}</div>)}
                </td>
                <td className="px-3 py-2">
                  <span dir="auto">{it.product}</span>
                  {it.codes.length > 1 && (
                    <span
                      className="ms-2 rounded bg-amber-500/15 px-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
                      title="Same product under several price codes (تشغيلات), merged into one item"
                    >
                      تشغيلات {it.tags.join(" + ") || `${it.codes.length} codes`}
                    </span>
                  )}
                  {it.packs.length === 1 && (
                    <span className="ms-2 text-xs text-muted-foreground">
                      {it.packs[0]}/pack
                    </span>
                  )}
                  {it.packs.length > 1 && (
                    <span
                      className="ms-2 rounded bg-sky-500/15 px-1.5 text-[11px] font-medium text-sky-700 dark:text-sky-400"
                      title="حجم آخر: pack sizes merged by tablet count"
                    >
                      ح.ا {it.packs.join(" + ")} · in {it.basePack}-packs
                    </span>
                  )}
                  {it.vonaspire && (
                    <span className="ms-2 rounded bg-primary/10 px-1.5 text-[11px] font-medium">
                      Vonaspire
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{qtyFmt(it.paidUnits)}</td>
                <td className="min-w-40 whitespace-nowrap px-3 py-2 tabular-nums">
                  <span className="font-semibold">{it.pct}%</span>
                  <span className="ms-2 text-xs text-muted-foreground">
                    from {it.min} units
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-semibold tabular-nums">
                  {it.expected > 0 ? (
                    qtyFmt(it.expected)
                  ) : (
                    <span className="font-normal text-muted-foreground">
                      0 · under {it.min} units
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {it.received > 0 ? qtyFmt(it.received) : "—"}
                </td>
                <td className="min-w-72 px-3 py-2 text-xs">
                  {it.receipts.length > 0 ? (
                    <ul className="space-y-1">
                      {it.receipts.map((r, i) => (
                        <li key={i} className="tabular-nums">
                          <span className="font-semibold text-foreground">
                            {qtyFmt(r.qty)} free
                          </span>
                          <span className="text-muted-foreground">
                            {" "}on {r.date} · invoice {r.invoice}
                            {(it.codes.length > 1 || r.code !== it.codes[0]) && (
                              <> · code {r.code}</>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-muted-foreground">{it.expected > 0 ? "Not received yet" : "—"}</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                  {it.missing > 0 ? (
                    <span
                      className={cn(
                        "font-semibold",
                        it.pending
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-red-600 dark:text-red-400",
                      )}
                    >
                      −{qtyFmt(it.missing)}
                      {it.pending && " ⏳"}
                    </span>
                  ) : it.expected > 0 ? (
                    <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => onRemove(it.allCodes.map((c) => c.code))}
                    title="Remove this item from the analysis"
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600"
                  >
                    <X className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** One distributor found in the matched lines, with its paid value. */
type SupplierInfo = { name: string; lines: number; value: number };

// Multi-select supplier filter (chips). Deselecting a supplier drops its lines
// from the invoices below.
function SupplierChips({
  suppliers,
  excluded,
  onToggle,
  onSelectAll,
  onClear,
}: {
  suppliers: SupplierInfo[];
  excluded: Set<string>;
  onToggle: (name: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const kept = suppliers.filter((s) => !excluded.has(s.name)).length;
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          Suppliers ({kept} of {suppliers.length} selected)
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onSelectAll} disabled={kept === suppliers.length}>
            Select all
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear} disabled={kept === 0}>
            Clear
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2" dir="rtl">
        {suppliers.map((s) => {
          const isExcluded = excluded.has(s.name);
          return (
            <button
              key={s.name}
              type="button"
              onClick={() => onToggle(s.name)}
              aria-pressed={!isExcluded}
              title={`${s.lines.toLocaleString()} lines · ${money(s.value)}`}
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                isExcluded
                  ? "border-border text-muted-foreground line-through opacity-60 hover:opacity-100"
                  : "border-primary/40 bg-primary/10 text-foreground hover:bg-primary/20",
              )}
            >
              <span>{s.name || "(بدون مورد)"}</span>
              <span className="tabular-nums text-muted-foreground" dir="ltr">
                {money(s.value)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DropZone({
  icon: Icon,
  title,
  hint,
  active,
  summary,
  onFiles,
}: {
  icon: typeof FileText;
  title: string;
  hint: string;
  active: boolean;
  summary: React.ReactNode;
  onFiles: (files: File[]) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length) onFiles(files);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
        active
          ? "border-primary/50 bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-muted/40",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={HTML_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
      <div className="rounded-full bg-muted p-3">
        <Icon className="size-6 text-primary" />
      </div>
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{hint}</p>
      {summary}
    </div>
  );
}

export function InspireClient() {
  const [purchaseRows, setPurchaseRows] = React.useState<PurchaseRow[]>([]);
  const [purchaseFiles, setPurchaseFiles] = React.useState<string[]>([]);
  const [stockCodes, setStockCodes] = React.useState<string[] | null>(null);
  const [stockFiles, setStockFiles] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  // The per-invoice table is hidden by default; the monthly totals are the view.
  const [showInvoices, setShowInvoices] = React.useState(false);
  // The month whose invoices / بونص check are expanded.
  const [openMonth, setOpenMonth] = React.useState<string | null>(null);
  // Item codes the user removed; they drop out of every month and total.
  const [removedCodes, setRemovedCodes] = React.useState<Set<string>>(new Set());
  const removeCode = (codes: string[]) =>
    setRemovedCodes((prev) => new Set([...prev, ...codes]));
  const restoreCode = (code: string) =>
    setRemovedCodes((prev) => {
      const next = new Set(prev);
      next.delete(code);
      return next;
    });
  // Suppliers the user removed; their lines drop out of the invoices.
  const [excludedSuppliers, setExcludedSuppliers] = React.useState<Set<string>>(
    new Set(),
  );

  const addPurchaseFiles = async (files: File[]) => {
    const htmls = files.filter(isHtml);
    if (htmls.length === 0) {
      toast.error("Please choose .htm or .html purchase files.");
      return;
    }
    setBusy(true);
    try {
      const parsed: PurchaseRow[] = [];
      for (const file of htmls) {
        const rows = await parsePurchaseHtml(await file.text(), file.name);
        if (rows.length === 0)
          toast.warning(`No purchase lines found in ${file.name}`);
        for (const row of rows) parsed.push(row);
      }
      setPurchaseRows((prev) => [...prev, ...parsed]);
      setPurchaseFiles((prev) => [...prev, ...htmls.map((f) => f.name)]);
      toast.success(`Loaded ${parsed.length.toLocaleString()} purchase lines`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read a purchase file.");
    } finally {
      setBusy(false);
    }
  };

  const addStockFiles = async (files: File[]) => {
    const htmls = files.filter(isHtml);
    if (htmls.length === 0) {
      toast.error("Please choose .htm or .html stock files.");
      return;
    }
    setBusy(true);
    try {
      const merged = new Set<string>();
      for (const file of htmls) {
        const codes = extractStockCodes(await file.text());
        if (codes.length === 0)
          toast.warning(`No item codes were detected in ${file.name}`);
        for (const c of codes) merged.add(c);
      }
      setStockCodes([...merged]);
      setStockFiles(htmls.map((f) => f.name));
      toast.success(`Detected ${merged.size.toLocaleString()} stock codes`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read a stock file.");
    } finally {
      setBusy(false);
    }
  };

  const clearAll = () => {
    setPurchaseRows([]);
    setPurchaseFiles([]);
    setStockCodes(null);
    setStockFiles([]);
    setExcludedSuppliers(new Set());
    setRemovedCodes(new Set());
  };

  const toggleSupplier = (name: string) =>
    setExcludedSuppliers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  // Purchase lines whose item code is one of the uploaded Inspire stock codes,
  // plus the other codes of those products (تشغيلات, ح.ا) — e.g. بونص booked
  // under a 30 TAB code the stock file doesn't list.
  const matchedRows = React.useMemo(() => {
    if (!stockCodes) return [];
    const set = new Set(stockCodes);
    const groups = new Set(
      purchaseRows.filter((r) => set.has(r[CONTRACT_COLUMNS.code])).map(itemKey),
    );
    return purchaseRows.filter(
      (r) => set.has(r[CONTRACT_COLUMNS.code]) || groups.has(itemKey(r)),
    );
  }, [purchaseRows, stockCodes]);

  // Unique suppliers in the matched lines, biggest paid value first.
  const suppliers = React.useMemo<SupplierInfo[]>(() => {
    const map = new Map<string, SupplierInfo>();
    for (const r of matchedRows) {
      const name = r[CONTRACT_COLUMNS.supplier] ?? "";
      let s = map.get(name);
      if (!s) {
        s = { name, lines: 0, value: 0 };
        map.set(name, s);
      }
      s.lines += 1;
      if (!isBonusLine(r))
        s.value +=
          (Number(r[CONTRACT_COLUMNS.qty]) || 0) *
          (Number(r[CONTRACT_COLUMNS.priceIncTax]) || 0);
    }
    return [...map.values()].sort((a, b) => b.value - a.value);
  }, [matchedRows]);

  // Default selection: only فارما اوفر سيز. Re-applied whenever the set of
  // suppliers changes (a new upload); the chips can still override it.
  const supplierKey = suppliers.map((s) => s.name).join("|");
  React.useEffect(() => {
    setExcludedSuppliers(
      new Set(
        supplierKey
          .split("|")
          .filter((name) => supplierKey !== "" && !isPharmaOverseas(name)),
      ),
    );
  }, [supplierKey]);

  const keptRows = React.useMemo(
    () =>
      matchedRows.filter(
        (r) =>
          !excludedSuppliers.has(r[CONTRACT_COLUMNS.supplier] ?? "") &&
          !removedCodes.has(r[CONTRACT_COLUMNS.code]),
      ),
    [matchedRows, excludedSuppliers, removedCodes],
  );

  // Names of the removed codes, for the restore chips.
  const removedItems = React.useMemo(() => {
    const names = new Map<string, string>();
    for (const r of matchedRows) {
      const code = r[CONTRACT_COLUMNS.code];
      if (removedCodes.has(code) && !names.has(code))
        names.set(code, r[CONTRACT_COLUMNS.product] ?? "");
    }
    return [...removedCodes].map((code) => ({ code, product: names.get(code) ?? "" }));
  }, [matchedRows, removedCodes]);

  const { months, invoices, surplus } = React.useMemo(
    () => buildMonths(keptRows),
    [keptRows],
  );
  const monthsTotal = React.useMemo(
    () =>
      months.reduce(
        (t, m) => ({
          invoices: t.invoices + m.invoices.length,
          value: t.value + m.value,
          expected: t.expected + m.expected,
          bonusUnits: t.bonusUnits + m.bonusUnits,
          missing: t.missing + m.missing,
          pendingMissing: t.pendingMissing + m.pendingMissing,
        }),
        { invoices: 0, value: 0, expected: 0, bonusUnits: 0, missing: 0, pendingMissing: 0 },
      ),
    [months],
  );

  const ready = purchaseRows.length > 0 && stockCodes !== null;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <DropZone
          icon={FileText}
          title="Purchase invoice files"
          hint="Click or drag one or more .htm / .html files (سجل فواتير شراء الأصناف)"
          active={purchaseFiles.length > 0}
          onFiles={addPurchaseFiles}
          summary={
            purchaseFiles.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {purchaseFiles.length} file{purchaseFiles.length === 1 ? "" : "s"} ·{" "}
                {purchaseRows.length.toLocaleString()} lines
              </p>
            )
          }
        />
        <DropZone
          icon={Boxes}
          title="Stock items (Inspire codes)"
          hint="Click or drag the stock .htm / .html export of Inspire items"
          active={stockCodes !== null}
          onFiles={addStockFiles}
          summary={
            stockCodes && (
              <p className="text-xs text-muted-foreground">
                {stockFiles.length === 1 ? stockFiles[0] : `${stockFiles.length} files`} ·{" "}
                {stockCodes.length.toLocaleString()} codes
              </p>
            )
          }
        />
      </div>

      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Reading files…
        </div>
      )}

      {(purchaseFiles.length > 0 || stockCodes) && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={clearAll}>
            <X /> Clear
          </Button>
        </div>
      )}

      {ready && (
        <div className="space-y-3">
          {suppliers.length > 0 && (
            <SupplierChips
              suppliers={suppliers}
              excluded={excludedSuppliers}
              onToggle={toggleSupplier}
              onSelectAll={() => setExcludedSuppliers(new Set())}
              onClear={() =>
                setExcludedSuppliers(new Set(suppliers.map((s) => s.name)))
              }
            />
          )}

          <p className="text-sm text-muted-foreground">
            {matchedRows.length.toLocaleString()} of{" "}
            {purchaseRows.length.toLocaleString()} purchase lines match the
            stock codes · {keptRows.length.toLocaleString()} from selected
            suppliers · {invoices.length} invoice
            {invoices.length === 1 ? "" : "s"}
          </p>

          {removedItems.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">
                  Removed items ({removedItems.length}) · click to bring back
                </div>
                <Button size="sm" variant="ghost" onClick={() => setRemovedCodes(new Set())}>
                  Restore all
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {removedItems.map((it) => (
                  <button
                    key={it.code}
                    type="button"
                    onClick={() => restoreCode(it.code)}
                    className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground line-through opacity-70 transition-opacity hover:opacity-100"
                  >
                    <span className="font-mono">{it.code}</span>
                    <span dir="auto">{it.product}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {months.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-bold">Per month · اضغط على الشهر لعرض البونص</h2>
              <p className="text-xs text-muted-foreground" dir="rtl">
                البونص يُحتسب على فواتير الشهر حتى لو وصل في شهر لاحق (الأقدم أولاً لكل صنف).
                الشريحة حسب إجمالي الشهر. «في انتظار» = البيانات لا تغطي نهاية الشهر التالي بعد.
                {surplus > 0 && <> · بونص زائد غير مرتبط بشهر مستحق: {qtyFmt(surplus)}</>}
              </p>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Month</th>
                      <th className="px-3 py-2 text-left">Invoices</th>
                      <th className="px-3 py-2 text-left">Purchase value</th>
                      <th className="px-3 py-2 text-left">Offer slab</th>
                      <th className="px-3 py-2 text-left">Free units due</th>
                      <th className="px-3 py-2 text-left">Free units received</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((m) => {
                      const open = openMonth === m.month;
                      return (
                        <React.Fragment key={m.month}>
                          <tr
                            onClick={() => setOpenMonth(open ? null : m.month)}
                            className={cn(
                              "cursor-pointer border-t hover:bg-muted/40",
                              open && "bg-muted/40",
                            )}
                          >
                            <td className="px-3 py-2 font-medium tabular-nums">
                              <span className="inline-flex items-center gap-1">
                                {open ? (
                                  <ChevronDown className="size-4" />
                                ) : (
                                  <ChevronRight className="size-4" />
                                )}
                                {m.month}
                              </span>
                            </td>
                            <td className="px-3 py-2 tabular-nums">{m.invoices.length}</td>
                            <td className="px-3 py-2 font-semibold tabular-nums">{money(m.value)}</td>
                            <td className="px-3 py-2"><SlabBadge value={m.value} /></td>
                            <td className="px-3 py-2 tabular-nums">
                              {m.expected > 0 ? qtyFmt(m.expected) : "—"}
                            </td>
                            <td className="px-3 py-2 tabular-nums">
                              {m.bonusUnits > 0 ? qtyFmt(m.bonusUnits) : "—"}
                            </td>
                            <td className="px-3 py-2">
                              <BonusStatus expected={m.expected} missing={m.missing} pending={m.pendingMissing} />
                            </td>
                          </tr>
                          {open && (
                            <tr>
                              <td colSpan={7} className="p-0">
                                <MonthDetail month={m} onRemove={removeCode} />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    <tr className="border-t bg-muted/30 font-bold">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 tabular-nums">{monthsTotal.invoices}</td>
                      <td className="px-3 py-2 tabular-nums">{money(monthsTotal.value)}</td>
                      <td className="px-3 py-2" />
                      <td className="px-3 py-2 tabular-nums">
                        {monthsTotal.expected > 0 ? qtyFmt(monthsTotal.expected) : "—"}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {monthsTotal.bonusUnits > 0 ? qtyFmt(monthsTotal.bonusUnits) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <BonusStatus
                          expected={monthsTotal.expected}
                          missing={monthsTotal.missing}
                          pending={monthsTotal.pendingMissing}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowInvoices((v) => !v)}
          >
            {showInvoices ? <ChevronDown /> : <ChevronRight />}
            {showInvoices ? "Hide invoices" : `Show invoices (${invoices.length})`}
          </Button>
          {showInvoices && (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Supplier</th>
                  <th className="px-3 py-2 text-left">Invoice #</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Items</th>
                  <th className="px-3 py-2 text-left">Units bought (paid)</th>
                  <th className="px-3 py-2 text-left">Free units</th>
                  <th className="px-3 py-2 text-left">Invoice value</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.key} className="border-t">
                    <td className="px-3 py-2" dir="rtl">{inv.supplier}</td>
                    <td className="px-3 py-2 tabular-nums">{inv.invoice}</td>
                    <td className="px-3 py-2 tabular-nums">{inv.date}</td>
                    <td className="px-3 py-2 tabular-nums">{inv.itemCount}</td>
                    <td className="px-3 py-2 tabular-nums">{qtyFmt(inv.paidUnits)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {inv.bonusUnits > 0 ? qtyFmt(inv.bonusUnits) : "—"}
                    </td>
                    <td className="px-3 py-2 font-semibold tabular-nums">
                      {money(inv.value)}
                    </td>
                  </tr>
                ))}
                {invoices.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                      {matchedRows.length === 0 ? "No purchase lines match the uploaded stock codes." : "No invoices from the selected suppliers."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          )}
        </div>
      )}
    </div>
  );
}
