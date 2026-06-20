import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isValidObjectId } from "mongoose";

import { connectDB } from "@/lib/db";
import { Order, ORDER_TEXT_FIELDS } from "@/lib/models/Order";

// PATCH /api/orders/:id — update any of the text fields.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const update: Record<string, string> = {};
  for (const field of ORDER_TEXT_FIELDS) {
    const v = (body as Record<string, unknown>)[field];
    if (v !== undefined && v !== null) update[field] = String(v).trim();
  }

  if (update.companyName === "") {
    return NextResponse.json(
      { error: "Company name can't be empty" },
      { status: 400 },
    );
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  }

  await connectDB();

  // ownerId in the filter enforces that you can only edit your own orders.
  const order = await Order.findOneAndUpdate(
    { _id: id, ownerId: userId },
    update,
    { returnDocument: "after" },
  );

  if (!order) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ order });
}

// DELETE /api/orders/:id
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  await connectDB();

  const res = await Order.deleteOne({ _id: id, ownerId: userId });
  if (res.deletedCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
