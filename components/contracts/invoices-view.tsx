"use client";

// "Invoices" view: every purchase invoice with its distributor and date, and
// a way to move an invoice to another date — e.g. printed 2026/10/01 by the
// distributor but really belonging to 2026/09/28 (Q3, not Q4). Moves are
// saved with the contract and applied before the quarterly totals.

import * as React from "react";
import {
  ArrowRight,
  CalendarClock,
  ChevronDown,
  FileText,
  RotateCcw,
  Search,
  Undo2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  QUARTER_LABELS,
  quarterOf,
  summarizeInvoices,
  type PriceBasis,
  type PurchaseRow,
} from "@/lib/contracts";

const CURRENCY = "EGP";
const full = (v: number) => Math.round(v).toLocaleString("en-US");
// Days from a quarter edge that count as "near the edge".
const EDGE_DAYS = 7;

const toInput = (d: string) => d.replaceAll("/", "-"); // yyyy-mm-dd
const fromInput = (d: string) => d.replaceAll("-", "/");

// Days between the date and the closest start/end of its quarter.
function daysToQuarterEdge(date: string): number {
  const [y, m, d] = date.split("/").map(Number);
  if (!y || !m || !d) return Infinity;
  const q = Math.floor((m - 1) / 3);
  const t = Date.UTC(y, m - 1, d);
  const start = Date.UTC(y, q * 3, 1);
  const end = Date.UTC(y, q * 3 + 3, 0);
  return Math.min(t - start, end - t) / 86_400_000;
}

// Last day of the quarter before the date's quarter, as "yyyy/mm/dd".
function prevQuarterEnd(date: string): string {
  const [y, m] = date.split("/").map(Number);
  const q = Math.floor((m - 1) / 3);
  const end = new Date(Date.UTC(y, q * 3, 0));
  return `${end.getUTCFullYear()}/${String(end.getUTCMonth() + 1).padStart(2, "0")}/${String(end.getUTCDate()).padStart(2, "0")}`;
}

// Date an invoice moves to when re-assigned to quarter `q` of its year:
// back → last day of that quarter, forward → its first day.
function quarterTarget(orig: string, q: number): string {
  const y = Number(orig.slice(0, 4));
  const from = quarterOf(orig);
  const d =
    q < from
      ? new Date(Date.UTC(y, q * 3 + 3, 0))
      : new Date(Date.UTC(y, q * 3, 1));
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
}

