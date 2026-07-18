import { Schema, model, models, type InferSchemaType } from "mongoose";

// A stored file attachment (the actual upload wiring comes in a later pass;
// these fields hold the metadata once a file is attached).
const AttachmentSchema = new Schema(
  {
    url: { type: String, default: "" },
    name: { type: String, default: "" },
  },
  { _id: false },
);

const OrderSchema = new Schema(
  {
    // Clerk user ID of the employee who owns this order.
    ownerId: { type: String, required: true, index: true },

    companyName: { type: String, required: true, trim: true },

    // Which monthly cycle this order belongs to, as "YYYY-MM". Each month the
    // orders are redone, so a company has one order row per month.
    month: { type: String, default: "", index: true },

    // Recurring day of the month (1–31, stored as a string) this order is due.
    orderDay: { type: String, default: "" },

    // Dates stored as "YYYY-MM-DD" strings (empty string = not set).
    dateOfDoing: { type: String, default: "" },
    inReview: { type: String, default: "" },
    sendDate: { type: String, default: "" },

    toWhere: { type: String, default: "" },
    exp: { type: String, default: "" }, // expired items (text)

    // "yes" when this company doesn't need an order this month; "" otherwise.
    noNeed: { type: String, default: "" },

    // "yes" / "no" — flags an order as important for the month.
    important: { type: String, default: "" },

    // Text notes, each with an optional file attachment (pdf/excel).
    damaged: { type: String, default: "" },
    damagedFile: { type: AttachmentSchema, default: null },
    finished: { type: String, default: "" },
    finishedFile: { type: AttachmentSchema, default: null },

    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

OrderSchema.index({ ownerId: 1, createdAt: -1 });

export type OrderDoc = InferSchemaType<typeof OrderSchema>;

export const Order = models.Order || model("Order", OrderSchema);

// The editable text fields, shared between the API and the Excel importer.
export const ORDER_TEXT_FIELDS = [
  "companyName",
  "month",
  "orderDay",
  "dateOfDoing",
  "inReview",
  "sendDate",
  "toWhere",
  "exp",
  "damaged",
  "finished",
  "notes",
  "noNeed",
  "important",
] as const;

export type OrderTextField = (typeof ORDER_TEXT_FIELDS)[number];
