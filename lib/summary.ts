import type { SummaryCache } from "./types";
import { getSummaryCache } from "./cache";
import { hasSnowflakeEnv } from "./snowflake";

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

export async function getSummary(force = false): Promise<SummaryCache> {
  if (!hasSnowflakeEnv()) return getSummaryCache();
  if (force) {
    try { return await refresh(); }
    catch (e) { console.error("[summary] live refresh failed:", (e as Error).message); return memo?.data ?? getSummaryCache(); }
  }
  if (memo) {
    if (Date.now() - memo.at > TTL) refresh().catch(() => {});
    return memo.data;
  }
  refresh().catch((e) => console.error("[summary] warm failed:", (e as Error).message));
  return getSummaryCache();
}
