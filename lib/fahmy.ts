// Analysis engine for the "Fahmy" page. The user uploads a workbook with the
// exact layout of the sample يونيلفر.xlsx — two sheets:
//
//   • SALES — a pivot export, one row per item code, columns:
//       1 كــــود (code) · 2 الصـــنف (name)
//       3 qty 2025 · 4 qty 2026 · 5 qty YoY (decimal) · 6 QTY PURCHASE
//       7 value 2025 · 8 value 2026 · 9 value YoY (decimal) · 10 VALUE PURCHASE
//     Pivot subtotal rows and the "Grand Total" row have a blank code and are
//     skipped. Below the data sit two extra blocks:
//       - "NET PURCHASE BEFORE TAX" in col 10 of its row
//       - a target table (SLAB1/2/3) with Q1–Q4 in cols 3–6 and the annual
//         total in col 7, under a "NET ANNUAL TARGET WITHOUT TAX (14%)" header.
//
//   • CURRENT STOCK — code · name · total units on hand.
//
// Everything here is pure and works on plain arrays (header:1 output from the
// xlsx lib), so it carries no dependency on how the file was read.

export type Cellish = string | number | boolean | null | undefined;
export type SheetMatrix = Cellish[][];

/** One item row from the SALES sheet, normalised to numbers. */
export type SalesItem = {
  code: string;
  name: string;
  brand: string;
  qty2025: number;
  qty2026: number;
  qtyPurchased: number;
  value2025: number;
  value2026: number;
  valuePurchased: number;
};

/** One row from the target table at the bottom of SALES (a slab or a brand). */
export type TargetSlab = {
  name: string;
  q: [number, number, number, number];
  annual: number;
};

/**
 * Which kind of target table the file carries:
 *   - "company": rows are SLAB1/2/3 — one target for the whole distributor
 *     (يونيلفر). The Q4 plan splits the chosen slab across brands by share.
 *   - "brand": rows are brand names (L'Oréal: La roche / Vichy / Cerave) — a
 *     real target per brand, used directly with no splitting.
 *   - "none": no target block found.
 */
export type TargetMode = "company" | "brand" | "none";

export type TargetInfo = {
  mode: TargetMode;
  rows: TargetSlab[];
  /** brand-mode only: normalized brand name → annual target. */
  brandTargets: Record<string, number>;
};

export type BrandSummary = {
  brand: string;
  skuCount: number;
  qty2025: number;
  qty2026: number;
  qtyGrowthPct: number;
  value2025: number;
  value2026: number;
  valueGrowthPct: number;
  share2026: number;
  /** Value purchased in 2026 (sell-in, incl. tax as in the file). */
  purchased2026: number;
  /** Units purchased in 2026 (QTY PURCHASE column). */
  qtyPurchased2026: number;
  stockUnits: number;
};

export type MoverItem = {
  code: string;
  name: string;
  brand: string;
  value2025: number;
  value2026: number;
  change: number;
  /** null when 2025 was zero (a brand-new code). */
  growthPct: number | null;
};

export type FahmyAnalysis = {
  kpis: {
    value2025: number;
    value2026: number;
    valueGrowthPct: number;
    qty2025: number;
    qty2026: number;
    qtyGrowthPct: number;
    purchased2026: number;
    netPurchaseBeforeTax: number | null;
    skuCount: number;
    brandCount: number;
    newCount: number;
    newValue: number;
    discCount: number;
    discValue: number;
    stockUnits: number;
    zeroStockCount: number;
  };
  brands: BrandSummary[];
  /** The detected source brand names (before any user merge), for the editor. */
  rawBrands: { name: string; count: number; value2026: number }[];
  topProducts: MoverItem[];
  gainers: MoverItem[];
  losers: MoverItem[];
  /** New codes (no 2025 sales) ranked by 2026 value. */
  newItems: MoverItem[];
  /** Discontinued codes (had 2025 sales, none in 2026) ranked by lost value. */
  discItems: MoverItem[];
  targets: TargetSlab[];
  targetMode: TargetMode;
  /** brand-mode only: normalized brand → annual target (empty otherwise). */
  brandTargets: Record<string, number>;
  stockCount: number;
};

