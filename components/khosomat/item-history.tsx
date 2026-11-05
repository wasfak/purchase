"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  FileUp,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { normalizeCompany } from "@/lib/expiry";
import { loadBuy, saveBuy, type CachedBuy } from "@/lib/tasfya/buyCache";
import {
  buildItems,
  chunkLines,
  companyCodes,
  isLowerBuy,
  linesForCodes,
  round2,
  type HistoryBuy,
  type HistoryItem,
  type Status,
} from "@/lib/tasfya/itemHistory";
import { parseHtmlTable } from "@/lib/tasfya/parseTable";
import { dropExcludedLines, parsePurchases } from "@/lib/tasfya/purchases";
import type { PurchaseLine } from "@/lib/tasfya/types";

type SavedCompany = { company: string; codes: number };

// Lines per request, to stay under hosting body-size limits.
const BATCH_SIZE = 5000;

const fmtPct = (n: number) => `${round2(n).toLocaleString("en-US")}%`;
const fmtBonus = (n: number) => (n === 0 ? "—" : fmtPct(n));
const statusClass = (s: Status) =>
  cn(
    s === "lower" && "bg-red-500/15 font-semibold text-red-700 dark:text-red-400",
    s === "higher" &&
      "bg-emerald-500/15 font-semibold text-emerald-700 dark:text-emerald-400",
  );

