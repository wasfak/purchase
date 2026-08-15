"use client";

import { ReviewWorkspace } from "@/components/review/review-workspace";
import { defaultReviewStore } from "@/lib/local-store";

export function ReviewClient() {
  return <ReviewWorkspace store={defaultReviewStore} />;
}
