import { Schema, model, models, type InferSchemaType } from "mongoose";

// A saved "flying tasfya" (تصفية ع الطاير) worksheet, one document per
// (user, month, company). Built from an uploaded supply-order htm: each item
// (code / name / ordered qty) becomes a row, and the user records how much was
// obtained from each distributor across the (add-on-the-fly) distributor
// columns. Cell values are stored as the raw string the user typed — "100" or
// "100+10" (base + bounce/بونص) — so the sheet reopens exactly as entered and
// the qty/bounce split is re-derived on the client.

const FlyingColumnSchema = new Schema(
  {
    // Stable id so renaming a column never disturbs the cell data keyed to it.
    id: { type: String, required: true },
    name: { type: String, default: "" },
  },
  { _id: false },
);

const FlyingRowSchema = new Schema(
  {
    code: { type: String, default: "" },
    name: { type: String, default: "" },
    // الكمية المطلوبة — the ordered/requested quantity for this item.
    order: { type: Number, default: 0 },
    // Raw distributor cell strings, keyed by distributor column id.
    // e.g. { "c1": "100+10", "c7": "50" }
    cells: { type: Schema.Types.Mixed, default: {} },
    // Free-text note attached to this item; a badge shows next to the code.
    note: { type: String, default: "" },
    // Manual الباقى override — when set, wins over the computed balance.
    // null means "use the computed value".
    remainingOverride: { type: Number, default: null },
  },
  { _id: false },
);

const FlyingSheetSchema = new Schema(
  {
    ownerId: { type: String, required: true, index: true },
    month: { type: String, required: true, index: true },
    company: { type: String, required: true },

    // Provenance from the uploaded supply-order htm.
    supplier: { type: String, default: "" },
    referenceDate: { type: String, default: "" },
    orderNumber: { type: String, default: "" },

    // Distributor columns, in display order (added/renamed/removed on the fly).
    columns: { type: [FlyingColumnSchema], default: [] },
    rows: { type: [FlyingRowSchema], default: [] },
  },
  { timestamps: true },
);

FlyingSheetSchema.index({ ownerId: 1, month: 1, company: 1 }, { unique: true });

export type FlyingSheetDoc = InferSchemaType<typeof FlyingSheetSchema>;

export const FlyingSheet =
  models.FlyingSheet || model("FlyingSheet", FlyingSheetSchema);
