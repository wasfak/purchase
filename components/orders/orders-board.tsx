"use client";

import * as React from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { Plus, Upload, Trash2, Loader2, X, Calendar, CopyPlus, Ban, Search, AlarmClock, Check, PackageCheck, Calculator, Plane, StickyNote, ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toDateStr, currentMonthStr, monthLabel } from "@/lib/dates";
import { parseHtmlTable } from "@/lib/tasfya/parseTable";
import { parseStock } from "@/lib/tasfya/stock";
import { saveStock, loadStock, clearStock } from "@/lib/tasfya/stockCache";
import {
  CompanyExpiryModal,
  DaysBadge,
} from "@/components/expiry/company-expiry-modal";
import { FlyingSearchModal } from "@/components/orders/flying-search";
import { daysUntilExpiry, normalizeCompany, type ExpiryRow } from "@/lib/expiry";

// The "Display exp" cell: when the saved expiry snapshot has items for this
// company, a clickable pill (count + soonest) that opens the popup; otherwise a
// muted dash so the column reads cleanly for companies with nothing expiring.
function ExpiryCell({
  rows,
  today,
  onOpen,
}: {
  rows: ExpiryRow[] | undefined;
  today: Date;
  onOpen: () => void;
}) {
  if (!rows || rows.length === 0)
    return <span className="text-muted-foreground">—</span>;
  // Soonest upcoming (not-yet-expired) expiry only.
  let soonest = Infinity;
  for (const r of rows) {
    const d = daysUntilExpiry(r, today);
    if (d >= 0 && d < soonest) soonest = d;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
      title={`View ${rows.length} near-expiry item(s)`}
    >
      <AlarmClock className="size-3" />
      {rows.length}
      {soonest !== Infinity && (
        <span className="opacity-80">
          · <DaysBadge days={soonest} />
        </span>
      )}
    </button>
  );
}

// How many days after the send date before we nudge you to review the order
// ("tasfya" / settlement) — i.e. check whether it actually arrived.
const REVIEW_AFTER_DAYS = 5;

// Whether the user has manually marked this order as reviewed ("tasfya" done).
function isReviewed(order: Order): boolean {
  return (order.reviewed ?? "").trim() === "yes";
}

// The review reminder state for one order, derived from its send date:
//  - "none":     no send date yet, nothing to review.
//  - "reviewed": the user manually ticked it off — settled (green).
//  - "done":     the order is finished, so it's already settled.
//  - "due":      REVIEW_AFTER_DAYS+ days have passed since sending — remind now.
//  - "waiting":  sent, but the review day hasn't arrived yet (still counting).
// `days` is how many days remain until review (waiting) or have passed (due).
function reviewStatus(order: Order): {
  state: "none" | "reviewed" | "done" | "due" | "waiting";
  days: number;
} {
  const send = (order.sendDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(send)) return { state: "none", days: 0 };
  if (isReviewed(order)) return { state: "reviewed", days: 0 };
  if ((order.finished ?? "").trim()) return { state: "done", days: 0 };

  const sent = new Date(`${send}T00:00:00`);
  const due = new Date(sent);
  due.setDate(due.getDate() + REVIEW_AFTER_DAYS);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diffDays = Math.round((now.getTime() - due.getTime()) / 86_400_000);
  if (diffDays >= 0) return { state: "due", days: diffDays };
  return { state: "waiting", days: -diffDays };
}

// The "Review tasfya" cell: reminds you to check an order once REVIEW_AFTER_DAYS
// have passed since its send date. Click it to tick it off as reviewed (green);
// click again to clear. The reviewed flag is saved on the order.
function ReviewCell({
  order,
  onToggle,
  busy,
}: {
  order: Order;
  onToggle: () => void;
  busy: boolean;
}) {
  const { state, days } = reviewStatus(order);
  // No send date yet — nothing to review, and nothing to toggle.
  if (state === "none") return <span className="text-muted-foreground">—</span>;
  // Finished by its own date, not a manual review — leave as a settled marker.
  if (state === "done")
    return (
      <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
        Settled
      </span>
    );

  const label =
    state === "reviewed" ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
        <Check className="size-3" />
        Reviewed
      </span>
    ) : state === "due" ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
        <AlarmClock className="size-3" />
        Review tasfya
      </span>
    ) : (
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        in {days} day{days === 1 ? "" : "s"}
      </span>
    );

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      className="-mx-1 rounded px-1 py-0.5 transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-50"
      title={
        state === "reviewed"
          ? "Reviewed — click to clear"
          : "Click to mark as reviewed"
      }
    >
      {label}
    </button>
  );
}

type FieldType = "text" | "date" | "textarea" | "day" | "yesno";

type Column = { key: string; label: string; type: FieldType };

const COLUMNS: Column[] = [
  { key: "companyName", label: "Company name", type: "text" },
  { key: "important", label: "Important", type: "yesno" },
  { key: "orderDay", label: "Order day", type: "day" },
  { key: "dateOfDoing", label: "Date of doing", type: "date" },
  { key: "inReview", label: "In review", type: "date" },
  { key: "sendDate", label: "Send date", type: "date" },
  { key: "toWhere", label: "To where", type: "text" },
  { key: "exp", label: "Expired items", type: "textarea" },
  { key: "damaged", label: "Damaged", type: "textarea" },
  { key: "finished", label: "Finished", type: "date" },
  { key: "notes", label: "Order notes", type: "textarea" },
];

