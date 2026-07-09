"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Gift,
  Loader2,
  PackageCheck,
  Save,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/ui/data-table";
import type { Cell, DataRow } from "@/lib/dataset";
import {
  computeCodeBonus,
  computeCodeReceipts,
  computeInsights,
  computeQuarterlyTotals,
  CONTRACT_COLUMNS,
  CONTRACT_COLUMN_ORDER,
  extractStockCodes,
  MONTH_LABELS,
  parsePurchaseHtml,
  QUARTER_LABELS,
  QUARTER_TOTAL_LABEL,
  type CodeAggregate,
  type PurchaseRow,
} from "@/lib/contracts";
import {
  deleteContract,
  listContracts,
  loadContract,
  saveContract,
  type ContractMeta,
} from "@/lib/contracts-store";

const HTML_ACCEPT = ".htm,.html";
const isHtml = (f: File) => /\.html?$/i.test(f.name);

// The line table shows values exactly as parsed (no numeric rounding), so we
// pass an empty numeric-column set to DataTable.
const NO_NUMERIC = new Set<string>();

// Money columns carry an "(EGP)" header so it's clear the values are currency,
// while staying real numbers so DataTable keeps formatting and sorting them.
const CURRENCY = "EGP";
const Q_TABLE_LABELS = QUARTER_LABELS.map((q) => `${q} (${CURRENCY})`);
const TOTAL_TABLE_LABEL = `${QUARTER_TOTAL_LABEL} (${CURRENCY})`;
const QUARTERLY_TABLE_COLUMNS = [
  CONTRACT_COLUMNS.code,
  CONTRACT_COLUMNS.product,
  ...Q_TABLE_LABELS,
  TOTAL_TABLE_LABEL,
];
const QUARTERLY_NUMERIC = new Set<string>([...Q_TABLE_LABELS, TOTAL_TABLE_LABEL]);

type View = "lines" | "quarters";

