import { Schema, model, models, type InferSchemaType } from "mongoose";

// Per-company notes, one document per (user, company). Unlike the per-order
// `notes` field (which is tied to a single month's order row), these persist
// across every month for a company — a running notebook you can search later.
// The company is keyed by its normalized name (diacritics/tatweel stripped) so
// small spelling variations still resolve to the same notebook.
// One note entry: the text plus when it was written (epoch ms), so the page can
// list them newest-first and let you search across them.
const CompanyNoteEntrySchema = new Schema(
  {
    text: { type: String, default: "" },
    at: { type: Number, default: 0 },
  },
  { _id: false },
);

const CompanyNoteSchema = new Schema(
  {
    ownerId: { type: String, required: true, index: true },
    // Normalized company key, for stable matching across name variants.
    key: { type: String, required: true },
    // The display company name, as last saved.
    companyName: { type: String, default: "" },
    // The company's notes, one entry per note, searchable on the company page.
    entries: { type: [CompanyNoteEntrySchema], default: [] },
    // Legacy single-text notes, kept so older documents still read.
    notes: { type: String, default: "" },
  },
  { timestamps: true },
);

CompanyNoteSchema.index({ ownerId: 1, key: 1 }, { unique: true });

export type CompanyNoteDoc = InferSchemaType<typeof CompanyNoteSchema>;

export const CompanyNote =
  models.CompanyNote || model("CompanyNote", CompanyNoteSchema);
