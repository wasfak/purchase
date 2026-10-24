"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, PackageX } from "lucide-react";

import { cn } from "@/lib/utils";
import { monthLabel } from "@/lib/dates";
import { loadStock } from "@/lib/tasfya/stockCache";
import { stockForCompany } from "@/lib/tasfya/stock";
import { computeReport } from "@/lib/tasfya/report";
import { combineCompanyOrders } from "@/lib/tasfya/supplyOrders";
import type { PurchaseLine, StockItem, SupplyOrder } from "@/lib/tasfya/types";
import { isReviewDue } from "@/lib/order-review";
import { RunClient } from "@/components/auto-tasfya/run-client";

// Quick per-company counts shown on each tab, from the raw computed settlement
// (before any saved manual edits — the tab itself shows the edited values).
type Summary = {
  matched: number;
  neg: number; // لم يصل
  pos: number; // زياده
  zero: number; // وصل
  extras: number; // زائد (bought, not ordered)
};

// The batch Auto Tasfya page: every company with a "Review tasfya" order in the
// month (from the Orders page's "Tasfya all" button) gets a tab, each running the full
// settlement view. The month's pos + buy data is fetched ONCE to compute the
// tab counts; a tab's full view mounts on first open and then stays mounted
// (hidden), so unsaved edits survive switching between companies.
export function BatchClient() {
  const params = useSearchParams();
  const month = params.get("month") ?? "";

  // This month's "Review tasfya" companies, read from the orders here (not the
  // URL — long Arabic names in the link overflowed the header limit, HTTP 431).
  // `null` while loading.
  const [companies, setCompanies] = React.useState<string[] | null>(null);
  const [active, setActive] = React.useState<string>("");
  const [opened, setOpened] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    if (!month) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/orders");
        if (!res.ok) throw new Error();
        const { orders } = (await res.json()) as {
          orders: {
            companyName?: string;
            month?: string;
            sendDate?: string;
            reviewed?: string;
            finished?: string;
          }[];
        };
        // Same rows the Orders table shows for the month: its own rows plus
        // any still-unassigned (blank month) ones.
        const list = [
          ...new Set(
            orders
              .filter((o) => {
                const m = (o.month ?? "").trim();
                return !m || m === month;
              })
              .filter(isReviewDue)
              .map((o) => (o.companyName ?? "").trim())
              .filter(Boolean),
          ),
        ];
        if (!alive) return;
        setCompanies(list);
        if (list[0]) {
          setActive(list[0]);
          setOpened(new Set([list[0]]));
        }
      } catch {
        if (alive) setCompanies([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [month]);
  const [summaries, setSummaries] = React.useState<Map<string, Summary> | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [noStock, setNoStock] = React.useState(false);

  React.useEffect(() => {
    if (!month || !companies || companies.length === 0) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(
          `/api/auto-tasfya/data?month=${encodeURIComponent(month)}&all=1`,
        );
        if (!res.ok) throw new Error();
        const data: {
          hasPos: boolean;
          orders: SupplyOrder[];
          lines: PurchaseLine[];
        } = await res.json();
        const cached = await loadStock();
        const stockItems: StockItem[] = cached?.items ?? [];

        const map = new Map<string, Summary>();
        for (const company of companies) {
          const combined = combineCompanyOrders(data.orders, company);
          const report = computeReport(
            {
              items: combined.items,
              referenceDate: combined.referenceDate,
              orderNumber: combined.orderNumbers.join(", "),
              supplierCompany: company,
            },
            data.lines,
            stockForCompany(stockItems, company),
          );
          const s: Summary = {
            matched: combined.matched,
            neg: 0,
            pos: 0,
            zero: 0,
            extras: report.extraItems.length,
          };
          for (const r of report.report) {
            if (r.tasfya < 0) s.neg++;
            else if (r.tasfya === 0) s.zero++;
            else s.pos++;
          }
          map.set(company, s);
        }
        if (!alive) return;
        setSummaries(map);
        setNoStock(!cached);
        if (!data.hasPos)
          setError("No pos file saved for this month. Upload it in Auto Tasfya.");
      } catch {
        if (alive) setError("Couldn't load the month's settlement data.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [month, companies]);

  const open = (company: string) => {
    setActive(company);
    setOpened((prev) => (prev.has(company) ? prev : new Set(prev).add(company)));
  };

  if (month && companies === null) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading Review tasfya orders…
      </div>
    );
  }

  if (!month || !companies || companies.length === 0) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No Review tasfya orders to settle this month.
      </div>
    );
  }

  return (
    <main dir="ltr" className="mx-auto w-full max-w-[120rem] space-y-3 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Auto Tasfya — all Review tasfya
          </h1>
          <p className="text-sm text-muted-foreground">
            {monthLabel(month)} · {companies.length} compan
            {companies.length === 1 ? "y" : "ies"} · counts are before saved
            edits
          </p>
        </div>
        {noStock && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-400">
            <PackageX className="size-3.5" /> no stock on this PC — زائد items
            won&apos;t show
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Company tabs */}
      <div className="flex flex-wrap gap-1.5">
        {companies.map((company) => {
          const s = summaries?.get(company);
          const isActive = company === active;
          const noOrders = s && s.matched === 0;
          return (
            <button
              key={company}
              type="button"
              onClick={() => open(company)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                isActive
                  ? "border-primary bg-primary/10 font-semibold text-primary"
                  : "border-border bg-card hover:bg-muted",
                noOrders && !isActive && "opacity-60",
              )}
              title={
                noOrders
                  ? "No pos orders matched this company name this month"
                  : undefined
              }
            >
              <span dir="auto">{company}</span>
              {!summaries ? (
                <Loader2 className="size-3 animate-spin text-muted-foreground" />
              ) : !s || noOrders ? (
                <span className="text-xs text-muted-foreground">no orders</span>
              ) : (
                <span className="flex items-center gap-1 text-xs font-medium">
                  {s.neg > 0 && (
                    <span
                      className="rounded-full bg-destructive/10 px-1.5 text-destructive"
                      title="لم يصل"
                    >
                      {s.neg}
                    </span>
                  )}
                  {s.pos > 0 && (
                    <span
                      className="rounded-full bg-amber-500/15 px-1.5 text-amber-700 dark:text-amber-400"
                      title="زياده"
                    >
                      {s.pos}
                    </span>
                  )}
                  {s.extras > 0 && (
                    <span
                      className="rounded-full bg-violet-500/15 px-1.5 text-violet-700 dark:text-violet-400"
                      title="زائد (bought, not ordered)"
                    >
                      {s.extras}
                    </span>
                  )}
                  {s.neg === 0 && s.pos === 0 && s.extras === 0 && (
                    <span
                      className="rounded-full bg-emerald-500/15 px-1.5 text-emerald-700 dark:text-emerald-400"
                      title="Everything arrived (وصل)"
                    >
                      ✓
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* One full settlement view per opened company; only the active one shows. */}
      {companies
        .filter((c) => opened.has(c))
        .map((company) => (
          <div key={company} hidden={company !== active}>
            <RunClient month={month} company={company} embedded />
          </div>
        ))}
    </main>
  );
}
