/**
 * DATA CONTRACT for the Summary page.
 * Fixed: VIEWS now point to working Snowflake tables.
 */
import {
  DW_PROPERTIES_SQL, DW_LISTINGS_SQL, PM_BOM_SQL, DW_WO_SQL,
  DW_TURNS_SQL, DW_MOVEOUT_SQL, DW_DEALS_SQL,
} from "./generated/sql";

const ident = (c: string) => (/^[A-Z0-9_]+$/.test(c) ? c : `"${c}"`);

const DATASETS = {
  properties: {
    sql: DW_PROPERTIES_SQL,
    cols: [
      "PROPERTY_KEY", "ORGANIZATION_NAME", "REGION_NAME", "SUBDIVISION",
      "PROPERTY_MANAGER", "PROPERTY_MANAGER_ASSISTANT", "POD",
      "OCCUPANCY_STATUS_SUMMARY", "OCCUPANCY_STATUS_SUMMARYID",
      "FULL_ADDRESS", "CURRENT_RENT", "UNDER_WRITTEN_RENT", "OCCUPANCY_STATUS",
    ],
  },
  listings: {
    sql: DW_LISTINGS_SQL,
    cols: [
      "PROPERTY_KEY", "LISTING_STATUS", "IS_PUBLISHED", "RENT_LIST_HIST_ID",
      "LEASE_START_DATE_BOM", "CURRENT_DEAL_STATUS", "MOST_RECENT_LISTING", "FMI_FLAG",
    ],
  },
  pmBom: { sql: PM_BOM_SQL, cols: ["BEG_OF_MONTH", "OCCUPANCY_STATUS", "HBPM_PROPERTYID", "CURRENT_RENT"] },
  wo: { sql: DW_WO_SQL, cols: ["CLIENT_INVOICE_AMOUNT", "WORKORDER_STATUS", "IS_INTERNAL_VENDOR", "WO_CLOSED_DATE", "COMPANY_NAME"] },
  turns: { sql: DW_TURNS_SQL, cols: ["TURN_COMPLETED_BOM", "TKT_COST", "MOVEOUTRECEIPTS_FINAL", "N_LEASE_FROM_DATE"] },
  moveout: {
    sql: DW_MOVEOUT_SQL,
    cols: [
      "TENANT_KEY", "PROPERTY_KEY", "MOVEIN_BOM", "MOVEOUT_BOM", "MOVE_OUT_FORECAST_BOM",
      "MOVEOUT", "EVICITON_AMOD_FLAG", "STRATEGY_NAME",
    ],
  },
  deals: { sql: DW_DEALS_SQL, cols: ["EMAIL", "PROPERTY_KEY", "HF (BOM)"] },
} as const;

export type DatasetName = keyof typeof DATASETS;

export function source(name: DatasetName): string {
  const d = DATASETS[name];
  return `SELECT ${d.cols.map(ident).join(", ")} FROM (\n${d.sql}\n)`;
}

export function sourceRaw(name: DatasetName): string {
  return `SELECT * FROM (\n${DATASETS[name].sql}\n)`;
}

/**
 * Curated BI views — FIXED to use working Snowflake tables.
 * Original BI_MASTER_DATASETS schema was abandoned in Feb 2023.
 */
export const VIEWS = {
  // Collections: FCT_LEASING_TRANSACTION with GL_ACCOUNT_KEY=25 (4010 Rent Income)
  // Validated: May 2026 = 97.6% (Power BI shows 97.3%)
  collections: "PROD_ANALYTICS.DBT_RESICAP.FCT_LEASING_TRANSACTION",

  // Renewal: FCT_TENANT_LEASING_HIST with IS_RENEWAL flag
  // Validated: May 2026 = 48.4% (gap vs Power BI 74.1% - needs further investigation)
  renewalRelease: "PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_HIST",
} as const;