const CANCELLED_NAMES = new Set(["ملغي", "ملغى"]);
const CANCELLED_BRAND = "Cancelled";

/** Coerce a cell to a finite number, tolerating "1,234.5" and stray spaces. */
function num(v: Cellish): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null) return 0;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

const str = (v: Cellish): string => (v == null ? "" : String(v).trim());

/**
 * Best-guess brand from the item name. The names carry noise that breaks a
 * naive "first word" split — inline markers like "#ع#", and promo tails glued
 * straight onto the brand ("DOVE(1+1)SPRAY…"). So we:
 *   1. drop #…# markers,
 *   2. turn every non-letter (digits, +, parentheses, &) into a space,
 *   3. take the first remaining word, upper-cased.
 * "LA" keeps its second word ("LA ROCHE") since it's meaningless alone.
 * Items literally named "ملغي" (cancelled) group on their own so totals still
 * tie to the file. This is only a guess — the UI lets the user merge groups.
 */
export function normalizeBrand(name: string): string {
  const trimmed = name.trim();
  if (CANCELLED_NAMES.has(trimmed)) return CANCELLED_BRAND;
  const cleaned = trimmed
    .replace(/#[^#]*#/g, " ") // drop #ع# style markers
    .replace(/[^A-Za-z؀-ۿ ]+/g, " ") // non-letters → space
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "—";
  const parts = cleaned.split(" ");
  const first = parts[0].toUpperCase();
  const guess = first === "LA" && parts[1] ? `LA ${parts[1].toUpperCase()}` : first;
  return snapCanonical(guess);
}

/** Backwards-compatible alias. */
export const brandOf = normalizeBrand;

// Known brands with a compact match key. A detected name is snapped onto one of
// these when its letters line up — folding source typos and glued names
// ("LA ROCH…" → LA ROCHE, "VICHYNORMADERM" → VICHY, "TRESEMMESHAM" → TRESEMME)
// onto the real brand automatically. Anything not matching keeps its own name.
const CANONICAL_BRANDS: { display: string; key: string }[] = [
  { display: "DOVE", key: "DOVE" },
  { display: "AXE", key: "AXE" },
  { display: "SIGNAL", key: "SIGNAL" },
  { display: "VASELINE", key: "VASELINE" },
  { display: "SUNSILK", key: "SUNSILK" },
  { display: "TRESEMME", key: "TRESEMME" },
  { display: "REXONA", key: "REXONA" },
  { display: "CLEAR", key: "CLEAR" },
  { display: "LUX", key: "LUX" },
  { display: "CLOSE", key: "CLOSE" },
  { display: "CAMAY", key: "CAMAY" },
  { display: "LIFE", key: "LIFE" },
  { display: "FAIR", key: "FAIR" },
  { display: "LA ROCHE", key: "LAROCHE" },
  { display: "VICHY", key: "VICHY" },
  { display: "CERAVE", key: "CERAVE" },
];

/**
 * Snap a detected brand guess onto a canonical brand when the letters match:
 * the guess starts with a canonical key, or (for short typos like "LAROCH")
 * the key starts with the guess. Otherwise the guess is returned unchanged.
 */
function snapCanonical(guess: string): string {
  const compact = guess.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (!compact) return guess;
  for (const c of CANONICAL_BRANDS) {
    if (
      compact.startsWith(c.key) ||
      (c.key.startsWith(compact) && compact.length >= 5)
    ) {
      return c.display;
    }
  }
  return guess;
}

/**
 * Suggest a merge map for a set of detected brand names — snaps each onto its
 * canonical brand where possible. With canonical snapping now built into
 * {@link normalizeBrand}, this mostly catches anything already merged upstream;
 * it stays available as the "Auto-tidy" action for edge cases.
 */
export function autoTidyBrands(names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const nm of names) {
    const snapped = snapCanonical(nm);
    if (snapped !== nm) out[nm] = snapped;
  }
  return out;
}

const yoy = (a: number, b: number): number | null =>
  a === 0 ? null : (b - a) / a;

