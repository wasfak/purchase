import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { Order, ORDER_TEXT_FIELDS } from "@/lib/models/Order";

// Pick only known text fields from an arbitrary object, coercing to strings.
function sanitize(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== "object") return out;
  const obj = input as Record<string, unknown>;
  for (const field of ORDER_TEXT_FIELDS) {
    const v = obj[field];
    if (v !== undefined && v !== null) out[field] = String(v).trim();
  }
  return out;
}

// GET /api/orders — the current user's orders, newest first.
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();
  const orders = await Order.find({ ownerId: userId })
    .sort({ createdAt: -1 })
    .lean();

  return NextResponse.json({ orders });
}

// POST /api/orders
//   single: { ...orderFields }
//   bulk (Excel import): { orders: [ {...}, {...} ] }
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  await connectDB();

  // Bulk insert (Excel import).
  if (Array.isArray(body.orders)) {
    const docs = body.orders
      .map(sanitize)
      .filter((o: Record<string, string>) => o.companyName)
      .map((o: Record<string, string>) => ({ ...o, ownerId: userId }));

    if (docs.length === 0) {
      return NextResponse.json(
        { error: "No valid rows (each row needs a company name)" },
        { status: 400 },
      );
    }

    const created = await Order.insertMany(docs);
    return NextResponse.json({ count: created.length, orders: created }, {
      status: 201,
    });
  }

  // Single create.
  const fields = sanitize(body);
  if (!fields.companyName) {
    return NextResponse.json(
      { error: "Company name is required" },
      { status: 400 },
    );
  }

  const order = await Order.create({ ...fields, ownerId: userId });
  return NextResponse.json({ order }, { status: 201 });
}
