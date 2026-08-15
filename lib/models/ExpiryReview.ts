import { Schema, model, models, type InferSchemaType } from "mongoose";

// Per-company expiry review state, one document per (user, month, company).
// After uploading an expiry report you work through each company — marking it
// "done" once handled (or leaving it "pending") and jotting a short note. It's
// scoped to a month ("YYYY-MM") so each cycle keeps its own progress, and the
// company is keyed by its normalized name (diacritics/tatweel stripped) so small
// spelling variations still resolve to the same row.
const ExpiryReviewSchema = new Schema(
  {
    ownerId: { type: String, required: true, index: true },
    // The monthly cycle this review belongs to, "YYYY-MM".
    month: { type: String, required: true },
    // Normalized company key, for stable matching across name variants.
    key: { type: String, required: true },
    // The display company name, as last saved.
    companyName: { type: String, default: "" },
    // "pending" (default) or "done".
    status: { type: String, default: "pending" },
    // A free-text note for this company/month.
    note: { type: String, default: "" },
  },
  { timestamps: true },
);

ExpiryReviewSchema.index({ ownerId: 1, month: 1, key: 1 }, { unique: true });

export type ExpiryReviewDoc = InferSchemaType<typeof ExpiryReviewSchema>;

export const ExpiryReview =
  models.ExpiryReview || model("ExpiryReview", ExpiryReviewSchema);
