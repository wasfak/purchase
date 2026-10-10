"use client";

import * as React from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { Plus, Upload, Download, Trash2, Loader2, X, Calendar, CopyPlus, Ban, Search, AlarmClock, Check, PackageCheck, Calculator, Plane, StickyNote, ChevronDown, Star, ArrowUp, ArrowDown, ArrowUpDown, Filter } from "lucide-react";
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

const daysInMonth = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate();

// The order day is stored as a full "YYYY-MM-DD" date — the real calendar day the
// order is due — so an order carried onto the September sheet can still be due on
// e.g. 28/8. Legacy rows that hold a bare day number (1–31) fall back to that day
// within the order's own month, so old data keeps working. Only the day-of-month
// is ever shown in the table; the month rides along invisibly (and on hover).
function dueDateOf(order: Order): Date | null {
  const raw = (order.orderDay ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, mo, d] = raw.split("-").map(Number);
    return new Date(y, mo - 1, d);
  }
  const day = parseInt(raw, 10);
  if (!day || day < 1 || day > 31) return null;
  const m = (order.month ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) return null;
  const [year, mo] = m.split("-").map(Number);
  return new Date(year, mo - 1, Math.min(day, daysInMonth(year, mo - 1)));
}

// The day-of-month to show for an order day value (a full date or a legacy
// number). The month is deliberately not shown — the table looks unchanged.
function displayDay(v: string): string {
  const raw = (v ?? "").trim();
  const m = raw.match(/^\d{4}-\d{2}-(\d{2})$/);
  const n = m ? parseInt(m[1], 10) : parseInt(raw, 10);
  if (!n || n < 1 || n > 31) return "";
  return `Day ${n}`;
}

// The value to seed the order-day date picker with when editing a row (converts
// a legacy day-number into a real date in the order's month so it isn't blank).
function orderDayInputValue(order: Order): string {
  const d = dueDateOf(order);
  return d ? toDateStr(d) : "";
}

// How many days past the due date before we flag it as overdue.
const OVERDUE_GRACE_DAYS = 3;

// An order is "done" once its date of doing is filled. It's overdue when that's
// still empty and today is more than OVERDUE_GRACE_DAYS past its explicit due
// date — so a September order due 28/9 won't go red until late September, while
// an August order due 28/8 goes red in early September.
function isOverdue(order: Order): boolean {
  if ((order.dateOfDoing ?? "").trim()) return false; // already done
  const due = dueDateOf(order);
  if (!due) return false;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return (now.getTime() - due.getTime()) / 86_400_000 > OVERDUE_GRACE_DAYS;
}

// How many days ahead of the due date counts as "due soon".
const DUE_SOON_DAYS = 4;

