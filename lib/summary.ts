import type { SummaryCache } from "./types";
import { getSummaryCache } from "./cache";
import { hasSnowflakeEnv } from "./snowflake";

/**
 * Returns the Summary dataset: live from Snowflake when credentials are present
 * (refreshed hourly via the page's `revalidate`), otherwise the committed
 * SAMPLE. Any live failure degrades gracefully to the sample so the page always
 * renders.
 */
export async function getSummary(): Promise<SummaryCache> {
  if (!hasSnowflakeEnv()) return getSummaryCache();
  try {
    const { getLiveSummary } = await import("./live-summary");
    return await getLiveSummary();
  } catch (e) {
    console.error("[summary] live query failed; serving sample:", (e as Error).message);
    return getSummaryCache();
  }
}