/**
 * Parse the SALES sheet into item rows. A row counts as an item only when its
 * code cell (col 1, index 0) is all digits — this drops the pivot subtotals,
 * the "Grand Total" row, the "NET PURCHASE BEFORE TAX" line and the target
 * block, all of which have a blank or non-numeric first cell.
 */
export function parseSalesItems(sales: SheetMatrix): SalesItem[] {
  const items: SalesItem[] = [];
  for (const row of sales) {
    const code = str(row[0]);
    if (!/^\d+$/.test(code)) continue; // skip headers, subtotals, totals, targets
    const name = str(row[1]);
    items.push({
      code,
      name,
      brand: normalizeBrand(name),
      qty2025: num(row[2]),
      qty2026: num(row[3]),
      qtyPurchased: num(row[5]),
      value2025: num(row[6]),
      value2026: num(row[7]),
      valuePurchased: num(row[9]),
    });
  }
  return items;
}

/**
 * Parse the target table under the "NET ANNUAL TARGET WITHOUT TAX" header. Each
 * row is `label · Q1 · Q2 · Q3 · Q4 · annual`. The label decides the mode: rows
 * named SLAB… are a single company target; anything else is read as a per-brand
 * target (matched to a brand via {@link normalizeBrand}).
 */
export function parseTargets(sales: SheetMatrix): TargetInfo {
  const none: TargetInfo = { mode: "none", rows: [], brandTargets: {} };

  // Find the target header — any row whose label column mentions "TARGET".
  // Covers "NET ANNUAL TARGET WITHOUT TAX (14%)" and
  // "PURCHASE TARGET 2026 NET WITHOUT TAX 14%".
  let headerIdx = -1;
  for (let i = 0; i < sales.length; i++) {
    if (str(sales[i][1]).toUpperCase().includes("TARGET")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return none;

  // Sub-rows below the header: SLAB1/2/3 (company) or brand names (per-brand).
  // The annual figure normally sits in the total column (col 7, after Q1–Q4),
  // but some files put a single annual value straight in col 3 with no quarters
  // (LEAP: "SLAB1 12000000"). So annual = col 7 when present, else the sum of
  // cols 3–6 (which equals the single value, or the four quarters).
  const rows: TargetSlab[] = [];
  for (let i = headerIdx + 1; i < sales.length; i++) {
    const row = sales[i];
    const label = str(row[1]);
    if (!label) continue;
    const q: [number, number, number, number] = [
      num(row[2]),
      num(row[3]),
      num(row[4]),
      num(row[5]),
    ];
    const hasAnnualCol = num(row[6]) > 0;
    const annual = hasAnnualCol ? num(row[6]) : q[0] + q[1] + q[2] + q[3];
    if (annual <= 0) continue;
    rows.push({
      name: label.trim(),
      q: hasAnnualCol ? q : [0, 0, 0, 0],
      annual,
    });
  }

  // Single-total format: no sub-rows — the target value sits on the header row
  // itself (e.g. "PURCHASE TARGET 2026 …" with 12,000,000 in the next cell).
  if (rows.length === 0) {
    const header = sales[headerIdx];
    let annual = 0;
    for (let ci = 2; ci <= 9; ci++) {
      const v = num(header[ci]);
      if (v > 0) {
        annual = v;
        break;
      }
    }
    if (annual <= 0) return none;
    const yr = str(header[1]).match(/(20\d{2})/);
    return {
      mode: "company",
      rows: [{ name: yr ? `Target ${yr[1]}` : "Target", q: [0, 0, 0, 0], annual }],
      brandTargets: {},
    };
  }

  const isSlab = (name: string) => /^slab\s*\d+$/i.test(name.replace(/\s+/g, " "));
  const mode: TargetMode = rows.some((r) => isSlab(r.name)) ? "company" : "brand";

  const brandTargets: Record<string, number> = {};
  if (mode === "company") {
    // Normalise slab labels to "SLAB1" etc.
    for (const r of rows) r.name = r.name.replace(/\s+/g, "").toUpperCase();
  } else {
    for (const r of rows) brandTargets[normalizeBrand(r.name)] = r.annual;
  }

  return { mode, rows, brandTargets };
}

/** Read the "NET PURCHASE BEFORE TAX" figure (col 10) if present. */
export function parseNetPurchase(sales: SheetMatrix): number | null {
  for (const row of sales) {
    if (str(row[8]).toUpperCase().includes("NET PURCHASE BEFORE TAX")) {
      return num(row[9]);
    }
  }
  return null;
}

/**
 * Parse the CURRENT STOCK sheet into a code → units map. Layout is
 * code · name · total; the header row (non-numeric code) is skipped.
 */
export function parseStock(stock: SheetMatrix): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of stock) {
    const code = str(row[0]);
    if (!/^\d+$/.test(code)) continue;
    map.set(code, num(row[2]));
  }
  return map;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function rollBrands(
  items: SalesItem[],
  stock: Map<string, number>,
  totalValue2026: number,
): BrandSummary[] {
  const map = new Map<string, BrandSummary>();
  for (const it of items) {
    let b = map.get(it.brand);
    if (!b) {
      b = {
        brand: it.brand,
        skuCount: 0,
        qty2025: 0,
        qty2026: 0,
        qtyGrowthPct: 0,
        value2025: 0,
        value2026: 0,
        valueGrowthPct: 0,
        share2026: 0,
        purchased2026: 0,
        qtyPurchased2026: 0,
        stockUnits: 0,
      };
      map.set(it.brand, b);
    }
    b.skuCount += 1;
    b.qty2025 += it.qty2025;
    b.qty2026 += it.qty2026;
    b.value2025 += it.value2025;
    b.value2026 += it.value2026;
    b.purchased2026 += it.valuePurchased;
    b.qtyPurchased2026 += it.qtyPurchased;
    b.stockUnits += stock.get(it.code) ?? 0;
  }
  const brands = [...map.values()].map((b) => ({
    ...b,
    qty2025: round2(b.qty2025),
    qty2026: round2(b.qty2026),
    value2025: round2(b.value2025),
    value2026: round2(b.value2026),
    purchased2026: round2(b.purchased2026),
    qtyPurchased2026: round2(b.qtyPurchased2026),
    qtyGrowthPct: (yoy(b.qty2025, b.qty2026) ?? 0) * 100,
    valueGrowthPct: (yoy(b.value2025, b.value2026) ?? 0) * 100,
    share2026: totalValue2026 > 0 ? (b.value2026 / totalValue2026) * 100 : 0,
  }));
  // Real brands first (by 2026 value), the Cancelled group always last.
  return brands.sort((a, b) => {
    if (a.brand === CANCELLED_BRAND) return 1;
    if (b.brand === CANCELLED_BRAND) return -1;
    return b.value2026 - a.value2026;
  });
}

const toMover = (it: SalesItem): MoverItem => ({
  code: it.code,
  name: it.name,
  brand: it.brand,
  value2025: it.value2025,
  value2026: it.value2026,
  change: round2(it.value2026 - it.value2025),
  growthPct: yoy(it.value2025, it.value2026),
});

/**
 * Full analysis over a parsed workbook. `brandOverrides` maps a detected brand
 * name onto the group the user wants it folded into (e.g. every "DOVE…" variant
 * → "DOVE"); anything not in the map keeps its detected name.
 */
export function analyzeFahmy(
  sales: SheetMatrix,
  stockSheet: SheetMatrix | null,
  brandOverrides: Record<string, string> = {},
): FahmyAnalysis {
  const items = parseSalesItems(sales);
  const stock = stockSheet ? parseStock(stockSheet) : new Map<string, number>();
  const targetInfo = parseTargets(sales);
  const netPurchaseBeforeTax = parseNetPurchase(sales);

  // The detected brand names before merging — what the grouping editor lists.
  const rawMap = new Map<string, { count: number; value2026: number }>();
  for (const it of items) {
    const e = rawMap.get(it.brand) ?? { count: 0, value2026: 0 };
    e.count += 1;
    e.value2026 += it.value2026;
    rawMap.set(it.brand, e);
  }
  const rawBrands = [...rawMap.entries()]
    .map(([name, e]) => ({ name, count: e.count, value2026: round2(e.value2026) }))
    .sort((a, b) => b.value2026 - a.value2026);

  // Fold each item into its chosen group before every downstream roll-up.
  for (const it of items) {
    const merged = brandOverrides[it.brand];
    if (merged) it.brand = merged;
  }

  const value2025 = round2(items.reduce((s, i) => s + i.value2025, 0));
  const value2026 = round2(items.reduce((s, i) => s + i.value2026, 0));
  const qty2025 = round2(items.reduce((s, i) => s + i.qty2025, 0));
  const qty2026 = round2(items.reduce((s, i) => s + i.qty2026, 0));
  const purchased2026 = round2(items.reduce((s, i) => s + i.valuePurchased, 0));

  const brands = rollBrands(items, stock, value2026);
  const realBrands = brands.filter((b) => b.brand !== CANCELLED_BRAND);

  const movers = items.map(toMover);
  const topProducts = [...movers]
    .sort((a, b) => b.value2026 - a.value2026)
    .slice(0, 10);
  const gainers = [...movers]
    .filter((m) => m.change > 0)
    .sort((a, b) => b.change - a.change)
    .slice(0, 10);
  const losers = [...movers]
    .filter((m) => m.change < 0)
    .sort((a, b) => a.change - b.change)
    .slice(0, 10);

  const newAll = movers.filter((m) => m.value2025 === 0 && m.value2026 > 0);
  const discAll = movers.filter((m) => m.value2025 > 0 && m.value2026 === 0);

  const stockUnits = round2([...stock.values()].reduce((s, v) => s + v, 0));
  const zeroStockCount = [...stock.values()].filter((v) => v <= 0).length;

  return {
    kpis: {
      value2025,
      value2026,
      valueGrowthPct: (yoy(value2025, value2026) ?? 0) * 100,
      qty2025,
      qty2026,
      qtyGrowthPct: (yoy(qty2025, qty2026) ?? 0) * 100,
      purchased2026,
      netPurchaseBeforeTax,
      skuCount: items.length,
      brandCount: realBrands.length,
      newCount: newAll.length,
      newValue: round2(newAll.reduce((s, m) => s + m.value2026, 0)),
      discCount: discAll.length,
      discValue: round2(discAll.reduce((s, m) => s + m.value2025, 0)),
      stockUnits,
      zeroStockCount,
    },
    brands,
    rawBrands,
    topProducts,
    gainers,
    losers,
    // Full lists (sorted) so the UI can show every code in a popup.
    newItems: [...newAll].sort((a, b) => b.value2026 - a.value2026),
    discItems: [...discAll].sort((a, b) => a.change - b.change),
    targets: targetInfo.rows,
    targetMode: targetInfo.mode,
    brandTargets: targetInfo.brandTargets,
    stockCount: stock.size,
  };
}

// --- Brand-level Q4 plan ---------------------------------------------------
//
// The يونيلفر file carries one company-wide target (the SLAB table), not a
// target per brand like the L'Oréal report had. So we allocate the chosen
// slab's annual target across brands by their share of purchases (sell-in),
// then compare each brand's needed Q4 pace to the pace it's ordering at now.

export type PlanBasis = "purchases" | "sales";

export type BrandPlanInputs = {
  /** Company annual target (net of tax), e.g. a slab's annual figure. */
  annualTarget: number;
  /** Months of 2026 data in the file (used for monthly averages). */
  monthsElapsed: number;
  /** VAT rate on purchases, e.g. 0.14 — strips tax so sell-in matches the net target. */
  vatRate: number;
  /** Allocate the company target by share of purchases or of sales value. */
  basis: PlanBasis;
};

export type BrandPlanRow = {
  brand: string;
  /** Sell-in incl. tax (VALUE PURCHASE). */
  sellInGross: number;
  /** Sell-in net of VAT — comparable to the net target. */
  sellInNet: number;
  soldGrowthPct: number;
  stockUnits: number;
  /** Units sold per month = qty 2026 ÷ months elapsed. */
  monthlySellout: number;
  /** Months of stock cover at the current sell-out pace. */
  coverMonths: number;
  /** This brand's slice of the company target (net). */
  annualTarget: number;
  /** Target − sell-in net; what's left to order this year. */
  remaining: number;
  /** Value ordered per month so far (net). */
  currentMonthlyPace: number;
  /** Value that must be ordered per remaining month to hit the target. */
  neededMonthly: number;
  /** neededMonthly ÷ currentMonthlyPace − 1, as a percent. */
  pctChange: number;
  /** % of this brand's allocated target already bought (sell-in net). */
  attainmentPct: number;
  status: PlanStatus;
  move: string;
};

export type PlanStatus = "ahead" | "onpace" | "watch" | "behind";

/**
 * Build the per-brand Q4 plan. Cancelled items are excluded — they carry no
 * forward plan. Brands with no share of the chosen basis get a zero target.
 */
export function computeBrandPlan(
  analysis: FahmyAnalysis,
  inputs: BrandPlanInputs,
): BrandPlanRow[] {
  const { annualTarget, monthsElapsed, vatRate, basis } = inputs;
  const perBrand = analysis.targetMode === "brand";
  const brands = analysis.brands.filter((b) => b.brand !== CANCELLED_BRAND);
  const monthsRemaining = Math.max(0, 12 - monthsElapsed);
  // Company mode splits one target by share; brand mode uses each brand's own.
  const shareTotal = brands.reduce(
    (s, b) => s + (basis === "sales" ? b.value2026 : b.purchased2026),
    0,
  );

  return brands
    .map((b): BrandPlanRow => {
      const sellInGross = b.purchased2026;
      const sellInNet = round2(sellInGross / (1 + vatRate));
      const shareVal = basis === "sales" ? b.value2026 : b.purchased2026;
      const brandTarget = perBrand
        ? (analysis.brandTargets[b.brand] ?? 0)
        : shareTotal > 0
          ? round2(annualTarget * (shareVal / shareTotal))
          : 0;
      const remaining = round2(brandTarget - sellInNet);
      const monthlySellout =
        monthsElapsed > 0 ? b.qty2026 / monthsElapsed : 0;
      const coverMonths =
        monthlySellout > 0 ? round2(b.stockUnits / monthlySellout) : 0;
      const currentMonthlyPace =
        monthsElapsed > 0 ? round2(sellInNet / monthsElapsed) : 0;
      const neededMonthly =
        monthsRemaining > 0 && remaining > 0
          ? round2(remaining / monthsRemaining)
          : 0;
      const pctChange =
        currentMonthlyPace > 0
          ? round2((neededMonthly / currentMonthlyPace - 1) * 100)
          : 0;
      const attainmentPct =
        brandTarget > 0 ? round2((sellInNet / brandTarget) * 100) : 0;

      // Four plain states, driven by how the needed Q4 pace compares to the
      // pace the brand is already ordering at (and whether it's over target).
      const status: PlanStatus =
        remaining <= 0 || pctChange <= -8
          ? "ahead"
          : pctChange <= 6
            ? "onpace"
            : pctChange <= 15
              ? "watch"
              : "behind";

      const up = Math.max(0, Math.round(pctChange));
      const move =
        status === "ahead"
          ? `Already at ${Math.round(attainmentPct)}% of target with orders running ahead of what Q4 needs. You can ease off.`
          : status === "onpace"
            ? `At ${Math.round(attainmentPct)}% of target. Keep ordering at the same pace to finish on target.`
            : status === "watch"
              ? `Order about ${up}% more per month through Q4 to stay on target.`
              : `Order about ${up}% more per month to hit target — cover is only ~${coverMonths.toFixed(1)} months, so top up steadily.`;

      return {
        brand: b.brand,
        sellInGross,
        sellInNet,
        soldGrowthPct: b.valueGrowthPct,
        stockUnits: b.stockUnits,
        monthlySellout: round2(monthlySellout),
        coverMonths,
        annualTarget: brandTarget,
        remaining,
        currentMonthlyPace,
        neededMonthly,
        pctChange,
        attainmentPct,
        status,
        move,
      };
    })
    // In brand mode, only plan brands the file actually gives a target for.
    .filter((r) => !perBrand || r.annualTarget > 0)
    .sort((a, b) => b.sellInNet - a.sellInNet);
}

// --- Company-total slab suggestion ---------------------------------------
//
// For company-mode files (SLAB1/2/3), how much the distributor must change its
// TOTAL buying to reach a given slab — a single company number, not per brand.

export type SlabPlan = {
  name: string;
  target: number;
  /** Company net purchases to date. */
  net: number;
  attainmentPct: number;
  /** target − net (net EGP). Positive = still to buy; negative = over target. */
  remaining: number;
  /** Same gap incl. tax, i.e. what actually gets ordered. */
  remainingGross: number;
  monthsRemaining: number;
  /** Value ordered per month so far (net). */
  currentMonthlyPace: number;
  /** Value to order per remaining month to reach the slab (net). */
  neededMonthly: number;
  /** neededMonthly ÷ currentMonthlyPace − 1, as a percent. */
  pctChange: number;
  direction: "increase" | "decrease" | "onpace";
  suggestion: string;
};

const money = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `${Math.round(v / 1e3)}K` : `${Math.round(v)}`;
  return `${s} EGP`;
};

