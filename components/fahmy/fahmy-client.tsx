"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  ArrowDownRight,
  ArrowUpRight,
  Award,
  Banknote,
  ChevronDown,
  FileSpreadsheet,
  Layers,
  Loader2,
  Minus,
  Package,
  Repeat2,
  Copy,
  Download,
  RotateCcw,
  Search,
  ShoppingCart,
  Target,
  Trash2,
  TrendingUp,
  Wand2,
  Warehouse,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  analyzeFahmy,
  autoTidyBrands,
  computeBrandPlan,
  computeSlabPlans,
  normalizeBrand,
  type BrandPlanRow,
  type BrandSummary,
  type MoverItem,
  type PlanBasis,
  type PlanStatus,
  type SheetMatrix,
} from "@/lib/fahmy";


const XLSX_ACCEPT = ".xlsx,.xls";
const isExcel = (f: File) => /\.xls[xm]?$/i.test(f.name);

/** Find a sheet by a fuzzy name match (case/space-insensitive contains). */
function pickSheet(names: string[], wanted: string[]): string | undefined {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  return names.find((n) => wanted.some((w) => norm(n).includes(norm(w))));
}

const egp = (v: number, d = 0) =>
  v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });

/** Compact money: 16.33M / 512K / 940. */
function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return egp(v);
}

