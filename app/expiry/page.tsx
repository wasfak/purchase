import { ExpiryClient } from "@/components/expiry/expiry-client";
import { requireFullAccess } from "@/lib/access";

export default async function Page() {
  await requireFullAccess();
  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 p-6">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Expiry</h1>
        <p className="text-sm text-muted-foreground">
          Upload one or more near-expiry report files. Items are grouped by
          urgency and supplier, with the cost and retail value at risk.
        </p>
      </div>
      <ExpiryClient />
    </main>
  );
}
