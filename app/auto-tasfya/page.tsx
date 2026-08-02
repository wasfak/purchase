import { AutoTasfyaClient } from "@/components/auto-tasfya/auto-tasfya-client";
import { requireFullAccess } from "@/lib/access";

export default async function Page() {
  await requireFullAccess();
  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 p-6">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Auto Tasfya</h1>
        <p className="text-sm text-muted-foreground">
          Upload the purchase invoices (Buy) and the supply-orders (POS) reports
          for a month. Each file is saved per month and replaced when you upload
          a new one. The settlement then runs per company from the Orders page.
        </p>
      </div>
      <AutoTasfyaClient />
    </main>
  );
}
