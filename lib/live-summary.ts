import { connect } from "./snowflake";
import { source, sourceRaw, VIEWS } from "./datasets";
import type { SummaryCache, PropertyRow, PropertySummaryRow, MonthlyTrendRow, GaugeData, FlowEvent } from "./types";

const PAGE_FILTER = `OCCUPANCY_STATUS <> 'Dispositions' AND ORGANIZATION_NAME IS NOT NULL`;
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
  const activeKeys = new Set<string>();
  const hfEv: Record<string, FlowEvent[]> = {}, miEv: Record<string, FlowEvent[]> = {}, mofEv: Record<string, FlowEvent[]> = {};
  const errors: string[] = [];
  const q = <T = Record<string, unknown>>(sql: string) => conn.query<T>(sql);
  const log = (n: string, e: unknown) => { errors.push(`${n}: ${(e as Error).message}`); console.error(`[live] ${n}:`, (e as Error).message); };
  const curK = () => { const d = new Date(); return d.getUTCFullYear() * 12 + d.getUTCMonth() + 1; };
  const latest = (m: Record<string, number | null>) => {
    let best: { k: number; v: number } | null = null;
    for (const [l, v] of Object.entries(m)) {
      const [mo, yr] = l.split(" ");
      const k = +yr * 12 + MON.indexOf(mo) + 1;
      if (v != null && k < curK() && (!best || k > best.k)) best = { k, v };
    }
    return best?.v ?? null;
  };
  const latestKey = (m: Record<string, number | null>) => {
    let best: { k: number; l: string } | null = null;
    for (const [l, v] of Object.entries(m)) {
      const [mo, yr] = l.split(" ");
      const k = +yr * 12 + MON.indexOf(mo) + 1;
      if (v != null && k < curK() && (!best || k > best.k)) best = { k, l };
    }
    return best?.l ?? null;
  };
  const tasks: Promise<void>[] = [];
  const add = (name: string, fn: () => Promise<void>) => tasks.push(fn().catch((e) => log(name, e)));

  // --- Property rows ---
  add("property rows", async () => {
    let rows: Record<string, unknown>[];
    try {
      rows = await q(`${source("properties")} WHERE ${PAGE_FILTER}`);
    } catch (e) {
      log("property rows projection (fell back to SELECT *)", e);
      rows = await q(`${sourceRaw("properties")} WHERE ${PAGE_FILTER}`);
    }
    const seen = new Set<unknown>();
    for (const r of rows) {
      const key = r.PROPERTY_KEY;
      if (key != null && seen.has(key)) continue;
      if (key != null) seen.add(key);
      properties.push({
        key: str(r.PROPERTY_KEY),
        org: remapOrg(str(r.ORGANIZATION_NAME)),
        region: str(r.REGION_NAME),
        subdivision: str(r.SUBDIVISION),
        pm: str(r.PROPERTY_MANAGER),
        apm: str(r.PROPERTY_MANAGER_ASSISTANT),
        pod: str(r.POD),
        status: str(r.OCCUPANCY_STATUS_SUMMARY),
        summaryId: numOr(r.OCCUPANCY_STATUS_SUMMARYID),
        delinquent: "",
        address: str(r.FULL_ADDRESS),
        rent: numOr(r.CURRENT_RENT),
        uw: numOr(r.UNDER_WRITTEN_RENT),
      });
    }
  });

  add("active listings", async () => {
    const rows = await q(`WITH l AS (${source("listings")}) SELECT DISTINCT PROPERTY_KEY AS KEY FROM l WHERE LISTING_STATUS='Active' AND IS_PUBLISHED='Y'`);
    for (const r of rows) { const k = str(r.KEY); if (k) activeKeys.add(k); }
    kpis.activeListings = activeKeys.size;
  });

  add("trend (homes/rent/occupancy)", async () => {
    const rows = await q(`WITH b AS (${source("pmBom")})
      SELECT TO_CHAR(BEG_OF_MONTH,'Mon YYYY') AS MONTH, MIN(BEG_OF_MONTH) AS BOM,
        COUNT(IFF(OCCUPANCY_STATUS IS NOT NULL,HBPM_PROPERTYID,NULL)) AS HOMES, AVG(CURRENT_RENT) AS AVG_RENT,
        DIV0(COUNT_IF(OCCUPANCY_STATUS IN ('Tenant Leased','Trustee Leased','Trustee Lease Honored','Vacant - Future Move In')), COUNT(*)) AS OCC
      FROM b WHERE ${win("BEG_OF_MONTH")} GROUP BY 1 ORDER BY BOM`);
    monthlyTrend = rows.map((r) => ({
      month: str(r.MONTH), homes: numOr(r.HOMES), avgRent: numOr(r.AVG_RENT),
      occBom: null, occEom: null, collections: null, renewal: null, turnover: null, netTurnCost: null,
    }));
    for (const r of rows) occByMonth[str(r.MONTH)] = numOr(r.OCC);
  });

  add("internal maintenance", async () => {
    const rows = await q(`WITH w AS (${source("wo")})
      SELECT TO_CHAR(DATE_TRUNC('month',WO_CLOSED_DATE),'Mon YYYY') AS MONTH, SUM(CLIENT_INVOICE_AMOUNT) AS IM
      FROM w WHERE WORKORDER_STATUS='Closed' AND IS_INTERNAL_VENDOR='Y'
        AND ${win("DATE_TRUNC('month',WO_CLOSED_DATE)")}
        AND COALESCE(COMPANY_NAME,'') NOT IN ('Credit Card Vendor','GE Vendor (Maintenance)','New Builder Warranty Vendor','Lennar Builder Warranty')
      GROUP BY 1`);
    for (const r of rows) imByMonth[str(r.MONTH)] = numOr(r.IM);
  });

  // --- FIXED: Collections using FCT_LEASING_TRANSACTION ---
  add("collections", async () => {
    const rows = await q(`
      SELECT 
        TO_CHAR(DATE_TRUNC('month', TO_DATE(CHARGE_DATE_KEY::TEXT,'YYYYMMDD')),'Mon YYYY') AS MONTH,
        DIV0(SUM(PAID_AMOUNT), SUM(AMOUNT)) AS PCT
      FROM ${VIEWS.collections}
      WHERE GL_ACCOUNT_KEY = 25
        AND COALESCE(CREDIT_TYPE_ID,0) <> 2
        AND TRANSACTION_TYPE = 'Charges'
        AND TO_DATE(CHARGE_DATE_KEY::TEXT,'YYYYMMDD') >= DATEADD('month',-4,DATE_TRUNC('month',CURRENT_DATE()))
        AND TO_DATE(CHARGE_DATE_KEY::TEXT,'YYYYMMDD') <= DATE_TRUNC('month',CURRENT_DATE())
      GROUP BY 1`);
    for (const r of rows) collByMonth[str(r.MONTH)] = numOr(r.PCT);
    const v = latest(collByMonth);
    if (v != null) eomCollections = {
      value: v, target: 0.955, min: 0.9, max: 0.97,
      format: "percent", label: "EOM Collections",
    };
  });

  // --- FIXED: Renewal using FCT_TENANT_LEASING_HIST ---
  add("renewal", async () => {
    const rows = await q(`
      SELECT 
        TO_CHAR(DATE_TRUNC('month', TO_DATE(LEASE_END_DATE_KEY::TEXT,'YYYYMMDD')),'Mon YYYY') AS MONTH,
        DIV0(COUNT_IF(IS_RENEWAL = 'Y'), COUNT(*)) AS PCT
      FROM ${VIEWS.renewalRelease}
      WHERE TO_DATE(LEASE_END_DATE_KEY::TEXT,'YYYYMMDD') >= DATEADD('month',-4,DATE_TRUNC('month',CURRENT_DATE()))
        AND TO_DATE(LEASE_END_DATE_KEY::TEXT,'YYYYMMDD') <= DATE_TRUNC('month',CURRENT_DATE())
      GROUP BY 1`);
    for (const r of rows) renewByMonth[str(r.MONTH)] = numOr(r.PCT);
    const v = latest(renewByMonth);
    if (v != null) renewal = {
      value: v, target: 0.75, min: 0, max: 1,
      format: "percent", label: "Renewal",
    };
  });

  add("net turn cost", async () => {
    const rows = await q(`WITH t AS (${source("turns")})
      SELECT TO_CHAR(TURN_COMPLETED_BOM,'Mon YYYY') AS MONTH,
        AVG(GREATEST(ZEROIFNULL(TKT_COST)-ZEROIFNULL(MOVEOUTRECEIPTS_FINAL),0)) AS NTC
      FROM t WHERE N_LEASE_FROM_DATE IS NOT NULL AND ${win("TURN_COMPLETED_BOM")} GROUP BY 1`);
    for (const r of rows) ntcByMonth[str(r.MONTH)] = numOr(r.NTC);
    const v = latest(ntcByMonth);
    if (v != null) netTurnCost = {
      value: v, target: 1750, min: 1000, max: 3000,
      format: "currency", label: "Net Turn Cost (All)", higherIsBetter: false,
    };
  });

  add("holding fees", async () => {
    const rows = await q(`WITH d AS (${source("deals")})
      SELECT TO_CHAR("HF (BOM)",'Mon YYYY') AS MONTH, EMAIL, PROPERTY_KEY AS KEY
      FROM d WHERE ${win('"HF (BOM)"')}`);
    const set: Record<string, Set<string>> = {};
    for (const r of rows) {
      const mo = str(r.MONTH), email = str(r.EMAIL);
      if (!email) continue;
      (set[mo] ??= new Set()).add(email);
      (hfEv[mo] ??= []).push({ key: str(r.KEY), id: "D" + email });
    }
    for (const mo in set) hfByMonth[mo] = set[mo].size;
  });

  add("move-ins (combined)", async () => {
    const mi = await q(`WITH m AS (${source("moveout")})
      SELECT TO_CHAR(MOVEIN_BOM,'Mon YYYY') AS MONTH, TENANT_KEY AS ID, PROPERTY_KEY AS KEY
      FROM m WHERE ${win("MOVEIN_BOM")}`);
    const fmi = await q(`WITH l AS (${source("listings")})
      SELECT TO_CHAR(LEASE_START_DATE_BOM,'Mon YYYY') AS MONTH, RENT_LIST_HIST_ID AS ID, PROPERTY_KEY AS KEY
      FROM l WHERE ${win("LEASE_START_DATE_BOM")} AND CURRENT_DEAL_STATUS NOT IN ('Deal Won','Closed Won')
        AND MOST_RECENT_LISTING='Yes' AND FMI_FLAG=1`);
    const tset: Record<string, Set<string>> = {}, lset: Record<string, Set<string>> = {};
    for (const r of mi) {
      const mo = str(r.MONTH), id = str(r.ID);
      (tset[mo] ??= new Set()).add(id);
      (miEv[mo] ??= []).push({ key: str(r.KEY), id: "T" + id });
    }
    for (const r of fmi) {
      const mo = str(r.MONTH), id = str(r.ID);
      (lset[mo] ??= new Set()).add(id);
      (miEv[mo] ??= []).push({ key: str(r.KEY), id: "L" + id });
    }
    for (const mo of new Set([...Object.keys(tset), ...Object.keys(lset)])) {
      miByMonth[mo] = (tset[mo]?.size ?? 0) + (lset[mo]?.size ?? 0);
    }
  });

  add("move-out forecast", async () => {
    const rows = await q(`WITH m AS (${source("moveout")})
      SELECT MONTH, ID, KEY FROM (
        SELECT TO_CHAR(MOVEOUT_BOM,'Mon YYYY') AS MONTH, TENANT_KEY AS ID, PROPERTY_KEY AS KEY
          FROM m WHERE ${win("MOVEOUT_BOM")}
        UNION ALL
        SELECT TO_CHAR(MOVE_OUT_FORECAST_BOM,'Mon YYYY') AS MONTH, TENANT_KEY AS ID, PROPERTY_KEY AS KEY
          FROM m WHERE MOVEOUT IS NULL AND ZEROIFNULL(EVICITON_AMOD_FLAG)=0
            AND COALESCE(STRATEGY_NAME,'')<>'Repair/Sell' AND ${win("MOVE_OUT_FORECAST_BOM")}
      )`);
    const set: Record<string, Set<string>> = {};
    for (const r of rows) {
      const mo = str(r.MONTH), id = str(r.ID);
      (set[mo] ??= new Set()).add(id);
      (mofEv[mo] ??= []).push({ key: str(r.KEY), id: "T" + id });
    }
    for (const mo in set) mofByMonth[mo] = set[mo].size;
  });

  try { await Promise.allSettled(tasks); } finally { conn.close(); }

  if (activeKeys.size) for (const p of properties) p.activeListing = activeKeys.has(p.key);

  // --- FIXED: Build propertySummary WITH region ---
  // Occupancy uses Power BI formula: SUMMARYID IN (7,8) / NOT NULL SUMMARYID
  // 7=Trustee Leased, 8=Tenant Leased (from DW_PROPERTIES Occupancy_Status_SummaryID)
  if (properties.length) {
    kpis.totalProperties = properties.length;
    // Use summaryId to match Power BI: occupied = summaryId IN (7,8)
    const occupied = properties.filter((p) => p.summaryId != null && (p.summaryId === 7 || p.summaryId === 8)).length;
    const total = properties.filter((p) => p.summaryId != null).length;
    leasedCount = properties.filter((p) => LEASED.has(p.status)).length;
    kpis.totalTenants = leasedCount;
    kpis.occupancyPct = total ? occupied / total : null;
    const rs = properties.filter((p) => p.rent != null && p.uw != null);
    const sr = rs.reduce((s, p) => s + (p.rent as number), 0);
    const su = rs.reduce((s, p) => s + (p.uw as number), 0);
    kpis.rentVar = su ? sr / su - 1 : null;
    podCount = new Set(properties.map((p) => p.pod).filter(Boolean)).size || null;

    // Build propertySummary WITH region — fixes the empty regional table
    const g = new Map<string, PropertySummaryRow>();
    for (const p of properties) {
      // Key includes region so the regional vacancy table gets data
      const key = `${p.org}|${p.region}|${p.status}`;
      const c = g.get(key) ?? {
        organization: p.org,
        region: p.region || "—",
        subdivision: p.subdivision || "—",
        status: p.status,
        count: 0,
      };
      c.count++;
      g.set(key, c);
    }
    propertySummary = Array.from(g.values()).filter((r) => r.status);
  }

  const miLatest = latest(miByMonth), mofLatest = latest(mofByMonth);
  kpis.holdingFees = latest(hfByMonth);
  kpis.projActualMis = miLatest;
  kpis.netOccupancyGain = miLatest != null && mofLatest != null ? miLatest - mofLatest : null;
  kpis.turnoverPct = mofLatest != null && leasedCount ? mofLatest / leasedCount : null;

  monthlyTrend.forEach((r) => {
    r.collections = collByMonth[r.month] ?? null;
    r.renewal = renewByMonth[r.month] ?? null;
    r.netTurnCost = ntcByMonth[r.month] ?? null;
    r.occBom = occByMonth[r.month] ?? null;
    r.turnover = mofByMonth[r.month] != null && leasedCount
      ? (mofByMonth[r.month] as number) / leasedCount : null;
  });

  for (let i = 0; i < monthlyTrend.length; i++) {
    monthlyTrend[i].occEom = monthlyTrend[i + 1]?.occBom ?? null;
  }

  const goal = podCount != null ? podCount * 2 * 2000 * 4 : null;
  const imLatest = latest(imByMonth);
  if (imLatest != null && goal) {
    internalMaintenance = {
      value: imLatest, target: goal, min: 0,
      max: Math.max(goal, imLatest) * 1.1,
      format: "currency", label: "Internal Maintenance", higherIsBetter: false,
    };
  }

  return {
    _meta: {
      source: "SNOWFLAKE",
      generatedAt: new Date().toISOString(),
      note: "Live. Collections and Renewal queries updated to use DBT_RESICAP tables.",
      errors: errors.length ? errors : undefined,
    },
    filters: {
      occupancyStatusExcludes: ["Dispositions"],
      organizationNameExcludes: [null],
    },
    kpis,
    gauges: { eomCollections, renewal, netTurnCost, internalMaintenance },
    propertySummary,
    monthlyTrend,
    properties,
    flows: properties.length ? {
      holdingFees: hfEv[latestKey(hfByMonth) ?? ""] ?? [],
      moveIns: miEv[latestKey(miByMonth) ?? ""] ?? [],
      moveOuts: mofEv[latestKey(mofByMonth) ?? ""] ?? [],
    } : undefined,
  };
}