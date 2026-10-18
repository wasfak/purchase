"use client";

import * as React from "react";
import Link from "next/link";
import { ClipboardList, Pencil, X } from "lucide-react";

import { cn } from "@/lib/utils";

// Optional company details (saved on the company page), in display order.
export const COMPANY_DETAIL_LABELS: [string, string][] = [
  ["discount", "الخصم"],
  ["repNumber", "رقم المندوب"],
  ["eTax", "الكترونى ضريبى"],
  ["collection", "التحصيل"],
  ["remarks", "ملحوظات"],
];

export type CompanyDetails = Record<string, string>;

// How one detail value reads: discount gets a % sign; eTax yes/no is tinted.
function DetailValue({ field, value }: { field: string; value: string }) {
  const v = value.trim();
  if (!v) return <span className="text-muted-foreground">—</span>;
  if (field === "discount") {
    return (
      <span className="tabular-nums" dir="ltr">
        {v.endsWith("%") ? v : `${v}%`}
      </span>
    );
  }
  if (field === "eTax" && (v === "نعم" || v === "لا")) {
    return (
      <span
        className={cn(
          "rounded-full border px-2 py-0.5 text-xs font-medium",
          v === "نعم"
            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
            : "border-destructive/50 bg-destructive/10 text-destructive",
        )}
      >
        {v}
      </span>
    );
  }
  return (
    <span className="whitespace-pre-wrap break-words" dir="auto">
      {v}
    </span>
  );
}

export function CompanyDetailsModal({
  company,
  details,
  onClose,
}: {
  company: string;
  details: CompanyDetails | undefined;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const hasAny = COMPANY_DETAIL_LABELS.some(([k]) =>
    (details?.[k] ?? "").trim(),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/70 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className="my-10 w-full max-w-md rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="flex min-w-0 items-center gap-2 font-semibold">
            <ClipboardList className="size-4 shrink-0 text-primary" />
            <span className="truncate" dir="auto">
              {company}
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <dl className="divide-y divide-border/60 px-4" dir="rtl">
          {COMPANY_DETAIL_LABELS.map(([k, label]) => (
            <div key={k} className="flex items-start gap-4 py-2.5 text-sm">
              <dt className="w-32 shrink-0 font-medium text-muted-foreground">
                {label}
              </dt>
              <dd className="min-w-0 flex-1">
                <DetailValue field={k} value={details?.[k] ?? ""} />
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <span className="text-xs text-muted-foreground">
            {hasAny ? "" : "No details saved yet."}
          </span>
          <Link
            href={`/company/${encodeURIComponent(company)}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
          >
            <Pencil className="size-3.5" /> Edit
          </Link>
        </div>
      </div>
    </div>
  );
}
