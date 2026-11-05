import { Schema, model, models, type InferSchemaType } from "mongoose";

// The saved discount / bonus history of reviewed items, one document per
// (user, company). `codes` are the codes the user asked to review; `lines` are
// the buy lines of those items (تشغيلات variants included), accumulated across
// uploads so the history keeps growing and survives re-uploading a buy file.

const HistoryLineSchema = new Schema(
  {
    code: { type: String, default: "" },
    name: { type: String, default: "" },
    company: { type: String, default: "" }, // the distributor
    invoice: { type: String, default: "" },
    date: { type: String, default: "" }, // "YYYY/MM/DD"
    kmya: { type: Number, default: 0 },
    basicPct: { type: Number, default: 0 },
    extraPct: { type: Number, default: 0 },
    specialPct: { type: Number, default: 0 },
  },
  { _id: false },
);

const ItemHistorySchema = new Schema(
  {
    ownerId: { type: String, required: true, index: true },
    // normalizeCompany(company): matches however the name was spaced or typed.
    companyKey: { type: String, required: true },
    company: { type: String, default: "" },
    codes: { type: [String], default: [] },
    lines: { type: [HistoryLineSchema], default: [] },
  },
  { timestamps: true },
);

ItemHistorySchema.index({ ownerId: 1, companyKey: 1 }, { unique: true });

export type ItemHistoryDoc = InferSchemaType<typeof ItemHistorySchema>;

export const ItemHistory =
  models.ItemHistory || model("ItemHistory", ItemHistorySchema);
