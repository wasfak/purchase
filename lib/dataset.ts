// Server-safe dataset helpers (no "use client") — usable from both server and
// client components.

export type Cell = string | number | boolean | null;
export type DataRow = { __id: string } & Record<string, Cell>;

export const stringify = (v: Cell): string =>
  v === null || v === undefined ? "" : String(v).trim();

/** A column is numeric when every non-empty value is a number. */
export function isNumericColumn(rows: DataRow[], col: string): boolean {
  let seen = false;
  for (const row of rows) {
    const s = stringify(row[col]);
    if (s === "") continue;
    seen = true;
    if (typeof row[col] !== "number" && Number.isNaN(Number(s))) return false;
  }
  return seen;
}
