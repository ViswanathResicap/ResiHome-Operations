import type { SummaryCache } from "./types";
import { getSummaryCache } from "./cache";
import { hasSnowflakeEnv } from "./snowflake";

// In-memory cache for the live dataset. Unlike Next's Data Cache it has no
// ~2MB ceiling, so the full per-property payload (which powers the breakdowns
// and slicers) caches reliably and serves instantly while warm. The hourly
// Vercel cron keeps an instance warm; on error we keep serving the last good
// data rather than dropping to the sample.
let memo: { at: number; data: SummaryCache } | null = null;
let pending: Promise<SummaryCache> | null = null;
const TTL = 60 * 60 * 1000; // 1h

function refresh(): Promise<SummaryCache> {
  if (!pending) {
    pending = (async () => {
      const { getLiveSummary } = await import("./live-summary");
      const data = await getLiveSummary();
      memo = { at: Date.now(), data };
      return data;
    })().finally(() => { pending = null; });
  }
  return pending;
}

/**
 * Returns the Summary dataset.
 * - `force` (Refresh button / cron): await a fresh Snowflake compute.
 * - warm: return the cached data instantly (revalidating in the background if stale).
 * - cold: return the committed sample immediately and warm in the background, so
 *   the page never blocks on a full query at render time.
 * Any live failure keeps the last good data (or the sample), never throws.
 */
export async function getSummary(force = false): Promise<SummaryCache> {
  if (!hasSnowflakeEnv()) return getSummaryCache();
  if (force) {
    try { return await refresh(); }
    catch (e) { console.error("[summary] live refresh failed:", (e as Error).message); return memo?.data ?? getSummaryCache(); }
  }
  if (memo) {
    if (Date.now() - memo.at > TTL) refresh().catch(() => {}); // stale-while-revalidate
    return memo.data;
  }
  refresh().catch((e) => console.error("[summary] warm failed:", (e as Error).message));
  return getSummaryCache();
}
