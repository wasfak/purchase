import { InspireClient } from "@/components/inspire/inspire-client";
import { requireFullAccess } from "@/lib/access";

export default async function Page() {
  await requireFullAccess();
  return (
    <main className="mx-auto w-full max-w-[120rem] space-y-5 p-6 pb-32">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Inspire</h1>
        <p className="text-sm text-muted-foreground">
          Upload purchase-invoice files, then a stock file of the Inspire item
          codes. Purchase lines are matched by item code and grouped per
          invoice.
        </p>
      </div>
      <InspireClient />
    </main>
  );
}