// An order is "due soon" (amber) when it's not done and its explicit due date is
// within DUE_SOON_DAYS ahead — or already past (skipped, not done). Because the
// due date is a real date, ممفيس due 28/8 lights up on the 24th while الكسير due
// 25/9 stays quiet, no matter which month sheet each row sits on.
function isDueSoon(order: Order): boolean {
  if (isNoNeed(order)) return false; // nothing to do this month
  if ((order.dateOfDoing ?? "").trim()) return false; // already done
  const due = dueDateOf(order);
  if (!due) return false;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return (due.getTime() - now.getTime()) / 86_400_000 <= DUE_SOON_DAYS;
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

// No order day has been filled in for this company yet — the "No order date"
// filter surfaces these so you can spot companies still missing a scheduled day.
function hasNoOrderDay(order: Order): boolean {
  return (order.orderDay ?? "").trim() === "";
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
  | "noOrderDay"
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
  { value: "noOrderDay", label: "No order date", test: hasNoOrderDay },
  { value: "hideFinished", label: "Hide finished", test: (o) => !isFinished(o) },
];

// An order needs a "review tasfya" nudge when REVIEW_AFTER_DAYS have passed
// since it was sent and it isn't finished yet.
function isReviewDue(order: Order): boolean {
  return reviewStatus(order).state === "due";
}

// A column the Excel-style header menu can sort + filter: `value` is the text
// shown in the filter's checkbox list, `sort` a comparable key (null = blank,
// always sorted to the bottom regardless of direction).
type FilterCol = {
  key: string;
  label: string;
  value: (o: Order) => string;
  sort: (o: Order) => number | string | null;
};

// The filter text for a data column — matches what the cell shows.
function columnText(col: Column, o: Order): string {
  const raw = (o[col.key] ?? "").trim();
  if (col.type === "yesno") return raw.toLowerCase() === "yes" ? "Yes" : "No";
  if (col.type === "day") return displayDay(raw);
  if (col.type === "date") return displayDate(raw);
  return raw;
}

// The sort key for a data column: real timestamps for dates (order day
// understands legacy day-numbers via dueDateOf), lowercase text otherwise.
function columnSort(col: Column, o: Order): number | string | null {
  if (col.type === "day") return dueDateOf(o)?.getTime() ?? null;
  const raw = (o[col.key] ?? "").trim();
  if (col.type === "date") {
    return /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? new Date(`${raw}T00:00:00`).getTime()
      : raw.toLowerCase() || null;
  }
  if (col.type === "yesno") return raw.toLowerCase() === "yes" ? "yes" : "no";
  return raw.toLowerCase() || null;
}

function compareSortKeys(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

// The review column's state as filter text.
const REVIEW_LABELS: Record<ReturnType<typeof reviewStatus>["state"], string> = {
  none: "",
  reviewed: "Reviewed",
  done: "Settled",
  due: "Review tasfya",
  waiting: "Waiting",
};

const fmtFilterValue = (v: string) => (v === "" ? "(Blanks)" : v);

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
    // Show only the day; reveal the full date (with month) on hover.
    const isFullDate = /^\d{4}-\d{2}-\d{2}$/.test(raw.trim());
    return (
      <span
        className={cn(overdue && "font-semibold text-destructive")}
        title={isFullDate ? displayDate(raw) : undefined}
      >
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
          // Both the order day and the date columns keep the full date now
          // (the order day is displayed as just the day-of-month).
          val = toDateStr(val);
        }
        out[field] = String(val ?? "").trim();
      }
      return out;
    });
  });
}