/**
 * Per-slab company suggestion. `net` is the company net purchases to date
 * (from the file's "NET PURCHASE BEFORE TAX", or purchases ÷ (1+VAT)).
 */
export function computeSlabPlans(
  analysis: FahmyAnalysis,
  opts: { net: number; monthsElapsed: number; vatRate: number },
): SlabPlan[] {
  const { net, monthsElapsed, vatRate } = opts;
  const monthsRemaining = Math.max(0, 12 - monthsElapsed);
  const currentMonthlyPace =
    monthsElapsed > 0 ? round2(net / monthsElapsed) : 0;

  return analysis.targets.map((t): SlabPlan => {
    const remaining = round2(t.annual - net);
    const attainmentPct = t.annual > 0 ? round2((net / t.annual) * 100) : 0;
    const neededMonthly =
      remaining > 0 && monthsRemaining > 0
        ? round2(remaining / monthsRemaining)
        : 0;
    const pctChange =
      currentMonthlyPace > 0
        ? round2((neededMonthly / currentMonthlyPace - 1) * 100)
        : 0;

    const mLeft = `${monthsRemaining} month${monthsRemaining === 1 ? "" : "s"}`;
    let direction: SlabPlan["direction"];
    let suggestion: string;
    if (remaining <= 0) {
      direction = "decrease";
      suggestion = `Already reached — ${money(-remaining)} over target. You can stop ordering for the rest of the year.`;
    } else if (pctChange <= -8) {
      // Needed pace is well below current — they'll overshoot if unchanged.
      direction = "decrease";
      suggestion = `On track to exceed — at your current pace (~${money(currentMonthlyPace)}/mo) you'll pass ${t.name}. Only ~${money(neededMonthly)}/mo is needed (${Math.round(-pctChange)}% below current), so you can ease off and still hit it. ${money(remaining)} left.`;
    } else if (pctChange <= 6) {
      direction = "onpace";
      suggestion = `On pace — keep buying at ~${money(currentMonthlyPace)}/mo to reach ${t.name}. About ${money(remaining)} left over the last ${mLeft}.`;
    } else {
      direction = "increase";
      suggestion = `Buy ${money(remaining)} more (net, ${money(remaining * (1 + vatRate))} incl. tax) to reach ${t.name} — about ${money(neededMonthly)}/mo for the last ${mLeft}, ~${Math.round(pctChange)}% above your current pace.`;
    }

    return {
      name: t.name,
      target: t.annual,
      net,
      attainmentPct,
      remaining,
      remainingGross: round2(remaining * (1 + vatRate)),
      monthsRemaining,
      currentMonthlyPace,
      neededMonthly,
      pctChange,
      direction,
      suggestion,
    };
  });
}
