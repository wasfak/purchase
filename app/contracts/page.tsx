import { ContractsClient } from "@/components/contracts/contracts-client";

// Contracts is the one page every signed-in user may use, so it carries no
// full-access guard. Restricted users are redirected here from other pages.
export default function Page() {
  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 p-6">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Contracts</h1>
        <p className="text-sm text-muted-foreground">
          Upload one or more purchase-invoice files, then a stock file. Purchase
          lines are matched by item code and filtered to items found in stock.
        </p>
      </div>
      <ContractsClient />
    </main>
  );
}
