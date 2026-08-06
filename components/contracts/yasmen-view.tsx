"use client";

import * as React from "react";
import { Download, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CONTRACT_COLUMNS, type PurchaseRow } from "@/lib/contracts";

// A saved preset of chosen codes, so a new upload auto-selects the same items.
const PRESET_KEY = "yasmen.selectedCodes";

type Column = { id: string; name: string };
type CodeInfo = { code: string; product: string; price: number };

const num = (s: string | undefined): number => {
  const n = Number((s ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

// Reverse a percent discount already baked into a value (e.g. peel back the
// إضافي/خاص discounts to recover سعر الصيدلي). No-op for 0 / out-of-range pct.
const undiscount = (v: number, pct: number) =>
  pct > 0 && pct < 100 ? v / (1 - pct / 100) : v;

const money = (v: number) =>
  v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const qtyFmt = (v: number) =>
  v.toLocaleString(undefined, { maximumFractionDigits: 2 });

// The image-shaped distributor value sheet. The user multi-clicks the codes to
// include, fills a quantity per distributor, and the sheet totals each item's
// quantity, multiplies by سعر الصيدلي, and grand-totals the value.
export function YasmenView({ rows }: { rows: PurchaseRow[] }) {
  // One catalog entry per code, with a representative سعر الصيدلي taken from the
  // item's سعر الوحدة شامل الضريبة (last priced line seen wins). The report's
  // price already has the إضافي (extra) and خاص (special) discounts deducted,
  // but سعر الصيدلي must ignore both — only the أساسي discount should affect it.
  // So we un-apply them: price ÷ (1 − إضافي%) ÷ (1 − خاص%).
  const catalog = React.useMemo<CodeInfo[]>(() => {
    const map = new Map<string, CodeInfo>();
    for (const r of rows) {
      const code = r[CONTRACT_COLUMNS.code];
      if (!code) continue;
      const incTax = num(r[CONTRACT_COLUMNS.priceIncTax]);
      // Skip bonus/zero-price lines so they don't clobber the real price.
      if (incTax <= 0) continue;
      // إضافي and خاص are percent discounts already baked into incTax; peel them
      // back off so only أساسي remains in سعر الصيدلي.
      const price = undiscount(
        undiscount(incTax, num(r[CONTRACT_COLUMNS.extra])),
        num(r[CONTRACT_COLUMNS.special]),
      );
      map.set(code, {
        code,
        product: r[CONTRACT_COLUMNS.product] || "",
        price,
      });
    }
    return [...map.values()].sort((a, b) =>
      a.product.localeCompare(b.product, "ar"),
    );
  }, [rows]);

  const infoByCode = React.useMemo(
    () => new Map(catalog.map((c) => [c.code, c])),
    [catalog],
  );

  // Which calendar quarter to sum (from تاريخ الحركة's month); "all" = whole
  // period. Lets the user tell Q1 buys apart from Q2, etc.
  const [quarter, setQuarter] = React.useState<"all" | 0 | 1 | 2 | 3>("all");

  // Received quantity (كمية الوارد) per code, per supplier — summed across the
  // item's purchase lines that fall in the selected quarter. Used to pre-fill
  // the distributor cells so a code with multiple buys shows its quantities.
  const receiptsByCode = React.useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const code = r[CONTRACT_COLUMNS.code];
      const supplier = (r[CONTRACT_COLUMNS.supplier] ?? "").trim();
      if (!code || !supplier) continue;
      if (quarter !== "all") {
        const dm = /\d{4}\/(\d{2})\/\d{2}/.exec(r[CONTRACT_COLUMNS.date] ?? "");
        if (!dm) continue;
        if (Math.ceil(Number(dm[1]) / 3) - 1 !== quarter) continue;
      }
      let bySupplier = map.get(code);
      if (!bySupplier) {
        bySupplier = new Map();
        map.set(code, bySupplier);
      }
      bySupplier.set(
        supplier,
        (bySupplier.get(supplier) ?? 0) + num(r[CONTRACT_COLUMNS.qty]),
      );
    }
    return map;
  }, [rows, quarter]);

  // Every distinct supplier (اسم المورد) found in the loaded data.
  const allSuppliers = React.useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const s = (r[CONTRACT_COLUMNS.supplier] ?? "").trim();
      if (s) set.add(s);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ar"));
  }, [rows]);

  // Suppliers the user toggled off — their column is dropped from the sheet.
  const [excludedSuppliers, setExcludedSuppliers] = React.useState<Set<string>>(
    new Set(),
  );

  // Distributor columns = the kept suppliers (id = name so cell data stays
  // stable when the filter changes).
  const columns = React.useMemo<Column[]>(
    () =>
      allSuppliers
        .filter((name) => !excludedSuppliers.has(name))
        .map((name) => ({ id: name, name })),
    [allSuppliers, excludedSuppliers],
  );

  const toggleSupplier = (name: string) =>
    setExcludedSuppliers((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  // The persistent master set of chosen codes (ordered) — the single source of
  // truth. Every pick is saved immediately (see updateSaved) and re-applied to
  // any new upload, so the sheet auto-builds for these codes with no manual
  // "save" step.
  const [savedCodes, setSavedCodes] = React.useState<string[]>([]);
  // code -> colId -> raw quantity string
  const [cells, setCells] = React.useState<
    Record<string, Record<string, string>>
  >({});
  // code -> سعر الصيدلي override (empty = use the catalog price)
  const [priceOverride, setPriceOverride] = React.useState<
    Record<string, string>
  >({});
  const [query, setQuery] = React.useState("");

  // Load the saved preset once on mount.
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(PRESET_KEY);
      if (raw) setSavedCodes(JSON.parse(raw) as string[]);
    } catch {
      // localStorage unavailable — presets just won't persist.
    }
  }, []);

  const catalogCodes = React.useMemo(
    () => new Set(catalog.map((c) => c.code)),
    [catalog],
  );

  // Rows to show = saved codes that exist in the current upload, in saved
  // order. Uploading new buy/stock files re-derives this automatically, so the
  // report regenerates for whichever saved codes the new files contain.
  const selected = React.useMemo(
    () => savedCodes.filter((c) => catalogCodes.has(c)),
    [savedCodes, catalogCodes],
  );

  // Mirror the master set to localStorage on every change — this is the "smart
  // save": picks persist instantly and survive uploads/reloads.
  const updateSaved = React.useCallback(
    (updater: (prev: string[]) => string[]) =>
      setSavedCodes((prev) => {
        const next = updater(prev);
        try {
          localStorage.setItem(PRESET_KEY, JSON.stringify(next));
        } catch {
          // localStorage unavailable — selection just won't persist.
        }
        return next;
      }),
    [],
  );

  const clearPreset = () => {
    try {
      localStorage.removeItem(PRESET_KEY);
    } catch {
      // ignore
    }
    setSavedCodes([]);
    toast.success("تم حذف كل الأصناف المحفوظة");
  };

  const toggleCode = (code: string) =>
    updateSaved((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );

  // Add every code in the current upload to the saved set (keeps already-saved
  // codes from other files).
  const selectAllShown = () =>
    updateSaved((prev) => [
      ...prev,
      ...catalog.map((c) => c.code).filter((c) => !prev.includes(c)),
    ]);

  // Deselect just the codes visible in this upload; saved codes from other
  // files stay put. Use "حذف المحفوظ" to wipe everything.
  const clearShown = () =>
    updateSaved((prev) => prev.filter((c) => !catalogCodes.has(c)));

  // One-tap "generate from new upload": the saved codes are already applied
  // (selected is derived), so this drops any leftover manual quantity/price
  // edits from the previous data set — the sheet then shows each saved code's
  // quantities and سعر الصيدلي straight from the file just uploaded.
  const loadFromUpload = () => {
    setCells({});
    setPriceOverride({});
    if (savedCodes.length === 0) {
      toast("لا توجد أصناف محفوظة بعد — اختر أصنافاً من القائمة أولاً");
      return;
    }
    const missing = savedCodes.length - selected.length;
    toast.success(
      `تم عرض ${selected.length} صنف ببيانات الملف الحالي` +
        (missing > 0 ? ` (${missing} صنف محفوظ غير موجود في هذا الملف)` : ""),
    );
  };

  const setCell = (code: string, colId: string, value: string) =>
    setCells((prev) => ({
      ...prev,
      [code]: { ...prev[code], [colId]: value },
    }));

  // Per-code helpers.
  const priceOf = (code: string): number => {
    const ov = priceOverride[code];
    if (ov !== undefined && ov.trim() !== "") return num(ov);
    return infoByCode.get(code)?.price ?? 0;
  };
  // Effective cell string for a code/supplier: the user's edit if present,
  // otherwise the received quantity from the data (blank when there is none).
  const cellValue = (code: string, colId: string): string => {
    const ov = cells[code]?.[colId];
    if (ov !== undefined) return ov;
    const qty = receiptsByCode.get(code)?.get(colId) ?? 0;
    return qty ? String(qty) : "";
  };
  const qtyOf = (code: string): number =>
    columns.reduce((s, c) => s + num(cellValue(code, c.id)), 0);
  const valueOf = (code: string): number => qtyOf(code) * priceOf(code);

  const grandTotal = React.useMemo(
    () => selected.reduce((s, code) => s + valueOf(code), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, columns, cells, priceOverride, infoByCode, receiptsByCode],
  );

  // Export the value sheet exactly as shown: code, product, one column per
  // distributor, total quantity, سعر الصيدلي, total value, plus a grand-total
  // row at the bottom.
  const exportExcel = async () => {
    if (selected.length === 0) {
      toast.error("اختر صنفاً واحداً على الأقل قبل التصدير");
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const data = selected.map((code) => {
        const info = infoByCode.get(code);
        const row: Record<string, string | number> = {
          الكود: code,
          الصنف: info?.product || "",
        };
        for (const col of columns) row[col.name] = num(cellValue(code, col.id));
        row["اجمالي الكمية"] = qtyOf(code);
        row["سعر الصيدلي"] = priceOf(code);
        row["اجمالي القيمة"] = valueOf(code);
        return row;
      });
      // Grand-total row.
      const totalRow: Record<string, string | number> = {
        الكود: "",
        الصنف: "اجمالي قيمة المسحوبات من الاصناف",
      };
      for (const col of columns) totalRow[col.name] = "";
      totalRow["اجمالي الكمية"] = "";
      totalRow["سعر الصيدلي"] = "";
      totalRow["اجمالي القيمة"] = grandTotal;
      data.push(totalRow);

      const ws = XLSX.utils.json_to_sheet(data);
      ws["!cols"] = Object.keys(data[0]).map((key) => {
        const width = data.reduce(
          (m, r) => Math.max(m, String(r[key] ?? "").length),
          key.length,
        );
        return { wch: Math.min(Math.max(width + 2, 8), 48) };
      });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "المسحوبات");
      const q = quarter === "all" ? "all" : `Q${quarter + 1}`;
      XLSX.writeFile(wb, `yasmen-${q}.xlsx`);
    } catch {
      toast.error("تعذّر تصدير الملف");
    }
  };

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? catalog.filter(
        (c) =>
          c.product.toLowerCase().includes(needle) || c.code.includes(needle),
      )
    : catalog;

  return (
    <div className="space-y-4">
      {/* Supplier toggles: turn a supplier off to drop its column. */}
      {allSuppliers.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">
              الموزّعون ({allSuppliers.length - excludedSuppliers.size} من{" "}
              {allSuppliers.length})
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExcludedSuppliers(new Set())}
                disabled={excludedSuppliers.size === 0}
              >
                تحديد الكل
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExcludedSuppliers(new Set(allSuppliers))}
                disabled={excludedSuppliers.size === allSuppliers.length}
              >
                مسح
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2" dir="rtl">
            {allSuppliers.map((name) => {
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
        </div>
      )}

      {/* Quarter selector — the distributor cells pre-fill from this quarter's
          received quantities (or the whole period). */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">
          الربع:
        </span>
        <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5 text-sm">
          {(
            [
              ["all", "الكل"],
              [0, "Q1"],
              [1, "Q2"],
              [2, "Q3"],
              [3, "Q4"],
            ] as ["all" | 0 | 1 | 2 | 3, string][]
          ).map(([v, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => setQuarter(v)}
              className={cn(
                "rounded-md px-3 py-1.5 font-medium transition-colors",
                quarter === v
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* One-tap regenerate: after uploading new buy/stock files, pull the
          saved codes and fill their data from the new upload. */}
      {savedCodes.length > 0 && catalog.length > 0 && (
        <Button
          onClick={loadFromUpload}
          className="w-full gap-2 sm:w-auto"
          title="جلب الأصناف المحفوظة وعرض كمياتها وأسعارها من الملف المرفوع حديثاً"
        >
          <RefreshCw className="size-4" />
          جلب الأصناف المحفوظة وعرض بياناتها من الملف الجديد
        </Button>
      )}

      {/* Code picker: multi-click the items to include in the sheet. */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold">
            اختر الأصناف ({selected.length} محدد)
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={selectAllShown}
              disabled={
                catalog.length > 0 && selected.length === catalog.length
              }
            >
              تحديد الكل
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={clearShown}
              disabled={selected.length === 0}
            >
              مسح
            </Button>
          </div>
        </div>

        {savedCodes.length > 0 && (
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {savedCodes.length} صنف محفوظ تلقائياً — يظهر منها{" "}
              {selected.length} في الملف الحالي، والباقي يظهر عند رفع ملفاته
            </span>
            <button
              type="button"
              onClick={clearPreset}
              className="inline-flex items-center gap-1 text-destructive hover:underline"
            >
              <Trash2 className="size-3.5" /> حذف المحفوظ
            </button>
          </div>
        )}

        <div className="relative mb-2">
          <Search className="pointer-events-none absolute start-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            dir="auto"
            onChange={(e) => setQuery(e.target.value)}
            placeholder="بحث بالكود أو اسم الصنف…"
            className="h-9 w-full rounded-lg border border-border bg-background ps-8 pe-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>

        <div
          className="max-h-64 divide-y divide-border/60 overflow-auto rounded-lg border border-border"
          dir="rtl"
        >
          {shown.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              لا توجد أصناف مطابقة.
            </div>
          ) : (
            shown.map((c) => {
              const isOn = selected.includes(c.code);
              return (
                <label
                  key={c.code}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 px-3 py-1.5 text-sm transition-colors hover:bg-muted/50",
                    isOn && "bg-primary/5",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={isOn}
                    onChange={() => toggleCode(c.code)}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <span className="w-20 shrink-0 tabular-nums text-muted-foreground">
                    {c.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate" dir="auto">
                    {c.product || "—"}
                  </span>
                </label>
              );
            })
          )}
        </div>
      </div>

      {/* The value sheet appears once at least one code is picked. */}
      {selected.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-8 text-center text-sm text-muted-foreground">
          اختر صنفاً أو أكثر من القائمة أعلاه ليظهر جدول المسحوبات.
        </div>
      ) : (
        <>
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={exportExcel}>
              <Download />
              انقر لتصدير الاكسيل
            </Button>
          </div>

          <div className="overflow-auto rounded-md border border-border shadow-sm">
            <table
              dir="ltr"
              className="w-full border-collapse text-sm [&_td]:border [&_td]:border-border [&_th]:border [&_th]:border-border"
            >
              <thead className="sticky top-0 z-10">
                <tr className="bg-primary/10 text-center">
                  <th className="w-[6rem] whitespace-nowrap px-2 py-2 font-semibold">
                    الكود
                  </th>
                  <th className="min-w-[16rem] whitespace-nowrap px-3 py-2 text-start font-semibold">
                    الصنف
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.id}
                      className="whitespace-nowrap px-2 py-2 text-xs font-semibold text-muted-foreground"
                    >
                      <span dir="auto">{col.name}</span>
                    </th>
                  ))}
                  <th className="w-[7rem] whitespace-nowrap px-2 py-2 font-semibold">
                    اجمالي الكمية
                  </th>
                  <th className="w-[7rem] whitespace-nowrap px-2 py-2 font-semibold">
                    سعر الصيدلي
                  </th>
                  <th className="w-[9rem] whitespace-nowrap px-2 py-2 font-semibold">
                    اجمالي القيمة
                  </th>
                </tr>
              </thead>
              <tbody>
                {selected.map((code) => {
                  const info = infoByCode.get(code);
                  const qty = qtyOf(code);
                  const priceStr = priceOverride[code];
                  return (
                    <tr key={code} className="bg-card even:bg-muted/30">
                      <td className="px-2 py-1 text-center tabular-nums text-muted-foreground">
                        {code}
                      </td>
                      <td className="px-3 py-1 text-start" dir="auto">
                        {info?.product || "—"}
                      </td>
                      {columns.map((col) => (
                        <td key={col.id} className="p-0 align-middle">
                          <input
                            value={cellValue(code, col.id)}
                            inputMode="numeric"
                            onChange={(e) =>
                              setCell(code, col.id, e.target.value)
                            }
                            className="h-8 w-24 min-w-full border-0 bg-transparent px-2 text-center text-sm tabular-nums outline-none focus:bg-primary/5 focus:ring-2 focus:ring-inset focus:ring-ring"
                          />
                        </td>
                      ))}
                      <td className="w-[7rem] px-2 py-1 text-center font-semibold tabular-nums">
                        {qtyFmt(qty)}
                      </td>
                      <td className="w-[7rem] p-0 align-middle">
                        <input
                          value={
                            priceStr !== undefined
                              ? priceStr
                              : info
                                ? String(info.price)
                                : ""
                          }
                          inputMode="decimal"
                          onChange={(e) =>
                            setPriceOverride((prev) => ({
                              ...prev,
                              [code]: e.target.value,
                            }))
                          }
                          title="سعر الوحدة شامل الضريبة — قابل للتعديل"
                          className="h-8 w-24 min-w-full border-0 bg-transparent px-2 text-center text-sm tabular-nums outline-none focus:bg-primary/5 focus:ring-2 focus:ring-inset focus:ring-ring"
                        />
                      </td>
                      <td className="w-[9rem] px-2 py-1 text-center font-semibold tabular-nums">
                        {money(valueOf(code))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-10">
                <tr className="bg-muted font-semibold">
                  <td
                    className="px-3 py-2 text-start"
                    colSpan={columns.length + 4}
                  >
                    اجمالي قيمة المسحوبات من الاصناف
                  </td>
                  <td className="w-[9rem] px-2 py-2 text-center tabular-nums text-primary">
                    {money(grandTotal)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
