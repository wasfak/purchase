import { Schema, model, models, type InferSchemaType } from "mongoose";

// One saved daily "0 codes" list, as exported from AppSheet
// (AppSheet.ViewData.YYYY-MM-DD.csv). One document per (user, date); uploading
// the same date again replaces it. Each row keeps just what the code search
// needs: the code, its name, the order quantity, the supplier, and whether the
// row was marked in the "-0-" column (i.e. actually chosen to order that day).

const ZeroRowSchema = new Schema(
  {
    code: { type: String, default: "" },
    name: { type: String, default: "" },
    order: { type: String, default: "" },
    supplier: { type: String, default: "" },
    // true when the daily sheet's "-0-" column was set for this row.
    marked: { type: Boolean, default: false },
  },
  { _id: false },
);

const ZeroCodeUploadSchema = new Schema(
  {
    // Clerk user ID this upload belongs to.
    ownerId: { type: String, required: true, index: true },
    // The day the list is for, as "YYYY-MM-DD".
    date: { type: String, required: true, index: true },
    fileName: { type: String, default: "" },
    savedAt: { type: Date, default: null },
    rows: { type: [ZeroRowSchema], default: [] },
  },
  { timestamps: true },
);

// One document per user per day.
ZeroCodeUploadSchema.index({ ownerId: 1, date: 1 }, { unique: true });

export type ZeroCodeUploadDoc = InferSchemaType<typeof ZeroCodeUploadSchema>;

export const ZeroCodeUpload =
  models.ZeroCodeUpload || model("ZeroCodeUpload", ZeroCodeUploadSchema);
