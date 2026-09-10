"use client";

import * as React from "react";
import { Loader2, Search, Tag, RefreshCw, ChevronDown, Check, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { monthLabel } from "@/lib/dates";

type Marker = "#B" | "#C" | "#N";

type AlamaRow = {
  month: string;
  orderNumbers: string[];
  suppliers: string[];
  date: string;
  codes: string[];
  name: string;
  order: number;
  received: number;
  bonus: number;
  markers: Marker[];
};

const ALL_MARKERS: Marker[] = ["#B", "#C", "#N"];

const MARKER_STYLE: Record<Marker, string> = {
  "#B": "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "#C": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "#N": "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
};

export function AlamaBoard() {
  const [rows, setRows] = React.useState<AlamaRow[] | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState<Set<Marker>>(new Set(ALL_MARKERS));
  // Supplier multi-select filter; empty set = all suppliers.
  const [suppliers, setSuppliers] = React.useState<Set<string>>(new Set());
  const [supplierMenuOpen, setSupplierMenuOpen] = React.useState(false);
  const supplierMenuRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/alama");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch {
      toast.error("Couldn't load the علامة results.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const toggleMarker = (m: Marker) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  };

  // Every distinct supplier across the results, for the dropdown filter.
  const supplierOptions = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of rows ?? []) {
      for (const s of r.suppliers) if (s.trim()) set.add(s.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ar"));
  }, [rows]);

  // The chosen suppliers still present in the data — derived, so options that a
  // refresh removed simply stop filtering (no state to re-sync).
  const activeSuppliers = React.useMemo(() => {
    const opts = new Set(supplierOptions);
    return new Set([...suppliers].filter((s) => opts.has(s)));
  }, [suppliers, supplierOptions]);

  const filtered = React.useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (!r.markers.some((m) => active.has(m))) return false;
      if (activeSuppliers.size > 0 && !r.suppliers.some((s) => activeSuppliers.has(s)))
        return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        r.codes.some((c) => c.toLowerCase().includes(q)) ||
        r.suppliers.some((s) => s.toLowerCase().includes(q)) ||
        r.orderNumbers.some((n) => n.toLowerCase().includes(q))
      );
    });
  }, [rows, query, active, activeSuppliers]);

  const toggleSupplier = (s: string) =>
    setSuppliers((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  // Close the supplier dropdown when clicking outside it.
  React.useEffect(() => {
    if (!supplierMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (
        supplierMenuRef.current &&
        !supplierMenuRef.current.contains(e.target as Node)
      ) {
        setSupplierMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [supplierMenuOpen]);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, code, supplier, order #…"
            className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {ALL_MARKERS.map((m) => {
            const on = active.has(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => toggleMarker(m)}
                aria-pressed={on}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  on
                    ? cn("border-transparent", MARKER_STYLE[m])
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <Tag className="size-3" />
                {m}
              </button>
            );
          })}
        </div>

        <div ref={supplierMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setSupplierMenuOpen((o) => !o)}
            className="flex h-9 min-w-[12rem] max-w-[18rem] items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            aria-haspopup="listbox"
            aria-expanded={supplierMenuOpen}
          >
            <span dir="auto" className="truncate">
              {activeSuppliers.size === 0
                ? `All suppliers (${supplierOptions.length})`
                : activeSuppliers.size === 1
                  ? [...activeSuppliers][0]
                  : `${activeSuppliers.size} suppliers`}
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </button>
          {supplierMenuOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md">
              {supplierOptions.length === 0 ? (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                  No suppliers.
                </p>
              ) : (
                supplierOptions.map((s) => {
                  const checked = activeSuppliers.has(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => toggleSupplier(s)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                    >
                      <span
                        className={cn(
                          "grid size-4 shrink-0 place-items-center rounded border",
                          checked
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border",
                        )}
                      >
                        {checked && <Check className="size-3" />}
                      </span>
                      <span dir="auto" className="truncate">
                        {s}
                      </span>
                    </button>
                  );
                })
              )}
              {activeSuppliers.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSuppliers(new Set())}
                  className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted"
                >
                  <X className="size-3.5" /> Clear suppliers
                </button>
              )}
            </div>
          )}
        </div>

        <Button type="button" variant="outline" onClick={load} disabled={loading}>
          {loading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <RefreshCw />
          )}
          Refresh
        </Button>
      </div>

      {/* Summary */}
      {!loading && rows && (
        <p className="text-sm text-muted-foreground">
          {filtered.length === rows.length ? (
            <>
              {rows.length} flagged item{rows.length === 1 ? "" : "s"}
            </>
          ) : (
            <>
              {filtered.length} of {rows.length} flagged items
            </>
          )}
        </p>
      )}

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Scanning your orders…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 py-16 text-center text-sm text-muted-foreground">
          {rows && rows.length === 0
            ? "No ordered item with a #B / #C / #N marker was bought at exactly its order quantity. Upload POS + Buy files in Auto Tasfya first."
            : "Nothing matches your filter."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {[
                  "Month",
                  "اسم الصنف",
                  "Codes",
                  "Marker",
                  "Order",
                  "Bought",
                  "Bonus",
                  "Supplier",
                  "Order #",
                  "Date",
                ].map((h) => (
                  <th
                    key={h}
                    className={cn(
                      "whitespace-nowrap px-3 py-2 font-semibold text-muted-foreground",
                      h === "Supplier" && "text-center",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr
                  key={`${r.month}-${r.codes.join("-")}-${i}`}
                  className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                >
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {monthLabel(r.month)}
                  </td>
                  <td dir="auto" className="px-3 py-2 font-medium">
                    {r.name}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    <span className="flex flex-wrap gap-1">
                      {r.codes.map((c) => (
                        <span
                          key={c}
                          className="rounded bg-muted px-1.5 py-0.5 text-xs"
                        >
                          {c}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="flex gap-1">
                      {r.markers.map((m) => (
                        <span
                          key={m}
                          className={cn(
                            "rounded px-1.5 py-0.5 text-xs font-semibold",
                            MARKER_STYLE[m],
                          )}
                        >
                          {m}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-center tabular-nums">
                    {r.order}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-center font-semibold tabular-nums text-primary">
                    {r.received}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-center tabular-nums text-muted-foreground">
                    {r.bonus || ""}
                  </td>
                  <td dir="auto" className="px-3 py-2 text-center text-muted-foreground">
                    {r.suppliers.join("، ")}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {r.orderNumbers.join(", ")}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {r.date}
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
