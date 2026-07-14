"use client";

import * as React from "react";
import * as XLSX from "xlsx";
import { Plus, Upload, Trash2, Loader2, X, Calendar, CopyPlus } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toDateStr, currentMonthStr, monthLabel } from "@/lib/dates";

type FieldType = "text" | "date" | "textarea" | "day";

type Column = { key: string; label: string; type: FieldType };

const COLUMNS: Column[] = [
  { key: "companyName", label: "Company name", type: "text" },
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

function displayDay(v: string): string {
  const n = parseInt(v, 10);
  if (!n || n < 1 || n > 31) return "";
  return `Day ${n}`;
}

// How many days past the monthly order day before we flag it as overdue.
const OVERDUE_GRACE_DAYS = 3;

// An order is "done" for the month once its date of doing is filled. It's
// overdue when that's still empty and today is more than OVERDUE_GRACE_DAYS
// past this month's order day — that's what turns the row red.
function isOverdue(order: Order): boolean {
  const day = parseInt(order.orderDay ?? "", 10);
  if (!day || day < 1 || day > 31) return false;
  if ((order.dateOfDoing ?? "").trim()) return false; // already done

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const due = new Date(now.getFullYear(), now.getMonth(), Math.min(day, lastOfMonth));
  const diffDays = (now.getTime() - due.getTime()) / 86_400_000;
  return diffDays > OVERDUE_GRACE_DAYS;
}

// An order is done once its date of doing is filled — that's what turns the row
// green, so finished orders stand apart from the ones still to do.
function isDone(order: Order): boolean {
  return (order.dateOfDoing ?? "").trim() !== "";
}

// The read-only display node for a cell, with a dash fallback when empty.
function cellValue(col: Column, raw: string, overdue: boolean): React.ReactNode {
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
  const [showForm, setShowForm] = React.useState(false);
  const [form, setForm] = React.useState<Record<string, string>>(emptyForm);
  const [submitting, setSubmitting] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [busyIds, setBusyIds] = React.useState<Set<string>>(new Set());
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

  React.useEffect(() => {
    try {
      localStorage.setItem("orders:month", month);
    } catch {
      // Ignore — persistence is best-effort.
    }
  }, [month]);

  // Orders created before months existed have an empty month; treat those as
  // belonging to the current month so nothing silently disappears.
  const thisMonth = React.useMemo(() => currentMonthStr(), []);
  const effectiveMonth = React.useCallback(
    (o: Order) => (o.month?.trim() ? o.month.trim() : thisMonth),
    [thisMonth],
  );

  // Only the selected month's rows are shown in the table.
  const visibleOrders = React.useMemo(
    () => orders.filter((o) => effectiveMonth(o) === month),
    [orders, effectiveMonth, month],
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
        {visibleOrders.length} order{visibleOrders.length === 1 ? "" : "s"} in{" "}
        {monthLabel(month)}
      </span>
      {carrySourceMonth && (
        <Button
          type="button"
          variant="outline"
          className="ml-auto"
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
            {col.type === "textarea" ? (
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
            copies the companies into a clean sheet.
          </p>
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
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((order) => {
                  const busy = busyIds.has(order._id);
                  const overdue = isOverdue(order);
                  const done = isDone(order);
                  return (
                    <tr
                      key={order._id}
                      className={cn(
                        "border-b border-border/60 last:border-0",
                        done &&
                          "bg-emerald-500/10 hover:bg-emerald-500/15 dark:bg-emerald-400/10 dark:hover:bg-emerald-400/15",
                        overdue && "bg-destructive/10",
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
                              col.type === "textarea" ? (
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
                            ) : (
                              cellValue(col, raw, overdue)
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 align-top">
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
