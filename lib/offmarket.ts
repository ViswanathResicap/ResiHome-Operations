import type { OffMarketCache } from "./types";
import { getOffMarketCache } from "./offmarket-cache";

/**
 * Off-Market is served from the committed Power BI export snapshot
 * (data/snapshots/offmarket.json). The live pipeline's "Off Market Status"
 * bucketing does not match the report (it over-collapses everything into
 * Pending RRQC and misses the Ready-to-List buckets), so we pin to the export
 * until the live classification is reconciled. `force` is accepted for API
 * compatibility but ignored.
 */
export async function getOffMarket(_force = false): Promise<OffMarketCache> {
  return getOffMarketCache();
}
