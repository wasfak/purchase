"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Plus,
  Search,
  Trash2,
  StickyNote,
  AlarmClock,
  Building2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { monthLabel } from "@/lib/dates";
import {
  daysUntilExpiry,
  normalizeCompany,
  type ExpiryRow,
} from "@/lib/expiry";

type Order = Record<string, string> & { _id: string };
type NoteEntry = { text: string; at: number };

// The order fields shown, in display order, on the company history table.
const HISTORY_COLUMNS: { key: string; label: string; kind?: "date" | "day" }[] =
  [
    { key: "month", label: "Month" },
    { key: "orderDay", label: "Order day", kind: "day" },
    { key: "dateOfDoing", label: "Date of doing", kind: "date" },
    { key: "inReview", label: "In review", kind: "date" },
    { key: "sendDate", label: "Send date", kind: "date" },
    { key: "toWhere", label: "To where" },
    { key: "exp", label: "Expired items" },
    { key: "damaged", label: "Damaged" },
    { key: "finished", label: "Finished", kind: "date" },
    { key: "notes", label: "Order notes" },
  ];

function displayDate(v: string): string {
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return new Date(`${v}T00:00:00`).toLocaleDateString();
  }
  return v;
}

function displayDay(v: string): string {
  const n = parseInt(v, 10);
  if (!n || n < 1 || n > 31) return "";
  return `Day ${n}`;
}

