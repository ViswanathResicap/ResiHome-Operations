import { connect } from "./snowflake";
import {
  DW_PROPERTIES_SQL, DW_LISTINGS_SQL, PM_BOM_SQL, DW_WO_SQL,
  DW_TURNS_SQL, DW_MOVEOUT_SQL, DW_DEALS_SQL,
} from "./generated/sql";
import type { SummaryCache, PropertyRow, PropertySummaryRow, MonthlyTrendRow, GaugeData } from "./types";

const PAGE_FILTER = `OCCUPANCY_STATUS <> 'Dispositions' AND ORGANIZATION_NAME IS NOT NULL`;
// Roll several legal entities up under one display organization.
const ORG_REMAP: Record<string, string> = {
  "Array Park LLC": "McKinley Homes",
  "Oak Hill Residence Park LLC": "McKinley Homes",
  "Rivertown Park LLC": "McKinley Homes",
  "Wiltshire Park LLC": "McKinley Homes",
};
const remapOrg = (o: string) => ORG_REMAP[o] ?? o;
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const LEASED = new Set(["Tenant Leased", "Trustee Leased"]);
const numOr = (v: unknown): number | null => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v: unknown): string => (v == null ? "" : String(v));
// last 4 complete-ish months window (inclusive of current)
const WIN = `>= DATEADD('month',-3,DATE_TRUNC('month',CURRENT_DATE())) AND %C% <= DATE_TRUNC('month',CURRENT_DATE())`;
const win = (col: string) => `${col} ${WIN.replace("%C%", col)}`;

