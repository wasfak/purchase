"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";
import { THEME_STORAGE_KEY } from "@/lib/theme-init";

// A tiny theme layer replacing next-themes. It renders NO inline <script> — the
// no-flash theme is applied before paint by a server-rendered script in the root
// layout (THEME_INIT_SCRIPT in lib/theme-init). next-themes renders that script
// from a client component, which React 19 warns about ("Encountered a script tag
// while rendering React component"); doing it from the server layout avoids that.
//
// The chosen theme lives in localStorage and is read via useSyncExternalStore —
// SSR-safe (getServerSnapshot) and without any setState-in-effect.

export type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const MEDIA = "(prefers-color-scheme: dark)";

// Subscribers to re-read the store after an in-tab setTheme (the `storage`
// event only fires in *other* tabs, so same-tab changes are pushed manually).
const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) cb();
  };
  const mq = window.matchMedia(MEDIA);
  const onMedia = () => cb();
  window.addEventListener("storage", onStorage);
  mq.addEventListener("change", onMedia);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
    mq.removeEventListener("change", onMedia);
  };
}

function readStored(): Theme {
  try {
    return (localStorage.getItem(THEME_STORAGE_KEY) as Theme) || "system";
  } catch {
    return "system";
  }
}

// Server (and first hydration) render: default to "system" so markup matches.
function getServerSnapshot(): Theme {
  return "system";
}

function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" && window.matchMedia(MEDIA).matches
    ? "dark"
    : "light";
}

function applyTheme(resolved: ResolvedTheme) {
  const el = document.documentElement;
  el.classList.toggle("dark", resolved === "dark");
  el.style.colorScheme = resolved;
}

/** Kept as a passthrough so the root layout's <ThemeProvider> wrapper is
 *  unchanged; the theme store is module-global, so no context is required. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useTheme(): {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
} {
  const theme = React.useSyncExternalStore(
    subscribe,
    readStored,
    getServerSnapshot,
  );
  const resolvedTheme: ResolvedTheme =
    theme === "system" ? systemTheme() : theme;

  const setTheme = React.useCallback((next: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // localStorage unavailable — still apply for this session.
    }
    applyTheme(next === "system" ? systemTheme() : next);
    notify();
  }, []);

  return { theme, resolvedTheme, setTheme };
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="outline"
      size="icon"
      className="size-7 sm:size-8"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="h-3.5 w-3.5 sm:h-4 sm:w-4 dark:hidden" />
      <Moon className="hidden h-3.5 w-3.5 sm:h-4 sm:w-4 dark:block" />
    </Button>
  );
}
