import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider } from "@/components/theme";
import { NotchNav } from "@/components/ui/notch-nav";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { canViewDashboard } from "@/lib/access";

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
  // The Dashboard link only renders for allow-listed admin emails.
  const showDashboard = await canViewDashboard();
  const navItems: NavItem[] = [
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
        <ClerkProvider>
          <ThemeProvider>
            <header className="sticky top-0 z-50 border-b border-border bg-card/90 backdrop-blur">
              <div className="mx-auto w-full max-w-7xl">
                <NotchNav
                  items={navItems}
                  defaultValue="home"
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
