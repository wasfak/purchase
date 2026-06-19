import { Schema, model, models, type InferSchemaType } from "mongoose";

export const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const TaskSchema = new Schema(
  {
    // Clerk user ID of the employee who owns this task.
    ownerId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    description: { type: String, default: "", maxlength: 5000 },
    status: {
      type: String,
      enum: TASK_STATUSES,
      default: "todo",
    },
    // The day the task is planned for, as "YYYY-MM-DD".
    scheduledDate: { type: String, required: true },
    // Set when the task is marked done; cleared if reopened.
    completedAt: { type: Date, default: null },
    // Manual sort order within a day.
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Fast lookups for "my tasks on/around a date".
TaskSchema.index({ ownerId: 1, scheduledDate: 1 });

export type TaskDoc = InferSchemaType<typeof TaskSchema>;

export const Task = models.Task || model("Task", TaskSchema);
