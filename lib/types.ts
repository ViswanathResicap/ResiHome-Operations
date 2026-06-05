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
}

export interface PropertySummaryRow {
  organization: string;
  region: string;
  subdivision: string;
  status: string; // OCCUPANCY_STATUS_SUMMARY
  count: number;
}

export interface MonthlyTrendRow {
  month: string; // e.g. "May 2026"
  homes: number;
  avgRent: number;
  occBom: number; // %
  occEom: number; // %
  collections: number; // %
  renewal: number; // %
  turnover: number; // %
  netTurnCost: number; // $
}

export interface SummaryCache {
  _meta: {
    source: "SAMPLE" | "SNOWFLAKE";
    generatedAt: string;
    note?: string;
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
    eomCollections: GaugeData;
    renewal: GaugeData;
    netTurnCost: GaugeData;
    internalMaintenance: GaugeData;
  } | null;
  propertySummary: PropertySummaryRow[];
  monthlyTrend: MonthlyTrendRow[];
}
