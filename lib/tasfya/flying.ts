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
