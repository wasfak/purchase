import { redirect } from "next/navigation";
import { OrdersReview } from "@/components/orders-review/orders-review";
import { canUseOrdersReview } from "@/lib/access";

export default async function Page() {
  if (!(await canUseOrdersReview())) redirect("/contracts");
  return (
    <main className="w-full space-y-5 px-4 py-6">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">مراجعة اوردرات</h1>
        <p className="text-sm text-muted-foreground">
          Upload the HTML order report and the CSV, then download the merged,
          formatted Excel sheet.
        </p>
      </div>
      <OrdersReview />
    </main>
  );
}
