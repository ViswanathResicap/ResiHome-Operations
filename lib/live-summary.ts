import { connect } from "./snowflake";
import {
  DW_PROPERTIES_SQL, DW_LISTINGS_SQL, PM_BOM_SQL, DW_WO_SQL,
  DW_RENEWALS_SQL, DW_TURNS_SQL, DW_MOVEOUT_SQL, DW_DEALS_SQL,
} from "./generated/sql";
import type { SummaryCache, PropertyRow, PropertySummaryRow, MonthlyTrendRow, GaugeData } from "./types";

const PAGE_FILTER = `OCCUPANCY_STATUS <> 'Dispositions' AND ORGANIZATION_NAME IS NOT NULL`;
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
  let podCount: number | null = null, imValue: number | null = null, leasedCount = 0;
  let moForecastCur: number | null = null, miCur: number | null = null;
  let internalMaintenance: GaugeData | null = null, eomCollections: GaugeData | null = null,
      renewal: GaugeData | null = null, netTurnCost: GaugeData | null = null;
  const collByMonth: Record<string, number | null> = {}, renewByMonth: Record<string, number | null> = {},
        ntcByMonth: Record<string, number | null> = {}, occByMonth: Record<string, number | null> = {};
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
      properties.push({ org: str(r.ORGANIZATION_NAME), region: str(r.REGION_NAME), subdivision: str(r.SUBDIVISION),
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

  add("internal maintenance", async () => {
    const [r] = await q(`WITH w AS (${wrap(DW_WO_SQL)}) SELECT SUM(CLIENT_INVOICE_AMOUNT) AS IM FROM w
      WHERE WORKORDER_STATUS='Closed' AND IS_INTERNAL_VENDOR='Y' AND ${win("DATE_TRUNC('month',WO_CLOSED_DATE)")}
        AND COMPANY_NAME NOT IN ('Credit Card Vendor','GE Vendor (Maintenance)','New Builder Warranty Vendor','Lennar Builder Warranty')`);
    imValue = numOr(r?.IM);
  });

  add("collections", async () => {
    const rows = await q(`SELECT "Year Charge Date" AS YR,"Month Charge Date" AS MO, DIV0(SUM("Paid Amount"),SUM("Charge Amount")) AS PCT
      FROM PROD_ANALYTICS.BI_MASTER_DATASETS.MASTER_PM_COLLECTIONS WHERE "GL Code"='4010' AND COALESCE("CreditTypeId",0)<>2
        AND DATE_FROM_PARTS("Year Charge Date","Month Charge Date",1) >= DATEADD('month',-4,DATE_TRUNC('month',CURRENT_DATE()))
        AND DATE_FROM_PARTS("Year Charge Date","Month Charge Date",1) <= DATE_TRUNC('month',CURRENT_DATE()) GROUP BY 1,2`);
    for (const r of rows) { const mo = Number(r.MO); if (mo>=1&&mo<=12) collByMonth[`${MON[mo-1]} ${Number(r.YR)}`] = numOr(r.PCT); }
    const v = latest(collByMonth); if (v != null) eomCollections = { value: v, target: 0.955, min: 0.9, max: 0.97, format: "percent", label: "EOM Collections" };
  });

  add("renewal", async () => {
    const rows = await q(`WITH r AS (${wrap(DW_RENEWALS_SQL)})
      SELECT TO_CHAR("1_C_LeaseEnd(BOM)",'Mon YYYY') AS MONTH,
        DIV0(COUNT_IF("Renewal Result"='Renewed'), COUNT_IF(STRATEGY_NAME<>'Repair/Sell' AND "Renewal Result" IN ('Renewed','Notice','MTM'))) AS PCT
      FROM r WHERE ${win('"1_C_LeaseEnd(BOM)"')} GROUP BY 1`);
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

  // --- Holding Fees (distinct deals with a holding fee in the window) ---
  add("holding fees", async () => {
    const [r] = await q(`WITH d AS (${wrap(DW_DEALS_SQL)}) SELECT COUNT(DISTINCT EMAIL) AS HF FROM d WHERE ${win('"HF (BOM)"')}`);
    kpis.holdingFees = numOr(r?.HF);
  });

  // --- Move-ins (current month) + move-out forecast (current month) ---
  add("move-ins", async () => {
    const [r] = await q(`WITH m AS (${wrap(DW_MOVEOUT_SQL)}) SELECT COUNT(DISTINCT TENANT_KEY) AS MI FROM m
      WHERE DATE_TRUNC('month',LEASE_FROM_DATE) = DATE_TRUNC('month',CURRENT_DATE())`);
    miCur = numOr(r?.MI);
  });
  add("move-out forecast", async () => {
    const [r] = await q(`WITH m AS (${wrap(DW_MOVEOUT_SQL)}) SELECT COUNT(DISTINCT TENANT_KEY) AS MOF FROM m
      WHERE Move_Out_Forecast_BOM = DATE_TRUNC('month',CURRENT_DATE())`);
    moForecastCur = numOr(r?.MOF);
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
  // Funnel KPIs.
  kpis.projActualMis = miCur;
  kpis.netOccupancyGain = miCur != null && moForecastCur != null ? miCur - moForecastCur : null;
  kpis.turnoverPct = moForecastCur != null && leasedCount ? moForecastCur / leasedCount : null;
  // Trend joins.
  monthlyTrend.forEach((r) => {
    r.collections = collByMonth[r.month] ?? null; r.renewal = renewByMonth[r.month] ?? null;
    r.netTurnCost = ntcByMonth[r.month] ?? null; r.occBom = occByMonth[r.month] ?? null;
  });
  // IM gauge (goal = POD*2*2000*4).
  const goal = podCount != null ? podCount * 2 * 2000 * 4 : null;
  if (imValue != null && goal) internalMaintenance = { value: imValue, target: goal, min: 0, max: goal, format: "currency", label: "Internal Maintenance" };

  return {
    _meta: { source: "SNOWFLAKE", generatedAt: new Date().toISOString(),
      note: "Live. Some monthly measures are best-effort translations of Power BI calculated columns — validating.", errors: errors.length ? errors : undefined },
    filters: { occupancyStatusExcludes: ["Dispositions"], organizationNameExcludes: [null] },
    kpis,
    gauges: { eomCollections, renewal, netTurnCost, internalMaintenance },
    propertySummary, monthlyTrend, properties,
  };
}
