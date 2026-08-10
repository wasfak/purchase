import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { FlyingSheet } from "@/lib/models/FlyingSheet";

// GET /api/flying/search?q=<code or product name>
// Scans every flying worksheet the user owns and returns each row whose code or
// name matches the query, together with that sheet's distributor columns (so the
// client can render the full breakdown / الباقى). Newest month first.
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) return NextResponse.json({ results: [] });

  await connectDB();
  const docs = await FlyingSheet.find({ ownerId: userId }).lean();

  type Result = {
    month: string;
    company: string;
    supplier: string;
    referenceDate: string;
    orderNumber: string;
    columns: { id: string; name: string }[];
    row: {
      code: string;
      name: string;
      order: number;
      cells: Record<string, string>;
      note: string;
      remainingOverride: number | null;
    };
  };

  const results: Result[] = [];
  for (const doc of docs as unknown as Record<string, unknown>[]) {
    const columns = (
      (doc.columns as { id?: unknown; name?: unknown }[]) ?? []
    ).map((c) => ({ id: String(c?.id ?? ""), name: String(c?.name ?? "") }));
    for (const r of (doc.rows as Record<string, unknown>[]) ?? []) {
      const code = String(r?.code ?? "");
      const name = String(r?.name ?? "");
      if (
        !code.toLowerCase().includes(q) &&
        !name.toLowerCase().includes(q)
      ) {
        continue;
      }
      const ov = Number(r?.remainingOverride);
      results.push({
        month: String(doc.month ?? ""),
        company: String(doc.company ?? ""),
        supplier: String(doc.supplier ?? ""),
        referenceDate: String(doc.referenceDate ?? ""),
        orderNumber: String(doc.orderNumber ?? ""),
        columns,
        row: {
          code,
          name,
          order: Number(r?.order) || 0,
          cells: r?.cells && typeof r.cells === "object"
            ? (r.cells as Record<string, string>)
            : {},
          note: typeof r?.note === "string" ? r.note : "",
          remainingOverride:
            r?.remainingOverride == null || !Number.isFinite(ov) ? null : ov,
        },
      });
    }
  }

  results.sort(
    (a, b) =>
      b.month.localeCompare(a.month) ||
      a.company.localeCompare(b.company, "ar"),
  );

  return NextResponse.json({ results: results.slice(0, 200) });
}

export const runtime = "nodejs";