// Best-guess month for sorting an order newest-first: its tagged month, else the
// month its dates point to, else its created date.
function orderMonth(o: Order): string {
  if ((o.month ?? "").trim()) return o.month.trim();
  for (const key of ["dateOfDoing", "sendDate", "inReview", "finished"]) {
    const v = (o[key] ?? "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.slice(0, 7);
  }
  const created = (o.createdAt ?? "").trim();
  const m = created.match(/^(\d{4}-\d{2})/);
  return m ? m[1] : "";
}

export function CompanyDetail({ company }: { company: string }) {
  const key = React.useMemo(() => normalizeCompany(company), [company]);
  const today = React.useMemo(() => new Date(), []);

  const [loading, setLoading] = React.useState(true);
  const [orders, setOrders] = React.useState<Order[]>([]);
  const [expiry, setExpiry] = React.useState<ExpiryRow[]>([]);
  const [showExpiry, setShowExpiry] = React.useState(false);
  const [entries, setEntries] = React.useState<NoteEntry[]>([]);
  const [draft, setDraft] = React.useState("");
  const [noteQuery, setNoteQuery] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [ordersRes, noteRes, expiryRes] = await Promise.all([
          fetch("/api/orders"),
          fetch(`/api/company-notes?company=${encodeURIComponent(company)}`),
          fetch("/api/expiry"),
        ]);

        if (active && ordersRes.ok) {
          const data = await ordersRes.json();
          const mine = ((data.orders ?? []) as Order[])
            .filter((o) => normalizeCompany(o.companyName ?? "") === key)
            .sort((a, b) => orderMonth(b).localeCompare(orderMonth(a)));
          setOrders(mine);
        }

        if (active && noteRes.ok) {
          const data = await noteRes.json();
          const doc = data.note;
          const loaded: NoteEntry[] = Array.isArray(doc?.entries)
            ? doc.entries.map((e: Record<string, unknown>) => ({
                text: String(e?.text ?? ""),
                at: Number(e?.at) || 0,
              }))
            : [];
          // Fall back to a legacy single-text note if there are no entries yet.
          if (loaded.length === 0 && (doc?.notes ?? "").trim()) {
            loaded.push({ text: String(doc.notes), at: 0 });
          }
          setEntries(loaded);
        }

        if (active && expiryRes.ok) {
          const data = await expiryRes.json();
          const items: ExpiryRow[] = ((data.items ?? []) as Record<
            string,
            unknown
          >[])
            .map((i) => ({
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
            }))
            .filter((i) => normalizeCompany(i.supplier) === key);
          setExpiry(items);
        }
      } catch {
        if (active) toast.error("Couldn't load this company's data");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [company, key]);

  // Persist the given entries (optimistically already set in state).
  async function persist(next: NoteEntry[]) {
    setSaving(true);
    try {
      const res = await fetch("/api/company-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, entries: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast.error("Couldn't save the notes");
    } finally {
      setSaving(false);
    }
  }

  function addNote() {
    const text = draft.trim();
    if (!text) return;
    const next = [{ text, at: Date.now() }, ...entries];
    setEntries(next);
    setDraft("");
    persist(next);
  }

  function deleteNote(at: number, idx: number) {
    const next = entries.filter((e, i) => !(e.at === at && i === idx));
    setEntries(next);
    persist(next);
  }

  const q = noteQuery.trim().toLowerCase();
  const shownEntries = q
    ? entries.filter((e) => e.text.toLowerCase().includes(q))
    : entries;

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <main className="mx-auto w-full max-w-[100rem] space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <Link
            href="/orders"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Back to orders
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Building2 className="size-6 text-primary" />
            <span dir="auto">{company}</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {orders.length} order{orders.length === 1 ? "" : "s"} across all
            months
            {expiry.length > 0 && ` · ${expiry.length} near-expiry item(s)`}
          </p>
        </div>
      </div>

      {/* Company notes — a searchable list of entries, saved to the DB and
          shared across every month for this company. */}
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <StickyNote className="size-4 text-amber-500" />
            Company notes
            <span className="text-xs font-normal text-muted-foreground">
              ({entries.length})
            </span>
            {saving && (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            )}
          </h2>
          {entries.length > 0 && (
            <label className="relative flex items-center">
              <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" />
              <input
                type="search"
                value={noteQuery}
                dir="auto"
                onChange={(e) => setNoteQuery(e.target.value)}
                placeholder="بحث في الملاحظات…"
                className="h-9 w-48 rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </label>
          )}
        </div>

        <div className="flex items-start gap-2">
          <textarea
            value={draft}
            dir="auto"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                addNote();
              }
            }}
            rows={2}
            placeholder="اكتب ملاحظة جديدة… (Ctrl+Enter للإضافة)"
            className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <Button type="button" onClick={addNote} disabled={!draft.trim()}>
            <Plus /> Add
          </Button>
        </div>

        <div className="mt-3 space-y-2">
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No notes yet. Add the first one above.
            </p>
          ) : shownEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No notes match “{noteQuery.trim()}”.
            </p>
          ) : (
            shownEntries.map((e, i) => (
              <div
                key={`${e.at}-${i}`}
                className="group flex items-start gap-2 rounded-lg border border-border bg-background/60 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words text-sm" dir="auto">
                    {e.text}
                  </p>
                  {e.at > 0 && (
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {new Date(e.at).toLocaleString()}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => deleteNote(e.at, entries.indexOf(e))}
                  className="shrink-0 rounded p-1 text-muted-foreground/50 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  title="Delete note"
                  aria-label="Delete note"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Near-expiry items for this company — collapsed by default. */}
      {expiry.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <button
            type="button"
            onClick={() => setShowExpiry((v) => !v)}
            className="flex w-full items-center gap-2 text-sm font-semibold"
            aria-expanded={showExpiry}
          >
            {showExpiry ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
            <AlarmClock className="size-4 text-amber-500" />
            Near-expiry items
            <span className="text-xs font-normal text-muted-foreground">
              ({expiry.length})
            </span>
          </button>
          {showExpiry && (
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left">
                  <th className="px-3 py-2 font-semibold text-muted-foreground">
                    Code
                  </th>
                  <th className="px-3 py-2 font-semibold text-muted-foreground">
                    Product
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">
                    Qty
                  </th>
                  <th className="px-3 py-2 font-semibold text-muted-foreground">
                    Expiry
                  </th>
                  <th className="px-3 py-2 text-right font-semibold text-muted-foreground">
                    Days
                  </th>
                </tr>
              </thead>
              <tbody>
                {expiry
                  .slice()
                  .sort(
                    (a, b) =>
                      daysUntilExpiry(a, today) - daysUntilExpiry(b, today),
                  )
                  .map((it, i) => {
                    const days = daysUntilExpiry(it, today);
                    return (
                      <tr
                        key={`${it.code}-${i}`}
                        className="border-b border-border/60 last:border-0"
                      >
                        <td className="px-3 py-1.5 tabular-nums">{it.code}</td>
                        <td className="px-3 py-1.5" dir="auto">
                          {it.product}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {it.qty.toLocaleString("en-US")}
                        </td>
                        <td className="px-3 py-1.5 tabular-nums">
                          {it.expiry}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-1.5 text-right tabular-nums",
                            days < 0
                              ? "text-destructive"
                              : days < 60
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground",
                          )}
                        >
                          {days}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          )}
        </section>
      )}

      {/* Every order for this company, newest month first. */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Order history</h2>
        {orders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
            No orders recorded for this company yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  {HISTORY_COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      className="whitespace-nowrap px-3 py-2.5 font-semibold text-muted-foreground"
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr
                    key={o._id}
                    className="border-b border-border/60 align-top last:border-0"
                  >
                    {HISTORY_COLUMNS.map((c) => {
                      const raw = (o[c.key] ?? "").trim();
                      let content: React.ReactNode = raw || (
                        <span className="text-muted-foreground">—</span>
                      );
                      if (c.key === "month") {
                        content = raw ? (
                          monthLabel(raw)
                        ) : (
                          <span className="text-muted-foreground">
                            Unassigned
                          </span>
                        );
                      } else if (c.kind === "date") {
                        content = displayDate(raw) || (
                          <span className="text-muted-foreground">—</span>
                        );
                      } else if (c.kind === "day") {
                        content = displayDay(raw) || (
                          <span className="text-muted-foreground">—</span>
                        );
                      }
                      return (
                        <td
                          key={c.key}
                          className={cn(
                            "px-3 py-2",
                            c.key === "notes" || c.key === "exp" || c.key === "damaged"
                              ? "max-w-[16rem] whitespace-pre-wrap"
                              : "whitespace-nowrap",
                          )}
                          dir={c.key === "notes" ? "auto" : undefined}
                        >
                          {content}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
