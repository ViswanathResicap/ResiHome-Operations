import summary from "@/data/cache/summary.json";
import type { SummaryCache } from "./types";

/**
 * Returns the cached Summary dataset. The JSON is imported statically so it is
 * bundled into the deployment (robust on Vercel/serverless — no runtime fs).
 * The cache is refreshed out-of-band by scripts/refresh-cache.mjs and picked up
 * on the next build/deploy (push-to-deploy), mirroring Power BI's scheduled refresh.
 */
export function getSummaryCache(): SummaryCache {
  return summary as unknown as SummaryCache;
}
