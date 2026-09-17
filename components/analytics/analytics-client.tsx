"use client";

import * as React from "react";
import { fromDateStr, isValidDateStr, monthLabel } from "@/lib/dates";

type Order = Record<string, string> & { _id: string };

// ── Date helpers ────────────────────────────────────────────────────────────

const daysInMonth = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();

// The order day is stored as a full "YYYY-MM-DD" date; legacy rows hold a bare
// day-of-month (1–31) which we resolve within the order's own month. Mirrors the
// logic used on the Orders board so both tabs agree on the due date.
function dueDateOf(order: Order): Date | null {
  const raw = (order.orderDay ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, mo, d] = raw.split("-").map(Number);
    return new Date(y, mo - 1, d);
  }
  const day = parseInt(raw, 10);
  if (!day || day < 1 || day > 31) return null;
  const m = (order.month ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [year, mo] = m.split("-").map(Number);
  return new Date(year, mo - 1, Math.min(day, daysInMonth(year, mo - 1)));
}

// The month an order belongs to, as "YYYY-MM" — prefers real work dates, falls
// back to createdAt. Drives the month filter.
function monthFromOrder(o: Order): string {
  for (const key of ["dateOfDoing", "sendDate", "inReview"]) {
    const v = (o[key] ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.slice(0, 7);
  }
  const created = (o.createdAt ?? "").trim();
  const m = created.match(/^(\d{4}-\d{2})/);
  return m ? m[1] : "";
}

// Whole-day difference b − a; null if either date is missing. Negative gaps
// (done ahead of the previous milestone) are clamped to 0 — there's no such
// thing as a negative delay.
function dayGap(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

// Only orders flagged important are analyzed.
function isImportant(o: Order): boolean {
  return (o.important ?? "").trim().toLowerCase() === "yes";
}

// ── Pipeline stages ───────────────────────────────────────────────────────────

type Stage = {
  key: string;
  label: string;
  from: (o: Order) => Date | null;
  to: (o: Order) => Date | null;
};

const dateField = (key: string) => (o: Order) => {
  const v = (o[key] ?? "").trim();
  return isValidDateStr(v) ? fromDateStr(v) : null;
};

const STAGES: Stage[] = [
  {
    key: "prep",
    label: "Order day → Date of doing",
    from: dueDateOf,
    to: dateField("dateOfDoing"),
  },
  {
    key: "review",
    label: "Date of doing → In review",
    from: dateField("dateOfDoing"),
    to: dateField("inReview"),
  },
  {
    key: "send",
    label: "In review → Send date",
    from: dateField("inReview"),
    to: dateField("sendDate"),
  },
];

// ── Stats ─────────────────────────────────────────────────────────────────────

function stats(values: number[]) {
  if (values.length === 0) {
    return { count: 0, avg: 0, median: 0, min: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  return {
    count: sorted.length,
    avg: sum / sorted.length,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

const fmtDays = (n: number) => {
  const rounded = Math.round(n * 10) / 10;
  const s = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${s}d`;
};

// ── Component ──────────────────────────────────────────────────────────────────

export function AnalyticsClient() {
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [month, setMonth] = React.useState<string>("all");
  const [sort, setSort] = React.useState<{
    key: string;
    dir: "asc" | "desc";
  } | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/orders");
        if (!res.ok) throw new Error(`Failed to load orders (${res.status})`);
        const data = await res.json();
        if (alive) setOrders(Array.isArray(data.orders) ? data.orders : []);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Analytics only ever considers important orders.
  const important = React.useMemo(() => orders.filter(isImportant), [orders]);

  const months = React.useMemo(() => {
    const set = new Set<string>();
    for (const o of important) {
      const m = monthFromOrder(o);
      if (m) set.add(m);
    }
    return Array.from(set).sort().reverse();
  }, [important]);

  const filtered = React.useMemo(
    () =>
      month === "all"
        ? important
        : important.filter((o) => monthFromOrder(o) === month),
    [important, month],
  );

  // Per-order computed gaps, keyed by stage; kept alongside the order for the table.
  const rows = React.useMemo(
    () =>
      filtered.map((o) => ({
        order: o,
        gaps: Object.fromEntries(
          STAGES.map((s) => [s.key, dayGap(s.from(o), s.to(o))]),
        ) as Record<string, number | null>,
      })),
    [filtered],
  );

  const stageStats = React.useMemo(
    () =>
      STAGES.map((s) => ({
        stage: s,
        ...stats(
          rows
            .map((r) => r.gaps[s.key])
            .filter((v): v is number => v !== null),
        ),
      })),
    [rows],
  );

  // Rows in display order. When a stage column is sorted, orders missing that
  // stage (blank gap) always sink to the bottom regardless of direction.
  const sortedRows = React.useMemo(() => {
    if (!sort) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a.gaps[sort.key];
      const bv = b.gaps[sort.key];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
  }, [rows, sort]);

  const toggleSort = (key: string) =>
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "asc" },
    );

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }
  if (error) {
    return <p className="text-sm text-red-500">{error}</p>;
  }

  return (
    <div className="space-y-6">
      {/* Month filter */}
      <div className="flex items-center gap-2">
        <label htmlFor="month" className="text-sm text-muted-foreground">
          Month
        </label>
        <select
          id="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-md border border-border bg-background px-2 py-1 text-sm"
        >
          <option value="all">All months</option>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">
          {filtered.length} order{filtered.length === 1 ? "" : "s"}
        </span>
      </div>

      {/* Stage summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stageStats.map((s) => (
          <div
            key={s.stage.key}
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="text-sm font-medium">{s.stage.label}</div>
            {s.count === 0 ? (
              <div className="mt-3 text-sm text-muted-foreground">
                No completed orders in this stage.
              </div>
            ) : (
              <>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-bold tracking-tight">
                    {fmtDays(s.avg)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    average delay
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <dt>Median</dt>
                    <dd className="font-medium text-foreground">
                      {fmtDays(s.median)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Count</dt>
                    <dd className="font-medium text-foreground">{s.count}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Fastest</dt>
                    <dd className="font-medium text-foreground">
                      {fmtDays(s.min)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Slowest</dt>
                    <dd className="font-medium text-foreground">
                      {fmtDays(s.max)}
                    </dd>
                  </div>
                </dl>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Per-order breakdown */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Company</th>
              {STAGES.map((s) => {
                const active = sort?.key === s.key;
                return (
                  <th key={s.key} className="px-3 py-2 text-right font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort(s.key)}
                      className="ml-auto flex items-center gap-1 hover:text-foreground"
                      title="Click to sort"
                    >
                      <span>{s.label}</span>
                      <span
                        className={
                          active ? "text-foreground" : "text-muted-foreground/50"
                        }
                      >
                        {active ? (sort!.dir === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={STAGES.length + 1}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  No orders to analyze.
                </td>
              </tr>
            ) : (
              sortedRows.map(({ order, gaps }) => (
                <tr key={order._id} className="border-t border-border">
                  <td className="px-3 py-2">
                    {(order.companyName ?? "").trim() || "—"}
                  </td>
                  {STAGES.map((s) => {
                    const g = gaps[s.key];
                    return (
                      <td
                        key={s.key}
                        className={`px-3 py-2 text-right tabular-nums ${
                          g === null
                            ? "text-muted-foreground"
                            : g > 0
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {g === null ? "—" : fmtDays(g)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
