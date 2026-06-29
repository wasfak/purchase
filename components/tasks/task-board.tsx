"use client";

import * as React from "react";
import Link from "next/link";
import {
  CircleCheck,
  CircleDot,
  Circle,
  Plus,
  Trash2,
  ArrowRight,
  Check,
  RotateCcw,
  Loader2,
  Package,
  ExternalLink,
  Filter,
  CalendarDays,
  CalendarOff,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { todayStr, weekDates, fromDateStr } from "@/lib/dates";

type TaskStatus = "todo" | "in_progress" | "done";

type Task = {
  _id: string;
  title: string;
  description: string;
  status: TaskStatus;
  scheduledDate: string;
  completedAt: string | null;
  order: number;
  // Set on virtual tasks derived from an order that's due this week.
  kind?: "order";
  orderId?: string;
};

// The bits of an order we need to surface it in the week view.
type OrderLite = {
  _id: string;
  companyName: string;
  orderDay?: string;
  dateOfDoing?: string;
};

type View = "today" | "week" | "all";

const VIEWS: { key: View; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "all", label: "All" },
];

const STATUS_META: Record<
  TaskStatus,
  { label: string; icon: React.ElementType; className: string }
> = {
  todo: { label: "To do", icon: Circle, className: "text-muted-foreground" },
  in_progress: { label: "In progress", icon: CircleDot, className: "text-amber-500" },
  done: { label: "Done", icon: CircleCheck, className: "text-emerald-500" },
};

const STATUS_TOAST: Record<TaskStatus, string> = {
  todo: "Marked as to-do",
  in_progress: "Marked as ongoing",
  done: "Task marked finished",
};

