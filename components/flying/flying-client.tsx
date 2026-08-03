"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
  Plane,
  Filter,
  StickyNote,
  Download,
  ArrowDownWideNarrow,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { monthLabel } from "@/lib/dates";
import { parseHtmlTable } from "@/lib/tasfya/parseTable";
import { parseSupplyOrders } from "@/lib/tasfya/supplyOrders";
import { bonusPercent } from "@/lib/tasfya/report";
import { DEFAULT_DISTRIBUTORS, parseCell } from "@/lib/tasfya/flying";

type Column = { id: string; name: string };
type Row = {
  code: string;
  name: string;
  order: number;
  cells: Record<string, string>;
  note?: string;
  remainingOverride?: number | null;
};

let idSeq = 0;
const newId = () => `c${Date.now().toString(36)}${(idSeq++).toString(36)}`;

// الباقى for a row — a signed balance. The بونص (bounce) is free extra, so it
// helps cover the order but is NOT counted as over-buying:
//   > 0  → the paid quantity ALONE exceeds the order (real over-purchase → "+N")
//   = 0  → order covered (qty, or qty + bounce, reaches the ordered amount)
//   < 0  → still short by that much, even counting the bounce (shown as "-N")
function remainingOf(row: Row, columns: Column[]): number {
  let base = 0;
  let bounce = 0;
  for (const c of columns) {
    const v = parseCell(row.cells[c.id]);
    base += v.base;
    bounce += v.bounce;
  }
  if (base > row.order) return base - row.order; // over-bought on paid qty
  const taken = base + bounce;
  if (taken >= row.order) return 0; // covered (bounce filled the gap)
  return taken - row.order; // still short
}

// Effective الباقى: a manual override, when present, wins over the computed one.
function effRemaining(row: Row, columns: Column[]): number {
  return typeof row.remainingOverride === "number"
    ? row.remainingOverride
    : remainingOf(row, columns);
}

function remainingClass(rem: number): string {
  if (rem < 0) return "text-red-600 dark:text-red-400 font-semibold";
  if (rem === 0) return "text-emerald-600 dark:text-emerald-400 font-semibold";
  return "text-yellow-500 dark:text-yellow-400 font-semibold";
}

// Format the signed الباقى balance: surplus gets an explicit "+", shortfall keeps
// its natural "-", exact shows plain 0.
function fmtBalance(v: number): string {
  return (v > 0 ? "+" : "") + v.toLocaleString("en-US");
}

