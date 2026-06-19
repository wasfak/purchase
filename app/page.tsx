import { TaskBoard } from "@/components/tasks/task-board";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-5 p-6">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">My Tasks</h1>
        <p className="text-sm text-muted-foreground">
          Track what you&apos;re working on. Switch between today, this week, or
          all your tasks.
        </p>
      </div>
      <TaskBoard initialView="today" />
    </main>
  );
}
