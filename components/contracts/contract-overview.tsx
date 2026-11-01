"use client";

// The "Quarterly totals" overview of a contract: a hero with the headline
// numbers, the rebate-slab ladder, KPI tiles, the monthly trend and the
// quarter split — plus the supplier / item / bonus breakdown shown under the
// table. Every number is explained in plain words next to it.

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  FileSpreadsheet,
  Gauge,
  Gift,
  Lock,
  Package,
  Pencil,
  Plus,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Truck,
  Wallet,
  X,
} from "lucide-react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  linkRunItems,
  MONTH_LABELS,
  QUARTER_LABELS,
  type Insights,
} from "@/lib/contracts";
import {
  slabStatuses,
  type ContractSlab,
  type SlabStatus,
} from "@/lib/contracts-store";

const CURRENCY = "EGP";
const QUARTER_MONTHS = ["Jan – Mar", "Apr – Jun", "Jul – Sep", "Oct – Dec"];

const full = (v: number) => Math.round(v).toLocaleString("en-US");
const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});
const compact = (v: number) => compactFmt.format(v);

// "1785570.51" → "1,785,570.51" for an editable field (keeps a trailing "."
// or partial decimals as typed).
const withCommas = (raw: string) => {
  const [int, dec] = raw.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dec === undefined ? grouped : `${grouped}.${dec}`;
};

// "2026/03/09" → "9 Mar 2026".
const niceDate = (d: string) => {
  const [y, m, day] = d.split("/").map(Number);
  return `${day} ${MONTH_LABELS[m - 1] ?? ""} ${y}`;
};

// Animated number: eases from the last shown value to `value`.
function useCountUp(value: number, duration = 900) {
  const reduce = useReducedMotion();
  const [shown, setShown] = React.useState(0);
  const from = React.useRef(0);
  React.useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const d = reduce ? 0 : duration;
    let raf = 0;
    const tick = (now: number) => {
      const t = d === 0 ? 1 : Math.min(1, (now - start) / d);
      setShown(a + (value - a) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value, duration, reduce]);
  return shown;
}

// --- Model ----------------------------------------------------------------

type Tone = "good" | "done" | "warn" | "none";

type Model = {
  slabRows: SlabStatus[];
  reached?: SlabStatus;
  next?: SlabStatus;
  top?: SlabStatus;
  slabNo: (s: SlabStatus) => number;
  goal: number; // amount we're chasing now (next slab / year target)
  goalLabel: string;
  remaining: number;
  progress: number; // achieved / goal (0..)
  spanMonths: number;
  avg: number;
  monthsLeft: number;
  needed: number; // per remaining month to reach the goal
  projected: number;
  projectedSlab?: SlabStatus;
  status: { tone: Tone; label: string };
};

function buildModel(
  achieved: number,
  insights: Insights,
  slabs: ContractSlab[],
  target: string,
): Model {
  const slabRows = slabStatuses(slabs, achieved);
  const slabNo = (s: SlabStatus) => slabRows.indexOf(s) + 1;
  const reached = slabRows.filter((s) => s.reached).at(-1);
  const next = slabRows.find((s) => !s.reached);
  const top = slabRows.at(-1);
  const goalSlab = next ?? top;
  const goal = goalSlab ? goalSlab.target : Number(target) || 0;
  const goalLabel = goalSlab ? `Slab ${slabNo(goalSlab)}` : "Year target";
  const remaining = goal - achieved;

  const elapsed = insights.lastMonthWithData + 1;
  const spanMonths =
    insights.firstMonthWithData >= 0
      ? insights.lastMonthWithData - insights.firstMonthWithData + 1
      : 0;
  const avg =
    spanMonths > 0
      ? insights.byMonth.reduce((a, b) => a + b, 0) / spanMonths
      : 0;
  const monthsLeft = Math.max(0, 12 - elapsed);
  const projected = achieved + avg * monthsLeft;
  const needed = remaining > 0 && monthsLeft > 0 ? remaining / monthsLeft : 0;
  const projectedSlab = slabRows.filter((s) => projected >= s.target).at(-1);

  let status: Model["status"];
  if (goal <= 0) status = { tone: "none", label: "No target yet" };
  else if (top && !next) status = { tone: "done", label: "All slabs reached" };
  else if (!top && remaining <= 0)
    status = { tone: "done", label: "Target reached" };
  else if (projected >= goal)
    status = {
      tone: "good",
      label: projectedSlab
        ? `On track for Slab ${slabNo(projectedSlab)}`
        : "On track",
    };
  else status = { tone: "warn", label: "Behind pace" };

  return {
    slabRows,
    reached,
    next,
    top,
    slabNo,
    goal,
    goalLabel,
    remaining,
    progress: goal > 0 ? achieved / goal : 0,
    spanMonths,
    avg,
    monthsLeft,
    needed,
    projected,
    projectedSlab,
    status,
  };
}

// --- Small pieces -----------------------------------------------------------

function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  const Icon =
    tone === "done"
      ? Trophy
      : tone === "good"
        ? CheckCircle2
        : tone === "warn"
          ? AlertTriangle
          : CircleDashed;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
        tone === "good" || tone === "done"
          ? "bg-viz-good/12 text-viz-good-ink"
          : tone === "warn"
            ? "bg-viz-warn/18 text-viz-warn-ink"
            : "bg-muted text-muted-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
  );
}