/* ------------------------------------------------------------------ */
/* Small self-contained popover, portalled to <body> so the sticky /   */
/* overflow-auto table never clips it.                                 */
/* ------------------------------------------------------------------ */
function AnchoredPanel({
  triggerRef,
  open,
  onClose,
  children,
  align = "start",
}: {
  triggerRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(
    null,
  );
  React.useLayoutEffect(() => {
    if (!open) return;
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: align === "end" ? r.right : r.left });
  }, [open, triggerRef, align]);

  if (!open || !pos) return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 rounded-lg border border-border bg-card p-2 text-foreground shadow-xl"
        style={{
          top: pos.top,
          left: pos.left,
          transform: align === "end" ? "translateX(-100%)" : undefined,
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Excel-style per-column filter: a funnel button opening a checkbox    */
/* list of the column's distinct values, with search + all/clear.       */
/* ------------------------------------------------------------------ */
function ColumnFilter({
  values,
  selected,
  onChange,
  align = "start",
}: {
  values: string[];
  selected: Set<string> | undefined;
  onChange: (next: Set<string> | null) => void;
  align?: "start" | "end";
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const ref = React.useRef<HTMLButtonElement>(null);
  const active = selected != null;
  const current = selected ?? new Set(values);
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? values.filter((v) => (v || "(فارغ)").toLowerCase().includes(needle))
    : values;

  const toggle = (v: string) => {
    const next = new Set(current);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next.size === values.length ? null : next);
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="فلترة"
        aria-label="Filter column"
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded",
          active
            ? "bg-primary/15 text-primary"
            : "text-muted-foreground/50 hover:bg-muted hover:text-foreground",
        )}
      >
        <Filter className="size-3.5" />
      </button>
      <AnchoredPanel
        triggerRef={ref}
        open={open}
        onClose={() => setOpen(false)}
        align={align}
      >
        <div className="flex w-56 flex-col gap-2">
          <input
            autoFocus
            value={q}
            dir="auto"
            onChange={(e) => setQ(e.target.value)}
            placeholder="بحث…"
            className="h-8 rounded border border-border bg-background px-2 text-xs outline-none focus:border-ring"
          />
          <div className="flex items-center justify-between text-[11px]">
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => onChange(null)}
            >
              تحديد الكل
            </button>
            <button
              type="button"
              className="text-muted-foreground hover:underline"
              onClick={() => onChange(new Set())}
            >
              مسح
            </button>
          </div>
          <div className="max-h-56 divide-y divide-border/60 overflow-auto rounded border border-border">
            {shown.length === 0 ? (
              <div className="p-2 text-center text-xs text-muted-foreground">
                لا توجد قيم
              </div>
            ) : (
              shown.map((v) => (
                <label
                  key={v}
                  className="flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={current.has(v)}
                    onChange={() => toggle(v)}
                    className="size-3.5 shrink-0 accent-primary"
                  />
                  <span dir="auto" className="truncate">
                    {v === "" ? "(فارغ)" : v}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>
      </AnchoredPanel>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Note button shown next to the code; amber when a note exists.        */
/* ------------------------------------------------------------------ */
function NoteCell({
  code,
  note,
  onChange,
}: {
  code: string;
  note: string;
  onChange: (n: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(note);
  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (open) setDraft(note);
  }, [open, note]);
  const has = note.trim().length > 0;

  return (
    <div className="flex items-center justify-center gap-1.5">
      <span className="font-medium tabular-nums">{code}</span>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={has ? note : "إضافة ملاحظة"}
        aria-label={has ? "Edit note" : "Add note"}
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded transition-colors",
          has
            ? "text-amber-500 hover:bg-amber-500/10"
            : "text-muted-foreground/30 hover:bg-muted hover:text-muted-foreground",
        )}
      >
        <StickyNote className="size-3.5" />
      </button>
      <AnchoredPanel triggerRef={ref} open={open} onClose={() => setOpen(false)}>
        <div className="flex w-64 flex-col gap-2">
          <textarea
            autoFocus
            rows={4}
            dir="auto"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="اكتب ملاحظة لهذا الصنف…"
            className="w-full resize-none rounded border border-border bg-background p-2 text-xs outline-none focus:border-ring"
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
            >
              <Trash2 className="size-3.5" /> حذف
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(draft.trim());
                setOpen(false);
              }}
              className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              حفظ
            </button>
          </div>
        </div>
      </AnchoredPanel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Click-to-edit numeric cell (used for الكمية and الباقى). Displays a   */
/* formatted, colored value; click turns it into an input.              */
/* ------------------------------------------------------------------ */
function EditableCell({
  display,
  editValue,
  colorClass,
  clearable,
  title,
  onCommit,
}: {
  display: React.ReactNode;
  editValue: string;
  colorClass?: string;
  clearable?: boolean;
  title?: string;
  onCommit: (v: number | null) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");

  const start = () => {
    setDraft(editValue);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const t = draft.trim().replace(/,/g, "");
    if (t === "") {
      if (clearable) onCommit(null);
      return;
    }
    const n = Number(t);
    if (Number.isFinite(n)) onCommit(n);
  };

  if (editing) {
    return (
      <input
        autoFocus
        size={1}
        value={draft}
        inputMode="numeric"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            setEditing(false);
          }
        }}
        className="h-8 w-full min-w-0 border-0 bg-primary/5 px-2 text-center text-sm tabular-nums outline-none ring-2 ring-inset ring-ring"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={start}
      title={title ?? "اضغط للتعديل"}
      className={cn(
        "block w-full cursor-text whitespace-nowrap px-2 py-1 text-center text-sm tabular-nums hover:bg-muted/60",
        colorClass,
      )}
    >
      {display}
    </button>
  );
}

export function FlyingClient() {
  const params = useSearchParams();
  const month = params.get("month") ?? "";
  const company = (params.get("company") ?? "").trim();

  const [loading, setLoading] = React.useState(true);
  const [importing, setImporting] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  const [supplier, setSupplier] = React.useState("");
  const [referenceDate, setReferenceDate] = React.useState("");
  const [orderNumber, setOrderNumber] = React.useState("");
  const [columns, setColumns] = React.useState<Column[]>([]);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [filters, setFilters] = React.useState<Record<string, Set<string>>>({});
  const [negativeOnly, setNegativeOnly] = React.useState(false);

  const fileRef = React.useRef<HTMLInputElement>(null);

  const monthValid = /^\d{4}-\d{2}$/.test(month);

  // Load any previously saved sheet for this company/month.
  React.useEffect(() => {
    if (!monthValid || !company) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/flying?month=${encodeURIComponent(month)}&company=${encodeURIComponent(company)}`,
        );
        if (!res.ok) throw new Error();
        const data = await res.json();
        const sheet = data.sheet;
        if (active && sheet) {
          setSupplier(sheet.supplier ?? "");
          setReferenceDate(sheet.referenceDate ?? "");
          setOrderNumber(sheet.orderNumber ?? "");
          setColumns(
            (sheet.columns ?? []).map((c: Column) => ({
              id: c.id,
              name: c.name ?? "",
            })),
          );
          setRows(
            (sheet.rows ?? []).map((r: Row) => ({
              code: r.code ?? "",
              name: r.name ?? "",
              order: Number(r.order) || 0,
              cells:
                r.cells && typeof r.cells === "object" ? { ...r.cells } : {},
              note: typeof r.note === "string" ? r.note : "",
              remainingOverride:
                typeof r.remainingOverride === "number"
                  ? r.remainingOverride
                  : null,
            })),
          );
        }
      } catch {
        if (active) toast.error("Couldn't load the flying sheet");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [month, company, monthValid]);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/\.html?$/i.test(file.name)) {
      toast.error("Choose a .htm / .html supply-order file.");
      return;
    }
    if (
      rows.length > 0 &&
      !window.confirm(
        "Importing will replace the current items on this sheet. Continue?",
      )
    ) {
      return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      const orders = parseSupplyOrders(parseHtmlTable(text));
      const items = orders.flatMap((o) => o.items);
      if (items.length === 0) {
        toast.error("No order items were found in that file.");
        return;
      }
      const dates = orders.map((o) => o.date).filter(Boolean).sort();
      const suppliers = [
        ...new Set(orders.map((o) => o.supplier).filter(Boolean)),
      ];
      const numbers = [
        ...new Set(orders.map((o) => o.orderNumber).filter(Boolean)),
      ];
      setRows(
        items.map((it) => ({
          code: it.code,
          name: it.name,
          order: it.order,
          cells: {},
          note: "",
          remainingOverride: null,
        })),
      );
      setFilters({});
      // Seed the distributor columns from the template if none exist yet.
      setColumns((prev) =>
        prev.length > 0
          ? prev
          : DEFAULT_DISTRIBUTORS.map((name) => ({ id: newId(), name })),
      );
      setSupplier(suppliers.join(", "));
      setReferenceDate(dates[0] ?? "");
      setOrderNumber(numbers.join(", "));
      setDirty(true);
      toast.success(`Imported ${items.length} item(s)`);
    } catch {
      toast.error("Couldn't read that file.");
    } finally {
      setImporting(false);
    }
  }

  function setCell(rowIndex: number, colId: string, value: string) {
    setRows((prev) =>
      prev.map((r, i) =>
        i === rowIndex ? { ...r, cells: { ...r.cells, [colId]: value } } : r,
      ),
    );
    setDirty(true);
  }

  function setOrder(rowIndex: number, value: number) {
    setRows((prev) =>
      prev.map((r, i) =>
        i === rowIndex ? { ...r, order: Math.max(0, Math.trunc(value)) } : r,
      ),
    );
    setDirty(true);
  }

  function setRemainingOverride(rowIndex: number, value: number | null) {
    setRows((prev) =>
      prev.map((r, i) =>
        i === rowIndex
          ? {
              ...r,
              remainingOverride: value == null ? null : Math.trunc(value),
            }
          : r,
      ),
    );
    setDirty(true);
  }

  function setNote(rowIndex: number, note: string) {
    setRows((prev) =>
      prev.map((r, i) => (i === rowIndex ? { ...r, note } : r)),
    );
    setDirty(true);
  }

  function renameColumn(id: string, name: string) {
    setColumns((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
    setDirty(true);
  }

  function addColumn() {
    setColumns((prev) => [...prev, { id: newId(), name: "" }]);
    setDirty(true);
  }

  function removeColumn(id: string) {
    setColumns((prev) => prev.filter((c) => c.id !== id));
    setRows((prev) =>
      prev.map((r) => {
        if (!(id in r.cells)) return r;
        const next = { ...r.cells };
        delete next[id];
        return { ...r, cells: next };
      }),
    );
    setFilters((prev) => {
      if (!(id in prev)) return prev;
      const cp = { ...prev };
      delete cp[id];
      return cp;
    });
    setDirty(true);
  }

  function setFilter(key: string, next: Set<string> | null) {
    setFilters((prev) => {
      const cp = { ...prev };
      if (next == null) delete cp[key];
      else cp[key] = next;
      return cp;
    });
  }

  async function save() {
    if (!monthValid || !company) {
      toast.error("Missing month or company.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/flying", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          company,
          supplier,
          referenceDate,
          orderNumber,
          columns,
          rows,
        }),
      });
      if (!res.ok) throw new Error();
      setDirty(false);
      toast.success("Flying sheet saved");
    } catch {
      toast.error("Couldn't save the sheet");
    } finally {
      setSaving(false);
    }
  }

  // The display string of a row for a given column key (used for both the
  // filter's distinct-value list and the filter test itself).
  const colValue = React.useCallback(
    (key: string, row: Row): string => {
      switch (key) {
        case "code":
          return row.code;
        case "name":
          return row.name;
        case "order":
          return String(row.order);
        case "remaining":
          return fmtBalance(effRemaining(row, columns));
        default:
          return (row.cells[key] ?? "").trim();
      }
    },
    [columns],
  );

  // Distinct values per column, numeric-aware sorted, for the filter dropdowns.
  const distinct = React.useMemo(() => {
    const keys = ["code", "name", "order", "remaining", ...columns.map((c) => c.id)];
    const cmp = (a: string, b: string) => {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b, "ar");
    };
    const m: Record<string, string[]> = {};
    for (const k of keys) {
      const s = new Set<string>();
      for (const r of rows) s.add(colValue(k, r));
      m[k] = [...s].sort(cmp);
    }
    return m;
  }, [rows, columns, colValue]);

  const passes = React.useCallback(
    (row: Row) => {
      for (const [key, set] of Object.entries(filters)) {
        if (!set.has(colValue(key, row))) return false;
      }
      return true;
    },
    [filters, colValue],
  );

  const visible = React.useMemo(
    () =>
      rows
        .map((row, i) => ({ row, i }))
        .filter(
          ({ row }) =>
            passes(row) &&
            (!negativeOnly || effRemaining(row, columns) < 0),
        ),
    [rows, passes, negativeOnly, columns],
  );

  const anyFilter = Object.keys(filters).length > 0 || negativeOnly;

  // Export the currently visible rows to an .xlsx: code, name, الباقى.
  async function exportExcel() {
    if (visible.length === 0) {
      toast.error("No rows to export.");
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const data = visible.map(({ row }) => ({
        الكود: row.code,
        "اسم الصنف": row.name,
        الباقى: effRemaining(row, columns),
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      ws["!cols"] = [{ wch: 12 }, { wch: 44 }, { wch: 10 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "الباقى");
      const safe = `${company}-${month}`.replace(/[^\w.-]+/g, "_");
      XLSX.writeFile(wb, `flying-${safe}.xlsx`);
    } catch {
      toast.error("Couldn't export the sheet.");
    }
  }

  // Column totals (base + bounce) across the *visible* rows, for the footer.
  const totals = React.useMemo(() => {
    const map = new Map<string, { base: number; bounce: number }>();
    for (const c of columns) map.set(c.id, { base: 0, bounce: 0 });
    for (const { row } of visible) {
      for (const c of columns) {
        const { base, bounce } = parseCell(row.cells[c.id]);
        const t = map.get(c.id)!;
        t.base += base;
        t.bounce += bounce;
      }
    }
    return map;
  }, [columns, visible]);

  const totalOrder = React.useMemo(
    () => visible.reduce((s, { row }) => s + row.order, 0),
    [visible],
  );
  const totalRemaining = React.useMemo(
    () => visible.reduce((s, { row }) => s + effRemaining(row, columns), 0),
    [visible, columns],
  );

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (!monthValid || !company) {
    return (
      <div className="p-6 text-sm text-destructive">
        Missing or invalid month/company in the URL.
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[120rem] space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Plane className="size-6 text-primary" />
            Flying tasfya
          </h1>
          <p className="text-sm text-muted-foreground">
            <span dir="auto" className="font-medium text-foreground">
              {company}
            </span>{" "}
            · {monthLabel(month)}
            {supplier && ` · ${supplier}`}
            {orderNumber && ` · #${orderNumber}`}
            {referenceDate && ` · ${referenceDate}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={importing}
            onClick={() => fileRef.current?.click()}
          >
            {importing ? <Loader2 className="animate-spin" /> : <Upload />}
            {rows.length > 0 ? "Re-import htm" : "Import htm"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".htm,.html"
            className="hidden"
            onChange={onPickFile}
          />
          <Button type="button" onClick={save} disabled={saving || !dirty}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Import the supply-order <code>.htm</code> for this order to build the
            worksheet — each line becomes a row (code, item name, ordered qty).
          </p>
          <div className="mt-4 flex justify-center">
            <Button
              type="button"
              disabled={importing}
              onClick={() => fileRef.current?.click()}
            >
              {importing ? <Loader2 className="animate-spin" /> : <Upload />}
              Import htm
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>
              {anyFilter ? `${visible.length} / ${rows.length}` : rows.length}{" "}
              item(s)
            </span>
            <span>· ordered {totalOrder.toLocaleString("en-US")}</span>
            <span>
              · remaining{" "}
              <span className={remainingClass(totalRemaining)}>
                {fmtBalance(totalRemaining)}
              </span>
            </span>
            {anyFilter && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilters({});
                  setNegativeOnly(false);
                }}
              >
                <X className="size-4" /> Clear filters
              </Button>
            )}
            <Button
              type="button"
              variant={negativeOnly ? "default" : "outline"}
              size="sm"
              className="ml-auto"
              onClick={() => setNegativeOnly((v) => !v)}
              title="Show only items whose الباقى is negative (still short)"
            >
              <ArrowDownWideNarrow className="size-4" /> Negative only
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={exportExcel}
            >
              <Download className="size-4" /> Export Excel
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addColumn}
            >
              <Plus className="size-4" /> Add distributor
            </Button>
          </div>

          <div className="max-h-[75vh] overflow-auto rounded-md border border-border shadow-sm">
            <table className="w-full border-collapse text-sm [&_td]:border [&_td]:border-border [&_th]:border [&_th]:border-border">
              <thead className="sticky top-0 z-20">
                <tr className="bg-muted text-left">
                  <th className="sticky left-0 z-10 w-[7rem] whitespace-nowrap bg-muted px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                    <div className="flex items-center justify-center gap-1">
                      <span>الكود</span>
                      <ColumnFilter
                        values={distinct.code ?? []}
                        selected={filters.code}
                        onChange={(n) => setFilter("code", n)}
                      />
                    </div>
                  </th>
                  <th className="sticky left-[7rem] z-10 min-w-[30rem] whitespace-nowrap bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                    <div className="flex items-center justify-center gap-1">
                      <span>اسم الصنف</span>
                      <ColumnFilter
                        values={distinct.name ?? []}
                        selected={filters.name}
                        onChange={(n) => setFilter("name", n)}
                      />
                    </div>
                  </th>
                  <th className="w-[6.5rem] whitespace-nowrap bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                    <div className="flex items-center justify-center gap-1">
                      <span>الباقى</span>
                      <ColumnFilter
                        values={distinct.remaining ?? []}
                        selected={filters.remaining}
                        onChange={(n) => setFilter("remaining", n)}
                      />
                    </div>
                  </th>
                  <th className="w-[6.5rem] whitespace-nowrap bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                    <div className="flex items-center justify-center gap-1">
                      <span>الكمية</span>
                      <ColumnFilter
                        values={distinct.order ?? []}
                        selected={filters.order}
                        onChange={(n) => setFilter("order", n)}
                      />
                    </div>
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.id}
                      className="bg-muted p-0 align-middle font-semibold text-muted-foreground"
                    >
                      <div className="flex items-center gap-0.5 px-1 py-1">
                        <input
                          value={col.name}
                          dir="auto"
                          placeholder="اسم الموزع"
                          onChange={(e) => renameColumn(col.id, e.target.value)}
                          className="h-7 w-24 min-w-[5rem] rounded-sm border border-transparent bg-transparent px-1 text-center text-xs font-semibold outline-none hover:border-border focus:border-ring focus:bg-background"
                        />
                        <ColumnFilter
                          values={distinct[col.id] ?? []}
                          selected={filters[col.id]}
                          onChange={(n) => setFilter(col.id, n)}
                          align="end"
                        />
                        <button
                          type="button"
                          onClick={() => removeColumn(col.id)}
                          className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive"
                          title="Remove distributor column"
                          aria-label="Remove distributor column"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map(({ row, i }) => {
                  const eff = effRemaining(row, columns);
                  const overridden = typeof row.remainingOverride === "number";
                  return (
                    <tr
                      key={`${row.code}-${i}`}
                      className="bg-card even:bg-muted/30"
                    >
                      <td className="sticky left-0 z-10 w-[7rem] whitespace-nowrap bg-inherit px-2 py-1 text-center tabular-nums">
                        <NoteCell
                          code={row.code}
                          note={row.note ?? ""}
                          onChange={(n) => setNote(i, n)}
                        />
                      </td>
                      <td
                        className="sticky left-[7rem] z-10 min-w-[30rem] bg-inherit px-3 py-1 text-center"
                        dir="auto"
                      >
                        {row.name}
                      </td>
                      <td className="w-[6.5rem] p-0 align-middle">
                        <EditableCell
                          display={fmtBalance(eff)}
                          editValue={String(eff)}
                          colorClass={cn(
                            remainingClass(eff),
                            overridden && "underline decoration-dotted",
                          )}
                          clearable
                          title={
                            overridden
                              ? "قيمة يدوية — اتركها فارغة للحساب التلقائي"
                              : "اضغط للتعديل"
                          }
                          onCommit={(v) => setRemainingOverride(i, v)}
                        />
                      </td>
                      <td className="w-[6.5rem] p-0 align-middle">
                        <EditableCell
                          display={row.order.toLocaleString("en-US")}
                          editValue={String(row.order)}
                          onCommit={(v) => setOrder(i, v ?? 0)}
                        />
                      </td>
                      {columns.map((col) => {
                        const raw = row.cells[col.id] ?? "";
                        const { base, bounce } = parseCell(raw);
                        const bpct = bonusPercent(base + bounce, bounce);
                        return (
                          <td key={col.id} className="p-0 align-middle">
                            <input
                              value={raw}
                              inputMode="text"
                              placeholder=""
                              onChange={(e) =>
                                setCell(i, col.id, e.target.value)
                              }
                              title="Type a quantity, or quantity+bounce e.g. 100+10"
                              className="h-8 w-24 min-w-full border-0 bg-transparent px-2 text-center text-sm tabular-nums outline-none focus:bg-primary/5 focus:ring-2 focus:ring-inset focus:ring-ring"
                            />
                            {bounce > 0 && (
                              <div className="-mt-1 pb-0.5 text-center text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                +{bpct}% bounce
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-20">
                <tr className="bg-muted font-semibold">
                  <td className="sticky left-0 z-10 w-[7rem] bg-muted px-2 py-1.5 text-center">
                    Totals
                  </td>
                  <td className="sticky left-[7rem] z-10 min-w-[30rem] bg-muted px-3 py-1.5" />
                  <td
                    className={cn(
                      "w-[6.5rem] bg-muted px-3 py-1.5 text-center tabular-nums",
                      remainingClass(totalRemaining),
                    )}
                  >
                    {fmtBalance(totalRemaining)}
                  </td>
                  <td className="w-[6.5rem] bg-muted px-3 py-1.5 text-center tabular-nums">
                    {totalOrder.toLocaleString("en-US")}
                  </td>
                  {columns.map((col) => {
                    const t = totals.get(col.id) ?? { base: 0, bounce: 0 };
                    return (
                      <td
                        key={col.id}
                        className="bg-muted px-2 py-1.5 text-center tabular-nums"
                      >
                        {t.base.toLocaleString("en-US")}
                        {t.bounce > 0 && (
                          <div className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                            +{t.bounce.toLocaleString("en-US")} bounce
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            Tip: type <code>100</code> for a plain quantity, or{" "}
            <code>100+10</code> where the <code>+10</code> is bounce (بونص). In
            الباقى, a negative means the order is still short (bounce counts toward
            covering it), <code>0</code> means covered, and <code>+N</code> means
            the paid quantity alone went N over the order. Click الكمية or الباقى
            to edit (empty الباقى reverts to auto), the funnel on any header to
            filter, and the note icon to add a note.
          </p>
        </>
      )}
    </main>
  );
}
