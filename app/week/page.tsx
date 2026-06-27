import { TaskBoard } from "@/components/tasks/task-board";

export default function Page() {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 p-6">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">This Week</h1>
        <p className="text-sm text-muted-foreground">
          Plan your week. Add tasks to any day and track your progress.
        </p>
      </div>
      <TaskBoard initialView="week" />
    </main>
  );
}
