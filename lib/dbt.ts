// Shared helpers for the operational tabs (Maintenance, Future Move-In,
// Collections, Renewals, Turnkey) that query the DBT_RESICAP facts directly.
// The old DW_* mirrors and MASTER_PM_* views are stale/deauthorized, so we go
// straight to the facts, applying the same portfolio/org key exclusions used
// across the app (cheap key filters — no heavy property-dim joins needed).

export const DB = "PROD_ANALYTICS.DBT_RESICAP";

/** Org roll-up CASE. `a` = the fact alias; requires `O` (DIM_OWNER_ORGANIZATION) joined on a.ORGANIZATION_KEY. */
export const orgCase = (a: string) => `CASE
  WHEN ${a}.ORGANIZATION_KEY IN (-1,18,26,28,48) THEN 'RP SFR'
  WHEN ${a}.ORGANIZATION_KEY IN (27,50,51,52,54,45,55,53,56,57,66) THEN 'RB DRC'
  WHEN ${a}.ORGANIZATION_KEY IN (58,59) THEN 'Hudson Oak'
  WHEN ${a}.ORGANIZATION_KEY IN (62,63,64,65,68,69) THEN 'Rocklyn Homes'
  WHEN ${a}.ORGANIZATION_KEY IN (61,70,71) THEN 'ROI Property Group'
  WHEN ${a}.ORGANIZATION_KEY IN (72,73,74,75) THEN 'McKinley Homes'
  WHEN ${a}.ORGANIZATION_KEY IN (67) THEN 'Newstar'
  ELSE O.ORGANIZATION_NAME END`;

/** Portfolio/org exclusions (key-based; no PO join needed). `a` = fact alias. */
export const excl = (a: string) =>
  `${a}.PORTFOLIO_KEY NOT IN (223,598,147,102,109,28,603,169,602,170,58,54) AND ${a}.ORGANIZATION_KEY NOT IN (16,17)`;

export const esc = (s: string) => s.replace(/'/g, "''");

// Server-side display formatters → strings (routes return display-ready values).
export const m = (v: unknown) => (v == null || Number.isNaN(Number(v)) ? "—" : `$${Math.round(Number(v)).toLocaleString("en-US")}`);
export const n = (v: unknown) => (v == null || Number.isNaN(Number(v)) ? "—" : Math.round(Number(v)).toLocaleString("en-US"));
export const p = (v: unknown, dp = 1) => (v == null || Number.isNaN(Number(v)) ? "—" : `${Number(v).toFixed(dp)}%`);
export const dec = (v: unknown, dp = 1) => (v == null || Number.isNaN(Number(v)) ? "—" : Number(v).toFixed(dp));
export const d = (v: unknown) => { if (v == null || v === "") return "—"; const x = new Date(v as string); return Number.isNaN(x.getTime()) ? "—" : x.toLocaleDateString("en-US"); };

// Normalized payload every operational-tab route returns; rendered by <TabPage>.
export interface TabKpi { label: string; value: string; tone?: "pos" | "neg" }
export interface TabTable { title: string; blue?: boolean; headers: string[]; aligns?: ("l" | "r")[]; rows: string[][]; note?: string }
export interface TabStub { title: string; note: string }
export interface TabPayload {
  generatedAt: string;
  kpis: TabKpi[];
  tables: TabTable[];
  stubs?: TabStub[];
  filters?: { orgs: string[]; regions: string[] };
  errors?: string[];
}

// Simple 30-min in-memory cache factory (per-route module scope).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function makeCache() { return new Map<string, { at: number; payload: any }>(); }
export const TTL = 30 * 60 * 1000;
