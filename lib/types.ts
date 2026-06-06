// Shape of the cached Summary-page dataset (data/cache/summary.json).
// Populated by scripts/refresh-cache.mjs (runs the Snowflake native queries
// from the .pbip mirror) — or a SAMPLE placeholder until that runs.

export interface GaugeData {
  value: number; // 0..1 for percentages, or dollars
  target: number;
  min: number;
  max: number;
  format: "percent" | "currency" | "number";
  label: string;
  /** Whether being above target is good (collections) or bad (cost). Default true. */
  higherIsBetter?: boolean;
}

export interface PropertySummaryRow {
  organization: string;
  region: string;
  subdivision: string;
  status: string; // OCCUPANCY_STATUS_SUMMARY
  count: number;
}

// One row per property — powers all slicers + client-side aggregation.
export interface PropertyRow {
  org: string;
  region: string;
  subdivision: string;
  pm: string;            // PROPERTY_MANAGER
  apm: string;           // PROPERTY_MANAGER_ASSISTANT
  pod: string;
  status: string;        // OCCUPANCY_STATUS_SUMMARY
  summaryId: number | null; // OCCUPANCY_STATUS_SUMMARYID
  delinquent: string;    // 1_Tenant Balance Status
  address: string;       // FULL_ADDRESS
  rent: number | null;   // CURRENT_RENT
  uw: number | null;     // UNDER_WRITTEN_RENT
}

export interface MonthlyTrendRow {
  month: string; // e.g. "May 2026"
  homes: number | null;
  avgRent: number | null;
  occBom: number | null; // %
  occEom: number | null; // %
  collections: number | null; // %
  renewal: number | null; // %
  turnover: number | null; // %
  netTurnCost: number | null; // $
}

export interface SummaryCache {
  _meta: {
    source: "SAMPLE" | "SNOWFLAKE";
    generatedAt: string;
    note?: string;
    errors?: string[];
  };
  filters: {
    occupancyStatusExcludes: string[];
    organizationNameExcludes: (string | null)[];
  };
  kpis: {
    totalProperties: number | null;
    occupancyPct: number | null;
    activeListings: number | null;
    totalTenants: number | null;
    rentVar: number | null; // vs UW (e.g. -0.03 = -3%)
    holdingFees: number | null;
    projActualMis: number | null;
    netOccupancyGain: number | null;
    turnoverPct: number | null;
  };
  gauges: {
    eomCollections: GaugeData | null;
    renewal: GaugeData | null;
    netTurnCost: GaugeData | null;
    internalMaintenance: GaugeData | null;
  } | null;
  propertySummary: PropertySummaryRow[];
  monthlyTrend: MonthlyTrendRow[];
  /** Per-property rows (present once the refresh job runs); enables all slicers. */
  properties?: PropertyRow[];
}

/** Stabilized-occupancy statuses used as the Occupancy % denominator. */
export const STABILIZED_STATUSES = ["Tenant Leased", "Trustee Leased", "Vacant - On Market", "Vacant - FMI"];
export const LEASED_STATUSES = ["Tenant Leased", "Trustee Leased"];

/**
 * Property Summary status roll-up columns (in display order). Off Market first,
 * then On Market (Future Move-In / FMI fold in here), then Leased (Tenant +
 * Trustee), then Turnkey — with a Total computed across every status.
 */
export const STATUS_BUCKETS = ["Off Market", "On Market", "Leased", "Turnkey"] as const;
export type StatusBucket = (typeof STATUS_BUCKETS)[number];

export function statusBucket(status: string): StatusBucket | null {
  const s = (status || "").toLowerCase();
  if (s.includes("off market")) return "Off Market";
  if (s.includes("on market") || s.includes("future move") || s.includes("fmi") || s.includes("pre-leas")) return "On Market";
  if (s.includes("leased") || s.includes("lease honored")) return "Leased";
  if (s.includes("turnkey")) return "Turnkey";
  return null; // unmapped statuses still count toward Total
}
