import { connect } from "./snowflake";
import { DW_PROPERTIES_SQL, DW_LISTINGS_SQL } from "./generated/sql";
import type { SummaryCache, PropertySummaryRow } from "./types";

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

  try {
    // Property-level KPIs (match the card measures over DW_Properties).
    try {
      const [r] = await conn.query<Record<string, unknown>>(`
        WITH p AS ( SELECT * FROM ( ${DW_PROPERTIES_SQL} ) )
        SELECT
          COUNT(DISTINCT PROPERTY_KEY) AS TOTAL_PROPERTIES,
          DIV0( COUNT(DISTINCT IFF(OCCUPANCY_STATUS_SUMMARYID IN (7,8), PROPERTY_KEY, NULL)),
                COUNT(DISTINCT IFF(OCCUPANCY_STATUS_SUMMARYID IS NOT NULL, PROPERTY_KEY, NULL)) ) AS OCCUPANCY_PCT,
          COUNT(DISTINCT IFF(OCCUPANCY_STATUS IN ('Tenant Leased','Trustee Leased'), PROPERTY_KEY, NULL)) AS TOTAL_TENANTS,
          DIV0( SUM(IFF(CURRENT_RENT IS NOT NULL AND UNDER_WRITTEN_RENT IS NOT NULL, CURRENT_RENT, NULL)),
                SUM(IFF(CURRENT_RENT IS NOT NULL AND UNDER_WRITTEN_RENT IS NOT NULL, UNDER_WRITTEN_RENT, NULL)) ) - 1 AS RENT_VAR
        FROM p WHERE ${PAGE_FILTER}`);
      kpis.totalProperties = numOr(r?.TOTAL_PROPERTIES);
      kpis.occupancyPct = numOr(r?.OCCUPANCY_PCT);
      kpis.totalTenants = numOr(r?.TOTAL_TENANTS);
      kpis.rentVar = numOr(r?.RENT_VAR);
    } catch (e) { console.error("[live] property KPIs failed:", (e as Error).message); }

    // Property Summary pivot source (Organization x occupancy status).
    try {
      const rows = await conn.query<Record<string, unknown>>(`
        WITH p AS ( SELECT * FROM ( ${DW_PROPERTIES_SQL} ) )
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
        WITH l AS ( SELECT * FROM ( ${DW_LISTINGS_SQL} ) )
        SELECT COUNT(DISTINCT PROPERTY_KEY) AS ACTIVE_LISTINGS
        FROM l WHERE LISTING_STATUS = 'Active' AND IS_PUBLISHED = 'Y'`);
      kpis.activeListings = numOr(r?.ACTIVE_LISTINGS);
    } catch (e) { console.error("[live] active listings failed:", (e as Error).message); }
  } finally {
    conn.close();
  }

  return {
    _meta: {
      source: "SNOWFLAKE",
      generatedAt: new Date().toISOString(),
      note: "Live property metrics. Leasing/turnover gauges & monthly trend pending (0_Month/DW_Listings measure wiring).",
    },
    filters: { occupancyStatusExcludes: ["Dispositions"], organizationNameExcludes: [null] },
    kpis,
    gauges: null,
    propertySummary,
    monthlyTrend: [],
  };
}
