import { getSummary } from "@/lib/summary";

// Serves the live summary from the in-memory cache (warm = instant). With
// ?fresh=1 it forces a fresh Snowflake compute (the on-screen Refresh button).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.has("fresh");
  const data = await getSummary(fresh);
  return Response.json(data, { headers: { "cache-control": "no-store" } });
}
