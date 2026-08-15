"use client";

import * as React from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import {
  AlarmClock,
  Calendar,
  Check,
  Clock,
  FileSpreadsheet,
  Loader2,
  Minus,
  Save,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { currentMonthStr, monthLabel } from "@/lib/dates";
import {
  aggregateItems,
  EXPIRY_COLUMNS,
  extractExpiryMeta,
  groupByCompany,
  normalizeCompany,
  parseExpiryHtml,
  summarizeExpiry,
  URGENCY_LABELS,
  type ExpiryMeta,
  type ExpiryRow,
} from "@/lib/expiry";
import {
  CompanyExpiryModal,
  DaysBadge,
  int,
  money,
  URGENCY_TONE,
} from "@/components/expiry/company-expiry-modal";

const HTML_ACCEPT = ".htm,.html";
const isHtml = (f: File) => /\.html?$/i.test(f.name);

// Manual renames — a supplier/company that should read (and match) as another
// name. Keyed by the short form; matched on the normalized name so small
// spelling differences still hit. Applied to both report suppliers and Orders
// company names before matching, so either source lines up. (Currently empty —
// company names are fixed in the Orders tab itself.)
const RENAMES: Array<[string, string]> = [];
const applyRename = (s: string): string => {
  const base = normalizeCompany(s);
  for (const [from, to] of RENAMES) {
    if (normalizeCompany(from) === base) return to;
  }
  return s;
};

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

// One saved month, as returned by GET /api/expiry?history=1.
type MonthSummary = {
  month: string; // "YYYY-MM"
  savedAt?: string;
  summary: {
    items: number;
    units: number;
    costValue: number;
    retailValue: number;
    expiredItems: number;
    expiredCost: number;
  };
};

// A month-over-month change chip. Cost value AT RISK, so up = worse (red),
// down = better (green). `null` for the first month (no prior to compare).
function Delta({ curr, prev }: { curr: number; prev: number | null }) {
  if (prev === null) return <span className="text-muted-foreground/40">—</span>;
  const diff = curr - prev;
  if (Math.abs(diff) < 0.005)
    return (
      <span className="inline-flex items-center gap-0.5 text-muted-foreground">
        <Minus className="size-3" /> 0
      </span>
    );
  const up = diff > 0;
  const pct = prev !== 0 ? (diff / Math.abs(prev)) * 100 : null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-medium tabular-nums",
        up ? "text-destructive" : "text-emerald-600 dark:text-emerald-400",
      )}
      title={`${up ? "+" : ""}${Math.round(diff).toLocaleString()} vs previous month`}
    >
      {up ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {up ? "+" : "−"}
      {Math.abs(Math.round(diff)).toLocaleString()}
      {pct !== null && (
        <span className="opacity-70">
          ({up ? "+" : "−"}
          {Math.abs(pct).toFixed(0)}%)
        </span>
      )}
    </span>
  );
}

