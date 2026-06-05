import fs from "node:fs";
import path from "node:path";
import type { SummaryCache } from "./types";

const CACHE_PATH = path.join(process.cwd(), "data", "cache", "summary.json");

/**
 * Reads the cached Summary dataset. The app serves cached query results
 * (mirroring Power BI's scheduled refresh): pages never hit Snowflake directly.
 * The cache is refreshed out-of-band by scripts/refresh-cache.mjs.
 */
export function getSummaryCache(): SummaryCache {
  const raw = fs.readFileSync(CACHE_PATH, "utf-8");
  return JSON.parse(raw) as SummaryCache;
}
