import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/theme";
import { THEME_INIT_SCRIPT } from "@/lib/theme-init";
import { NotchNav } from "@/components/ui/notch-nav";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import {
  canViewDashboard,
  hasFullAccess,
  isOrdersReviewOnly,
} from "@/lib/access";

type NavIcon =
  | "home"
  | "dashboard"
  | "orders"
  | "review"
  | "contracts"
  | "inspire"
  | "expiry"
  | "autotasfya"
  | "zerocodes"
  | "taqfeelat"
  | "ordersreview"
  | "alama"
  | "analytics"
  | "winter"
  | "fahmy";
type NavItem = { value: string; label: string; href: string; icon: NavIcon };

export const metadata: Metadata = {
  title: "Purchase Optimizer",
  description: "Optimize your purchase decisions with data-driven insights.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Users without full access only see the Contracts and Winter tabs; among
  // full-access users, the Dashboard link additionally requires the dashboard
  // allow-list.
  const fullAccess = await hasFullAccess();
  const showDashboard = fullAccess && (await canViewDashboard());
  const ordersReviewOnly = !fullAccess && (await isOrdersReviewOnly());
  const navItems: NavItem[] = ordersReviewOnly
    ? [
        {
          value: "orders-review",
          label: "مراجعة اوردرات",
          href: "/orders-review",
          icon: "ordersreview",
        },
      ]
    : fullAccess
    ? [
        { value: "home", label: "Notes", href: "/", icon: "home" },
        ...(showDashboard
          ? [
              {
                value: "dashboard",
                label: "Dashboard",
                href: "/dashboard",
                icon: "dashboard",
              } as NavItem,
            ]
          : []),
        { value: "orders", label: "Orders", href: "/orders", icon: "orders" },
        {
          value: "taqfeelat",
          label: "تقفيلات",
          href: "/taqfeelat",
          icon: "taqfeelat",
        },
        {
          value: "orders-review",
          label: "مراجعة اوردرات",
          href: "/orders-review",
          icon: "ordersreview",
        },
        { value: "review", label: "Review", href: "/review", icon: "review" },
        { value: "contracts", label: "Contracts", href: "/contracts", icon: "contracts" },
        { value: "inspire", label: "Inspire", href: "/inspire", icon: "inspire" },
        { value: "expiry", label: "Expiry", href: "/expiry", icon: "expiry" },
        {
          value: "auto-tasfya",
          label: "Auto Tasfya",
          href: "/auto-tasfya",
          icon: "autotasfya",
        },
        {
          value: "alama",
          label: "علامة",
          href: "/alama",
          icon: "alama",
        },
        {
          value: "zero-codes",
          label: "0 codes",
          href: "/zero-codes",
          icon: "zerocodes",
        },
        {
          value: "analytics",
          label: "Analytics",
          href: "/analytics",
          icon: "analytics",
        },
        { value: "winter", label: "Winter", href: "/winter", icon: "winter" },
      ]
    : [
        {
          value: "contracts",
          label: "Contracts",
          href: "/contracts",
          icon: "contracts",
        },
        { value: "winter", label: "Winter", href: "/winter", icon: "winter" },
      ];

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body
        suppressHydrationWarning
        className="min-h-full flex flex-col bg-background text-foreground"
      >
        {/* No-flash theme: applied before paint. Server-rendered (not a client
            component), so React 19 doesn't warn about the inline script. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <ClerkProvider>
          <ThemeProvider>
            <header className="sticky top-0 z-50 border-b border-border bg-card/90 backdrop-blur">
              <div className="mx-auto w-full max-w-[96rem]">
                <NotchNav
                  items={navItems}
                  defaultValue={
                    fullAccess
                      ? "home"
                      : ordersReviewOnly
                        ? "orders-review"
                        : "contracts"
                  }
                  ariaLabel="Primary navigation"
                />
              </div>
            </header>
            <main className="flex-1 overflow-x-auto">
              {children}
              <Toaster position="top-right" />
            </main>
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
