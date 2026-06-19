import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { Task } from "@/lib/models/Task";
import { isValidDateStr, fromDateStr, todayStr, weekDates } from "@/lib/dates";

// GET /api/tasks?view=today
// GET /api/tasks?view=week&date=YYYY-MM-DD
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectDB();

  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view") ?? "today";

  let filter: Record<string, unknown>;
  // "all" shows newest first; the dated views read top-to-bottom by day.
  let sort: Record<string, 1 | -1> = { scheduledDate: 1, order: 1, createdAt: 1 };

  if (view === "all") {
    filter = { ownerId: userId };
    sort = { scheduledDate: -1, order: 1 };
  } else if (view === "week") {
    const dateParam = searchParams.get("date");
    const base = isValidDateStr(dateParam) ? fromDateStr(dateParam) : new Date();
    const week = weekDates(base);
    filter = {
      ownerId: userId,
      scheduledDate: { $gte: week[0], $lte: week[6] },
    };
  } else {
    // Today + carry-over: anything scheduled for today, plus older tasks
    // that were never finished (so they resurface instead of disappearing).
    const today = todayStr();
    filter = {
      ownerId: userId,
      $or: [
        { scheduledDate: today },
        { scheduledDate: { $lt: today }, status: { $ne: "done" } },
      ],
    };
  }

  const tasks = await Task.find(filter).sort(sort).lean();

  return NextResponse.json({ tasks });
}

// POST /api/tasks  { title, description?, scheduledDate? }
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const scheduledDate = isValidDateStr(body.scheduledDate)
    ? body.scheduledDate
    : todayStr();

  await connectDB();

  const task = await Task.create({
    ownerId: userId,
    title: body.title.trim(),
    description: typeof body.description === "string" ? body.description : "",
    scheduledDate,
    status: "todo",
  });

  return NextResponse.json({ task }, { status: 201 });
}
