import { OrdersBoard } from "@/components/orders/orders-board";
import { requireFullAccess } from "@/lib/access";

export default async function Page() {
  await requireFullAccess();
  return (
    <main className="mx-auto w-full max-w-[110rem] space-y-5 p-6">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
        <p className="text-sm text-muted-foreground">
          Add orders manually or import an Excel sheet. All your orders are
          listed below.
        </p>
      </div>
      <OrdersBoard />
    </main>
  );
}
