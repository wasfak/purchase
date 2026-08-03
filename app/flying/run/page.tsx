import { Suspense } from "react";

import { requireFullAccess } from "@/lib/access";
import { FlyingClient } from "@/components/flying/flying-client";

export default async function Page() {
  await requireFullAccess();
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      }
    >
      <FlyingClient />
    </Suspense>
  );
}
