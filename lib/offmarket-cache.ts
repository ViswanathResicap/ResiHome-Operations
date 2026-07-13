import offmarket from "@/data/snapshots/offmarket.json";
import type { OffMarketCache } from "./types";

/** Precomputed Off-Market snapshot (refreshed daily by scripts/precompute.ts),
 *  bundled at build time so the page shows real data instantly — even when a
 *  live Snowflake connection isn't available at request time. */
export function getOffMarketCache(): OffMarketCache {
  return offmarket as unknown as OffMarketCache;
}
