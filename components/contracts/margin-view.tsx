"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Crown,
  Download,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  computeSupplierMargins,
  CONTRACT_COLUMNS,
  type CreditConfig,
  type ItemMargin,
  type ItemSupplierMargin,
  type PurchaseRow,
  type SupplierMargin,
} from "@/lib/contracts";

const CURRENCY = "EGP";

// Payment-terms config persists like the Yasmen presets, so credit months stick
// across uploads and reloads.
const DEFAULT_MONTHLY_RATE = "1.4";
const RATE_KEY = "margin.monthlyRate";
const MONTHS_KEY = "margin.creditMonths";

const pct = (v: number) => `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
const money = (v: number) =>
  `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${CURRENCY}`;
const num = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 });

// Reuse xlsx the same way the rest of the page does.
async function downloadSheet(
  rows: Record<string, string | number>[],
  sheetName: string,
  fileName: string,
) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(rows);
  if (rows.length > 0) {
    ws["!cols"] = Object.keys(rows[0]).map((key) => {
      const width = rows.reduce(
        (m, r) => Math.max(m, String(r[key] ?? "").length),
        key.length,
      );
      return { wch: Math.min(Math.max(width + 2, 8), 48) };
    });
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    ws,
    sheetName.replace(/[[\]:*?/\\]/g, " ").slice(0, 31) || "Sheet1",
  );
  XLSX.writeFile(wb, fileName);
}

type Tab = "suppliers" | "items";

export function MarginView({
  rows,
  supplierFilter,
  onClear,
}: {
  rows: PurchaseRow[];
  supplierFilter: React.ReactNode;
  onClear: () => void;
}) {
  const [tab, setTab] = React.useState<Tab>("suppliers");
  const [openCode, setOpenCode] = React.useState<string | null>(null);

  // Suppliers present in the current (filtered) data — the rows of the credit
  // editor.
  const supplierNames = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const n = (r[CONTRACT_COLUMNS.supplier] ?? "").trim();
      if (n) set.add(n);
    }
    return [...set].sort((a, b) => a.localeCompare(b, "ar"));
  }, [rows]);

  // Payment terms (persisted).
  const [monthlyRate, setMonthlyRate] = React.useState(DEFAULT_MONTHLY_RATE);
  const [creditMonths, setCreditMonths] = React.useState<Record<string, string>>(
    {},
  );
  const [creditOpen, setCreditOpen] = React.useState(false);

  React.useEffect(() => {
    try {
      const r = localStorage.getItem(RATE_KEY);
      if (r !== null) setMonthlyRate(r);
      const m = localStorage.getItem(MONTHS_KEY);
      if (m) setCreditMonths(JSON.parse(m) as Record<string, string>);
    } catch {
      // localStorage unavailable — terms just won't persist.
    }
  }, []);

  const persistRate = (v: string) => {
    setMonthlyRate(v);
    try {
      localStorage.setItem(RATE_KEY, v);
    } catch {
      // ignore
    }
  };

  const setMonths = (name: string, v: string) =>
    setCreditMonths((prev) => {
      const next = { ...prev };
      if (v.trim() === "" || Number(v) === 0) delete next[name];
      else next[name] = v;
      try {
        localStorage.setItem(MONTHS_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });

  const clearCredit = () => {
    setCreditMonths({});
    try {
      localStorage.removeItem(MONTHS_KEY);
    } catch {
      // ignore
    }
  };

  const credit = React.useMemo<CreditConfig>(() => {
    const rate = Number(monthlyRate) || 0;
    const months: Record<string, number> = {};
    for (const [k, v] of Object.entries(creditMonths)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) months[k] = n;
    }
    return { monthlyRate: rate, months };
  }, [monthlyRate, creditMonths]);

  const creditCount = Object.keys(credit.months).length;

  const { bySupplier, byItem } = React.useMemo(
    () => computeSupplierMargins(rows, credit),
    [rows, credit],
  );

  React.useEffect(() => setOpenCode(null), [tab, rows]);

  const exportSuppliers = async () => {
    if (bySupplier.length === 0) {
      toast.error("لا توجد بيانات للتصدير");
      return;
    }
    try {
      const data = bySupplier.map((s) => ({
        المورد: s.name,
        "خصم متوسط %": s.avgDiscountPct,
        "بونص %": s.bonusPct,
        [`قيمة البونص (${CURRENCY})`]: s.bonusValue,
        "آجل (شهور)": s.creditMonths,
        "آجل %": s.creditPct,
        "هامش الربح %": s.marginPct,
        "وحدات مدفوعة": s.paidUnits,
        "وحدات بونص": s.bonusUnits,
        [`قيمة الشراء (${CURRENCY})`]: s.spend,
        أصناف: s.items,
      }));
      await downloadSheet(data, "الموردون", "supplier-margin.xlsx");
    } catch {
      toast.error("تعذّر تصدير الملف");
    }
  };

  const exportItems = async () => {
    if (byItem.length === 0) {
      toast.error("لا توجد بيانات للتصدير");
      return;
    }
    try {
      const data = byItem.map((it) => ({
        "كود الصنف": it.code,
        "اسم الصنف": it.product,
        "أفضل مورد": it.best?.supplier ?? "",
        "هامش الأفضل %": it.best?.marginPct ?? 0,
        "فارق عن التالي %": it.gap,
        "عدد الموردين": it.suppliers.filter((s) => s.paidUnits > 0).length,
        [`قيمة الصنف (${CURRENCY})`]: it.spend,
      }));
      await downloadSheet(data, "الأصناف", "item-best-supplier.xlsx");
    } catch {
      toast.error("تعذّر تصدير الملف");
    }
  };

  return (
    <div className="space-y-4">
      {supplierFilter}

      <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <b className="text-foreground">هامش الربح %</b> = متوسط الخصم (أساسي +
        إضافي + خاص، مرجّح بقيمة الشراء) + نسبة البونص (وحدات مجانية ÷ وحدات
        مدفوعة) + خصم الآجل (شهور السداد × {monthlyRate || 0}% شهرياً). المورد
        الأعلى هامشاً يعطيك ربحاً أكبر على نفس الأصناف.
      </div>

      {/* Payment terms editor — months of credit per supplier + monthly rate. */}
      <CreditEditor
        open={creditOpen}
        onToggle={() => setCreditOpen((o) => !o)}
        suppliers={supplierNames}
        monthlyRate={monthlyRate}
        onRate={persistRate}
        months={creditMonths}
        onMonths={setMonths}
        onClear={clearCredit}
        count={creditCount}
      />

      {/* Sub-tab switch: overall leaderboard vs. best supplier per item. */}
      <div className="inline-flex rounded-lg border border-border bg-secondary p-0.5 text-sm">
        {(
          [
            ["suppliers", "ترتيب الموردين"],
            ["items", "أفضل مورد لكل صنف"],
          ] as [Tab, string][]
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            onClick={() => setTab(v)}
            className={cn(
              "rounded-md px-3 py-1.5 font-medium transition-colors",
              tab === v
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "suppliers" ? (
        <SupplierLeaderboard
          suppliers={bySupplier}
          onExport={exportSuppliers}
          onClear={onClear}
        />
      ) : (
        <ItemBestSupplier
          items={byItem}
          openCode={openCode}
          onToggle={(code) => setOpenCode((c) => (c === code ? null : code))}
          onExport={exportItems}
          onClear={onClear}
        />
      )}
    </div>
  );
}

function CreditEditor({
  open,
  onToggle,
  suppliers,
  monthlyRate,
  onRate,
  months,
  onMonths,
  onClear,
  count,
}: {
  open: boolean;
  onToggle: () => void;
  suppliers: string[];
  monthlyRate: string;
  onRate: (v: string) => void;
  months: Record<string, string>;
  onMonths: (name: string, v: string) => void;
  onClear: () => void;
  count: number;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-start"
      >
        {open ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
        <CalendarClock className="size-4 text-primary" />
        <span className="text-sm font-semibold">آجل السداد (خصم إضافي)</span>
        <span className="text-xs text-muted-foreground">
          {count > 0
            ? `${count} مورد بآجل — ${monthlyRate || 0}% لكل شهر`
            : `اضبط شهور الآجل لكل مورد — ${monthlyRate || 0}% لكل شهر`}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="monthly-rate" className="text-sm font-medium">
              نسبة الشهر
            </label>
            <input
              id="monthly-rate"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              value={monthlyRate}
              onChange={(e) => onRate(e.target.value)}
              className="h-9 w-24 rounded-lg border border-border bg-background px-3 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <span className="text-sm text-muted-foreground">% لكل شهر آجل</span>
            {count > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onClear}
                className="ms-auto"
              >
                مسح الآجل
              </Button>
            )}
          </div>

          <div
            className="max-h-64 divide-y divide-border/60 overflow-auto rounded-lg border border-border"
            dir="rtl"
          >
            {suppliers.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                لا يوجد موردون في البيانات الحالية.
              </div>
            ) : (
              suppliers.map((name) => {
                const v = months[name] ?? "";
                const eff = (Number(v) || 0) * (Number(monthlyRate) || 0);
                return (
                  <div
                    key={name}
                    className="flex items-center gap-3 px-3 py-1.5 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate" dir="auto">
                      {name}
                    </span>
                    {eff > 0 && (
                      <span className="shrink-0 text-xs tabular-nums text-primary">
                        +{pct(Math.round(eff * 100) / 100)}
                      </span>
                    )}
                    <input
                      value={v}
                      inputMode="decimal"
                      onChange={(e) => onMonths(name, e.target.value)}
                      placeholder="شهور"
                      className="h-8 w-20 shrink-0 rounded-md border border-border bg-background px-2 text-center text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SupplierLeaderboard({
  suppliers,
  onExport,
  onClear,
}: {
  suppliers: SupplierMargin[];
  onExport: () => void;
  onClear: () => void;
}) {
  const maxMargin = Math.max(...suppliers.map((s) => s.marginPct), 1);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {suppliers.length.toLocaleString()} مورد · مرتّبون حسب هامش الربح
          الأعلى
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={onClear}>
            <X /> Clear
          </Button>
        </div>
      </div>

      <div className="overflow-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm" dir="rtl">
          <thead className="bg-card">
            <tr className="text-center">
              <th className="w-10 border-b border-border px-2 py-2" />
              <th className="border-b border-border px-3 py-2 text-start font-semibold">
                المورد
              </th>
              <th className="border-b border-border px-3 py-2 font-semibold">
                هامش الربح %
              </th>
              <th className="border-b border-border px-3 py-2 font-semibold text-muted-foreground">
                خصم %
              </th>
              <th className="border-b border-border px-3 py-2 font-semibold text-muted-foreground">
                بونص
              </th>
              <th className="border-b border-border px-3 py-2 font-semibold text-muted-foreground">
                آجل %
              </th>
              <th className="border-b border-border px-3 py-2 font-semibold text-muted-foreground">
                قيمة الشراء
              </th>
              <th className="border-b border-border px-3 py-2 font-semibold text-muted-foreground">
                أصناف
              </th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s, i) => (
              <tr
                key={s.name}
                className="border-b border-border transition-colors hover:bg-muted/40"
              >
                <td className="px-2 py-2 text-center align-middle tabular-nums text-muted-foreground">
                  {i === 0 ? (
                    <Crown className="mx-auto size-4 text-primary" />
                  ) : (
                    i + 1
                  )}
                </td>
                <td className="px-3 py-2 text-start align-middle font-medium" dir="auto">
                  {s.name}
                </td>
                <td className="px-3 py-2 align-middle">
                  <div className="flex items-center gap-2">
                    <div className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-500"
                        style={{ width: `${(s.marginPct / maxMargin) * 100}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-start tabular-nums font-semibold">
                      {pct(s.marginPct)}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 text-center align-middle tabular-nums text-muted-foreground">
                  {pct(s.avgDiscountPct)}
                </td>
                <td className="px-3 py-2 text-center align-middle tabular-nums text-muted-foreground">
                  {s.bonusUnits > 0 ? (
                    <div className="leading-tight">
                      <div>{pct(s.bonusPct)}</div>
                      <div className="text-[10px] text-primary">
                        {money(s.bonusValue)}
                      </div>
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 text-center align-middle tabular-nums text-muted-foreground">
                  {s.creditPct > 0 ? (
                    <span
                      className="text-primary"
                      title={`${s.creditMonths} شهر آجل`}
                    >
                      {pct(s.creditPct)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2 text-center align-middle tabular-nums text-muted-foreground">
                  {money(s.spend)}
                </td>
                <td className="px-3 py-2 text-center align-middle tabular-nums text-muted-foreground">
                  {s.items.toLocaleString()}
                </td>
              </tr>
            ))}
            {suppliers.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-10 text-center text-muted-foreground"
                >
                  لا توجد بيانات للموردين المحددين.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ItemBestSupplier({
  items,
  openCode,
  onToggle,
  onExport,
  onClear,
}: {
  items: ItemMargin[];
  openCode: string | null;
  onToggle: (code: string) => void;
  onExport: () => void;
  onClear: () => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {items.length.toLocaleString()} صنف · أفضل مورد هامشاً لكل صنف، مرتّبة
          حسب قيمة الصنف
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={onClear}>
            <X /> Clear
          </Button>
        </div>
      </div>

      <div className="overflow-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-sm" dir="rtl">
          <thead className="bg-card">
            <tr className="text-center">
              <th className="w-8 border-b border-border px-2 py-2" />
              <th className="border-b border-border px-3 py-2 font-semibold">
                كود
              </th>
              <th className="border-b border-border px-3 py-2 text-start font-semibold">
                الصنف
              </th>
              <th className="border-b border-border px-3 py-2 text-start font-semibold">
                أفضل مورد
              </th>
              <th className="border-b border-border px-3 py-2 font-semibold">
                هامش %
              </th>
              <th className="border-b border-border px-3 py-2 font-semibold text-muted-foreground">
                فارق %
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const open = openCode === it.code;
              const rivals = it.suppliers.filter((s) => s.paidUnits > 0).length;
              return (
                <React.Fragment key={it.code}>
                  <tr
                    onClick={() => onToggle(it.code)}
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
                      {it.code}
                    </td>
                    <td className="px-3 py-2 text-start align-top" dir="auto">
                      {it.product || "—"}
                    </td>
                    <td
                      className="px-3 py-2 text-start align-top font-medium"
                      dir="auto"
                    >
                      {it.best?.supplier ?? "—"}
                      {rivals > 1 && (
                        <span className="text-muted-foreground">
                          {" "}
                          <span className="text-xs">من {rivals}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center align-top tabular-nums font-semibold">
                      {it.best ? pct(it.best.marginPct) : "—"}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-center align-top tabular-nums",
                        it.gap > 0
                          ? "font-medium text-primary"
                          : "text-muted-foreground",
                      )}
                    >
                      {it.gap > 0 ? `+${pct(it.gap)}` : "—"}
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b border-border bg-muted/20">
                      <td colSpan={6} className="p-3">
                        <SupplierBreakdown suppliers={it.suppliers} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-10 text-center text-muted-foreground"
                >
                  لا توجد أصناف للموردين المحددين.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SupplierBreakdown({ suppliers }: { suppliers: ItemSupplierMargin[] }) {
  return (
    <table className="w-full border-collapse text-xs" dir="rtl">
      <thead>
        <tr className="text-muted-foreground">
          <th className="px-2 py-1 text-start font-medium">المورد</th>
          <th className="px-2 py-1 font-medium">هامش %</th>
          <th className="px-2 py-1 font-medium">خصم %</th>
          <th className="px-2 py-1 font-medium">بونص</th>
          <th className="px-2 py-1 font-medium">آجل %</th>
          <th className="px-2 py-1 font-medium">وحدات</th>
          <th className="px-2 py-1 font-medium">قيمة</th>
        </tr>
      </thead>
      <tbody>
        {suppliers.map((s, i) => (
          <tr
            key={s.supplier}
            className={cn(
              "border-t border-border/60",
              i === 0 && s.paidUnits > 0 && "bg-primary/5 font-medium",
            )}
          >
            <td className="px-2 py-1 text-start" dir="auto">
              {i === 0 && s.paidUnits > 0 && (
                <Crown className="me-1 inline size-3 text-primary" />
              )}
              {s.supplier}
            </td>
            <td className="px-2 py-1 text-center tabular-nums font-semibold">
              {s.paidUnits > 0 ? pct(s.marginPct) : "بونص فقط"}
            </td>
            <td className="px-2 py-1 text-center tabular-nums text-muted-foreground">
              {pct(s.avgDiscountPct)}
            </td>
            <td className="px-2 py-1 text-center tabular-nums text-muted-foreground">
              {s.bonusUnits > 0 ? pct(s.bonusPct) : "—"}
            </td>
            <td className="px-2 py-1 text-center tabular-nums text-muted-foreground">
              {s.creditPct > 0 ? (
                <span className="text-primary" title={`${s.creditMonths} شهر`}>
                  {pct(s.creditPct)}
                </span>
              ) : (
                "—"
              )}
            </td>
            <td className="px-2 py-1 text-center tabular-nums text-muted-foreground">
              {num(s.paidUnits)}
              {s.bonusUnits > 0 && (
                <span className="text-primary"> +{num(s.bonusUnits)}</span>
              )}
            </td>
            <td className="px-2 py-1 text-center tabular-nums text-muted-foreground">
              {money(s.spend)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
