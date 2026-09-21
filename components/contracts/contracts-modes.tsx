"use client";

import * as React from "react";
import { ArrowLeft, FileText, LineChart } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ContractsClient } from "@/components/contracts/contracts-client";
import { FahmyClient } from "@/components/fahmy/fahmy-client";

type Mode = "normal" | "fahmy";

const MODES: Record<
  Mode,
  { title: string; heading: string; desc: string; blurb: string; icon: LucideIcon }
> = {
  normal: {
    title: "Normal contracts",
    heading: "Contracts",
    desc: "Upload purchase-invoice files, then a stock file. Purchase lines are matched by item code and filtered to items found in stock.",
    blurb:
      "The usual contracts tool — quarterly buy totals, best supplier, and بونص from the purchase-invoice files.",
    icon: FileText,
  },
  fahmy: {
    title: "Mr. Fahmy",
    heading: "Mr. Fahmy",
    desc: "Upload a sales workbook (يونيلفر / L'Oréal layout) for a full 2025-vs-2026 analysis: KPIs, brands, movers, churn and purchase targets.",
    blurb:
      "Full sales analysis from one Excel sheet — brand performance, movers, portfolio churn and the Q4 target plan.",
    icon: LineChart,
  },
};

function ModeCard({
  mode,
  onPick,
}: {
  mode: Mode;
  onPick: (m: Mode) => void;
}) {
  const m = MODES[mode];
  const Icon = m.icon;
  return (
    <button
      type="button"
      onClick={() => onPick(mode)}
      className={cn(
        "group flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8 text-center",
        "transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-muted text-foreground/70 transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
        <Icon className="size-6" />
      </span>
      <span className="text-lg font-bold tracking-tight">{m.title}</span>
      <span className="max-w-xs text-sm text-muted-foreground">{m.blurb}</span>
    </button>
  );
}

export function ContractsModes({ showFahmy }: { showFahmy: boolean }) {
  const [mode, setMode] = React.useState<Mode | null>(null);

  // Restricted users only have the normal tool — skip the chooser entirely.
  if (!showFahmy) {
    return (
      <div className="space-y-5">
        <div className="border-b pb-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {MODES.normal.heading}
          </h1>
          <p className="text-sm text-muted-foreground">{MODES.normal.desc}</p>
        </div>
        <ContractsClient />
      </div>
    );
  }

  if (mode === null) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center py-10 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Choose a mode</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick the tool you need — you can switch any time.
        </p>
        <div className="mt-8 grid w-full gap-5 sm:grid-cols-2">
          <ModeCard mode="normal" onPick={setMode} />
          <ModeCard mode="fahmy" onPick={setMode} />
        </div>
      </div>
    );
  }

  const m = MODES[mode];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{m.heading}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{m.desc}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setMode(null)}>
          <ArrowLeft /> Change mode
        </Button>
      </div>
      {mode === "normal" ? <ContractsClient /> : <FahmyClient />}
    </div>
  );
}
