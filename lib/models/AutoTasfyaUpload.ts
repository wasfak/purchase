import { Schema, model, models, type InferSchemaType } from "mongoose";

// The saved source files for Auto Tasfya, one document per (user, month). Each
// of the three file "slots" (pos / buy / stock) is replaced independently when
// the user re-uploads that file for the month. Parsing happens client-side; this
// stores the parsed rows so the settlement can run without re-reading the HTML.

const SupplyOrderItemSchema = new Schema(
  {
    code: { type: String, default: "" },
    name: { type: String, default: "" },
    order: { type: Number, default: 0 },
  },
  { _id: false },
);

const SupplyOrderSchema = new Schema(
  {
    orderNumber: { type: String, default: "" },
    supplier: { type: String, default: "" },
    date: { type: String, default: "" }, // "YYYY/MM/DD"
    items: { type: [SupplyOrderItemSchema], default: [] },
  },
  { _id: false },
);

const PurchaseLineSchema = new Schema(
  {
    code: { type: String, default: "" },
    name: { type: String, default: "" },
    company: { type: String, default: "" },
    invoice: { type: String, default: "" },
    date: { type: String, default: "" }, // "YYYY/MM/DD"
    kmya: { type: Number, default: 0 },
    basicPct: { type: Number, default: 0 },
    extraPct: { type: Number, default: 0 },
    specialPct: { type: Number, default: 0 },
  },
  { _id: false },
);

const StockItemSchema = new Schema(
  {
    code: { type: String, default: "" },
    name: { type: String, default: "" },
    supplier: { type: String, default: "" },
    purchasePrice: { type: Number, default: 0 },
    salePrice: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
  },
  { _id: false },
);

const PosSlotSchema = new Schema(
  {
    fileName: { type: String, default: "" },
    savedAt: { type: Date, default: null },
    orders: { type: [SupplyOrderSchema], default: [] },
  },
  { _id: false },
);

const BuySlotSchema = new Schema(
  {
    fileName: { type: String, default: "" },
    savedAt: { type: Date, default: null },
    lines: { type: [PurchaseLineSchema], default: [] },
  },
  { _id: false },
);

const StockSlotSchema = new Schema(
  {
    fileName: { type: String, default: "" },
    savedAt: { type: Date, default: null },
    items: { type: [StockItemSchema], default: [] },
  },
  { _id: false },
);

const AutoTasfyaUploadSchema = new Schema(
  {
    // Clerk user ID this upload belongs to.
    ownerId: { type: String, required: true, index: true },
    // Which monthly cycle the files are filed under, as "YYYY-MM".
    month: { type: String, required: true, index: true },

    pos: { type: PosSlotSchema, default: null },
    buy: { type: BuySlotSchema, default: null },
    stock: { type: StockSlotSchema, default: null },
  },
  { timestamps: true },
);

// One document per user per month.
AutoTasfyaUploadSchema.index({ ownerId: 1, month: 1 }, { unique: true });

export type AutoTasfyaUploadDoc = InferSchemaType<typeof AutoTasfyaUploadSchema>;

export const AutoTasfyaUpload =
  models.AutoTasfyaUpload || model("AutoTasfyaUpload", AutoTasfyaUploadSchema);
