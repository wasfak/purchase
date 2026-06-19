"use client";

import * as React from "react";
import * as XLSX from "xlsx";
import { Plus, Upload, Trash2, Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toDateStr } from "@/lib/dates";

type FieldType = "text" | "date" | "textarea";

type Column = { key: string; label: string; type: FieldType };

const COLUMNS: Column[] = [
  { key: "companyName", label: "Company name", type: "text" },
  { key: "orderDate", label: "Order date", type: "date" },
  { key: "dateOfDoing", label: "Date of doing", type: "date" },
  { key: "inReview", label: "In review", type: "date" },
  { key: "sendDate", label: "Send date", type: "date" },
  { key: "toWhere", label: "To where", type: "text" },
  { key: "exp", label: "Expired items", type: "textarea" },
  { key: "damaged", label: "Damaged", type: "textarea" },
  { key: "finished", label: "Finished", type: "textarea" },
  { key: "notes", label: "Order notes", type: "textarea" },
];

// Fields that can be changed after the order is created. Company name and
// order date are set once, at creation, and are read-only afterwards.
const EDITABLE_FIELDS = new Set([
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
  "order date": "orderDate",
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
        if (val instanceof Date) val = toDateStr(val);
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
        body: JSON.stringify(form),
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
      const valid = parsed.filter((o) => o.companyName);
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
      toast.success(`Imported ${data.count} order(s)`);
    } catch {
      toast.error("Couldn't import that file");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
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
      {formPanel}

      {orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            You don&apos;t have any orders yet.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button type="button" onClick={openAdd}>
              <Plus /> Add your first order
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
            Tip: click any editable cell to change it. Company name and order
            date are fixed.
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
                {orders.map((order) => {
                  const busy = busyIds.has(order._id);
                  return (
                    <tr
                      key={order._id}
                      className={cn(
                        "border-b border-border/60 last:border-0",
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
                                {col.type === "date" ? (
                                  displayDate(raw) || (
                                    <span className="text-muted-foreground">—</span>
                                  )
                                ) : raw ? (
                                  raw
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </button>
                            ) : col.type === "date" ? (
                              displayDate(raw) || (
                                <span className="text-muted-foreground">—</span>
                              )
                            ) : (
                              raw || (
                                <span className="text-muted-foreground">—</span>
                              )
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