const pct = (v: number, d = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`;

/** Monochrome ramp for categorical marks — primary fading through the ranks. */
const RAMP_OPACITY = [100, 78, 60, 46, 34, 24];
const shade = (i: number) =>
  `color-mix(in oklab, var(--primary) ${
    RAMP_OPACITY[Math.min(i, RAMP_OPACITY.length - 1)]
  }%, transparent)`;

// --- primitives ------------------------------------------------------------

function DeltaChip({ value, className }: { value: number; className?: string }) {
  const up = value > 0;
  const flat = value === 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums",
        flat
          ? "bg-muted text-muted-foreground"
          : up
            ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"
            : "bg-red-500/12 text-red-600 dark:text-red-400",
        className,
      )}
    >
      <Icon className="size-3" />
      {pct(value)}
    </span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  delta,
  sub,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  delta?: number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border bg-card p-4 transition-shadow hover:shadow-sm",
        accent && "ring-1 ring-primary/15",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "flex size-9 items-center justify-center rounded-xl",
            accent ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/70",
          )}
        >
          <Icon className="size-[1.125rem]" />
        </span>
        {delta !== undefined && <DeltaChip value={delta} />}
      </div>
      <div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 text-2xl font-bold leading-tight tracking-tight tabular-nums">
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Panel({
  title,
  desc,
  action,
  children,
  className,
}: {
  title?: string;
  desc?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-2xl border border-border bg-card p-5", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h3 className="text-sm font-semibold">{title}</h3>}
            {desc && <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  eyebrow,
  title,
  desc,
}: {
  icon: LucideIcon;
  eyebrow?: string;
  title: string;
  desc?: string;
}) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground/70">
        <Icon className="size-5" />
      </span>
      <div>
        {eyebrow && (
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </div>
        )}
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {desc && <p className="text-sm text-muted-foreground">{desc}</p>}
      </div>
    </div>
  );
}

// --- charts (inline SVG / CSS, monochrome) --------------------------------

/** Donut of brand share of 2026 value — top 6 brands + "Others". */
function ShareDonut({ brands }: { brands: BrandSummary[] }) {
  const real = brands.filter((b) => b.brand !== "Cancelled" && b.value2026 > 0);
  const top = real.slice(0, 6);
  const othersVal = real.slice(6).reduce((s, b) => s + b.value2026, 0);
  const segments = [
    ...top.map((b) => ({ label: b.brand, value: b.value2026, share: b.share2026 })),
    ...(othersVal > 0
      ? [
          {
            label: "Others",
            value: othersVal,
            share: real.slice(6).reduce((s, b) => s + b.share2026, 0),
          },
        ]
      : []),
  ];
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const R = 56;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative shrink-0">
        <svg width="148" height="148" viewBox="0 0 148 148" className="-rotate-90">
          <circle cx="74" cy="74" r={R} fill="none" stroke="var(--muted)" strokeWidth="16" />
          {segments.map((s, i) => {
            const len = (s.value / total) * C;
            const el = (
              <circle
                key={s.label}
                cx="74"
                cy="74"
                r={R}
                fill="none"
                stroke={shade(i)}
                strokeWidth="16"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Brands
          </span>
          <span className="text-xl font-bold tabular-nums">{real.length}</span>
        </div>
      </div>
      <ul className="w-full space-y-1.5">
        {segments.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 text-sm">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: shade(i) }}
            />
            <span className="min-w-0 flex-1 truncate" dir="auto">
              {s.label}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {compact(s.value)}
            </span>
            <span className="w-12 text-right font-medium tabular-nums">
              {s.share.toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Grouped 2025 (ghost) vs 2026 (solid) bars per brand. */
function BrandBars({ brands }: { brands: BrandSummary[] }) {
  const list = brands.filter((b) => b.value2026 > 0 || b.value2025 > 0);
  const max = Math.max(1, ...list.map((b) => Math.max(b.value2025, b.value2026)));
  return (
    <div className="space-y-3.5">
      {list.map((b) => (
        <div key={b.brand} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3">
          <span className="truncate text-sm font-medium" dir="auto" title={b.brand}>
            {b.brand}
          </span>
          <div className="relative h-6">
            {/* 2025 ghost */}
            <div
              className="absolute inset-y-0 left-0 rounded-md bg-muted"
              style={{ width: `${(b.value2025 / max) * 100}%` }}
            />
            {/* 2026 solid */}
            <div
              className="absolute inset-y-0 left-0 flex items-center rounded-md bg-primary transition-[width] duration-700"
              style={{ width: `${(b.value2026 / max) * 100}%` }}
            />
          </div>
          <div className="flex items-center gap-2 justify-self-end">
            <span className="w-16 text-right text-sm font-semibold tabular-nums">
              {compact(b.value2026)}
            </span>
            <DeltaChip value={b.valueGrowthPct} className="w-[4.5rem] justify-center" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Ranked list with a magnitude bar — used for top products & movers. */
function RankedBars({
  rows,
  tone = "neutral",
}: {
  rows: { code: string; name: string; brand: string; primary: number; label: string }[];
  tone?: "neutral" | "pos" | "neg";
}) {
  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">No items.</p>;
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.primary)));
  const barCls =
    tone === "pos"
      ? "bg-emerald-500/70"
      : tone === "neg"
        ? "bg-red-500/70"
        : "bg-primary/70";
  const labelCls =
    tone === "pos"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "neg"
        ? "text-red-600 dark:text-red-400"
        : "text-foreground";
  return (
    <ol className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r.code} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-2.5">
          <span className="text-right text-xs font-medium tabular-nums text-muted-foreground">
            {i + 1}
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm" dir="auto" title={r.name}>
                {r.name}
              </span>
              <span className="text-[11px] text-muted-foreground">{r.brand}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full transition-[width] duration-700", barCls)}
                style={{ width: `${(Math.abs(r.primary) / max) * 100}%` }}
              />
            </div>
          </div>
          <span className={cn("w-20 text-right text-sm font-semibold tabular-nums", labelCls)}>
            {r.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Shared colour + label for each Q4-plan status. */
const STATUS_STYLE: Record<
  PlanStatus,
  { label: string; bar: string; text: string; chip: string }
> = {
  ahead: {
    label: "Ahead — can ease off",
    bar: "border-t-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  onpace: {
    label: "On pace",
    bar: "border-t-sky-500",
    text: "text-sky-600 dark:text-sky-400",
    chip: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  },
  watch: {
    label: "Slight step-up",
    bar: "border-t-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    chip: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  behind: {
    label: "Step up needed",
    bar: "border-t-red-500",
    text: "text-red-600 dark:text-red-400",
    chip: "bg-red-500/15 text-red-600 dark:text-red-400",
  },
};

const moverRows = (rows: MoverItem[], signed: boolean) =>
  rows.map((r) => ({
    code: r.code,
    name: r.name,
    brand: r.brand,
    primary: r.change,
    label: `${signed && r.change > 0 ? "+" : ""}${egp(r.change)}`,
  }));

// Modal listing every new / discontinued code, with search, copy and export.
function ItemListModal({
  kind,
  items,
  onClose,
}: {
  kind: "new" | "disc";
  items: MoverItem[];
  onClose: () => void;
}) {
  const [q, setQ] = React.useState("");

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filtered = React.useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter(
      (i) => i.code.includes(t) || i.name.toLowerCase().includes(t),
    );
  }, [items, q]);

  const isNew = kind === "new";
  const title = isNew ? "New SKUs in 2026" : "Discontinued SKUs";
  const valueOf = (i: MoverItem) => (isNew ? i.value2026 : i.value2025);
  const total = filtered.reduce((s, i) => s + valueOf(i), 0);

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(filtered.map((i) => i.code).join("\n"));
      toast.success(`Copied ${filtered.length} codes`);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const exportExcel = async () => {
    try {
      const XLSX = await import("xlsx");
      const rows = filtered.map((i) => ({
        "كود الصنف": i.code,
        "اسم الصنف": i.name,
        Brand: i.brand,
        [isNew ? "Value 2026 (EGP)" : "Lost value 2025 (EGP)"]: valueOf(i),
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, isNew ? "New" : "Discontinued");
      XLSX.writeFile(wb, `fahmy-${kind}-skus.xlsx`);
    } catch {
      toast.error("Couldn't export");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h3 className="text-base font-semibold">{title}</h3>
            <p className="text-xs text-muted-foreground">
              {items.length.toLocaleString()} codes ·{" "}
              {isNew ? "value contributed" : "value lost"}:{" "}
              {compact(items.reduce((s, i) => s + valueOf(i), 0))} EGP
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-40 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search code or name…"
              className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </div>
          <Button variant="outline" size="sm" onClick={copyCodes}>
            <Copy /> Copy codes
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel}>
            <Download /> Excel
          </Button>
        </div>

        <div className="overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 text-right font-medium">#</th>
                <th className="px-3 py-2 text-left font-medium">Code</th>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">
                  {isNew ? "Value 2026" : "Lost (2025)"}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i, idx) => (
                <tr key={i.code} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {idx + 1}
                  </td>
                  <td className="px-3 py-2 tabular-nums font-medium">{i.code}</td>
                  <td className="max-w-[22rem] px-3 py-2">
                    <div className="truncate" dir="auto" title={i.name}>
                      {i.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{i.brand}</div>
                  </td>
                  <td
                    className={cn(
                      "whitespace-nowrap px-3 py-2 text-right tabular-nums font-semibold",
                      isNew
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400",
                    )}
                  >
                    {isNew ? "" : "−"}
                    {egp(valueOf(i))}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-10 text-center text-muted-foreground">
                    No codes match “{q}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          Showing {filtered.length.toLocaleString()} of{" "}
          {items.length.toLocaleString()} · {isNew ? "value" : "lost value"}:{" "}
          <b className="tabular-nums text-foreground">{egp(total)} EGP</b>
        </div>
      </div>
    </div>
  );
}

// --- main ------------------------------------------------------------------

export function FahmyClient() {
  // Raw sheets are kept so the analysis can be recomputed when the user changes
  // the brand grouping, without re-reading the file.
  const [raw, setRaw] = React.useState<{
    sales: SheetMatrix;
    stock: SheetMatrix | null;
  } | null>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Manual brand merges apply only to the current session/file — they are NOT
  // persisted, so a merge made while inspecting one file can never leak into
  // another and silently rename a brand. Canonical detection handles the known
  // brands automatically; this is only for one-off manual grouping.
  const [overrides, setOverrides] = React.useState<Record<string, string>>({});
  const [showGrouping, setShowGrouping] = React.useState(false);
  const [churn, setChurn] = React.useState<null | "new" | "disc">(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const analysis = React.useMemo(
    () => (raw ? analyzeFahmy(raw.sales, raw.stock, overrides) : null),
    [raw, overrides],
  );

  // Q4-plan controls. The company target (a chosen SLAB) is split across brands
  // by their share of the selected basis; months/VAT drive the pace maths.
  const [slabIdx, setSlabIdx] = React.useState(0);
  const [monthsElapsed, setMonthsElapsed] = React.useState(9);
  const [vatPct, setVatPct] = React.useState(14);
  // Sales share differentiates brands; purchases share is circular (every brand
  // lands at the same attainment), so it's the non-default option.
  const [basis, setBasis] = React.useState<PlanBasis>("sales");

  const plan = React.useMemo(() => {
    if (!analysis || analysis.targets.length === 0) return [] as BrandPlanRow[];
    const idx = Math.min(slabIdx, analysis.targets.length - 1);
    return computeBrandPlan(analysis, {
      annualTarget: analysis.targets[idx]?.annual ?? 0,
      monthsElapsed: monthsElapsed || 1,
      vatRate: vatPct / 100,
      basis,
    });
  }, [analysis, slabIdx, monthsElapsed, vatPct, basis]);

  // Company-total suggestion per slab (company-mode files only).
  const slabPlans = React.useMemo(() => {
    if (!analysis || analysis.targetMode !== "company") return [];
    const net =
      analysis.kpis.netPurchaseBeforeTax ??
      analysis.kpis.purchased2026 / (1 + vatPct / 100);
    return computeSlabPlans(analysis, {
      net,
      monthsElapsed: monthsElapsed || 1,
      vatRate: vatPct / 100,
    });
  }, [analysis, monthsElapsed, vatPct]);

  const loadFile = React.useCallback(async (file: File) => {
    if (!isExcel(file)) {
      setError("Please choose an .xlsx file (same layout as يونيلفر.xlsx).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const names = wb.SheetNames;

      const salesName = pickSheet(names, ["SALES", "مبيعات"]);
      if (!salesName) {
        setError(`No SALES sheet found. Sheets in this file: ${names.join(", ")}`);
        return;
      }
      const stockName = pickSheet(names, ["CURRENT STOCK", "STOCK", "مخزون"]);

      const toMatrix = (sheetName: string): SheetMatrix =>
        XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
          header: 1,
          blankrows: false,
          defval: "",
        }) as SheetMatrix;

      const sales = toMatrix(salesName);
      const stock = stockName ? toMatrix(stockName) : null;

      const probe = analyzeFahmy(sales, stock);
      if (probe.kpis.skuCount === 0) {
        setError(
          "The SALES sheet was found but no item rows were parsed — check the file layout.",
        );
        return;
      }
      setOverrides({}); // each upload starts from clean canonical detection
      setRaw({ sales, stock });
      setFileName(file.name);
      toast.success(
        `Analyzed ${probe.kpis.skuCount.toLocaleString()} items across ${probe.kpis.brandCount} brands` +
          (stockName ? "" : " · no stock sheet found"),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  }, []);

  const clear = () => {
    setRaw(null);
    setFileName(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  // Brand-grouping helpers.
  const setGroup = (from: string, to: string) =>
    setOverrides((prev) => {
      const next = { ...prev };
      const target = to.trim();
      if (!target || target === from) delete next[from];
      else next[from] = target;
      return next;
    });
  const autoTidy = () => {
    if (!analysis) return;
    setOverrides((prev) => ({
      ...prev,
      ...autoTidyBrands(analysis.rawBrands.map((r) => r.name)),
    }));
  };
  const resetGrouping = () => setOverrides({});
  const mergedCount = analysis
    ? analysis.rawBrands.filter((r) => overrides[r.name]).length
    : 0;

  const k = analysis?.kpis;
  const topBrand = analysis?.brands.find((b) => b.brand !== "Cancelled");

  return (
    <div className="space-y-8">
      {/* Upload zone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) loadFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition-colors",
          analysis
            ? "border-primary/40 bg-primary/[0.03]"
            : "border-border hover:border-primary/50 hover:bg-muted/40",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={XLSX_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
          }}
        />
        <div className="rounded-2xl bg-muted p-3">
          <FileSpreadsheet className="size-6 text-primary" />
        </div>
        <p className="font-semibold">Upload the sales workbook</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Click or drag an .xlsx with the same layout as يونيلفر.xlsx (SALES +
          CURRENT STOCK)
        </p>
        {fileName && (
          <p className="mt-1 text-xs text-muted-foreground">
            {fileName} · {k?.skuCount.toLocaleString()} items
          </p>
        )}
      </div>

      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Reading workbook…
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {analysis && k && (
        <div className="space-y-10">
          {/* Report banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-5">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Sales analysis · 2026 vs 2025
              </div>
              <h2 className="mt-0.5 text-xl font-bold tracking-tight">
                {fileName?.replace(/\.[^.]+$/, "") ?? "Workbook"}
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {k.skuCount.toLocaleString()} items · {k.brandCount} brands ·{" "}
                {analysis.stockCount.toLocaleString()} stock codes ·{" "}
                {monthsElapsed} months of data
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={clear}>
              <Trash2 /> Clear
            </Button>
          </div>

          {/* Brand grouping editor */}
          <div className="rounded-2xl border border-border bg-card">
            <button
              type="button"
              onClick={() => setShowGrouping((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
            >
              <span className="flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-foreground/70">
                  <Layers className="size-[1.125rem]" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">
                    Brand grouping
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {analysis.rawBrands.length} source names →{" "}
                    {analysis.brands.filter((b) => b.brand !== "Cancelled").length}{" "}
                    brands
                    {mergedCount > 0 ? ` · ${mergedCount} merged` : ""}
                  </span>
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "size-5 shrink-0 text-muted-foreground transition-transform",
                  showGrouping && "rotate-180",
                )}
              />
            </button>

            {showGrouping && (
              <div className="border-t border-border p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Type or pick a group for any source name to merge it — give
                    several the same name to combine them (e.g. every DOVE
                    variant → <b className="text-foreground">DOVE</b>).
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={autoTidy}>
                      <Wand2 /> Auto-tidy
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={resetGrouping}
                      disabled={mergedCount === 0}
                    >
                      <RotateCcw /> Reset
                    </Button>
                  </div>
                </div>

                <datalist id="fahmy-brand-groups">
                  {analysis.brands
                    .filter((b) => b.brand !== "Cancelled")
                    .map((b) => (
                      <option key={b.brand} value={b.brand} />
                    ))}
                </datalist>

                <div className="grid max-h-96 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {analysis.rawBrands.map((rb) => {
                    const merged = overrides[rb.name];
                    return (
                      <div
                        key={rb.name}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-3 py-2",
                          merged
                            ? "border-primary/30 bg-primary/[0.04]"
                            : "border-border",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div
                            className="truncate text-sm font-medium"
                            dir="auto"
                            title={rb.name}
                          >
                            {rb.name}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {rb.count} item{rb.count === 1 ? "" : "s"} ·{" "}
                            {compact(rb.value2026)} EGP
                          </div>
                        </div>
                        <span className="text-muted-foreground">→</span>
                        <input
                          key={`${rb.name}:${merged ?? ""}`}
                          list="fahmy-brand-groups"
                          defaultValue={merged ?? rb.name}
                          onBlur={(e) => setGroup(rb.name, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                          className={cn(
                            "h-8 w-32 rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                            merged && "font-semibold text-primary",
                          )}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard
              icon={Banknote}
              label="Sold value 2026"
              value={`${compact(k.value2026)}`}
              delta={k.valueGrowthPct}
              sub={`vs ${compact(k.value2025)} in 2025 · EGP`}
              accent
            />
            <StatCard
              icon={Package}
              label="Units sold 2026"
              value={egp(k.qty2026)}
              delta={k.qtyGrowthPct}
              sub="units vs 2025"
            />
            <StatCard
              icon={ShoppingCart}
              label="Purchased 2026"
              value={`${compact(k.purchased2026)}`}
              sub={
                k.netPurchaseBeforeTax != null
                  ? `net of tax: ${compact(k.netPurchaseBeforeTax)} · EGP`
                  : "EGP (incl. tax)"
              }
            />
            <StatCard
              icon={Award}
              label="Top brand 2026"
              value={topBrand?.brand ?? "—"}
              sub={`${(topBrand?.share2026 ?? 0).toFixed(1)}% of sold value`}
            />
            <StatCard
              icon={Repeat2}
              label="New / discontinued"
              value={`${k.newCount} / ${k.discCount}`}
              sub={`${compact(k.newValue)} new · ${compact(k.discValue)} lost`}
            />
            <StatCard
              icon={Warehouse}
              label="Stock on hand"
              value={egp(k.stockUnits)}
              sub={`${k.zeroStockCount} at zero / negative`}
            />
          </div>

          {/* Brand performance */}
          <section>
            <SectionHeader
              icon={TrendingUp}
              eyebrow="Part 1"
              title="Brand performance"
              desc="Value sold to end customers, 2025 vs 2026."
            />
            <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
              <Panel title="Value sold by brand" desc="2025 (ghost) vs 2026 (solid)">
                <BrandBars brands={analysis.brands} />
              </Panel>
              <Panel title="Share of 2026 value">
                <ShareDonut brands={analysis.brands} />
              </Panel>
            </div>
          </section>

          {/* Top products + brand table */}
          <section className="grid gap-4 lg:grid-cols-2">
            <Panel title="Top 10 products by 2026 value">
              <RankedBars
                rows={analysis.topProducts.map((p) => ({
                  code: p.code,
                  name: p.name,
                  brand: p.brand,
                  primary: p.value2026,
                  label: compact(p.value2026),
                }))}
              />
            </Panel>
            <Panel title="Full brand breakdown">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 text-left font-medium">Brand</th>
                      <th className="py-2 text-right font-medium">SKUs</th>
                      <th className="py-2 text-right font-medium">2026</th>
                      <th className="py-2 text-right font-medium">YoY</th>
                      <th className="py-2 text-right font-medium">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.brands.map((b) => (
                      <tr
                        key={b.brand}
                        className="border-b border-border/50 last:border-0"
                      >
                        <td className="py-2 font-medium" dir="auto">
                          {b.brand}
                        </td>
                        <td className="py-2 text-right tabular-nums text-muted-foreground">
                          {b.skuCount}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {compact(b.value2026)}
                        </td>
                        <td className="py-2 text-right">
                          <DeltaChip value={b.valueGrowthPct} />
                        </td>
                        <td className="py-2 text-right tabular-nums text-muted-foreground">
                          {b.share2026.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </section>

          {/* Movers */}
          <section>
            <SectionHeader
              icon={TrendingUp}
              title="Movers"
              desc="Biggest gains and losses in sold value, 2025 → 2026 (EGP)."
            />
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel
                title="Top gainers"
                action={
                  <ArrowUpRight className="size-5 text-emerald-500" />
                }
              >
                <RankedBars rows={moverRows(analysis.gainers, true)} tone="pos" />
              </Panel>
              <Panel
                title="Top losers"
                action={<ArrowDownRight className="size-5 text-red-500" />}
              >
                <RankedBars rows={moverRows(analysis.losers, false)} tone="neg" />
              </Panel>
            </div>
          </section>

          {/* Portfolio churn */}
          <section>
            <SectionHeader
              icon={Repeat2}
              title="Portfolio churn"
              desc="Codes that appeared or disappeared between the two years."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setChurn("new")}
                disabled={k.newCount === 0}
                className="group rounded-2xl border border-border border-t-4 border-t-primary bg-card p-5 text-left transition-shadow hover:shadow-sm disabled:cursor-default disabled:opacity-70"
              >
                <div className="text-3xl font-bold tracking-tight">
                  {k.newCount}
                  <span className="ml-2 text-base font-medium text-muted-foreground">
                    new SKUs
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Launched in 2026 with no prior-year sales, contributing{" "}
                  <b className="text-foreground">EGP {egp(k.newValue)}</b> —{" "}
                  {k.value2026 > 0
                    ? ((k.newValue / k.value2026) * 100).toFixed(1)
                    : "0"}
                  % of 2026 value.
                </p>
                {k.newCount > 0 && (
                  <span className="mt-2 inline-block text-xs font-medium text-primary group-hover:underline">
                    View {k.newCount} codes →
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setChurn("disc")}
                disabled={k.discCount === 0}
                className="group rounded-2xl border border-border border-t-4 border-t-red-500/70 bg-card p-5 text-left transition-shadow hover:shadow-sm disabled:cursor-default disabled:opacity-70"
              >
                <div className="text-3xl font-bold tracking-tight text-red-600 dark:text-red-400">
                  {k.discCount}
                  <span className="ml-2 text-base font-medium text-muted-foreground">
                    discontinued
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Had 2025 sales but none in 2026 —{" "}
                  <b className="text-foreground">EGP {egp(k.discValue)}</b> of
                  lost value.
                </p>
                {k.discCount > 0 && (
                  <span className="mt-2 inline-block text-xs font-medium text-red-600 group-hover:underline dark:text-red-400">
                    View {k.discCount} codes →
                  </span>
                )}
              </button>
            </div>
          </section>

          {/* Targets */}
          {analysis.targets.length > 0 && (
            <section>
              <SectionHeader
                icon={Target}
                title="Purchase targets"
                desc={
                  analysis.targetMode === "brand"
                    ? "Net-of-tax annual target per brand (from the file) vs that brand's net purchases to date."
                    : "Net-of-tax annual company target by slab vs net purchases to date."
                }
              />
              <Panel>
                <div className="space-y-4">
                  {analysis.targets.map((t) => {
                    // Company mode compares one company figure against every slab;
                    // brand mode compares each brand's own net purchases.
                    const companyNet =
                      k.netPurchaseBeforeTax ?? k.purchased2026 / (1 + vatPct / 100);
                    const net =
                      analysis.targetMode === "brand"
                        ? (analysis.brands.find(
                            (b) => b.brand === normalizeBrand(t.name),
                          )?.purchased2026 ?? 0) / (1 + vatPct / 100)
                        : companyNet;
                    const p = t.annual > 0 ? (net / t.annual) * 100 : 0;
                    return (
                      <div key={t.name}>
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <span className="font-medium">{t.name}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {compact(net)} / {compact(t.annual)} EGP ·{" "}
                            <b className={cn(p >= 100 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>
                              {p.toFixed(1)}%
                            </b>
                          </span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full transition-[width] duration-700",
                              p >= 100 ? "bg-emerald-500" : "bg-primary",
                            )}
                            style={{ width: `${Math.min(100, p)}%` }}
                          />
                        </div>

                        {/* Company-total buy suggestion for this slab. */}
                        {(() => {
                          const sp = slabPlans.find((s) => s.name === t.name);
                          if (!sp) return null;
                          const style =
                            sp.direction === "increase"
                              ? {
                                  cls: "border-amber-500/30 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300",
                                  Icon: TrendingUp,
                                }
                              : sp.direction === "decrease"
                                ? {
                                    cls: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300",
                                    Icon: ArrowDownRight,
                                  }
                                : {
                                    cls: "border-border bg-muted/40 text-muted-foreground",
                                    Icon: Minus,
                                  };
                          return (
                            <div
                              className={cn(
                                "mt-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
                                style.cls,
                              )}
                            >
                              <style.Icon className="mt-0.5 size-3.5 shrink-0" />
                              <span>{sp.suggestion}</span>
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
                {analysis.targetMode === "company" && (
                  <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                    Suggestions assume {monthsElapsed} months of data (
                    {Math.max(0, 12 - monthsElapsed)} left) — change it in Part 2.
                    Figures are net of {vatPct}% tax; the incl.-tax amount is what
                    you actually order.
                  </p>
                )}
              </Panel>
            </section>
          )}

          {/* Part 2 — Brand-level Q4 plan */}
          {plan.length > 0 && (
            <section>
              <SectionHeader
                icon={Target}
                eyebrow="Part 2"
                title="Brand-level plan for Q4"
                desc={
                  analysis.targetMode === "brand"
                    ? "Each brand's own target (from the file) vs its current ordering pace for Q4."
                    : "The company target is split across brands by share, then each brand's needed Q4 pace is compared to its current pace."
                }
              />

              {analysis.targetMode === "brand" && (
                <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
                  This file lists a target per brand, so the plan uses the real
                  targets directly — no splitting or estimate.
                </div>
              )}

              {/* Controls */}
              <div className="mb-4 flex flex-wrap items-end gap-4 rounded-2xl border border-border bg-card p-4 text-sm">
                {analysis.targetMode !== "brand" && (
                  <>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">
                        Company target
                      </span>
                      <select
                        value={slabIdx}
                        onChange={(e) => setSlabIdx(Number(e.target.value))}
                        className="h-9 rounded-lg border border-border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      >
                        {analysis.targets.map((t, i) => (
                          <option key={t.name} value={i}>
                            {t.name} — {compact(t.annual)} EGP
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">
                        Split target by
                      </span>
                      <select
                        value={basis}
                        onChange={(e) => setBasis(e.target.value as PlanBasis)}
                        className="h-9 rounded-lg border border-border bg-background px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      >
                        <option value="sales">Sales share</option>
                        <option value="purchases">Purchases share</option>
                      </select>
                    </label>
                  </>
                )}
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Months of data</span>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={monthsElapsed}
                    onChange={(e) => setMonthsElapsed(Number(e.target.value))}
                    className="h-9 w-24 rounded-lg border border-border bg-background px-2 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">VAT %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={vatPct}
                    onChange={(e) => setVatPct(Number(e.target.value))}
                    className="h-9 w-24 rounded-lg border border-border bg-background px-2 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                  />
                </label>
              </div>

              {/* Scorecard cards */}
              <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {plan.map((p) => {
                  const tone = STATUS_STYLE[p.status];
                  return (
                    <div
                      key={p.brand}
                      className={cn("rounded-2xl border border-border border-t-4 bg-card p-4", tone.bar)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-base font-semibold" dir="auto">
                          {p.brand}
                        </h3>
                        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", tone.chip)}>
                          {tone.label}
                        </span>
                      </div>
                      <div className="mt-2 flex items-baseline gap-2">
                        <span className="text-3xl font-bold tracking-tight tabular-nums">
                          {Math.round(p.attainmentPct)}%
                        </span>
                        <span className="text-xs text-muted-foreground">
                          of allocated target bought
                        </span>
                      </div>
                      <div className={cn("text-xs font-medium", tone.text)}>
                        {p.pctChange > 0
                          ? `needs +${p.pctChange.toFixed(0)}% more per month for Q4`
                          : `ordering ${Math.abs(p.pctChange).toFixed(0)}% above the Q4 need`}
                      </div>
                      <dl className="mt-3 space-y-1 text-xs">
                        {(
                          [
                            ["Stock cover", `${p.coverMonths.toFixed(1)} months`],
                            ["Stock on hand", `${egp(p.stockUnits)} units`],
                            ["Current pace / mo", `${compact(p.currentMonthlyPace)} EGP`],
                            ["Needed / mo (Q4)", `${compact(p.neededMonthly)} EGP`],
                          ] as [string, string][]
                        ).map(([kk, vv]) => (
                          <div key={kk} className="flex justify-between border-t border-border/50 pt-1">
                            <dt className="text-muted-foreground">{kk}</dt>
                            <dd className="tabular-nums">{vv}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  );
                })}
              </div>

              {/* Plan table */}
              <Panel>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[54rem] text-sm">
                    <thead>
                      <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-3 py-2 text-left font-medium">Brand</th>
                        <th className="px-3 py-2 text-right font-medium">
                          Sell-in YTD (net)
                        </th>
                        <th className="px-3 py-2 text-right font-medium">Sold YoY</th>
                        <th className="px-3 py-2 text-right font-medium">Cover</th>
                        <th className="px-3 py-2 text-left font-medium">Status</th>
                        <th className="px-3 py-2 text-left font-medium">What to do</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.map((p) => {
                        const tone = STATUS_STYLE[p.status];
                        return (
                          <tr
                            key={p.brand}
                            className="border-b border-border/50 align-top last:border-0"
                          >
                            <td className="px-3 py-3.5 font-medium" dir="auto">
                              {p.brand}
                            </td>
                            <td className="px-3 py-3.5 text-right tabular-nums">
                              {egp(p.sellInNet)}
                            </td>
                            <td className="px-3 py-3.5 text-right">
                              <DeltaChip value={p.soldGrowthPct} />
                            </td>
                            <td className="whitespace-nowrap px-3 py-3.5 text-right tabular-nums text-muted-foreground">
                              {p.coverMonths.toFixed(1)}m
                            </td>
                            <td className="px-3 py-3.5">
                              <span
                                className={cn(
                                  "inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                  tone.chip,
                                )}
                              >
                                {tone.label}
                              </span>
                            </td>
                            <td className="min-w-[18rem] px-3 py-3.5 leading-relaxed text-muted-foreground">
                              {p.move}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </section>
          )}
        </div>
      )}

      {churn && analysis && (
        <ItemListModal
          kind={churn}
          items={churn === "new" ? analysis.newItems : analysis.discItems}
          onClose={() => setChurn(null)}
        />
      )}
    </div>
  );
}
