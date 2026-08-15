import { ReviewAyaClient } from "./review-aya-client";
import { requireFullAccess } from "@/lib/access";

export default async function Page() {
  await requireFullAccess();
  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-5 p-6">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Review Aya</h1>
        <p className="text-sm text-muted-foreground">
          A separate, shared review workspace — its saved sheets and history live
          on the server, so a sheet uploaded on one device shows up for everyone
          on any device. Nothing here overlaps with the main Review tab. Upload
          an Excel or CSV file to view it instantly, with Excel-style column
          filters, sorting, and search. Edit cells, mark rows complete, and save
          sheets to reopen and compare later.
        </p>
      </div>
      <ReviewAyaClient />
    </main>
  );
}
