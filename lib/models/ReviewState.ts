import { Schema, model, models, type InferSchemaType } from "mongoose";

// Per-user state for the main "Review" workspace, keyed by a small set of
// well-known keys ("session" = the current in-progress sheet, "codes" = the
// cross-sheet code history map). One document per (user, key) — this is the
// server-side equivalent of the client's IndexedDB session store, scoped per
// user so each person's session/history stays private and syncs across devices.
const ReviewStateSchema = new Schema(
  {
    // Clerk user ID this state belongs to.
    ownerId: { type: String, required: true, index: true },
    // "session" or "codes".
    key: { type: String, required: true },
    // The stored payload: a WorkingSession for "session", or a
    // Record<string, CodeMeta> map for "codes".
    data: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

// One document per (user, key).
ReviewStateSchema.index({ ownerId: 1, key: 1 }, { unique: true });

export type ReviewStateDoc = InferSchemaType<typeof ReviewStateSchema>;

export const ReviewState =
  models.ReviewState || model("ReviewState", ReviewStateSchema);