function GoalRing({
  progress,
  tone,
  caption,
}: {
  progress: number;
  tone: Tone;
  caption: string;
}) {
  const size = 176;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  const shown = useCountUp(progress * 100);
  const good = tone === "done" || progress >= 1;
  return (
    <div className="relative size-44 shrink-0">
      <svg viewBox={`0 0 ${size} ${size}`} className="size-full -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - p) }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          className={good ? "stroke-viz-good" : "stroke-viz-1"}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-3xl font-semibold tabular-nums tracking-tight">
          {shown.toFixed(1)}%
        </span>
        <span className="mt-0.5 text-xs text-muted-foreground">{caption}</span>
      </div>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  title,
  hint,
  right,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-viz-1/10 text-viz-1">
          <Icon className="size-4.5" />
        </span>
        <div>
          <h3 className="text-sm font-semibold leading-tight">{title}</h3>
          {hint && (
            <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
          )}
        </div>
      </div>
      {right}
    </div>
  );
}

const card =
  "rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:p-6";

// --- Management summary (.xlsx) ----------------------------------------------

async function exportSummary({
  contractName,
  basisLabel,
  achieved,
  insights,
  quarterTotals,
  topItems,
  m,
}: {
  contractName: string;
  basisLabel: string;
  achieved: number;
  insights: Insights;
  quarterTotals: number[];
  topItems: Insights["topItems"];
  m: Model;
}) {
  const XLSX = await import("xlsx");
  const r = (v: number) => Math.round(v);
  const total = quarterTotals.reduce((a, b) => a + b, 0) || 1;
  const supTotal = insights.bySupplier.reduce((a, b) => a + b.value, 0) || 1;
  const itemTotal = insights.topItems.reduce((a, b) => a + b.value, 0) || 1;
  const today = new Date().toISOString().slice(0, 10).replaceAll("-", "/");
  const rows: (string | number)[][] = [
    ["Contract summary"],
    ["Contract", contractName || "—"],
    [
      "Period",
      insights.firstDate ? `${insights.firstDate} → ${insights.lastDate}` : "—",
    ],
    ["Buy measured on", basisLabel],
    ["Generated", today],
    [],
    ["Key numbers", `Value (${CURRENCY})`, "Note"],
    ["Total buy so far", r(achieved)],
    ["Status", m.status.label],
    [
      "Current slab",
      m.reached ? `Slab ${m.slabNo(m.reached)}` : "None yet",
      m.reached ? `${m.reached.pct}% of ${r(m.reached.target)}` : "",
    ],
    ["Rebate earned", r(m.reached?.incentive ?? 0)],
    ...(m.next
      ? [
          [
            `To Slab ${m.slabNo(m.next)}`,
            r(m.next.target - achieved),
            `unlocks ${r(m.next.incentive)} rebate`,
          ],
        ]
      : m.goal > 0 && !m.top
        ? [["To year target", r(Math.max(0, m.remaining))]]
        : []),
    [
      "Average buy / month",
      r(m.avg),
      `over ${m.spanMonths} month${m.spanMonths === 1 ? "" : "s"}`,
    ],
    ...(m.needed > 0
      ? [
          [
            `Needed / month → ${m.goalLabel}`,
            r(m.needed),
            `for ${m.monthsLeft} month${m.monthsLeft === 1 ? "" : "s"} left`,
          ],
        ]
      : []),
    [
      "Year-end forecast",
      r(m.projected),
      m.projectedSlab
        ? `lands in Slab ${m.slabNo(m.projectedSlab)} → ${r(m.projectedSlab.incentive)} rebate`
        : m.slabRows.length
          ? `below Slab 1 by ${r(m.slabRows[0].target - m.projected)}`
          : "",
    ],
    [],
  ];

  if (m.slabRows.length) {
    rows.push(
      ["Slabs", "Target", "Rebate %", "Rebate value", "Status", "To go", "Forecast"],
      ...m.slabRows.map((s) => [
        `Slab ${m.slabNo(s)}`,
        r(s.target),
        `${s.pct}%`,
        r(s.incentive),
        s.reached ? "Reached" : s === m.next ? "Next" : "Locked",
        s.reached ? 0 : r(s.target - achieved),
        m.projected >= s.target ? "Reaches it" : `Short by ${r(s.target - m.projected)}`,
      ]),
      [],
    );
  }

  rows.push(
    ["Quarter", `Buy (${CURRENCY})`, "Share"],
    ...quarterTotals.map((v, i) => [
      QUARTER_LABELS[i],
      r(v),
      `${((v / total) * 100).toFixed(1)}%`,
    ]),
    [],
    ["Month", `Buy (${CURRENCY})`],
    ...insights.byMonth
      .slice(0, Math.max(0, insights.lastMonthWithData + 1))
      .map((v, i) => [MONTH_LABELS[i], r(v)]),
    [],
    ["Top 10 items", "Code", `Buy (${CURRENCY})`, "Share"],
    ...topItems.slice(0, 10).map((t, i) => [
      `${i + 1}. ${t.product || t.code}`,
      t.code,
      r(t.value),
      `${((t.value / itemTotal) * 100).toFixed(1)}%`,
    ]),
    [],
    ["Distributor", `Buy (${CURRENCY})`, "Share"],
    ...insights.bySupplier.map((s) => [
      s.name,
      r(s.value),
      `${((s.value / supTotal) * 100).toFixed(1)}%`,
    ]),
  );

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 44 },
    { wch: 20 },
    { wch: 34 },
    { wch: 16 },
    { wch: 12 },
    { wch: 14 },
    { wch: 20 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Summary");
  const stem =
    (contractName.trim().replace(/[^\w\u0600-\u06FF.-]+/g, "_") || "contract").slice(
      0,
      60,
    );
  XLSX.writeFile(wb, `summary-${stem}.xlsx`);
}

