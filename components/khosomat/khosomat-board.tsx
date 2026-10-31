"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { monthLabel } from "@/lib/dates";
import { normalizeCompany } from "@/lib/expiry";
import { productKey } from "@/lib/tasfya/productKey";
import { bonusPercent } from "@/lib/tasfya/report";
import { loadStock } from "@/lib/tasfya/stockCache";
import type { PurchaseLine, StockItem } from "@/lib/tasfya/types";

type MonthData = {
  month: string;
  orders: { supplier: string; items: { code: string; name: string }[] }[];
  lines: PurchaseLine[];
};

type Status = "first" | "same" | "lower" | "higher";

// One purchase of one product on one invoice: all its lines (paid + بونص)
// rolled together. أساسي / إضافي / خاص are each kept (and compared) on their
// own, qty-weighted over the paid
// lines; bonus % = bonus units / paid units.
type Purchase = {
  id: string;
  company: string; // normalized company key
  month: string;
  distributor: string;
  invoice: string;
  date: string;
  key: string; // productKey
  name: string;
  codes: string[]; // item code(s) on this invoice — تشغيلات variants
  paid: number;
  bonus: number;
  basic: number;
  extra: number;
  special: number;
  bonusPct: number;
  usualBasic: number | null;
  usualExtra: number | null;
  usualSpecial: number | null;
  usualBonus: number | null;
  basicStatus: Status;
  extraStatus: Status;
  specialStatus: Status;
  bonusStatus: Status;
};

// Distributors removed from a company's view, saved on this PC as
// "<company key>|<distributor>" entries.
const HIDDEN_KEY = "khosomat:hidden";
const hiddenId = (company: string, distributor: string) =>
  `${company}|${distributor}`;

