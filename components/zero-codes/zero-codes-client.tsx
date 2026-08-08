"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Search,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toDateStr } from "@/lib/dates";

// ---- Types shared with the API ------------------------------------------

type SavedFile = {
  date: string;
  fileName: string;
  savedAt: string | null;
  rows: number;
  marked: number;
};

type Hit = { date: string; order: string; supplier: string };

type SearchResult = {
  code: string;
  name: string;
  hits: Hit[];
  status: "found" | "not_found";
};

type ParsedRow = {
  code: string;
  name: string;
  order: string;
  supplier: string;
  marked: boolean;
};

// ---- CSV parsing ---------------------------------------------------------

// Pull "YYYY-MM-DD" out of a filename like AppSheet.ViewData.2026-06-02.csv.
function dateFromName(name: string): string | null {
  const m = name.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

const normHeader = (s: string) =>
  String(s ?? "")
    .replace(/^﻿/, "")
    .replace(/\s+/g, "")
    .toLowerCase();

// Find a column index by trying each candidate header (exact, case-insensitive).
function findCol(header: string[], candidates: string[]): number {
  const norm = header.map(normHeader);
  for (const c of candidates) {
    const i = norm.indexOf(normHeader(c));
    if (i !== -1) return i;
  }
  return -1;
}

// Parse a delimited-text file into a matrix of raw string cells. Handles
// quoted fields ("a,b"), escaped quotes (""), and CR/LF line endings. We parse
// the CSV by hand rather than via a spreadsheet library on purpose: those
// libraries coerce cell values by type, which turned the "-0-" marker into a
// date and broke ordered-detection.
function parseDelimited(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // ignore; handled by the following \n (or trailing CR)
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Parse one daily CSV file into rows + the date it is for.
async function parseCsv(
  file: File,
): Promise<{ date: string; rows: ParsedRow[] }> {
  let text = await file.text();
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const matrix = parseDelimited(text).filter((r) => r.some((c) => c !== ""));
  if (matrix.length < 2) {
    throw new Error("The file has no data rows.");
  }

  const header = matrix[0].map((h) => String(h ?? ""));
  const ci = findCol(header, ["code"]);
  // The "-0-" marker column is optional: not every export includes it. When
  // it's missing we still import the day; those rows just count as "appeared",
  // never "ordered".
  const zi = findCol(header, ["-0-", "0"]);
  const oi = findCol(header, ["Order"]);
  const ni = findCol(header, ["اسم الصنف", "item name", "name"]);
  const si = findCol(header, ["الموردين", "supplier"]);

  if (ci === -1) throw new Error("No 'code' column found in this file.");

  const rows: ParsedRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const code = String(row[ci] ?? "").trim();
    if (!code) continue;
    rows.push({
      code,
      name: ni !== -1 ? String(row[ni] ?? "").trim() : "",
      order: oi !== -1 ? String(row[oi] ?? "").trim() : "",
      supplier: si !== -1 ? String(row[si] ?? "").trim() : "",
      // The marker column is only filled in on ordered rows (value "-0-"),
      // blank otherwise — so any non-empty cell means "ordered that day".
      marked: zi !== -1 && String(row[zi] ?? "").trim() !== "",
    });
  }
  if (rows.length === 0) throw new Error("No rows with a code were found.");

  const date = dateFromName(file.name) ?? toDateStr(new Date(file.lastModified));
  return { date, rows };
}

// ---- Component -----------------------------------------------------------

export function ZeroCodesClient() {
  const [files, setFiles] = React.useState<SavedFile[]>([]);
  const [loadingFiles, setLoadingFiles] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const [query, setQuery] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [results, setResults] = React.useState<SearchResult[] | null>(null);
  const [showSaved, setShowSaved] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoadingFiles(true);
    try {
      const res = await fetch("/api/zero-codes");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setFiles(Array.isArray(data.files) ? data.files : []);
    } catch {
      setFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const onFiles = React.useCallback(
    async (list: FileList | null) => {
      if (!list || list.length === 0) return;
      setUploading(true);
      let ok = 0;
      let fail = 0;
      for (const file of Array.from(list)) {
        try {
          const { date, rows } = await parseCsv(file);
          const res = await fetch("/api/zero-codes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date, fileName: file.name, rows }),
          });
          if (!res.ok) throw new Error();
          const data = await res.json();
          ok++;
          toast.success(
            `${date}: ${data.rows} rows (${data.marked} ordered) saved.`,
          );
        } catch (e) {
          fail++;
          toast.error(
            `${file.name}: ${e instanceof Error ? e.message : "could not read file"}`,
          );
        }
      }
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
      if (ok > 0) {
        await refresh();
        if (results) await runSearch(query, true);
      }
      if (ok && fail) toast.info(`${ok} saved, ${fail} failed.`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refresh, results, query],
  );

  const del = React.useCallback(
    async (date: string) => {
      setDeleting(date);
      try {
        const res = await fetch(`/api/zero-codes?date=${date}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error();
        toast.success(`Removed ${date}.`);
        await refresh();
      } catch {
        toast.error("Could not remove the file.");
      } finally {
        setDeleting(null);
      }
    },
    [refresh],
  );

  const runSearch = React.useCallback(
    async (raw: string, silent = false) => {
      const codes = raw
        .split(/[\s,;\n]+/)
        .map((c) => c.trim())
        .filter(Boolean);
      if (codes.length === 0) {
        if (!silent) toast.info("Type at least one code to search.");
        setResults(null);
        return;
      }
      setSearching(true);
      try {
        const res = await fetch("/api/zero-codes/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ codes }),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setResults(Array.isArray(data.results) ? data.results : []);
      } catch {
        if (!silent) toast.error("Search failed.");
      } finally {
        setSearching(false);
      }
    },
    [],
  );

  const totalDays = files.length;
  const totalMarked = files.reduce((a, f) => a + f.marked, 0);

  return (
    <div className="space-y-6">
      {/* Upload */}
      <section className="space-y-3">
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card p-8 text-center outline-none transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            multiple
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
          <div className="rounded-full bg-muted p-3">
            {uploading ? (
              <Loader2 className="size-6 animate-spin text-primary" />
            ) : (
              <Upload className="size-6 text-muted-foreground" />
            )}
          </div>
          <div>
            <p className="font-medium">
              {uploading
                ? "Saving files…"
                : "Click to choose files, or drag them here"}
            </p>
            <p className="text-sm text-muted-foreground">
              One or many AppSheet.ViewData.YYYY-MM-DD.csv files. Re-uploading a
              date replaces it.
            </p>
          </div>
        </div>
      </section>

      {/* Search */}
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Search className="size-4 text-muted-foreground" />
          Search a code across all days
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch(query);
            }}
            placeholder="e.g. 128847 113318 123700"
            className="h-9 min-w-64 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button onClick={() => runSearch(query)} disabled={searching}>
            {searching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            Search
          </Button>
          {results && (
            <Button
              variant="ghost"
              onClick={() => {
                setResults(null);
                setQuery("");
              }}
            >
              Clear
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Separate multiple codes with spaces, commas, or new lines.
        </p>

        {results && (
          <div className="mt-4 space-y-3">
            {results.length === 0 && (
              <p className="text-sm text-muted-foreground">No codes searched.</p>
            )}
            {results.map((r) => (
              <ResultCard key={r.code} r={r} />
            ))}
          </div>
        )}
      </section>

      {/* Saved files */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowSaved((v) => !v)}
            className="inline-flex items-center gap-1.5 text-sm font-semibold outline-none hover:text-primary focus-visible:text-primary"
            aria-expanded={showSaved}
          >
            {showSaved ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            Saved days
          </button>
          <span className="text-xs text-muted-foreground">
            {totalDays} day{totalDays === 1 ? "" : "s"} · {totalMarked} codes
            ordered in total
          </span>
        </div>

        {!showSaved ? null : loadingFiles ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : files.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
            No files yet. Upload your first daily list above.
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">File</th>
                  <th className="px-3 py-2 text-right font-medium">Rows</th>
                  <th className="px-3 py-2 text-right font-medium">Ordered</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.date} className="border-t border-border">
                    <td className="whitespace-nowrap px-3 py-2 font-medium">
                      {f.date}
                    </td>
                    <td className="max-w-56 truncate px-3 py-2 text-muted-foreground">
                      {f.fileName}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {f.rows}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {f.marked}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${f.date}`}
                        disabled={deleting === f.date}
                        onClick={() => del(f.date)}
                      >
                        {deleting === f.date ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ResultCard({ r }: { r: SearchResult }) {
  const badge =
    r.status === "found" ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
        <CheckCircle2 className="size-3.5" /> {r.hits.length} day
        {r.hits.length === 1 ? "" : "s"}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        <XCircle className="size-3.5" /> Not found
      </span>
    );

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold">{r.code}</span>
          {r.name && (
            <span className="text-sm text-muted-foreground" dir="auto">
              {r.name}
            </span>
          )}
        </div>
        {badge}
      </div>

      {r.status === "found" && (
        <ul className="mt-2 space-y-2 text-sm">
          {r.hits.map((h, i) => (
            <li
              key={i}
              className="flex flex-col rounded-md border border-border bg-muted/30 px-3 py-1.5"
            >
              <span className="font-medium tabular-nums">{h.date}</span>
              <span className="text-muted-foreground">
                Order: {h.order || "—"}
              </span>
              {h.supplier && (
                <span className="text-xs text-muted-foreground" dir="auto">
                  {h.supplier}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
