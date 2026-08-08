import { ZeroCodesClient } from "@/components/zero-codes/zero-codes-client";
import { requireFullAccess } from "@/lib/access";

export default async function Page() {
  await requireFullAccess();
  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 p-6">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">0 codes</h1>
        <p className="text-sm text-muted-foreground">
          Upload the daily AppSheet lists (AppSheet.ViewData.YYYY-MM-DD.csv). Each
          day is saved and searchable — type any code (or several) to see whether
          and when it was ordered. Add more files any time.
        </p>
      </div>
      <ZeroCodesClient />
    </main>
  );
}