function loadHidden(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtPct = (n: number | null) =>
  n === null ? "—" : `${round2(n).toLocaleString("en-US")}%`;
const isIssue = (p: Purchase) =>
  p.basicStatus === "lower" ||
  p.extraStatus === "lower" ||
  p.specialStatus === "lower" ||
  p.bonusStatus === "lower";

// The three discount types, compared one by one (never summed).
const DISCOUNTS = [
  { label: "أساسي", value: "basic", usual: "usualBasic", status: "basicStatus" },
  { label: "إضافي", value: "extra", usual: "usualExtra", status: "extraStatus" },
  { label: "خاص", value: "special", usual: "usualSpecial", status: "specialStatus" },
] as const;

// Most common value; ties go to the most recent of the tied values (the
// purchases are passed newest first).
function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  let bestCount = 0;
  for (const v of values) {
    const c = counts.get(v) ?? 0;
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

// Discount differences within ±1.5% of the usual count as the same.
const DISCOUNT_MARGIN = 1.5;

function compare(value: number, usual: number | null, margin = 0): Status {
  if (usual === null) return "first";
  if (Math.abs(value - usual) <= margin + 0.005) return "same";
  return value < usual ? "lower" : "higher";
}

// Ties each month's buy lines to the important companies and rolls them into
// purchases. A line belongs to a company when its code is one of the company's
// codes in the stock master (المورد), or its code / product key matches an item
// on the company's supply orders that month (same rule as the Orders
// "Received" column).
function buildPurchases(
  companies: Map<string, string>,
  months: MonthData[],
  stock: StockItem[],
): Purchase[] {
  const stockCodes = new Map<string, string>(); // code → company key
  for (const it of stock) {
    const c = normalizeCompany(it.supplier);
    if (companies.has(c)) stockCodes.set(String(it.code), c);
  }

  const groups = new Map<string, Purchase>();
  for (const m of months) {
    const codeTo = new Map(stockCodes);
    const keyTo = new Map<string, string>();
    for (const o of m.orders) {
      const c = normalizeCompany(o.supplier ?? "");
      if (!companies.has(c)) continue;
      for (const it of o.items) {
        if (it.code && !codeTo.has(String(it.code))) codeTo.set(String(it.code), c);
        const k = productKey(it.name);
        if (k && !keyTo.has(k)) keyTo.set(k, c);
      }
    }

    for (const line of m.lines) {
      const key = productKey(line.name);
      const company = codeTo.get(String(line.code)) ?? keyTo.get(key);
      if (!company || !key) continue;
      const distributor = (line.company ?? "").trim() || "—";
      const id = `${company}|${m.month}|${distributor}|${line.invoice}|${line.date}|${key}`;
      let p = groups.get(id);
      if (!p) {
        p = {
          id,
          company,
          month: m.month,
          distributor,
          invoice: line.invoice,
          date: line.date,
          key,
          name: line.name,
          codes: [],
          paid: 0,
          bonus: 0,
          basic: 0,
          extra: 0,
          special: 0,
          bonusPct: 0,
          usualBasic: null,
          usualExtra: null,
          usualSpecial: null,
          usualBonus: null,
          basicStatus: "first",
          extraStatus: "first",
          specialStatus: "first",
          bonusStatus: "first",
        };
        groups.set(id, p);
      }
      const code = String(line.code ?? "").trim();
      if (code && !p.codes.includes(code)) p.codes.push(code);
      if (line.basicPct === 100) {
        p.bonus += line.kmya;
      } else {
        // Accumulate qty-weighted sums; turned into averages below.
        p.paid += line.kmya;
        p.basic += line.basicPct * line.kmya;
        p.extra += line.extraPct * line.kmya;
        p.special += line.specialPct * line.kmya;
      }
    }
  }

  const purchases = [...groups.values()].filter((p) => p.paid > 0);
  for (const p of purchases) {
    p.basic = round2(p.basic / p.paid);
    p.extra = round2(p.extra / p.paid);
    p.special = round2(p.special / p.paid);
    p.bonusPct = bonusPercent(p.paid + p.bonus, p.bonus);
  }

  // Newest first, so `mode` ties favour the latest terms.
  purchases.sort(
    (a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, "ar"),
  );

  // The usual = most common value across every purchase of that product from
  // that distributor for that company. A single purchase has nothing to compare.
  const history = new Map<string, Purchase[]>();
  for (const p of purchases) {
    const h = `${p.company}|${p.distributor}|${p.key}`;
    const list = history.get(h);
    if (list) list.push(p);
    else history.set(h, [p]);
  }
  for (const list of history.values()) {
    if (list.length < 2) continue;
    const usualBasic = mode(list.map((p) => p.basic));
    const usualExtra = mode(list.map((p) => p.extra));
    const usualSpecial = mode(list.map((p) => p.special));
    const usualBonus = mode(list.map((p) => p.bonusPct));
    for (const p of list) {
      p.usualBasic = usualBasic;
      p.usualExtra = usualExtra;
      p.usualSpecial = usualSpecial;
      p.usualBonus = usualBonus;
      p.basicStatus = compare(p.basic, usualBasic, DISCOUNT_MARGIN);
      p.extraStatus = compare(p.extra, usualExtra, DISCOUNT_MARGIN);
      p.specialStatus = compare(p.special, usualSpecial, DISCOUNT_MARGIN);
      p.bonusStatus = compare(p.bonusPct, usualBonus);
    }
  }
  return purchases;
}

// The verdict cell: how this buy compares with the usual, in plain words.
function ResultCell({
  status,
  value,
  usual,
  label,
}: {
  status: Status;
  value: number;
  usual: number | null;
  label?: string;
}) {
  const diff = usual === null ? 0 : round2(Math.abs(value - usual));
  if (status === "lower") {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-600 dark:text-red-400">
        <ArrowDown className="size-3.5" /> {label} Less by {diff}%
      </span>
    );
  }
  if (status === "higher") {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
        <ArrowUp className="size-3.5" /> {label} More by {diff}%
      </span>
    );
  }
  if (status === "first") {
    return (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        New — nothing to compare
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground">
      <Check className="size-3.5" /> Same as usual
    </span>
  );
}

// One discount type's cell: this buy's %, the usual under it, tinted when it
// came lower (red) or higher (green) than usual.
function DiscountCell({
  value,
  usual,
  status,
  first,
}: {
  value: number;
  usual: number | null;
  status: Status;
  first: boolean;
}) {
  return (
    <td
      className={cn(
        "tabular-nums",
        first && "border-l",
        status === "lower" && "bg-red-500/15 text-red-700 dark:text-red-400",
        status === "higher" &&
          "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
      )}
    >
      <div className="font-semibold">{fmtPct(value)}</div>
      {usual !== null && (
        <div className="text-[11px] text-muted-foreground">usual {fmtPct(usual)}</div>
      )}
    </td>
  );
}

// The discount verdict: each type that changed, on its own line.
function DiscountResult({ p }: { p: Purchase }) {
  const changed = DISCOUNTS.filter(
    (d) => p[d.status] === "lower" || p[d.status] === "higher",
  );
  if (changed.length === 0) {
    return (
      <ResultCell
        status={p.basicStatus}
        value={p.basic}
        usual={p.usualBasic}
      />
    );
  }
  return (
    <div className="flex flex-col items-center gap-1">
      {changed.map((d) => (
        <ResultCell
          key={d.value}
          label={d.label}
          status={p[d.status]}
          value={p[d.value]}
          usual={p[d.usual]}
        />
      ))}
    </div>
  );
}

// A bonus % in words: 0 means the buy came without بونص.
const fmtBonus = (n: number | null) =>
  n === null ? "—" : n === 0 ? "No bonus" : fmtPct(n);

export function KhosomatBoard() {
  const [loading, setLoading] = React.useState(true);
  // Normalized key → display name, for every company flagged important.
  const [companies, setCompanies] = React.useState<Map<string, string>>(
    new Map(),
  );
  const [months, setMonths] = React.useState<MonthData[]>([]);
  const [stock, setStock] = React.useState<StockItem[]>([]);
  const [hasStock, setHasStock] = React.useState(true);

  const [selected, setSelected] = React.useState("");
  const [month, setMonth] = React.useState("all");
  const [distributor, setDistributor] = React.useState("all");
  const [onlyIssues, setOnlyIssues] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [hidden, setHidden] = React.useState<Set<string>>(loadHidden);

  const toggleHidden = (company: string, distributor: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      const id = hiddenId(company, distributor);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
      } catch {
        // Best-effort persistence.
      }
      return next;
    });
  };

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [ordersRes, dataRes, s] = await Promise.all([
        fetch("/api/orders"),
        fetch("/api/khosomat"),
        loadStock().catch(() => null),
      ]);
      if (!ordersRes.ok || !dataRes.ok) throw new Error();
      const ordersData = await ordersRes.json();
      const data = await dataRes.json();

      const map = new Map<string, string>();
      for (const o of (ordersData.orders ?? []) as Record<string, string>[]) {
        if ((o.important ?? "").trim().toLowerCase() !== "yes") continue;
        const name = (o.companyName ?? "").trim();
        const key = normalizeCompany(name);
        if (key && !map.has(key)) map.set(key, name);
      }
      setCompanies(map);
      setMonths(Array.isArray(data.months) ? data.months : []);
      setStock(s?.items ?? []);
      setHasStock(!!s);
    } catch {
      toast.error("Couldn't load the خصومات data.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const allPurchases = React.useMemo(
    () => buildPurchases(companies, months, stock),
    [companies, months, stock],
  );
  // Purchases from removed distributors are left out everywhere (cards, table,
  // issue counts).
  const purchases = React.useMemo(
    () =>
      allPurchases.filter(
        (p) => !hidden.has(hiddenId(p.company, p.distributor)),
      ),
    [allPurchases, hidden],
  );

  // Per company: purchase count + issues (lower discount / bonus), for the list.
  const companyStats = React.useMemo(() => {
    const m = new Map<string, { count: number; issues: number }>();
    for (const key of companies.keys()) m.set(key, { count: 0, issues: 0 });
    for (const p of purchases) {
      const s = m.get(p.company);
      if (!s) continue;
      s.count++;
      if (isIssue(p)) s.issues++;
    }
    return [...m.entries()]
      .map(([key, s]) => ({ key, name: companies.get(key) ?? key, ...s }))
      .sort(
        (a, b) =>
          b.issues - a.issues ||
          b.count - a.count ||
          a.name.localeCompare(b.name, "ar"),
      );
  }, [companies, purchases]);

  // Default to the company with the most issues.
  const active = selected || companyStats[0]?.key || "";

  // This company's removed distributors, for the restore chips.
  const hiddenHere = React.useMemo(() => {
    const prefix = `${active}|`;
    return [...hidden]
      .filter((id) => id.startsWith(prefix))
      .map((id) => id.slice(prefix.length));
  }, [hidden, active]);

  const companyPurchases = React.useMemo(
    () => purchases.filter((p) => p.company === active),
    [purchases, active],
  );

  // The company's terms per distributor: usual discount / bonus across all its
  // purchases from that distributor.
  const distributorSummary = React.useMemo(() => {
    const m = new Map<string, Purchase[]>();
    for (const p of companyPurchases) {
      const list = m.get(p.distributor);
      if (list) list.push(p);
      else m.set(p.distributor, [p]);
    }
    return [...m.entries()]
      .map(([name, list]) => ({
        name,
        invoices: new Set(list.map((p) => `${p.invoice}|${p.date}`)).size,
        lastDate: list[0].date,
        basic: mode(list.map((p) => p.basic)),
        extra: mode(list.map((p) => p.extra)),
        special: mode(list.map((p) => p.special)),
        bonus: mode(list.map((p) => p.bonusPct)),
        withBonus: list.filter((p) => p.bonus > 0).length,
        items: list.length,
        issues: list.filter(isIssue).length,
      }))
      .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  }, [companyPurchases]);

  const monthOptions = React.useMemo(
    () => [...new Set(companyPurchases.map((p) => p.month))].sort().reverse(),
    [companyPurchases],
  );

  // Items (per distributor) with at least one buy that came lower than usual.
  const issueItems = React.useMemo(() => {
    const set = new Set<string>();
    for (const p of companyPurchases) {
      if (isIssue(p)) set.add(`${p.distributor}|${p.key}`);
    }
    return set;
  }, [companyPurchases]);

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = companyPurchases.filter(
      (p) =>
        (month === "all" || p.month === month) &&
        (distributor === "all" || p.distributor === distributor) &&
        (!onlyIssues || issueItems.has(`${p.distributor}|${p.key}`)) &&
        (!q ||
          p.name.toLowerCase().includes(q) ||
          p.invoice.toLowerCase().includes(q) ||
          p.codes.some((c) => c.includes(q))),
    );
    // Codes-with-issues view: keep each item's buys together (newest first) so
    // the bad buy sits right next to the usual ones.
    if (onlyIssues) {
      rows.sort(
        (a, b) =>
          a.name.localeCompare(b.name, "ar") ||
          a.distributor.localeCompare(b.distributor, "ar") ||
          b.date.localeCompare(a.date),
      );
    }
    return rows;
  }, [companyPurchases, issueItems, month, distributor, onlyIssues, query]);

  const selectCompany = (key: string) => {
    setSelected(key);
    setMonth("all");
    setDistributor("all");
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading purchases…
      </div>
    );
  }

  if (companies.size === 0) {
    return (
      <p className="rounded-lg border p-6 text-sm text-muted-foreground">
        No important companies yet — flag orders as Important on the Orders page.
      </p>
    );
  }

  const selectedName = companies.get(active) ?? "";

  return (
    <div className="space-y-4">
      {!hasStock && (
        <p className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="size-4 shrink-0" />
          No stock file saved on this PC — purchases are matched only through the
          supply orders, so some items may be missing. Upload the stock file on
          the Orders page.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Important companies, most issues first. */}
        <aside className="h-fit rounded-lg border">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Important companies
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={load}
              title="Reload"
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
          <ul className="max-h-[70vh] overflow-y-auto p-1">
            {companyStats.map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={() => selectCompany(c.key)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                    active === c.key && "bg-muted font-medium",
                  )}
                >
                  <span dir="auto" className="truncate">
                    {c.name}
                  </span>
                  {c.issues > 0 ? (
                    <span className="shrink-0 rounded-full bg-red-500/15 px-1.5 text-[11px] font-semibold text-red-600 dark:text-red-400">
                      {c.issues}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {c.count || "—"}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold" dir="auto">
              <Link
                href={`/company/${encodeURIComponent(selectedName)}`}
                className="hover:underline"
              >
                {selectedName}
              </Link>
            </h2>
            <span className="text-xs text-muted-foreground">
              {companyPurchases.length} purchases
            </span>
          </div>

          {hiddenHere.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Removed:</span>
              {hiddenHere.map((name) => (
                <button
                  type="button"
                  key={name}
                  onClick={() => toggleHidden(active, name)}
                  title="Bring this distributor back"
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 hover:bg-muted"
                >
                  <span dir="auto">{name}</span>
                  <RefreshCw className="size-3" />
                </button>
              ))}
            </div>
          )}

          {companyPurchases.length === 0 ? (
            <p className="rounded-lg border p-6 text-sm text-muted-foreground">
              No purchases found for this company in the uploaded Buy files.
            </p>
          ) : (
            <>
              {/* Usual terms per distributor. */}
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {distributorSummary.map((d) => (
                  <div
                    role="button"
                    tabIndex={0}
                    key={d.name}
                    onClick={() =>
                      setDistributor((prev) => (prev === d.name ? "all" : d.name))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDistributor((prev) =>
                          prev === d.name ? "all" : d.name,
                        );
                      }
                    }}
                    className={cn(
                      "cursor-pointer rounded-lg border p-3 text-left transition-colors hover:bg-muted/50",
                      distributor === d.name && "border-primary bg-muted/50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span dir="auto" className="truncate text-sm font-medium">
                        {d.name}
                      </span>
                      <div className="flex shrink-0 items-center gap-1">
                        {d.issues > 0 && (
                          <span className="rounded-full bg-red-500/15 px-1.5 text-[11px] font-semibold text-red-600 dark:text-red-400">
                            {d.issues} lower
                          </span>
                        )}
                        <button
                          type="button"
                          title="Remove this distributor"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (distributor === d.name) setDistributor("all");
                            toggleHidden(active, d.name);
                          }}
                          className="rounded p-0.5 text-muted-foreground hover:bg-red-500/15 hover:text-red-600"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4">
                      {DISCOUNTS.map((x) => (
                        <div key={x.value}>
                          <div className="text-[11px] text-muted-foreground">
                            Usual {x.label}
                          </div>
                          <div className="text-lg font-semibold tabular-nums">
                            {fmtPct(d[x.value])}
                          </div>
                        </div>
                      ))}
                      <div>
                        <div className="text-[11px] text-muted-foreground">
                          Usual bonus
                        </div>
                        <div className="text-lg font-semibold tabular-nums">
                          {fmtPct(d.bonus)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {d.invoices} invoices · {d.items} items · bonus on{" "}
                      {d.withBonus} · last {d.lastDate}
                    </div>
                  </div>
                ))}
              </div>

              {/* Filters. */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search item / code / invoice"
                    className="h-8 w-56 rounded-md border bg-background pl-7 pr-2 text-sm"
                  />
                </div>
                <select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="all">All months</option>
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m)}
                    </option>
                  ))}
                </select>
                <select
                  value={distributor}
                  onChange={(e) => setDistributor(e.target.value)}
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="all">All distributors</option>
                  {distributorSummary.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.name}
                    </option>
                  ))}
                </select>
                <Button
                  variant={onlyIssues ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => setOnlyIssues((v) => !v)}
                  disabled={issueItems.size === 0 && !onlyIssues}
                  title="Show only the codes that came with a lower discount or bonus, with all their buys"
                >
                  <AlertTriangle className="size-3.5" />
                  {onlyIssues ? "Show all codes" : "Codes with issues"}
                  <span className="rounded-full bg-background/20 px-1.5 text-[11px] font-semibold">
                    {issueItems.size}
                  </span>
                </Button>
                <span className="ml-auto text-xs text-muted-foreground">
                  {visible.length} rows
                </span>
              </div>

              {/* How to read the table. */}
              <p className="rounded-md bg-muted/40 px-3 py-2 text-center text-xs text-muted-foreground">
                Each row is one item on one invoice.{" "}
                <b className="text-foreground">This buy</b> is what you got;{" "}
                <b className="text-foreground">Usual</b> is what you normally get
                for the same item from the same distributor. A{" "}
                <span className="font-semibold text-red-600 dark:text-red-400">
                  red row
                </span>{" "}
                means the discount or bonus came less than usual. Discount
                differences within ±{DISCOUNT_MARGIN}% are ignored.
              </p>

              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm [&_td]:text-center [&_th]:text-center">
                  <thead className="text-xs">
                    <tr className="bg-muted/50 [&>th]:px-2 [&>th]:pt-2 [&>th]:font-semibold">
                      <th colSpan={6} className="text-muted-foreground">
                        Purchase
                      </th>
                      <th
                        colSpan={4}
                        className="border-l bg-blue-500/10 text-blue-700 dark:text-blue-300"
                      >
                        Discount — الخصم
                      </th>
                      <th
                        colSpan={4}
                        className="border-l bg-violet-500/10 text-violet-700 dark:text-violet-300"
                      >
                        Bonus — البونص
                      </th>
                    </tr>
                    <tr className="bg-muted/50 text-muted-foreground [&>th]:whitespace-nowrap [&>th]:px-2 [&>th]:py-2 [&>th]:font-medium">
                      <th>Date</th>
                      <th>Invoice</th>
                      <th>Distributor</th>
                      <th>Code</th>
                      <th>Item</th>
                      <th>Qty</th>
                      <th className="border-l bg-blue-500/5">أساسي</th>
                      <th className="bg-blue-500/5">إضافي</th>
                      <th className="bg-blue-500/5">خاص</th>
                      <th className="bg-blue-500/5">Result</th>
                      <th className="border-l bg-violet-500/5">Free units</th>
                      <th className="bg-violet-500/5">This buy</th>
                      <th className="bg-violet-500/5">Usual</th>
                      <th className="bg-violet-500/5">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((p) => (
                      <tr
                        key={p.id}
                        className={cn(
                          "border-t [&>td]:px-2 [&>td]:py-2",
                          isIssue(p) && "bg-red-500/10",
                        )}
                      >
                        <td className="whitespace-nowrap tabular-nums">{p.date}</td>
                        <td className="whitespace-nowrap tabular-nums">{p.invoice}</td>
                        <td dir="auto" className="whitespace-nowrap">
                          {p.distributor}
                        </td>
                        <td className="whitespace-nowrap font-mono text-xs tabular-nums">
                          {p.codes.join(" / ")}
                        </td>
                        <td dir="auto" className="min-w-48">
                          {p.name}
                        </td>
                        <td className="tabular-nums">
                          {p.paid.toLocaleString("en-US")}
                        </td>
                        {DISCOUNTS.map((d, i) => (
                          <DiscountCell
                            key={d.value}
                            first={i === 0}
                            value={p[d.value]}
                            usual={p[d.usual]}
                            status={p[d.status]}
                          />
                        ))}
                        <td>
                          <DiscountResult p={p} />
                        </td>
                        <td className="border-l tabular-nums">
                          {p.bonus ? p.bonus.toLocaleString("en-US") : "—"}
                        </td>
                        <td className="whitespace-nowrap font-semibold tabular-nums">
                          {fmtBonus(p.bonusPct)}
                        </td>
                        <td className="whitespace-nowrap tabular-nums text-muted-foreground">
                          {fmtBonus(p.usualBonus)}
                        </td>
                        <td>
                          <ResultCell
                            status={p.bonusStatus}
                            value={p.bonusPct}
                            usual={p.usualBonus}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
