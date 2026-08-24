"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ReviewWorkspace } from "@/components/review/review-workspace";
import { serverReviewStore } from "@/lib/server-review-store";
import { migrateReviewToServer } from "@/lib/migrate-to-server";

export function ReviewClient() {
  // Gate the workspace until the one-time local→server migration has run, so we
  // never show an empty (server) list while local sheets are still being copied
  // up. The migration is non-destructive and only runs once per browser.
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const copied = await migrateReviewToServer();
        if (active && copied > 0) {
          toast.success(
            `Moved ${copied} saved sheet${copied === 1 ? "" : "s"} to the cloud — safe now if you change PC.`,
          );
        }
      } catch {
        // Migration failed (e.g. offline) — don't block the page. The local copy
        // is untouched and the migration will retry on the next load.
        if (active) {
          toast.warning(
            "Couldn't sync local review data to the cloud yet — will retry. Your local copy is safe.",
          );
        }
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Syncing your saved sheets…
      </div>
    );
  }

  return <ReviewWorkspace store={serverReviewStore} />;
}
