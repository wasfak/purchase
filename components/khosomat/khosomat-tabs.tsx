"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { ItemHistory } from "@/components/khosomat/item-history";
import { KhosomatBoard } from "@/components/khosomat/khosomat-board";

const TABS = [
  { value: "purchases", label: "Purchases" },
  { value: "history", label: "Item history" },
] as const;

export function KhosomatTabs() {
  const [tab, setTab] = React.useState<(typeof TABS)[number]["value"]>("purchases");
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            aria-pressed={tab === t.value}
            onClick={() => setTab(t.value)}
            className={cn(
              "-mb-px border-b-2 px-3 py-1.5 text-sm font-medium",
              tab === t.value
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Both stay mounted so switching tabs keeps filters and loaded data. */}
      <div hidden={tab !== "purchases"}>
        <KhosomatBoard />
      </div>
      <div hidden={tab !== "history"}>
        <ItemHistory />
      </div>
    </div>
  );
}
