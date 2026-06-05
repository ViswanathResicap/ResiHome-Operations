import { connect } from "./snowflake";
import { DW_PROPERTIES_SQL, DW_LISTINGS_SQL, PM_BOM_SQL, DW_WO_SQL } from "./generated/sql";
import type { SummaryCache, PropertySummaryRow, MonthlyTrendRow, GaugeData } from "./types";

// Page-level filters from the Summary page.json.
const PAGE_FILTER = `OCCUPANCY_STATUS <> 'Dispositions' AND ORGANIZATION_NAME IS NOT NULL`;

const numOr = (v: unknown): number | null =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);

/**
 * Builds the Summary dataset live from Snowflake, reusing the EXACT native
 * queries preserved in the .pbip mirror. Each metric group is independently
 * guarded so one failing query never blanks the whole page.
 */
export async function getLiveSummary(): Promise<SummaryCache> {
  const conn = await connect();
  const kpis: SummaryCache["kpis"] = {
    totalProperties: null, occupancyPct: null, activeListings: null,
    totalTenants: null, rentVar: null, holdingFees: null,
    projActualMis: null, netOccupancyGain: null, turnoverPct: null,
  };
  let propertySummary: PropertySummaryRow[] = [];
  let monthlyTrend: MonthlyTrendRow[] = [];
  let podCount: number | null = null;
  let internalMaintenance: GaugeData | null = null;

  try {
    // Property-level KPIs (match the card measures over DW_Properties).
    try {
      const [r] = await conn.query<Record<string, unknown>>(`
        WITH p AS ( SELECT * FROM (
${DW_PROPERTIES_SQL}
) )
        SELECT
          COUNT(DISTINCT PROPERTY_KEY) AS TOTAL_PROPERTIES,
          DIV0( COUNT(DISTINCT IFF(OCCUPANCY_STATUS_SUMMARYID IN (7,8), PROPERTY_KEY, NULL)),
                COUNT(DISTINCT IFF(OCCUPANCY_STATUS_SUMMARYID IS NOT NULL, PROPERTY_KEY, NULL)) ) AS OCCUPANCY_PCT,
          COUNT(DISTINCT IFF(OCCUPANCY_STATUS IN ('Tenant Leased','Trustee Leased'), PROPERTY_KEY, NULL)) AS TOTAL_TENANTS,
          DIV0( SUM(IFF(CURRENT_RENT IS NOT NULL AND UNDER_WRITTEN_RENT IS NOT NULL, CURRENT_RENT, NULL)),
                SUM(IFF(CURRENT_RENT IS NOT NULL AND UNDER_WRITTEN_RENT IS NOT NULL, UNDER_WRITTEN_RENT, NULL)) ) - 1 AS RENT_VAR,
          COUNT(DISTINCT POD) AS POD_COUNT
        FROM p WHERE ${PAGE_FILTER}`);
      kpis.totalProperties = numOr(r?.TOTAL_PROPERTIES);
      kpis.occupancyPct = numOr(r?.OCCUPANCY_PCT);
      kpis.totalTenants = numOr(r?.TOTAL_TENANTS);
      kpis.rentVar = numOr(r?.RENT_VAR);
      podCount = numOr(r?.POD_COUNT);
    } catch (e) { console.error("[live] property KPIs failed:", (e as Error).message); }

    // Property Summary pivot source (Organization x occupancy status).
    try {
      const rows = await conn.query<Record<string, unknown>>(`
        WITH p AS ( SELECT * FROM (
${DW_PROPERTIES_SQL}
) )
        SELECT ORGANIZATION_NAME AS ORG, OCCUPANCY_STATUS_SUMMARY AS STATUS,
               COUNT(DISTINCT PROPERTY_KEY) AS CNT
        FROM p WHERE ${PAGE_FILTER} GROUP BY 1,2 ORDER BY 1,2`);
      propertySummary = rows
        .filter((r) => r.STATUS)
        .map((r) => ({
          organization: String(r.ORG), region: "—", subdivision: "—",
          status: String(r.STATUS), count: Number(r.CNT),
        }));
    } catch (e) { console.error("[live] property summary failed:", (e as Error).message); }

    // Active Listings (DW_Listings): status Active & published.
    try {
      const [r] = await conn.query<Record<string, unknown>>(`
        WITH l AS ( SELECT * FROM (
${DW_LISTINGS_SQL}
) )
        SELECT COUNT(DISTINCT PROPERTY_KEY) AS ACTIVE_LISTINGS
        FROM l WHERE LISTING_STATUS = 'Active' AND IS_PUBLISHED = 'Y'`);
      kpis.activeListings = numOr(r?.ACTIVE_LISTINGS);
    } catch (e) { console.error("[live] active listings failed:", (e as Error).message); }

    // Monthly trend (last 4 BOM months) — Homes + Avg Rent from PM_BOM (native).
    // Occupancy/collections/renewal/turnover/net-turn-cost depend on Power BI
    // calculated columns and are wired in a follow-up (validated vs the report).
    try {
      const rows = await conn.query<Record<string, unknown>>(`
        WITH b AS ( SELECT * FROM (
${PM_BOM_SQL}
) )
        SELECT TO_CHAR(BEG_OF_MONTH, 'Mon YYYY') AS MONTH,
               MIN(BEG_OF_MONTH) AS BOM,
               COUNT(IFF(OCCUPANCY_STATUS IS NOT NULL, HBPM_PROPERTYID, NULL)) AS HOMES,
               AVG(CURRENT_RENT) AS AVG_RENT
        FROM b
        WHERE BEG_OF_MONTH >= DATEADD('month', -3, DATE_TRUNC('month', CURRENT_DATE()))
        GROUP BY TO_CHAR(BEG_OF_MONTH, 'Mon YYYY') ORDER BY BOM`);
      monthlyTrend = rows.map((r) => ({
        month: String(r.MONTH),
        homes: numOr(r.HOMES),
        avgRent: numOr(r.AVG_RENT),
        occBom: null, occEom: null, collections: null,
        renewal: null, turnover: null, netTurnCost: null,
      }));
    } catch (e) { console.error("[live] monthly trend failed:", (e as Error).message); }

    // Internal Maintenance gauge (last 4 months, native DW_WO columns).
    // 04_Interal Maintenance = SUM(CLIENT_INVOICE_AMOUNT) closed internal-vendor WOs;
    // gauge excludes the non-maintenance vendor companies; goal = POD*2*2000*4.
    try {
      const [r] = await conn.query<Record<string, unknown>>(`
        WITH w AS ( SELECT * FROM (
${DW_WO_SQL}
) )
        SELECT SUM(CLIENT_INVOICE_AMOUNT) AS IM
        FROM w
        WHERE WORKORDER_STATUS = 'Closed' AND IS_INTERNAL_VENDOR = 'Y'
          AND DATE_TRUNC('month', WO_CLOSED_DATE) >= DATEADD('month', -3, DATE_TRUNC('month', CURRENT_DATE()))
          AND DATE_TRUNC('month', WO_CLOSED_DATE) <= DATE_TRUNC('month', CURRENT_DATE())
          AND COMPANY_NAME NOT IN ('Credit Card Vendor','GE Vendor (Maintenance)','New Builder Warranty Vendor','Lennar Builder Warranty')`);
      const im = numOr(r?.IM);
      const goal = podCount != null ? podCount * 2 * 2000 * 4 : null;
      if (im != null && goal) {
        internalMaintenance = {
          value: im, target: goal, min: 0, max: goal,
          format: "currency", label: "Internal Maintenance",
        };
      }
    } catch (e) { console.error("[live] internal maintenance failed:", (e as Error).message); }
  } finally {
    conn.close();
  }

  return {
    _meta: {
      source: "SNOWFLAKE",
      generatedAt: new Date().toISOString(),
      note: "Live: property KPIs, Property Summary, Active Listings, and monthly Homes/Avg Rent. Gauges & remaining trend columns (collections, renewal, turnover, occupancy %, net turn cost) translate Power BI calculated columns and are being wired + validated against the report.",
    },
    filters: { occupancyStatusExcludes: ["Dispositions"], organizationNameExcludes: [null] },
    kpis,
    gauges: { eomCollections: null, renewal: null, netTurnCost: null, internalMaintenance },
    propertySummary,
    monthlyTrend,
  };
}
