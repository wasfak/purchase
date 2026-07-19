import { notFound } from "next/navigation";

import { canViewDashboard, requireFullAccess } from "@/lib/access";
import { getAllOrdersWithUploaders } from "@/lib/admin-orders";
import { AdminOrders } from "@/components/dashboard/admin-orders";

export default async function dashboard() {
  await requireFullAccess();
  // Hidden feature: anyone not on the allow-list gets a 404, so the page's
  // existence isn't revealed even via a direct URL.
  if (!(await canViewDashboard())) notFound();

  const orders = await getAllOrdersWithUploaders();

  return (
    <main className="mx-auto w-full max-w-7xl space-y-5 p-6">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Every order across all team members. Filter by company name, date, or
          the person who uploaded it.
        </p>
      </div>
      <AdminOrders orders={orders} />
    </main>
  );
}
