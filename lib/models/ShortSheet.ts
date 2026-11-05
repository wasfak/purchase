import { model, models, type InferSchemaType } from "mongoose";

import { FlyingSheetSchema } from "@/lib/models/FlyingSheet";

// A saved "تصفية لم يصل" worksheet, one document per (user, month, company).
// Same shape as a FlyingSheet, but its rows come from the Auto Tasfya لم يصل
// items: `order` is the shortfall at the time the item was sent to the sheet,
// and the distributor cells record what has come in since.
export type ShortSheetDoc = InferSchemaType<typeof FlyingSheetSchema>;

export const ShortSheet =
  models.ShortSheet || model("ShortSheet", FlyingSheetSchema.clone());
