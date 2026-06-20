import { currentUser } from "@clerk/nextjs/server";

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
