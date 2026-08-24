import { Schema, model, models, type InferSchemaType } from "mongoose";

// A saved main-"Review" sheet, stored on the server so it survives a PC change
// and syncs across the signed-in user's devices. Unlike AyaDataset (a single
// shared space), this is scoped PER USER via `ownerId` — each person sees only
// their own sheets. Mirrors the client's SavedDataset shape: columns are stored
// once, and each row is a compact values-array (plus its done/ignored/category
// state) held in the `rows` blob. `key` is the client-generated UUID, reused on
// re-save so updates land in place instead of duplicating.
const ReviewDatasetSchema = new Schema(
  {
    // Clerk user ID this sheet belongs to.
    ownerId: { type: String, required: true, index: true },
    key: { type: String, required: true },
    name: { type: String, default: "" },
    fileName: { type: String, default: "" },
    // Epoch ms — last time the sheet was written.
    savedAt: { type: Number, required: true },
    // Epoch ms of the first upload; preserved across re-saves.
    uploadedAt: { type: Number },
    columns: { type: [String], default: [] },
    numericColumns: { type: [String], default: [] },
    // Array of SavedRow objects: { values, completed, ignored?, statusAt?, category? }.
    rows: { type: [Schema.Types.Mixed], default: [] },
    rowCount: { type: Number, default: 0 },
    completedCount: { type: Number, default: 0 },
    ignoredCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// One document per (user, sheet id).
ReviewDatasetSchema.index({ ownerId: 1, key: 1 }, { unique: true });

export type ReviewDatasetDoc = InferSchemaType<typeof ReviewDatasetSchema>;

export const ReviewDataset =
  models.ReviewDataset || model("ReviewDataset", ReviewDatasetSchema);
