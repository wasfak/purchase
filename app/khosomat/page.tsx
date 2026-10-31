import { KhosomatBoard } from "@/components/khosomat/khosomat-board";
import { requireFullAccess } from "@/lib/access";

export default async function Page() {
  await requireFullAccess();
  return (
    <main className="w-full space-y-5 px-4 py-6">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">خصومات</h1>
        <p className="text-sm text-muted-foreground">
          Every purchase for your important companies, with its discount
          (أساسي + إضافي + خاص) and bonus (بونص). Each purchase is compared with
          the usual for that item from the same distributor, so a buy that came
          with a lower discount or bonus stands out. تشغيلات-aware: code variants
          of one product are grouped. Uses the Buy + POS files from Auto Tasfya
          and the stock file saved on this PC.
        </p>
      </div>
      <KhosomatBoard />
    </main>
  );
}
