import { Schema, model, models, type InferSchemaType } from "mongoose";

// One aggregated near-expiry item, as shown on the Expiry tab (already netted
// and filtered to the user's companies).
const ExpiryItemSchema = new Schema(
  {
    company: { type: String, default: "" },
    code: { type: String, default: "" },
    product: { type: String, default: "" },
    expiry: { type: String, default: "" }, // "YYYY/MM/DD"
    qty: { type: Number, default: 0 },
    avgCost: { type: Number, default: 0 },
    buyPrice: { type: Number, default: 0 },
    sellPrice: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  { _id: false },
);

// Rolled-up totals for a month, stored so the trend view loads without having
// to pull every month's item rows.
const ExpirySummarySchema = new Schema(
  {
    items: { type: Number, default: 0 },
    units: { type: Number, default: 0 },
    costValue: { type: Number, default: 0 },
    retailValue: { type: Number, default: 0 },
    expiredItems: { type: Number, default: 0 },
    expiredCost: { type: Number, default: 0 },
  },
  { _id: false },
);

// One saved snapshot for a single monthly cycle ("YYYY-MM"). Re-saving the same
// month replaces its entry, so each month keeps exactly one snapshot.
const MonthSnapshotSchema = new Schema(
  {
    month: { type: String, default: "" }, // "YYYY-MM"
    savedAt: { type: Date, default: Date.now },
    summary: { type: ExpirySummarySchema, default: () => ({}) },
    items: { type: [ExpiryItemSchema], default: [] },
  },
  { _id: false },
);

// One document per user. `months` holds the full history (oldest → newest); the
// Orders tab reads the latest month's items. `items`/`savedAt` are the legacy
// single-snapshot fields, kept only so an old record can be folded into
// `months` on the next save.
const ExpirySnapshotSchema = new Schema(
  {
    ownerId: { type: String, required: true, unique: true, index: true },
    months: { type: [MonthSnapshotSchema], default: [] },
    savedAt: { type: Date },
    items: { type: [ExpiryItemSchema], default: undefined },
  },
  { timestamps: true },
);

export type ExpiryItemDoc = InferSchemaType<typeof ExpiryItemSchema>;
export type ExpirySummaryDoc = InferSchemaType<typeof ExpirySummarySchema>;
export type MonthSnapshotDoc = InferSchemaType<typeof MonthSnapshotSchema>;
export type ExpirySnapshotDoc = InferSchemaType<typeof ExpirySnapshotSchema>;

export const ExpirySnapshot =
  models.ExpirySnapshot || model("ExpirySnapshot", ExpirySnapshotSchema);
