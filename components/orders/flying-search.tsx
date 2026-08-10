"use client";

import * as React from "react";
import Link from "next/link";
import { Loader2, Plane, Search, StickyNote, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { monthLabel } from "@/lib/dates";
import { bonusPercent } from "@/lib/tasfya/report";
import {
  parseCell,
  effRemaining,
  fmtBalance,
  type FlyingColumn,
  type FlyingRow,
} from "@/lib/tasfya/flying";

type Result = {
  month: string;
  company: string;
  supplier: string;
  referenceDate: string;
  orderNumber: string;
  columns: FlyingColumn[];
  row: FlyingRow;
};

function remClass(rem: number): string {
  if (rem < 0) return "text-red-600 dark:text-red-400";
  if (rem === 0) return "text-emerald-600 dark:text-emerald-400";
  return "text-yellow-500 dark:text-yellow-400";
}

// One matched flying row rendered as a mini flying-tasfya table (same layout as
// the worksheet), headed by its company / month / order provenance.
function ResultCard({ r }: { r: Result }) {
  const rem = effRemaining(r.row, r.columns);
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span dir="auto" className="font-semibold">
            {r.company}
          </span>
          <span className="text-muted-foreground">· {monthLabel(r.month)}</span>
          {r.supplier && (
            <span dir="auto" className="text-muted-foreground">
              · {r.supplier}
            </span>
          )}
          {r.orderNumber && (
            <span className="text-muted-foreground">· #{r.orderNumber}</span>
          )}
        </div>
        <Link
          href={`/flying/run?month=${encodeURIComponent(
            r.month,
          )}&company=${encodeURIComponent(r.company)}`}
          target="_blank"
          className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-500/20 dark:text-sky-400"
          title="Open this flying worksheet in a new tab"
        >
          <Plane className="size-3.5" /> Open
        </Link>
      </div>
      <div className="overflow-x-auto" dir="rtl">
        <table className="w-full border-collapse text-sm [&_td]:border [&_td]:border-border [&_th]:border [&_th]:border-border">
          <thead>
            <tr className="bg-muted text-center text-xs font-semibold text-muted-foreground">
              <th className="whitespace-nowrap px-2 py-1.5">الكود</th>
              <th className="min-w-[14rem] whitespace-nowrap px-3 py-1.5">
                اسم الصنف
              </th>
              <th className="whitespace-nowrap px-3 py-1.5">الباقى</th>
              <th className="whitespace-nowrap px-3 py-1.5">الكمية</th>
              {r.columns.map((col) => (
                <th key={col.id} className="whitespace-nowrap px-2 py-1.5">
                  <span dir="auto">{col.name || "—"}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="bg-card text-center">
              <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">
                <span className="inline-flex items-center justify-center gap-1.5">
                  <span dir="ltr">{r.row.code}</span>
                  {r.row.note?.trim() && (
                    <StickyNote className="size-3.5 text-amber-500" />
                  )}
                </span>
              </td>
              <td className="px-3 py-1.5" dir="auto">
                {r.row.name}
              </td>
              <td
                className={cn("px-3 py-1.5 tabular-nums", remClass(rem))}
                dir="ltr"
              >
                {fmtBalance(rem)}
              </td>
              <td className="px-3 py-1.5 tabular-nums" dir="ltr">
                {r.row.order.toLocaleString("en-US")}
              </td>
              {r.columns.map((col) => {
                const { base, bounce } = parseCell(r.row.cells[col.id]);
                const bpct = bonusPercent(base + bounce, bounce);
                return (
                  <td
                    key={col.id}
                    className="px-2 py-1.5 tabular-nums"
                    dir="ltr"
                  >
                    {base || bounce ? base.toLocaleString("en-US") : ""}
                    {bounce > 0 && (
                      <div className="-mt-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        +{bpct}% bounce
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      {r.row.note?.trim() && (
        <div className="flex items-start gap-1.5 border-t border-border bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          <StickyNote className="mt-0.5 size-3.5 shrink-0" />
          <span dir="auto">{r.row.note}</span>
        </div>
      )}
    </div>
  );
}

export function FlyingSearchModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = React.useState("");
  const [results, setResults] = React.useState<Result[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [searched, setSearched] = React.useState(false);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Debounced search: fire once the query settles (≥2 chars).
  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    let active = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/flying/search?q=${encodeURIComponent(term)}`,
        );
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (active) {
          setResults(data.results ?? []);
          setSearched(true);
        }
      } catch {
        if (active) {
          setResults([]);
          setSearched(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[8vh]"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[84vh] w-full max-w-4xl flex-col rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Plane className="size-5 shrink-0 text-sky-500" />
          <h2 className="text-sm font-semibold">Search Flying tasfya</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            {loading && (
              <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
            <input
              autoFocus
              value={q}
              dir="auto"
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by code or product name across all companies…"
              className="h-10 w-full rounded-lg border border-border bg-background pl-8 pr-9 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </div>
          {searched && (
            <p className="mt-2 text-xs text-muted-foreground">
              {results.length} match{results.length === 1 ? "" : "es"}
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 pb-3">
          {q.trim().length < 2 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Type at least 2 characters of a code or product name.
            </p>
          ) : searched && results.length === 0 && !loading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No flying-tasfya rows match &ldquo;{q.trim()}&rdquo;.
            </p>
          ) : (
            results.map((r, i) => (
              <ResultCard key={`${r.company}-${r.month}-${r.row.code}-${i}`} r={r} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
