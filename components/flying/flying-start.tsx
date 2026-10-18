"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plane, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { monthLabel } from "@/lib/dates";
import { parseHtmlTable } from "@/lib/tasfya/parseTable";
import { parseSupplyOrders } from "@/lib/tasfya/supplyOrders";
import { FLYING_PENDING_KEY } from "@/lib/tasfya/flying";

type SheetSummary = {
  _id: string;
  month: string;
  company: string;
  orderNumber?: string;
  referenceDate?: string;
  updatedAt?: string;
};

const runHref = (month: string, company: string) =>
  `/flying/run?month=${encodeURIComponent(month)}&company=${encodeURIComponent(company)}`;

/**
 * Standalone entry to the Flying worksheet — no Orders row needed. Drop the
 * supply-order .htm (e.g. downloaded from an email); the company and month are
 * read from the file and the worksheet opens with the items imported. Also
 * lists the user's saved sheets to reopen.
 */
export function FlyingStart() {
  const router = useRouter();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [sheets, setSheets] = React.useState<SheetSummary[] | null>(null);

  React.useEffect(() => {
    fetch("/api/flying?list=1")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setSheets(d.sheets ?? []))
      .catch(() => setSheets([]));
  }, []);

  async function openFile(file: File | undefined) {
    if (!file) return;
    if (!/\.html?$/i.test(file.name)) {
      toast.error("Choose a .htm / .html supply-order file.");
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      const orders = parseSupplyOrders(parseHtmlTable(text));
      if (orders.length === 0) {
        toast.error("No supply orders were found in that file.");
        return;
      }
      const company = orders.find((o) => o.supplier)?.supplier ?? "";
      const date = orders.map((o) => o.date).filter(Boolean).sort()[0] ?? "";
      const m = /^(\d{4})\/(\d{2})/.exec(date);
      if (!company || !m) {
        toast.error("Couldn't read the supplier or date from that file.");
        return;
      }
      const month = `${m[1]}-${m[2]}`;

      // Never overwrite a sheet that already has work in it — just open it.
      const res = await fetch(
        `/api/flying?month=${month}&company=${encodeURIComponent(company)}`,
      );
      const existing = res.ok ? (await res.json()).sheet : null;
      if (existing?.rows?.length) {
        toast.info(`Opening the saved sheet for ${company}`);
      } else {
        try {
          sessionStorage.setItem(FLYING_PENDING_KEY, text);
        } catch {
          toast.error("Couldn't hand the file over — import it on the sheet.");
        }
      }
      router.push(runHref(month, company));
    } catch {
      toast.error("Couldn't read that file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div className="flex items-center gap-2">
        <Plane className="size-5 text-sky-500" />
        <h1 className="text-xl font-semibold">Flying</h1>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void openFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors",
          dragging ? "border-sky-500 bg-sky-500/5" : "border-border",
        )}
      >
        <Upload className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Drop the supply-order <code>.htm</code> here (e.g. downloaded from
          Gmail). The company and month are read from the file.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".htm,.html"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            void openFile(f);
          }}
        />
        <Button disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? "Opening…" : "Choose .htm file"}
        </Button>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          Saved sheets
        </h2>
        {sheets === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sheets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No saved sheets yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {sheets.map((s) => (
              <li key={s._id}>
                <Link
                  href={runHref(s.month, s.company)}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-muted/50"
                >
                  <span className="font-medium">{s.company}</span>
                  <span className="text-muted-foreground">
                    {monthLabel(s.month)}
                    {s.orderNumber ? ` · #${s.orderNumber}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
