import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isValidObjectId } from "mongoose";

import { connectDB } from "@/lib/db";
import { Task, TASK_STATUSES, type TaskStatus } from "@/lib/models/Task";
import { isValidDateStr } from "@/lib/dates";

// PATCH /api/tasks/:id  { title?, description?, status?, scheduledDate?, order? }
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
  if (!body) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.title === "string" && body.title.trim()) {
    update.title = body.title.trim();
  }
  if (typeof body.description === "string") {
    update.description = body.description;
  }
  if (isValidDateStr(body.scheduledDate)) {
    update.scheduledDate = body.scheduledDate;
  }
  if (typeof body.order === "number") {
    update.order = body.order;
  }
  if (TASK_STATUSES.includes(body.status as TaskStatus)) {
    update.status = body.status;
    update.completedAt = body.status === "done" ? new Date() : null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No valid fields" }, { status: 400 });
  }

  await connectDB();

  // The ownerId in the filter enforces that you can only touch your own tasks.
  const task = await Task.findOneAndUpdate({ _id: id, ownerId: userId }, update, {
    returnDocument: "after",
  });

  if (!task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ task });
}

// DELETE /api/tasks/:id
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

  const res = await Task.deleteOne({ _id: id, ownerId: userId });
  if (res.deletedCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
