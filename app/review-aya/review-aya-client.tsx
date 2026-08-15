"use client";

import { ReviewWorkspace } from "@/components/review/review-workspace";
import { ayaReviewStore } from "@/lib/aya-store";

export function ReviewAyaClient() {
  return (
    <ReviewWorkspace
      store={ayaReviewStore}
      showOrders={false}
      showStatusColumns={false}
    />
  );
}
