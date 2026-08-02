// Turns the first <table> in a SofTech-exported HTML report into a matrix of
// cell text, expanding `colspan` by repeating the cell's text that many times
// (so downstream parsers can rely on fixed column indices).
//
// This mirrors `pandas.read_html(...)[0]`, which fills every column spanned by a
// merged cell with the same value. Rowspan is intentionally NOT propagated
// downward — the header rows that use it are dropped by the per-report parsers.
//
// Deliberately regex-based (no DOMParser), so it runs from either a server or a
// client component and chews through large exports (the multi-order pos report
// is ~1.5MB) without depending on a DOM.

// Decode the handful of entities the reports use, strip any inline tags, and
// collapse whitespace.
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

export function parseHtmlTable(html: string): string[][] {
  // Isolate the first table (non-greedy to its first closing tag). These
  // exports contain a single flat table with no nesting.
  const table = /<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(html);
  const body = table ? table[1] : html;

  const rows: string[][] = [];
  const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(body)) !== null) {
    const row: string[] = [];
    // Match <td>…</td> and <th>…</th>; the backreference keeps the closing tag
    // paired with its opener.
    const cellRe = /<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1])) !== null) {
      const spanMatch = /colspan\s*=\s*["']?\s*(\d+)/i.exec(cm[2]);
      const span = spanMatch ? Math.max(1, Number(spanMatch[1]) || 1) : 1;
      const text = cellText(cm[3]);
      for (let i = 0; i < span; i++) row.push(text);
    }
    rows.push(row);
  }
  return rows;
}
