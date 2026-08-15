// Storage for the "Review Aya" tab — a second, fully independent review
// workspace. It runs on its own IndexedDB database ("purchase-review-aya"), so
// none of its saved sheets, working session, or cross-sheet code history ever
// overlaps with the original "Review" tab.

import { makeReviewStore } from "@/lib/local-store";

export const ayaReviewStore = makeReviewStore("purchase-review-aya");
