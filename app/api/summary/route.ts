import { revalidateTag } from "next/cache";
import { getSummary } from "@/lib/summary";

// Serves the live summary from the Data Cache (warm = ms). With ?fresh=1 the
// cache is busted and recomputed (used by the on-screen Refresh button).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const fresh = new URL(req.url).searchParams.has("fresh");
  if (fresh) revalidateTag("summary");
  const data = await getSummary();
  return Response.json(data, { headers: { "cache-control": "no-store" } });
}
