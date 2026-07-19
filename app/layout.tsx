import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/theme";
import { NotchNav } from "@/components/ui/notch-nav";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { canViewDashboard, hasFullAccess } from "@/lib/access";

type NavIcon = "home" | "dashboard" | "orders" | "review" | "contracts";
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
  // Users without full access only ever see the Review tab; among full-access
  // users, the Dashboard link additionally requires the dashboard allow-list.
  const fullAccess = await hasFullAccess();
  const showDashboard = fullAccess && (await canViewDashboard());
  const navItems: NavItem[] = fullAccess
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
        { value: "review", label: "Review", href: "/review", icon: "review" },
        { value: "contracts", label: "Contracts", href: "/contracts", icon: "contracts" },
      ]
    : [{ value: "review", label: "Review", href: "/review", icon: "review" }];

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
        <ClerkProvider>
          <ThemeProvider>
            <header className="sticky top-0 z-50 border-b border-border bg-card/90 backdrop-blur">
              <div className="mx-auto w-full max-w-7xl">
                <NotchNav
                  items={navItems}
                  defaultValue={fullAccess ? "home" : "review"}
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
