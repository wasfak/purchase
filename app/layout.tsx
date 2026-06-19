import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ThemeProvider, ThemeToggle } from "@/components/theme";
import { NotchNav } from "@/components/ui/notch-nav";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";

type NavIcon = "home";

const navItems: Array<{ value: string; label: string; href: string; icon: NavIcon }> = [
  { value: "home", label: "Notes", href: "/", icon: "home" },
  { value: "dashboard", label: "Dashboard", href: "/dashboard", icon: "home" },
  { value: "orders", label: "Orders", href: "/orders", icon: "home" },
];

export const metadata: Metadata = {
  title: "nex-bb",
  description: "",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
