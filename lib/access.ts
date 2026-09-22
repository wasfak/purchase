import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

// Emails allowed to see the admin Dashboard. Configure as a comma-separated
// list in DASHBOARD_ALLOWED_EMAILS (see .env.local). Matching is
// case-insensitive and ignores surrounding whitespace.
const ALLOWED_EMAILS = (process.env.DASHBOARD_ALLOWED_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAllowedDashboardEmail(
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  return ALLOWED_EMAILS.includes(email.toLowerCase());
}

/** The current user's primary email address, or null if not signed in. */
async function currentUserEmail(): Promise<string | null> {
  try {
    const user = await currentUser();
    if (!user) return null;
    const primary = user.emailAddresses.find(
      (e) => e.id === user.primaryEmailAddressId,
    );
    return (primary ?? user.emailAddresses[0])?.emailAddress ?? null;
  } catch {
    // currentUser() throws on requests that aren't covered by clerkMiddleware
    // (e.g. asset routes like /sw.js that the proxy matcher excludes but which
    // still render the root layout). Treat those as "not allowed" rather than
    // crashing the whole layout.
    return null;
  }
}

/** Whether the signed-in user is allowed to see the Dashboard. */
export async function canViewDashboard(): Promise<boolean> {
  return isAllowedDashboardEmail(await currentUserEmail());
}

// Emails allowed to use the whole site. Everyone else is limited to the
// Contracts page. Configure as a comma-separated list in FULL_ACCESS_EMAILS.
const FULL_ACCESS_EMAILS = (process.env.FULL_ACCESS_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * Whether the signed-in user may access every tab (not just Contracts). The
 * privileged group is the union of FULL_ACCESS_EMAILS and the dashboard
 * allow-list — anyone in either list sees the full site.
 */
export async function hasFullAccess(): Promise<boolean> {
  const email = await currentUserEmail();
  if (!email) return false;
  const normalized = email.toLowerCase();
  return (
    FULL_ACCESS_EMAILS.includes(normalized) ||
    ALLOWED_EMAILS.includes(normalized)
  );
}

/**
 * Server-component guard for restricted pages: users without full access are
 * sent to the Contracts page, the only one they're allowed to use.
 */
export async function requireFullAccess(): Promise<void> {
  if (!(await hasFullAccess())) redirect("/contracts");
}

// Emails allowed to use the "Mr. Fahmy" mode inside the Contracts page. This is
// a STANDALONE allow-list — being here grants ONLY the Fahmy mode, never full
// access or any other page. Two are built in; extra ones can be added via the
// FAHMY_EMAILS env var (comma-separated).
const FAHMY_EMAILS = [
  "wasaserr@gmail.com",
  "ahmdfhmy2023@gmail.com",
  ...(process.env.FAHMY_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
];

export function isFahmyEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return FAHMY_EMAILS.includes(email.toLowerCase());
}

/**
 * Whether the signed-in user may use the "Mr. Fahmy" sales-analysis mode. This
 * is deliberately separate from {@link hasFullAccess}: a Fahmy-only user still
 * sees just the Contracts page and gets no other privileges.
 */
export async function canUseFahmy(): Promise<boolean> {
  return isFahmyEmail(await currentUserEmail());
}

// Super-admin emails allowed to run destructive, cross-user maintenance (e.g.
// wiping every other user's orders to hand the system to new users). Configure
// as a comma-separated list in ADMIN_EMAILS. Keep this list tiny.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

/** Whether the signed-in user is a super-admin. */
export async function currentUserIsAdmin(): Promise<boolean> {
  return isAdminEmail(await currentUserEmail());
}
