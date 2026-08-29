import { Schema, model, models, type InferSchemaType } from "mongoose";

// Per-company "auto display" flag for the تقفيلات (settlements) page. One
// document per (user, company). The company is keyed by its normalized name
// (diacritics/tatweel stripped, lowercased) so small spelling variations still
// resolve to the same flag. A row exists only for companies the user has
// touched here; absence means "not marked for auto display".
const TaqfeelaFlagSchema = new Schema(
  {
    ownerId: { type: String, required: true, index: true },
    // Normalized company key, for stable matching across name variants.
    key: { type: String, required: true },
    // The display company name, as last seen.
    companyName: { type: String, default: "" },
    // Whether this company is marked to be auto-displayed (drives a later step).
    autoDisplay: { type: Boolean, default: false },
    // Dates stored as "YYYY-MM-DD" strings (empty string = not set).
    // When the settlement was actually done.
    dateOfDoing: { type: String, default: "" },
    // When it was handed over to حسابات (accounting).
    dateToAccounts: { type: String, default: "" },
  },
  { timestamps: true },
);

TaqfeelaFlagSchema.index({ ownerId: 1, key: 1 }, { unique: true });

export type TaqfeelaFlagDoc = InferSchemaType<typeof TaqfeelaFlagSchema>;

export const TaqfeelaFlag =
  models.TaqfeelaFlag || model("TaqfeelaFlag", TaqfeelaFlagSchema);