export function OrdersBoard({ isAdmin = false }: { isAdmin?: boolean }) {
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [resetting, setResetting] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  // Saved expiry snapshot, for the per-company popup.
  const [expiryItems, setExpiryItems] = React.useState<ExpiryRow[]>([]);
  // Normalized keys of companies that have at least one saved note, so the
  // board can show a note indicator next to their name.
  const [companiesWithNotes, setCompaniesWithNotes] = React.useState<
    Set<string>
  >(new Set());
  // Normalized company keys marked "auto display" on the تقفيلات page. Used to
  // reflect that toggle here as a read-only column.
  const [taqfeelatKeys, setTaqfeelatKeys] = React.useState<Set<string>>(
    new Set(),
  );
  // Subset of the above whose "date of doing" is filled on the تقفيلات page —
  // these show a green (done) badge instead of amber.
  const [taqfeelatDoneKeys, setTaqfeelatDoneKeys] = React.useState<Set<string>>(
    new Set(),
  );
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
  // Optional sort on any filterable column. Clicking a header cycles
  // asc → desc → off. null = natural (insertion) order.
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | null>(
    null,
  );
  // Excel-style per-column filters: column key → the allowed values. A column
  // absent from the map is unfiltered.
  const [colFilters, setColFilters] = React.useState<Record<string, Set<string>>>(
    {},
  );
  // The open header filter menu (anchored to its button) + its value search.
  const [colMenu, setColMenu] = React.useState<{
    key: string;
    x: number;
    y: number;
    top: number;
  } | null>(null);
  const [valSearch, setValSearch] = React.useState("");
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
  const [fixingDates, setFixingDates] = React.useState(false);
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

  // Load the تقفيلات auto-display flags so the board can flag those companies.
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/taqfeelat");
        if (!res.ok) return;
        const data = await res.json();
        const keys = new Set<string>();
        const doneKeys = new Set<string>();
        for (const f of (data.flags ?? []) as {
          key?: string;
          autoDisplay?: boolean;
          dateOfDoing?: string;
        }[]) {
          if (f.autoDisplay && f.key) {
            keys.add(f.key);
            if ((f.dateOfDoing ?? "").trim()) doneKeys.add(f.key);
          }
        }
        if (active) {
          setTaqfeelatKeys(keys);
          setTaqfeelatDoneKeys(doneKeys);
        }
      } catch {
        // No flags endpoint — just don't flag anything.
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

  // Every column the header menus can sort + filter: the data columns plus the
  // derived status columns (تقفيلات / Review / Display exp).
  const filterCols = React.useMemo<FilterCol[]>(() => {
    const taqfeelatText = (o: Order) => {
      const key = normalizeCompany(o.companyName ?? "");
      if (!taqfeelatKeys.has(key)) return "";
      if (taqfeelatDoneKeys.has(key)) return "On (done)";
      return isDone(o) ? "Pending" : "On";
    };
    const expCount = (o: Order) =>
      expiryByCompany.get(normalizeCompany(o.companyName ?? ""))?.length ?? 0;
    const review = (o: Order) => REVIEW_LABELS[reviewStatus(o).state];
    return [
      ...COLUMNS.map((col) => ({
        key: col.key,
        label: col.label,
        value: (o: Order) => columnText(col, o),
        sort: (o: Order) => columnSort(col, o),
      })),
      {
        key: "_taqfeelat",
        label: "تقفيلات",
        value: taqfeelatText,
        sort: (o) => taqfeelatText(o) || null,
      },
      {
        key: "_review",
        label: "Review",
        value: review,
        sort: (o) => review(o) || null,
      },
      {
        key: "_exp",
        label: "Display exp",
        value: (o) => (expCount(o) > 0 ? "Has expiring" : ""),
        sort: (o) => expCount(o) || null,
      },
    ];
  }, [taqfeelatKeys, taqfeelatDoneKeys, expiryByCompany]);

  const filterColByKey = React.useMemo(
    () => new Map(filterCols.map((c) => [c.key, c])),
    [filterCols],
  );

  // Each column's distinct values across the month's rows, in sorted order
  // (by the column's sort key, so dates list chronologically; blanks last).
  const colDomains = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const fc of filterCols) {
      const seen = new Map<string, number | string | null>();
      for (const o of visibleOrders) {
        const v = fc.value(o);
        if (!seen.has(v)) seen.set(v, v === "" ? null : fc.sort(o));
      }
      map[fc.key] = [...seen.entries()]
        .sort(([va, ka], [vb, kb]) => {
          if (va === "" || vb === "") return va === "" ? 1 : -1;
          if (ka === null || kb === null) return ka === null ? 1 : -1;
          return compareSortKeys(ka, kb) || va.localeCompare(vb);
        })
        .map(([v]) => v);
    }
    return map;
  }, [filterCols, visibleOrders]);

  // The rows actually rendered: the month's orders, narrowed by the "Show"
  // filters, the column filters and the search. Kept separate from
  // visibleOrders so month-level logic (dedup, carry-over) still sees every row.
  const displayedOrders = React.useMemo(() => {
    let rows = visibleOrders;
    // Apply every selected filter — a row must pass all of them (AND).
    const active = FILTER_OPTIONS.filter((f) => filters.has(f.value));
    if (active.length > 0) {
      rows = rows.filter((o) => active.every((f) => f.test(o)));
    }
    const colActive: [FilterCol, Set<string>][] = [];
    for (const [key, allowed] of Object.entries(colFilters)) {
      const fc = filterColByKey.get(key);
      if (fc) colActive.push([fc, allowed]);
    }
    if (colActive.length > 0) {
      rows = rows.filter((o) =>
        colActive.every(([fc, allowed]) => allowed.has(fc.value(o))),
      );
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((o) =>
        (o.companyName ?? "").toLowerCase().includes(q),
      );
    }
    const sortCol = sort ? filterColByKey.get(sort.key) : undefined;
    if (sort && sortCol) {
      // Stable sort; orders with no value in the sorted column go to the bottom
      // in both directions, so blanks never crowd the top.
      const factor = sort.dir === "asc" ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const va = sortCol.sort(a);
        const vb = sortCol.sort(b);
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        return compareSortKeys(va, vb) * factor;
      });
    }
    return rows;
  }, [visibleOrders, filters, colFilters, filterColByKey, search, sort]);

  // Cycle a column's sort: asc → desc → off (back to natural order).
  const toggleSort = (key: string) =>
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });

  // Edit a column's allowed-value set; once every value is allowed again the
  // column's filter is dropped.
  const setColumnFilter = (
    key: string,
    mutate: (allowed: Set<string>) => void,
  ) =>
    setColFilters((prev) => {
      const domain = colDomains[key] ?? [];
      const allowed = prev[key] ? new Set(prev[key]) : new Set(domain);
      mutate(allowed);
      const next = { ...prev };
      if (domain.every((v) => allowed.has(v))) delete next[key];
      else next[key] = allowed;
      return next;
    });

  const clearColumnFilter = (key: string) => {
    setColFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setColMenu(null);
  };

  // Close the header filter menu on outside click, Escape or resize.
  React.useEffect(() => {
    if (!colMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-col-filter]"))
        setColMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setColMenu(null);
    const onResize = () => setColMenu(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [colMenu]);

  // The open menu's values, narrowed by its value search.
  const menuValues = React.useMemo(() => {
    if (!colMenu) return [];
    const domain = colDomains[colMenu.key] ?? [];
    const q = valSearch.trim().toLowerCase();
    if (!q) return domain;
    return domain.filter((v) => fmtFilterValue(v).toLowerCase().includes(q));
  }, [colMenu, valSearch, colDomains]);

  const colFilterCount = Object.keys(colFilters).length;

  // A header cell with a sort toggle and an Excel-style filter button.
  const filterHeader = (fc: FilterCol, center = false) => {
    const activeSort = sort?.key === fc.key ? sort.dir : null;
    const filtered = !!colFilters[fc.key];
    return (
      <th
        key={fc.key}
        className="whitespace-nowrap px-2 py-1.5 font-semibold text-muted-foreground"
        aria-sort={
          activeSort
            ? activeSort === "asc"
              ? "ascending"
              : "descending"
            : undefined
        }
      >
        <div
          data-col-filter
          className={cn("flex items-center gap-0.5", center && "justify-center")}
        >
          <button
            type="button"
            onClick={() => toggleSort(fc.key)}
            className={cn(
              "inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:text-foreground",
              activeSort && "text-foreground",
            )}
            title={`Sort by ${fc.label}`}
          >
            {fc.label}
            {activeSort === "asc" ? (
              <ArrowUp className="size-3.5" />
            ) : activeSort === "desc" ? (
              <ArrowDown className="size-3.5" />
            ) : (
              <ArrowUpDown className="size-3.5 opacity-40" />
            )}
          </button>
          <button
            type="button"
            aria-label={`Filter ${fc.label}`}
            title={`Filter ${fc.label}`}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setValSearch("");
              setColMenu((m) =>
                m?.key === fc.key
                  ? null
                  : {
                      key: fc.key,
                      x: Math.min(r.left, window.innerWidth - 272),
                      y: r.bottom,
                      top: r.top,
                    },
              );
            }}
            className={cn(
              "grid size-6 shrink-0 place-items-center rounded transition-colors hover:bg-muted hover:text-foreground",
              filtered && "text-primary",
            )}
          >
            <Filter className={cn("size-3.5", filtered && "fill-primary/20")} />
          </button>
        </div>
      </th>
    );
  };

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

  // Admin-only: wipe every OTHER user's orders (all months) so the system can be
  // handed to new users with a clean slate. The admin's own orders are kept.
  async function resetOtherUsers() {
    if (
      !window.confirm(
        "Delete ALL orders belonging to other users (every month)?\n\n" +
          "Your own orders are kept. This cannot be undone.",
      )
    ) {
      return;
    }
    setResetting(true);
    try {
      const res = await fetch("/api/orders/reset", { method: "DELETE" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success(`Deleted ${data.deleted} order(s) from other users`);
    } catch {
      toast.error("Couldn't reset other users' orders");
    } finally {
      setResetting(false);
    }
  }

  // Export the orders currently shown (this month, after filters + search) to an
  // Excel sheet, one column per field, using the same labels as the table. Dates
  // are shown the way the table shows them (order day as just the day number).
  function exportExcel() {
    if (displayedOrders.length === 0) {
      toast.error("No orders to export.");
      return;
    }
    const rows = displayedOrders.map((o) => {
      const row: Record<string, string> = {};
      for (const col of COLUMNS) {
        const raw = o[col.key] ?? "";
        row[col.label] =
          col.type === "day"
            ? displayDay(raw)
            : col.type === "date"
              ? displayDate(raw)
              : raw;
      }
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = COLUMNS.map((col) => {
      const width = rows.reduce(
        (max, r) => Math.max(max, (r[col.label] ?? "").length),
        col.label.length,
      );
      return { wch: Math.min(Math.max(width + 2, 8), 48) };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orders");
    XLSX.writeFile(wb, `orders-${month}.xlsx`);
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
      // Advance the due date by one month for the new cycle (keeping the same
      // day). Legacy day-numbers with no usable date are copied as-is.
      const src = dueDateOf(o);
      const nextOrderDay = src
        ? toDateStr(
            new Date(
              src.getFullYear(),
              src.getMonth() + 1,
              Math.min(
                src.getDate(),
                daysInMonth(src.getFullYear(), src.getMonth() + 1),
              ),
            ),
          )
        : (o.orderDay ?? "");
      toCreate.push({
        companyName: o.companyName,
        orderDay: nextOrderDay,
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

  // One-time bridge for older data: give each not-yet-done order a REAL due date
  // (so the new date-based "due soon" works), derived from the company's last
  // actual order + 1 month — e.g. ممفيس last done 28/7 → 28/8, الكسير last done
  // 25/8 → 25/9. Orders that already hold a full date, or that have no usable
  // day/history, are left untouched. Safe to re-run.
  async function setDatesFromHistory() {
    // Company → its most recent dateOfDoing (YYYY-MM-DD sorts lexically).
    const lastDone = new Map<string, string>();
    for (const o of orders) {
      const key = o.companyName?.trim().toLowerCase();
      const d = (o.dateOfDoing ?? "").trim();
      if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const cur = lastDone.get(key);
      if (!cur || d > cur) lastDone.set(key, d);
    }

    const updates: { id: string; orderDay: string }[] = [];
    for (const o of orders) {
      const raw = (o.orderDay ?? "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) continue; // already a real date
      if ((o.dateOfDoing ?? "").trim()) continue; // done rows don't need it
      const day = parseInt(raw, 10);

      let target: Date | null = null;
      const ld = lastDone.get(o.companyName?.trim().toLowerCase() ?? "");
      if (ld) {
        // Next order = one month after the last order, on the order day (or the
        // last order's own day when no order day is set).
        const [ly, lm] = ld.split("-").map(Number);
        const d = day && day >= 1 && day <= 31 ? day : Number(ld.slice(8, 10));
        target = new Date(ly, lm, Math.min(d, daysInMonth(ly, lm)));
      } else if (day && day >= 1 && day <= 31) {
        // No history — fall back to the day in the order's own month.
        const m = (o.month ?? "").trim();
        if (/^\d{4}-\d{2}$/.test(m)) {
          const [y, mo] = m.split("-").map(Number);
          target = new Date(y, mo - 1, Math.min(day, daysInMonth(y, mo - 1)));
        }
      }
      if (target) updates.push({ id: o._id, orderDay: toDateStr(target) });
    }

    if (updates.length === 0) {
      toast.info("Nothing to set — every order already has a date.");
      return;
    }

    setFixingDates(true);
    try {
      // Optimistic: apply locally so the board updates immediately.
      const byId = new Map(updates.map((u) => [u.id, u.orderDay]));
      setOrders((prev) =>
        prev.map((o) =>
          byId.has(o._id) ? { ...o, orderDay: byId.get(o._id)! } : o,
        ),
      );
      const results = await Promise.all(
        updates.map((u) =>
          fetch(`/api/orders/${u.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderDay: u.orderDay }),
          }).then((r) => r.ok),
        ),
      );
      const failed = results.filter((ok) => !ok).length;
      if (failed > 0) {
        toast.warning(`Set ${updates.length - failed}, ${failed} failed.`);
        await load();
      } else {
        toast.success(`Set real dates on ${updates.length} order(s).`);
      }
    } catch {
      toast.error("Couldn't set the dates.");
      await load();
    } finally {
      setFixingDates(false);
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
        onClick={exportExcel}
        title="Download the orders shown (this month, after filters) as an Excel sheet"
      >
        <Download /> Export Excel
      </Button>

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
            .join(" + ")}`}
        {colFilterCount > 0 &&
          ` · ${colFilterCount} column filter${colFilterCount === 1 ? "" : "s"}`}{" "}
        in {monthLabel(month)}
      </span>
      {colFilterCount > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setColFilters({})}
          title="Clear every column filter"
        >
          <X /> Clear column filters
        </Button>
      )}
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
      <Button
        type="button"
        variant="outline"
        disabled={fixingDates}
        onClick={setDatesFromHistory}
        title="One-time: give older orders a real due date from their last order + 1 month"
      >
        {fixingDates ? <Loader2 className="animate-spin" /> : <Calendar />}
        Set dates from history
      </Button>

      {isAdmin && (
        <Button
          type="button"
          variant="destructive"
          disabled={resetting}
          onClick={resetOtherUsers}
          title="Admin only: delete every other user's orders (all months) so new users start fresh. Your own orders are kept."
        >
          {resetting ? <Loader2 className="animate-spin" /> : <Trash2 />}
          Reset other users
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
                type="date"
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
                  : colFilterCount > 0
                    ? `No orders match the column filters in ${monthLabel(month)}.`
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
                  {COLUMNS.map((col) => filterHeader(filterColByKey.get(col.key)!))}
                  {filterHeader(filterColByKey.get("_taqfeelat")!, true)}
                  {filterHeader(filterColByKey.get("_review")!)}
                  {filterHeader(filterColByKey.get("_exp")!)}
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
                  const overdue = isOverdue(order);
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
                        dueSoon && !overdue && "bg-amber-500/15 hover:bg-amber-500/20 dark:bg-amber-400/10 dark:hover:bg-amber-400/15",
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
                                  type="date"
                                  defaultValue={orderDayInputValue(order)}
                                  onBlur={(e) =>
                                    onCellBlur(order._id, col.key, e.target.value)
                                  }
                                  onKeyDown={(e) => onCellKeyDown(e, false)}
                                  className="h-8 w-full min-w-[8rem] rounded border border-ring bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
                      <td className="px-3 py-2 align-top text-center whitespace-nowrap">
                        {(() => {
                          const key = normalizeCompany(order.companyName ?? "");
                          if (!taqfeelatKeys.has(key))
                            return <span className="text-muted-foreground">—</span>;
                          // تقفيله already made (date of doing set on تقفيلات page).
                          if (taqfeelatDoneKeys.has(key))
                            return (
                              <span
                                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/50 bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400"
                                title="تقفيله done — date of doing is set"
                              >
                                <Check className="size-3" />
                                On
                              </span>
                            );
                          // Order itself is done but no تقفيله yet — remind to make one.
                          if (done)
                            return (
                              <span
                                className="inline-flex items-center gap-1 rounded-full border border-destructive/50 bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive"
                                title="Order done but no تقفيله yet — set its date of doing on the تقفيلات page"
                              >
                                <AlarmClock className="size-3" />
                                Pending
                              </span>
                            );
                          // Marked, order not done yet.
                          return (
                            <span
                              className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400"
                              title="Marked for auto-display on the تقفيلات page"
                            >
                              <Star className="size-3 fill-current" />
                              On
                            </span>
                          );
                        })()}
                      </td>
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

      {/* Excel-style column filter dropdown */}
      {colMenu &&
        (() => {
          const fc = filterColByKey.get(colMenu.key);
          if (!fc) return null;
          const allowed = colFilters[colMenu.key];
          const isChecked = (v: string) => !allowed || allowed.has(v);
          const allChecked = menuValues.every(isChecked);
          const someChecked = menuValues.some(isChecked);
          // Flip above the button when there isn't room below.
          const EST_HEIGHT = 380;
          const spaceBelow = window.innerHeight - colMenu.y;
          const openUp = spaceBelow < EST_HEIGHT && colMenu.top > spaceBelow;
          const posStyle: React.CSSProperties = openUp
            ? {
                position: "fixed",
                bottom: window.innerHeight - colMenu.top + 4,
                left: colMenu.x,
              }
            : { position: "fixed", top: colMenu.y + 4, left: colMenu.x };
          return (
            <div
              data-col-filter
              style={posStyle}
              className="z-50 flex max-h-[calc(100vh-1rem)] w-68 flex-col overflow-auto rounded-lg border border-border bg-card p-2 text-sm shadow-xl"
            >
              <div className="flex gap-1 pb-2">
                <button
                  type="button"
                  onClick={() => {
                    setSort({ key: colMenu.key, dir: "asc" });
                    setColMenu(null);
                  }}
                  className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-muted"
                >
                  <ArrowUp className="size-3.5" /> Sort ascending
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSort({ key: colMenu.key, dir: "desc" });
                    setColMenu(null);
                  }}
                  className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-muted"
                >
                  <ArrowDown className="size-3.5" /> Sort descending
                </button>
              </div>

              <div className="-mx-2 border-t border-border" />

              <div className="relative pt-2">
                <Search className="pointer-events-none absolute start-2 top-1/2 mt-1 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  value={valSearch}
                  onChange={(e) => setValSearch(e.target.value)}
                  placeholder={`Search ${fc.label}…`}
                  className="h-8 w-full rounded-md border border-border bg-background ps-7 pe-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                />
              </div>

              <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 font-medium hover:bg-muted">
                <input
                  type="checkbox"
                  className="size-3.5 accent-primary"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = !allChecked && someChecked;
                  }}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setColumnFilter(colMenu.key, (set) => {
                      for (const v of menuValues) {
                        if (on) set.add(v);
                        else set.delete(v);
                      }
                    });
                  }}
                />
                <span>(Select all{valSearch ? " in search" : ""})</span>
              </label>

              <div className="max-h-56 overflow-auto py-1">
                {menuValues.length === 0 && (
                  <p className="px-2 py-3 text-center text-muted-foreground">
                    No matching values.
                  </p>
                )}
                {menuValues.map((v) => (
                  <label
                    key={v}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      className="size-3.5 accent-primary"
                      checked={isChecked(v)}
                      onChange={() =>
                        setColumnFilter(colMenu.key, (set) => {
                          if (set.has(v)) set.delete(v);
                          else set.add(v);
                        })
                      }
                    />
                    <span
                      dir="auto"
                      className={cn(
                        "truncate",
                        v === "" && "italic text-muted-foreground",
                      )}
                      title={fmtFilterValue(v)}
                    >
                      {fmtFilterValue(v)}
                    </span>
                  </label>
                ))}
              </div>

              <div className="-mx-2 border-t border-border" />

              <div className="flex items-center justify-between gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => clearColumnFilter(colMenu.key)}
                  disabled={!allowed}
                >
                  Clear filter
                </Button>
                <Button type="button" size="sm" onClick={() => setColMenu(null)}>
                  <Check /> Done
                </Button>
              </div>
            </div>
          );
        })()}

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
