"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Download, Loader2, Target, Trash2, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { computeAchieved, type PurchaseRow } from "@/lib/contracts";
import type { ContractMeta } from "@/lib/contracts-store";
import { loadContract } from "@/lib/server-contracts-store";

const CURRENCY = "EGP";

const money = (v: number) =>
  `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${CURRENCY}`;

// Animated target-vs-achieved donut. Fills to `pct` (0..100+); turns green
// once the target is reached.
function Donut({ pct, hasTarget }: { pct: number; hasTarget: boolean }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const shown = Math.min(100, Math.max(0, pct));
  const reached = hasTarget && pct >= 100;
  return (
    <div className="relative size-36 shrink-0">
      <svg viewBox="0 0 128 128" className="size-full -rotate-90">
        <defs>
          <linearGradient id="donut-grad" x1="0" y1="0" x2="1" y2="1">
            <stop
              offset="0%"
              style={{ stopColor: "var(--primary)", stopOpacity: 0.65 }}
            />
            <stop offset="100%" style={{ stopColor: "var(--primary)" }} />
          </linearGradient>
          <linearGradient id="donut-grad-done" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>
        </defs>
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          strokeWidth="12"
          className="stroke-muted"
        />
        {hasTarget && (
          <motion.circle
            cx="64"
            cy="64"
            r={r}
            fill="none"
            strokeWidth="12"
            strokeLinecap="round"
            stroke={reached ? "url(#donut-grad-done)" : "url(#donut-grad)"}
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: c * (1 - shown / 100) }}
            transition={{ duration: 1.1, ease: "easeOut" }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {hasTarget ? (
          <>
            <span
              className={cn(
                "text-2xl font-bold tabular-nums",
                reached && "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {pct.toFixed(pct >= 100 ? 0 : 1)}%
            </span>
            <span className="text-[11px] text-muted-foreground">
              {reached ? "reached" : "of target"}
            </span>
          </>
        ) : (
          <span className="px-4 text-center text-xs text-muted-foreground">
            No target
          </span>
        )}
      </div>
    </div>
  );
}

function ContractCard({
  meta,
  achieved,
  active,
  onOpen,
  onDelete,
}: {
  meta: ContractMeta;
  achieved: number | undefined;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const target = Number(meta.settings?.target) || 0;
  const value = achieved ?? 0;
  const pct = target > 0 ? (value / target) * 100 : 0;
  const remaining = target - value;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className={cn(
        "group relative flex cursor-pointer flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
        active ? "border-primary/60 ring-2 ring-primary/20" : "border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold" dir="auto">
            {meta.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {new Date(meta.savedAt).toLocaleDateString()} ·{" "}
            {meta.matchedLineCount.toLocaleString()} lines
          </p>
          {meta.ownerName && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <User className="size-3" />
              {meta.mine === false ? meta.ownerName : "You"}
            </p>
          )}
        </div>
        {/* Only the owner can delete; others' contracts are view-only. */}
        {meta.mine !== false && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
            title="Delete saved contract"
            aria-label="Delete saved contract"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-5">
        {achieved === undefined ? (
          <div className="flex size-36 items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Donut pct={pct} hasTarget={target > 0} />
        )}
        <dl className="min-w-0 flex-1 space-y-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Achieved</dt>
            <dd className="font-semibold tabular-nums">
              {achieved === undefined ? "…" : money(value)}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-xs text-muted-foreground">
              <Target className="size-3" /> Target
            </dt>
            <dd className="font-semibold tabular-nums">
              {target > 0 ? money(target) : "—"}
            </dd>
          </div>
          {target > 0 && achieved !== undefined && (
            <div>
              <dt className="text-xs text-muted-foreground">Remaining</dt>
              <dd
                className={cn(
                  "font-semibold tabular-nums",
                  remaining <= 0 && "text-emerald-600 dark:text-emerald-400",
                )}
              >
                {remaining > 0 ? money(remaining) : `+${money(-remaining)}`}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </motion.div>
  );
}

// Placeholder cards shown while saved contracts are being fetched.
function DashboardSkeleton() {
  return (
    <section className="space-y-3" aria-busy="true">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Preparing your contracts…
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex animate-pulse flex-col gap-4 rounded-2xl border border-border bg-card p-5"
          >
            <div className="space-y-2">
              <div className="h-4 w-2/3 rounded bg-muted" />
              <div className="h-3 w-1/3 rounded bg-muted" />
            </div>
            <div className="flex items-center gap-5">
              <div className="size-36 shrink-0 rounded-full border-[12px] border-muted" />
              <div className="flex-1 space-y-3">
                <div className="h-3 w-1/2 rounded bg-muted" />
                <div className="h-4 w-3/4 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted" />
                <div className="h-4 w-2/3 rounded bg-muted" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Landing view of the Contracts page: one card per saved contract with its
 * target-vs-achieved donut. Clicking a card opens that contract.
 */
export function ContractsDashboard({
  saved,
  currentId,
  onOpen,
  onDelete,
  onBackup,
  backingUp,
  loading = false,
}: {
  saved: ContractMeta[];
  currentId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onBackup: () => void;
  backingUp: boolean;
  loading?: boolean;
}) {
  // Achieved for contracts saved before it was stored: computed once from
  // their rows, keyed by id + savedAt so a re-save recomputes.
  const [computed, setComputed] = React.useState<Record<string, number>>({});

  React.useEffect(() => {
    let active = true;
    const missing = saved.filter(
      (m) => m.achieved == null && computed[`${m.id}:${m.savedAt}`] == null,
    );
    if (missing.length === 0) return;
    (async () => {
      for (const m of missing) {
        if (!active) return;
        try {
          const c = await loadContract(m.id);
          if (!c || !active) continue;
          const rows: PurchaseRow[] = c.rows.map((values) =>
            Object.fromEntries(
              c.columns.map((col, ci) => [col, String(values[ci] ?? "")]),
            ),
          );
          const value = computeAchieved(
            rows,
            c.settings?.excludedSuppliers,
            c.settings?.excludedCodes,
          );
          if (active) {
            setComputed((prev) => ({ ...prev, [`${m.id}:${m.savedAt}`]: value }));
          }
        } catch {
          // Leave it loading-free: show 0 rather than spin forever.
          if (active) {
            setComputed((prev) => ({ ...prev, [`${m.id}:${m.savedAt}`]: 0 }));
          }
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [saved, computed]);

  if (loading) return <DashboardSkeleton />;
  if (saved.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          Contracts{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({saved.length})
          </span>
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={onBackup}
          disabled={backingUp}
          title="Download a JSON backup of every saved contract"
        >
          {backingUp ? <Loader2 className="animate-spin" /> : <Download />}
          Backup
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {saved.map((m) => (
          <ContractCard
            key={m.id}
            meta={m}
            achieved={m.achieved ?? computed[`${m.id}:${m.savedAt}`]}
            active={m.id === currentId}
            onOpen={() => onOpen(m.id)}
            onDelete={() => onDelete(m.id)}
          />
        ))}
      </div>
    </section>
  );
}