// Clickable quarter badge: opens Q1–Q4 to re-assign the invoice.
function QuarterPicker({
  fromQ,
  toQ,
  moved,
  onPick,
}: {
  fromQ: number;
  toQ: number;
  moved: boolean;
  onPick: (q: number) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-md transition-opacity hover:opacity-80"
        title="Change the quarter this invoice counts in"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {moved && toQ !== fromQ && (
          <>
            <QBadge q={fromQ} muted />
            <ArrowRight className="size-3 text-muted-foreground" />
          </>
        )}
        <QBadge q={toQ} />
        <ChevronDown className="size-3 text-muted-foreground" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1.5 w-52 rounded-xl border border-border bg-popover p-1.5 shadow-lg"
        >
          <p className="px-2 pb-1.5 pt-1 text-[11px] text-muted-foreground">
            Count this invoice in…
          </p>
          {QUARTER_LABELS.map((l, q) => (
            <button
              key={l}
              type="button"
              role="menuitem"
              onClick={() => {
                onPick(q);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted",
                q === toQ && "bg-viz-1/10 font-semibold text-viz-1",
              )}
            >
              <span>
                {l}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  {["Jan – Mar", "Apr – Jun", "Jul – Sep", "Oct – Dec"][q]}
                </span>
              </span>
              {q === fromQ && (
                <span className="text-[10px] font-normal text-muted-foreground">
                  original
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QBadge({ q, muted }: { q: number; muted?: boolean }) {
  if (q < 0) return null;
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
        muted
          ? "bg-muted text-muted-foreground line-through"
          : "bg-viz-1/12 text-viz-1",
      )}
    >
      {QUARTER_LABELS[q]}
    </span>
  );
}

type Filter = "all" | "edge" | "moved";

export function InvoicesView({
  rows,
  moves,
  onMovesChange,
  basis,
}: {
  basis: PriceBasis;
  rows: PurchaseRow[];
  moves: Record<string, string>;
  onMovesChange: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const invoices = React.useMemo(
    () => summarizeInvoices(rows, basis),
    [rows, basis],
  );
  const suppliers = React.useMemo(
    () =>
      [...new Set(invoices.map((i) => i.supplier))].sort((a, b) =>
        a.localeCompare(b, "ar"),
      ),
    [invoices],
  );

  const [query, setQuery] = React.useState("");
  const [supplier, setSupplier] = React.useState("");
  const [quarter, setQuarter] = React.useState(-1);
  const [filter, setFilter] = React.useState<Filter>("all");

  const move = (key: string, to: string | null, orig: string) =>
    onMovesChange((prev) => {
      const next = { ...prev };
      if (!to || to === orig) delete next[key];
      else next[key] = to;
      return next;
    });

  // Only moves for invoices in this upload count.
  const movedHere = invoices.filter((i) => moves[i.key]);
  const shift = [0, 0, 0, 0]; // net value change per quarter from moves
  for (const i of movedHere) {
    const from = quarterOf(i.date);
    const to = quarterOf(moves[i.key]);
    if (from >= 0) shift[from] -= i.value;
    if (to >= 0) shift[to] += i.value;
  }
  const edgeCount = invoices.filter(
    (i) => daysToQuarterEdge(i.date) < EDGE_DAYS,
  ).length;

  const q = query.trim().toLowerCase();
  const shown = invoices.filter((i) => {
    if (supplier && i.supplier !== supplier) return false;
    const eff = moves[i.key] ?? i.date;
    if (quarter >= 0 && quarterOf(eff) !== quarter) return false;
    if (filter === "moved" && !moves[i.key]) return false;
    if (filter === "edge" && daysToQuarterEdge(i.date) >= EDGE_DAYS) return false;
    if (
      q &&
      !i.invoice.toLowerCase().includes(q) &&
      !i.supplier.toLowerCase().includes(q)
    )
      return false;
    return true;
  });
  const shownValue = shown.reduce((a, i) => a + i.value, 0);

  const control =
    "h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

  return (
    <div className="space-y-5">
      {/* Intro + what the moves change. */}
      <section className="relative overflow-hidden rounded-3xl border border-border bg-linear-to-br from-viz-1/[0.07] via-card to-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-xl space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-xl bg-viz-1/10 text-viz-1">
                <FileText className="size-4.5" />
              </span>
              <h3 className="text-base font-semibold">Invoices & dates</h3>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Every purchase invoice with its distributor and date. If a
              distributor printed an invoice late (e.g. on{" "}
              <b className="text-foreground">1 Oct</b> for a sale on{" "}
              <b className="text-foreground">28 Sep</b>), change its date here —
              the whole invoice then counts in the right quarter. Click{" "}
              <b className="text-foreground">Update saved</b> to keep the moves.
              Tip: click a quarter badge (Q1–Q4) to move an invoice in one
              click.
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-6 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Invoices</dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {invoices.length.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Near a quarter edge
              </dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {edgeCount.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Moved</dt>
              <dd
                className={cn(
                  "text-2xl font-semibold tabular-nums",
                  movedHere.length > 0 && "text-viz-1",
                )}
              >
                {movedHere.length.toLocaleString()}
              </dd>
            </div>
          </dl>
        </div>

        {movedHere.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-xs">
            <span className="font-medium text-muted-foreground">
              Effect on quarters:
            </span>
            {shift.map((v, i) =>
              Math.round(v) === 0 ? null : (
                <span
                  key={i}
                  className={cn(
                    "rounded-full px-2.5 py-1 font-semibold tabular-nums",
                    v > 0
                      ? "bg-viz-good/12 text-viz-good-ink"
                      : "bg-viz-warn/18 text-viz-warn-ink",
                  )}
                >
                  {QUARTER_LABELS[i]} {v > 0 ? "+" : "−"}
                  {full(Math.abs(v))}
                </span>
              ),
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => onMovesChange({})}
            >
              <RotateCcw className="size-3.5" />
              Undo all moves
            </Button>
          </div>
        )}
      </section>

      {/* Filters. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search invoice # or distributor…"
            className={cn(control, "w-full pl-9")}
          />
        </div>
        <select
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          className={cn(control, "max-w-64")}
          dir="auto"
          aria-label="Distributor"
        >
          <option value="">All distributors</option>
          {suppliers.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={quarter}
          onChange={(e) => setQuarter(Number(e.target.value))}
          className={control}
          aria-label="Quarter"
        >
          <option value={-1}>All quarters</option>
          {QUARTER_LABELS.map((l, i) => (
            <option key={l} value={i}>
              Counts in {l}
            </option>
          ))}
        </select>
        <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5 text-sm">
          {(
            [
              ["all", "All"],
              ["edge", `Near quarter edge (±${EDGE_DAYS}d)`],
              ["moved", "Moved"],
            ] as [Filter, string][]
          ).map(([f, label]) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-3 py-1.5 font-medium transition-colors",
                filter === f
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {shown.length.toLocaleString()} invoice{shown.length === 1 ? "" : "s"} ·{" "}
        <b className="tabular-nums text-foreground">
          {full(shownValue)} {CURRENCY}
        </b>{" "}
        (paid lines, {basis === "exTax" ? "excl." : "incl."} tax)
      </p>

      {/* Invoice table. */}
      <div className="max-h-[640px] overflow-auto rounded-2xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card/95 text-xs text-muted-foreground backdrop-blur">
            <tr className="border-b border-border text-left">
              <th className="px-4 py-3 font-medium">Printed date</th>
              <th className="px-4 py-3 font-medium">Distributor</th>
              <th className="px-4 py-3 font-medium">Invoice #</th>
              <th className="px-4 py-3 text-right font-medium">Lines</th>
              <th className="px-4 py-3 text-right font-medium">
                Value ({CURRENCY})
              </th>
              <th className="px-4 py-3 font-medium">Counts on</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => {
              const to = moves[i.key];
              const fromQ = quarterOf(i.date);
              const toQ = to ? quarterOf(to) : fromQ;
              const edge = daysToQuarterEdge(i.date) < EDGE_DAYS;
              // Early in a quarter → offer "move to previous quarter end".
              const day = Number(i.date.slice(8, 10));
              const monthInQ = (Number(i.date.slice(5, 7)) - 1) % 3;
              const earlyInQ = monthInQ === 0 && day <= EDGE_DAYS;
              return (
                <tr
                  key={i.key}
                  className={cn(
                    "border-b border-border/70 transition-colors last:border-0 hover:bg-muted/40",
                    to && "bg-viz-1/[0.04]",
                  )}
                >
                  <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                    <span className="flex items-center gap-2">
                      {i.date || "—"}
                      {edge && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded bg-viz-warn/18 px-1.5 py-0.5 text-[10px] font-semibold text-viz-warn-ink"
                          title={`Within ${EDGE_DAYS} days of a quarter start/end`}
                        >
                          <CalendarClock className="size-3" /> edge
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="max-w-64 truncate px-4 py-2.5" dir="auto" title={i.supplier}>
                    {i.supplier}
                  </td>
                  <td className="px-4 py-2.5 font-medium tabular-nums">
                    {i.invoice || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {i.lines}
                    {i.bonusLines > 0 && (
                      <span title="Bonus lines (أساسي = 100%)">
                        {" "}
                        (+{i.bonusLines} bonus)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                    {full(i.value)}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <input
                        type="date"
                        value={toInput(to ?? i.date)}
                        onChange={(e) =>
                          move(i.key, e.target.value ? fromInput(e.target.value) : null, i.date)
                        }
                        className={cn(
                          "h-8 rounded-lg border bg-background px-2 text-xs tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                          to ? "border-viz-1/60" : "border-border",
                        )}
                        aria-label={`Date invoice ${i.invoice} counts on`}
                      />
                      <QuarterPicker
                        fromQ={fromQ}
                        toQ={toQ}
                        moved={!!to}
                        onPick={(q) =>
                          move(
                            i.key,
                            q === fromQ ? null : quarterTarget(i.date, q),
                            i.date,
                          )
                        }
                      />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    {to ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => move(i.key, null, i.date)}
                        title={`Back to ${i.date}`}
                      >
                        <Undo2 className="size-3.5" />
                        Reset
                      </Button>
                    ) : (
                      earlyInQ &&
                      fromQ > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => move(i.key, prevQuarterEnd(i.date), i.date)}
                          title={`Count it on ${prevQuarterEnd(i.date)}`}
                        >
                          Move to {QUARTER_LABELS[fromQ - 1]}
                        </Button>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-sm text-muted-foreground"
                >
                  No invoices match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
