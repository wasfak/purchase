import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { ZeroCodeUpload } from "@/lib/models/ZeroCodeUpload";

// POST /api/zero-codes/search
// Body: { codes: string[] }
// For each requested code, returns where it was ordered (marked "-0-") with the
// date + quantity, plus the days it merely appeared, across every saved file.
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const raw = Array.isArray(body?.codes) ? body.codes : [];
  const codes = Array.from(
    new Set(
      raw
        .map((c: unknown) => String(c ?? "").trim())
        .filter((c: string) => c.length > 0),
    ),
  ) as string[];

  if (codes.length === 0) {
    return NextResponse.json({ results: [] });
  }

  await connectDB();

  // Unwind every saved day's rows, keep only the requested codes, and collect
  // per code: the ordered days (date + qty) and the days it just appeared.
  const agg = await ZeroCodeUpload.aggregate([
    { $match: { ownerId: userId, "rows.code": { $in: codes } } },
    { $unwind: "$rows" },
    { $match: { "rows.code": { $in: codes } } },
    {
      $group: {
        _id: "$rows.code",
        name: { $last: "$rows.name" },
        // Every day this code appeared, with its Order quantity — regardless of
        // whether it was marked.
        hits: {
          $push: {
            date: "$date",
            order: "$rows.order",
            supplier: "$rows.supplier",
          },
        },
      },
    },
  ]);

  type Hit = { date: string; order: string; supplier: string };
  const byCode = new Map<string, { name: string; hits: Hit[] }>();
  for (const r of agg) {
    byCode.set(String(r._id), {
      name: r.name ?? "",
      hits: (r.hits ?? []).sort((a: Hit, b: Hit) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
      ),
    });
  }

  // Keep the caller's order and always return a row per requested code, so
  // "not found" codes are reported too.
  const results = codes.map((code) => {
    const hit = byCode.get(code);
    return {
      code,
      name: hit?.name ?? "",
      hits: hit?.hits ?? [],
      status: hit ? ("found" as const) : ("not_found" as const),
    };
  });

  return NextResponse.json({ results });
}

export const runtime = "nodejs";
