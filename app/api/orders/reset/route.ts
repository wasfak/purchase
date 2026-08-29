import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { Order } from "@/lib/models/Order";
import { currentUserIsAdmin } from "@/lib/access";

// DELETE /api/orders/reset — admin-only. Wipes every order that does NOT
// belong to the signed-in admin, so the system can be handed to new users
// with a clean slate. The admin's own orders are left untouched.
export async function DELETE() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await currentUserIsAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await connectDB();

  const res = await Order.deleteMany({ ownerId: { $ne: userId } });
  return NextResponse.json({ ok: true, deleted: res.deletedCount ?? 0 });
}
