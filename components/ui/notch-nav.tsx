"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";
import {
  Home,
  Menu,
  X,
  CalendarDays,
  LayoutDashboard,
  ShoppingCart,
  Star,
  FileText,
} from "lucide-react";

import type { LucideIcon } from "lucide-react";
import { Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs'
import { ThemeToggle } from "@/components/theme"
import { AuthActionButton, BrandLogo } from "@/components/ui/amazing-button-component"

type IconName =
  | "home"
  | "calendar"
  | "dashboard"
  | "orders"
  | "review"
  | "contracts";

type Item = {
  value: string;
  label: string;
  href?: string;
  icon?: IconName;
};

type NotchNavProps = {
  items: Item[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  ariaLabel?: string;
  className?: string;
};

export function NotchNav({
  items,
  value,
  defaultValue,
  onValueChange,
  ariaLabel = "Primary",
  className,
}: NotchNavProps) {
  const pathname = usePathname();
  const isControlled = value !== undefined;

  const [internalActive, setInternalActive] = React.useState<string>(
    defaultValue ?? items[0]?.value ?? "",
  );
  const active = isControlled ? (value as string) : internalActive;

  const [ready, setReady] = React.useState(false);
  const [reducedMotion, setReducedMotion] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef<
    Array<HTMLAnchorElement | HTMLButtonElement | null>
  >([]);
  const [notchRect, setNotchRect] = React.useState<{
    left: number;
    width: number;
  } | null>(null);

  const activeIndex = React.useMemo(
    () =>
      Math.max(
        0,
        items.findIndex((i) => i.value === active),
      ),
    [items, active],
  );

  const iconMap: Record<IconName, LucideIcon> = {
    home: Home,
    calendar: CalendarDays,
    dashboard: LayoutDashboard,
    orders: ShoppingCart,
    review: Star,
    contracts: FileText,
  };

  const updateNotch = React.useCallback(() => {
    const c = containerRef.current;
    const el = itemRefs.current[activeIndex];
    if (!c || !el) return;
    const cRect = c.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const left = eRect.left - cRect.left;
    const width = eRect.width;
    setNotchRect({ left, width });
    setReady(true);
  }, [activeIndex]);

  React.useEffect(() => {
    if (!isControlled && pathname) {
      const activeItem = items.find(
        (item) =>
          item.href === pathname ||
          (item.href && pathname.startsWith(item.href + "/")),
      );
      if (activeItem?.value) {
        React.startTransition(() => setInternalActive(activeItem.value));
      }
    }
  }, [pathname, items, isControlled]);

  React.useLayoutEffect(() => {
    updateNotch();
    const onResize = () => updateNotch();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateNotch]);

  React.useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  const focusItem = (index: number) => {
    const el = itemRefs.current[Math.max(0, Math.min(items.length - 1, index))];
    el?.focus();
  };

  const commitChange = (next: string) => {
    if (!isControlled) setInternalActive(next);
    onValueChange?.(next);
    setMobileOpen(false);
  };

  React.useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(mql.matches);
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  const authButtons = (
    <>
      <Show when="signed-out">
        <SignInButton>
          <AuthActionButton label="Sign In" className="h-8 px-3" />
        </SignInButton>
        <SignUpButton>
          <AuthActionButton label="Sign Up" className="h-8 px-3" />
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </>
  );

  return (
    <header className="relative flex w-full items-center justify-between gap-3 px-3 py-3 sm:px-4 sm:py-4 min-h-14 sm:min-h-16">
      {/* Brand */}
      <Link href="/" className="shrink-0">
        <BrandLogo />
      </Link>

      {/* Desktop nav — hidden on mobile */}
      <nav
        aria-label={ariaLabel}
        className={["hidden md:block shrink-0", className].filter(Boolean).join(" ")}
      >
        <div
          ref={containerRef}
          className="relative rounded-lg border border-border bg-secondary text-foreground"
        >
          <ul
            role="menubar"
            className="flex items-center justify-center gap-1 p-1"
            onKeyDown={(e) => {
              const key = e.key;
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key))
                return;
              e.preventDefault();
              if (key === "ArrowRight") focusItem(activeIndex + 1);
              if (key === "ArrowLeft") focusItem(activeIndex - 1);
              if (key === "Home") focusItem(0);
              if (key === "End") focusItem(items.length - 1);
            }}
          >
            {items.map((item, idx) => {
              const isActive = item.value === active;
              const Icon = item.icon ? iconMap[item.icon] : undefined;
              const content = (
                <>
                  {Icon && <Icon className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                  <span className="text-pretty">{item.label}</span>
                </>
              );

              return (
                <li key={item.value} role="none">
                  {item.href ? (
                    <Link
                      ref={(el) => {
                        itemRefs.current[idx] = el;
                      }}
                      href={item.href}
                      prefetch={false}
                      role="menuitem"
                      aria-label={item.label}
                      aria-current={isActive ? "page" : undefined}
                      tabIndex={isActive ? 0 : -1}
                      onClick={() => commitChange(item.value)}
                      className={[
                        "relative inline-flex items-center rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-ring",
                        isActive
                          ? "text-primary"
                          : "text-foreground/70 hover:text-foreground",
                      ].join(" ")}
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      ref={(el) => {
                        itemRefs.current[idx] = el;
                      }}
                      role="menuitem"
                      aria-label={item.label}
                      aria-current={isActive ? "page" : undefined}
                      aria-pressed={isActive || undefined}
                      tabIndex={isActive ? 0 : -1}
                      onClick={() => commitChange(item.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          commitChange(item.value);
                        }
                      }}
                      className={[
                        "relative rounded-md px-3 py-2 text-sm font-medium outline-none transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-ring",
                        isActive
                          ? "text-primary"
                          : "text-foreground/70 hover:text-foreground",
                      ].join(" ")}
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {notchRect && (
            <div
              aria-hidden="true"
              className={[
                "pointer-events-none absolute",
                "overflow-hidden rounded-sm",
                "transition-all",
                reducedMotion ? "duration-0" : "duration-300",
                "ease-[cubic-bezier(0.22,1,0.36,1)]",
                ready ? "opacity-100" : "opacity-0",
              ].join(" ")}
              style={{
                transform: `translate3d(${notchRect.left}px, 0, 0)`,
                width: notchRect.width,
                bottom: -4,
                height: 10,
                willChange: "transform, width, opacity",
              }}
            >
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 100 20"
                preserveAspectRatio="none"
                className="block text-primary"
              >
                <path
                  d="
                    M 2 1
                    H 98
                    Q 99 1 99 2
                    V 10
                    H 88
                    Q 87.2 10 86.6 11.4
                    L 84.8 18
                    H 15.2
                    L 13.4 11.4
                    Q 12.8 10 12 10
                    H 2
                    Q 1 10 1 9
                    V 2
                    Q 1 1 2 1
                    Z
                  "
                  fill="currentColor"
                />
              </svg>
            </div>
          )}
        </div>
      </nav>

      {/* Desktop right side — hidden on mobile */}
      <div className="hidden md:flex items-center gap-3">
        <ThemeToggle />
        {authButtons}
      </div>

      {/* Mobile right side — visible only on mobile */}
      <div className="flex md:hidden items-center gap-2">
        <ThemeToggle />
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          className="inline-flex items-center justify-center rounded-md p-1.5 text-foreground/70 hover:text-foreground hover:bg-muted transition-colors focus-visible:ring-2 focus-visible:ring-ring outline-none"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 top-14 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative border-b border-border bg-card shadow-lg">
            <nav aria-label={ariaLabel} className="flex flex-col gap-1 p-4">
              {items.map((item) => {
                const isActive = item.value === active;
                const Icon = item.icon ? iconMap[item.icon] : undefined;
                return item.href ? (
                  <Link
                    key={item.value}
                    href={item.href}
                    prefetch={false}
                    onClick={() => commitChange(item.value)}
                    className={[
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-secondary text-primary"
                        : "text-foreground/70 hover:bg-muted hover:text-foreground",
                    ].join(" ")}
                  >
                    {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
                    {item.label}
                  </Link>
                ) : (
                  <button
                    key={item.value}
                    onClick={() => commitChange(item.value)}
                    className={[
                      "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors text-left",
                      isActive
                        ? "bg-secondary text-primary"
                        : "text-foreground/70 hover:bg-muted hover:text-foreground",
                    ].join(" ")}
                  >
                    {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
                    {item.label}
                  </button>
                );
              })}
            </nav>
            <div className="flex items-center gap-3 border-t border-border p-4">
              {authButtons}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
