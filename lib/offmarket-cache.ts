import offmarket from "@/data/cache/offmarket.json";
import type { OffMarketCache } from "./types";

/** Static fallback snapshot, bundled at build time (mirrors getSummaryCache). */
export function getOffMarketCache(): OffMarketCache {
  return offmarket as unknown as OffMarketCache;
}
