"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  Check,
  CircleDot,
  Copy,
  Download,
  Filter,
  Loader2,
  PackageCheck,
  PackageX,
  Plane,
  Plus,
  Save,
  Search,
  StickyNote,
  Truck,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { monthLabel } from "@/lib/dates";
import { loadStock } from "@/lib/tasfya/stockCache";
import { stockForCompany } from "@/lib/tasfya/stock";
import { bonusPercent, computeReport } from "@/lib/tasfya/report";
import {
  parseCell,
  effRemaining,
  remainingOf,
  fmtBalance,
  type FlyingColumn,
  type FlyingRow,
} from "@/lib/tasfya/flying";
import type {
  ExtraItem,
  PurchaseLine,
  ReportRow,
  StockItem,
  SupplyOrderItem,
  TasfyaResult,
} from "@/lib/tasfya/types";

// A settled row (ordered item or over-order extra), plus its original settlement
// so the editable pill can reset while the displayed value reflects edits.
type Row = (ReportRow | (ExtraItem & { order: number; tasfya: number })) & {
  isExtra: boolean;
  baseTasfya: number;
};

type SortDir = "asc" | "desc";
type ColKey =
  | "code"
  | "name"
  | "status"
  | "order"
  | "tasfya"
  | "bonus"
  | "bonusPct"
  | "supplier"
  | "received"
  | "basicPct"
  | "extraPct"
  | "specialPct";

// One day a code showed up in an uploaded "0 codes" file.
type ZeroHit = { date: string; order: string; supplier: string };

type SettleCat = "zero" | "pos" | "neg";
function settleCat(t: number): SettleCat {
  if (t < 0) return "neg";
  if (t === 0) return "zero";
  return "pos";
}

const ENTRY =
  "flex flex-col items-center justify-center text-center min-h-[2.75rem] px-3 border-b border-border/50 last:border-b-0";

let supIdSeq = 0;
const newSupId = () =>
  `s${Date.now().toString(36)}${(supIdSeq++).toString(36)}`;

function pct(v: number): string {
  return v ? `${Number(v.toFixed(2))}%` : "—";
}

// Normalize a date to a sortable "YYYYMMDD" key so a slash-dated order
// (2026/07/29) and a dash-dated 0-codes file (2026-08-09) compare correctly.
function dateKey(value: string): string {
  const m = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(String(value ?? "").trim());
  if (!m) return "";
  return `${m[1]}${m[2].padStart(2, "0")}${m[3].padStart(2, "0")}`;
}

function rowClass(t: number): string {
  if (t < 0) return "bg-red-50/40 dark:bg-red-950/20";
  if (t === 0) return "bg-emerald-50/40 dark:bg-emerald-950/20";
  return "bg-amber-50/40 dark:bg-amber-950/20";
}
function accentClass(t: number): string {
  if (t < 0) return "border-s-red-500";
  if (t === 0) return "border-s-emerald-500";
  return "border-s-amber-400";
}
function tasfyaPillClass(t: number): string {
  if (t < 0)
    return "border-red-200 bg-red-50 text-red-700 focus:ring-red-400/40 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300";
  if (t === 0)
    return "border-emerald-200 bg-emerald-50 text-emerald-700 focus:ring-emerald-400/40 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300";
  return "border-amber-200 bg-amber-50 text-amber-700 focus:ring-amber-400/40 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300";
}

const COLUMNS: {
  key: ColKey;
  label: string;
  numeric: boolean;
  value: (r: Row) => string;
}[] = [
  { key: "code", label: "كود الصنف", numeric: false, value: (r) => r.code },
  { key: "name", label: "اسم الصنف", numeric: false, value: (r) => r.name },
  {
    key: "status",
    label: "الحالة",
    numeric: false,
    value: (r) => (r.isExtra ? "زائد" : "مطلوب"),
  },
  {
    key: "order",
    label: "الكمية المطلوبة",
    numeric: true,
    value: (r) => (r.isExtra ? "" : String(r.order)),
  },
  { key: "tasfya", label: "التسوية", numeric: true, value: (r) => String(r.tasfya) },
  { key: "bonus", label: "بونص", numeric: true, value: (r) => String(r.bonus) },
  {
    key: "bonusPct",
    label: "بونص %",
    numeric: true,
    value: (r) => String(bonusPercent(r.received, r.bonus)),
  },
  {
    key: "supplier",
    label: "اسم المورد",
    numeric: false,
    value: (r) =>
      r.supplier || r.lines.map((l) => l.supplier).filter(Boolean).join(", "),
  },
  {
    key: "received",
    label: "كمية الوارد",
    numeric: true,
    value: (r) => String(r.received),
  },
  { key: "basicPct", label: "أساسي %", numeric: true, value: (r) => String(r.basicPct) },
  { key: "extraPct", label: "إضافي %", numeric: true, value: (r) => String(r.extraPct) },
  { key: "specialPct", label: "خاص %", numeric: true, value: (r) => String(r.specialPct) },
];

const DEFAULT_SORT: { col: ColKey; dir: SortDir } = { col: "name", dir: "asc" };

type DataResponse = {
  company: string;
  hasPos: boolean;
  hasBuy: boolean;
  matchedOrders: number;
  orderNumbers: string[];
  referenceDate: string;
  items: SupplyOrderItem[];
  lines: PurchaseLine[];
};

