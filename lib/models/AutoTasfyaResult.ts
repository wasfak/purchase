import { Schema, model, models, type InferSchemaType } from "mongoose";

// A saved settlement result, one document per (user, month, company). Stores the
// computed report + over-order items + the user's per-item settlement edits, so
// it can be reopened later from the Orders row.

const PurchaseDetailSchema = new Schema(
  {
    supplier: { type: String, default: "" },
    invoice: { type: String, default: "" },
    date: { type: String, default: "" },
    received: { type: Number, default: 0 },
    basicPct: { type: Number, default: 0 },
    extraPct: { type: Number, default: 0 },
    specialPct: { type: Number, default: 0 },
  },
  { _id: false },
);

const ReportRowSchema = new Schema(
  {
    code: { type: String, default: "" },
    name: { type: String, default: "" },
    supplier: { type: String, default: "" },
    order: { type: Number, default: 0 },
    received: { type: Number, default: 0 },
    basicPct: { type: Number, default: 0 },
    extraPct: { type: Number, default: 0 },
    specialPct: { type: Number, default: 0 },
    bonus: { type: Number, default: 0 },
    tasfya: { type: Number, default: 0 },
    lines: { type: [PurchaseDetailSchema], default: [] },
  },
  { _id: false },
);

const ExtraItemSchema = new Schema(
  {
    code: { type: String, default: "" },
    name: { type: String, default: "" },
    supplier: { type: String, default: "" },
    received: { type: Number, default: 0 },
    basicPct: { type: Number, default: 0 },
    extraPct: { type: Number, default: 0 },
    specialPct: { type: Number, default: 0 },
    bonus: { type: Number, default: 0 },
    lines: { type: [PurchaseDetailSchema], default: [] },
  },
  { _id: false },
);

const SupplierColumnSchema = new Schema(
  {
    id: { type: String, required: true },
    name: { type: String, default: "" },
  },
  { _id: false },
);

const AutoTasfyaResultSchema = new Schema(
  {
    ownerId: { type: String, required: true, index: true },
    month: { type: String, required: true, index: true },
    company: { type: String, required: true },

    referenceDate: { type: String, default: "" },
    orderNumber: { type: String, default: "" },
    report: { type: [ReportRowSchema], default: [] },
    extraItems: { type: [ExtraItemSchema], default: [] },
    // Per-item settlement overrides, keyed by item code (raw strings).
    edits: { type: Schema.Types.Mixed, default: {} },
    // Codes the user manually hid from the view/export (trimmed strings).
    hiddenCodes: { type: [String], default: [] },
    // "لم يصل" supplier columns (renamable, like Flying tasfya's distributors).
    supplierColumns: { type: [SupplierColumnSchema], default: [] },
    // Per-code supplier cells: { [code]: { [colId]: "100" | "100+10" } }. The base
    // deducts from a negative التسوية; بونص only fills the gap toward 0.
    supplierCells: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

AutoTasfyaResultSchema.index({ ownerId: 1, month: 1, company: 1 }, { unique: true });

export type AutoTasfyaResultDoc = InferSchemaType<typeof AutoTasfyaResultSchema>;

export const AutoTasfyaResult =
  models.AutoTasfyaResult || model("AutoTasfyaResult", AutoTasfyaResultSchema);
