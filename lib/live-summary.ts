import { connect } from "./snowflake";
import { DW_PROPERTIES_SQL, DW_LISTINGS_SQL, PM_BOM_SQL, DW_WO_SQL, DW_RENEWALS_SQL } from "./generated/sql";
import type { SummaryCache, PropertyRow, PropertySummaryRow, MonthlyTrendRow, GaugeData } from "./types";

const PAGE_FILTER = `OCCUPANCY_STATUS <> 'Dispositions' AND ORGANIZATION_NAME IS NOT NULL`;
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const LEASED = new Set(["Tenant Leased", "Trustee Leased"]);
const numOr = (v: unknown): number | null =>
  v == null || Number.isNaN(Number(v)) ? null : Number(v);
const str = (v: unknown): string => (v == null ? "" : String(v));

/**
 * Live Summary dataset from Snowflake (reuses the report's native queries +
 * validated curated sources). Independent queries run in parallel and are each
 * guarded. This is the single source of truth served by /api/summary.
 */
export async function getLiveSummary(): Promise<SummaryCache> {
  const conn = await connect();
  const kpis: SummaryCache["kpis"] = {
    totalProperties: null, occupancyPct: null, activeListings: null,
    totalTenants: null, rentVar: null, holdingFees: null,
    projActualMis: null, netOccupancyGain: null, turnoverPct: null,
  };
  let properties: PropertyRow[] = [];
  let propertySummary: PropertySummaryRow[] = [];
  let monthlyTrend: MonthlyTrendRow[] = [];
  let podCount: number | null = null, imValue: number | null = null;
  let internalMaintenance: GaugeData | null = null, eomCollections: GaugeData | null = null, renewal: GaugeData | null = null;
  const collByMonth: Record<string, number | null> = {};
  const renewByMonth: Record<string, number | null> = {};
  const q = <T = Record<string, unknown>>(sql: string) => conn.query<T>(sql);
  const log = (n: string, e: unknown) => console.error(`[live] ${n} failed:`, (e as Error).message);
  const curBOM = () => { const d = new Date(); return d.getUTCFullYear() * 12 + d.getUTCMonth() + 1; };
  const latestComplete = (m: Record<string, number | null>) => {
    let best: { k: number; v: number } | null = null;
    for (const [label, v] of Object.entries(m)) {
      const [mon, yr] = label.split(" "); const k = Number(yr) * 12 + MON.indexOf(mon) + 1;
      if (v != null && k < curBOM() && (!best || k > best.k)) best = { k, v };
    }
    return best?.v ?? null;
  };

  // One faithful DW_Properties scan -> per-property rows (drives property tiles + all slicers).
  const tProps = (async () => { try {
    const rows = await q(`SELECT * FROM (\n${DW_PROPERTIES_SQL}\n) WHERE ${PAGE_FILTER}`);
    const seen = new Set<unknown>();
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
    const [r] = await q(`WITH l AS ( SELECT * FROM (\n${DW_LISTINGS_SQL}\n) )
      SELECT COUNT(DISTINCT PROPERTY_KEY) AS N FROM l WHERE LISTING_STATUS='Active' AND IS_PUBLISHED='Y'`);
    kpis.activeListings = numOr(r?.N);
  } catch (e) { log("active listings", e); } })();

  const tTrend = (async () => { try {
    const rows = await q(`WITH b AS ( SELECT * FROM (\n${PM_BOM_SQL}\n) )
      SELECT TO_CHAR(BEG_OF_MONTH,'Mon YYYY') AS MONTH, MIN(BEG_OF_MONTH) AS BOM,
             COUNT(IFF(OCCUPANCY_STATUS IS NOT NULL,HBPM_PROPERTYID,NULL)) AS HOMES, AVG(CURRENT_RENT) AS AVG_RENT
      FROM b WHERE BEG_OF_MONTH >= DATEADD('month',-3,DATE_TRUNC('month',CURRENT_DATE()))
      GROUP BY TO_CHAR(BEG_OF_MONTH,'Mon YYYY') ORDER BY BOM`);
    monthlyTrend = rows.map((r) => ({ month: str(r.MONTH), homes: numOr(r.HOMES), avgRent: numOr(r.AVG_RENT),
      occBom: null, occEom: null, collections: null, renewal: null, turnover: null, netTurnCost: null }));
  } catch (e) { log("monthly trend", e); } })();

  const tIM = (async () => { try {
    const [r] = await q(`WITH w AS ( SELECT * FROM (\n${DW_WO_SQL}\n) )
      SELECT SUM(CLIENT_INVOICE_AMOUNT) AS IM FROM w
      WHERE WORKORDER_STATUS='Closed' AND IS_INTERNAL_VENDOR='Y'
        AND DATE_TRUNC('month',WO_CLOSED_DATE) >= DATEADD('month',-3,DATE_TRUNC('month',CURRENT_DATE()))
        AND DATE_TRUNC('month',WO_CLOSED_DATE) <= DATE_TRUNC('month',CURRENT_DATE())
        AND COMPANY_NAME NOT IN ('Credit Card Vendor','GE Vendor (Maintenance)','New Builder Warranty Vendor','Lennar Builder Warranty')`);
    imValue = numOr(r?.IM);
  } catch (e) { log("internal maintenance", e); } })();

  // Collections %: rent GL 4010, net of concessions (CreditTypeId<>2) = Paid/Charged by month.
  const tColl = (async () => { try {
    const rows = await q(`SELECT "Year Charge Date" AS YR, "Month Charge Date" AS MO,
        DIV0(SUM("Paid Amount"),SUM("Charge Amount")) AS PCT
      FROM PROD_ANALYTICS.BI_MASTER_DATASETS.MASTER_PM_COLLECTIONS
      WHERE "GL Code"='4010' AND COALESCE("CreditTypeId",0)<>2
        AND DATE_FROM_PARTS("Year Charge Date","Month Charge Date",1) >= DATEADD('month',-4,DATE_TRUNC('month',CURRENT_DATE()))
        AND DATE_FROM_PARTS("Year Charge Date","Month Charge Date",1) <= DATE_TRUNC('month',CURRENT_DATE())
      GROUP BY 1,2`);
    for (const r of rows) { const mo = Number(r.MO); if (mo >= 1 && mo <= 12) collByMonth[`${MON[mo-1]} ${Number(r.YR)}`] = numOr(r.PCT); }
    const v = latestComplete(collByMonth);
    if (v != null) eomCollections = { value: v, target: 0.955, min: 0.9, max: 0.97, format: "percent", label: "EOM Collections" };
  } catch (e) { log("collections", e); } })();

  // Renewal %: 0_Active Renew % = Renewed / (Repair-Sell excluded; Renewed|Notice|MTM), by lease-end month.
  const tRenew = (async () => { try {
    const rows = await q(`WITH r AS ( SELECT * FROM (\n${DW_RENEWALS_SQL}\n) )
      SELECT TO_CHAR("1_C_LeaseEnd(BOM)",'Mon YYYY') AS MONTH, MIN("1_C_LeaseEnd(BOM)") AS BOM,
        DIV0(COUNT_IF("Renewal Result"='Renewed'),
             COUNT_IF(STRATEGY_NAME<>'Repair/Sell' AND "Renewal Result" IN ('Renewed','Notice','MTM'))) AS PCT
      FROM r WHERE "1_C_LeaseEnd(BOM)" >= DATEADD('month',-4,DATE_TRUNC('month',CURRENT_DATE()))
        AND "1_C_LeaseEnd(BOM)" <= DATE_TRUNC('month',CURRENT_DATE())
      GROUP BY 1 ORDER BY BOM`);
    for (const r of rows) renewByMonth[str(r.MONTH)] = numOr(r.PCT);
    const v = latestComplete(renewByMonth);
    if (v != null) renewal = { value: v, target: 0.75, min: 0, max: 1, format: "percent", label: "Renewal" };
  } catch (e) { log("renewal", e); } })();

  try { await Promise.allSettled([tProps, tListings, tTrend, tIM, tColl, tRenew]); }
  finally { conn.close(); }

  // Aggregate property tiles from per-property rows (report's exact measures).
  if (properties.length) {
    kpis.totalProperties = properties.length;
    const leased = properties.filter((p) => LEASED.has(p.status)).length;
    kpis.totalTenants = leased;
    kpis.occupancyPct = properties.length ? leased / properties.length : null;
    const rs = properties.filter((p) => p.rent != null && p.uw != null);
    const sr = rs.reduce((s, p) => s + (p.rent as number), 0), su = rs.reduce((s, p) => s + (p.uw as number), 0);
    kpis.rentVar = su ? sr / su - 1 : null;
    podCount = new Set(properties.map((p) => p.pod).filter(Boolean)).size || null;
    const g = new Map<string, PropertySummaryRow>();
    for (const p of properties) {
      const key = `${p.org}|${p.status}`;
      const cur = g.get(key) ?? { organization: p.org, region: "—", subdivision: "—", status: p.status, count: 0 };
      cur.count++; g.set(key, cur);
    }
    propertySummary = Array.from(g.values()).filter((r) => r.status);
  }
  // Join collections + renewal into the trend; build IM gauge (goal = POD*2*2000*4).
  monthlyTrend.forEach((r) => { r.collections = collByMonth[r.month] ?? null; r.renewal = renewByMonth[r.month] ?? null; });
  const goal = podCount != null ? podCount * 2 * 2000 * 4 : null;
  if (imValue != null && goal) internalMaintenance = { value: imValue, target: goal, min: 0, max: goal, format: "currency", label: "Internal Maintenance" };

  return {
    _meta: { source: "SNOWFLAKE", generatedAt: new Date().toISOString(),
      note: "Live. Pending: Net Turn Cost gauge + BOM/EOM occupancy, turnover, MIs, holding fees, net occupancy gain (Power BI calculated-column measures, being wired)." },
    filters: { occupancyStatusExcludes: ["Dispositions"], organizationNameExcludes: [null] },
    kpis,
    gauges: { eomCollections, renewal, netTurnCost: null, internalMaintenance },
    propertySummary, monthlyTrend, properties,
  };
}
