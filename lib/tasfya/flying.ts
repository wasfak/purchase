// Helpers for the "flying tasfya" (تصفية ع الطاير) worksheet.
//
// A distributor cell is typed as either a plain quantity ("100") or a
// quantity + bounce ("100+10", where the 10 is بونص / free units). Only the
// base quantity is deducted from the item's remaining (الباقى); the bounce is
// tracked separately and shown as a percentage of the base.

/** The distributor columns from the paper template, used to seed a new sheet.
 *  All of these are renamable/removable and more can be added on the fly. */
export const DEFAULT_DISTRIBUTORS: string[] = [
  "ابن سينا",
  "فارما اوفر سيز",
  "رامكو",
  "الشرق الاوسط",
  "سوفيكو",
];

export interface CellValue {
  /** The base received quantity — the part that deducts from remaining. */
  base: number;
  /** بونص — free units, not deducted from remaining. */
  bounce: number;
}

const num = (s: string): number => {
  const n = Number(s.replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Parse a raw distributor cell into { base, bounce }.
 *  - ""        → { base: 0, bounce: 0 }
 *  - "100"     → { base: 100, bounce: 0 }
 *  - "100+10"  → { base: 100, bounce: 10 }
 * Anything unparseable degrades to zeros.
 */
export function parseCell(raw: string | undefined): CellValue {
  const s = (raw ?? "").trim();
  if (!s) return { base: 0, bounce: 0 };
  const plus = s.indexOf("+");
  if (plus === -1) return { base: num(s), bounce: 0 };
  return { base: num(s.slice(0, plus)), bounce: num(s.slice(plus + 1)) };
}

export interface FlyingColumn {
  id: string;
  name: string;
}

export interface FlyingRow {
  code: string;
  name: string;
  order: number;
  cells: Record<string, string>;
  note?: string;
  remainingOverride?: number | null;
}

// الباقى for a row — a signed balance. The بونص (bounce) is free extra, so it
// helps cover the order but is NOT counted as over-buying:
//   > 0  → the paid quantity ALONE exceeds the order (real over-purchase → "+N")
//   = 0  → order covered (qty, or qty + bounce, reaches the ordered amount)
//   < 0  → still short by that much, even counting the bounce (shown as "-N")
export function remainingOf(row: FlyingRow, columns: FlyingColumn[]): number {
  let base = 0;
  let bounce = 0;
  for (const c of columns) {
    const v = parseCell(row.cells[c.id]);
    base += v.base;
    bounce += v.bounce;
  }
  if (base > row.order) return base - row.order; // over-bought on paid qty
  const taken = base + bounce;
  if (taken >= row.order) return 0; // covered (bounce filled the gap)
  return taken - row.order; // still short
}

// Effective الباقى: a manual override, when present, wins over the computed one.
export function effRemaining(row: FlyingRow, columns: FlyingColumn[]): number {
  return typeof row.remainingOverride === "number"
    ? row.remainingOverride
    : remainingOf(row, columns);
}

// Format the signed الباقى balance: surplus gets an explicit "+", shortfall keeps
// its natural "-", exact shows plain 0.
export function fmtBalance(v: number): string {
  return (v > 0 ? "+" : "") + v.toLocaleString("en-US");
}
