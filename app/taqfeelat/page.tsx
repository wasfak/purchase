import { TaqfeelatBoard } from "@/components/taqfeelat/taqfeelat-board";
import { requireFullAccess } from "@/lib/access";

export default async function Page() {
  await requireFullAccess();
  return (
    <main className="w-full space-y-5 px-4 py-6">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">تقفيلات</h1>
        <p className="text-sm text-muted-foreground">
          Every company from your orders. Mark the ones you want auto-displayed.
        </p>
      </div>
      <TaqfeelatBoard />
    </main>
  );
}
