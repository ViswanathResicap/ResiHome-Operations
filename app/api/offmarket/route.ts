import { getOffMarket } from "@/lib/offmarket";

// Serves the live off-market dataset from the in-memory cache (warm = instant).
// With ?fresh=1 it forces a fresh Snowflake compute (the on-screen Refresh button).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.has("fresh");
  const data = await getOffMarket(fresh);
  return Response.json(data, { headers: { "cache-control": "no-store" } });
}
