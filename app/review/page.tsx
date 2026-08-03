import { ReviewClient } from "./review-client";
import { requireFullAccess } from "@/lib/access";

export default async function Page() {
  await requireFullAccess();
  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-5 p-6">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-bold tracking-tight">Review</h1>
        <p className="text-sm text-muted-foreground">
          Upload an Excel or CSV file to view it instantly, with Excel-style
          column filters, sorting, and search. Edit cells, mark rows complete,
          and save sheets to this PC to reopen and compare later.
        </p>
      </div>
      <ReviewClient />
    </main>
  );
}