// Horizontal bar list used for "spend by supplier" and "top items by spend".
function HBars({
  items,
  unit,
}: {
  items: { label: string; value: number; hint?: string }[];
  unit: string;
}) {
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground">No data.</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  return (
    <div className="space-y-2.5">
      {items.map((it) => (
        <div
          key={it.label}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3"
        >
          <div className="min-w-0">
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="truncate" dir="auto" title={it.hint ?? it.label}>
                {it.label}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {((it.value / total) * 100).toFixed(1)}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${(it.value / max) * 100}%` }}
              />
            </div>
          </div>
          <span className="whitespace-nowrap text-xs tabular-nums">
            {it.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}{" "}
            {unit}
          </span>
        </div>
      ))}
    </div>
  );
}

// Multi-select supplier filter (chips). Deselecting a supplier drops it from
// the aggregates below — same interaction as the Quarterly tab.
function SupplierChips({
  suppliers,
  excluded,
  onToggle,
  onSelectAll,
  onClear,
}: {
  suppliers: string[];
  excluded: Set<string>;
  onToggle: (name: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">
          Suppliers ({suppliers.length - excluded.size} of {suppliers.length}{" "}
          selected)
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onSelectAll}
            disabled={excluded.size === 0}
          >
            Select all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onClear}
            disabled={excluded.size === suppliers.length}
          >
            Clear
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2" dir="rtl">
        {suppliers.map((name) => {
          const isExcluded = excluded.has(name);
          return (
            <button
              key={name}
              type="button"
              onClick={() => onToggle(name)}
              aria-pressed={!isExcluded}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                isExcluded
                  ? "border-border text-muted-foreground line-through opacity-60 hover:opacity-100"
                  : "border-primary/40 bg-primary/10 text-foreground hover:bg-primary/20",
              )}
            >
              {name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type LineTab = "received" | "bonus";

// The "Purchase lines" view: after picking suppliers, show a per-code roll-up
// of received quantity (كمية الوارد) or bonus units (بونص). Clicking a code
// expands the individual purchase lines that make up its total.
function LinesView({
  rows,
  supplierFilter,
  onClear,
}: {
  rows: PurchaseRow[];
  supplierFilter: React.ReactNode;
  onClear: () => void;
}) {
  const [tab, setTab] = React.useState<LineTab>("received");
  const [openCode, setOpenCode] = React.useState<string | null>(null);

  const received = React.useMemo(() => computeCodeReceipts(rows), [rows]);
  const bonus = React.useMemo(() => computeCodeBonus(rows), [rows]);
  const aggregates: CodeAggregate[] = tab === "received" ? received : bonus;

  // Switching tabs / reloading data closes any expanded code.
  React.useEffect(() => setOpenCode(null), [tab, rows]);

  const keepForTab = React.useCallback(
    (r: PurchaseRow) =>
      tab === "received"
        ? Number(r[CONTRACT_COLUMNS.basic]) !== 100
        : Number(r[CONTRACT_COLUMNS.basic]) === 100,
    [tab],
  );

  const detailRows = React.useMemo<DataRow[]>(() => {
    if (!openCode) return [];
    return rows
      .filter((r) => r[CONTRACT_COLUMNS.code] === openCode && keepForTab(r))
      .map((r, i) => ({ ...r, __id: String(i) }));
  }, [openCode, rows, keepForTab]);

  const totalQty = React.useMemo(
    () => aggregates.reduce((a, b) => a + b.qty, 0),
    [aggregates],
  );

  const qtyLabel = tab === "received" ? "كمية الوارد" : "بونص (units)";
  const num = (v: number) =>
    v.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div className="space-y-4">
      {supplierFilter}

      {/* Sub-tab switch: received quantity vs. bonus units. */}
      <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5 text-sm">
        {(
          [
            ["received", "الوارد (Received qty)", PackageCheck],
            ["bonus", "بونص (Bonus)", Gift],
          ] as [LineTab, string, typeof PackageCheck][]
        ).map(([v, label, Icon]) => (
          <button
            key={v}
            type="button"
            onClick={() => setTab(v)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors",
              tab === v
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {aggregates.length.toLocaleString()} code
          {aggregates.length === 1 ? "" : "s"} · total {qtyLabel}:{" "}
          <b className="tabular-nums text-foreground">{num(totalQty)}</b>
        </p>
        <Button variant="outline" size="sm" onClick={onClear}>
          <X /> Clear
        </Button>
      </div>

      <div className="overflow-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-card">
            <tr className="text-center">
              <th className="w-8 border-b border-border px-2 py-2" />
              <th className="border-b border-border px-3 py-2 font-semibold">
                كود الصنف
              </th>
              <th className="border-b border-border px-3 py-2 text-start font-semibold">
                اسم الصنف
              </th>
              <th className="border-b border-border px-3 py-2 text-start font-semibold">
                المورد
              </th>
              <th className="border-b border-border px-3 py-2 font-semibold">
                {qtyLabel}
              </th>
              <th className="border-b border-border px-3 py-2 font-semibold">
                Lines
              </th>
            </tr>
          </thead>
          <tbody>
            {aggregates.map((a) => {
              const open = openCode === a.code;
              return (
                <React.Fragment key={a.code}>
                  <tr
                    onClick={() => setOpenCode(open ? null : a.code)}
                    className={cn(
                      "cursor-pointer border-b border-border transition-colors",
                      open ? "bg-primary/5" : "hover:bg-muted/40",
                    )}
                  >
                    <td className="px-2 py-2 text-center align-top text-muted-foreground">
                      {open ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </td>
                    <td className="px-3 py-2 text-center align-top tabular-nums font-medium">
                      {a.code}
                    </td>
                    <td className="px-3 py-2 text-start align-top" dir="auto">
                      {a.product || "—"}
                    </td>
                    <td
                      className="px-3 py-2 text-start align-top text-muted-foreground"
                      dir="auto"
                    >
                      {a.suppliers.length === 0
                        ? "—"
                        : a.suppliers.length === 1
                          ? a.suppliers[0]
                          : `${a.suppliers[0]} +${a.suppliers.length - 1}`}
                    </td>
                    <td className="px-3 py-2 text-center align-top tabular-nums font-semibold">
                      {num(a.qty)}
                    </td>
                    <td className="px-3 py-2 text-center align-top tabular-nums text-muted-foreground">
                      {a.lines.toLocaleString()}
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b border-border bg-muted/20">
                      <td colSpan={6} className="p-3">
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            Purchase lines for{" "}
                            <span className="text-foreground">{a.code}</span> —{" "}
                            {a.product}
                          </p>
                          <DataTable
                            key={`detail-${tab}-${a.code}`}
                            columns={CONTRACT_COLUMN_ORDER}
                            rows={detailRows}
                            numericColumns={NO_NUMERIC}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {aggregates.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-10 text-center text-muted-foreground"
                >
                  {tab === "received"
                    ? "No received quantities for the selected suppliers."
                    : "No bonus (بونص) lines for the selected suppliers."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ContractsClient() {
  // Live inputs
  const [purchaseRows, setPurchaseRows] = React.useState<PurchaseRow[]>([]);
  const [purchaseFiles, setPurchaseFiles] = React.useState<string[]>([]);
  const [stockCodes, setStockCodes] = React.useState<string[] | null>(null);
  const [stockFileName, setStockFileName] = React.useState<string | null>(null);

  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Set when a saved contract is open, so re-saving updates it in place. A
  // freshly built (unsaved) result leaves this null.
  const [currentId, setCurrentId] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<ContractMeta[]>([]);
  // Preserved counts when viewing a saved contract (stock file is not re-run).
  const [savedInfo, setSavedInfo] =
    React.useState<Pick<ContractMeta, "stockCodeCount" | "totalLineCount"> | null>(
      null,
    );

  const purchaseInputRef = React.useRef<HTMLInputElement>(null);
  const stockInputRef = React.useRef<HTMLInputElement>(null);

  const refreshSaved = React.useCallback(async () => {
    try {
      setSaved(await listContracts());
    } catch {
      // Local storage unavailable — saving just won't be offered.
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await listContracts();
        if (active) setSaved(list);
      } catch {
        // Local storage unavailable — saving just won't be offered.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const stockSet = React.useMemo(
    () => (stockCodes ? new Set(stockCodes) : null),
    [stockCodes],
  );

  // Purchase lines whose item code exists in the stock file. Before a stock
  // file is uploaded, everything parsed is shown as-is.
  const matchedRows = React.useMemo(() => {
    if (!stockSet) return purchaseRows;
    return purchaseRows.filter((r) => stockSet.has(r[CONTRACT_COLUMNS.code]));
  }, [purchaseRows, stockSet]);

  const [view, setView] = React.useState<View>("quarters");

  // Supplier filter (applied before the quarterly totals): every supplier is
  // included until the user deselects it.
  const [excludedSuppliers, setExcludedSuppliers] = React.useState<Set<string>>(
    new Set(),
  );
  // Quarters stay hidden until the user has reviewed suppliers and clicks Show.
  const [showQuarters, setShowQuarters] = React.useState(false);
  // Yearly buy target (as typed); drives the achieved/remaining readout.
  const [target, setTarget] = React.useState("");

  const suppliers = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of matchedRows) {
      const s = r[CONTRACT_COLUMNS.supplier];
      if (s) set.add(s);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ar"));
  }, [matchedRows]);

  const supplierFilteredRows = React.useMemo(
    () =>
      excludedSuppliers.size === 0
        ? matchedRows
        : matchedRows.filter(
            (r) => !excludedSuppliers.has(r[CONTRACT_COLUMNS.supplier]),
          ),
    [matchedRows, excludedSuppliers],
  );

  const toggleSupplier = (name: string) =>
    setExcludedSuppliers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  // Per-code buy totals split by quarter, bonus lines (أساسي = 100%) removed,
  // limited to the suppliers the user kept selected.
  const quarterly = React.useMemo(
    () => computeQuarterlyTotals(supplierFilteredRows),
    [supplierFilteredRows],
  );

  // Grand total per quarter (sum across all codes), for the bar chart.
  const quarterTotals = React.useMemo(() => {
    const t = [0, 0, 0, 0];
    for (const row of quarterly.totals)
      for (let i = 0; i < 4; i++) t[i] += row.quarters[i];
    return t.map((v) => Math.round(v * 100) / 100);
  }, [quarterly]);

  // Total achieved so far = all four quarters combined.
  const achieved = React.useMemo(
    () => Math.round(quarterTotals.reduce((a, b) => a + b, 0) * 100) / 100,
    [quarterTotals],
  );

  // Spend by supplier / top items / monthly trend / bonus, from the same
  // supplier-filtered lines.
  const insights = React.useMemo(
    () => computeInsights(supplierFilteredRows),
    [supplierFilteredRows],
  );

  const quarterlyRows = React.useMemo<DataRow[]>(
    () =>
      quarterly.totals.map((t, i) => ({
        __id: String(i),
        [CONTRACT_COLUMNS.code]: t.code,
        [CONTRACT_COLUMNS.product]: t.product,
        [Q_TABLE_LABELS[0]]: t.quarters[0],
        [Q_TABLE_LABELS[1]]: t.quarters[1],
        [Q_TABLE_LABELS[2]]: t.quarters[2],
        [Q_TABLE_LABELS[3]]: t.quarters[3],
        [TOTAL_TABLE_LABEL]: t.total,
      })),
    [quarterly],
  );

  const addPurchaseFiles = React.useCallback(async (files: File[]) => {
    const htmls = files.filter(isHtml);
    if (htmls.length === 0) {
      setError("Please choose .htm or .html purchase files.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const parsed: PurchaseRow[] = [];
      const names: string[] = [];
      for (const file of htmls) {
        const rows = await parsePurchaseHtml(await file.text(), file.name);
        if (rows.length === 0) {
          toast.warning(`No purchase lines found in ${file.name}`);
        }
        parsed.push(...rows);
        names.push(file.name);
      }
      // Adding files starts a fresh, unsaved result.
      setPurchaseRows((prev) => [...prev, ...parsed]);
      setPurchaseFiles((prev) => [...prev, ...names]);
      setCurrentId(null);
      setSavedInfo(null);
      setExcludedSuppliers(new Set());
      setShowQuarters(false);
      toast.success(
        `Loaded ${parsed.length} purchase line${parsed.length === 1 ? "" : "s"} from ${htmls.length} file${htmls.length === 1 ? "" : "s"}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read a purchase file.");
    } finally {
      setBusy(false);
    }
  }, []);

  const setStock = React.useCallback(async (file: File) => {
    if (!isHtml(file)) {
      setError("Please choose a .htm or .html stock file.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const codes = extractStockCodes(await file.text());
      setStockCodes(codes);
      setStockFileName(file.name);
      setCurrentId(null);
      setSavedInfo(null);
      setExcludedSuppliers(new Set());
      setShowQuarters(false);
      if (codes.length === 0) {
        toast.warning("No item codes were detected in the stock file.");
      } else {
        toast.success(`Detected ${codes.length} stock codes`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the stock file.");
    } finally {
      setBusy(false);
    }
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const rows: Cell[][] = matchedRows.map((r) =>
        CONTRACT_COLUMN_ORDER.map((c) => r[c] ?? ""),
      );
      const id = await saveContract({
        id: currentId ?? undefined,
        name,
        purchaseFileNames: purchaseFiles,
        stockFileName: stockFileName ?? "",
        stockCodeCount: stockCodes?.length ?? 0,
        totalLineCount: purchaseRows.length,
        columns: CONTRACT_COLUMN_ORDER,
        rows,
      });
      setCurrentId(id);
      await refreshSaved();
      toast.success("Saved to this PC");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const openSaved = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const c = await loadContract(id);
      if (!c) {
        toast.error("That contract is no longer saved");
        await refreshSaved();
        return;
      }
      // Rebuild records from stored values; the result is already filtered, so
      // clear the live stock filter and show the rows as-is.
      const rows: PurchaseRow[] = c.rows.map((values) =>
        Object.fromEntries(
          c.columns.map((col, ci) => [col, String(values[ci] ?? "")]),
        ),
      );
      setPurchaseRows(rows);
      setPurchaseFiles(c.purchaseFileNames);
      setStockCodes(null);
      setStockFileName(c.stockFileName || null);
      setSavedInfo({
        stockCodeCount: c.stockCodeCount,
        totalLineCount: c.totalLineCount,
      });
      setName(c.name);
      setCurrentId(c.id);
      setExcludedSuppliers(new Set());
      setShowQuarters(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't open that contract");
    } finally {
      setBusy(false);
    }
  };

  const removeSaved = async (id: string) => {
    try {
      await deleteContract(id);
      if (currentId === id) setCurrentId(null);
      await refreshSaved();
      toast.success("Deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete");
    }
  };

  const clearAll = () => {
    setPurchaseRows([]);
    setPurchaseFiles([]);
    setStockCodes(null);
    setStockFileName(null);
    setName("");
    setError(null);
    setCurrentId(null);
    setSavedInfo(null);
    setExcludedSuppliers(new Set());
    setShowQuarters(false);
    setTarget("");
    if (purchaseInputRef.current) purchaseInputRef.current.value = "";
    if (stockInputRef.current) stockInputRef.current.value = "";
  };

  const hasStock = stockCodes !== null;
  const hasData = purchaseRows.length > 0;
  // Results are only shown once BOTH a purchase file and a stock file are in —
  // or when viewing a saved contract (which already had both).
  const bothReady = hasData && (hasStock || savedInfo !== null);

  const targetNum = Number(target) || 0;
  const remaining = Math.round((targetNum - achieved) * 100) / 100;
  const targetPct =
    targetNum > 0 ? Math.min(100, (achieved / targetNum) * 100) : 0;
  const money = (v: number) =>
    `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${CURRENCY}`;

  // Run-rate projection: extrapolate the current pace to a full 12 months.
  const elapsedMonths = insights.lastMonthWithData + 1; // 0 when no data
  const projectedYear =
    elapsedMonths > 0
      ? Math.round((achieved / elapsedMonths) * 12 * 100) / 100
      : 0;
  const currentQuarter = Math.ceil(elapsedMonths / 3); // 1..4
  const remainingQuarters = Math.max(0, 4 - currentQuarter);
  const perRemainingQuarter =
    remaining > 0 && remainingQuarters > 0
      ? Math.round((remaining / remainingQuarters) * 100) / 100
      : 0;
  const totalLines = savedInfo?.totalLineCount ?? purchaseRows.length;
  const stockCount = savedInfo?.stockCodeCount ?? stockCodes?.length ?? 0;

  return (
    <div className="space-y-5">
      {/* Upload zones */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Purchase files */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length) addPurchaseFiles(files);
          }}
          onClick={() => purchaseInputRef.current?.click()}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/40"
        >
          <input
            ref={purchaseInputRef}
            type="file"
            accept={HTML_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) addPurchaseFiles(files);
            }}
          />
          <div className="rounded-full bg-muted p-3">
            <FileText className="size-6 text-primary" />
          </div>
          <p className="font-medium">Purchase invoice files</p>
          <p className="text-sm text-muted-foreground">
            Click or drag one or more .htm / .html files
          </p>
          {purchaseFiles.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {purchaseFiles.length} file{purchaseFiles.length === 1 ? "" : "s"} ·{" "}
              {purchaseRows.length.toLocaleString()} lines
            </p>
          )}
        </div>

        {/* Stock file */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) setStock(file);
          }}
          onClick={() => stockInputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
            hasStock
              ? "border-primary/50 bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/40",
          )}
        >
          <input
            ref={stockInputRef}
            type="file"
            accept={HTML_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setStock(file);
            }}
          />
          <div className="rounded-full bg-muted p-3">
            <Boxes className="size-6 text-primary" />
          </div>
          <p className="font-medium">Stock file</p>
          <p className="text-sm text-muted-foreground">
            Click or drag a .htm / .html file of item codes
          </p>
          {stockFileName && (
            <p className="text-xs text-muted-foreground">
              {stockFileName} · {stockCount.toLocaleString()} codes
            </p>
          )}
        </div>
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

      {/* Saved contracts */}
      {saved.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Clock className="size-4 text-muted-foreground" />
            Saved contracts ({saved.length})
          </div>
          <ul className="divide-y divide-border/60">
            {saved.map((c) => (
              <li
                key={c.id}
                className={cn(
                  "flex items-center gap-3 py-2",
                  c.id === currentId && "rounded-lg bg-primary/5 px-2",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(c.savedAt).toLocaleString()} ·{" "}
                    {c.matchedLineCount.toLocaleString()} of{" "}
                    {c.totalLineCount.toLocaleString()} lines matched
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => openSaved(c.id)}>
                  Open
                </Button>
                <button
                  type="button"
                  onClick={() => removeSaved(c.id)}
                  className="text-muted-foreground/60 transition-colors hover:text-destructive"
                  title="Delete saved contract"
                  aria-label="Delete saved contract"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Waiting on one of the two inputs. */}
      {!bothReady && (hasData || hasStock) && !busy && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {hasData
            ? "Purchase files loaded — now upload a stock file to see matched items."
            : "Stock file loaded — now upload one or more purchase invoice files."}
        </div>
      )}

      {bothReady && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name this contract"
              className="h-9 min-w-48 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <span className="flex items-center gap-1.5 px-1 text-sm text-muted-foreground">
              <CheckCircle2 className="size-4 text-primary" />
              {matchedRows.length.toLocaleString()} of{" "}
              {totalLines.toLocaleString()} lines · {stockCount.toLocaleString()}{" "}
              stock codes
            </span>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {currentId ? "Update saved" : "Save to PC"}
            </Button>
          </div>

          {/* View switch: quarterly buy totals per code, or the raw lines. */}
          <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5 text-sm">
            {(
              [
                ["quarters", "Quarterly totals"],
                ["lines", "Purchase lines"],
              ] as [View, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium transition-colors",
                  view === v
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {view === "quarters" ? (
            <>
              {/* Supplier filter — deselect suppliers to drop them before the
                  quarterly totals are computed. */}
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold">
                    Suppliers ({suppliers.length - excludedSuppliers.size} of{" "}
                    {suppliers.length} selected)
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExcludedSuppliers(new Set())}
                      disabled={excludedSuppliers.size === 0}
                    >
                      Select all
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExcludedSuppliers(new Set(suppliers))}
                      disabled={excludedSuppliers.size === suppliers.length}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2" dir="rtl">
                  {suppliers.map((name) => {
                    const excluded = excludedSuppliers.has(name);
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => toggleSupplier(name)}
                        aria-pressed={!excluded}
                        className={cn(
                          "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                          excluded
                            ? "border-border text-muted-foreground line-through opacity-60 hover:opacity-100"
                            : "border-primary/40 bg-primary/10 text-foreground hover:bg-primary/20",
                        )}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>

                {!showQuarters && (
                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
                    <Button
                      onClick={() => setShowQuarters(true)}
                      disabled={excludedSuppliers.size === suppliers.length}
                    >
                      Show quarterly totals
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      Remove any suppliers you don&apos;t want, then show the
                      quarters.
                    </span>
                  </div>
                )}
              </div>

              {showQuarters && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Buy value = كمية الوارد × إجمالي تكلفة الوحدة, per calendar
                    quarter.{" "}
                    {quarterly.totals.length.toLocaleString()} items ·{" "}
                    {quarterly.bonusExcluded.toLocaleString()} bonus line
                    {quarterly.bonusExcluded === 1 ? "" : "s"} (أساسي = 100%)
                    excluded.
                  </p>

                  {/* Yearly target vs. what's achieved so far. */}
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <label
                        htmlFor="year-target"
                        className="text-sm font-semibold"
                      >
                        Year target
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id="year-target"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          value={target}
                          onChange={(e) => setTarget(e.target.value)}
                          placeholder="e.g. 1000000"
                          className="h-9 w-48 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                        />
                        <span className="text-sm text-muted-foreground">
                          {CURRENCY}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 text-sm">
                      <span className="text-muted-foreground">
                        Achieved:{" "}
                        <b className="tabular-nums text-foreground">
                          {money(achieved)}
                        </b>
                      </span>
                      {targetNum > 0 && (
                        <>
                          <span className="text-muted-foreground">
                            Remaining:{" "}
                            <b
                              className={cn(
                                "tabular-nums",
                                remaining > 0
                                  ? "text-foreground"
                                  : "text-primary",
                              )}
                            >
                              {remaining > 0
                                ? money(remaining)
                                : `Reached (+${money(-remaining)})`}
                            </b>
                          </span>
                          <span className="text-muted-foreground">
                            Progress:{" "}
                            <b className="tabular-nums text-foreground">
                              {targetPct.toFixed(1)}%
                            </b>
                          </span>
                        </>
                      )}
                    </div>

                    {targetNum > 0 && (
                      <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-500"
                          style={{ width: `${targetPct}%` }}
                        />
                      </div>
                    )}

                    {targetNum > 0 && elapsedMonths > 0 && (
                      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 border-t border-border pt-3 text-sm">
                        <span className="text-muted-foreground">
                          Projected year-end (at current pace):{" "}
                          <b
                            className={cn(
                              "tabular-nums",
                              projectedYear >= targetNum
                                ? "text-primary"
                                : "text-foreground",
                            )}
                          >
                            {money(projectedYear)}
                          </b>{" "}
                          {projectedYear >= targetNum ? "— on track" : "— behind"}
                        </span>
                        {remaining > 0 && remainingQuarters > 0 && (
                          <span className="text-muted-foreground">
                            Needed per remaining quarter ({remainingQuarters}):{" "}
                            <b className="tabular-nums text-foreground">
                              {money(perRemainingQuarter)}
                            </b>
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Total buy per quarter, bars side by side. */}
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="mb-4 text-sm font-semibold">
                      Total buy by quarter
                    </div>
                    <div className="flex items-end justify-around gap-4 sm:gap-8">
                      {quarterTotals.map((v, i) => {
                        const max = Math.max(...quarterTotals, 1);
                        const heightPx = Math.max(
                          v > 0 ? (v / max) * 180 : 0,
                          v > 0 ? 4 : 0,
                        );
                        return (
                          <div
                            key={QUARTER_LABELS[i]}
                            className="flex flex-1 flex-col items-center gap-2"
                          >
                            <span className="text-xs font-medium tabular-nums text-muted-foreground">
                              {v.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })}{" "}
                              {CURRENCY}
                            </span>
                            <div
                              className="w-full max-w-16 rounded-t-md bg-primary transition-[height] duration-500"
                              style={{ height: heightPx }}
                              title={v.toLocaleString()}
                            />
                            <span className="text-sm font-medium">
                              {QUARTER_LABELS[i]}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <DataTable
                    key={`q-${currentId ?? "live"}`}
                    columns={QUARTERLY_TABLE_COLUMNS}
                    rows={quarterlyRows}
                    numericColumns={QUARTERLY_NUMERIC}
                    rightToolbar={
                      <Button variant="outline" size="sm" onClick={clearAll}>
                        <X /> Clear
                      </Button>
                    }
                  />

                  {/* Spend by supplier + top items. */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="mb-3 text-sm font-semibold">
                        Spend by supplier
                      </div>
                      <HBars
                        items={insights.bySupplier.map((s) => ({
                          label: s.name,
                          value: s.value,
                        }))}
                        unit={CURRENCY}
                      />
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="mb-3 text-sm font-semibold">
                        Top 10 items by spend
                      </div>
                      <HBars
                        items={insights.topItems.slice(0, 10).map((t) => ({
                          label: t.product || t.code,
                          value: t.value,
                          hint: `${t.code} — ${t.product}`,
                        }))}
                        unit={CURRENCY}
                      />
                    </div>
                  </div>

                  {/* Monthly spend trend. */}
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="mb-4 text-sm font-semibold">
                      Monthly spend
                    </div>
                    <div className="flex items-end gap-1 sm:gap-2">
                      {insights.byMonth.map((v, i) => {
                        const max = Math.max(...insights.byMonth, 1);
                        const heightPx = Math.max(
                          v > 0 ? (v / max) * 140 : 0,
                          v > 0 ? 3 : 0,
                        );
                        return (
                          <div
                            key={MONTH_LABELS[i]}
                            className="flex flex-1 flex-col items-center gap-1"
                          >
                            <div
                              className="w-full rounded-t bg-primary/80 transition-[height] duration-500"
                              style={{ height: heightPx }}
                              title={`${MONTH_LABELS[i]}: ${money(v)}`}
                            />
                            <span className="text-[10px] text-muted-foreground">
                              {MONTH_LABELS[i]}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Bonus (بونص) received. */}
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="mb-1 text-sm font-semibold">
                      Bonus received (بونص)
                    </div>
                    <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm text-muted-foreground">
                      <span>
                        Value:{" "}
                        <b className="tabular-nums text-foreground">
                          {money(insights.bonusValue)}
                        </b>
                      </span>
                      <span>
                        Free units:{" "}
                        <b className="tabular-nums text-foreground">
                          {insights.bonusUnits.toLocaleString()}
                        </b>
                        {insights.paidUnits > 0 &&
                          ` (${(
                            (insights.bonusUnits / insights.paidUnits) *
                            100
                          ).toFixed(1)}% of paid units)`}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <LinesView
              rows={supplierFilteredRows}
              onClear={clearAll}
              supplierFilter={
                <SupplierChips
                  suppliers={suppliers}
                  excluded={excludedSuppliers}
                  onToggle={toggleSupplier}
                  onSelectAll={() => setExcludedSuppliers(new Set())}
                  onClear={() => setExcludedSuppliers(new Set(suppliers))}
                />
              }
            />
          )}
        </>
      )}
    </div>
  );
}
