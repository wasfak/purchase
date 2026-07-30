"use client";

import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { DataTable } from "@/components/ui/data-table";
import type { DataRow } from "@/lib/dataset";
import {
  daysUntilExpiry,
  EXPIRY_COLUMNS,
  URGENCY_LABELS,
  URGENCY_ORDER,
  urgencyOf,
  type ExpiryRow,
  type UrgencyKey,
} from "@/lib/expiry";

export const CURRENCY = "EGP";

// The extra computed column shown alongside the source columns.
export const DAYS_LEFT = "أيام متبقية";

export const money = (v: number) =>
  `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${CURRENCY}`;
export const int = (v: number) =>
  v.toLocaleString(undefined, { maximumFractionDigits: 0 });

// Tint used for each urgency bucket, from most to least urgent.
export const URGENCY_TONE: Record<UrgencyKey, string> = {
  expired: "text-destructive",
  d30: "text-orange-600 dark:text-orange-400",
  d60: "text-amber-600 dark:text-amber-400",
  d90: "text-yellow-600 dark:text-yellow-400",
  later: "text-muted-foreground",
};

// Break a day count into years / months / days (≈365 / 30), showing only the
// non-zero parts, e.g. 1335 → "3y 8m", 35 → "1m 5d", 4 → "4d".
export function formatDuration(days: number): string {
  const abs = Math.abs(days);
  const y = Math.floor(abs / 365);
  const m = Math.floor((abs % 365) / 30);
  const d = (abs % 365) % 30;
  const parts: string[] = [];
  if (y) parts.push(`${y}y`);
  if (m) parts.push(`${m}m`);
  if (d || parts.length === 0) parts.push(`${d}d`);
  return parts.join(" ");
}

// Days-left badge — colour-coded by urgency so the soonest items pop.
export function DaysBadge({ days }: { days: number }) {
  const key = urgencyOf(days);
  const label =
    days === 0
      ? "today"
      : days < 0
        ? `${formatDuration(days)} ago`
        : formatDuration(days);
  return (
    <span className={cn("font-medium tabular-nums", URGENCY_TONE[key])}>
      {label}
    </span>
  );
}

const DETAIL_COLUMNS = [
  EXPIRY_COLUMNS.code,
  EXPIRY_COLUMNS.product,
  EXPIRY_COLUMNS.expiry,
  EXPIRY_COLUMNS.qty,
  DAYS_LEFT,
  EXPIRY_COLUMNS.avgCost,
  EXPIRY_COLUMNS.buyPrice,
  EXPIRY_COLUMNS.sellPrice,
  EXPIRY_COLUMNS.total,
];

const NUMERIC = new Set<string>([
  DAYS_LEFT,
  EXPIRY_COLUMNS.qty,
  EXPIRY_COLUMNS.avgCost,
  EXPIRY_COLUMNS.buyPrice,
  EXPIRY_COLUMNS.sellPrice,
  EXPIRY_COLUMNS.total,
]);

// A popup listing one company's near-expiry items, with a local urgency filter
// on top of the DataTable's own search / sort / column filters. Shared by the
// Expiry tab and the Orders tab.
export function CompanyExpiryModal({
  company,
  rows,
  today,
  onClose,
}: {
  company: string;
  rows: ExpiryRow[];
  today: Date;
  onClose: () => void;
}) {
  const [bucket, setBucket] = React.useState<UrgencyKey | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const totals = React.useMemo(() => {
    let units = 0;
    let cost = 0;
    let retail = 0;
    for (const r of rows) {
      units += r.qty;
      cost += r.total;
      retail += r.qty * r.sellPrice;
    }
    return { items: rows.length, units, cost, retail };
  }, [rows]);

  const bucketCounts = React.useMemo(() => {
    const m = new Map<UrgencyKey, number>(URGENCY_ORDER.map((k) => [k, 0]));
    for (const r of rows) {
      const k = urgencyOf(daysUntilExpiry(r, today));
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [rows, today]);

  const tableRows = React.useMemo<DataRow[]>(() => {
    return rows
      .map((r) => ({ r, days: daysUntilExpiry(r, today) }))
      .filter(({ days }) => !bucket || urgencyOf(days) === bucket)
      .sort((a, b) => a.days - b.days)
      .map(({ r, days }, i) => ({
        __id: String(i),
        [EXPIRY_COLUMNS.code]: r.code,
        [EXPIRY_COLUMNS.product]: r.product,
        [EXPIRY_COLUMNS.expiry]: r.expiry,
        [DAYS_LEFT]: days,
        [EXPIRY_COLUMNS.qty]: r.qty,
        [EXPIRY_COLUMNS.avgCost]: r.avgCost,
        [EXPIRY_COLUMNS.buyPrice]: r.buyPrice,
        [EXPIRY_COLUMNS.sellPrice]: r.sellPrice,
        [EXPIRY_COLUMNS.total]: r.total,
      }));
  }, [rows, today, bucket]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/70 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className="my-4 w-full max-w-7xl rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Items for ${company}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold" dir="auto">
              {company}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {int(totals.items)} item{totals.items === 1 ? "" : "s"} ·{" "}
              {int(totals.units)} units · {money(totals.cost)} cost ·{" "}
              {money(totals.retail)} retail
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-3 p-4">
          {/* Urgency filter chips */}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setBucket(null)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                bucket === null
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/60",
              )}
            >
              All ({int(totals.items)})
            </button>
            {URGENCY_ORDER.map((k) => {
              const count = bucketCounts.get(k) ?? 0;
              if (count === 0) return null;
              const active = bucket === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setBucket(active ? null : k)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-muted/60",
                    !active && URGENCY_TONE[k],
                  )}
                >
                  {URGENCY_LABELS[k]} ({count})
                </button>
              );
            })}
          </div>

          <DataTable
            key={company}
            columns={DETAIL_COLUMNS}
            rows={tableRows}
            numericColumns={NUMERIC}
            maxRows={22}
            renderCell={(row, col) =>
              col === DAYS_LEFT ? (
                <DaysBadge days={Number(row[DAYS_LEFT])} />
              ) : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