// --- Hero -------------------------------------------------------------------

function Hero({
  achieved,
  insights,
  m,
  onExport,
}: {
  achieved: number;
  insights: Insights;
  m: Model;
  onExport: () => void;
}) {
  const shown = useCountUp(achieved);
  const { next, top, reached } = m;

  let headline: React.ReactNode;
  if (next)
    headline = (
      <>
        You need <b>{full(m.remaining)} {CURRENCY}</b> more to reach{" "}
        <b>Slab {m.slabNo(next)}</b> and unlock a{" "}
        <b className="text-viz-good-ink">
          {full(next.incentive)} {CURRENCY}
        </b>{" "}
        rebate.
      </>
    );
  else if (top && reached)
    headline = (
      <>
        Top slab reached — <b>Slab {m.slabNo(reached)}</b> earns you{" "}
        <b className="text-viz-good-ink">
          {full(reached.incentive)} {CURRENCY}
        </b>
        .
      </>
    );
  else if (m.goal > 0 && m.remaining > 0)
    headline = (
      <>
        You need <b>{full(m.remaining)} {CURRENCY}</b> more to hit the year
        target.
      </>
    );
  else if (m.goal > 0)
    headline = (
      <>
        Year target reached —{" "}
        <b className="text-viz-good-ink">
          +{full(-m.remaining)} {CURRENCY}
        </b>{" "}
        over.
      </>
    );
  else
    headline = (
      <>Add rebate slabs (or a year target) below to start tracking progress.</>
    );

  return (
    <section className="relative overflow-hidden rounded-3xl border border-border bg-linear-to-br from-viz-1/[0.07] via-card to-card p-6 shadow-sm sm:p-8">
      {/* Soft dot grid, fading out to the right. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:18px_18px] [mask-image:linear-gradient(to_right,black,transparent_70%)]"
      />
      <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Contract performance
            </span>
            <StatusPill {...m.status} />
            <Button
              variant="outline"
              size="sm"
              onClick={onExport}
              className="bg-background/70 backdrop-blur"
              title="One-sheet Excel summary for management"
            >
              <FileSpreadsheet className="size-3.5" />
              Management summary
            </Button>
          </div>

          <div>
            <p className="text-sm text-muted-foreground">Total buy so far</p>
            <p className="mt-1 flex items-baseline gap-2">
              <span className="text-4xl font-semibold tabular-nums tracking-tight sm:text-6xl">
                {full(shown)}
              </span>
              <span className="text-lg font-medium text-muted-foreground">
                {CURRENCY}
              </span>
            </p>
          </div>

          <p className="max-w-2xl text-base leading-relaxed text-foreground/80 [&_b]:font-semibold [&_b]:text-foreground">
            {headline}
            {m.needed > 0 && (
              <>
                {" "}
                That&apos;s <b>{full(m.needed)} {CURRENCY} / month</b> for the{" "}
                {m.monthsLeft} month{m.monthsLeft === 1 ? "" : "s"} left — your
                average so far is <b>{full(m.avg)}</b>.
              </>
            )}
          </p>

          {insights.firstDate && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/70 px-3 py-1 backdrop-blur">
                <CalendarRange className="size-3.5" />
                <b className="font-semibold text-foreground">
                  {niceDate(insights.firstDate)}
                </b>
                →
                <b className="font-semibold text-foreground">
                  {niceDate(insights.lastDate)}
                </b>
              </span>
              <span>
                {m.spanMonths} month{m.spanMonths === 1 ? "" : "s"} of purchases
              </span>
            </div>
          )}
        </div>

        {m.goal > 0 && (
          <div className="flex items-center gap-5 self-start lg:self-center">
            <GoalRing
              progress={m.progress}
              tone={m.status.tone}
              caption={`of ${m.goalLabel}`}
            />
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">
                  {m.goalLabel} target
                </dt>
                <dd className="font-semibold tabular-nums">
                  {full(m.goal)} {CURRENCY}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {m.remaining > 0 ? "Still to go" : "Over target"}
                </dt>
                <dd
                  className={cn(
                    "font-semibold tabular-nums",
                    m.remaining <= 0 && "text-viz-good-ink",
                  )}
                >
                  {full(Math.abs(m.remaining))} {CURRENCY}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}

// --- Rebate ladder ------------------------------------------------------------

function clampTranslate(pos: number) {
  return pos < 8 ? "translate-x-0" : pos > 92 ? "-translate-x-full" : "-translate-x-1/2";
}

function SlabEditor({
  slabs,
  onSlabsChange,
  target,
  onTargetChange,
  achieved,
}: {
  slabs: ContractSlab[];
  onSlabsChange: React.Dispatch<React.SetStateAction<ContractSlab[]>>;
  target: string;
  onTargetChange: (v: string) => void;
  achieved: number;
}) {
  const update = (i: number, patch: Partial<ContractSlab>) =>
    onSlabsChange((prev) =>
      prev.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    );
  const input =
    "h-9 rounded-lg border border-border bg-background px-3 text-sm tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";
  return (
    <div className="space-y-4 rounded-xl border border-dashed border-border bg-muted/30 p-4">
      {slabs.length === 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="year-target" className="text-sm font-medium">
            Year target
          </label>
          <input
            id="year-target"
            type="text"
            inputMode="decimal"
            value={withCommas(target)}
            onChange={(e) =>
              onTargetChange(
                e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1"),
              )
            }
            placeholder="e.g. 12,000,000"
            className={cn(input, "w-48")}
          />
          <span className="text-xs text-muted-foreground">
            Used when there are no slabs.
          </span>
        </div>
      )}

      {slabs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="pb-2 font-medium">Slab</th>
                <th className="pb-2 font-medium">Target ({CURRENCY})</th>
                <th className="pb-2 font-medium">Rebate %</th>
                <th className="pb-2 font-medium">Rebate value</th>
                <th className="pb-2 font-medium">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {slabs.map((s, i) => {
                const t = Number(s.target) || 0;
                const inc = Math.round(t * (Number(s.pct) || 0)) / 100;
                const gap = t - achieved;
                return (
                  <tr key={i} className="border-t border-border">
                    <td className="py-2 pr-3 font-medium text-muted-foreground">
                      {i + 1}
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={withCommas(s.target)}
                        onChange={(e) =>
                          update(i, {
                            target: e.target.value
                              .replace(/[^\d.]/g, "")
                              .replace(/(\..*)\./g, "$1"),
                          })
                        }
                        placeholder="12,000,000"
                        className={cn(input, "w-40")}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.1"
                        value={s.pct}
                        onChange={(e) => update(i, { pct: e.target.value })}
                        placeholder="2"
                        className={cn(input, "w-20")}
                      />
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {t > 0 ? `${full(inc)} ${CURRENCY}` : "—"}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {t <= 0 ? (
                        "—"
                      ) : gap <= 0 ? (
                        <span className="font-medium text-viz-good-ink">
                          Reached
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {full(gap)} left
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          onSlabsChange((prev) => prev.filter((_, j) => j !== i))
                        }
                        className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                        aria-label={`Remove slab ${i + 1}`}
                      >
                        <X className="size-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onSlabsChange((prev) => [...prev, { target: "", pct: "" }])}
        >
          <Plus className="size-4" />
          Add slab
        </Button>
        <span className="text-xs text-muted-foreground">
          One row per tier from the contract — e.g. 12,000,000 @ 2% → 240,000
          rebate. Saved with the contract.
        </span>
      </div>
    </div>
  );
}

function Ladder({
  achieved,
  m,
  slabs,
  onSlabsChange,
  target,
  onTargetChange,
}: {
  achieved: number;
  m: Model;
  slabs: ContractSlab[];
  onSlabsChange: React.Dispatch<React.SetStateAction<ContractSlab[]>>;
  target: string;
  onTargetChange: (v: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const hasSlabs = m.slabRows.length > 0;
  const showEditor = editing || !hasSlabs;

  const domain =
    Math.max(m.top?.target ?? m.goal, m.projected, achieved, 1) * 1.06;
  const at = (v: number) => Math.max(0, Math.min(100, (v / domain) * 100));
  const youPos = at(achieved);
  const fcPos = at(m.projected);

  return (
    <section className={card}>
      <SectionTitle
        icon={Trophy}
        title="Rebate ladder"
        hint="Hit a slab's target in the contract year to earn its % of that target as a rebate."
        right={
          hasSlabs && (
            <Button
              type="button"
              variant={editing ? "secondary" : "outline"}
              size="sm"
              onClick={() => setEditing((e) => !e)}
            >
              <Pencil className="size-3.5" />
              {editing ? "Done" : "Edit slabs"}
            </Button>
          )
        }
      />

      {hasSlabs && (
        <>
          {/* Track: filled to today, hatched to the year-end forecast. */}
          <div className="relative mx-1 mb-16 mt-12">
            <div className="relative h-3 overflow-hidden rounded-full bg-muted">
              {m.projected > achieved && (
                <div
                  className="absolute inset-y-0 opacity-40 [background-image:repeating-linear-gradient(45deg,var(--viz-1)_0_4px,transparent_4px_8px)]"
                  style={{ left: `${youPos}%`, width: `${fcPos - youPos}%` }}
                />
              )}
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-viz-1"
                initial={{ width: 0 }}
                animate={{ width: `${youPos}%` }}
                transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>

            {/* You are here (above). */}
            <div
              className={cn("absolute bottom-full mb-2", clampTranslate(youPos))}
              style={{ left: `${youPos}%` }}
            >
              <span className="block whitespace-nowrap rounded-md bg-foreground px-2 py-0.5 text-[11px] font-semibold tabular-nums text-background shadow">
                You · {compact(achieved)}
              </span>
            </div>

            {/* Slab nodes + labels (below). */}
            {m.slabRows.map((s) => {
              const pos = at(s.target);
              const isNext = s === m.next;
              return (
                <div
                  key={s.target}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${pos}%` }}
                >
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full border-2 bg-card shadow-sm",
                      s.reached
                        ? "border-viz-good bg-viz-good text-white"
                        : isNext
                          ? "border-viz-1 text-viz-1"
                          : "border-border text-muted-foreground",
                    )}
                    title={`Slab ${m.slabNo(s)}: ${full(s.target)} ${CURRENCY} → ${s.pct}% = ${full(s.incentive)} ${CURRENCY}`}
                  >
                    {s.reached ? (
                      <CheckCircle2 className="size-3.5" />
                    ) : (
                      <span className="text-[10px] font-bold">
                        {m.slabNo(s)}
                      </span>
                    )}
                  </span>
                  <span className="absolute left-1/2 top-full mt-1.5 -translate-x-1/2 whitespace-nowrap text-[11px] font-medium tabular-nums text-muted-foreground">
                    <span className="hidden sm:inline">{compact(s.target)}</span>
                    <span className="sm:hidden">S{m.slabNo(s)}</span>
                  </span>
                </div>
              );
            })}

            {/* Year-end forecast (further below). */}
            {m.projected > 0 && (
              <div
                className={cn("absolute top-full mt-8", clampTranslate(fcPos))}
                style={{ left: `${fcPos}%` }}
              >
                <span className="flex items-center gap-1 whitespace-nowrap rounded-md border border-dashed border-viz-1/60 bg-viz-1/5 px-2 py-0.5 text-[11px] font-medium tabular-nums text-foreground">
                  <TrendingUp className="size-3" />
                  Year-end forecast · {compact(m.projected)}
                </span>
              </div>
            )}
          </div>

          {/* One step card per slab. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
            {m.slabRows.map((s) => {
              const isNext = s === m.next;
              const gap = s.target - achieved;
              const forecastOk = m.projected >= s.target;
              return (
                <div
                  key={s.target}
                  className={cn(
                    "relative flex flex-col gap-3 rounded-xl border p-4 transition-shadow",
                    s.reached
                      ? "border-viz-good/40 bg-viz-good/[0.06]"
                      : isNext
                        ? "border-viz-1/50 bg-viz-1/[0.04] ring-3 ring-viz-1/10"
                        : "border-border",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">
                      Slab {m.slabNo(s)}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        s.reached
                          ? "bg-viz-good/15 text-viz-good-ink"
                          : isNext
                            ? "bg-viz-1/12 text-viz-1"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {s.reached ? (
                        <>
                          <CheckCircle2 className="size-3" /> Reached
                        </>
                      ) : isNext ? (
                        <>
                          <Target className="size-3" /> Next
                        </>
                      ) : (
                        <>
                          <Lock className="size-3" /> Locked
                        </>
                      )}
                    </span>
                  </div>
                  <div>
                    <p className="text-xl font-semibold tabular-nums tracking-tight">
                      {full(s.target)}{" "}
                      <span className="text-xs font-medium text-muted-foreground">
                        {CURRENCY}
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {s.pct}% rebate →{" "}
                      <b className="font-semibold text-foreground">
                        {full(s.incentive)} {CURRENCY}
                      </b>
                    </p>
                  </div>
                  <div className="mt-auto space-y-1.5 border-t border-border/70 pt-3 text-xs">
                    {s.reached ? (
                      <p className="font-medium text-viz-good-ink">
                        Earned — {full(-gap)} {CURRENCY} above it
                      </p>
                    ) : (
                      <>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              isNext ? "bg-viz-1" : "bg-foreground/25",
                            )}
                            style={{
                              width: `${Math.min(100, (achieved / s.target) * 100)}%`,
                            }}
                          />
                        </div>
                        <p className="text-muted-foreground">
                          <b className="font-semibold tabular-nums text-foreground">
                            {full(gap)}
                          </b>{" "}
                          to go
                        </p>
                        <p
                          className={cn(
                            "flex items-center gap-1",
                            forecastOk ? "text-viz-good-ink" : "text-viz-warn-ink",
                          )}
                        >
                          {forecastOk ? (
                            <CheckCircle2 className="size-3" />
                          ) : (
                            <AlertTriangle className="size-3" />
                          )}
                          {forecastOk
                            ? "Forecast reaches it"
                            : `Forecast short by ${full(s.target - m.projected)}`}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {showEditor && (
        <div className={cn(hasSlabs && "mt-5")}>
          {!hasSlabs && (
            <p className="mb-3 text-sm text-muted-foreground">
              No slabs yet. Add the contract&apos;s tiers below — the page will
              then show which slab you&apos;re on, how much is left to the next
              one, and where the year is heading.
            </p>
          )}
          <SlabEditor
            slabs={slabs}
            onSlabsChange={onSlabsChange}
            target={target}
            onTargetChange={onTargetChange}
            achieved={achieved}
          />
        </div>
      )}
    </section>
  );
}

// --- KPI tiles ----------------------------------------------------------------

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint: React.ReactNode;
  tone?: "good" | "warn";
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-card p-5 transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-viz-1/10 group-hover:text-viz-1">
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
      <p
        className={cn(
          "mt-1.5 flex items-start gap-1 text-xs leading-snug",
          tone === "good"
            ? "text-viz-good-ink"
            : tone === "warn"
              ? "text-viz-warn-ink"
              : "text-muted-foreground",
        )}
      >
        {tone === "good" && <CheckCircle2 className="mt-px size-3 shrink-0" />}
        {tone === "warn" && <AlertTriangle className="mt-px size-3 shrink-0" />}
        <span>{hint}</span>
      </p>
    </div>
  );
}

function KpiRow({ m, insights }: { m: Model; insights: Insights }) {
  const first = MONTH_LABELS[Math.max(0, insights.firstMonthWithData)];
  const last = MONTH_LABELS[Math.max(0, insights.lastMonthWithData)];
  const neededOk = m.needed > 0 && m.needed <= m.avg;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        icon={Wallet}
        label="Rebate earned"
        value={`${full(m.reached?.incentive ?? 0)} ${CURRENCY}`}
        hint={
          m.reached
            ? `Slab ${m.slabNo(m.reached)} · ${m.reached.pct}% of ${compact(m.reached.target)}`
            : m.slabRows.length
              ? "Nothing yet — reach Slab 1 to start earning"
              : "Add slabs to calculate the rebate"
        }
        tone={m.reached ? "good" : undefined}
      />
      <Kpi
        icon={Gauge}
        label="Average buy / month"
        value={`${full(m.avg)} ${CURRENCY}`}
        hint={
          m.spanMonths > 0
            ? `Over ${m.spanMonths} month${m.spanMonths === 1 ? "" : "s"} (${first} – ${last})`
            : "No purchases yet"
        }
      />
      <Kpi
        icon={Target}
        label={`Needed / month → ${m.goalLabel}`}
        value={m.needed > 0 ? `${full(m.needed)} ${CURRENCY}` : "—"}
        hint={
          m.goal <= 0
            ? "Set slabs or a target first"
            : m.remaining <= 0
              ? "Already reached"
              : m.monthsLeft === 0
                ? "No months left in the year"
                : neededOk
                  ? `Below your average — keep this pace for ${m.monthsLeft} more month${m.monthsLeft === 1 ? "" : "s"}`
                  : `${full(m.needed - m.avg)} above your average, for ${m.monthsLeft} month${m.monthsLeft === 1 ? "" : "s"}`
        }
        tone={
          m.goal > 0 && m.remaining > 0 && m.monthsLeft > 0
            ? neededOk
              ? "good"
              : "warn"
            : undefined
        }
      />
      <Kpi
        icon={TrendingUp}
        label="Year-end forecast"
        value={`${full(m.projected)} ${CURRENCY}`}
        hint={
          m.slabRows.length
            ? m.projectedSlab
              ? `Lands in Slab ${m.slabNo(m.projectedSlab)} → ${full(m.projectedSlab.incentive)} ${CURRENCY} rebate`
              : `Below Slab 1 — short by ${full(m.slabRows[0].target - m.projected)}`
            : m.goal > 0
              ? m.projected >= m.goal
                ? "Reaches the year target"
                : `Short of target by ${full(m.goal - m.projected)}`
              : "Buy so far + average × months left"
        }
        tone={
          m.goal > 0 ? (m.projected >= m.goal ? "good" : "warn") : undefined
        }
      />
    </div>
  );
}

// --- Monthly trend --------------------------------------------------------------

function MonthlyChart({ insights, m }: { insights: Insights; m: Model }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const { byMonth, firstMonthWithData: first, lastMonthWithData: last } =
    insights;
  const showNeeded = m.needed > 0;
  const max = Math.max(...byMonth, showNeeded ? m.needed : 0, m.avg, 1) * 1.18;
  const h = (v: number) => `${(v / max) * 100}%`;
  const recent = new Set([last, last - 1, last - 2].filter((i) => i >= first && i >= 0));

  return (
    <section className={cn(card, "lg:col-span-2")}>
      <SectionTitle
        icon={TrendingUp}
        title="Monthly buy"
        hint={
          showNeeded
            ? `Dashed bars = what each remaining month needs to reach ${m.goalLabel}.`
            : "Purchases per calendar month."
        }
        right={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-viz-1/45" /> Month
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-viz-1" /> Last 3 months
            </span>
            {showNeeded && (
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm border border-dashed border-viz-1 bg-viz-1/10" />{" "}
                Needed
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span className="w-4 border-t-2 border-dashed border-foreground/40" />{" "}
              Average
            </span>
          </div>
        }
      />

      <div className="relative h-56 pl-1">
        {/* Average reference line. */}
        {m.avg > 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-dashed border-foreground/30"
            // Bars sit above the 1.5rem month-label row.
            style={{ bottom: `calc(1.5rem + (100% - 1.5rem) * ${m.avg / max})` }}
          >
            <span className="absolute -top-5 right-0 rounded bg-card/90 px-1 text-[10px] font-medium tabular-nums text-muted-foreground">
              Avg {compact(m.avg)}
            </span>
          </div>
        )}

        <div className="grid h-full grid-cols-12 gap-1.5 sm:gap-3">
          {byMonth.map((v, i) => {
            const future = i > last;
            const ghost = future && showNeeded;
            const active = !future && i >= first && first >= 0;
            const val = ghost ? m.needed : v;
            const isHover = hover === i;
            const prev = i > first ? byMonth[i - 1] : undefined;
            return (
              <div
                key={MONTH_LABELS[i]}
                className="relative flex h-full flex-col items-center"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <div className="relative flex w-full flex-1 flex-col justify-end">
                  {recent.has(i) && v > 0 && (
                    <span
                      className="absolute left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold tabular-nums"
                      style={{ bottom: h(v) }}
                    >
                      {compact(v)}
                    </span>
                  )}
                  {(active || ghost) && val > 0 && (
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: h(val) }}
                      transition={{ duration: 0.7, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
                      className={cn(
                        "w-full rounded-t-[4px] transition-colors",
                        ghost
                          ? "border-2 border-b-0 border-dashed border-viz-1/70 bg-viz-1/[0.07]"
                          : recent.has(i)
                            ? "bg-viz-1"
                            : "bg-viz-1/45",
                        isHover && !ghost && "brightness-110",
                        isHover && "ring-2 ring-viz-1/25",
                      )}
                    />
                  )}
                  {isHover && (active || ghost) && (
                    <div
                      className={cn(
                        "absolute z-20 mb-2 w-max min-w-36 rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg",
                        i < 2 ? "left-0" : i > 9 ? "right-0" : "left-1/2 -translate-x-1/2",
                      )}
                      style={{ bottom: h(val) }}
                    >
                      <p className="font-semibold">{MONTH_LABELS[i]}</p>
                      {ghost ? (
                        <p className="mt-0.5 text-muted-foreground">
                          Needed:{" "}
                          <b className="tabular-nums text-foreground">
                            {full(m.needed)} {CURRENCY}
                          </b>
                        </p>
                      ) : (
                        <>
                          <p className="mt-0.5 tabular-nums">
                            {full(v)} {CURRENCY}
                          </p>
                          {m.avg > 0 && (
                            <p className="text-muted-foreground">
                              {v >= m.avg ? "+" : ""}
                              {(((v - m.avg) / m.avg) * 100).toFixed(1)}% vs avg
                            </p>
                          )}
                          {prev !== undefined && prev > 0 && (
                            <p className="text-muted-foreground">
                              {v >= prev ? "+" : ""}
                              {(((v - prev) / prev) * 100).toFixed(1)}% vs{" "}
                              {MONTH_LABELS[i - 1]}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
                <span
                  className={cn(
                    "mt-2 h-4 text-[10px] sm:text-[11px]",
                    recent.has(i)
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {MONTH_LABELS[i]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function LastThree({ insights }: { insights: Insights }) {
  const { byMonth, firstMonthWithData: first, lastMonthWithData: last } =
    insights;
  const months = [last - 2, last - 1, last].filter((i) => i >= first && i >= 0);
  const max = Math.max(...months.map((i) => byMonth[i]), 1);
  return (
    <section className={card}>
      <SectionTitle
        icon={CalendarRange}
        title="Latest 3 months"
        hint="Month by month, with the change from the month before."
      />
      {months.length === 0 ? (
        <p className="text-sm text-muted-foreground">No purchases yet.</p>
      ) : (
        <ul className="space-y-4">
          {[...months].reverse().map((i) => {
            const v = byMonth[i];
            const prev = i > first ? byMonth[i - 1] : undefined;
            const delta = prev ? ((v - prev) / prev) * 100 : undefined;
            return (
              <li key={i}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{MONTH_LABELS[i]}</span>
                  {delta !== undefined && (
                    <span
                      className={cn(
                        "inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums",
                        delta >= 0 ? "text-viz-good-ink" : "text-viz-warn-ink",
                      )}
                      title={`vs ${MONTH_LABELS[i - 1]}`}
                    >
                      {delta >= 0 ? (
                        <ArrowUpRight className="size-3.5" />
                      ) : (
                        <ArrowDownRight className="size-3.5" />
                      )}
                      {Math.abs(delta).toFixed(1)}%
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-tight">
                  {full(v)}{" "}
                  <span className="text-xs font-medium text-muted-foreground">
                    {CURRENCY}
                  </span>
                </p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <motion.div
                    className="h-full rounded-full bg-viz-1"
                    initial={{ width: 0 }}
                    animate={{ width: `${(v / max) * 100}%` }}
                    transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// --- Quarters -------------------------------------------------------------------

function Quarters({
  quarterTotals,
  insights,
}: {
  quarterTotals: number[];
  insights: Insights;
}) {
  const total = quarterTotals.reduce((a, b) => a + b, 0) || 1;
  const max = Math.max(...quarterTotals, 1);
  const last = insights.lastMonthWithData;
  const currentQ = last >= 0 ? Math.floor(last / 3) : -1;
  const inProgress = last >= 0 && last % 3 !== 2;
  return (
    <section className={card}>
      <SectionTitle
        icon={Package}
        title="Buy by quarter"
        hint="Calendar quarters; bonus lines and ignored items excluded."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {quarterTotals.map((v, i) => {
          const upcoming = i > currentQ;
          const live = i === currentQ && inProgress;
          return (
            <div
              key={QUARTER_LABELS[i]}
              className={cn(
                "rounded-xl border p-4",
                upcoming ? "border-dashed border-border" : "border-border",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{QUARTER_LABELS[i]}</span>
                <span className="text-[11px] text-muted-foreground">
                  {live ? (
                    <span className="inline-flex items-center gap-1 font-medium text-viz-1">
                      <span className="relative flex size-1.5">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-viz-1 opacity-75" />
                        <span className="relative inline-flex size-1.5 rounded-full bg-viz-1" />
                      </span>
                      In progress
                    </span>
                  ) : upcoming ? (
                    "Upcoming"
                  ) : (
                    QUARTER_MONTHS[i]
                  )}
                </span>
              </div>
              <p
                className={cn(
                  "mt-2 text-xl font-semibold tabular-nums tracking-tight",
                  upcoming && v === 0 && "text-muted-foreground",
                )}
              >
                {full(v)}{" "}
                <span className="text-xs font-medium text-muted-foreground">
                  {CURRENCY}
                </span>
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <motion.div
                  className="h-full rounded-full bg-viz-1"
                  initial={{ width: 0 }}
                  animate={{ width: `${(v / max) * 100}%` }}
                  transition={{ duration: 0.8, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {((v / total) * 100).toFixed(1)}% of total buy
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// --- How it's calculated ------------------------------------------------------------

function HowItWorks() {
  return (
    <details className="group rounded-2xl border border-border bg-muted/30 px-5 py-3 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-muted-foreground hover:text-foreground">
        <Sparkles className="size-4" />
        How are these numbers calculated?
        <ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="mt-3 grid gap-2 pb-1 text-muted-foreground sm:grid-cols-2">
        <li>
          <b className="text-foreground">Total buy</b> = كمية الوارد × the
          price chosen above (شامل / بدون الضريبة), for paid lines only (bonus lines, أساسي = 100%, are
          excluded), from the suppliers you kept and without ignored items.
        </li>
        <li>
          <b className="text-foreground">Rebate</b> = the slab&apos;s % × the
          slab&apos;s target — e.g. 12,000,000 × 2% = 240,000. Only the highest
          slab reached counts.
        </li>
        <li>
          <b className="text-foreground">Average / month</b> = total buy ÷ the
          months from the first to the last month with purchases.
        </li>
        <li>
          <b className="text-foreground">Year-end forecast</b> = total buy so far
          + average / month × the months left until December.
        </li>
        <li>
          <b className="text-foreground">Needed / month</b> = what&apos;s left to
          the next slab ÷ the months left.
        </li>
        <li>
          <b className="text-foreground">Period</b> = the first and last purchase
          dates found in the uploaded lines.
        </li>
      </ul>
    </details>
  );
}

// --- Public components --------------------------------------------------------------

export function ContractOverview({
  achieved,
  insights,
  quarterTotals,
  slabs,
  onSlabsChange,
  target,
  onTargetChange,
  contractName,
  basisLabel,
  topItems,
}: {
  achieved: number;
  insights: Insights;
  quarterTotals: number[];
  slabs: ContractSlab[];
  onSlabsChange: React.Dispatch<React.SetStateAction<ContractSlab[]>>;
  target: string;
  onTargetChange: (v: string) => void;
  contractName: string;
  basisLabel: string;
  /** Top items as shown (تشغيلات linked or not). */
  topItems: Insights["topItems"];
}) {
  const m = buildModel(achieved, insights, slabs, target);
  const onExport = () =>
    exportSummary({
      contractName,
      basisLabel,
      achieved,
      insights,
      quarterTotals,
      topItems,
      m,
    }).catch(() => toast.error("Couldn't build the summary"));
  return (
    <div className="space-y-5">
      <Hero achieved={achieved} insights={insights} m={m} onExport={onExport} />
      <KpiRow m={m} insights={insights} />
      <Ladder
        achieved={achieved}
        m={m}
        slabs={slabs}
        onSlabsChange={onSlabsChange}
        target={target}
        onTargetChange={onTargetChange}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <MonthlyChart insights={insights} m={m} />
        <LastThree insights={insights} />
      </div>
      <Quarters quarterTotals={quarterTotals} insights={insights} />
      <HowItWorks />
    </div>
  );
}

function RankedBars({
  items,
}: {
  items: { label: string; value: number; hint?: string }[];
}) {
  if (items.length === 0)
    return <p className="text-sm text-muted-foreground">No data.</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  return (
    <ol className="space-y-3">
      {items.map((it, i) => (
        <li key={`${it.label}-${i}`} className="flex items-center gap-3">
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums",
              i === 0 ? "bg-viz-1 text-white" : "bg-muted text-muted-foreground",
            )}
          >
            {i + 1}
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate font-medium" dir="auto" title={it.hint ?? it.label}>
                {it.label}
              </span>
              <span className="shrink-0 tabular-nums">
                {full(it.value)}{" "}
                <span className="text-muted-foreground">
                  · {((it.value / total) * 100).toFixed(1)}%
                </span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-viz-1"
                initial={{ width: 0 }}
                animate={{ width: `${(it.value / max) * 100}%` }}
                transition={{ duration: 0.7, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ContractBreakdown({
  insights,
  linkRuns,
  onLinkRunsChange,
}: {
  insights: Insights;
  linkRuns: boolean;
  onLinkRunsChange: (v: boolean) => void;
}) {
  const topItems = linkRuns ? linkRunItems(insights.topItems) : insights.topItems;
  const bonusRate =
    insights.paidUnits > 0 ? (insights.bonusUnits / insights.paidUnits) * 100 : 0;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <section className={card}>
          <SectionTitle
            icon={Truck}
            title="Spend by supplier"
            hint="Which distributors the buy went through, with share of total."
          />
          <RankedBars
            items={insights.bySupplier.map((s) => ({ label: s.name, value: s.value }))}
          />
        </section>
        <section className={card}>
          <SectionTitle
            icon={Package}
            title="Top 10 items"
            hint={
              linkRuns
                ? "تشغيلات linked — every price-tag code of a product counts as one item."
                : "The items that drive the most buy value, per code."
            }
            right={
              <div
                className="inline-flex rounded-lg border border-border bg-secondary p-0.5 text-xs"
                title="تشغيلات: codes of one product that differ only by a price tag (ت.ق / ت.ج / ت.ج2 …)"
              >
                {(
                  [
                    [false, "By code"],
                    [true, "Link تشغيلات"],
                  ] as [boolean, string][]
                ).map(([v, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => onLinkRunsChange(v)}
                    aria-pressed={linkRuns === v}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-medium transition-colors",
                      linkRuns === v
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          />
          <RankedBars
            items={topItems.slice(0, 10).map((t) => ({
              label: t.product || t.code,
              value: t.value,
              hint: `${t.code} — ${t.product}`,
            }))}
          />
        </section>
      </div>

      <section className={card}>
        <SectionTitle
          icon={Gift}
          title="Bonus received (بونص)"
          hint="Free goods on bonus lines (أساسي = 100%) — not counted in the total buy."
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Free goods value</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {full(insights.bonusValue)}{" "}
              <span className="text-xs font-medium text-muted-foreground">
                {CURRENCY}
              </span>
            </p>
          </div>
          <div className="rounded-xl bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Free units</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {insights.bonusUnits.toLocaleString("en-US")}
            </p>
          </div>
          <div className="rounded-xl bg-muted/50 p-4">
            <p className="text-xs text-muted-foreground">Bonus rate</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {bonusRate.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground">of paid units</p>
          </div>
        </div>
      </section>
    </div>
  );
}
