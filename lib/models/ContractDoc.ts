import { Schema, model, models, type InferSchemaType } from "mongoose";

// A saved "Contracts" result (matched purchase lines), stored on the server so
// it survives a PC change and syncs across the signed-in user's devices. Scoped
// PER USER via `ownerId`. Mirrors the client's Contract shape: columns are
// stored once, and each row is a plain values-array aligned to those columns,
// held in the `rows` blob. `key` is the client-generated UUID, reused on re-save
// so updates land in place instead of duplicating.
const ContractDocSchema = new Schema(
  {
    // Clerk user ID this contract belongs to.
    ownerId: { type: String, required: true, index: true },
    key: { type: String, required: true },
    name: { type: String, default: "" },
    // Epoch ms — last time the contract was written.
    savedAt: { type: Number, required: true },
    purchaseFileNames: { type: [String], default: [] },
    stockFileName: { type: String, default: "" },
    stockCodeCount: { type: Number, default: 0 },
    totalLineCount: { type: Number, default: 0 },
    matchedLineCount: { type: Number, default: 0 },
    columns: { type: [String], default: [] },
    // Array of rows, each a values-array (Cell[]) aligned to `columns`.
    rows: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);

// One document per (user, contract id).
ContractDocSchema.index({ ownerId: 1, key: 1 }, { unique: true });

export type ContractDocDoc = InferSchemaType<typeof ContractDocSchema>;

export const ContractDoc =
  models.ContractDoc || model("ContractDoc", ContractDocSchema);
