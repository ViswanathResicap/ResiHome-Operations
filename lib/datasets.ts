/**
 * DATA CONTRACT for the Summary page — the single source of truth for every
 * Snowflake field the app consumes.
 *
 * The heavy native queries in lib/generated/sql.ts are the *exact* Power BI
 * mirror (they produce the derived columns we depend on). We never edit those.
 * Instead, each dataset below names the small slice of columns we actually use
 * and `source()` projects only those out of the native query — so the rows
 * pulled into Node are tiny and the data the app relies on is visible at a
 * glance.
 *
 * To ADD a field:    add the column name to the dataset's `cols`, then read it
 *                    in lib/live-summary.ts.
 * To DROP a field:   remove it from `cols` (and its reader).
 * Columns must match the native query's OUTPUT name. Mixed-case / spaced names
 * (e.g. "HF (BOM)") are auto-quoted.
 */
import {
  DW_PROPERTIES_SQL, DW_LISTINGS_SQL, PM_BOM_SQL, DW_WO_SQL,
  DW_TURNS_SQL, DW_MOVEOUT_SQL, DW_DEALS_SQL, DW_OFF_MARKET_SQL,
} from "./generated/sql";

// Quote any identifier that isn't a bare UPPER_SNAKE name (spaces, parens, …).
const ident = (c: string) => (/^[A-Z0-9_]+$/.test(c) ? c : `"${c}"`);

const DATASETS = {
  // Property universe → property tiles, every slicer, occupancy, vs-UW rent, POD goal.
  properties: {
    sql: DW_PROPERTIES_SQL,
    cols: [
      "PROPERTY_KEY", "ORGANIZATION_NAME", "REGION_NAME", "SUBDIVISION",
      "PROPERTY_MANAGER", "PROPERTY_MANAGER_ASSISTANT", "POD",
      "OCCUPANCY_STATUS_SUMMARY", "OCCUPANCY_STATUS_SUMMARYID",
      "FULL_ADDRESS", "CURRENT_RENT", "UNDER_WRITTEN_RENT", "OCCUPANCY_STATUS",
    ],
  },
  // Active rental listings → Active Listings KPI, FMI move-ins.
  listings: {
    sql: DW_LISTINGS_SQL,
    cols: [
      "PROPERTY_KEY", "LISTING_STATUS", "IS_PUBLISHED", "RENT_LIST_HIST_ID",
      "LEASE_START_DATE_BOM", "CURRENT_DEAL_STATUS", "MOST_RECENT_LISTING", "FMI_FLAG",
    ],
  },
  // Month-grain property snapshot → Homes / Avg Rent / occupancy trend.
  pmBom: { sql: PM_BOM_SQL, cols: ["BEG_OF_MONTH", "OCCUPANCY_STATUS", "HBPM_PROPERTYID", "CURRENT_RENT"] },
  // Work orders → Internal Maintenance gauge.
  wo: { sql: DW_WO_SQL, cols: ["CLIENT_INVOICE_AMOUNT", "WORKORDER_STATUS", "IS_INTERNAL_VENDOR", "WO_CLOSED_DATE", "COMPANY_NAME"] },
  // Turns → Net Turn Cost gauge.
  turns: { sql: DW_TURNS_SQL, cols: ["TURN_COMPLETED_BOM", "TKT_COST", "MOVEOUTRECEIPTS_FINAL", "N_LEASE_FROM_DATE"] },
  // Move-in / move-out → Proj-Actual MIs, Net Occupancy Gain, Turnover.
  moveout: {
    sql: DW_MOVEOUT_SQL,
    cols: [
      "TENANT_KEY", "PROPERTY_KEY", "MOVEIN_BOM", "MOVEOUT_BOM", "MOVE_OUT_FORECAST_BOM",
      "MOVEOUT", "EVICITON_AMOD_FLAG", "STRATEGY_NAME",
    ],
  },
  // Deals → Holding Fees KPI.
  deals: { sql: DW_DEALS_SQL, cols: ["EMAIL", "PROPERTY_KEY", "HF (BOM)"] },
  // Off-Market / QC dataset → hero status tiles + detail table on the Off-Market page.
  offMarket: {
    sql: DW_OFF_MARKET_SQL,
    // Column names MUST match the native query's actual OUTPUT casing (verified
    // against SELECT *): most are UPPER_SNAKE; a few are genuinely mixed-case
    // (Transfer_Date, Purchase_Date, Listing_Status_Name, "Purchase Type", the
    // "2_..." QC/WO columns) and are auto-quoted by ident().
    cols: [
      "PROPERTY_KEY", "HBPM_PROPERTY_ID", "REGION_NAME", "ORGANIZATION_KEY", "ORGANIZATION_NAME",
      "PORTFOLIO_NAME", "FULL_ADDRESS", "ADDRESS", "ENTITYID", "SUBDIVISION", "FLOORPLAN", "Purchase Type",
      "OCCUPANCY_STATUS", "OCCUPANCY_STATUS_SUMMARY", "AM_PROPERTY_STATUS",
      "Transfer_Date", "Purchase_Date", "Listing_Status_Name", "LISTINGDATE",
      "REASONOFFMARKETID", "REASONOFFMARKETNAME", "OFFMARKETDATE", "MOVEINREADY", "PM_MIR",
      "PROJECTEDCOMPLETIONDATE", "TODAY",
      "2_AM_QC_Result_Date", "2_AM_QC_Result",
      "2_MM_TKT_Created_Date", "2_MM_WO_Open_Count", "2_MM_WO_Closed_Date", "2_MM_WO_Closed Count",
      "RENTLY_LOCKBOX", "CON_DATE_FW_OR_COMPLETE", "PICTURE_COUNT", "FINAL_WALK_DATE",
      "CABINETS_PRELEASE_DATE", "QC_TRIGGER_DATE", "DRC_CO_DATE",
    ],
  },
} as const;

export type DatasetName = keyof typeof DATASETS;

/** Subquery projecting ONLY the columns we use from the heavy native query. */
export function source(name: DatasetName): string {
  const d = DATASETS[name];
  return `SELECT ${d.cols.map(ident).join(", ")} FROM (\n${d.sql}\n)`;
}

/** Forgiving fallback: the full native query (SELECT *) when a projection fails. */
export function sourceRaw(name: DatasetName): string {
  return `SELECT * FROM (\n${DATASETS[name].sql}\n)`;
}

/** Curated BI views queried directly (already minimal — no native mirror). */
export const VIEWS = {
  collections: "PROD_ANALYTICS.BI_MASTER_DATASETS.MASTER_PM_COLLECTIONS",
  renewalRelease: "PROD_ANALYTICS.BI_MASTER_DATASETS.MASTER_PM_RENEWAL_RELEASE",
} as const;
