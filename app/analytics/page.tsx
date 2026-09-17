import { AnalyticsClient } from "@/components/analytics/analytics-client";
import { requireFullAccess } from "@/lib/access";

export default async function Page() {
  await requireFullAccess();
  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 p-6">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Turnaround delays across each order stage: Order day → Date of doing →
          In review → Send date. Important orders only; each stage counts orders
          with both endpoints filled.
        </p>
      </div>
      <AnalyticsClient />
    </main>
  );
}
