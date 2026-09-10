import { AlamaBoard } from "@/components/alama/alama-board";
import { requireFullAccess } from "@/lib/access";

export default async function Page() {
  await requireFullAccess();
  return (
    <main className="w-full space-y-5 px-4 py-6">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">علامة</h1>
        <p className="text-sm text-muted-foreground">
          Flags every ordered product whose name contains #B / #C / #N and whose
          bought quantity exactly equals the order quantity. تشغيلات-aware: all
          code variants of one product (ت.ق / ت.ج / ن.ج …) are grouped by base
          name, so an order under an old code and a purchase under the new code
          are counted together. Uses the POS + Buy files from Auto Tasfya.
        </p>
      </div>
      <AlamaBoard />
    </main>
  );
}
