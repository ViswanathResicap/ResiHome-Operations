import { getSummary } from "@/lib/summary";

// Hit hourly by Vercel Cron (see vercel.json). Forces a fresh compute so the
// in-memory cache stays warm and the page renders live data without blocking.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const data = await getSummary(true);
  return Response.json({
    ok: true,
    source: data._meta.source,
    generatedAt: data._meta.generatedAt,
    properties: data.properties?.length ?? 0,
    totalProperties: data.kpis.totalProperties,
  });
}
