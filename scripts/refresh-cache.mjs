#!/usr/bin/env node
/**
 * Refresh data/cache/summary.json from Snowflake (scheduled, OFF the request path).
 *
 * The Summary page reads the committed JSON statically (instant load). This job
 * runs the heavy report-faithful native queries (from the .pbip mirror), in
 * parallel, and writes the compact result. Run hourly via GitHub Actions
 * (.github/workflows/refresh.yml) or locally with creds.
 *
 * Env: SNOWFLAKE_ACCOUNT, SNOWFLAKE_USERNAME, SNOWFLAKE_PASSWORD (or
 *      SNOWFLAKE_PRIVATE_KEY[_PATH]), SNOWFLAKE_WAREHOUSE, SNOWFLAKE_ROLE.
 * Run: npm i snowflake-sdk && npm run refresh
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TABLES = path.join(ROOT, "powerbi-source", "ResiHome Summary.SemanticModel", "definition", "tables");
const OUT = path.join(ROOT, "data", "cache", "summary.json");
const PAGE_FILTER = `OCCUPANCY_STATUS <> 'Dispositions' AND ORGANIZATION_NAME IS NOT NULL`;

const nativeSql = (t) => {
  const tmdl = fs.readFileSync(path.join(TABLES, `${t}.tmdl`), "utf-8");
  const m = tmdl.match(/\[Data\],\s*"([\s\S]*?)",\s*null,\s*\[EnableFolding/);
  if (!m) throw new Error(`No native query in ${t}.tmdl`);
  return m[1].replace(/#\(lf\)/g, "\n").replace(/#\(tab\)/g, "\t").replace(/""/g, '"');
};
const numOr = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
const req = (k) => { const v = process.env[k]; if (!v) throw new Error(`Missing env ${k}`); return v; };

async function connect() {
  const sdk = (await import("snowflake-sdk")).default;
  try { sdk.configure({ logLevel: "ERROR" }); } catch {}
  const cfg = {
    account: req("SNOWFLAKE_ACCOUNT"), username: req("SNOWFLAKE_USERNAME"),
    warehouse: process.env.SNOWFLAKE_WAREHOUSE || "DEVELOPER_WH",
    role: process.env.SNOWFLAKE_ROLE || "UAT", database: "PROD_ANALYTICS",
    application: "ResiHomeOperationsRefresh",
  };
  if (process.env.SNOWFLAKE_PASSWORD) cfg.password = process.env.SNOWFLAKE_PASSWORD;
  else {
    let pk = process.env.SNOWFLAKE_PRIVATE_KEY
      || (process.env.SNOWFLAKE_PRIVATE_KEY_PATH && fs.readFileSync(process.env.SNOWFLAKE_PRIVATE_KEY_PATH, "utf-8"));
    if (!pk) throw new Error("Set SNOWFLAKE_PASSWORD or SNOWFLAKE_PRIVATE_KEY[_PATH]");
    if (!pk.includes("BEGIN")) { try { pk = Buffer.from(pk, "base64").toString("utf-8"); } catch {} }
    cfg.authenticator = "SNOWFLAKE_JWT";
    cfg.privateKey = pk.replace(/\\n/g, "\n");
    if (process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE) cfg.privateKeyPass = process.env.SNOWFLAKE_PRIVATE_KEY_PASSPHRASE;
  }
  const conn = sdk.createConnection(cfg);
  await new Promise((res, rej) => conn.connect((e) => (e ? rej(e) : res())));
  const query = (sqlText) => new Promise((res, rej) =>
    conn.execute({ sqlText, complete: (e, _s, rows) => (e ? rej(e) : res(rows ?? [])) }));
  return { query, close: () => conn.destroy(() => {}) };
}

async function main() {
  const DWP = nativeSql("DW_Properties"), DWL = nativeSql("DW_Listings"),
        BOM = nativeSql("PM_BOM"), WO = nativeSql("DW_WO");
  const conn = await connect();
  const kpis = { totalProperties: null, occupancyPct: null, activeListings: null,
    totalTenants: null, rentVar: null, holdingFees: null, projActualMis: null,
    netOccupancyGain: null, turnoverPct: null };
  let propertySummary = [], monthlyTrend = [], properties = [], podCount = null, imValue = null, internalMaintenance = null;
  const log = (n, e) => console.error(`[refresh] ${n} failed:`, e.message);
  const str = (v) => (v == null ? "" : String(v));
  const LEASED = new Set(["Tenant Leased", "Trustee Leased"]);

  // One faithful scan of DW_Properties -> per-property rows (drives every property tile + all slicers).
  const tProps = (async () => { try {
    const rows = await conn.query(`SELECT * FROM (\n${DWP}\n) WHERE ${PAGE_FILTER}`);
    const seen = new Set();
    for (const r of rows) {
      const key = r.PROPERTY_KEY;
      if (key != null && seen.has(key)) continue;
      if (key != null) seen.add(key);
      properties.push({
        org: str(r.ORGANIZATION_NAME), region: str(r.REGION_NAME), subdivision: str(r.SUBDIVISION),
        pm: str(r.PROPERTY_MANAGER), apm: str(r.PROPERTY_MANAGER_ASSISTANT), pod: str(r.POD),
        status: str(r.OCCUPANCY_STATUS_SUMMARY), summaryId: numOr(r.OCCUPANCY_STATUS_SUMMARYID),
        delinquent: str(r["1_Tenant Balance Status"]), address: str(r.FULL_ADDRESS),
        rent: numOr(r.CURRENT_RENT), uw: numOr(r.UNDER_WRITTEN_RENT),
      });
    }
  } catch (e) { log("property rows", e); } })();

  const tListings = (async () => { try {
    const [r] = await conn.query(`WITH l AS ( SELECT * FROM (\n${DWL}\n) )
      SELECT COUNT(DISTINCT PROPERTY_KEY) AS ACTIVE_LISTINGS FROM l WHERE LISTING_STATUS='Active' AND IS_PUBLISHED='Y'`);
    kpis.activeListings = numOr(r?.ACTIVE_LISTINGS);
  } catch (e) { log("active listings", e); } })();

  const tTrend = (async () => { try {
    const rows = await conn.query(`WITH b AS ( SELECT * FROM (\n${BOM}\n) )
      SELECT TO_CHAR(BEG_OF_MONTH,'Mon YYYY') AS MONTH, MIN(BEG_OF_MONTH) AS BOM,
        COUNT(IFF(OCCUPANCY_STATUS IS NOT NULL,HBPM_PROPERTYID,NULL)) AS HOMES, AVG(CURRENT_RENT) AS AVG_RENT
      FROM b WHERE BEG_OF_MONTH >= DATEADD('month',-3,DATE_TRUNC('month',CURRENT_DATE()))
      GROUP BY TO_CHAR(BEG_OF_MONTH,'Mon YYYY') ORDER BY BOM`);
    monthlyTrend = rows.map((r) => ({ month: String(r.MONTH), homes: numOr(r.HOMES), avgRent: numOr(r.AVG_RENT),
      occBom: null, occEom: null, collections: null, renewal: null, turnover: null, netTurnCost: null }));
  } catch (e) { log("monthly trend", e); } })();

  const tIM = (async () => { try {
    const [r] = await conn.query(`WITH w AS ( SELECT * FROM (\n${WO}\n) )
      SELECT SUM(CLIENT_INVOICE_AMOUNT) AS IM FROM w
      WHERE WORKORDER_STATUS='Closed' AND IS_INTERNAL_VENDOR='Y'
        AND DATE_TRUNC('month',WO_CLOSED_DATE) >= DATEADD('month',-3,DATE_TRUNC('month',CURRENT_DATE()))
        AND DATE_TRUNC('month',WO_CLOSED_DATE) <= DATE_TRUNC('month',CURRENT_DATE())
        AND COMPANY_NAME NOT IN ('Credit Card Vendor','GE Vendor (Maintenance)','New Builder Warranty Vendor','Lennar Builder Warranty')`);
    imValue = numOr(r?.IM);
  } catch (e) { log("internal maintenance", e); } })();

  await Promise.allSettled([tProps, tListings, tTrend, tIM]);
  conn.close();

  // Aggregate the property tiles from the per-property rows.
  if (properties.length) {
    kpis.totalProperties = properties.length;
    const leased = properties.filter((p) => LEASED.has(p.status)).length;
    kpis.totalTenants = leased;
    // 0_Current_Occupancy = leased (summaryId 7,8) / all properties.
    kpis.occupancyPct = kpis.totalProperties ? leased / kpis.totalProperties : null;
    const rs = properties.filter((p) => p.rent != null && p.uw != null);
    const sr = rs.reduce((s, p) => s + p.rent, 0), su = rs.reduce((s, p) => s + p.uw, 0);
    kpis.rentVar = su ? sr / su - 1 : null;
    podCount = new Set(properties.map((p) => p.pod).filter(Boolean)).size || null;
    const g = new Map();
    for (const p of properties) {
      const key = `${p.org}|${p.status}`;
      const cur = g.get(key) ?? { organization: p.org, region: "—", subdivision: "—", status: p.status, count: 0 };
      cur.count++; g.set(key, cur);
    }
    propertySummary = Array.from(g.values()).filter((r) => r.status);
  }

  const goal = podCount != null ? podCount * 2 * 2000 * 4 : null;
  if (imValue != null && goal) internalMaintenance = { value: imValue, target: goal, min: 0, max: goal, format: "currency", label: "Internal Maintenance" };

  const cache = {
    _meta: { source: "SNOWFLAKE", generatedAt: new Date().toISOString(),
      note: "Live (refreshed hourly): property KPIs, Property Summary, Active Listings, monthly Homes/Avg Rent, Internal Maintenance. Remaining gauges & trend columns are being wired + validated." },
    filters: { occupancyStatusExcludes: ["Dispositions"], organizationNameExcludes: [null] },
    kpis, gauges: { eomCollections: null, renewal: null, netTurnCost: null, internalMaintenance },
    propertySummary, monthlyTrend, properties,
  };
  fs.writeFileSync(OUT, JSON.stringify(cache));
  console.log(`Wrote ${OUT}: ${kpis.totalProperties} properties, ${propertySummary.length} summary rows, ${properties.length} property rows, ${monthlyTrend.length} trend months.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
