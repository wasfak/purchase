// The "Review tasfya" reminder for an order, shared by the Orders page (its
// Review column + filter) and the batch Auto Tasfya page (which settles every
// order that's due for review in a month).

// The order fields the reminder reads; other fields are allowed (so the Orders
// page's loose Record-shaped rows fit too).
type ReviewFields = {
  sendDate?: string;
  reviewed?: string;
  finished?: string;
  [field: string]: unknown;
};

// How many days after the send date before we nudge you to review the order
// ("tasfya" / settlement) — i.e. check whether it actually arrived.
export const REVIEW_AFTER_DAYS = 5;

// Whether the user has manually marked this order as reviewed ("tasfya" done).
export function isReviewed(order: ReviewFields): boolean {
  return (order.reviewed ?? "").trim() === "yes";
}

// The review reminder state for one order, derived from its send date:
//  - "none":     no send date yet, nothing to review.
//  - "reviewed": the user manually ticked it off — settled (green).
//  - "done":     the order is finished, so it's already settled.
//  - "due":      REVIEW_AFTER_DAYS+ days have passed since sending — remind now.
//  - "waiting":  sent, but the review day hasn't arrived yet (still counting).
// `days` is how many days remain until review (waiting) or have passed (due).
export function reviewStatus(order: ReviewFields): {
  state: "none" | "reviewed" | "done" | "due" | "waiting";
  days: number;
} {
  const send = (order.sendDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(send)) return { state: "none", days: 0 };
  if (isReviewed(order)) return { state: "reviewed", days: 0 };
  if ((order.finished ?? "").trim()) return { state: "done", days: 0 };

  const sent = new Date(`${send}T00:00:00`);
  const due = new Date(sent);
  due.setDate(due.getDate() + REVIEW_AFTER_DAYS);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const diffDays = Math.round((now.getTime() - due.getTime()) / 86_400_000);
  if (diffDays >= 0) return { state: "due", days: diffDays };
  return { state: "waiting", days: -diffDays };
}

// An order needs a "review tasfya" nudge when REVIEW_AFTER_DAYS have passed
// since it was sent and it isn't finished yet.
export function isReviewDue(order: ReviewFields): boolean {
  return reviewStatus(order).state === "due";
}
