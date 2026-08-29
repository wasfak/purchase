"use client";

import * as React from "react";
import { Search, Check, Loader2, Star } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { normalizeCompany } from "@/lib/expiry";

type Order = Record<string, string> & { _id: string };

type Company = { key: string; name: string };

type Flag = {
  key: string;
  companyName: string;
  autoDisplay: boolean;
  dateOfDoing?: string;
  dateToAccounts?: string;
};

// The two editable date fields per company.
type DateField = "dateOfDoing" | "dateToAccounts";
type Dates = { dateOfDoing: string; dateToAccounts: string };

export function TaqfeelatBoard() {
  const [companies, setCompanies] = React.useState<Company[]>([]);
  const [autoKeys, setAutoKeys] = React.useState<Set<string>>(new Set());
  // Per-company key → its two dates.
  const [dates, setDates] = React.useState<Map<string, Dates>>(new Map());
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [onlyAuto, setOnlyAuto] = React.useState(false);
  const [busyKeys, setBusyKeys] = React.useState<Set<string>>(new Set());

  // Load the distinct companies from the user's orders, plus the saved
  // auto-display flags, and overlay them.
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [ordersRes, flagsRes] = await Promise.all([
          fetch("/api/orders"),
          fetch("/api/taqfeelat"),
        ]);
        if (!ordersRes.ok) throw new Error();
        const ordersData = await ordersRes.json();
        const orders: Order[] = ordersData.orders ?? [];

        // Distinct companies by normalized key; keep the first-seen display name.
        const map = new Map<string, string>();
        for (const o of orders) {
          const name = (o.companyName ?? "").trim();
          if (!name) continue;
          const key = normalizeCompany(name);
          if (!map.has(key)) map.set(key, name);
        }
        const list = [...map.entries()]
          .map(([key, name]) => ({ key, name }))
          .sort((a, b) => a.name.localeCompare(b.name, "ar"));

        const keys = new Set<string>();
        const dateMap = new Map<string, Dates>();
        if (flagsRes.ok) {
          const flagsData = await flagsRes.json();
          for (const f of (flagsData.flags ?? []) as Flag[]) {
            if (!f.key) continue;
            if (f.autoDisplay) keys.add(f.key);
            dateMap.set(f.key, {
              dateOfDoing: f.dateOfDoing ?? "",
              dateToAccounts: f.dateToAccounts ?? "",
            });
          }
        }

        if (active) {
          setCompanies(list);
          setAutoKeys(keys);
          setDates(dateMap);
        }
      } catch {
        if (active) toast.error("Couldn't load companies");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const setBusy = (key: string, on: boolean) =>
    setBusyKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  async function toggleAuto(company: Company) {
    const next = !autoKeys.has(company.key);
    setBusy(company.key, true);
    // Optimistic.
    setAutoKeys((prev) => {
      const s = new Set(prev);
      if (next) s.add(company.key);
      else s.delete(company.key);
      return s;
    });
    try {
      const res = await fetch("/api/taqfeelat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: company.name, autoDisplay: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't save");
      // Revert.
      setAutoKeys((prev) => {
        const s = new Set(prev);
        if (next) s.delete(company.key);
        else s.add(company.key);
        return s;
      });
    } finally {
      setBusy(company.key, false);
    }
  }

  async function saveDate(company: Company, field: DateField, value: string) {
    const prevDates =
      dates.get(company.key) ?? { dateOfDoing: "", dateToAccounts: "" };
    if ((prevDates[field] ?? "") === value) return; // no change

    setBusy(company.key, true);
    // Optimistic.
    setDates((prev) => {
      const next = new Map(prev);
      next.set(company.key, { ...prevDates, [field]: value });
      return next;
    });
    try {
      const res = await fetch("/api/taqfeelat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: company.name, [field]: value }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't save");
      // Revert.
      setDates((prev) => {
        const next = new Map(prev);
        next.set(company.key, prevDates);
        return next;
      });
    } finally {
      setBusy(company.key, false);
    }
  }

  const filtered = React.useMemo(() => {
    let rows = companies;
    if (onlyAuto) rows = rows.filter((c) => autoKeys.has(c.key));
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((c) => c.name.toLowerCase().includes(q));
    return rows;
  }, [companies, autoKeys, onlyAuto, search]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const inputCls =
    "h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";
  const dateInputCls =
    "h-8 rounded-md border border-border bg-background px-2 text-sm text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50";

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search company…"
            className={cn(inputCls, "w-52 pl-8")}
          />
        </label>

        <button
          type="button"
          onClick={() => setOnlyAuto((v) => !v)}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors",
            onlyAuto
              ? "border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : "border-border bg-background text-muted-foreground hover:text-foreground",
          )}
        >
          <Star className={cn("size-4", onlyAuto && "fill-current")} />
          Auto-display only
        </button>

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-400">
            {autoKeys.size} marked
          </span>
          <span>
            {filtered.length} of {companies.length}
          </span>
        </div>
      </div>

      {/* Table */}
      {companies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">
          No companies yet — add some orders first.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center text-sm text-muted-foreground">
          No companies match your search.
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
                  Date of doing
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 font-semibold text-muted-foreground">
                  Date to حسابات
                </th>
                <th className="whitespace-nowrap px-3 py-2.5 text-center font-semibold text-muted-foreground">
                  Auto display
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const on = autoKeys.has(c.key);
                const busy = busyKeys.has(c.key);
                const d =
                  dates.get(c.key) ?? { dateOfDoing: "", dateToAccounts: "" };
                return (
                  <tr
                    key={c.key}
                    className={cn(
                      "border-b border-border/60 last:border-0",
                      on && "bg-amber-500/5",
                    )}
                  >
                    <td className="whitespace-nowrap px-3 py-2 font-medium">
                      {c.name}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <input
                        type="date"
                        value={d.dateOfDoing}
                        disabled={busy}
                        onChange={(e) =>
                          saveDate(c, "dateOfDoing", e.target.value)
                        }
                        className={dateInputCls}
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <input
                        type="date"
                        value={d.dateToAccounts}
                        disabled={busy}
                        onChange={(e) =>
                          saveDate(c, "dateToAccounts", e.target.value)
                        }
                        className={dateInputCls}
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => toggleAuto(c)}
                        disabled={busy}
                        aria-pressed={on}
                        title={
                          on
                            ? "Marked for auto-display — click to unmark"
                            : "Click to mark for auto-display"
                        }
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors disabled:opacity-50",
                          on
                            ? "border-amber-500/50 bg-amber-500/15 text-amber-700 dark:text-amber-400"
                            : "border-border text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {busy ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : on ? (
                          <Check className="size-3" />
                        ) : (
                          <span className="grid size-3 place-items-center rounded-full border border-current" />
                        )}
                        {on ? "On" : "Off"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