// Fields that can be changed after the order is created. Company name is set
// once, at creation, and is read-only afterwards.
const EDITABLE_FIELDS = new Set([
  "important",
  "orderDay",
  "dateOfDoing",
  "inReview",
  "sendDate",
  "toWhere",
  "exp",
  "damaged",
  "finished",
  "notes",
]);

// Excel header (lowercased) -> field. Includes a few sensible aliases.
const HEADER_ALIASES: Record<string, string> = {
  "company name": "companyName",
  company: "companyName",
  "order day": "orderDay",
  "order date": "orderDay",
  day: "orderDay",
  "date of doing": "dateOfDoing",
  "in review": "inReview",
  "send date": "sendDate",
  "to where": "toWhere",
  where: "toWhere",
  exp: "exp",
  expired: "exp",
  "expired items": "exp",
  damaged: "damaged",
  finished: "finished",
  "order notes": "notes",
  notes: "notes",
  important: "important",
};

type Order = Record<string, string> & { _id: string };

const emptyForm = (): Record<string, string> =>
  Object.fromEntries(COLUMNS.map((c) => [c.key, ""]));

function displayDate(v: string): string {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return new Date(`${v}T00:00:00`).toLocaleDateString();
  }
  return v;
}

// Best guess at which month an untagged order belongs to, as "YYYY-MM".
// Prefers the dates that reflect when the work actually happened, falling back
// to the created date so an order with no dates still lands somewhere sensible.
// Returns "" when nothing usable is found (leave it unassigned).
function monthFromOrder(o: Order): string {
  for (const key of ["dateOfDoing", "sendDate", "inReview", "finished"]) {
    const v = (o[key] ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.slice(0, 7);
  }
  const created = (o.createdAt ?? "").trim();
  const m = created.match(/^(\d{4}-\d{2})/);
  return m ? m[1] : "";
}

function displayDay(v: string): string {
  const n = parseInt(v, 10);
  if (!n || n < 1 || n > 31) return "";
  return `Day ${n}`;
}

// How many days past the monthly order day before we flag it as overdue.
const OVERDUE_GRACE_DAYS = 3;

// An order is "done" for the month once its date of doing is filled. It's
// overdue when that's still empty and today is more than OVERDUE_GRACE_DAYS
// past that order's due date — the order day within its OWN month (`month` is
// "YYYY-MM"). Measuring against the order's month, not today's calendar month,
// is what keeps a freshly-started future month from showing up red before its
// day has actually arrived.
function isOverdue(order: Order, month: string): boolean {
  const day = parseInt(order.orderDay ?? "", 10);
  if (!day || day < 1 || day > 31) return false;
  if ((order.dateOfDoing ?? "").trim()) return false; // already done
  if (!/^\d{4}-\d{2}$/.test(month)) return false;

  const [year, mo] = month.split("-").map(Number);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const lastOfMonth = new Date(year, mo, 0).getDate();
  const due = new Date(year, mo - 1, Math.min(day, lastOfMonth));
  const diffDays = (now.getTime() - due.getTime()) / 86_400_000;
  return diffDays > OVERDUE_GRACE_DAYS;
}

// How many days ahead of the order day counts as "due soon".
const DUE_SOON_DAYS = 4;

// An order is "due soon" when it's not done and the next real-calendar
// occurrence of its order day is DUE_SOON_DAYS or fewer days away. This is
// measured against today's actual date — not the month sheet being viewed — so
// that when you pre-start next month's sheet, an order whose day is coming up
// this week still lights up amber. e.g. today is the 27th and an order's day is
// the 28th → due tomorrow → amber, even while viewing next month.
function isDueSoon(order: Order): boolean {
  if (isNoNeed(order)) return false; // nothing to do this month
  const day = parseInt(order.orderDay ?? "", 10);
  if (!day || day < 1 || day > 31) return false;
  if ((order.dateOfDoing ?? "").trim()) return false; // already done

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  // The order day in the current real month; if it's already past, roll to the
  // same day next month — that's the next time this order comes due.
  const clampDay = (y: number, m: number) =>
    Math.min(day, new Date(y, m + 1, 0).getDate());
  let due = new Date(now.getFullYear(), now.getMonth(), clampDay(now.getFullYear(), now.getMonth()));
  if (due.getTime() < now.getTime()) {
    due = new Date(now.getFullYear(), now.getMonth() + 1, clampDay(now.getFullYear(), now.getMonth() + 1));
  }
  const daysUntil = (due.getTime() - now.getTime()) / 86_400_000;
  return daysUntil <= DUE_SOON_DAYS;
}

// An order is done once its date of doing is filled — that's what turns the row
// green, so finished orders stand apart from the ones still to do.
function isDone(order: Order): boolean {
  return (order.dateOfDoing ?? "").trim() !== "";
}

// An order is fully finished once its "Finished" date is filled — this turns the
// whole row's text green so completed orders stand out at a glance.
function isFinished(order: Order): boolean {
  return (order.finished ?? "").trim() !== "";
}

// An order counts as fully sent once BOTH its date of doing and send date are
// filled — the "Sent" filter narrows the table down to these.
function isSent(order: Order): boolean {
  return (
    (order.dateOfDoing ?? "").trim() !== "" && (order.sendDate ?? "").trim() !== ""
  );
}

// An order hasn't been started while neither its date of doing nor its send
// date has been filled in yet — the "Not started" filter shows only these.
// Orders marked "no need" this month are excluded, since there's nothing to do.
function isNotStarted(order: Order): boolean {
  return (
    !isNoNeed(order) &&
    (order.dateOfDoing ?? "").trim() === "" &&
    (order.sendDate ?? "").trim() === ""
  );
}

// The user has marked this company as not needing an order this month.
function isNoNeed(order: Order): boolean {
  return (order.noNeed ?? "").trim() === "yes";
}

// The user flagged this order as important for this month.
function isImportant(order: Order): boolean {
  return (order.important ?? "").trim().toLowerCase() === "yes";
}

// The row filters applied on top of the selected month. Multiple can be active
// at once — a row must satisfy every selected filter (AND) to be shown.
type OrderFilter =
  | "notStarted"
  | "sent"
  | "noNeed"
  | "important"
  | "dueSoon"
  | "reviewDue"
  | "hideFinished";

// The pickable filters, in display order, each with a label and its predicate.
const FILTER_OPTIONS: {
  value: OrderFilter;
  label: string;
  test: (o: Order) => boolean;
}[] = [
  { value: "notStarted", label: "Not started yet", test: isNotStarted },
  { value: "sent", label: "Sent", test: isSent },
  { value: "noNeed", label: "No need", test: isNoNeed },
  { value: "important", label: "Important", test: isImportant },
  { value: "dueSoon", label: "Due soon", test: isDueSoon },
  { value: "reviewDue", label: "Review tasfya", test: isReviewDue },
  { value: "hideFinished", label: "Hide finished", test: (o) => !isFinished(o) },
];

// An order needs a "review tasfya" nudge when REVIEW_AFTER_DAYS have passed
// since it was sent and it isn't finished yet.
function isReviewDue(order: Order): boolean {
  return reviewStatus(order).state === "due";
}

// The read-only display node for a cell, with a dash fallback when empty.
function cellValue(col: Column, raw: string, overdue: boolean): React.ReactNode {
  if (col.type === "yesno") {
    const yes = raw.trim().toLowerCase() === "yes";
    return (
      <span
        className={cn(
          "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
          yes
            ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
            : "text-muted-foreground",
        )}
      >
        {yes ? "Yes" : "No"}
      </span>
    );
  }
  if (col.type === "day") {
    if (!raw) return <span className="text-muted-foreground">—</span>;
    return (
      <span className={cn(overdue && "font-semibold text-destructive")}>
        {displayDay(raw)}
        {overdue && " · overdue"}
      </span>
    );
  }
  if (col.type === "date") {
    return displayDate(raw) || <span className="text-muted-foreground">—</span>;
  }
  return raw || <span className="text-muted-foreground">—</span>;
}

function parseExcel(file: File): Promise<Record<string, string>[]> {
  return file.arrayBuffer().then((buf) => {
    const wb = XLSX.read(buf, { cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: true,
    });
    return rows.map((row) => {
      const out: Record<string, string> = {};
      for (const rawKey of Object.keys(row)) {
        const field = HEADER_ALIASES[rawKey.toLowerCase().trim()];
        if (!field) continue;
        let val = row[rawKey];
        if (val instanceof Date) {
          // A spreadsheet date in the "order day" column means the day number.
          val = field === "orderDay" ? val.getDate() : toDateStr(val);
        }
        out[field] = String(val ?? "").trim();
      }
      return out;
    });
  });
}

export function OrdersBoard() {
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [loading, setLoading] = React.useState(true);
  // Saved expiry snapshot, for the per-company popup.
  const [expiryItems, setExpiryItems] = React.useState<ExpiryRow[]>([]);
  // Normalized keys of companies that have at least one saved note, so the
  // board can show a note indicator next to their name.
  const [companiesWithNotes, setCompaniesWithNotes] = React.useState<
    Set<string>
  >(new Set());
  const [openExpiry, setOpenExpiry] = React.useState<string | null>(null);
  const [flyingSearch, setFlyingSearch] = React.useState(false);
  const today = React.useMemo(() => new Date(), []);
  const [showForm, setShowForm] = React.useState(false);
  const [form, setForm] = React.useState<Record<string, string>>(emptyForm);
  const [submitting, setSubmitting] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [busyIds, setBusyIds] = React.useState<Set<string>>(new Set());
  // Narrows the table. Empty set = show all; otherwise a row must pass every
  // selected filter. Lets you combine e.g. "Important" + "Due soon".
  const [filters, setFilters] = React.useState<Set<OrderFilter>>(new Set());
  // Whether the "Show" multi-select dropdown is open.
  const [filterMenuOpen, setFilterMenuOpen] = React.useState(false);
  const filterMenuRef = React.useRef<HTMLDivElement>(null);
  // Free-text search over company names, applied on top of the filter.
  const [search, setSearch] = React.useState("");
  // The single cell currently being edited inline.
  const [editing, setEditing] = React.useState<{
    id: string;
    key: string;
  } | null>(null);
  const skipBlur = React.useRef(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Which monthly cycle is being viewed. New orders and imports are tagged with
  // this month, and the table only shows this month's rows. Persisted so a
  // reload keeps you on the same month. Safe to read localStorage in the
  // initializer: `month` isn't rendered until after the loading state, so it
  // can't cause a hydration mismatch.
  const [month, setMonth] = React.useState<string>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("orders:month");
        if (saved && /^\d{4}-\d{2}$/.test(saved)) return saved;
      } catch {
        // localStorage unavailable — fall through to the current month.
      }
    }
    return currentMonthStr();
  });
  const [carrying, setCarrying] = React.useState(false);
  const [filing, setFiling] = React.useState(false);

  // The store-wide stock file (رصيد المخزن), saved on THIS PC (IndexedDB), not
  // the server. It holds every company's items; at settlement time it's sliced
  // to the codes whose المورد matches the company. `null` = none saved yet.
  const stockRef = React.useRef<HTMLInputElement>(null);
  const [stockInfo, setStockInfo] = React.useState<{
    fileName: string;
    count: number;
    savedAt: number;
  } | null>(null);
  const [stockBusy, setStockBusy] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    (async () => {
      const s = await loadStock();
      if (active && s) {
        setStockInfo({
          fileName: s.fileName,
          count: s.items.length,
          savedAt: s.savedAt,
        });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    try {
      localStorage.setItem("orders:month", month);
    } catch {
      // Ignore — persistence is best-effort.
    }
  }, [month]);

  // Orders created before months existed have an empty month; treat those as
  // belonging to the current month for month-level logic (carry-over, dedup).
  const thisMonth = React.useMemo(() => currentMonthStr(), []);
  const effectiveMonth = React.useCallback(
    (o: Order) => (o.month?.trim() ? o.month.trim() : thisMonth),
    [thisMonth],
  );

  // The table shows the selected month's rows, plus any still-unassigned order
  // (blank month) — those stay visible in every month until the user assigns
  // them one, so nothing silently disappears when switching months.
  const visibleOrders = React.useMemo(
    () =>
      orders.filter((o) => {
        const m = o.month?.trim();
        return !m || m === month;
      }),
    [orders, month],
  );

  // The rows actually rendered: the month's orders, optionally narrowed by the
  // active filter. Kept separate from visibleOrders so month-level logic
  // (dedup, carry-over) still sees every row.
  const displayedOrders = React.useMemo(() => {
    let rows = visibleOrders;
    // Apply every selected filter — a row must pass all of them (AND).
    const active = FILTER_OPTIONS.filter((f) => filters.has(f.value));
    if (active.length > 0) {
      rows = rows.filter((o) => active.every((f) => f.test(o)));
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((o) =>
        (o.companyName ?? "").toLowerCase().includes(q),
      );
    }
    return rows;
  }, [visibleOrders, filters, search]);

  // The newest month (other than the one selected) that actually has orders —
  // the source we offer to carry companies over from into a fresh month.
  const carrySourceMonth = React.useMemo(() => {
    const months = [
      ...new Set(
        orders
          .map(effectiveMonth)
          .filter((m) => m !== month),
      ),
    ].sort();
    return months.length ? months[months.length - 1] : null;
  }, [orders, effectiveMonth, month]);

  // Orders that still have no month tag — they float into every month view
  // until filed. This drives the "File unassigned" action.
  const unassignedOrders = React.useMemo(
    () => orders.filter((o) => !(o.month ?? "").trim()),
    [orders],
  );

  // Toggle one filter in the "Show" multi-select.
  const toggleFilter = (value: OrderFilter) =>
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });

  // Close the "Show" dropdown when clicking outside it.
  React.useEffect(() => {
    if (!filterMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (
        filterMenuRef.current &&
        !filterMenuRef.current.contains(e.target as Node)
      ) {
        setFilterMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [filterMenuOpen]);

  const setBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/orders");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setOrders(data.orders ?? []);
    } catch {
      toast.error("Couldn't load orders");
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/orders");
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (active) setOrders(data.orders ?? []);
      } catch {
        if (active) toast.error("Couldn't load orders");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Load the saved expiry snapshot so companies can show their expiring items.
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/expiry");
        if (!res.ok) return;
        const data = await res.json();
        const items: ExpiryRow[] = (data.items ?? []).map(
          (i: Record<string, unknown>) => ({
            supplier: String(i.company ?? ""),
            code: String(i.code ?? ""),
            product: String(i.product ?? ""),
            expiry: String(i.expiry ?? ""),
            qty: Number(i.qty) || 0,
            avgCost: Number(i.avgCost) || 0,
            buyPrice: Number(i.buyPrice) || 0,
            sellPrice: Number(i.sellPrice) || 0,
            total: Number(i.total) || 0,
            source: "",
          }),
        );
        if (active) setExpiryItems(items);
      } catch {
        // No snapshot — companies just won't show an expiry pill.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Load which companies have saved notes, to flag them on the board.
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/company-notes");
        if (!res.ok) return;
        const data = await res.json();
        const keys = new Set<string>();
        for (const n of (data.notes ?? []) as {
          key?: string;
          entries?: unknown[];
        }[]) {
          if (n.key && Array.isArray(n.entries) && n.entries.length > 0) {
            keys.add(n.key);
          }
        }
        if (active) setCompaniesWithNotes(keys);
      } catch {
        // No notes endpoint — just don't show indicators.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Expiry items grouped by normalized company name.
  const expiryByCompany = React.useMemo(() => {
    const m = new Map<string, ExpiryRow[]>();
    for (const it of expiryItems) {
      const key = normalizeCompany(it.supplier);
      const list = m.get(key);
      if (list) list.push(it);
      else m.set(key, [it]);
    }
    return m;
  }, [expiryItems]);

  function openAdd() {
    setForm(emptyForm());
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setForm(emptyForm());
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.companyName.trim()) {
      toast.error("Company name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, month }),
      });
      if (!res.ok) throw new Error();
      closeForm();
      await load();
      toast.success("Order added");
    } catch {
      toast.error("Couldn't add order");
    } finally {
      setSubmitting(false);
    }
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const parsed = await parseExcel(file);
      const valid = parsed
        .filter((o) => o.companyName)
        // Tag every imported row with the month currently being viewed.
        .map((o) => ({ ...o, month }));
      if (valid.length === 0) {
        toast.error("No rows with a company name were found in that file");
        return;
      }
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders: valid }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      await load();
      toast.success(`Imported ${data.count} order(s) into ${monthLabel(month)}`);
    } catch {
      toast.error("Couldn't import that file");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Start the selected month fresh: copy each company (and its order day) from
  // the most recent earlier month, with all the per-month fields cleared.
  // Companies already present in this month are skipped, so it's safe to re-run.
  async function carryOver() {
    if (!carrySourceMonth) return;
    const already = new Set(
      visibleOrders.map((o) => o.companyName.trim().toLowerCase()),
    );
    const seen = new Set<string>();
    const toCreate: Record<string, string>[] = [];
    for (const o of orders) {
      if (effectiveMonth(o) !== carrySourceMonth) continue;
      const key = o.companyName.trim().toLowerCase();
      if (!key || already.has(key) || seen.has(key)) continue;
      seen.add(key);
      toCreate.push({
        companyName: o.companyName,
        orderDay: o.orderDay ?? "",
        important: o.important ?? "",
        month,
      });
    }

    if (toCreate.length === 0) {
      toast.info(
        `Every company from ${monthLabel(carrySourceMonth)} is already in ${monthLabel(month)}.`,
      );
      return;
    }

    setCarrying(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders: toCreate }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      await load();
      toast.success(
        `Carried over ${data.count} order(s) into ${monthLabel(month)}`,
      );
    } catch {
      toast.error("Couldn't carry over orders");
    } finally {
      setCarrying(false);
    }
  }

  // File every untagged order into the month its dates point to, so each lands
  // in its real month instead of floating across all of them. Safe to re-run:
  // it only touches orders with a blank month.
  async function fileUnassigned() {
    const targets = unassignedOrders
      .map((o) => ({ id: o._id, month: monthFromOrder(o) }))
      .filter((t) => t.month);
    if (targets.length === 0) {
      toast.info("No unassigned orders could be dated.");
      return;
    }
    setFiling(true);
    try {
      const results = await Promise.all(
        targets.map((t) =>
          fetch(`/api/orders/${t.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ month: t.month }),
          }).then((r) => r.ok),
        ),
      );
      const ok = results.filter(Boolean).length;
      await load();
      if (ok === targets.length) toast.success(`Filed ${ok} order(s) by date`);
      else toast.warning(`Filed ${ok} of ${targets.length} — some failed`);
    } catch {
      toast.error("Couldn't file unassigned orders");
      await load();
    } finally {
      setFiling(false);
    }
  }

  // Flip the "no need this month" flag on an order and persist it.
  function toggleNoNeed(order: Order) {
    commitCell(order._id, "noNeed", isNoNeed(order) ? "" : "yes");
  }

  // Flip the "reviewed" (tasfya done) flag on an order and persist it.
  function toggleReviewed(order: Order) {
    commitCell(order._id, "reviewed", isReviewed(order) ? "" : "yes");
  }

  async function deleteOrder(id: string) {
    setBusy(id, true);
    try {
      const res = await fetch(`/api/orders/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setOrders((prev) => prev.filter((o) => o._id !== id));
      toast.success("Order deleted");
    } catch {
      toast.error("Couldn't delete order");
      await load();
    } finally {
      setBusy(id, false);
    }
  }

  // --- Inline cell editing ---

  function startEdit(order: Order, key: string) {
    if (!EDITABLE_FIELDS.has(key)) return;
    setEditing({ id: order._id, key });
  }

  async function commitCell(id: string, key: string, value: string) {
    setEditing(null);
    const current = orders.find((o) => o._id === id);
    if (!current || (current[key] ?? "") === value) return; // no change

    setBusy(id, true);
    // Optimistic update.
    setOrders((prev) =>
      prev.map((o) => (o._id === id ? { ...o, [key]: value } : o)),
    );
    try {
      const res = await fetch(`/api/orders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error();
      toast.success("Saved");
    } catch {
      toast.error("Couldn't save change");
      await load();
    } finally {
      setBusy(id, false);
    }
  }

  function onCellBlur(id: string, key: string, value: string) {
    // Escape sets skipBlur so we discard instead of saving.
    if (skipBlur.current) {
      skipBlur.current = false;
      setEditing(null);
      return;
    }
    commitCell(id, key, value);
  }

  function onCellKeyDown(
    e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    isTextarea: boolean,
  ) {
    if (e.key === "Escape") {
      skipBlur.current = true;
      e.currentTarget.blur();
    } else if (e.key === "Enter" && !isTextarea) {
      e.preventDefault();
      e.currentTarget.blur(); // commit
    }
  }

  // Upload + save the store-wide stock file to this PC (IndexedDB). Parsing
  // happens client-side; only the parsed items are stored. Replaces any existing
  // stock file.
  async function onPickStock(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/\.html?$/i.test(file.name)) {
      toast.error("Choose a .htm / .html stock file.");
      return;
    }
    setStockBusy(true);
    try {
      const text = await file.text();
      const items = parseStock(parseHtmlTable(text));
      if (items.length === 0) {
        toast.warning("No stock items found in that file.");
      }
      await saveStock(file.name, items);
      setStockInfo({ fileName: file.name, count: items.length, savedAt: Date.now() });
      toast.success(
        `Saved stock on this PC: ${items.length.toLocaleString("en-US")} items`,
      );
    } catch {
      toast.error("Couldn't read or save the stock file.");
    } finally {
      setStockBusy(false);
    }
  }

  async function clearStockFile() {
    setStockBusy(true);
    try {
      await clearStock();
      setStockInfo(null);
      toast.success("Stock removed from this PC.");
    } catch {
      toast.error("Couldn't remove the stock file.");
    } finally {
      setStockBusy(false);
    }
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" onClick={openAdd}>
        <Plus /> Add order
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={importing}
        onClick={() => fileRef.current?.click()}
      >
        {importing ? <Loader2 className="animate-spin" /> : <Upload />}
        {importing ? "Importing…" : "Import Excel"}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={onPickFile}
      />

      <Button
        type="button"
        variant="outline"
        onClick={() => setFlyingSearch(true)}
        title="Search all flying-tasfya sheets by code or product name"
      >
        <Plane /> Search Flying
      </Button>

      {/* Store-wide stock — saved on this PC, sliced per company at tasfya time. */}
      <Button
        type="button"
        variant="outline"
        disabled={stockBusy}
        onClick={() => stockRef.current?.click()}
        title="Upload one store-wide stock file (رصيد المخزن). Saved on this PC only."
      >
        {stockBusy ? <Loader2 className="animate-spin" /> : <PackageCheck />}
        {stockInfo ? "Replace stock" : "Upload stock"}
      </Button>
      <input
        ref={stockRef}
        type="file"
        accept=".htm,.html"
        className="hidden"
        onChange={onPickStock}
      />
      {stockInfo && (
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
          <span className="max-w-[11rem] truncate" title={stockInfo.fileName}>
            {stockInfo.fileName}
          </span>
          <span className="tabular-nums">
            · {stockInfo.count.toLocaleString("en-US")} items
          </span>
          <button
            type="button"
            onClick={clearStockFile}
            disabled={stockBusy}
            className="grid size-5 place-items-center rounded hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            aria-label="Remove stock file"
            title="Remove stock (this PC)"
          >
            <X className="size-3.5" />
          </button>
        </span>
      )}
    </div>
  );

  const monthBar = (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2">
      <label className="flex items-center gap-2 text-sm font-medium">
        <Calendar className="size-4 text-muted-foreground" />
        Month
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value || currentMonthStr())}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </label>
      <span className="px-1 text-sm text-muted-foreground">
        {displayedOrders.length} order{displayedOrders.length === 1 ? "" : "s"}
        {filters.size > 0 &&
          ` · ${FILTER_OPTIONS.filter((f) => filters.has(f.value))
            .map((f) => f.label)
            .join(" + ")}`}{" "}
        in {monthLabel(month)}
      </span>
      <label className="relative flex items-center">
        <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company…"
          className="h-9 w-44 rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      </label>
      <div
        ref={filterMenuRef}
        className="relative flex items-center gap-2 text-sm font-medium"
      >
        Show
        <button
          type="button"
          onClick={() => setFilterMenuOpen((o) => !o)}
          className="flex h-9 min-w-[10rem] items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          aria-haspopup="listbox"
          aria-expanded={filterMenuOpen}
        >
          <span className="truncate">
            {filters.size === 0
              ? "All orders"
              : `${filters.size} filter${filters.size === 1 ? "" : "s"}`}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
        {filterMenuOpen && (
          <div className="absolute left-10 top-full z-20 mt-1 w-56 rounded-lg border border-border bg-popover p-1 shadow-md">
            {FILTER_OPTIONS.map((opt) => {
              const checked = filters.has(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleFilter(opt.value)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-normal transition-colors hover:bg-muted"
                >
                  <span
                    className={cn(
                      "grid size-4 shrink-0 place-items-center rounded border",
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border",
                    )}
                  >
                    {checked && <Check className="size-3" />}
                  </span>
                  {opt.label}
                </button>
              );
            })}
            {filters.size > 0 && (
              <button
                type="button"
                onClick={() => setFilters(new Set())}
                className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-2 py-1.5 text-left text-sm font-normal text-muted-foreground transition-colors hover:bg-muted"
              >
                <X className="size-3.5" /> Clear filters
              </button>
            )}
          </div>
        )}
      </div>
      {unassignedOrders.length > 0 && (
        <Button
          type="button"
          variant="outline"
          className="ml-auto border-amber-500/60 text-amber-700 dark:text-amber-400"
          disabled={filing}
          onClick={fileUnassigned}
          title="Move each order with no month into the month its dates point to"
        >
          {filing ? <Loader2 className="animate-spin" /> : <Calendar />}
          File {unassignedOrders.length} unassigned
        </Button>
      )}
      {carrySourceMonth && (
        <Button
          type="button"
          variant="outline"
          className={cn(unassignedOrders.length === 0 && "ml-auto")}
          disabled={carrying}
          onClick={carryOver}
          title={`Copy companies from ${monthLabel(carrySourceMonth)} into ${monthLabel(month)}, with a clean sheet`}
        >
          {carrying ? <Loader2 className="animate-spin" /> : <CopyPlus />}
          Carry over from {monthLabel(carrySourceMonth)}
        </Button>
      )}
    </div>
  );

  const formPanel = showForm && (
    <form
      onSubmit={submit}
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">New order</h2>
        <button
          type="button"
          onClick={closeForm}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {COLUMNS.map((col) => (
          <div
            key={col.key}
            className={col.type === "textarea" ? "sm:col-span-2" : ""}
          >
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {col.label}
              {col.key === "companyName" && (
                <span className="text-destructive"> *</span>
              )}
            </label>
            {col.type === "yesno" ? (
              <select
                value={
                  form[col.key].trim().toLowerCase() === "yes" ? "yes" : "no"
                }
                onChange={(e) =>
                  setForm((f) => ({ ...f, [col.key]: e.target.value }))
                }
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            ) : col.type === "textarea" ? (
              <textarea
                value={form[col.key]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [col.key]: e.target.value }))
                }
                rows={2}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            ) : col.type === "day" ? (
              <input
                type="number"
                min={1}
                max={31}
                placeholder="1–31"
                value={form[col.key]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [col.key]: e.target.value }))
                }
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            ) : (
              <input
                type={col.type === "date" ? "date" : "text"}
                value={form[col.key]}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [col.key]: e.target.value }))
                }
                className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={closeForm}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="animate-spin" /> : <Plus />}
          {submitting ? "Saving…" : "Add order"}
        </Button>
      </div>
    </form>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {toolbar}
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toolbar}
      {monthBar}
      {formPanel}

      {visibleOrders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No orders in {monthLabel(month)} yet.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {carrySourceMonth && (
              <Button type="button" disabled={carrying} onClick={carryOver}>
                {carrying ? <Loader2 className="animate-spin" /> : <CopyPlus />}
                Carry over from {monthLabel(carrySourceMonth)}
              </Button>
            )}
            <Button
              type="button"
              variant={carrySourceMonth ? "outline" : "default"}
              onClick={openAdd}
            >
              <Plus /> Add an order
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => fileRef.current?.click()}
            >
              <Upload /> Import Excel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Tip: click any editable cell to change it. Set the order day to the
            day of the month it&apos;s due — rows turn red when one is more than{" "}
            {OVERDUE_GRACE_DAYS} days overdue and not yet done, and green once you
            fill in its date of doing. Company name is fixed. Switch months above
            to review a past month or start a new one — &ldquo;Carry over&rdquo;
            copies the companies into a clean sheet. Orders with no month yet
            (amber month box on the right) show in every month until you pick one
            for them.
          </p>
          {displayedOrders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
              <p className="text-sm text-muted-foreground">
                {search.trim()
                  ? `No companies matching "${search.trim()}" in ${monthLabel(month)}.`
                  : filters.size > 0
                    ? `No orders matching ${FILTER_OPTIONS.filter((f) =>
                        filters.has(f.value),
                      )
                        .map((f) => f.label)
                        .join(" + ")} in ${monthLabel(month)}.`
                    : `No orders to show in ${monthLabel(month)}.`}
              </p>
            </div>
          ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className="whitespace-nowrap px-3 py-2.5 font-semibold text-muted-foreground"
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="whitespace-nowrap px-3 py-2.5 font-semibold text-muted-foreground">
                    Review
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-semibold text-muted-foreground">
                    Display exp
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-semibold text-muted-foreground">
                    Auto Tasfya
                  </th>
                  <th className="whitespace-nowrap px-3 py-2.5 font-semibold text-muted-foreground">
                    Flying
                  </th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {displayedOrders.map((order) => {
                  const busy = busyIds.has(order._id);
                  const overdue = isOverdue(order, effectiveMonth(order));
                  const dueSoon = isDueSoon(order);
                  const done = isDone(order);
                  const finished = isFinished(order);
                  const noNeed = isNoNeed(order);
                  return (
                    <tr
                      key={order._id}
                      className={cn(
                        "border-b border-border/60 last:border-0",
                        done &&
                          "bg-emerald-500/10 hover:bg-emerald-500/15 dark:bg-emerald-400/10 dark:hover:bg-emerald-400/15",
                        dueSoon && "bg-amber-500/15 hover:bg-amber-500/20 dark:bg-amber-400/10 dark:hover:bg-amber-400/15",
                        overdue && "bg-destructive/10",
                        noNeed && "bg-muted/40 text-muted-foreground",
                        // A finished order (its "Finished" date is filled) shows
                        // its whole row text in green.
                        finished &&
                          "text-emerald-700 [&_*]:text-emerald-700 dark:text-emerald-400 dark:[&_*]:text-emerald-400",
                        busy && "opacity-60",
                      )}
                    >
                      {COLUMNS.map((col) => {
                        const isEditing =
                          editing?.id === order._id && editing?.key === col.key;
                        const editable = EDITABLE_FIELDS.has(col.key);
                        const raw = order[col.key] ?? "";
                        return (
                          <td
                            key={col.key}
                            className={cn(
                              "px-3 py-2 align-top",
                              col.type === "textarea"
                                ? "max-w-[16rem] whitespace-pre-wrap"
                                : "whitespace-nowrap",
                              col.key === "companyName" && "font-medium",
                            )}
                          >
                            {isEditing ? (
                              col.type === "yesno" ? (
                                <select
                                  autoFocus
                                  defaultValue={
                                    raw.trim().toLowerCase() === "yes" ? "yes" : "no"
                                  }
                                  onChange={(e) => e.currentTarget.blur()}
                                  onBlur={(e) =>
                                    onCellBlur(order._id, col.key, e.target.value)
                                  }
                                  className="h-8 w-full min-w-[5rem] rounded border border-ring bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                >
                                  <option value="no">No</option>
                                  <option value="yes">Yes</option>
                                </select>
                              ) : col.type === "textarea" ? (
                                <textarea
                                  autoFocus
                                  defaultValue={raw}
                                  rows={2}
                                  onBlur={(e) =>
                                    onCellBlur(order._id, col.key, e.target.value)
                                  }
                                  onKeyDown={(e) => onCellKeyDown(e, true)}
                                  className="w-full min-w-[12rem] rounded border border-ring bg-background px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                />
                              ) : col.type === "day" ? (
                                <input
                                  autoFocus
                                  type="number"
                                  min={1}
                                  max={31}
                                  defaultValue={raw}
                                  onBlur={(e) =>
                                    onCellBlur(order._id, col.key, e.target.value)
                                  }
                                  onKeyDown={(e) => onCellKeyDown(e, false)}
                                  className="h-8 w-full min-w-[6rem] rounded border border-ring bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                />
                              ) : (
                                <input
                                  autoFocus
                                  type={col.type === "date" ? "date" : "text"}
                                  defaultValue={raw}
                                  onBlur={(e) =>
                                    onCellBlur(order._id, col.key, e.target.value)
                                  }
                                  onKeyDown={(e) => onCellKeyDown(e, false)}
                                  className="h-8 w-full min-w-[8rem] rounded border border-ring bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                                />
                              )
                            ) : editable ? (
                              <button
                                type="button"
                                onClick={() => startEdit(order, col.key)}
                                disabled={busy}
                                className="-mx-1 block w-full rounded px-1 py-0.5 text-left transition-colors hover:bg-muted disabled:cursor-default"
                                title="Click to edit"
                              >
                                {cellValue(col, raw, overdue)}
                              </button>
                            ) : col.key === "companyName" ? (
                              <span className="flex items-center gap-2">
                                <Link
                                  href={`/company/${encodeURIComponent(raw)}`}
                                  dir="auto"
                                  className="whitespace-nowrap font-medium text-primary underline-offset-2 hover:underline"
                                  title="Open this company's page (all data + notes)"
                                >
                                  {raw}
                                </Link>
                                {companiesWithNotes.has(
                                  normalizeCompany(raw),
                                ) && (
                                  <StickyNote
                                    className="size-3.5 shrink-0 text-amber-500"
                                    aria-label="Has notes"
                                  />
                                )}
                                {noNeed && (
                                  <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                                    <Ban className="size-3" />
                                    No need
                                  </span>
                                )}
                              </span>
                            ) : (
                              cellValue(col, raw, overdue)
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        <ReviewCell
                          order={order}
                          onToggle={() => toggleReviewed(order)}
                          busy={busy}
                        />
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        <ExpiryCell
                          rows={expiryByCompany.get(
                            normalizeCompany(order.companyName ?? ""),
                          )}
                          today={today}
                          onOpen={() => setOpenExpiry(order.companyName)}
                        />
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            const c = (order.companyName ?? "").trim();
                            if (!c) {
                              toast.error("This order has no company name.");
                              return;
                            }
                            const url = `/auto-tasfya/run?month=${encodeURIComponent(
                              effectiveMonth(order),
                            )}&company=${encodeURIComponent(c)}`;
                            window.open(url, "_blank", "noopener");
                          }}
                          className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
                          title="Run Auto Tasfya for this company in a new tab"
                        >
                          <Calculator className="size-3.5" /> Tasfya
                        </button>
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            const c = (order.companyName ?? "").trim();
                            if (!c) {
                              toast.error("This order has no company name.");
                              return;
                            }
                            const url = `/flying/run?month=${encodeURIComponent(
                              effectiveMonth(order),
                            )}&company=${encodeURIComponent(c)}`;
                            window.open(url, "_blank", "noopener");
                          }}
                          className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-500/20 dark:text-sky-400"
                          title="Open the Flying tasfya worksheet for this company in a new tab"
                        >
                          <Plane className="size-3.5" /> Flying
                        </button>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center gap-2">
                        <input
                          type="month"
                          value={order.month?.trim() || ""}
                          disabled={busy}
                          onChange={(e) =>
                            commitCell(order._id, "month", e.target.value)
                          }
                          title={
                            order.month?.trim()
                              ? "Change which month this order belongs to"
                              : "Unassigned — pick a month to file this order"
                          }
                          className={cn(
                            "h-8 rounded border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50",
                            order.month?.trim()
                              ? "border-border"
                              : "border-amber-500/60 text-amber-700 dark:text-amber-400",
                          )}
                        />
                        <button
                          type="button"
                          onClick={() => toggleNoNeed(order)}
                          disabled={busy}
                          className={cn(
                            "transition-colors disabled:opacity-50",
                            noNeed
                              ? "text-amber-600 dark:text-amber-500"
                              : "text-muted-foreground/60 hover:text-amber-600 dark:hover:text-amber-500",
                          )}
                          title={
                            noNeed
                              ? "Marked: no need this month — click to clear"
                              : "Mark: no need to order this month"
                          }
                          aria-label="Toggle no need this month"
                          aria-pressed={noNeed}
                        >
                          <Ban className="size-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteOrder(order._id)}
                          disabled={busy}
                          className="text-muted-foreground/60 transition-colors hover:text-destructive disabled:opacity-50"
                          title="Delete order"
                          aria-label="Delete order"
                        >
                          {busy ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          )}
        </>
      )}

      {openExpiry && (
        <CompanyExpiryModal
          company={openExpiry}
          rows={expiryByCompany.get(normalizeCompany(openExpiry)) ?? []}
          today={today}
          onClose={() => setOpenExpiry(null)}
        />
      )}

      {flyingSearch && (
        <FlyingSearchModal onClose={() => setFlyingSearch(false)} />
      )}
    </div>
  );
}