function formatDay(dateStr: string): string {
  return fromDateStr(dateStr).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Orders recur on a day-of-month (orderDay). Turn any order whose day falls on
// one of this week's dates into a virtual, read-only task pinned to that day.
// An order counts as done once its "date of doing" is filled in.
function ordersToWeekTasks(orders: OrderLite[], days: string[]): Task[] {
  const dateByDayNum = new Map<number, string>();
  for (const d of days) dateByDayNum.set(parseInt(d.slice(8, 10), 10), d);

  const out: Task[] = [];
  for (const o of orders) {
    const day = parseInt(o.orderDay ?? "", 10);
    if (!day || day < 1 || day > 31) continue;
    const date = dateByDayNum.get(day);
    if (!date) continue;
    out.push({
      _id: `order:${o._id}`,
      title: o.companyName,
      description: "",
      status: (o.dateOfDoing ?? "").trim() ? "done" : "todo",
      scheduledDate: date,
      completedAt: null,
      order: 0,
      kind: "order",
      orderId: o._id,
    });
  }
  return out;
}

// Orders for the "today" view: an order is due today when its day-of-month
// matches today, and carries over (like an unfinished task) when its day this
// month has already passed and it isn't done yet.
function ordersToTodayTasks(orders: OrderLite[], today: string): Task[] {
  const month = today.slice(0, 7); // "YYYY-MM"
  const out: Task[] = [];
  for (const o of orders) {
    const day = parseInt(o.orderDay ?? "", 10);
    if (!day || day < 1 || day > 31) continue;
    const due = `${month}-${String(day).padStart(2, "0")}`;
    const done = (o.dateOfDoing ?? "").trim() !== "";
    if (due > today) continue; // not due yet this month
    if (due < today && done) continue; // already past and handled
    out.push({
      _id: `order:${o._id}`,
      title: o.companyName,
      description: "",
      status: done ? "done" : "todo",
      scheduledDate: due,
      completedAt: null,
      order: 0,
      kind: "order",
      orderId: o._id,
    });
  }
  return out;
}

export function TaskBoard({ initialView = "today" }: { initialView?: View }) {
  const today = todayStr();
  const [view, setView] = React.useState<View>(initialView);
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [orders, setOrders] = React.useState<OrderLite[]>([]);
  const [loading, setLoading] = React.useState(true);

  // New-task form state.
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [date, setDate] = React.useState(today);
  const [submitting, setSubmitting] = React.useState(false);

  // Tasks with an in-flight save. Used to show a spinner and block re-clicks.
  const [busyIds, setBusyIds] = React.useState<Set<string>>(new Set());
  const setBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  // Refresh used after mutations (called from event handlers).
  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks?view=${view}`);
      if (!res.ok) throw new Error("Failed to load tasks");
      const data = await res.json();
      setTasks(data.tasks ?? []);
    } catch {
      toast.error("Couldn't load tasks");
    }
  }, [view]);

  // Initial load. Inlined (with an active guard) so we don't call setState
  // for a component that unmounted mid-fetch, e.g. when navigating away.
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/tasks?view=${view}`);
        if (!res.ok) throw new Error("Failed to load tasks");
        const data = await res.json();
        if (active) setTasks(data.tasks ?? []);
      } catch {
        if (active) toast.error("Couldn't load tasks");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [view]);

  // Orders are independent of the task view, so they're loaded once and reused.
  // The week view turns any order due this week into a virtual task.
  const loadOrders = React.useCallback(async () => {
    try {
      const res = await fetch("/api/orders");
      if (!res.ok) return;
      const data = await res.json();
      setOrders(data.orders ?? []);
    } catch {
      // Non-fatal: tasks still render without the order overlay.
    }
  }, []);

  React.useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // Mark an order's "date of doing" as today, straight from the week board.
  async function completeOrder(orderId: string) {
    const key = `order:${orderId}`;
    setBusy(key, true);
    // Optimistic: flip it to done locally.
    setOrders((prev) =>
      prev.map((o) =>
        o._id === orderId ? { ...o, dateOfDoing: today } : o,
      ),
    );
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateOfDoing: today }),
      });
      if (!res.ok) throw new Error();
      toast.success("Order marked as done");
    } catch {
      toast.error("Couldn't update order");
      await loadOrders();
    } finally {
      setBusy(key, false);
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, scheduledDate: date }),
      });
      if (!res.ok) throw new Error();
      setTitle("");
      setDescription("");
      await load();
      toast.success("Task added");
    } catch {
      toast.error("Couldn't add task");
    } finally {
      setSubmitting(false);
    }
  }

  async function patchTask(
    id: string,
    patch: Partial<Task>,
    successMessage?: string,
  ) {
    setBusy(id, true);
    // Optimistic update.
    setTasks((prev) =>
      prev.map((t) => (t._id === id ? { ...t, ...patch } : t)),
    );
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
      await load();
      // Confirm to the user that the change was actually saved to the DB.
      if (successMessage) toast.success(successMessage);
    } catch {
      toast.error("Couldn't update task");
      await load();
    } finally {
      setBusy(id, false);
    }
  }

  async function deleteTask(id: string) {
    setBusy(id, true);
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setTasks((prev) => prev.filter((t) => t._id !== id));
      toast.success("Task deleted");
    } catch {
      toast.error("Couldn't delete task");
      await load();
    } finally {
      setBusy(id, false);
    }
  }

  const addForm = (
    <form
      onSubmit={addTask}
      className="rounded-xl border border-border bg-card p-2 shadow-sm"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 sm:w-auto"
        />
        <Button type="submit" size="lg" disabled={submitting || !title.trim()}>
          <Plus /> Add
        </Button>
      </div>
      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Add a note (optional)"
        className="mt-1.5 w-full rounded-lg bg-transparent px-3 py-1.5 text-sm text-muted-foreground outline-none placeholder:text-muted-foreground/60"
      />
    </form>
  );

  const switcher = (
    <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
      {VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          onClick={() => setView(v.key)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            view === v.key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {addForm}
        {switcher}
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const doneCount = tasks.filter((t) => t.status === "done").length;

  const setStatus = (t: Task, status: TaskStatus) =>
    patchTask(t._id, { status }, STATUS_TOAST[status]);

  return (
    <div className="space-y-4">
      {addForm}

      {switcher}

      <StatBar total={tasks.length} done={doneCount} />

      {view === "today" && (
        <TodayList
          tasks={tasks}
          orders={orders}
          today={today}
          busyIds={busyIds}
          onSetStatus={setStatus}
          onMoveToToday={(t) =>
            patchTask(t._id, { scheduledDate: today }, "Moved to today")
          }
          onDelete={deleteTask}
          onCompleteOrder={completeOrder}
        />
      )}

      {view === "week" && (
        <WeekList
          tasks={tasks}
          orders={orders}
          today={today}
          busyIds={busyIds}
          onSetStatus={setStatus}
          onDelete={deleteTask}
          onCompleteOrder={completeOrder}
        />
      )}

      {view === "all" && (
        <AllList
          tasks={tasks}
          today={today}
          busyIds={busyIds}
          onSetStatus={setStatus}
          onDelete={deleteTask}
        />
      )}
    </div>
  );
}

function StatBar({ total, done }: { total: number; done: number }) {
  const remaining = total - done;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Stat label="Total" value={total} />
        <Stat label="Finished" value={done} valueClassName="text-emerald-500" />
        <Stat label="Remaining" value={remaining} valueClassName="text-amber-500" />
      </div>
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Completion</span>
          <span className="font-semibold tabular-nums">{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: number;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-center shadow-sm">
      <div className={cn("text-2xl font-bold tabular-nums", valueClassName)}>
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function TodayList({
  tasks,
  orders,
  today,
  busyIds,
  onSetStatus,
  onMoveToToday,
  onDelete,
  onCompleteOrder,
}: {
  tasks: Task[];
  orders: OrderLite[];
  today: string;
  busyIds: Set<string>;
  onSetStatus: (t: Task, status: TaskStatus) => void;
  onMoveToToday: (t: Task) => void;
  onDelete: (id: string) => void;
  onCompleteOrder: (orderId: string) => void;
}) {
  const orderTasks = React.useMemo(
    () => ordersToTodayTasks(orders, today),
    [orders, today],
  );
  const items = [...tasks, ...orderTasks];
  if (items.length === 0) {
    return <EmptyState message="Nothing for today yet. Add your first task above." />;
  }
  return (
    <ul className="space-y-2">
      {items.map((t) => {
        const overdue = t.scheduledDate < today && t.status !== "done";
        return (
          <TaskRow
            key={t._id}
            task={t}
            busy={busyIds.has(t._id)}
            onSetStatus={onSetStatus}
            onDelete={onDelete}
            onCompleteOrder={onCompleteOrder}
            badge={
              t.kind !== "order" && overdue ? (
                <button
                  onClick={() => onMoveToToday(t)}
                  className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive hover:bg-destructive/20"
                  title="Move to today"
                >
                  Overdue · {formatDay(t.scheduledDate)} <ArrowRight className="size-3" />
                </button>
              ) : null
            }
          />
        );
      })}
    </ul>
  );
}

function WeekList({
  tasks,
  orders,
  today,
  busyIds,
  onSetStatus,
  onDelete,
  onCompleteOrder,
}: {
  tasks: Task[];
  orders: OrderLite[];
  today: string;
  busyIds: Set<string>;
  onSetStatus: (t: Task, status: TaskStatus) => void;
  onDelete: (id: string) => void;
  onCompleteOrder: (orderId: string) => void;
}) {
  const days = weekDates();
  const orderTasks = React.useMemo(
    () => ordersToWeekTasks(orders, days),
    [orders, days],
  );
  const byDay = React.useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const d of days) map.set(d, []);
    // Real tasks first, then any orders due that day.
    for (const t of [...tasks, ...orderTasks]) {
      if (map.has(t.scheduledDate)) map.get(t.scheduledDate)!.push(t);
    }
    return map;
  }, [tasks, orderTasks, days]);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {days.map((d) => {
        const dayTasks = byDay.get(d) ?? [];
        return (
          <div
            key={d}
            className={cn(
              "rounded-xl border border-border bg-card p-3",
              d === today && "ring-2 ring-primary/40",
            )}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{formatDay(d)}</h3>
              {d === today && (
                <span className="text-xs font-medium text-primary">Today</span>
              )}
            </div>
            {dayTasks.length === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">No tasks</p>
            ) : (
              <ul className="space-y-2">
                {dayTasks.map((t) => (
                  <TaskRow
                    key={t._id}
                    task={t}
                    busy={busyIds.has(t._id)}
                    onSetStatus={onSetStatus}
                    onDelete={onDelete}
                    onCompleteOrder={onCompleteOrder}
                    compact
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

type StatusFilter = "all" | "ongoing" | "done";
type DateFilter = "all" | "with_date" | "without_date";

function AllList({
  tasks,
  today,
  busyIds,
  onSetStatus,
  onDelete,
}: {
  tasks: Task[];
  today: string;
  busyIds: Set<string>;
  onSetStatus: (t: Task, status: TaskStatus) => void;
  onDelete: (id: string) => void;
}) {
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = React.useState<DateFilter>("all");

  const filtered = React.useMemo(() => {
    let result = tasks;
    if (statusFilter === "ongoing") {
      result = result.filter((t) => t.status === "todo" || t.status === "in_progress");
    } else if (statusFilter === "done") {
      result = result.filter((t) => t.status === "done");
    }
    if (dateFilter === "with_date") {
      result = result.filter((t) => t.scheduledDate);
    } else if (dateFilter === "without_date") {
      result = result.filter((t) => !t.scheduledDate);
    }
    return result;
  }, [tasks, statusFilter, dateFilter]);

  if (tasks.length === 0) {
    return <EmptyState message="No tasks yet. Add your first task above." />;
  }

  const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "ongoing", label: "Ongoing" },
    { key: "done", label: "Done" },
  ];

  const DATE_OPTIONS: { key: DateFilter; label: string; icon: React.ElementType }[] = [
    { key: "all", label: "Any", icon: Filter },
    { key: "with_date", label: "With date", icon: CalendarDays },
    { key: "without_date", label: "No date", icon: CalendarOff },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {STATUS_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setStatusFilter(o.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                statusFilter === o.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {DATE_OPTIONS.map((o) => {
            const Icon = o.icon;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => setDateFilter(o.key)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  dateFilter === o.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3" />
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState message="No tasks match the current filters." />
      ) : (
        <ul className="space-y-2">
          {filtered.map((t) => {
            const overdue = t.scheduledDate < today && t.status !== "done";
            return (
              <TaskRow
                key={t._id}
                task={t}
                busy={busyIds.has(t._id)}
                onSetStatus={onSetStatus}
                onDelete={onDelete}
                badge={
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                      overdue
                        ? "bg-destructive/10 text-destructive"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {formatDay(t.scheduledDate)}
                  </span>
                }
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TaskRow({
  task,
  busy,
  onSetStatus,
  onDelete,
  onCompleteOrder,
  badge,
  compact,
}: {
  task: Task;
  busy?: boolean;
  onSetStatus: (t: Task, status: TaskStatus) => void;
  onDelete: (id: string) => void;
  onCompleteOrder?: (orderId: string) => void;
  badge?: React.ReactNode;
  compact?: boolean;
}) {
  // Orders due this week are surfaced as read-only rows that link back to the
  // Orders page; they can be completed but not edited or deleted here.
  if (task.kind === "order") {
    return (
      <OrderRow
        task={task}
        busy={busy}
        compact={compact}
        onCompleteOrder={onCompleteOrder}
      />
    );
  }

  const meta = STATUS_META[task.status];
  const Icon = busy ? Loader2 : meta.icon;
  const done = task.status === "done";
  const ongoing = task.status === "in_progress";

  // Clicking the task toggles "ongoing" (to-do <-> in progress).
  const toggleOngoing = () => {
    if (busy || done) return;
    onSetStatus(task, ongoing ? "todo" : "in_progress");
  };

  return (
    <li
      className={cn(
        "flex items-start gap-2 rounded-lg border border-border bg-background p-2.5 transition-opacity",
        !compact && "shadow-sm",
        busy && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={toggleOngoing}
        disabled={busy || done}
        className={cn(
          "mt-1 shrink-0 transition-colors disabled:cursor-default",
          busy ? "text-muted-foreground" : meta.className,
        )}
        title={
          busy
            ? "Saving…"
            : done
              ? meta.label
              : ongoing
                ? "Click to mark as to-do"
                : "Click to mark as ongoing"
        }
        aria-label={meta.label}
      >
        <Icon className={cn("size-5", busy && "animate-spin")} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleOngoing}
            disabled={busy || done}
            className={cn(
              "text-left text-sm font-medium transition-colors disabled:cursor-default",
              done ? "text-muted-foreground line-through" : "hover:text-primary",
            )}
          >
            {task.title}
          </button>
          {badge}
        </div>
        {task.description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{task.description}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {done ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => onSetStatus(task, "todo")}
            title="Reopen task"
          >
            {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            {!compact && "Reopen"}
          </Button>
        ) : (
          <Button
            type="button"
            size="xs"
            disabled={busy}
            onClick={() => onSetStatus(task, "done")}
            title="Mark this task as finished"
          >
            {busy ? <Loader2 className="animate-spin" /> : <Check />}
            {!compact && (busy ? "Saving…" : "Mark as finished")}
          </Button>
        )}
        <button
          type="button"
          onClick={() => onDelete(task._id)}
          disabled={busy}
          className="text-muted-foreground/60 transition-colors hover:text-destructive disabled:opacity-50"
          title="Delete task"
          aria-label="Delete task"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </li>
  );
}

type OrderUrgency = "done" | "soon" | "overdue" | "later";

// Colour an order by how close today is to its due day:
//   • due today or within the next 3 days → green ("soon")
//   • any day after the due day → red ("overdue")
//   • more than 3 days out → neutral ("later")
function orderUrgency(dueStr: string, done: boolean): OrderUrgency {
  if (done) return "done";
  const days = Math.round(
    (fromDateStr(dueStr).getTime() - fromDateStr(todayStr()).getTime()) /
      86_400_000,
  );
  if (days < 0) return "overdue";
  if (days <= 3) return "soon";
  return "later";
}

const ORDER_URGENCY_META: Record<
  OrderUrgency,
  { icon: string; badge: string; label: string; row: string }
> = {
  done: {
    icon: "text-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    label: "Done",
    row: "",
  },
  soon: {
    icon: "text-emerald-500",
    badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    label: "Due soon",
    row: "border-emerald-500/40",
  },
  overdue: {
    icon: "text-destructive",
    badge: "bg-destructive/10 text-destructive",
    label: "Overdue",
    row: "border-destructive/40 bg-destructive/5",
  },
  later: {
    icon: "text-sky-500",
    badge: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    label: "Order due",
    row: "",
  },
};

function OrderRow({
  task,
  busy,
  compact,
  onCompleteOrder,
}: {
  task: Task;
  busy?: boolean;
  compact?: boolean;
  onCompleteOrder?: (orderId: string) => void;
}) {
  const done = task.status === "done";
  const meta = ORDER_URGENCY_META[orderUrgency(task.scheduledDate, done)];
  const Icon = busy ? Loader2 : Package;
  return (
    <li
      className={cn(
        "flex items-start gap-2 rounded-lg border border-border bg-background p-2.5 transition-opacity",
        !compact && "shadow-sm",
        meta.row,
        busy && "opacity-60",
      )}
    >
      <Icon
        className={cn(
          "mt-1 size-5 shrink-0",
          busy ? "text-muted-foreground animate-spin" : meta.icon,
        )}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "text-sm font-medium",
              done && "text-muted-foreground line-through",
            )}
          >
            {task.title}
          </span>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
              meta.badge,
            )}
          >
            {meta.label}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {!done && (
          <Button
            type="button"
            size="xs"
            disabled={busy}
            onClick={() => task.orderId && onCompleteOrder?.(task.orderId)}
            title="Mark this order as done"
          >
            {busy ? <Loader2 className="animate-spin" /> : <Check />}
            {!compact && (busy ? "Saving…" : "Mark done")}
          </Button>
        )}
        <Link
          href="/orders"
          className="text-muted-foreground/60 transition-colors hover:text-foreground"
          title="Open in Orders"
          aria-label="Open in Orders"
        >
          <ExternalLink className="size-4" />
        </Link>
      </div>
    </li>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
