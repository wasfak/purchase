import { Schema, model, models, type InferSchemaType } from "mongoose";

// A saved "Review Aya" sheet, stored on the server so it's shared across every
// device and person who opens the Review Aya tab (a single shared workspace, NOT
// scoped per user). Mirrors the client's SavedDataset shape: columns are stored
// once, and each row is a compact values-array (plus its done/ignored/category
// state) held in the `rows` blob. `key` is the client-generated UUID, reused on
// re-save so updates land in place instead of duplicating.
const AyaDatasetSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
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

export type AyaDatasetDoc = InferSchemaType<typeof AyaDatasetSchema>;

export const AyaDataset =
  models.AyaDataset || model("AyaDataset", AyaDatasetSchema);
