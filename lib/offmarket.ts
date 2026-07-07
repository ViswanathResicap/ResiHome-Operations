import type { OffMarketCache } from "./types";
import { getOffMarketCache } from "./offmarket-cache";
import { hasSnowflakeEnv } from "./snowflake";

let memo: { at: number; data: OffMarketCache } | null = null;
let pending: Promise<OffMarketCache> | null = null;
const TTL = 60 * 60 * 1000; // 1h

function refresh(): Promise<OffMarketCache> {
  if (!pending) {
    pending = (async () => {
      const { getLiveOffMarket } = await import("./live-offmarket");
      const data = await getLiveOffMarket();
      memo = { at: Date.now(), data };
      return data;
    })().finally(() => { pending = null; });
  }
  return pending;
}

/**
 * Returns the Off-Market dataset. Same contract as getSummary(): force = await
 * a fresh Snowflake compute; warm = instant cached return (revalidating in the
 * background if stale); cold = the committed sample, warming in the background.
 */
export async function getOffMarket(force = false): Promise<OffMarketCache> {
  if (!hasSnowflakeEnv()) return getOffMarketCache();
  if (force) {
    try { return await refresh(); }
    catch (e) { console.error("[offmarket] live refresh failed:", (e as Error).message); return memo?.data ?? getOffMarketCache(); }
  }
  if (memo) {
    if (Date.now() - memo.at > TTL) refresh().catch(() => {});
    return memo.data;
  }
  refresh().catch((e) => console.error("[offmarket] warm failed:", (e as Error).message));
  return getOffMarketCache();
}
