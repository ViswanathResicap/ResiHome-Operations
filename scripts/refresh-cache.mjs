#!/usr/bin/env node
/**
 * Refresh the Summary cache (data/cache/summary.json) from Snowflake.
 *
 * Architecture: pages serve cached results (mirrors Power BI scheduled refresh).
 * This job runs out-of-band (cron/hourly). It reuses the EXACT native-query SQL
 * preserved in the .pbip mirror, so the cached figures match the report.
 *
 * Requires env (not committed):
 *   SNOWFLAKE_ACCOUNT   e.g. ota12822.us-east-1
 *   SNOWFLAKE_USERNAME
 *   SNOWFLAKE_PASSWORD  (or SNOWFLAKE_PRIVATE_KEY_PATH)
 *   SNOWFLAKE_WAREHOUSE e.g. DEVELOPER_WH   (report uses DEVELOPER_WH / role UAT)
 *   SNOWFLAKE_ROLE      e.g. UAT
 * And: `npm i snowflake-sdk`
 *
 * Usage: npm run refresh
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TABLES = path.join(ROOT, "powerbi-source", "ResiHome Summary.SemanticModel", "definition", "tables");
const OUT = path.join(ROOT, "data", "cache", "summary.json");

/** Extract a table's Snowflake native-query SQL from its .tmdl (unescapes M string). */
export function nativeSql(tableName) {
  const tmdl = fs.readFileSync(path.join(TABLES, `${tableName}.tmdl`), "utf-8");
  const m = tmdl.match(/\[Data\],\s*"([\s\S]*?)",\s*null,\s*\[EnableFolding/);
  if (!m) throw new Error(`No native query found in ${tableName}.tmdl`);
  return m[1]
    .replace(/#\(lf\)/g, "\n")
    .replace(/#\(tab\)/g, "\t")
    .replace(/""/g, '"');
}

async function connect() {
  let sdk;
  try { sdk = (await import("snowflake-sdk")).default; }
  catch { throw new Error("snowflake-sdk not installed. Run: npm i snowflake-sdk"); }
  const cfg = {
    account: req("SNOWFLAKE_ACCOUNT"),
    username: req("SNOWFLAKE_USERNAME"),
    warehouse: process.env.SNOWFLAKE_WAREHOUSE || "DEVELOPER_WH",
    role: process.env.SNOWFLAKE_ROLE || "UAT",
    database: "PROD_ANALYTICS",
  };
  if (process.env.SNOWFLAKE_PASSWORD) cfg.password = process.env.SNOWFLAKE_PASSWORD;
  else if (process.env.SNOWFLAKE_PRIVATE_KEY_PATH) {
    cfg.authenticator = "SNOWFLAKE_JWT";
    cfg.privateKey = fs.readFileSync(process.env.SNOWFLAKE_PRIVATE_KEY_PATH, "utf-8");
  } else throw new Error("Set SNOWFLAKE_PASSWORD or SNOWFLAKE_PRIVATE_KEY_PATH");
  const conn = sdk.createConnection(cfg);
  await new Promise((res, rej) => conn.connect((e) => (e ? rej(e) : res())));
  return conn;
}
const req = (k) => { const v = process.env[k]; if (!v) throw new Error(`Missing env ${k}`); return v; };
const run = (conn, sqlText) =>
  new Promise((res, rej) =>
    conn.execute({ sqlText, complete: (e, _s, rows) => (e ? rej(e) : res(rows)) }));

// Page-level filters from the Summary page.json.
const PAGE_FILTER = `OCCUPANCY_STATUS <> 'Dispositions' AND ORGANIZATION_NAME IS NOT NULL`;

async function main() {
  const conn = await connect();
  const props = nativeSql("DW_Properties"); // exact MASTER PROPERTY dataset

  // Headline KPIs derived from DW_Properties (matches the card measures).
  const [kpi] = await run(conn, `
    WITH p AS ( SELECT * FROM ( ${props} ) )
    SELECT
      COUNT(DISTINCT PROPERTY_KEY)                                              AS TOTAL_PROPERTIES,
      DIV0( COUNT_IF(OCCUPANCY_STATUS_SUMMARYID IN (7,8)),
            COUNT_IF(OCCUPANCY_STATUS_SUMMARYID IS NOT NULL) )                  AS OCCUPANCY_PCT,
      COUNT(DISTINCT CASE WHEN OCCUPANCY_STATUS IN ('Tenant Leased','Trustee Leased')
                          THEN PROPERTY_KEY END)                                AS TOTAL_TENANTS,
      DIV0( SUM(CURRENT_RENT), NULLIF(SUM(UNDER_WRITTEN_RENT),0) ) - 1          AS RENT_VAR
    FROM p WHERE ${PAGE_FILTER}`);

  // Property Summary pivot source (Organization x status counts).
  const summary = await run(conn, `
    WITH p AS ( SELECT * FROM ( ${props} ) )
    SELECT ORGANIZATION_NAME AS ORG, REGION_NAME AS REGION,
           OCCUPANCY_STATUS_SUMMARY AS STATUS, COUNT(DISTINCT PROPERTY_KEY) AS CNT
    FROM p WHERE ${PAGE_FILTER}
    GROUP BY 1,2,3 ORDER BY 1,3`);

  // Merge into the existing cache; leave 0_Month/Listings-derived figures for the
  // next extension (gauges, monthly trend, active listings) — see TODO below.
  const prev = JSON.parse(fs.readFileSync(OUT, "utf-8"));
  const cache = {
    ...prev,
    _meta: { source: "SNOWFLAKE", generatedAt: new Date().toISOString() },
    kpis: {
      ...prev.kpis,
      totalProperties: Number(kpi.TOTAL_PROPERTIES),
      occupancyPct: Number(kpi.OCCUPANCY_PCT),
      totalTenants: Number(kpi.TOTAL_TENANTS),
      rentVar: Number(kpi.RENT_VAR),
    },
    propertySummary: summary.map((r) => ({
      organization: r.ORG, region: r.REGION, subdivision: "—",
      status: r.STATUS, count: Number(r.CNT),
    })),
  };
  fs.writeFileSync(OUT, JSON.stringify(cache, null, 2));
  console.log(`Wrote ${OUT} — ${cache.propertySummary.length} summary rows, ${cache.kpis.totalProperties} properties.`);

  // TODO (next extension): activeListings <- DW_Listings; gauges + monthlyTrend
  // <- 0_Month measures (EOM Collections / Renewal / Net Turn Cost / Internal
  // Maintenance, occ/turnover trend). Reuse nativeSql("DW_Listings"), etc., and
  // reproduce the 0_Month DAX as SQL over those datasets.
  conn.destroy(() => {});
}

main().catch((e) => { console.error(e); process.exit(1); });
