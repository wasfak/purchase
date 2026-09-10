// تشغيلات — PHARMA CIA raises a price by minting a NEW item code for the same
// physical product and appending a price-generation tag to its name (ت.ق, ت.ج /
// ت.ج2…ت.ج5, ن.ج1…), sometimes with a cross-reference like "كود جديد 139639".
// So one drug lives under 3–5 codes. Any analysis that keys on the raw code (or
// raw name) splits that drug across rows.
//
// `productKey` collapses every variant of one product to a single stable key by
// stripping the price-generation tags, the #B / #C / #N price markers, and the
// cross-reference notes, then normalizing whitespace. Both the أوامر توريد and
// فواتير الشراء reports read the item name from the same SofTech master, so the
// residual base name matches across them — which is what lets us aggregate an
// order placed under an old code with a purchase invoiced under the new code.

export function productKey(name: string): string {
  return (
    String(name ?? "")
      // #B# / #C.C# / #NA# … and any bare #B / #C / #N marker.
      .replace(/#[^#]*#/g, " ")
      .replace(/#\S*/g, " ")
      // Price-generation tags: ت.ق / ت.ج / ت.ج2… and the ن.ج1… series.
      .replace(/ت\s*\.\s*ق/g, " ")
      .replace(/ت\s*\.\s*ج\s*\d*/g, " ")
      .replace(/ن\s*\.\s*ج\s*\d*/g, " ")
      // Cross-references: "كود جديد 139639" / "كود قديم …".
      .replace(/كود\s+(?:جديد|قديم)\s*\d*/g, " ")
      // Tatweel + whitespace normalization.
      .replace(/ـ/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  );
}
