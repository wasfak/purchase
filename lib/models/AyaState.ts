import { Schema, model, models, type InferSchemaType } from "mongoose";

// Shared singleton-ish state for the Review Aya workspace, keyed by a small set
// of well-known keys ("session" = the current in-progress sheet, "codes" = the
// cross-sheet code history map). One document per key, shared across everyone —
// this is the server-side equivalent of the client's IndexedDB session store.
const AyaStateSchema = new Schema(
  {
    // "session" or "codes".
    key: { type: String, required: true, unique: true },
    // The stored payload: a WorkingSession for "session", or a
    // Record<string, CodeMeta> map for "codes".
    data: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

export type AyaStateDoc = InferSchemaType<typeof AyaStateSchema>;

export const AyaState = models.AyaState || model("AyaState", AyaStateSchema);