// The saved-month history: each month's totals with a delta against the month
// before it, so a rising or falling value at risk is obvious at a glance.
function MonthlyTrend({
  months,
  onSelect,
  loadingMonth,
}: {
  months: MonthSummary[];
  onSelect: (month: string) => void;
  loadingMonth: string | null;
}) {
  if (months.length === 0) return null;
  const maxCost = Math.max(...months.map((m) => m.summary.costValue), 1);
  // Newest first for reading; each row compares to the chronologically prior month.
  const ordered = [...months].reverse();
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Monthly trend</div>
        <span className="text-xs text-muted-foreground">
          {months.length} month{months.length === 1 ? "" : "s"} saved
        </span>
      </div>
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-center text-muted-foreground">
              <th className="border-b border-border px-3 py-2 text-left font-semibold">
                Month
              </th>
              <th className="border-b border-border px-3 py-2 font-semibold">
                Items
              </th>
              <th className="border-b border-border px-3 py-2 font-semibold">
                Units
              </th>
              <th className="border-b border-border px-3 py-2 text-right font-semibold">
                Cost value
              </th>
              <th className="border-b border-border px-3 py-2 text-left font-semibold">
                Change
              </th>
              <th className="border-b border-border px-3 py-2 font-semibold">
                Expired
              </th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((m) => {
              const chronIdx = months.findIndex((x) => x.month === m.month);
              const prev = chronIdx > 0 ? months[chronIdx - 1] : null;
              return (
                <tr
                  key={m.month}
                  onClick={() => onSelect(m.month)}
                  className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/40"
                  title={`View ${monthLabel(m.month)}`}
                >
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-2">
                      {monthLabel(m.month)}
                      {loadingMonth === m.month && (
                        <Loader2 className="size-3 animate-spin text-muted-foreground" />
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">
                    {int(m.summary.items)}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">
                    {int(m.summary.units)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-2 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{
                            width: `${(m.summary.costValue / maxCost) * 100}%`,
                          }}
                        />
                      </div>
                      {money(m.summary.costValue)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-left">
                    <Delta
                      curr={m.summary.costValue}
                      prev={prev ? prev.summary.costValue : null}
                    />
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                    {int(m.summary.expiredItems)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// A saved month opened from the trend table: its headline totals and a
// company breakdown, with each company clickable for its item detail.
function MonthDetailModal({
  month,
  rows,
  savedAt,
  today,
  onClose,
}: {
  month: string;
  rows: ExpiryRow[];
  savedAt: string | null;
  today: Date;
  onClose: () => void;
}) {
  const [openCompany, setOpenCompany] = React.useState<string | null>(null);
  const summary = React.useMemo(
    () => summarizeExpiry(rows, today),
    [rows, today],
  );
  const companies = React.useMemo(
    () => groupByCompany(rows, today),
    [rows, today],
  );
  const activeGroup = companies.find((c) => c.company === openCompany) ?? null;
  const maxCompanyValue = Math.max(...companies.map((c) => c.costValue), 1);

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
        onClick={onClose}
      >
        <div
          className="w-full max-w-4xl rounded-xl border border-border bg-card p-5 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">{monthLabel(month)}</h2>
              <p className="text-xs text-muted-foreground">
                Saved snapshot
                {savedAt && <> · {new Date(savedAt).toLocaleString()}</>}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </div>

          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No items saved for {monthLabel(month)}.
            </p>
          ) : (
            <>
              <div className="mb-4 grid gap-3 sm:grid-cols-4">
                <StatCard
                  label="Items"
                  value={int(summary.items)}
                  hint={`${int(summary.units)} units`}
                />
                <StatCard
                  label="Cost value"
                  value={money(summary.costValue)}
                />
                <StatCard
                  label="Retail value"
                  value={money(summary.retailValue)}
                />
                <StatCard
                  label="Expired"
                  value={int(
                    summary.buckets.find((b) => b.key === "expired")!.items,
                  )}
                  hint={money(
                    summary.buckets.find((b) => b.key === "expired")!.costValue,
                  )}
                />
              </div>

              <div className="overflow-auto rounded-xl border border-border">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-card">
                    <tr className="text-center">
                      <th className="border-b border-border px-3 py-2 text-right font-semibold">
                        Company
                      </th>
                      <th className="border-b border-border px-3 py-2 font-semibold">
                        Items
                      </th>
                      <th className="border-b border-border px-3 py-2 font-semibold">
                        Units
                      </th>
                      <th className="border-b border-border px-3 py-2 font-semibold">
                        Soonest
                      </th>
                      <th className="border-b border-border px-3 py-2 font-semibold">
                        Cost value
                      </th>
                      <th className="border-b border-border px-3 py-2 text-start font-semibold">
                        Share
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((c) => (
                      <tr
                        key={c.company}
                        onClick={() => setOpenCompany(c.company)}
                        className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/40"
                      >
                        <td
                          className="px-3 py-2 text-right font-medium"
                          dir="rtl"
                        >
                          {c.company}
                        </td>
                        <td className="px-3 py-2 text-center tabular-nums">
                          {int(c.items)}
                        </td>
                        <td className="px-3 py-2 text-center tabular-nums">
                          {int(c.units)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {c.nearestDays === null ? (
                            <span className="text-muted-foreground/50">—</span>
                          ) : (
                            <DaysBadge days={c.nearestDays} />
                          )}
                        </td>
                        <td className="px-3 py-2 text-center font-semibold tabular-nums">
                          {money(c.costValue)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{
                                  width: `${(c.costValue / maxCompanyValue) * 100}%`,
                                }}
                              />
                            </div>
                            <span className="tabular-nums text-xs text-muted-foreground">
                              {summary.costValue > 0
                                ? ((c.costValue / summary.costValue) * 100).toFixed(1)
                                : "0.0"}
                              %
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {activeGroup && (
        <CompanyExpiryModal
          company={activeGroup.company}
          rows={activeGroup.rows}
          today={today}
          onClose={() => setOpenCompany(null)}
        />
      )}
    </>
  );
}

export function ExpiryClient() {
  const [rows, setRows] = React.useState<ExpiryRow[]>([]);
  const [files, setFiles] = React.useState<string[]>([]);
  const [meta, setMeta] = React.useState<ExpiryMeta | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Company currently open in the detail popup.
  const [openCompany, setOpenCompany] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  // Which monthly cycle this snapshot is filed under when saved.
  const [saveMonth, setSaveMonth] = React.useState(currentMonthStr);
  // The saved-month history that powers the trend view.
  const [history, setHistory] = React.useState<MonthSummary[]>([]);
  // A saved month opened from the trend table for its full breakdown.
  const [monthView, setMonthView] = React.useState<{
    month: string;
    rows: ExpiryRow[];
    savedAt: string | null;
  } | null>(null);
  const [monthLoading, setMonthLoading] = React.useState<string | null>(null);

  // Per-company review state for the working month (saveMonth), keyed by the
  // normalized company name: whether it's been handled ("done" vs "pending")
  // and a free-text note. Loaded from /api/expiry-review and saved per change.
  type Review = { status: "pending" | "done"; note: string };
  const [reviews, setReviews] = React.useState<Map<string, Review>>(new Map());

  const inputRef = React.useRef<HTMLInputElement>(null);

  // Fixed "today" for the lifetime of the view so day counts stay stable.
  const today = React.useMemo(() => new Date(), []);

  // "My companies" come from the Orders tab — its distinct company names. The
  // expiry report's suppliers (المورد) are matched against them, and only mine
  // count toward the totals below. `null` while the list is still loading.
  const [orderCompanies, setOrderCompanies] = React.useState<string[] | null>(
    null,
  );
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/orders");
        if (!res.ok) throw new Error();
        const data = await res.json();
        const names = new Set<string>();
        for (const o of data.orders ?? []) {
          const n = (o.companyName ?? "").trim();
          if (n) names.add(n);
        }
        if (active) setOrderCompanies([...names]);
      } catch {
        // Couldn't load Orders — treat as "no companies configured".
        if (active) setOrderCompanies([]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Show when the linked snapshot was last saved (drives the "Saved …" note).
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/expiry");
        if (!res.ok) return;
        const data = await res.json();
        if (active && data.savedAt) setSavedAt(data.savedAt);
      } catch {
        // No snapshot yet — nothing to show.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Load the saved-month history for the trend view. Reused after each save.
  const loadHistory = React.useCallback(async () => {
    try {
      const res = await fetch("/api/expiry?history=1");
      if (!res.ok) return;
      const data = await res.json();
      setHistory(data.months ?? []);
    } catch {
      // No history yet — the trend section just won't render.
    }
  }, []);
  React.useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Fetch a saved month's items and open its breakdown modal.
  const openMonth = React.useCallback(async (month: string) => {
    setMonthLoading(month);
    try {
      const res = await fetch(`/api/expiry?month=${month}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const rows: ExpiryRow[] = (data.items ?? []).map(
        (i: Record<string, unknown>) => ({
          supplier: String(i.company ?? ""),
          code: String(i.code ?? ""),
          product: String(i.product ?? ""),
          expiry: String(i.expiry ?? ""),
          qty: Number(i.qty) || 0,
          avgCost: Number(i.avgCost) || 0,
          buyPrice: Number(i.buyPrice) || 0,
          sellPrice: Number(i.sellPrice) || 0,
          total: Number(i.total) || 0,
          source: "",
        }),
      );
      setMonthView({ month, rows, savedAt: data.savedAt ?? null });
    } catch {
      toast.error("Couldn't load that month");
    } finally {
      setMonthLoading(null);
    }
  }, []);

  const addFiles = React.useCallback(
    async (incoming: File[]) => {
      const htmls = incoming.filter(isHtml);
      if (htmls.length === 0) {
        setError("Please choose .htm or .html expiry files.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const parsed: ExpiryRow[] = [];
        const names: string[] = [];
        let firstMeta: ExpiryMeta | null = null;
        for (const file of htmls) {
          const text = await file.text();
          const fileRows = await parseExpiryHtml(text, file.name);
          if (fileRows.length === 0) {
            toast.warning(`No expiry items found in ${file.name}`);
          }
          if (!firstMeta) {
            const m = extractExpiryMeta(text);
            if (m.store || m.dateFrom || m.dateTo) firstMeta = m;
          }
          parsed.push(...fileRows);
          names.push(file.name);
        }
        setRows((prev) => [...prev, ...parsed]);
        setFiles((prev) => [...prev, ...names]);
        setMeta((prev) => prev ?? firstMeta);
        toast.success(
          `Loaded ${parsed.length} item${parsed.length === 1 ? "" : "s"} from ${htmls.length} file${htmls.length === 1 ? "" : "s"}`,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not read a file.");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const clearAll = () => {
    setRows([]);
    setFiles([]);
    setMeta(null);
    setError(null);
    setOpenCompany(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  // Normalized set of my companies (from Orders). `null` while still loading,
  // and empty means "not configured" — both keep every supplier.
  const matchedSet = React.useMemo(
    () =>
      orderCompanies === null
        ? null
        : new Set(orderCompanies.map((c) => normalizeCompany(applyRename(c)))),
    [orderCompanies],
  );
  const isMyCompany = React.useCallback(
    (name: string) =>
      matchedSet === null ||
      matchedSet.size === 0 ||
      matchedSet.has(normalizeCompany(name)),
    [matchedSet],
  );

  // Keep only my companies (applying renames first), then net offsetting (+/−)
  // lines per item batch.
  const activeRows = React.useMemo(
    () =>
      aggregateItems(
        rows
          .map((r) => ({ ...r, supplier: applyRename(r.supplier || "—") }))
          .filter((r) => isMyCompany(r.supplier)),
        today,
      ),
    [rows, isMyCompany, today],
  );

  const summary = React.useMemo(
    () => summarizeExpiry(activeRows, today),
    [activeRows, today],
  );

  const companies = React.useMemo(
    () => groupByCompany(activeRows, today),
    [activeRows, today],
  );

  const activeGroup = React.useMemo(
    () => companies.find((c) => c.company === openCompany) ?? null,
    [companies, openCompany],
  );

  // Persist the current (netted, my-companies) items so the Orders tab can show
  // each company's expiry.
  const saveToOrders = async () => {
    setSaving(true);
    try {
      const items = activeRows.map((r) => ({
        company: r.supplier,
        code: r.code,
        product: r.product,
        expiry: r.expiry,
        qty: r.qty,
        avgCost: r.avgCost,
        buyPrice: r.buyPrice,
        sellPrice: r.sellPrice,
        total: r.total,
      }));
      const res = await fetch("/api/expiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, month: saveMonth }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSavedAt(data.savedAt ?? new Date().toISOString());
      await loadHistory();
      toast.success(
        `Saved ${data.count} item${data.count === 1 ? "" : "s"} for ${monthLabel(saveMonth)} — linked to Orders`,
      );
    } catch {
      toast.error("Couldn't save the expiry snapshot");
    } finally {
      setSaving(false);
    }
  };

  // Load the saved review state (status + note) for the working month.
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/expiry-review?month=${saveMonth}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        const m = new Map<string, Review>();
        for (const r of data.reviews ?? []) {
          m.set(String(r.key), {
            status: r.status === "done" ? "done" : "pending",
            note: String(r.note ?? ""),
          });
        }
        setReviews(m);
      } catch {
        // No review data — companies just start as pending with no note.
      }
    })();
    return () => {
      active = false;
    };
  }, [saveMonth]);

  const reviewOf = React.useCallback(
    (company: string): Review =>
      reviews.get(normalizeCompany(company)) ?? { status: "pending", note: "" },
    [reviews],
  );

  // Persist one company's review for the working month.
  const saveReview = React.useCallback(
    async (company: string, val: Review) => {
      try {
        const res = await fetch("/api/expiry-review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            month: saveMonth,
            company,
            status: val.status,
            note: val.note,
          }),
        });
        if (!res.ok) throw new Error();
      } catch {
        toast.error("Couldn't save the company's review");
      }
    },
    [saveMonth],
  );

  // Update a company's review locally; when `persist` is true, also save it.
  // (Note edits update locally on each keystroke and persist on blur.)
  const updateReview = React.useCallback(
    (company: string, patch: Partial<Review>, persist: boolean) => {
      const key = normalizeCompany(company);
      const cur = reviews.get(key) ?? { status: "pending", note: "" };
      const next: Review = { ...cur, ...patch };
      setReviews((prev) => new Map(prev).set(key, next));
      if (persist) void saveReview(company, next);
    },
    [reviews, saveReview],
  );

  // Export the companies table (with status + note) and every item to Excel.
  const exportExcel = React.useCallback(() => {
    const companyRows = companies.map((c) => {
      const r = reviewOf(c.company);
      return {
        Company: c.company,
        Items: c.items,
        Units: c.units,
        "Soonest (days)": c.nearestDays ?? "",
        "Cost value": c.costValue,
        "Retail value": c.retailValue,
        Expired: c.expired,
        Status: r.status === "done" ? "Done" : "Pending",
        Note: r.note,
      };
    });
    const itemRows = activeRows.map((r) => ({
      Company: r.supplier,
      Code: r.code,
      Product: r.product,
      Expiry: r.expiry,
      Qty: r.qty,
      "Avg cost": r.avgCost,
      "Buy price": r.buyPrice,
      "Sell price": r.sellPrice,
      Total: r.total,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(companyRows),
      "Companies",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(itemRows),
      "Items",
    );
    XLSX.writeFile(wb, `expiry-${saveMonth}.xlsx`);
    toast.success(`Exported ${companies.length} companies to Excel`);
  }, [companies, activeRows, reviewOf, saveMonth]);

  const hasData = rows.length > 0;
  const maxBucketValue = Math.max(...summary.buckets.map((b) => b.costValue), 1);
  const maxCompanyValue = Math.max(...companies.map((c) => c.costValue), 1);

  return (
    <div className="space-y-5">
      {/* Upload zone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const dropped = Array.from(e.dataTransfer.files ?? []);
          if (dropped.length) addFiles(dropped);
        }}
        onClick={() => inputRef.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/40"
      >
        <input
          ref={inputRef}
          type="file"
          accept={HTML_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            const chosen = Array.from(e.target.files ?? []);
            if (chosen.length) addFiles(chosen);
          }}
        />
        <div className="rounded-full bg-muted p-3">
          <AlarmClock className="size-6 text-primary" />
        </div>
        <p className="font-medium">Expiry report files</p>
        <p className="text-sm text-muted-foreground">
          Click or drag one or more .htm / .html files
        </p>
        {files.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {files.length} file{files.length === 1 ? "" : "s"} ·{" "}
            {rows.length.toLocaleString()} items
          </p>
        )}
      </div>

      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Reading files…
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {meta && (meta.store || meta.dateFrom || meta.dateTo) && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          {meta.store && (
            <span className="text-muted-foreground" dir="auto">
              المخزن: <b className="text-foreground">{meta.store}</b>
            </span>
          )}
          {(meta.dateFrom || meta.dateTo) && (
            <span className="text-muted-foreground tabular-nums">
              الصلاحية: <b className="text-foreground">{meta.dateFrom || "—"}</b>{" "}
              → <b className="text-foreground">{meta.dateTo || "—"}</b>
            </span>
          )}
        </div>
      )}

      {/* Saved-month history — visible even before a new file is loaded.
          Click a month to open its full breakdown. */}
      <MonthlyTrend
        months={history}
        onSelect={openMonth}
        loadingMonth={monthLoading}
      />

      {hasData && (
        <>
          {/* Headline value-at-risk */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Items near expiry"
              value={int(summary.items)}
              hint={`${int(summary.units)} units`}
            />
            <StatCard label="Cost value at risk" value={money(summary.costValue)} />
            <StatCard
              label="Retail value at risk"
              value={money(summary.retailValue)}
              hint={`qty × ${EXPIRY_COLUMNS.sellPrice}`}
            />
            <StatCard
              label="Already expired"
              value={int(
                summary.buckets.find((b) => b.key === "expired")!.items,
              )}
              hint={money(
                summary.buckets.find((b) => b.key === "expired")!.costValue,
              )}
            />
          </div>

          {/* Urgency buckets (overview). */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 text-sm font-semibold">By urgency</div>
            <div className="grid gap-2 sm:grid-cols-5">
              {summary.buckets.map((b) => (
                <div
                  key={b.key}
                  className="rounded-lg border border-border p-3"
                >
                  <div className={cn("text-xs font-semibold", URGENCY_TONE[b.key])}>
                    {URGENCY_LABELS[b.key]}
                  </div>
                  <div className="mt-1 text-lg font-bold tabular-nums">
                    {int(b.items)}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {money(b.costValue)}
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${(b.costValue / maxBucketValue) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Companies — click one for its item detail. */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">
                Companies ({companies.length})
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Calendar className="size-4" />
                  <input
                    type="month"
                    value={saveMonth}
                    onChange={(e) =>
                      setSaveMonth(e.target.value || currentMonthStr())
                    }
                    className="h-8 rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                    title="Which month this snapshot is filed under"
                  />
                </label>
                <Button
                  size="sm"
                  onClick={saveToOrders}
                  disabled={saving || companies.length === 0}
                >
                  {saving ? <Loader2 className="animate-spin" /> : <Save />}
                  Save to Orders
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportExcel}
                  disabled={companies.length === 0}
                  title="Download the companies (with status + note) and all items as an .xlsx file"
                >
                  <FileSpreadsheet /> Export Excel
                </Button>
                <Button variant="outline" size="sm" onClick={clearAll}>
                  <X /> Clear
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Sorted by cost value at risk. Click a company for its items — with
              filters — in a popup. Mark each company{" "}
              <b className="text-foreground">Done / Pending</b> and add a note as
              you work through them (saved per month), or{" "}
              <b className="text-foreground">Export Excel</b> to download the list
              with all items.{" "}
              <b className="text-foreground">Save to Orders</b> files this
              snapshot under the chosen month (each month keeps one) so the Orders
              tab shows each company&apos;s expiry and the trend above tracks it
              month over month.
              {savedAt && (
                <> Last saved {new Date(savedAt).toLocaleString()}.</>
              )}
            </p>

            <div className="overflow-auto rounded-xl border border-border">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-card">
                  <tr className="text-center">
                    <th className="border-b border-border px-3 py-2 text-right font-semibold">
                      Company
                    </th>
                    <th className="border-b border-border px-3 py-2 font-semibold">
                      Items
                    </th>
                    <th className="border-b border-border px-3 py-2 font-semibold">
                      Units
                    </th>
                    <th className="border-b border-border px-3 py-2 font-semibold">
                      Soonest
                    </th>
                    <th className="border-b border-border px-3 py-2 font-semibold">
                      Cost value
                    </th>
                    <th className="border-b border-border px-3 py-2 text-start font-semibold">
                      Share
                    </th>
                    <th className="border-b border-border px-3 py-2 font-semibold">
                      Status
                    </th>
                    <th className="border-b border-border px-3 py-2 text-start font-semibold">
                      Note
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => {
                    const review = reviewOf(c.company);
                    const done = review.status === "done";
                    return (
                    <tr
                      key={c.company}
                      onClick={() => setOpenCompany(c.company)}
                      className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/40"
                    >
                      <td
                        className="px-3 py-2 text-right font-medium"
                        dir="rtl"
                      >
                        {c.company}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        {int(c.items)}
                      </td>
                      <td className="px-3 py-2 text-center tabular-nums">
                        {int(c.units)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {c.nearestDays === null ? (
                          <span className="text-muted-foreground/50">—</span>
                        ) : (
                          <DaysBadge days={c.nearestDays} />
                        )}
                      </td>
                      <td className="px-3 py-2 text-center font-semibold tabular-nums">
                        {money(c.costValue)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{
                                width: `${(c.costValue / maxCompanyValue) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="tabular-nums text-xs text-muted-foreground">
                            {summary.costValue > 0
                              ? ((c.costValue / summary.costValue) * 100).toFixed(1)
                              : "0.0"}
                            %
                          </span>
                        </div>
                      </td>
                      <td
                        className="px-3 py-2 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            updateReview(
                              c.company,
                              { status: done ? "pending" : "done" },
                              true,
                            )
                          }
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                            done
                              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-400"
                              : "border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400",
                          )}
                          title="Click to toggle done / pending"
                        >
                          {done ? (
                            <Check className="size-3" />
                          ) : (
                            <Clock className="size-3" />
                          )}
                          {done ? "Done" : "Pending"}
                        </button>
                      </td>
                      <td
                        className="px-3 py-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={review.note}
                          placeholder="Add a note…"
                          onChange={(e) =>
                            updateReview(c.company, { note: e.target.value }, false)
                          }
                          onBlur={() => saveReview(c.company, reviewOf(c.company))}
                          dir="auto"
                          className="h-8 w-44 rounded-lg border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                        />
                      </td>
                    </tr>
                    );
                  })}
                  {companies.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-3 py-10 text-center text-muted-foreground"
                      >
                        No items for your companies in these files.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeGroup && (
        <CompanyExpiryModal
          company={activeGroup.company}
          rows={activeGroup.rows}
          today={today}
          onClose={() => setOpenCompany(null)}
        />
      )}

      {monthView && (
        <MonthDetailModal
          month={monthView.month}
          rows={monthView.rows}
          savedAt={monthView.savedAt}
          today={today}
          onClose={() => setMonthView(null)}
        />
      )}
    </div>
  );
}
