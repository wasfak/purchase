import { Suspense } from "react";

import { requireFullAccess } from "@/lib/access";
import { CompanyDetail } from "@/components/company/company-detail";

export default async function Page({
  params,
}: {
  params: Promise<{ company: string }>;
}) {
  await requireFullAccess();
  const { company } = await params;
  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      }
    >
      <CompanyDetail company={decodeURIComponent(company)} />
    </Suspense>
  );
}
