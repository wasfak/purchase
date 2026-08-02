"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Calendar,
  FileUp,
  Loader2,
  PackageCheck,
  ShoppingCart,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { currentMonthStr, monthLabel } from "@/lib/dates";
import { parseHtmlTable } from "@/lib/tasfya/parseTable";
import { parseSupplyOrders } from "@/lib/tasfya/supplyOrders";
import { parsePurchases } from "@/lib/tasfya/purchases";

const isHtml = (f: File) => /\.html?$/i.test(f.name);

// The two file kinds this step handles. (Stock is added in a later step.)
type Kind = "pos" | "buy";

type SlotStatus = {
  fileName: string;
  savedAt: string | null;
  count: number;
  countLabel: string;
} | null;

type MonthStatus = {
  pos: SlotStatus;
  buy: SlotStatus;
};

const KIND_META: Record<
  Kind,
  { title: string; hint: string; icon: React.ElementType; countLabel: string }
> = {
  buy: {
    title: "ملف فواتير الشراء (Buy)",
    hint: "سجل فواتير شراء الأصناف — .htm / .html",
    icon: ShoppingCart,
    countLabel: "lines",
  },
  pos: {
    title: "ملف أوامر التوريد (Orders / POS)",
    hint: "أوامر توريد الأصناف — .htm / .html",
    icon: PackageCheck,
    countLabel: "items",
  },
};

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "utf-8");
  });
}

export function AutoTasfyaClient() {
  const [month, setMonth] = React.useState(currentMonthStr);
  const [status, setStatus] = React.useState<MonthStatus | null>(null);
  const [busy, setBusy] = React.useState<Kind | null>(null);
  const [loadingStatus, setLoadingStatus] = React.useState(false);

  // Load the saved slots for the chosen month.
  const refresh = React.useCallback(async (m: string) => {
    setLoadingStatus(true);
    try {
      const res = await fetch(`/api/auto-tasfya?month=${m}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setStatus({
        pos: data.pos
          ? {
              fileName: data.pos.fileName,
              savedAt: data.pos.savedAt,
              count: data.pos.items ?? 0,
              countLabel: "items",
            }
          : null,
        buy: data.buy
          ? {
              fileName: data.buy.fileName,
              savedAt: data.buy.savedAt,
              count: data.buy.lines ?? 0,
              countLabel: "lines",
            }
          : null,
      });
    } catch {
      setStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  React.useEffect(() => {
    refresh(month);
  }, [month, refresh]);

  const upload = React.useCallback(
    async (kind: Kind, file: File) => {
      if (!isHtml(file)) {
        toast.error("Please choose a .htm or .html file.");
        return;
      }
      setBusy(kind);
      try {
        const text = await readFileAsText(file);
        const matrix = parseHtmlTable(text);
        const data =
          kind === "pos" ? parseSupplyOrders(matrix) : parsePurchases(matrix);
        if (data.length === 0) {
          toast.warning(`No ${kind === "pos" ? "orders" : "lines"} found in ${file.name}.`);
        }
        const res = await fetch("/api/auto-tasfya", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ month, kind, fileName: file.name, data }),
        });
        if (!res.ok) throw new Error();
        const out = await res.json();
        toast.success(
          kind === "pos"
            ? `Saved ${out.rows} orders (${out.items} items) for ${monthLabel(month)}`
            : `Saved ${out.rows} purchase lines for ${monthLabel(month)}`,
        );
        await refresh(month);
      } catch {
        toast.error("Couldn't read or save that file.");
      } finally {
        setBusy(null);
      }
    },
    [month, refresh],
  );

  const clearSlot = React.useCallback(
    async (kind: Kind) => {
      setBusy(kind);
      try {
        const res = await fetch(
          `/api/auto-tasfya?month=${month}&kind=${kind}`,
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error();
        toast.success("Removed.");
        await refresh(month);
      } catch {
        toast.error("Couldn't remove that file.");
      } finally {
        setBusy(null);
      }
    },
    [month, refresh],
  );

  return (
    <div className="space-y-5">
      {/* Month selector — everything on this page is filed under this cycle. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/40 p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Calendar className="size-4 text-muted-foreground" />
          Order month
        </label>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value || currentMonthStr())}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <span className="text-sm text-muted-foreground">
          {monthLabel(month)}
        </span>
        {loadingStatus && (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {(["buy", "pos"] as Kind[]).map((kind) => (
          <SlotCard
            key={kind}
            kind={kind}
            month={month}
            slot={status?.[kind] ?? null}
            busy={busy === kind}
            onUpload={(file) => upload(kind, file)}
            onClear={() => clearSlot(kind)}
          />
        ))}
      </div>
    </div>
  );
}

function SlotCard({
  kind,
  month,
  slot,
  busy,
  onUpload,
  onClear,
}: {
  kind: Kind;
  month: string;
  slot: SlotStatus;
  busy: boolean;
  onUpload: (file: File) => void;
  onClear: () => void;
}) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const inputRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>
        <div>
          <div className="text-sm font-semibold">{meta.title}</div>
          <div className="text-xs text-muted-foreground">{meta.hint}</div>
        </div>
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (busy) return;
          const f = e.dataTransfer.files?.[0];
          if (f) onUpload(f);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-border p-5 text-center transition-colors hover:border-primary/50 hover:bg-muted/40",
          busy && "pointer-events-none opacity-60",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".htm,.html"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = "";
          }}
        />
        {busy ? (
          <Loader2 className="size-5 animate-spin text-primary" />
        ) : (
          <FileUp className="size-5 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">
          {slot ? "Replace file" : "Click or drop a file"}
        </span>
      </div>

      {slot ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
          <div className="min-w-0">
            <div className="truncate font-medium" title={slot.fileName}>
              {slot.fileName}
            </div>
            <div className="text-muted-foreground">
              {slot.count.toLocaleString("en-US")} {slot.countLabel}
              {slot.savedAt && (
                <> · saved {new Date(slot.savedAt).toLocaleString()}</>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClear}
            disabled={busy}
            className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            aria-label={`Remove ${meta.title}`}
            title="Remove"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Nothing saved for {monthLabel(month)} yet.
        </div>
      )}
    </div>
  );
}
