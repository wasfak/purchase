import { Suspense } from "react";

import { requireFullAccess } from "@/lib/access";
import { RunClient } from "@/components/auto-tasfya/run-client";

export default async function Page() {
  await requireFullAccess();
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      }
    >
      <RunClient />
    </Suspense>
  );
}
