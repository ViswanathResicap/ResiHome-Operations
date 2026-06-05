import { getSummary } from "@/lib/summary";

// Hit hourly by Vercel Cron (see vercel.json). Calling getSummary() refreshes
// the Data Cache when the 1h entry is stale; spammed calls just return the
// cached value, so no auth/secret is required to stay safe.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const data = await getSummary();
  return Response.json({
    ok: true,
    source: data._meta.source,
    generatedAt: data._meta.generatedAt,
    properties: data.properties?.length ?? 0,
    totalProperties: data.kpis.totalProperties,
  });
}
