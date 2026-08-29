"use client";

import * as React from "react";
import * as XLSX from "xlsx-js-style";
import JSZip from "jszip";
import { FileUp, Table2, Download, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { parseHtmlTable } from "@/lib/tasfya/parseTable";

// The final columns, in the exact order the Python script writes them.
const COLS = [
  "بيع 120 يوم",
  "الفروع",
  "Status",
  "اسم الصنف",
  "code",
  "E.X.P",
  "بيع 55يوم",
  "الرئيسي",
  "Order",
  "order_maktob",
  "far2",
] as const;

type Col = (typeof COLS)[number];
type Row = Record<Col, string | number>;

// Cells in "اسم الصنف" containing any of these exact markers are highlighted.
const HIGHLIGHT_MARKERS = ["#B#", "#NA#", "#C.C#"];

// Positional column indices in the HTML order report (matches the Python
// df[7]/df[14]/df[16]).
const HTML_ORDER_MAKTOB_COL = 7;
const HTML_CODE_COL = 16;

// Parse a possibly comma-grouped / string number into a JS number (0 on fail).
function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

// Same as toNum but rounded to an integer (matches the script's astype(int)).
function toInt(v: unknown): number {
  return Math.round(toNum(v));
}

// Parse an integer code, ignoring any stray non-digits. Returns null if none.
function parseCode(v: unknown): number | null {
  const digits = String(v ?? "").replace(/[^\d-]/g, "");
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

type ProcessResult = {
  rows: Row[];
  orderName: string;
  htmlCount: number;
  csvCount: number;
};

// Build the merged rows from the HTML report text and the CSV text, mirroring
// the pandas pipeline (outer merge on `code`, far2 = order_maktob - Order).
function processFiles(htmlText: string, csvText: string): ProcessResult {
  // --- HTML report → code → order_maktob (df[7]) ---
  const matrix = parseHtmlTable(htmlText);
  // order_name = df[13][12] — column 13, row 12 (header metadata).
  const orderName = (matrix[12]?.[13] ?? "").toString().trim();

  // Data rows: skip the first 13 header rows, drop the last (totals) row.
  const dataRows = matrix.slice(13, Math.max(13, matrix.length - 1));
  const htmlMap = new Map<number, number>();
  for (const r of dataRows) {
    const code = parseCode(r[HTML_CODE_COL]);
    if (code === null) continue;
    htmlMap.set(code, toInt(r[HTML_ORDER_MAKTOB_COL]));
  }

  // --- CSV → the named columns ---
  const wb = XLSX.read(csvText, { type: "string", raw: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json: Record<string, unknown>[] = sheet
    ? XLSX.utils.sheet_to_json(sheet, { defval: 0, raw: true })
    : [];

  const csvByCode = new Map<number, Record<string, unknown>>();
  const csvOrder: number[] = [];
  for (const obj of json) {
    const code = parseCode(obj["code"]);
    if (code === null) continue;
    if (!csvByCode.has(code)) csvOrder.push(code);
    csvByCode.set(code, obj);
  }

  // --- Outer merge on code (csv rows first, then html-only codes) ---
  const build = (
    csv: Record<string, unknown> | null,
    code: number,
    orderMaktob: number,
  ): Row => {
    const order = toNum(csv?.["Order"]);
    return {
      "بيع 120 يوم": csv ? (csv["بيع 120 يوم"] as string | number) ?? 0 : 0,
      الفروع: toInt(csv?.["الفروع"]),
      Status: csv ? (csv["Status"] as string | number) ?? 0 : 0,
      "اسم الصنف": csv ? String(csv["اسم الصنف"] ?? "") : "",
      code,
      "E.X.P": csv ? (csv["E.X.P"] as string | number) ?? 0 : 0,
      "بيع 55يوم": toInt(csv?.["بيع 55يوم"]),
      الرئيسي: csv ? (csv["الرئيسي"] as string | number) ?? 0 : 0,
      Order: order,
      order_maktob: toInt(orderMaktob),
      far2: Math.round(orderMaktob - order),
    };
  };

  const rows: Row[] = [];
  const seen = new Set<number>();
  for (const code of csvOrder) {
    seen.add(code);
    rows.push(build(csvByCode.get(code)!, code, htmlMap.get(code) ?? 0));
  }
  for (const [code, orderMaktob] of htmlMap) {
    if (seen.has(code)) continue;
    rows.push(build(null, code, orderMaktob));
  }

  return { rows, orderName, htmlCount: htmlMap.size, csvCount: csvByCode.size };
}

// Style object attached to a cell via `.s` (xlsx-js-style). Typed loosely since
// xlsx's own types don't model the style property.
type CellStyle = {
  alignment?: { horizontal?: string; vertical?: string };
  font?: { bold?: boolean };
  fill?: { patternType: string; fgColor: { rgb: string } };
};

// Build and download the styled .xlsx: centered cells, auto column widths, a
// bold frozen header row, and a yellow fill on "اسم الصنف" cells that contain
// one of the highlight markers.
function exportXlsx(rows: Row[], fileName: string) {
  const header = [...COLS] as string[];
  const aoa: (string | number)[][] = [
    header,
    ...rows.map((r) => COLS.map((c) => r[c])),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const nameCol = COLS.indexOf("اسم الصنف");

  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[addr] as (XLSX.CellObject & { s?: CellStyle }) | undefined;
      if (!cell) continue;
      const style: CellStyle = {
        alignment: { horizontal: "center", vertical: "center" },
      };
      if (R === 0) style.font = { bold: true };
      if (R > 0 && C === nameCol) {
        const text = String(cell.v ?? "");
        if (HIGHLIGHT_MARKERS.some((m) => text.includes(m))) {
          style.fill = { patternType: "solid", fgColor: { rgb: "FFFF00" } };
        }
      }
      cell.s = style;
    }
  }

  // Auto column widths from the longest value in each column (+2 padding).
  ws["!cols"] = COLS.map((label) => {
    let max = String(label).length;
    for (const r of rows) {
      const len = String(r[label] ?? "").length;
      if (len > max) max = len;
    }
    return { wch: max + 2 };
  });

  const wbOut = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbOut, ws, "Sheet1");

  // xlsx-js-style's writer can't emit frozen panes, so we write the workbook,
  // patch the sheet XML to add the frozen top row, then download the result.
  const buf = XLSX.write(wbOut, { type: "array", bookType: "xlsx" });
  return downloadWithFrozenTopRow(buf as ArrayBuffer, `${fileName}.xlsx`);
}

// Inject a "freeze top row" pane into the first sheet's XML and trigger a
// download. The <sheetView> the writer produces has no <pane> child, so we add
// one (converting a self-closing tag to an open/close pair when needed).
async function downloadWithFrozenTopRow(buf: ArrayBuffer, fileName: string) {
  const pane =
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>';

  const zip = await JSZip.loadAsync(buf);
  const sheetPath = "xl/worksheets/sheet1.xml";
  const file = zip.file(sheetPath);
  if (file) {
    const xml = await file.async("string");
    // Self-closing <sheetView .../> → open the tag and nest the pane.
    let patched = xml.replace(
      /<((?:\w+:)?sheetView)\b([^>]*)\/>/,
      `<$1$2>${pane}</$1>`,
    );
    if (patched === xml) {
      // Already has children — insert the pane right after the opening tag.
      patched = xml.replace(/(<(?:\w+:)?sheetView\b[^>]*>)/, `$1${pane}`);
    }
    zip.file(sheetPath, patched);
  }

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim() || "orders-review";
}

export function OrdersReview() {
  const [htmlFile, setHtmlFile] = React.useState<File | null>(null);
  const [csvFile, setCsvFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<ProcessResult | null>(null);
  const htmlRef = React.useRef<HTMLInputElement>(null);
  const csvRef = React.useRef<HTMLInputElement>(null);

  async function run() {
    if (!htmlFile || !csvFile) {
      toast.error("Choose both the HTML report and the CSV file.");
      return;
    }
    setBusy(true);
    try {
      const [htmlText, csvText] = await Promise.all([
        htmlFile.text(),
        csvFile.text(),
      ]);
      const res = processFiles(htmlText, csvText);
      if (res.rows.length === 0) {
        toast.error("No rows were produced — check the two files.");
        setResult(null);
        return;
      }
      setResult(res);
      await exportXlsx(res.rows, baseName(csvFile.name));
      toast.success(`Exported ${res.rows.length} row(s).`);
    } catch {
      toast.error("Couldn't process the files. Check their format.");
    } finally {
      setBusy(false);
    }
  }

  const pickCls =
    "flex-1 min-w-[16rem] rounded-xl border border-dashed border-border bg-card/50 p-4";

  return (
    <div className="space-y-5">
      {/* File pickers */}
      <div className="flex flex-wrap gap-3">
        <div className={pickCls}>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <FileUp className="size-4 text-muted-foreground" />
            HTML order report
          </div>
          <input
            ref={htmlRef}
            type="file"
            accept=".htm,.html"
            className="hidden"
            onChange={(e) => setHtmlFile(e.target.files?.[0] ?? null)}
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => htmlRef.current?.click()}
            >
              <FileUp /> Choose .htm
            </Button>
            {htmlFile && (
              <span className="inline-flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                <span className="max-w-[12rem] truncate">{htmlFile.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setHtmlFile(null);
                    if (htmlRef.current) htmlRef.current.value = "";
                  }}
                  className="grid size-5 place-items-center rounded hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Clear HTML file"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            )}
          </div>
        </div>

        <div className={pickCls}>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Table2 className="size-4 text-muted-foreground" />
            CSV file
          </div>
          <input
            ref={csvRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => csvRef.current?.click()}
            >
              <Table2 /> Choose .csv
            </Button>
            {csvFile && (
              <span className="inline-flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                <span className="max-w-[12rem] truncate">{csvFile.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setCsvFile(null);
                    if (csvRef.current) csvRef.current.value = "";
                  }}
                  className="grid size-5 place-items-center rounded hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Clear CSV file"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={busy || !htmlFile || !csvFile} onClick={run}>
          {busy ? <Loader2 className="animate-spin" /> : <Download />}
          {busy ? "Processing…" : "Generate & download Excel"}
        </Button>
        {result && (
          <span className="text-sm text-muted-foreground">
            {result.orderName && (
              <>
                Order: <span className="font-medium">{result.orderName}</span> ·{" "}
              </>
            )}
            {result.rows.length} rows · {result.csvCount} from CSV,{" "}
            {result.htmlCount} from report
          </span>
        )}
      </div>

      {/* Preview (first rows) */}
      {result && result.rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {COLS.map((c) => (
                  <th
                    key={c}
                    className="whitespace-nowrap px-3 py-2 font-semibold text-muted-foreground"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.slice(0, 50).map((r, i) => {
                const name = String(r["اسم الصنف"]);
                const hit = HIGHLIGHT_MARKERS.some((m) => name.includes(m));
                return (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    {COLS.map((c) => (
                      <td
                        key={c}
                        dir={c === "اسم الصنف" ? "auto" : undefined}
                        className={cn(
                          "whitespace-nowrap px-3 py-1.5 text-center",
                          c === "اسم الصنف" &&
                            hit &&
                            "bg-yellow-300/70 font-medium text-black dark:bg-yellow-400/80",
                        )}
                      >
                        {String(r[c] ?? "")}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {result.rows.length > 50 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Showing first 50 of {result.rows.length} rows. The Excel file has
              all of them.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
