import type { SummaryCache } from "./types";
import { getSummaryCache } from "./cache";
import { hasSnowflakeEnv } from "./snowflake";
import { unstable_cache } from "next/cache";

// Heavy Snowflake native queries run at most once per hour (cached across
// requests) and NEVER during `next build` (the page is dynamically rendered).
const cachedLive = unstable_cache(
  async (): Promise<SummaryCache> => {
    const { getLiveSummary } = await import("./live-summary");
    return getLiveSummary();
  },
  ["summary-live-v2"],
  { revalidate: 3600, tags: ["summary"] }
);

/**
 * Returns the Summary dataset: live from Snowflake (hourly-cached) when creds
 * are present, otherwise the committed SAMPLE. Any live failure degrades to
 * sample so the page always renders.
 */
export async function getSummary(): Promise<SummaryCache> {
  if (!hasSnowflakeEnv()) return getSummaryCache();
  try {
    return await cachedLive();
  } catch (e) {
    console.error("[summary] live query failed; serving sample:", (e as Error).message);
    return getSummaryCache();
  }
}