export function RunClient() {
  const params = useSearchParams();
  const month = params.get("month") ?? "";
  const company = (params.get("company") ?? "").trim();

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<TasfyaResult | null>(null);
  const [stockCount, setStockCount] = React.useState<number | null>(null);
  const [meta, setMeta] = React.useState<{
    orderNumbers: string[];
    matchedOrders: number;
    referenceDate: string;
  } | null>(null);

  // Flying-tasfya (تصفية ع الطاير) sheet for this month/company, looked up per
  // code when the user clicks a code cell. `null` until loaded; the map is empty
  // when there is no saved sheet.
  const [flying, setFlying] = React.useState<{
    columns: FlyingColumn[];
    byCode: Map<string, FlyingRow>;
  } | null>(null);

  // Every settled code looked up against the saved "0 codes" files, so each row
  // can show whether (and when) it appeared there. `null` until loaded; the map
  // only holds codes that were actually found.
  const [zeroCodes, setZeroCodes] = React.useState<Map<string, ZeroHit[]> | null>(
    null,
  );

  const [edits, setEdits] = React.useState<Record<string, string>>({});
  // "لم يصل" supplier columns + per-code cells (Flying-tasfya style). The base of
  // each cell deducts from a negative التسوية; بونص only helps reach 0.
  const [supplierColumns, setSupplierColumns] = React.useState<FlyingColumn[]>(
    [],
  );
  const [supplierCells, setSupplierCells] = React.useState<
    Record<string, Record<string, string>>
  >({});
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);

  // Table state.
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, Set<string>>>({});
  const [sort, setSort] = React.useState<{ col: ColKey; dir: SortDir } | null>(
    DEFAULT_SORT,
  );
  const [settle, setSettle] = React.useState<Set<SettleCat>>(new Set());
  const [flyingOnly, setFlyingOnly] = React.useState(false);
  const [menu, setMenu] = React.useState<{
    col: ColKey;
    x: number;
    top: number;
    bottom: number;
  } | null>(null);
  const [valSearch, setValSearch] = React.useState("");

  React.useEffect(() => {
    if (!month || !company) {
      setError("Missing month or company.");
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/auto-tasfya/data?month=${encodeURIComponent(month)}&company=${encodeURIComponent(company)}`,
        );
        if (!res.ok) throw new Error("data");
        const data: DataResponse = await res.json();

        const cached = await loadStock();
        const stockItems: StockItem[] = cached?.items ?? [];
        const slice = stockForCompany(stockItems, company);

        const computed = computeReport(
          {
            items: data.items,
            referenceDate: data.referenceDate,
            orderNumber: data.orderNumbers.join(", "),
            supplierCompany: company,
          },
          data.lines,
          slice,
        );

        let savedEdits: Record<string, string> = {};
        let savedSupCols: FlyingColumn[] = [];
        let savedSupCells: Record<string, Record<string, string>> = {};
        try {
          const r = await fetch(
            `/api/auto-tasfya/result?month=${encodeURIComponent(month)}&company=${encodeURIComponent(company)}`,
          );
          if (r.ok) {
            const j = await r.json();
            if (j.result?.edits && typeof j.result.edits === "object")
              savedEdits = j.result.edits as Record<string, string>;
            if (Array.isArray(j.result?.supplierColumns))
              savedSupCols = j.result.supplierColumns.map(
                (c: FlyingColumn) => ({ id: c.id, name: c.name ?? "" }),
              );
            if (
              j.result?.supplierCells &&
              typeof j.result.supplierCells === "object"
            )
              savedSupCells = j.result.supplierCells as Record<
                string,
                Record<string, string>
              >;
            if (j.result?.updatedAt) setSavedAt(j.result.updatedAt);
          }
        } catch {
          // no saved result
        }

        if (!active) return;
        setResult(computed);
        setStockCount(slice.codes.size);
        setMeta({
          orderNumbers: data.orderNumbers,
          matchedOrders: data.matchedOrders,
          referenceDate: data.referenceDate,
        });
        setEdits(savedEdits);
        setSupplierColumns(savedSupCols);
        setSupplierCells(savedSupCells);
        if (!data.hasPos)
          setError("No pos file saved for this month. Upload it in Auto Tasfya.");
        else if (data.matchedOrders === 0)
          setError(`No orders for "${company}" in ${monthLabel(month)}.`);
      } catch {
        if (active) setError("Couldn't load the settlement data.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [month, company]);

  // Load the flying sheet once so each code can show its distributor breakdown.
  React.useEffect(() => {
    if (!month || !company) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/flying?month=${encodeURIComponent(month)}&company=${encodeURIComponent(company)}`,
        );
        if (!res.ok) throw new Error();
        const data = await res.json();
        const sheet = data.sheet;
        const columns: FlyingColumn[] = (sheet?.columns ?? []).map(
          (c: FlyingColumn) => ({ id: c.id, name: c.name ?? "" }),
        );
        const byCode = new Map<string, FlyingRow>();
        for (const r of sheet?.rows ?? []) {
          const row: FlyingRow = {
            code: r.code ?? "",
            name: r.name ?? "",
            order: Number(r.order) || 0,
            cells: r.cells && typeof r.cells === "object" ? r.cells : {},
            note: typeof r.note === "string" ? r.note : "",
            remainingOverride:
              typeof r.remainingOverride === "number"
                ? r.remainingOverride
                : null,
          };
          if (row.code) byCode.set(row.code.trim(), row);
        }
        if (active) setFlying({ columns, byCode });
      } catch {
        if (active) setFlying({ columns: [], byCode: new Map() });
      }
    })();
    return () => {
      active = false;
    };
  }, [month, company]);

  // Look up every settled code in the saved "0 codes" files (one batched call).
  React.useEffect(() => {
    if (!result) return;
    const codes = Array.from(
      new Set(
        [
          ...result.report.map((r) => r.code),
          ...result.extraItems.map((e) => e.code),
        ]
          .map((c) => String(c ?? "").trim())
          .filter(Boolean),
      ),
    );
    if (codes.length === 0) {
      setZeroCodes(new Map());
      return;
    }
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/zero-codes/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ codes }),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        const map = new Map<string, ZeroHit[]>();
        for (const r of data.results ?? []) {
          if (r.status === "found" && Array.isArray(r.hits) && r.hits.length > 0)
            map.set(String(r.code).trim(), r.hits as ZeroHit[]);
        }
        if (active) setZeroCodes(map);
      } catch {
        if (active) setZeroCodes(new Map());
      }
    })();
    return () => {
      active = false;
    };
  }, [result]);

  // A row is "ع الطاير": its settlement is negative (short) yet the same code is
  // covered (الباقى = 0) on the flying sheet — matches the badge on the code.
  const isCoveredOnFlying = React.useCallback(
    (code: string, tasfya: number) => {
      if (!flying || tasfya >= 0) return false;
      const r = flying.byCode.get(code.trim());
      return !!r && effRemaining(r, flying.columns) === 0;
    },
    [flying],
  );

  // Apply the "لم يصل" supplier columns to a negative settlement. Only negative
  // (short) rows are affected; the base of each supplier cell reduces the
  // shortfall and بونص fills the gap toward 0 without overshooting — same math as
  // Flying tasfya (shortfall plays the role of the ordered quantity).
  const supplierAdjusted = React.useCallback(
    (code: string, base: number) => {
      if (base >= 0 || supplierColumns.length === 0) return base;
      const cells = supplierCells[code.trim()] ?? {};
      return remainingOf(
        { code, name: "", order: -base, cells },
        supplierColumns,
      );
    },
    [supplierColumns, supplierCells],
  );

  const effTasfya = React.useCallback(
    (code: string, base: number) => {
      const raw = edits[code];
      if (raw !== undefined && raw !== "") {
        const n = Number(raw);
        if (Number.isFinite(n)) return n;
      }
      return supplierAdjusted(code, base);
    },
    [edits, supplierAdjusted],
  );

  // All rows (ordered + extras), with the edited settlement applied to `tasfya`
  // and the original kept in `baseTasfya` for the editable pill.
  const allRows = React.useMemo<Row[]>(() => {
    if (!result) return [];
    const base: Row[] = result.report.map((r) => ({
      ...r,
      isExtra: false,
      baseTasfya: r.tasfya,
    }));
    const extra: Row[] = result.extraItems.map((e) => ({
      ...e,
      order: 0,
      isExtra: true,
      tasfya: e.received - e.bonus,
      baseTasfya: e.received - e.bonus,
    }));
    return [...base, ...extra].map((r) => ({
      ...r,
      tasfya: effTasfya(r.code, r.baseTasfya),
    }));
  }, [result, effTasfya]);

  // Hide columns that are entirely zero (matches the tasfya app).
  const hiddenCols = React.useMemo(() => {
    const hidden = new Set<ColKey>();
    const hasBonus = allRows.some((r) => r.bonus !== 0);
    const hasExtra = allRows.some(
      (r) => r.extraPct !== 0 || r.lines.some((l) => l.extraPct !== 0),
    );
    const hasSpecial = allRows.some(
      (r) => r.specialPct !== 0 || r.lines.some((l) => l.specialPct !== 0),
    );
    if (!hasBonus) {
      hidden.add("bonus");
      hidden.add("bonusPct");
    }
    if (!hasExtra) hidden.add("extraPct");
    if (!hasSpecial) hidden.add("specialPct");
    return hidden;
  }, [allRows]);

  const columns = React.useMemo(
    () => COLUMNS.filter((c) => !hiddenCols.has(c.key)),
    [hiddenCols],
  );
  const colByKey = React.useMemo(
    () =>
      Object.fromEntries(columns.map((c) => [c.key, c])) as Record<
        ColKey,
        (typeof COLUMNS)[number]
      >,
    [columns],
  );

  const domains = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of columns) {
      const set = new Set<string>();
      for (const row of allRows) set.add(col.value(row));
      map[col.key] = [...set].sort((a, b) => {
        if (a === "" || b === "") return a === "" ? 1 : -1;
        return col.numeric
          ? Number(a) - Number(b)
          : a.localeCompare(b, "ar", { numeric: true });
      });
    }
    return map;
  }, [allRows, columns]);

  const filteredRows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const active = Object.entries(filters);
    return allRows.filter((row) => {
      if (q && !columns.some((c) => c.value(row).toLowerCase().includes(q)))
        return false;
      for (const [key, allowed] of active) {
        if (!allowed.has(colByKey[key as ColKey].value(row))) return false;
      }
      return true;
    });
  }, [allRows, search, filters, columns, colByKey]);

  const settleCounts = React.useMemo(() => {
    const c = { zero: 0, pos: 0, neg: 0 };
    for (const r of filteredRows) c[settleCat(r.tasfya)]++;
    return c;
  }, [filteredRows]);

  const flyingCount = React.useMemo(
    () =>
      filteredRows.filter((r) => isCoveredOnFlying(r.code, r.tasfya)).length,
    [filteredRows, isCoveredOnFlying],
  );

  const visibleRows = React.useMemo(() => {
    let out =
      settle.size === 0
        ? filteredRows
        : filteredRows.filter((r) => settle.has(settleCat(r.tasfya)));
    if (flyingOnly) out = out.filter((r) => isCoveredOnFlying(r.code, r.tasfya));
    if (sort) {
      const col = colByKey[sort.col];
      out = [...out].sort((a, b) => {
        const av = col.value(a);
        const bv = col.value(b);
        if (av === "" || bv === "") return av === bv ? 0 : av === "" ? 1 : -1;
        const cmp = col.numeric
          ? Number(av) - Number(bv)
          : av.localeCompare(bv, "ar", { numeric: true, sensitivity: "base" });
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [filteredRows, settle, flyingOnly, isCoveredOnFlying, sort, colByKey]);

  const toggleSettle = (k: SettleCat) =>
    setSettle((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const toggleSort = (col: ColKey) =>
    setSort((prev) => {
      if (!prev || prev.col !== col) return { col, dir: "asc" };
      if (prev.dir === "asc") return { col, dir: "desc" };
      return null;
    });

  const setColumnFilter = (col: ColKey, mutate: (s: Set<string>) => void) =>
    setFilters((prev) => {
      const allowed = prev[col] ? new Set(prev[col]) : new Set(domains[col]);
      mutate(allowed);
      const next = { ...prev };
      if (allowed.size === domains[col].length) delete next[col];
      else next[col] = allowed;
      return next;
    });
  const toggleValue = (col: ColKey, v: string) =>
    setColumnFilter(col, (a) => (a.has(v) ? a.delete(v) : a.add(v)));
  const setAllValues = (col: ColKey, vals: string[], checked: boolean) =>
    setColumnFilter(col, (a) => {
      for (const v of vals) checked ? a.add(v) : a.delete(v);
    });
  const clearColumn = (col: ColKey) => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[col];
      return next;
    });
    setMenu(null);
  };
  const clearAll = () => {
    setSearch("");
    setFilters({});
    setSettle(new Set());
    setFlyingOnly(false);
  };

  const fmt = (col: ColKey, v: string) =>
    v === ""
      ? "(Blanks)"
      : colByKey[col].numeric
        ? Number(v).toLocaleString("en-US")
        : v;

  const menuValues = React.useMemo(() => {
    if (!menu) return [];
    const q = valSearch.trim().toLowerCase();
    if (!q) return domains[menu.col];
    return domains[menu.col].filter((v) =>
      fmt(menu.col, v).toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, valSearch, domains]);
  const menuAllChecked =
    menu && menuValues.every((v) => !filters[menu.col] || filters[menu.col].has(v));

  // Close the dropdown on outside click / escape / scroll.
  React.useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-col-filter]")) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    const onScroll = () => setMenu(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [menu]);

  const setSupCell = (code: string, colId: string, value: string) =>
    setSupplierCells((prev) => ({
      ...prev,
      [code.trim()]: { ...(prev[code.trim()] ?? {}), [colId]: value },
    }));

  const addSupplierColumn = () =>
    setSupplierColumns((prev) => [...prev, { id: newSupId(), name: "" }]);

  const renameSupplierColumn = (id: string, name: string) =>
    setSupplierColumns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name } : c)),
    );

  const removeSupplierColumn = (id: string) => {
    setSupplierColumns((prev) => prev.filter((c) => c.id !== id));
    setSupplierCells((prev) => {
      const next: Record<string, Record<string, string>> = {};
      for (const [code, cells] of Object.entries(prev)) {
        if (!(id in cells)) {
          next[code] = cells;
          continue;
        }
        const cp = { ...cells };
        delete cp[id];
        next[code] = cp;
      }
      return next;
    });
  };

  // Export the currently visible rows to .xlsx: كود الصنف, اسم الصنف, التسوية.
  const exportExcel = async () => {
    if (visibleRows.length === 0) {
      toast.error("لا توجد صفوف للتصدير.");
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const data = visibleRows.map((row) => ({
        "كود الصنف": row.code,
        "اسم الصنف": row.name,
        التسوية: row.tasfya,
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      ws["!cols"] = [{ wch: 14 }, { wch: 44 }, { wch: 10 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "التسوية");
      const safe = `${company}-${month}`.replace(/[^\w.-]+/g, "_");
      XLSX.writeFile(wb, `auto-tasfya-${safe}.xlsx`);
    } catch {
      toast.error("تعذّر تصدير الملف.");
    }
  };

  const save = async () => {
    if (!result) return;
    setSaving(true);
    try {
      const res = await fetch("/api/auto-tasfya/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          company,
          referenceDate: result.referenceDate,
          orderNumber: result.orderNumber,
          report: result.report,
          extraItems: result.extraItems,
          edits,
          supplierColumns,
          supplierCells,
        }),
      });
      if (!res.ok) throw new Error();
      const j = await res.json();
      setSavedAt(j.savedAt ?? new Date().toISOString());
      toast.success("Settlement saved.");
    } catch {
      toast.error("Couldn't save the settlement.");
    } finally {
      setSaving(false);
    }
  };

  const hasStock = stockCount !== null;
  const activeFilters =
    Object.keys(filters).length +
    (search.trim() ? 1 : 0) +
    settle.size +
    (flyingOnly ? 1 : 0);

  return (
    <main dir="ltr" className="mx-auto w-full max-w-[120rem] space-y-4 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" dir="auto">
            Auto Tasfya — {company || "—"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {month ? monthLabel(month) : "—"}
            {meta && meta.orderNumbers.length > 0 && (
              <> · orders {meta.orderNumbers.join(", ")}</>
            )}
            {meta?.referenceDate && <> · since {meta.referenceDate}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
              hasStock && stockCount! > 0
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
            )}
            title="Stock loaded from this PC and matched to the company (المورد)"
          >
            {hasStock && stockCount! > 0 ? (
              <PackageCheck className="size-3.5" />
            ) : (
              <PackageX className="size-3.5" />
            )}
            {hasStock ? `${stockCount} stock codes` : "no stock on this PC"}
          </span>
          <Button onClick={save} disabled={saving || !result}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Computing settlement…
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && result && allRows.length > 0 && (
        <>
          {/* Quick settlement filters */}
          <div className="flex flex-wrap items-center gap-2">
            <SettleChip
              label="وصل"
              count={settleCounts.zero}
              active={settle.has("zero")}
              tone="emerald"
              onClick={() => toggleSettle("zero")}
            />
            <SettleChip
              label="زياده"
              count={settleCounts.pos}
              active={settle.has("pos")}
              tone="amber"
              onClick={() => toggleSettle("pos")}
            />
            <SettleChip
              label="لم يصل"
              count={settleCounts.neg}
              active={settle.has("neg")}
              tone="red"
              onClick={() => toggleSettle("neg")}
            />
            <button
              type="button"
              onClick={() => setFlyingOnly((v) => !v)}
              aria-pressed={flyingOnly}
              title="التسوية سالبة لكن الباقى في تصفية ع الطاير = 0"
              className={cn(
                "ms-1 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-shadow",
                "bg-sky-500/15 text-sky-700 dark:text-sky-400 ring-sky-500",
                flyingOnly
                  ? "ring-2 ring-offset-1 ring-offset-background"
                  : "opacity-90 hover:opacity-100",
              )}
            >
              <Plane className="size-3.5" /> ع الطاير {flyingCount}
            </button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ms-auto"
              onClick={exportExcel}
              title="تصدير الصفوف الظاهرة إلى Excel (كود، اسم الصنف، التسوية)"
            >
              <Download className="size-4" /> تصدير Excel
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addSupplierColumn}
              title="أضف عمود مورد لصفوف لم يصل — الكمية تُخصم من التسوية"
            >
              <Plus className="size-4" /> إضافة مورد
            </Button>
          </div>

          {/* Search + count */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-60 flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search all columns…"
                className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {visibleRows.length.toLocaleString("en-US")} of{" "}
              {allRows.length.toLocaleString("en-US")} rows
              {savedAt && (
                <span className="ml-1">
                  · saved {new Date(savedAt).toLocaleString()}
                </span>
              )}
            </p>
            {activeFilters > 0 && (
              <Button variant="outline" size="sm" onClick={clearAll}>
                <X /> Clear ({activeFilters})
              </Button>
            )}
          </div>

          <div className="max-h-[74vh] overflow-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b border-border bg-muted">
                <tr>
                  {columns.map((col) => {
                    const sorted = sort?.col === col.key;
                    const filtered = !!filters[col.key];
                    return (
                      <th
                        key={col.key}
                        className="border-b border-border text-center font-semibold text-muted-foreground"
                      >
                        <div
                          data-col-filter
                          className="flex items-center justify-between gap-1 px-2 py-2"
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(col.key)}
                            className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded px-1 py-1 text-xs hover:bg-muted/60 hover:text-foreground"
                            title={`Sort by ${col.label}`}
                          >
                            <span className="truncate whitespace-nowrap">
                              {col.label}
                            </span>
                            {sorted ? (
                              sort!.dir === "asc" ? (
                                <ArrowUp className="size-3.5 shrink-0" />
                              ) : (
                                <ArrowDown className="size-3.5 shrink-0" />
                              )
                            ) : (
                              <ArrowUpDown className="size-3.5 shrink-0 text-muted-foreground/40" />
                            )}
                          </button>
                          <button
                            type="button"
                            aria-label={`Filter ${col.label}`}
                            onClick={(e) => {
                              const r = e.currentTarget.getBoundingClientRect();
                              setValSearch("");
                              setMenu((m) =>
                                m?.col === col.key
                                  ? null
                                  : {
                                      col: col.key,
                                      x: Math.min(r.left, window.innerWidth - 290),
                                      top: r.top,
                                      bottom: r.bottom,
                                    },
                              );
                            }}
                            className={cn(
                              "grid size-6 shrink-0 place-items-center rounded hover:bg-muted",
                              filtered && "text-primary",
                            )}
                          >
                            <Filter
                              className={cn(
                                "size-3.5",
                                filtered && "fill-primary/20",
                              )}
                            />
                          </button>
                        </div>
                      </th>
                    );
                  })}
                  {supplierColumns.map((col) => (
                    <th
                      key={col.id}
                      className="border-b border-s border-border bg-muted/60 p-0 text-center font-semibold text-muted-foreground"
                    >
                      <div className="flex items-center gap-0.5 px-1 py-1">
                        <Truck className="size-3.5 shrink-0 text-sky-500" />
                        <input
                          value={col.name}
                          dir="auto"
                          placeholder="اسم المورد"
                          onChange={(e) =>
                            renameSupplierColumn(col.id, e.target.value)
                          }
                          className="h-7 w-24 min-w-[5rem] rounded-sm border border-transparent bg-transparent px-1 text-center text-xs font-semibold outline-none hover:border-border focus:border-ring focus:bg-background"
                        />
                        <button
                          type="button"
                          onClick={() => removeSupplierColumn(col.id)}
                          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive"
                          title="حذف عمود المورد"
                          aria-label="حذف عمود المورد"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    key={`${row.code}-${row.isExtra ? "x" : "r"}`}
                    className={cn(
                      "border-b-2 border-neutral-300 last:border-0 hover:bg-muted/40 dark:border-neutral-700",
                      rowClass(row.tasfya),
                    )}
                  >
                    <td
                      className={cn(
                        "border-s-4 px-3 py-3 text-center align-middle font-medium tabular-nums",
                        accentClass(row.tasfya),
                      )}
                    >
                      <FlyingCodeCell
                        code={row.code}
                        tasfya={row.tasfya}
                        flying={flying}
                        zeroLoading={row.tasfya > 0 && zeroCodes === null}
                        zeroHits={
                          row.tasfya > 0
                            ? (zeroCodes?.get(row.code.trim()) ?? []).filter(
                                (h) => {
                                  const order = dateKey(result.referenceDate);
                                  const file = dateKey(h.date);
                                  return order && file && file >= order;
                                },
                              )
                            : []
                        }
                      />
                    </td>
                    <td className="px-3 py-3 text-center align-middle" dir="auto">
                      {row.name}
                    </td>
                    <td className="px-3 py-3 text-center align-middle">
                      {row.isExtra ? (
                        <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                          زائد
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                          مطلوب
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center align-middle tabular-nums">
                      {row.isExtra ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : (
                        row.order
                      )}
                    </td>
                    <td className="px-3 py-3 text-center align-middle">
                      <input
                        type="number"
                        value={
                          edits[row.code] ??
                          String(supplierAdjusted(row.code, row.baseTasfya))
                        }
                        onChange={(e) =>
                          setEdits((p) => ({ ...p, [row.code]: e.target.value }))
                        }
                        style={{
                          width: `calc(${Math.max(
                            4,
                            (
                              edits[row.code] ??
                              String(
                                supplierAdjusted(row.code, row.baseTasfya),
                              )
                            ).length,
                          )}ch + 2.5rem)`,
                        }}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-center font-bold tabular-nums outline-none transition focus:ring-2",
                          tasfyaPillClass(row.tasfya),
                        )}
                        aria-label={`Settlement for ${row.code}`}
                      />
                    </td>
                    {!hiddenCols.has("bonus") && (
                      <td className="px-3 py-3 text-center align-middle tabular-nums">
                        {row.bonus}
                      </td>
                    )}
                    {!hiddenCols.has("bonusPct") && (
                      <td className="px-3 py-3 text-center align-middle tabular-nums">
                        {pct(bonusPercent(row.received, row.bonus))}
                      </td>
                    )}
                    <td className="p-0 align-top text-center">
                      {row.lines.length === 0 ? (
                        <div className={ENTRY}>
                          <span className="text-muted-foreground/40">—</span>
                        </div>
                      ) : (
                        row.lines.map((l, i) => (
                          <div key={i} className={ENTRY}>
                            <span className="whitespace-nowrap font-medium" dir="auto">
                              {l.supplier || "—"}
                            </span>
                            <span className="whitespace-nowrap text-xs text-muted-foreground">
                              {[l.invoice && `Inv. ${l.invoice}`, l.date]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </div>
                        ))
                      )}
                    </td>
                    <td className="p-0 align-top text-center tabular-nums">
                      {row.lines.length === 0 ? (
                        <div className={ENTRY}>{row.received}</div>
                      ) : (
                        row.lines.map((l, i) => (
                          <div key={i} className={ENTRY}>
                            {l.received}
                          </div>
                        ))
                      )}
                    </td>
                    <td className="p-0 align-top text-center tabular-nums">
                      {row.lines.length === 0 ? (
                        <div className={ENTRY}>{pct(row.basicPct)}</div>
                      ) : (
                        row.lines.map((l, i) => (
                          <div key={i} className={ENTRY}>
                            {pct(l.basicPct)}
                          </div>
                        ))
                      )}
                    </td>
                    {!hiddenCols.has("extraPct") && (
                      <td className="p-0 align-top text-center tabular-nums">
                        {row.lines.length === 0 ? (
                          <div className={ENTRY}>{pct(row.extraPct)}</div>
                        ) : (
                          row.lines.map((l, i) => (
                            <div key={i} className={ENTRY}>
                              {pct(l.extraPct)}
                            </div>
                          ))
                        )}
                      </td>
                    )}
                    {!hiddenCols.has("specialPct") && (
                      <td className="p-0 align-top text-center tabular-nums">
                        {row.lines.length === 0 ? (
                          <div className={ENTRY}>{pct(row.specialPct)}</div>
                        ) : (
                          row.lines.map((l, i) => (
                            <div key={i} className={ENTRY}>
                              {pct(l.specialPct)}
                            </div>
                          ))
                        )}
                      </td>
                    )}
                    {supplierColumns.map((col) => {
                      const editable = row.baseTasfya < 0;
                      const raw = supplierCells[row.code.trim()]?.[col.id] ?? "";
                      const { base, bounce } = parseCell(raw);
                      const bpct = bonusPercent(base + bounce, bounce);
                      return (
                        <td
                          key={col.id}
                          className="border-s border-border/60 p-0 align-middle"
                        >
                          {editable ? (
                            <>
                              <input
                                value={raw}
                                inputMode="text"
                                onChange={(e) =>
                                  setSupCell(row.code, col.id, e.target.value)
                                }
                                title="اكتب الكمية، أو كمية+بونص مثل 100+10"
                                className="h-9 w-24 min-w-full border-0 bg-transparent px-2 text-center text-sm tabular-nums outline-none focus:bg-primary/5 focus:ring-2 focus:ring-inset focus:ring-ring"
                              />
                              {bounce > 0 && (
                                <div className="-mt-1 pb-0.5 text-center text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                  +{bpct}% bounce
                                </div>
                              )}
                            </>
                          ) : (
                            <div className={ENTRY}>
                              <span className="text-muted-foreground/30">—</span>
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={columns.length + supplierColumns.length}
                      className="px-3 py-10 text-center text-muted-foreground"
                    >
                      No rows match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Excel-style filter dropdown */}
      {menu &&
        (() => {
          const spaceBelow = window.innerHeight - menu.bottom;
          const spaceAbove = menu.top;
          const openUp = spaceBelow < 320 && spaceAbove > spaceBelow;
          const maxHeight = Math.max(180, (openUp ? spaceAbove : spaceBelow) - 16);
          return (
            <div
              data-col-filter
              style={
                openUp
                  ? {
                      position: "fixed",
                      bottom: window.innerHeight - menu.top + 4,
                      left: menu.x,
                      maxHeight,
                    }
                  : {
                      position: "fixed",
                      top: menu.bottom + 4,
                      left: menu.x,
                      maxHeight,
                    }
              }
              className="z-50 flex w-72 flex-col overflow-hidden rounded-lg border border-border bg-card p-2 text-sm shadow-xl"
            >
              <div className="flex gap-1 pb-2">
                <button
                  type="button"
                  onClick={() => {
                    setSort({ col: menu.col, dir: "asc" });
                    setMenu(null);
                  }}
                  className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-muted"
                >
                  <ArrowUp className="size-3.5" /> Sort ascending
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSort({ col: menu.col, dir: "desc" });
                    setMenu(null);
                  }}
                  className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-muted"
                >
                  <ArrowDown className="size-3.5" /> Sort descending
                </button>
              </div>

              <div className="-mx-2 border-t border-border" />

              <div className="relative pt-2">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  value={valSearch}
                  onChange={(e) => setValSearch(e.target.value)}
                  placeholder="Search values…"
                  className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                />
              </div>

              <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 font-medium hover:bg-muted">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={!!menuAllChecked}
                  ref={(el) => {
                    if (el)
                      el.indeterminate =
                        !menuAllChecked &&
                        menuValues.some(
                          (v) => !filters[menu.col] || filters[menu.col].has(v),
                        );
                  }}
                  onChange={(e) =>
                    setAllValues(menu.col, menuValues, e.target.checked)
                  }
                />
                <span>(Select all{valSearch ? " in search" : ""})</span>
              </label>

              <div className="min-h-0 flex-1 overflow-auto py-1">
                {menuValues.length === 0 && (
                  <p className="px-2 py-3 text-center text-muted-foreground">
                    No matching values.
                  </p>
                )}
                {menuValues.map((v) => {
                  const checked = !filters[menu.col] || filters[menu.col].has(v);
                  return (
                    <label
                      key={v}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        className="size-3.5 accent-primary"
                        checked={checked}
                        onChange={() => toggleValue(menu.col, v)}
                      />
                      <span
                        className={cn("truncate", v === "" && "italic text-muted-foreground")}
                        title={fmt(menu.col, v)}
                      >
                        {fmt(menu.col, v)}
                      </span>
                    </label>
                  );
                })}
              </div>

              <div className="-mx-2 border-t border-border" />

              <div className="flex items-center justify-between gap-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => clearColumn(menu.col)}
                  disabled={!filters[menu.col]}
                >
                  Clear filter
                </Button>
                <Button size="sm" onClick={() => setMenu(null)}>
                  <Check /> Done
                </Button>
              </div>
            </div>
          );
        })()}

      {!loading && result && allRows.length === 0 && !error && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing to settle for {company} in {monthLabel(month)}.
        </div>
      )}
    </main>
  );
}

function flyingRemClass(rem: number): string {
  if (rem < 0) return "text-red-600 dark:text-red-400";
  if (rem === 0) return "text-emerald-600 dark:text-emerald-400";
  return "text-yellow-500 dark:text-yellow-400";
}

// Click a code to peek at its تصفية ع الطاير row: distributor breakdown, بونص,
// الباقى and any note. Portalled to <body> so the sticky/overflow table never
// clips it.
function FlyingCodeCell({
  code,
  tasfya,
  flying,
  zeroLoading,
  zeroHits,
}: {
  code: string;
  tasfya: number;
  flying: { columns: FlyingColumn[]; byCode: Map<string, FlyingRow> } | null;
  zeroLoading: boolean;
  zeroHits: ZeroHit[];
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const row = flying?.byCode.get(code.trim()) ?? null;
  const columns = flying?.columns ?? [];
  const rem = row ? effRemaining(row, columns) : 0;
  const hasFlying = !!row;
  // Auto Tasfya says still short (negative), but Flying tasfya shows it covered
  // (الباقى = 0) — flag it so it can be settled from الطاير.
  const coveredOnFlying = tasfya < 0 && hasFlying && rem === 0;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`تم نسخ الكود ${code}`);
    } catch {
      toast.error("تعذّر نسخ الكود");
    }
  };

  return (
    <>
      <span className="flex w-full items-center gap-1">
        <button
          ref={ref}
          type="button"
          onClick={() => setOpen((o) => !o)}
          title="عرض تصفية ع الطاير"
          className={cn(
            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-primary/10 hover:text-primary",
            open && "bg-primary/10 text-primary",
          )}
        >
          <Plane
            className={cn(
              "size-3 shrink-0",
              hasFlying ? "text-primary/70" : "text-muted-foreground/40",
            )}
          />
          {code}
        </button>
        <button
          type="button"
          onClick={copyCode}
          title="نسخ الكود"
          aria-label="نسخ الكود"
          className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
        >
          <Copy className="size-3.5" />
        </button>
        {zeroHits.length > 0 && (
          <button
            type="button"
            dir="rtl"
            onClick={() => setOpen(true)}
            title={`موجود في ملفات الأصفار (${zeroHits.length} يوم) — اضغط للتفاصيل`}
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-semibold text-violet-700 transition-colors hover:bg-violet-500/25 dark:text-violet-400"
          >
            <CircleDot className="size-3 shrink-0" />
            <span dir="ltr">{zeroHits[zeroHits.length - 1].date}</span>
            {zeroHits.length > 1 && <span>×{zeroHits.length}</span>}
          </button>
        )}
        {coveredOnFlying && (
          <span
            dir="rtl"
            title="التسوية سالبة لكن الباقى في تصفية ع الطاير = 0"
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400"
          >
            <Plane className="size-3 shrink-0" />
            ع الطاير
          </span>
        )}
      </span>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setOpen(false)}
          >
            <div
              dir="rtl"
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[90vh] max-w-[92vw] flex-col overflow-auto rounded-lg border border-border bg-card p-3 text-foreground shadow-xl"
            >
              <div className="mb-2 flex items-center justify-between gap-3 border-b border-border pb-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <Plane className="size-4 text-primary" /> تصفية ع الطاير
                </span>
                <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                  {code}
                </span>
              </div>

              {flying === null ? (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  جارٍ التحميل…
                </p>
              ) : !row ? (
                <p className="py-2 text-center text-xs text-muted-foreground">
                  لا يوجد هذا الكود في تصفية ع الطاير
                </p>
              ) : (
                <div className="max-w-[86vw] overflow-x-auto rounded-md border border-border">
                  <table className="w-full border-collapse text-sm [&_td]:border [&_td]:border-border [&_th]:border [&_th]:border-border">
                    <thead>
                      <tr className="bg-muted text-center">
                        <th className="whitespace-nowrap px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                          الكود
                        </th>
                        <th className="min-w-[16rem] whitespace-nowrap px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                          اسم الصنف
                        </th>
                        <th className="whitespace-nowrap px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                          الباقى
                        </th>
                        <th className="whitespace-nowrap px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                          الكمية
                        </th>
                        {columns.map((col) => (
                          <th
                            key={col.id}
                            className="whitespace-nowrap px-2 py-1.5 text-xs font-semibold text-muted-foreground"
                          >
                            <span dir="auto">{col.name || "—"}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="bg-card">
                        <td className="whitespace-nowrap px-2 py-1.5 text-center tabular-nums">
                          <span className="inline-flex items-center justify-center gap-1.5">
                            <span dir="ltr">{row.code}</span>
                            {row.note && row.note.trim() && (
                              <StickyNote
                                className="size-3.5 text-amber-500"
                                aria-label="note"
                              />
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-center" dir="auto">
                          {row.name}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-1.5 text-center tabular-nums",
                            flyingRemClass(rem),
                          )}
                          dir="ltr"
                        >
                          {fmtBalance(rem)}
                        </td>
                        <td className="px-3 py-1.5 text-center tabular-nums" dir="ltr">
                          {row.order.toLocaleString("en-US")}
                        </td>
                        {columns.map((col) => {
                          const { base, bounce } = parseCell(row.cells[col.id]);
                          const bpct = bonusPercent(base + bounce, bounce);
                          return (
                            <td
                              key={col.id}
                              className="px-2 py-1.5 text-center tabular-nums"
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
                  {row.note && row.note.trim() && (
                    <div className="flex items-start gap-1.5 border-t border-border bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                      <StickyNote className="mt-0.5 size-3.5 shrink-0" />
                      <span dir="auto">{row.note}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-3 border-t border-border pt-2">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <CircleDot className="size-4 text-violet-500" /> ملفات الأصفار
                  </span>
                  {zeroHits.length > 0 && (
                    <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:text-violet-400">
                      {zeroHits.length} يوم
                    </span>
                  )}
                </div>
                {zeroLoading ? (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    جارٍ التحميل…
                  </p>
                ) : zeroHits.length === 0 ? (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    لا يوجد هذا الكود في ملفات الأصفار
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full border-collapse text-sm [&_td]:border [&_td]:border-border [&_th]:border [&_th]:border-border">
                      <thead>
                        <tr className="bg-muted text-center">
                          <th className="whitespace-nowrap px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                            التاريخ
                          </th>
                          <th className="whitespace-nowrap px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                            الكمية
                          </th>
                          <th className="min-w-[12rem] whitespace-nowrap px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                            المورد
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {zeroHits.map((h, i) => (
                          <tr key={`${h.date}-${i}`} className="bg-card">
                            <td className="whitespace-nowrap px-3 py-1.5 text-center tabular-nums" dir="ltr">
                              <span className="inline-flex items-center gap-1.5">
                                <CalendarDays className="size-3.5 text-muted-foreground" />
                                {h.date}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-center tabular-nums" dir="ltr">
                              {h.order || "—"}
                            </td>
                            <td className="px-3 py-1.5 text-center" dir="auto">
                              {h.supplier || "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

const CHIP_TONES = {
  emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-emerald-500",
  amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-amber-500",
  red: "bg-red-500/15 text-red-700 dark:text-red-400 ring-red-500",
} as const;

function SettleChip({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  tone: keyof typeof CHIP_TONES;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-sm font-medium transition-shadow",
        CHIP_TONES[tone],
        active
          ? "ring-2 ring-offset-1 ring-offset-background"
          : "opacity-90 hover:opacity-100",
      )}
      aria-pressed={active}
    >
      {label} {count}
    </button>
  );
}