export function ItemHistory() {
  const [saved, setSaved] = React.useState<SavedCompany[]>([]);
  const [selected, setSelected] = React.useState("");
  const [codes, setCodes] = React.useState<string[]>([]);
  const [lines, setLines] = React.useState<PurchaseLine[]>([]);
  const [loading, setLoading] = React.useState(false);

  const [saving, setSaving] = React.useState(false);

  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const fileRef = React.useRef<HTMLInputElement>(null);
  const buyRef = React.useRef<HTMLInputElement>(null);
  // The buy history file kept on this PC, shown next to its upload button.
  const [buyFile, setBuyFile] = React.useState<CachedBuy | null>(null);

  const loadSaved = React.useCallback(async () => {
    const res = await fetch("/api/khosomat/history");
    if (!res.ok) throw new Error();
    const data = await res.json();
    const list: SavedCompany[] = data.companies ?? [];
    setSaved(list);
    return list;
  }, []);

  const loadCompany = React.useCallback(async (name: string) => {
    setSelected(name);
    setOpen(new Set());
    setLoading(true);
    try {
      const res = await fetch(
        `/api/khosomat/history?company=${encodeURIComponent(name)}`,
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      setCodes(data.codes ?? []);
      setLines(data.lines ?? []);
    } catch {
      toast.error("Couldn't load this company's history.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    (async () => {
      try {
        void loadBuy().then(setBuyFile);
        const list = await loadSaved();
        if (list[0]) void loadCompany(list[0].company);
      } catch {
        toast.error("Couldn't load the item history.");
      }
    })();
  }, [loadSaved, loadCompany]);

  // Searches the uploaded buy history (in this browser) and the Auto Tasfya Buy
  // files (on the server) for a company's codes, and saves what matches.
  async function search(company: string, listed: string[]) {
    const post = async (body: Record<string, unknown>) => {
      const res = await fetch("/api/khosomat/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, codes: listed, ...body }),
      });
      if (!res.ok) throw new Error();
      return (await res.json()) as { added: number; missing: number };
    };

    const res = await fetch(
      `/api/khosomat/history?company=${encodeURIComponent(company)}`,
    );
    if (!res.ok) throw new Error();
    const current = await res.json();
    const buy = await loadBuy();
    const matched = buy
      ? linesForCodes(
          buy.lines,
          [...(current.codes ?? []), ...listed],
          current.lines ?? [],
        )
      : [];

    let added = 0;
    for (const lines of chunkLines(matched, BATCH_SIZE)) {
      added += (await post({ lines, search: false })).added;
    }
    const last = await post({});
    return { added: added + last.added, missing: last.missing };
  }

  // Keeps the buy history file on this PC, then updates the open company from it.
  async function uploadBuy(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSaving(true);
    try {
      const parsed = dropExcludedLines(
        parsePurchases(parseHtmlTable(await file.text())),
      );
      if (parsed.length === 0) {
        toast.error("No purchase lines were found in that file.");
        return;
      }
      setBuyFile(await saveBuy(file.name, parsed));
      toast.success(`Buy file saved: ${parsed.length.toLocaleString("en-US")} lines`);
      if (selected) {
        await search(selected, []);
        await loadCompany(selected);
      }
    } catch {
      toast.error("Couldn't read or save that buy file.");
    } finally {
      setSaving(false);
    }
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setSaving(true);
    try {
      const found = companyCodes(parseHtmlTable(await file.text()));
      if (found.length === 0) {
        toast.error("No company and codes were found in that file.");
        return;
      }
      for (const { company, codes } of found) {
        const { added, missing } = await search(company, codes);
        toast.success(
          `${company}: ${codes.length} code(s), ${added} new line(s)` +
            (missing > 0 ? ` · ${missing} with no purchases` : ""),
        );
      }
      await loadSaved();
      await loadCompany(found[0].company);
    } catch {
      toast.error("Couldn't read or save that file.");
    } finally {
      setSaving(false);
    }
  }

  async function refresh() {
    setSaving(true);
    try {
      const { added } = await search(selected, []);
      toast.success(`${added} new line(s) found`);
      await loadCompany(selected);
    } catch {
      toast.error("Couldn't search the Buy files.");
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(item: HistoryItem) {
    if (
      !window.confirm(
        `Remove ${item.name} and its saved history from ${selected}?`,
      )
    ) {
      return;
    }
    try {
      const res = await fetch("/api/khosomat/history", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: selected, codes: item.codes }),
      });
      if (!res.ok) throw new Error();
      await loadSaved();
      await loadCompany(selected);
    } catch {
      toast.error("Couldn't remove the item.");
    }
  }

  const removeCode = async (code: string) => {
    try {
      const res = await fetch("/api/khosomat/history", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: selected, codes: [code] }),
      });
      if (!res.ok) throw new Error();
      setCodes((prev) => prev.filter((c) => c !== code));
      await loadSaved();
    } catch {
      toast.error("Couldn't remove the code.");
    }
  };

  const items = React.useMemo(() => buildItems(lines), [lines]);

  // Saved codes the buy files never had, so they can't silently look reviewed.
  const notFound = React.useMemo(() => {
    const seen = new Set(lines.map((l) => l.code));
    return codes.filter((c) => !seen.has(c));
  }, [codes, lines]);

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) || i.codes.some((c) => c.includes(q)),
    );
  }, [items, query]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const companyMatches = (a: string, b: string) =>
    normalizeCompany(a) === normalizeCompany(b);

  return (
    <div className="space-y-4">
      {/* Upload */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={() => buyRef.current?.click()}
        >
          {saving ? <Loader2 className="animate-spin" /> : <FileUp />}
          {buyFile ? "Replace buy file" : "Upload buy file (.htm)"}
        </Button>
        <input
          ref={buyRef}
          type="file"
          accept=".htm,.html"
          className="hidden"
          onChange={uploadBuy}
        />
        <span className="text-xs text-muted-foreground">
          {buyFile
            ? `${buyFile.fileName} · ${buyFile.lines.length.toLocaleString("en-US")} lines · kept on this PC`
            : "No buy file on this PC yet"}
        </span>
        <Button
          type="button"
          disabled={saving}
          className="ml-auto"
          onClick={() => fileRef.current?.click()}
        >
          {saving ? <Loader2 className="animate-spin" /> : <FileUp />}
          Upload codes (.htm)
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".htm,.html"
          className="hidden"
          onChange={upload}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside className="h-fit rounded-lg border">
          <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Saved companies
          </div>
          {saved.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">Nothing saved yet.</p>
          ) : (
            <ul className="max-h-[70vh] overflow-y-auto p-1">
              {saved.map((c) => (
                <li key={c.company}>
                  <button
                    type="button"
                    onClick={() => void loadCompany(c.company)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                      companyMatches(selected, c.company) &&
                        "bg-muted font-medium",
                    )}
                  >
                    <span dir="auto" className="truncate">
                      {c.company}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {c.codes}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="min-w-0 space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading history…
            </div>
          ) : !selected ? (
            <p className="rounded-lg border p-6 text-sm text-muted-foreground">
              Upload your buy file, then an htm with the codes you want to review.
              The history is saved to the company that htm names.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold" dir="auto">
                  {selected}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {items.length} items
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  disabled={saving}
                  onClick={refresh}
                  title="Search the buy file and Auto Tasfya Buy files again for this company's codes"
                >
                  <RefreshCw className="size-3.5" /> Search again
                </Button>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search item / code"
                    className="h-8 w-56 rounded-md border bg-background pl-7 pr-2 text-sm"
                  />
                </div>
              </div>

              {notFound.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  <span>No purchases found yet for:</span>
                  {notFound.map((c) => (
                    <button
                      type="button"
                      key={c}
                      onClick={() => removeCode(c)}
                      title="Stop tracking this code"
                      className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 px-2 font-mono hover:bg-amber-500/20"
                    >
                      {c} <Trash2 className="size-3" />
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                {visible.map((item) => (
                  <ItemCard
                    key={item.key}
                    item={item}
                    open={open.has(item.key)}
                    onToggle={() => toggle(item.key)}
                    onRemove={() => removeItem(item)}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function ItemCard({
  item,
  open,
  onToggle,
  onRemove,
}: {
  item: HistoryItem;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const last = item.buys[0];
  return (
    <div className="overflow-hidden rounded-lg border">
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2",
          item.issues > 0 && "bg-red-500/10",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {open ? (
            <ChevronDown className="size-4 shrink-0" />
          ) : (
            <ChevronRight className="size-4 shrink-0" />
          )}
          <span className="min-w-0">
            <span dir="auto" className="block truncate text-sm font-medium">
              {item.name}
            </span>
            <span className="block font-mono text-[11px] text-muted-foreground">
              {item.codes.join(" / ")}
            </span>
          </span>
        </button>
        <span className="text-xs text-muted-foreground">
          Last {last?.date} · <span dir="auto">{last?.distributor}</span>
        </span>
        {last && (
          <span className="text-xs tabular-nums">
            {fmtPct(last.basic)} + {fmtPct(last.extra)} + {fmtPct(last.special)} ·
            bonus {fmtBonus(last.bonusPct)}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {item.buys.length} buys
        </span>
        {item.issues > 0 && (
          <span className="rounded-full bg-red-500/15 px-1.5 text-[11px] font-semibold text-red-600 dark:text-red-400">
            {item.issues} lower
          </span>
        )}
        <button
          type="button"
          onClick={onRemove}
          title="Remove this item's history"
          aria-label="Remove this item's history"
          className="rounded p-1 text-muted-foreground hover:bg-red-500/15 hover:text-red-600"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {open && (
        <div className="overflow-x-auto border-t">
          <table className="w-full text-sm [&_td]:px-2 [&_td]:py-1.5 [&_td]:text-center [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-center">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr className="[&>th]:whitespace-nowrap [&>th]:font-medium">
                <th>Date</th>
                <th>Invoice</th>
                <th>Distributor</th>
                <th>Code</th>
                <th>Qty</th>
                <th>Free units</th>
                <th>أساسي</th>
                <th>إضافي</th>
                <th>خاص</th>
                <th>Bonus</th>
              </tr>
            </thead>
            <tbody>
              {item.buys.map((b) => (
                <BuyRow key={b.id} b={b} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BuyRow({ b }: { b: HistoryBuy }) {
  const onlyBonus = b.paid <= 0;
  return (
    <tr className={cn("border-t", isLowerBuy(b) && "bg-red-500/5")}>
      <td className="whitespace-nowrap tabular-nums">{b.date}</td>
      <td className="whitespace-nowrap tabular-nums">{b.invoice}</td>
      <td dir="auto" className="whitespace-nowrap">
        {b.distributor}
      </td>
      <td className="whitespace-nowrap font-mono text-xs">{b.codes.join(" / ")}</td>
      <td className="tabular-nums">{b.paid.toLocaleString("en-US")}</td>
      <td className="tabular-nums">
        {b.bonus ? b.bonus.toLocaleString("en-US") : "—"}
      </td>
      <td className={cn("tabular-nums", statusClass(b.basicStatus))}>
        {onlyBonus ? "—" : fmtPct(b.basic)}
      </td>
      <td className={cn("tabular-nums", statusClass(b.extraStatus))}>
        {onlyBonus ? "—" : fmtPct(b.extra)}
      </td>
      <td className={cn("tabular-nums", statusClass(b.specialStatus))}>
        {onlyBonus ? "—" : fmtPct(b.special)}
      </td>
      <td className={cn("tabular-nums", statusClass(b.bonusStatus))}>
        {onlyBonus ? "Free only" : fmtBonus(b.bonusPct)}
      </td>
    </tr>
  );
}