export async function getLiveSummary(): Promise<SummaryCache> {
  const conn = await connect();
  const kpis: SummaryCache["kpis"] = {
    totalProperties: null, occupancyPct: null, activeListings: null, totalTenants: null,
    rentVar: null, holdingFees: null, projActualMis: null, netOccupancyGain: null, turnoverPct: null,
  };
  let properties: PropertyRow[] = [], propertySummary: PropertySummaryRow[] = [], monthlyTrend: MonthlyTrendRow[] = [];
  let podCount: number | null = null, leasedCount = 0;
  let internalMaintenance: GaugeData | null = null, eomCollections: GaugeData | null = null,
      renewal: GaugeData | null = null, netTurnCost: GaugeData | null = null;
  const collByMonth: Record<string, number | null> = {}, renewByMonth: Record<string, number | null> = {},
        ntcByMonth: Record<string, number | null> = {}, occByMonth: Record<string, number | null> = {},
        imByMonth: Record<string, number | null> = {}, hfByMonth: Record<string, number | null> = {},
        miByMonth: Record<string, number | null> = {}, mofByMonth: Record<string, number | null> = {};
  const errors: string[] = [];
  const q = <T = Record<string, unknown>>(sql: string) => conn.query<T>(sql);
  const log = (n: string, e: unknown) => { errors.push(`${n}: ${(e as Error).message}`); console.error(`[live] ${n}:`, (e as Error).message); };
  const curK = () => { const d = new Date(); return d.getUTCFullYear() * 12 + d.getUTCMonth() + 1; };
  const latest = (m: Record<string, number | null>) => {
    let best: { k: number; v: number } | null = null;
    for (const [l, v] of Object.entries(m)) { const [mo, yr] = l.split(" "); const k = +yr * 12 + MON.indexOf(mo) + 1;
      if (v != null && k < curK() && (!best || k > best.k)) best = { k, v }; }
    return best?.v ?? null;
  };
  const wrap = (sql: string) => `SELECT * FROM (\n${sql}\n)`;

  const tasks: Promise<void>[] = [];
  const add = (name: string, fn: () => Promise<void>) => tasks.push(fn().catch((e) => log(name, e)));

  // --- Property rows (drives property tiles + all slicers) ---
  add("property rows", async () => {
    const rows = await q(`${wrap(DW_PROPERTIES_SQL)} WHERE ${PAGE_FILTER}`);
    const seen = new Set<unknown>();
    for (const r of rows) {
      const key = r.PROPERTY_KEY; if (key != null && seen.has(key)) continue; if (key != null) seen.add(key);
      properties.push({ org: remapOrg(str(r.ORGANIZATION_NAME)), region: str(r.REGION_NAME), subdivision: str(r.SUBDIVISION),
        pm: str(r.PROPERTY_MANAGER), apm: str(r.PROPERTY_MANAGER_ASSISTANT), pod: str(r.POD),
        status: str(r.OCCUPANCY_STATUS_SUMMARY), summaryId: numOr(r.OCCUPANCY_STATUS_SUMMARYID),
        delinquent: str(r["1_Tenant Balance Status"]), address: str(r.FULL_ADDRESS),
        rent: numOr(r.CURRENT_RENT), uw: numOr(r.UNDER_WRITTEN_RENT) });
    }
  });

  add("active listings", async () => {
    const [r] = await q(`WITH l AS (${wrap(DW_LISTINGS_SQL)}) SELECT COUNT(DISTINCT PROPERTY_KEY) AS N FROM l WHERE LISTING_STATUS='Active' AND IS_PUBLISHED='Y'`);
    kpis.activeListings = numOr(r?.N);
  });

  add("trend homes/rent", async () => {
    const rows = await q(`WITH b AS (${wrap(PM_BOM_SQL)})
      SELECT TO_CHAR(BEG_OF_MONTH,'Mon YYYY') AS MONTH, MIN(BEG_OF_MONTH) AS BOM,
        COUNT(IFF(OCCUPANCY_STATUS IS NOT NULL,HBPM_PROPERTYID,NULL)) AS HOMES, AVG(CURRENT_RENT) AS AVG_RENT
      FROM b WHERE ${win("BEG_OF_MONTH")} GROUP BY 1 ORDER BY BOM`);
    monthlyTrend = rows.map((r) => ({ month: str(r.MONTH), homes: numOr(r.HOMES), avgRent: numOr(r.AVG_RENT),
      occBom: null, occEom: null, collections: null, renewal: null, turnover: null, netTurnCost: null }));
  });

  // --- Occupancy trend (best-effort from PM_BOM month snapshot) ---
  add("occupancy trend", async () => {
    const rows = await q(`WITH b AS (${wrap(PM_BOM_SQL)})
      SELECT TO_CHAR(BEG_OF_MONTH,'Mon YYYY') AS MONTH,
        DIV0(COUNT_IF(OCCUPANCY_STATUS IN ('Tenant Leased','Trustee Leased','Trustee Lease Honored','Vacant - Future Move In')), COUNT(*)) AS OCC
      FROM b WHERE ${win("BEG_OF_MONTH")} GROUP BY 1`);
    for (const r of rows) occByMonth[str(r.MONTH)] = numOr(r.OCC);
  });

  // Internal Maintenance (report DAX: SUM(CLIENT_INVOICE_AMOUNT) where Closed,
  // internal vendor, Closed Date_BOM in month) — per-month so the gauge shows
  // one month vs its goal. No vendor-name exclusion (not in the report).
  add("internal maintenance", async () => {
    const rows = await q(`WITH w AS (${wrap(DW_WO_SQL)})
      SELECT TO_CHAR(DATE_TRUNC('month',WO_CLOSED_DATE),'Mon YYYY') AS MONTH, SUM(CLIENT_INVOICE_AMOUNT) AS IM
      FROM w WHERE WORKORDER_STATUS='Closed' AND IS_INTERNAL_VENDOR='Y' AND ${win("DATE_TRUNC('month',WO_CLOSED_DATE)")} GROUP BY 1`);
    for (const r of rows) imByMonth[str(r.MONTH)] = numOr(r.IM);
  });

  // POD count for the IM goal (report: DISTINCTCOUNT(DW_Properties[POD])).
  add("pod count", async () => {
    const [r] = await q(`${wrap(DW_PROPERTIES_SQL)} WHERE POD IS NOT NULL`.replace("SELECT *", "SELECT COUNT(DISTINCT POD) AS N"));
    podCount = numOr(r?.N);
  });

  add("collections", async () => {
    const rows = await q(`SELECT "Year Charge Date" AS YR,"Month Charge Date" AS MO, DIV0(SUM("Paid Amount"),SUM("Charge Amount")) AS PCT
      FROM PROD_ANALYTICS.BI_MASTER_DATASETS.MASTER_PM_COLLECTIONS WHERE "GL Code"='4010' AND COALESCE("CreditTypeId",0)<>2
        AND DATE_FROM_PARTS("Year Charge Date","Month Charge Date",1) >= DATEADD('month',-4,DATE_TRUNC('month',CURRENT_DATE()))
        AND DATE_FROM_PARTS("Year Charge Date","Month Charge Date",1) <= DATE_TRUNC('month',CURRENT_DATE()) GROUP BY 1,2`);
    for (const r of rows) { const mo = Number(r.MO); if (mo>=1&&mo<=12) collByMonth[`${MON[mo-1]} ${Number(r.YR)}`] = numOr(r.PCT); }
    const v = latest(collByMonth); if (v != null) eomCollections = { value: v, target: 0.955, min: 0.9, max: 0.97, format: "percent", label: "EOM Collections" };
  });

  // Renewal %: retention = Renewals / (Renewals + Re-Leases) by lease-end month
  // (validated vs the report's ~70% gauge). Uses the curated renewal master.
  add("renewal", async () => {
    const rows = await q(`SELECT TO_CHAR(DATE_TRUNC('month',"LeaseTo"),'Mon YYYY') AS MONTH,
        DIV0(COUNT_IF("Release/Renewal Index"='Renewal'), COUNT_IF("Release/Renewal Index" IN ('Renewal','Re-Lease'))) AS PCT
      FROM PROD_ANALYTICS.BI_MASTER_DATASETS.MASTER_PM_RENEWAL_RELEASE
      WHERE "LeaseTo" >= DATEADD('month',-4,DATE_TRUNC('month',CURRENT_DATE())) AND "LeaseTo" <= DATE_TRUNC('month',CURRENT_DATE())
      GROUP BY 1, DATE_TRUNC('month',"LeaseTo")`);
    for (const r of rows) renewByMonth[str(r.MONTH)] = numOr(r.PCT);
    const v = latest(renewByMonth); if (v != null) renewal = { value: v, target: 0.75, min: 0, max: 1, format: "percent", label: "Renewal" };
  });

  // --- Net Turn Cost (best-effort: TKT_COST - move-out receipts, completed turns) ---
  add("net turn cost", async () => {
    const rows = await q(`WITH t AS (${wrap(DW_TURNS_SQL)})
      SELECT TO_CHAR(TURN_COMPLETED_BOM,'Mon YYYY') AS MONTH, AVG(GREATEST(ZEROIFNULL(TKT_COST)-ZEROIFNULL(MOVEOUTRECEIPTS_FINAL),0)) AS NTC
      FROM t WHERE N_LEASE_FROM_DATE IS NOT NULL AND ${win("TURN_COMPLETED_BOM")} GROUP BY 1`);
    for (const r of rows) ntcByMonth[str(r.MONTH)] = numOr(r.NTC);
    const v = latest(ntcByMonth); if (v != null) netTurnCost = { value: v, target: 1750, min: 1000, max: 3000, format: "currency", label: "Net Turn Cost (All)" };
  });

  // --- Holding Fees by month (report: DISTINCTCOUNT(DW_Deals[EMAIL]) by HF (BOM)) ---
  add("holding fees", async () => {
    const rows = await q(`WITH d AS (${wrap(DW_DEALS_SQL)})
      SELECT TO_CHAR("HF (BOM)",'Mon YYYY') AS MONTH, COUNT(DISTINCT EMAIL) AS HF
      FROM d WHERE ${win('"HF (BOM)"')} GROUP BY 1`);
    for (const r of rows) hfByMonth[str(r.MONTH)] = numOr(r.HF);
  });

  // --- Proj/Actual MIs = MoveIn Monthly + FMI Monthly (report 01_MI_Combined) ---
  add("move-ins (combined)", async () => {
    const mi = await q(`WITH m AS (${wrap(DW_MOVEOUT_SQL)})
      SELECT TO_CHAR(MOVEIN_BOM,'Mon YYYY') AS MONTH, COUNT(DISTINCT TENANT_KEY) AS N
      FROM m WHERE ${win("MOVEIN_BOM")} GROUP BY 1`);
    const fmi = await q(`WITH l AS (${wrap(DW_LISTINGS_SQL)})
      SELECT TO_CHAR(LEASE_START_DATE_BOM,'Mon YYYY') AS MONTH, COUNT(DISTINCT RENT_LIST_HIST_ID) AS N
      FROM l WHERE ${win("LEASE_START_DATE_BOM")} AND CURRENT_DEAL_STATUS NOT IN ('Deal Won','Closed Won')
        AND MOST_RECENT_LISTING='Yes' AND FMI_FLAG=1 GROUP BY 1`);
    for (const r of mi) miByMonth[str(r.MONTH)] = numOr(r.N);
    for (const r of fmi) miByMonth[str(r.MONTH)] = (miByMonth[str(r.MONTH)] ?? 0) + (numOr(r.N) ?? 0);
  });

  // --- Move-out forecast (report 01_MoveOut_Forecast): actual move-outs by
  // MOVEOUT_BOM PLUS forecasted (no move-out yet, not eviction/repair-sell) by
  // MOVE_OUT_FORECAST_BOM. (The DAX also drops still-"Pending" renewals — a
  // cross-table calc column not reproduced here; small residual.) ---
  add("move-out forecast", async () => {
    const rows = await q(`WITH m AS (${wrap(DW_MOVEOUT_SQL)})
      SELECT MONTH, SUM(N) AS MOF FROM (
        SELECT TO_CHAR(MOVEOUT_BOM,'Mon YYYY') AS MONTH, COUNT(DISTINCT TENANT_KEY) AS N
          FROM m WHERE ${win("MOVEOUT_BOM")} GROUP BY 1
        UNION ALL
        SELECT TO_CHAR(MOVE_OUT_FORECAST_BOM,'Mon YYYY') AS MONTH, COUNT(DISTINCT TENANT_KEY) AS N
          FROM m WHERE MOVEOUT IS NULL AND ZEROIFNULL(EVICITON_AMOD_FLAG)=0
            AND COALESCE(STRATEGY_NAME,'')<>'Repair/Sell' AND ${win("MOVE_OUT_FORECAST_BOM")} GROUP BY 1
      ) GROUP BY MONTH`);
    for (const r of rows) mofByMonth[str(r.MONTH)] = numOr(r.MOF);
  });

  try { await Promise.allSettled(tasks); } finally { conn.close(); }

  // Property aggregates from rows (report-exact).
  if (properties.length) {
    kpis.totalProperties = properties.length;
    leasedCount = properties.filter((p) => LEASED.has(p.status)).length;
    kpis.totalTenants = leasedCount;
    kpis.occupancyPct = properties.length ? leasedCount / properties.length : null;
    const rs = properties.filter((p) => p.rent != null && p.uw != null);
    const sr = rs.reduce((s, p) => s + (p.rent as number), 0), su = rs.reduce((s, p) => s + (p.uw as number), 0);
    kpis.rentVar = su ? sr / su - 1 : null;
    podCount = new Set(properties.map((p) => p.pod).filter(Boolean)).size || null;
    const g = new Map<string, PropertySummaryRow>();
    for (const p of properties) { const key = `${p.org}|${p.status}`;
      const c = g.get(key) ?? { organization: p.org, region: "—", subdivision: "—", status: p.status, count: 0 }; c.count++; g.set(key, c); }
    propertySummary = Array.from(g.values()).filter((r) => r.status);
  }
  // Funnel KPIs — latest complete month (matches the validated gauge month).
  const miLatest = latest(miByMonth), mofLatest = latest(mofByMonth);
  kpis.holdingFees = latest(hfByMonth);
  kpis.projActualMis = miLatest;
  kpis.netOccupancyGain = miLatest != null && mofLatest != null ? miLatest - mofLatest : null;
  kpis.turnoverPct = mofLatest != null && leasedCount ? mofLatest / leasedCount : null;
  // Trend joins.
  monthlyTrend.forEach((r) => {
    r.collections = collByMonth[r.month] ?? null; r.renewal = renewByMonth[r.month] ?? null;
    r.netTurnCost = ntcByMonth[r.month] ?? null; r.occBom = occByMonth[r.month] ?? null;
    r.turnover = mofByMonth[r.month] != null && leasedCount ? (mofByMonth[r.month] as number) / leasedCount : null;
  });
  // IM gauge — latest complete month vs goal (DISTINCTCOUNT(POD)*2*2000*4).
  const goal = podCount != null ? podCount * 2 * 2000 * 4 : null;
  const imLatest = latest(imByMonth);
  if (imLatest != null && goal) internalMaintenance = { value: imLatest, target: goal, min: 0, max: goal, format: "currency", label: "Internal Maintenance" };

  return {
    _meta: { source: "SNOWFLAKE", generatedAt: new Date().toISOString(),
      note: "Live. Some monthly measures are best-effort translations of Power BI calculated columns — validating.", errors: errors.length ? errors : undefined },
    filters: { occupancyStatusExcludes: ["Dispositions"], organizationNameExcludes: [null] },
    kpis,
    gauges: { eomCollections, renewal, netTurnCost, internalMaintenance },
    propertySummary, monthlyTrend, properties,
  };
}
