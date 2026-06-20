"use client";

import * as React from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AdminOrderRow } from "@/lib/admin-orders";

function displayDate(v: string): string {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return new Date(`${v}T00:00:00`).toLocaleDateString();
  }
  return v;
}

function displayDay(v: string): string {
  const n = parseInt(v, 10);
  if (!n || n < 1 || n > 31) return "";
  return `Day ${n}`;
}

// Days between when the order was handled (Date of doing) — or today, if it's
// still not done — and the day of the month it was due. Positive = late,
// <= 0 = on time. Returns null when there's no order day to measure against.
function computeDelayDays(orderDay: string, dateOfDoing: string): number | null {
  const day = parseInt(orderDay, 10);
  if (!day || day < 1 || day > 31) return null;
  const ref = dateOfDoing ? new Date(`${dateOfDoing}T00:00:00`) : new Date();
  if (Number.isNaN(ref.getTime())) return null;
  ref.setHours(0, 0, 0, 0);
  const lastOfMonth = new Date(
    ref.getFullYear(),
    ref.getMonth() + 1,
    0,
  ).getDate();
  const due = new Date(
    ref.getFullYear(),
    ref.getMonth(),
    Math.min(day, lastOfMonth),
  );
  return Math.round((ref.getTime() - due.getTime()) / 86_400_000);
}

const DEFAULT_LATE_THRESHOLD = 3;
const THRESHOLD_KEY = "dashboardLateThreshold";

const dash = <span className="text-muted-foreground">—</span>;

function StatusCell({
  delay,
  done,
  threshold,
}: {
  delay: number | null;
  done: boolean;
  threshold: number;
}) {
  if (delay === null) return dash;
  if (delay <= 0) {
    return done ? (
      <span className="font-medium text-emerald-600 dark:text-emerald-500">
        On time
      </span>
    ) : (
      <span className="text-muted-foreground">Pending</span>
    );
  }
  const unit = delay === 1 ? "day" : "days";
  const late = delay > threshold;
  return (
    <span
      className={cn(
        "font-medium",
        late
          ? "font-semibold text-destructive"
          : "text-amber-600 dark:text-amber-500",
      )}
    >
      {delay} {unit} {done ? "late" : "overdue"}
    </span>
  );
}

export function AdminOrders({ orders }: { orders: AdminOrderRow[] }) {
  const [name, setName] = React.useState("");
  const [date, setDate] = React.useState("");
  const [owner, setOwner] = React.useState("all");
  const [threshold, setThreshold] = React.useState(DEFAULT_LATE_THRESHOLD);

  // The boss's "late after N days" setting, remembered in this browser.
  React.useEffect(() => {
    const saved = localStorage.getItem(THRESHOLD_KEY);
    const n = saved === null ? NaN : parseInt(saved, 10);
    if (!Number.isNaN(n) && n >= 0) setThreshold(n);
  }, []);

  const updateThreshold = (value: number) => {
    const n = Number.isNaN(value) || value < 0 ? 0 : Math.floor(value);
    setThreshold(n);
    localStorage.setItem(THRESHOLD_KEY, String(n));
  };

  // Distinct uploaders for the dropdown, sorted by name.
  const uploaders = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const o of orders) {
      if (!map.has(o.ownerId)) {
        map.set(o.ownerId, o.uploaderName || o.uploaderEmail || "Unknown");
      }
    }
    return [...map.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [orders]);

  const filtered = React.useMemo(() => {
    const q = name.trim().toLowerCase();
    return orders.filter((o) => {
      if (q && !o.companyName.toLowerCase().includes(q)) return false;
      if (owner !== "all" && o.ownerId !== owner) return false;
      // The date filter matches the order's "date of doing".
      if (date && o.dateOfDoing !== date) return false;
      return true;
    });
  }, [orders, name, date, owner]);

  // Attach lateness to each visible row using the current threshold.
  const rows = React.useMemo(
    () =>
      filtered.map((o) => {
        const delay = computeDelayDays(o.orderDay, o.dateOfDoing);
        return { order: o, delay, late: delay !== null && delay > threshold };
      }),
    [filtered, threshold],
  );
  const lateCount = rows.filter((r) => r.late).length;

  const hasFilters = name !== "" || date !== "" || owner !== "all";
  const clear = () => {
    setName("");
    setDate("");
    setOwner("all");
  };

  const inputCls =
    "h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Filter by company name"
            className={cn(inputCls, "w-full pl-8")}
          />
        </div>

        <select
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          className={cn(inputCls, "max-w-[14rem]")}
          aria-label="Filter by uploader"
        >
          <option value="all">All people</option>
          {uploaders.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={cn(inputCls, "text-muted-foreground")}
          aria-label="Filter by date of doing"
        />

        <label className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground">
          Late after
          <input
            type="number"
            min={0}
            value={threshold}
            onChange={(e) => updateThreshold(e.target.valueAsNumber)}
            className="w-12 bg-transparent text-center font-medium text-foreground outline-none"
            aria-label="Late threshold in days"
          />
          days
        </label>

        {hasFilters && (
          <button
            type="button"
            onClick={clear}
            className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" /> Clear
          </button>
        )}

        <div className="ml-auto flex items-center gap-2 text-xs">
          {lateCount > 0 && (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
              {lateCount} late
            </span>
          )}
          <span className="text-muted-foreground">
            {filtered.length} of {orders.length}
          </span>
        </div>
      </div>

      {/* Table */}
      {orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">
          No orders have been added yet.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">
          No orders match these filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="whitespace-nowrap px-3 py-2.5 font-semibold text-muted-foreground">
                  Company name
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 font-semibold text-muted-foreground">
                  Order day
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 font-semibold text-muted-foreground">
                  Date of doing
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 font-semibold text-muted-foreground">
                  Send date
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 font-semibold text-muted-foreground">
                  Uploaded by
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 font-semibold text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ order: o, delay, late }) => (
                <tr
                  key={o._id}
                  className={cn(
                    "border-b border-border/60 last:border-0",
                    late && "bg-destructive/10",
                  )}
                >
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    {o.companyName || dash}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {displayDay(o.orderDay) || dash}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {displayDate(o.dateOfDoing) || dash}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {displayDate(o.sendDate) || dash}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{o.uploaderName}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <StatusCell
                      delay={delay}
                      done={Boolean(o.dateOfDoing)}
                      threshold={threshold}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
