"use client";

// Power BI-fidelity Summary page. Consumes the rich /api/summary-v2 payload
// (server-side filtered by month/org/region/status) and renders every section
// of the published "Portfolio Summary" report page: Portfolio Summary + Map,
// KPI gauges, Portfolio Metrics, org matrix, monthly trend, Days Occupied,
// DRC LTO / Conversion, Tenant Leased Demographics, All Property Export.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { getCachedPayload, setCachedPayload } from "@/lib/client-cache";
import { PropertyMap } from "./PropertyMap";

/* ----------------------------- payload types ----------------------------- */
type Num = number | null;
interface RegRow { region: string; vacantOff: number; vacantOn: number; vacantFMI: number; trustee: number; tenant: number; turnkey: number; total: number }
interface OrgRow { org: string; avgRent: Num; offMarket: number; onMarket: number; leased: number; turnkey: number; total: number; bomOcc: Num; eomOcc: Num }
interface TrendRow { month: string; homes: Num; avgRent: Num; bomOcc: Num; netOccGain: Num; eomOcc: Num; hfPullThru: Num; bomVacantLeased: Num; collections: Num; retention: Num; turnover: Num; renewal: Num; renewalRentGrowth: Num; releaseRentGrowth: Num; blendedRentGrowth: Num; spend90: Num; netTurnCost: Num }
interface DrcLtoRow { community: string; type: string; entityId: string; address: string; floorplan: string; newLeaseStart: string; sqft: Num; currentRent: Num; newRent: Num; rentGrowth: Num }
interface DrcConvRow { community: string; month: string; l: Num; hf: Num; al: Num; appr: Num; apprPct: Num }
interface DemoRow { region: string; tenants: Num; mtm: Num; bed: Num; bath: Num; sqft: Num; uwRent: Num; rent: Num; rentVar: Num; rentPerSqft: Num; timeInHome: Num }
interface PropRow { entityId: string; region: string; address: string; bed: Num; bath: Num; sqft: Num; subdivision: string; floorplan: string; county: string; propertyStatus: string; tenantStatus: string; tenantName: string }
// Org > Region > Subdivision > Floorplan hierarchy (from summary-v2 orgSubMap).
// NodeMetrics = measures the backend rolls up per node (ratios recomputed from
// summed components); occupancy/rent are aggregated on the client from leaves.
interface NodeMetrics { collections: Num; turnover: Num; renewal: Num; renewalRentGrowth: Num; releaseRentGrowth: Num; blendedRentGrowth: Num; spend90: Num }
interface FPNode { floorplan: string; homes: number; avgRent: Num; bomOcc: Num; eomOcc: Num; netOccGain: number; m: NodeMetrics }
interface SubNode { subdivision: string; homes: number; avgRent: Num; bomOcc: Num; eomOcc: Num; netOccGain: number; floorplans: FPNode[]; m?: NodeMetrics }
interface RegNode { region: string; homes: number; avgRent: Num; bomOcc: Num; eomOcc: Num; netOccGain: number; subdivisions: SubNode[]; m?: NodeMetrics }
type OrgTree = Record<string, RegNode[]>;
interface V2 {
  generatedAt: string; selectedMonth: string; errors?: string[];
  heroKpis: { totalProperties: number; occupancyPct: Num; activeListings: number };
  eomOccupancy: Num; eomCollections: Num; renewal: Num; bomListingsLeased: Num;
  woCycleTime: Num; netTurnCost: Num; runRateSpend: Num; internalMaintenance: Num; holdingFees: number;
  portfolioMetrics: { bomListings: Num; bomVacant: Num; holdingFees: Num; actualMIs: Num; actualMOs: Num; netOccGain: Num; turnoverPct: Num };
  regionRows: RegRow[]; orgSummary: OrgRow[]; monthlyTrend: TrendRow[]; orgSubMap: OrgTree; orgMetrics: Record<string, NodeMetrics>;
  drcLto: DrcLtoRow[]; drcConversion: DrcConvRow[]; daysOccupied: { month: string; avgDaysOcc: Num }[];
  tenantDemographics: DemoRow[]; tenantSummary: { totalTenants: number; avgVsUwRent: Num };
  allProperties: PropRow[];
}

/* ------------------------------- formatters ------------------------------- */
const fnum = (v: Num) => (v == null ? "—" : Math.round(Number(v)).toLocaleString("en-US"));
const fpct = (v: Num) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);
const fmoney = (v: Num) => (v == null ? "—" : `$${Math.round(Number(v)).toLocaleString("en-US")}`);
const fmoney2 = (v: Num) => (v == null ? "—" : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fdec = (v: Num, d = 1) => (v == null ? "—" : Number(v).toFixed(d));
const fdate = (v: string) => (v ? new Date(v).toLocaleDateString("en-US") : "—");

/* Last N month labels ("Mon YYYY"), newest first, INCLUDING the current month. */
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function recentMonths(n = 12): string[] {
  const d = new Date(); d.setDate(1); // current month
  const out: string[] = [];
  for (let i = 0; i < n; i++) { out.push(`${MON[d.getMonth()]} ${d.getFullYear()}`); d.setMonth(d.getMonth() - 1); }
  return out;
}

/* --------------------------------- gauge ---------------------------------- */
type GaugeCfg = { label: string; value: Num; min: number; max: number; target: number; fmt: (v: Num) => string; higherIsBetter: boolean };
function Gauge({ g }: { g: GaugeCfg }) {
  const R = 60, CX = 78, CY = 74, W = 12;
  const span = g.max - g.min || 1;
  const clamp = (v: number) => Math.max(0, Math.min(1, (v - g.min) / span));
  const toXY = (f: number) => { const a = Math.PI * (1 - f); return [CX + R * Math.cos(a), CY - R * Math.sin(a)]; };
  const arc = (f0: number, f1: number) => { const [x0, y0] = toXY(f0), [x1, y1] = toXY(f1); return `M ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1}`; };
  if (g.value == null) {
    return (<div className="p-gauge"><div className="title">{g.label}</div>
      <svg viewBox="0 0 156 88" width="100%" height="82" aria-hidden><path d={arc(0, 1)} stroke="#ececec" strokeWidth={W} fill="none" strokeLinecap="round" /></svg>
      <div className="target">—</div></div>);
  }
  const a = clamp(Number(g.value)), t = clamp(g.target);
  const onTarget = g.higherIsBetter ? Number(g.value) >= g.target : Number(g.value) <= g.target;
  const col = onTarget ? "var(--p-good)" : "var(--p-bad)";
  const [tx, ty] = toXY(t), [ix, iy] = toXY(Math.max(0, t - 0.004));
  return (
    <div className="p-gauge">
      <div className="title">{g.label}</div>
      <svg viewBox="0 0 156 88" width="100%" height="82" role="img" aria-label={g.label}>
        <path d={arc(0, 1)} stroke="#e6e6e6" strokeWidth={W} fill="none" strokeLinecap="round" />
        <path d={arc(0, a)} stroke={col} strokeWidth={W} fill="none" strokeLinecap="round" />
        <line x1={ix} y1={iy} x2={tx} y2={ty} stroke="#201f1e" strokeWidth={3} />
      </svg>
      <div className="readout" style={{ color: col }}>{g.fmt(g.value)}</div>
      <div className="target">Target {g.fmt(g.target)}</div>
    </div>
  );
}

/* ------------------------------ table helper ------------------------------ */
type Col<T> = { key: keyof T | string; label: string; lbl?: boolean; fmt?: (v: unknown, row: T) => string; cls?: (v: unknown, row: T) => string };
function Tbl<T>({ cols, rows, blue, max, title, foot }: {
  cols: Col<T>[]; rows: T[]; blue?: boolean; max?: number; title?: string; foot?: (rows: T[]) => (string | number)[] | null;
}) {
  const shown = max ? rows.slice(0, max) : rows;
  const footVals = foot ? foot(rows) : null;
  return (
    <div>
      {title && <div className="p-tbl-title">{title}</div>}
      <div className="p-tbl-wrap">
        <table className={`p-tbl${blue ? " blue" : ""}`}>
          <thead><tr>{cols.map((c) => <th key={String(c.key)} className={c.lbl ? "lbl" : undefined}>{c.label}</th>)}</tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => {
                  const v = (r as Record<string, unknown>)[c.key as string];
                  return <td key={String(c.key)} className={[c.lbl ? "lbl" : "", c.cls ? c.cls(v, r) : ""].filter(Boolean).join(" ") || undefined}>
                    {c.fmt ? c.fmt(v, r) : (v == null || v === "" ? "—" : String(v))}
                  </td>;
                })}
              </tr>
            ))}
            {!shown.length && <tr><td className="lbl" colSpan={cols.length} style={{ color: "var(--p-muted)" }}>No rows.</td></tr>}
          </tbody>
          {footVals && <tfoot><tr>{footVals.map((v, i) => <td key={i} className={i === 0 ? "lbl" : undefined}>{v}</td>)}</tr></tfoot>}
        </table>
      </div>
      {max && rows.length > max && <div style={{ fontSize: 11, color: "var(--p-muted)", marginTop: 4 }}>Showing {max.toLocaleString()} of {rows.length.toLocaleString()} rows.</div>}
    </div>
  );
}

const negRentVar = (v: unknown) => (v != null && Number(v) < 0 ? "neg" : Number(v) > 0 ? "pos" : "");

// Shared "Portfolio Metrics" column set — identical for the by-Organization and
// by-Month tables (matches Power BI images 2 & 3 exactly). `lead` is the row
// grouping column (organization name / month). Cells with no value render "—".
function metricCols<T>(leadKey: string, leadLabel: string): Col<T>[] {
  const pc = (v: unknown) => fpct(v as Num);
  const mo = (v: unknown) => fmoney(v as Num);
  const nu = (v: unknown) => fnum(v as Num);
  return [
    { key: leadKey, label: leadLabel, lbl: true },
    { key: "homes", label: "Homes", fmt: nu },
    { key: "avgRent", label: "Avg Rent", fmt: mo },
    { key: "bomOcc", label: "BOM Occ", fmt: pc },
    { key: "netOccGain", label: "Net Occ Gain", fmt: nu },
    { key: "eomOcc", label: "EOM Occ", fmt: pc },
    { key: "hfPullThru", label: "HF Pull-Thru", fmt: pc },
    { key: "bomVacantLeased", label: "BOM Vacant Leased", fmt: pc },
    { key: "collections", label: "EOM Collections", fmt: pc },
    { key: "retention", label: "Retention", fmt: pc },
    { key: "turnover", label: "Turnover", fmt: pc },
    { key: "renewal", label: "Renewal", fmt: pc },
    { key: "renewalRentGrowth", label: "Renewal Rent Growth", fmt: pc, cls: negRentVar },
    { key: "releaseRentGrowth", label: "Release Rent Growth", fmt: pc, cls: negRentVar },
    { key: "blendedRentGrowth", label: "Blended Rent Growth", fmt: pc, cls: negRentVar },
    { key: "spend90", label: "90+ Maint. Spend", fmt: mo },
    { key: "netTurnCost", label: "Net Turn Cost", fmt: mo },
  ];
}

/* --------------------------------- view ----------------------------------- */
export function SummaryView() {
  // Dynamic last-4 complete months (newest first); radio picker, default newest.
  const months = useMemo(() => recentMonths(4), []);
  const [month, setMonth] = useState(months[0]);
  const [org, setOrg] = useState("");
  const [region, setRegion] = useState("");
  const [status, setStatus] = useState("");
  const [subdivision, setSubdivision] = useState("");
  const [mgr, setMgr] = useState("");
  const [search, setSearch] = useState("");       // committed address search
  const [searchInput, setSearchInput] = useState(""); // live text box value
  const [d, setD] = useState<V2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // Slicer option lists (subdivisions, property managers) from /api/filters.
  const [opts, setOpts] = useState<{ subdivisions: string[]; propertyManagers: string[] }>({ subdivisions: [], propertyManagers: [] });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/filters", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled && !j.error) setOpts({ subdivisions: j.subdivisions ?? [], propertyManagers: j.propertyManagers ?? [] }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async (force = false) => {
    const qs = new URLSearchParams({ month });
    if (org) qs.set("org", org);
    if (region) qs.set("region", region);
    if (status) qs.set("status", status);
    if (subdivision) qs.set("subdivision", subdivision);
    if (mgr) qs.set("pm", mgr);
    if (search) qs.set("q", search);
    const key = `/api/summary-v2?${qs.toString()}`;
    // Show any cached copy instantly, then refresh in the background.
    const cached = getCachedPayload<V2>(key);
    if (cached && !force) { setD(cached); setLoading(false); } else { setLoading(true); }
    setErr(null);
    try {
      const r = await fetch(key, force ? { cache: "no-store" } : undefined);
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
      setCachedPayload(key, j);
      setD(j as V2);
    } catch (e) { if (!cached) setErr((e as Error).message); } finally { setLoading(false); }
  }, [month, org, region, status, subdivision, mgr, search]);
  useEffect(() => { load(); }, [load]);

  // Occupancy statuses for the Property Status slicer (matches PBI options).
  const STATUS_OPTS = ["Tenant Leased", "Trustee Leased", "Vacant - On Market", "Vacant - Off Market", "Vacant - FMI", "Under Turnkey", "Under Construction", "Pending MOI/Rekey"];

  const orgOpts = useMemo(() => (d?.orgSummary ?? []).map((o) => o.org).filter((o) => o && o !== "Total"), [d]);
  const regionOpts = useMemo(() => (d?.regionRows ?? []).map((r) => r.region).filter((r) => r && r !== "Total"), [d]);

  const gauges: GaugeCfg[] = d ? [
    { label: "BOM Occupancy", value: d.eomOccupancy, min: 50, max: 100, target: 90, fmt: fpct, higherIsBetter: true },
    { label: "EOM Collections", value: d.eomCollections, min: 80, max: 100, target: 95.5, fmt: fpct, higherIsBetter: true },
    { label: "Renewal", value: d.renewal, min: 0, max: 100, target: 75, fmt: fpct, higherIsBetter: true },
    { label: "BOM Listings Leased", value: d.bomListingsLeased, min: 0, max: 100, target: 50, fmt: fpct, higherIsBetter: true },
    { label: "W/O Cycle Time", value: d.woCycleTime, min: 0, max: 20, target: 10, fmt: (v) => fdec(v, 1), higherIsBetter: false },
    { label: "Net Turn Cost (All)", value: d.netTurnCost, min: 1000, max: 3000, target: 1750, fmt: fmoney, higherIsBetter: false },
    { label: "45+ Run Rate Spend", value: d.runRateSpend, min: 1000, max: 2500, target: 1700, fmt: fmoney, higherIsBetter: false },
    { label: "Internal Maintenance", value: d.internalMaintenance, min: 0, max: Math.max(Number(d.internalMaintenance) || 0, 80000) * 1.1, target: 64000, fmt: fmoney, higherIsBetter: false },
  ] : [];

  const pm = d?.portfolioMetrics;

  return (
    <div className="app pbi">
      <aside className="rail">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo" src="/resihome-logo.png" alt="ResiHome" />
        <div className="slicer"><h4>Organization</h4>
          <select className="control dd-input" value={org} onChange={(e) => setOrg(e.target.value)}>
            <option value="">All</option>{orgOpts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select></div>
        <div className="slicer"><h4>Region</h4>
          <select className="control dd-input" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All</option>{regionOpts.map((r) => <option key={r} value={r}>{r}</option>)}
          </select></div>
        <div className="slicer"><h4>Subdivision</h4>
          <select className="control dd-input" value={subdivision} onChange={(e) => setSubdivision(e.target.value)}>
            <option value="">All</option>{opts.subdivisions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div className="slicer"><h4>Property Status</h4>
          <select className="control dd-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>{STATUS_OPTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select></div>
        <div className="slicer"><h4>Property Manager</h4>
          <select className="control dd-input" value={mgr} onChange={(e) => setMgr(e.target.value)}>
            <option value="">All</option>{opts.propertyManagers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select></div>
        <div className="slicer"><h4>Address Search</h4>
          <input className="control dd-input" placeholder="Address or Entity ID…" value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") setSearch(searchInput.trim()); }}
            onBlur={() => setSearch(searchInput.trim())} />
          {search && <div className="dd-hint">Filtering “{search}”</div>}</div>
        <div className="slicer"><h4>Month</h4>
          <div className="month-radios">
            {[...months].reverse().map((m) => (
              <label key={m} className={`month-opt${m === month ? " on" : ""}`}>
                <input type="radio" name="sum-month" checked={m === month} onChange={() => setMonth(m)} /> {m}
              </label>
            ))}
          </div>
        </div>
        {(org || region || status || subdivision || mgr || search) && <button className="dd-clear" onClick={() => { setOrg(""); setRegion(""); setStatus(""); setSubdivision(""); setMgr(""); setSearch(""); setSearchInput(""); }}>Clear filters ✕</button>}
      </aside>

      <main className="canvas">
        <div className="pagehead">
          <h1>Summary</h1>
          <div className="ctx">
            {d ? `Live · Snowflake · ${d.selectedMonth} · updated ${new Date(d.generatedAt).toLocaleString("en-US")}` : "Loading…"}
            {loading && <span className="refresh-pill"><span className="spin">↻</span> loading…</span>}
            <button className="refresh-btn" onClick={() => load(true)} aria-busy={loading}><span className={loading ? "spin" : ""}>↻</span> Refresh</button>
          </div>
        </div>
        {loading && <div className="refresh-bar" aria-hidden />}
        {err && <div className="banner">Couldn’t load live data: {err}</div>}
        {d?.errors?.length ? <div className="banner">Some measures returned errors: {d.errors[0]}{d.errors.length > 1 ? ` (+${d.errors.length - 1} more)` : ""}</div> : null}

        {!d && loading && <div className="p-loading">Loading live Snowflake data for {month}…</div>}

        {d && (<>
          {/* ── Portfolio Summary ── */}
          <div className="p-h1 u">Portfolio Summary</div>
          <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 14, alignItems: "start" }}>
            <div>
              <div className="p-grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
                <div className="p-card"><div className="v">{fnum(d.heroKpis.totalProperties)}</div><div className="l">Total Properties</div></div>
                <div className="p-card"><div className="v">{fpct(d.heroKpis.occupancyPct)}</div><div className="l">Occupancy %</div></div>
                <div className="p-card"><div className="v">{fnum(d.heroKpis.activeListings)}</div><div className="l">Active Listings</div></div>
              </div>
              <div style={{ marginTop: 10 }}>
                <Tbl<RegRow> cols={[
                  { key: "region", label: "Region", lbl: true },
                  { key: "vacantOff", label: "Vacant - Off Market", fmt: (v) => fnum(v as Num) },
                  { key: "vacantOn", label: "Vacant - On Market", fmt: (v) => fnum(v as Num) },
                  { key: "vacantFMI", label: "Vacant - FMI", fmt: (v) => fnum(v as Num) },
                  { key: "trustee", label: "Trustee Leased", fmt: (v) => fnum(v as Num) },
                  { key: "tenant", label: "Tenant Leased", fmt: (v) => fnum(v as Num) },
                  { key: "turnkey", label: "Turnkey", fmt: (v) => fnum(v as Num) },
                  { key: "total", label: "Total", fmt: (v) => fnum(v as Num) },
                ]} rows={d.regionRows}
                  foot={(rows) => ["Total", ...(["vacantOff", "vacantOn", "vacantFMI", "trustee", "tenant", "turnkey", "total"] as const).map((k) => fnum(rows.reduce((s, r) => s + (r[k] || 0), 0)))]} />
              </div>
            </div>
            <div>
              <div className="p-h2" style={{ marginTop: 0 }}>Property Map</div>
              <PropertyMap regions={d.regionRows} />
            </div>
          </div>

          {/* ── KPIs ── */}
          <div className="p-h2">KPIs</div>
          <div className="p-grid" style={{ gridTemplateColumns: "repeat(8,1fr)" }}>
            {gauges.map((g) => <Gauge key={g.label} g={g} />)}
          </div>

          {/* ── Portfolio Metrics ── */}
          <div className="p-h2">Portfolio Metrics — {d.selectedMonth}</div>
          <div className="p-grid" style={{ gridTemplateColumns: "repeat(7,1fr)" }}>
            <div className="p-card sm"><div className="v">{fnum(pm?.bomListings ?? null)}</div><div className="l">BOM Listings</div></div>
            <div className="p-card sm"><div className="v">{fnum(pm?.bomVacant ?? null)}</div><div className="l">BOM Vacant</div></div>
            <div className="p-card sm"><div className="v">{fnum(pm?.holdingFees ?? d.holdingFees)}</div><div className="l">Holding Fees</div></div>
            <div className="p-card sm"><div className="v">{fnum(pm?.actualMIs ?? null)}</div><div className="l">Proj / Actual MIs</div></div>
            <div className="p-card sm"><div className="v">{fnum(pm?.actualMOs ?? null)}</div><div className="l">Proj / Actual MOs</div></div>
            <div className="p-card sm"><div className="v">{fnum(pm?.netOccGain ?? null)}</div><div className="l">Net Occupancy Gain</div></div>
            <div className="p-card sm"><div className="v">{fpct(pm?.turnoverPct ?? null)}</div><div className="l">Turnover %</div></div>
          </div>

          {/* ── Portfolio Metrics by Organization ── */}
          <div className="p-h2">Portfolio Metrics by Organization</div>
          <OrgMetricsTable tree={d.orgSubMap ?? {}} orgMetrics={d.orgMetrics ?? {}} order={(d.orgSummary ?? []).map((o) => o.org).filter((o) => o && o !== "Total")} />

          {/* ── Portfolio Metrics by Month ── */}
          <div className="p-h2">Portfolio Metrics by Month</div>
          <Tbl<TrendRow> blue cols={metricCols<TrendRow>("month", "Month")} rows={d.monthlyTrend} />

          {/* ── Days Occupied + DRC ── */}
          <div className="p-grid" style={{ gridTemplateColumns: "1fr 1.15fr 1fr", marginTop: 18, alignItems: "start" }}>
            <div className="p-panel">
              <div className="ph">Days Occupied</div>
              <DaysOccupied rows={d.daysOccupied} />
            </div>
            <DrcLtoTable rows={d.drcLto} />
            <DrcConvTable rows={d.drcConversion} />
          </div>

          {/* ── Tenant Leased Demographics ── */}
          <div className="p-h1">Tenant Leased Demographics</div>
          <div className="p-grid" style={{ gridTemplateColumns: "repeat(6,1fr)", marginBottom: 10 }}>
            <div className="p-card"><div className="v">{fnum(d.tenantSummary.totalTenants)}</div><div className="l">Total Tenants</div></div>
            <div className="p-card"><div className={`v ${d.tenantSummary.avgVsUwRent != null && d.tenantSummary.avgVsUwRent < 0 ? "bad" : "good"}`}>{fpct(d.tenantSummary.avgVsUwRent)}</div><div className="l">vs. UW Rent</div></div>
          </div>
          <Tbl<DemoRow> cols={[
            { key: "region", label: "Region", lbl: true },
            { key: "tenants", label: "Tenants", fmt: (v) => fnum(v as Num) },
            { key: "mtm", label: "MTM", fmt: (v) => fnum(v as Num) },
            { key: "bed", label: "Bed", fmt: (v) => fdec(v as Num, 1) },
            { key: "bath", label: "Bath", fmt: (v) => fdec(v as Num, 1) },
            { key: "sqft", label: "Sqft", fmt: (v) => fnum(v as Num) },
            { key: "uwRent", label: "UW Rent", fmt: (v) => fmoney(v as Num) },
            { key: "rent", label: "Rent", fmt: (v) => fmoney(v as Num) },
            { key: "rentVar", label: "Rent Var", fmt: (v) => fpct(v as Num), cls: negRentVar },
            { key: "rentPerSqft", label: "Rent/Sqft", fmt: (v) => fmoney2(v as Num) },
            { key: "timeInHome", label: "Days In Home", fmt: (v) => fnum(v as Num) },
          ]} rows={d.tenantDemographics} />

          {/* ── All Property Export ── */}
          <div className="p-h1">All Property Export</div>
          <Tbl<PropRow> max={300} cols={[
            { key: "address", label: "Address", lbl: true },
            { key: "bed", label: "Bed", fmt: (v) => fdec(v as Num, 0) },
            { key: "bath", label: "Bath", fmt: (v) => fdec(v as Num, 1) },
            { key: "sqft", label: "Sqft", fmt: (v) => fnum(v as Num) },
            { key: "subdivision", label: "Subdivision", lbl: true },
            { key: "floorplan", label: "Floorplan", lbl: true },
            { key: "county", label: "County", lbl: true },
            { key: "pmAssigned", label: "PM Assigned", lbl: true },
            { key: "apm", label: "APM Assigned", lbl: true },
            { key: "propertyStatus", label: "Property Status", lbl: true },
            { key: "rrq", label: "RRQC", lbl: true },
            { key: "tenantStatus", label: "Tenant Status", lbl: true },
            { key: "tenantName", label: "Tenant Name", lbl: true },
            { key: "allTenantEmails", label: "All Tenant Emails", lbl: true },
            { key: "evictionStatus", label: "Eviction Status", lbl: true },
            { key: "listDate", label: "List Date", fmt: (v) => fdate(v as string) },
            { key: "leaseStart", label: "Lease Start", fmt: (v) => fdate(v as string) },
            { key: "leaseEnd", label: "Lease End", fmt: (v) => fdate(v as string) },
            { key: "rent", label: "Rent", fmt: (v) => fmoney(v as Num) },
          ]} rows={d.allProperties} />
        </>)}
      </main>
    </div>
  );
}

/* Portfolio Metrics by Organization — expandable Org › Region › Subdivision ›
   Floorplan matrix. The backend computes Homes, Avg Rent, BOM/EOM Occ and Net
   Occ Gain per node; those roll up home-weighted. Measures the backend doesn't
   yet compute per node render as "—" (same as the previous flat table). */
type MetricAgg = { homes: number; avgRent: Num; bomOcc: Num; netOccGain: number; eomOcc: Num };
const EMPTY_M: NodeMetrics = { collections: null, turnover: null, renewal: null, renewalRentGrowth: null, releaseRentGrowth: null, blendedRentGrowth: null, spend90: null };
function OrgMetricsTable({ tree, order, orgMetrics }: { tree: OrgTree; order: string[]; orgMetrics: Record<string, NodeMetrics> }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const tog = (k: string) => setOpen((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const labels = metricCols<OrgRow>("org", "Organization").map((c) => c.label);

  // Home-weighted average of a percentage/rent metric over a set of leaves.
  const wavg = (ls: FPNode[], pick: (l: FPNode) => Num): Num => {
    let num = 0, den = 0;
    for (const l of ls) { const v = pick(l); if (v != null && l.homes > 0) { num += Number(v) * l.homes; den += l.homes; } }
    return den ? num / den : null;
  };
  const subFPs = (s: SubNode): FPNode[] =>
    s.floorplans.length ? s.floorplans : [{ floorplan: s.subdivision, homes: s.homes, avgRent: s.avgRent, bomOcc: s.bomOcc, eomOcc: s.eomOcc, netOccGain: s.netOccGain, m: s.m ?? EMPTY_M }];
  const regFPs = (r: RegNode): FPNode[] => r.subdivisions.flatMap(subFPs);
  const mk = (homes: number, netOccGain: number, ls: FPNode[]): MetricAgg =>
    ({ homes, netOccGain, avgRent: wavg(ls, (l) => l.avgRent), bomOcc: wavg(ls, (l) => l.bomOcc), eomOcc: wavg(ls, (l) => l.eomOcc) });

  // Occupancy/rent from the client-side rollup (a); measures from the node (m).
  // Column order matches metricCols; the 4 un-computed measures render "—".
  const cells = (a: MetricAgg, m: NodeMetrics | undefined) => (<>
    <td>{fnum(a.homes)}</td><td>{fmoney(a.avgRent)}</td><td>{fpct(a.bomOcc)}</td><td>{fnum(a.netOccGain)}</td><td>{fpct(a.eomOcc)}</td>
    <td>—</td><td>—</td>
    <td>{fpct(m?.collections ?? null)}</td>
    <td>—</td>
    <td>{fpct(m?.turnover ?? null)}</td>
    <td>{fpct(m?.renewal ?? null)}</td>
    <td className={negRentVar(m?.renewalRentGrowth)}>{fpct(m?.renewalRentGrowth ?? null)}</td>
    <td className={negRentVar(m?.releaseRentGrowth)}>{fpct(m?.releaseRentGrowth ?? null)}</td>
    <td className={negRentVar(m?.blendedRentGrowth)}>{fpct(m?.blendedRentGrowth ?? null)}</td>
    <td>{fmoney(m?.spend90 ?? null)}</td>
    <td>—</td>
  </>);

  const rows: ReactNode[] = [];
  for (const org of order) {
    const regs = tree[org]; if (!regs || !regs.length) continue;
    const oKey = `o:${org}`, oOpen = open.has(oKey);
    const oHomes = regs.reduce((s, r) => s + r.homes, 0), oGain = regs.reduce((s, r) => s + r.netOccGain, 0);
    rows.push(
      <tr key={oKey} className="tree lvl0" onClick={() => tog(oKey)}>
        <td className="lbl"><span className="drc-tog">{oOpen ? "−" : "+"}</span>{org}</td>{cells(mk(oHomes, oGain, regs.flatMap(regFPs)), orgMetrics[org])}
      </tr>,
    );
    if (!oOpen) continue;
    for (const reg of regs) {
      const rKey = `${oKey}|r:${reg.region}`, rOpen = open.has(rKey), rHasKids = reg.subdivisions.length > 0;
      rows.push(
        <tr key={rKey} className="tree lvl1" onClick={rHasKids ? () => tog(rKey) : undefined}>
          <td className="lbl" style={{ paddingLeft: 22 }}>{rHasKids && <span className="drc-tog">{rOpen ? "−" : "+"}</span>}{reg.region || "—"}</td>
          {cells(mk(reg.homes, reg.netOccGain, regFPs(reg)), reg.m)}
        </tr>,
      );
      if (!rOpen) continue;
      for (const sub of reg.subdivisions) {
        const sKey = `${rKey}|s:${sub.subdivision}`, sOpen = open.has(sKey), sHasKids = sub.floorplans.length > 0;
        rows.push(
          <tr key={sKey} className="tree lvl2" onClick={sHasKids ? () => tog(sKey) : undefined}>
            <td className="lbl" style={{ paddingLeft: 40 }}>{sHasKids && <span className="drc-tog">{sOpen ? "−" : "+"}</span>}{sub.subdivision || "—"}</td>
            {cells(mk(sub.homes, sub.netOccGain, subFPs(sub)), sub.m)}
          </tr>,
        );
        if (!sOpen) continue;
        for (let i = 0; i < sub.floorplans.length; i++) { const fp = sub.floorplans[i];
          rows.push(
            <tr key={`${sKey}|f:${i}`} className="tree lvl3">
              <td className="lbl" style={{ paddingLeft: 58 }}>{fp.floorplan || "—"}</td>
              {cells({ homes: fp.homes, avgRent: fp.avgRent, bomOcc: fp.bomOcc, netOccGain: fp.netOccGain, eomOcc: fp.eomOcc }, fp.m)}
            </tr>,
          );
        }
      }
    }
  }

  return (
    <div className="p-tbl-wrap">
      <table className="p-tbl blue">
        <thead><tr>{labels.map((l, i) => <th key={i} className={i === 0 ? "lbl" : undefined}>{l}</th>)}</tr></thead>
        <tbody>{rows}{!rows.length && <tr><td className="lbl" colSpan={labels.length} style={{ color: "var(--p-muted)" }}>No rows.</td></tr>}</tbody>
      </table>
    </div>
  );
}

/* DRC LTO — Community › Re-Lease/Renewal › EntityID hierarchy with expand/
   collapse, blue group rows, and a blue Total (matches the Power BI matrix). */
function DrcLtoTable({ rows }: { rows: DrcLtoRow[] }) {
  const agg = (rs: DrcLtoRow[]) => {
    const a = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    return { sqft: a(rs.map((r) => r.sqft)), cur: a(rs.map((r) => r.currentRent)), nw: a(rs.map((r) => r.newRent)), rg: a(rs.map((r) => r.rentGrowth)) };
  };
  // Community -> Type -> rows (preserving order of appearance).
  const groups = useMemo(() => {
    const byC = new Map<string, Map<string, DrcLtoRow[]>>();
    for (const r of rows) {
      const c = r.community || "—", t = r.type || "—";
      if (!byC.has(c)) byC.set(c, new Map());
      const byT = byC.get(c)!; if (!byT.has(t)) byT.set(t, []);
      byT.get(t)!.push(r);
    }
    return byC;
  }, [rows]);
  const [open, setOpen] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const [c, byT] of groups) { s.add(`c:${c}`); for (const t of byT.keys()) s.add(`t:${c}|${t}`); }
    return s;
  });
  const tog = (k: string) => setOpen((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const rg = (v: number | null) => (v == null ? "" : v < 0 ? "neg" : "pos");

  return (
    <div>
      <div className="p-tbl-title">DRC LTO</div>
      <div className="p-tbl-wrap" style={{ maxHeight: 460 }}>
        <table className="p-tbl blue">
          <thead><tr>
            <th className="lbl">Community</th><th className="lbl">Address</th><th className="lbl">Floorplan</th><th>New Lease Start</th>
            <th>Sqft</th><th>Current Rent</th><th>New Rent</th><th>Rent Growth</th>
          </tr></thead>
          <tbody>
            {[...groups.entries()].map(([c, byT]) => {
              const cRows = [...byT.values()].flat(); const ca = agg(cRows); const cOpen = open.has(`c:${c}`);
              const out = [
                <tr key={`c:${c}`} className="drc-grp" onClick={() => tog(`c:${c}`)}>
                  <td className="lbl"><span className="drc-tog">{cOpen ? "−" : "+"}</span>{c}</td>
                  <td className="lbl" /><td className="lbl" /><td />
                  <td>{fnum(ca.sqft)}</td><td>{fmoney(ca.cur)}</td><td>{fmoney(ca.nw)}</td><td className={rg(ca.rg)}>{fpct(ca.rg)}</td>
                </tr>,
              ];
              if (cOpen) for (const [t, tRows] of byT) {
                const ta = agg(tRows); const tOpen = open.has(`t:${c}|${t}`);
                out.push(
                  <tr key={`t:${c}|${t}`} className="drc-sub" onClick={() => tog(`t:${c}|${t}`)}>
                    <td className="lbl" style={{ paddingLeft: 26 }}><span className="drc-tog">{tOpen ? "−" : "+"}</span>{t}</td>
                    <td className="lbl" /><td className="lbl" /><td />
                    <td>{fnum(ta.sqft)}</td><td>{fmoney(ta.cur)}</td><td>{fmoney(ta.nw)}</td><td className={rg(ta.rg)}>{fpct(ta.rg)}</td>
                  </tr>,
                );
                if (tOpen) for (let i = 0; i < tRows.length; i++) { const r = tRows[i];
                  out.push(
                    <tr key={`r:${c}|${t}|${i}`}>
                      <td className="lbl" style={{ paddingLeft: 46 }}>{r.entityId}</td>
                      <td className="lbl">{r.address || "—"}</td><td className="lbl">{r.floorplan || "—"}</td><td>{fdate(r.newLeaseStart)}</td>
                      <td>{fnum(r.sqft)}</td><td>{fmoney(r.currentRent)}</td><td>{fmoney(r.newRent)}</td><td className={rg(r.rentGrowth)}>{fpct(r.rentGrowth)}</td>
                    </tr>,
                  );
                }
              }
              return out;
            })}
            {!rows.length && <tr><td className="lbl" colSpan={8} style={{ color: "var(--p-muted)" }}>No rows.</td></tr>}
          </tbody>
          {rows.length ? (() => { const a = agg(rows); return (
            <tfoot><tr className="drc-total">
              <td className="lbl">Total</td><td className="lbl" /><td className="lbl" /><td />
              <td>{fnum(a.sqft)}</td><td>{fmoney(a.cur)}</td><td>{fmoney(a.nw)}</td><td className={rg(a.rg)}>{fpct(a.rg)}</td>
            </tr></tfoot>
          ); })() : null}
        </table>
      </div>
    </div>
  );
}

/* DRC Conversion — Community › Month hierarchy with the same blue group rows
   and Total footer as DRC LTO. Group rows sum Leads/Apps/Appr; Appr% is the
   group's Appr÷Apps. */
function DrcConvTable({ rows }: { rows: DrcConvRow[] }) {
  const sum = (xs: (number | null)[]) => xs.reduce((s: number, x) => s + (x ?? 0), 0);
  const pctOf = (appr: number, apps: number) => (apps ? (appr / apps) * 100 : null);
  const groups = useMemo(() => {
    const byC = new Map<string, DrcConvRow[]>();
    for (const r of rows) { const c = r.community || "—"; if (!byC.has(c)) byC.set(c, []); byC.get(c)!.push(r); }
    return byC;
  }, [rows]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.keys()));
  const tog = (k: string) => setOpen((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div>
      <div className="p-tbl-title">DRC Conversion</div>
      <div className="p-tbl-wrap" style={{ maxHeight: 460 }}>
        <table className="p-tbl blue">
          <thead><tr>
            <th className="lbl">Community</th><th className="lbl">Month</th>
            <th>Leads</th><th>Apps</th><th>Appr</th><th>Appr %</th>
          </tr></thead>
          <tbody>
            {[...groups.entries()].map(([c, cRows]) => {
              const l = sum(cRows.map((r) => r.l)), al = sum(cRows.map((r) => r.al)), ap = sum(cRows.map((r) => r.appr));
              const cOpen = open.has(c);
              const out = [
                <tr key={`c:${c}`} className="drc-grp" onClick={() => tog(c)}>
                  <td className="lbl"><span className="drc-tog">{cOpen ? "−" : "+"}</span>{c}</td>
                  <td className="lbl" /><td>{fnum(l)}</td><td>{fnum(al)}</td><td>{fnum(ap)}</td><td>{fpct(pctOf(ap, al))}</td>
                </tr>,
              ];
              if (cOpen) for (let i = 0; i < cRows.length; i++) { const r = cRows[i];
                out.push(
                  <tr key={`r:${c}|${i}`}>
                    <td className="lbl" style={{ paddingLeft: 26 }} /><td className="lbl">{r.month}</td>
                    <td>{fnum(r.l)}</td><td>{fnum(r.al)}</td><td>{fnum(r.appr)}</td><td>{fpct(r.apprPct)}</td>
                  </tr>,
                );
              }
              return out;
            })}
            {!rows.length && <tr><td className="lbl" colSpan={6} style={{ color: "var(--p-muted)" }}>No rows.</td></tr>}
          </tbody>
          {rows.length ? (() => { const l = sum(rows.map((r) => r.l)), al = sum(rows.map((r) => r.al)), ap = sum(rows.map((r) => r.appr)); return (
            <tfoot><tr className="drc-total">
              <td className="lbl">Total</td><td className="lbl" /><td>{fnum(l)}</td><td>{fnum(al)}</td><td>{fnum(ap)}</td><td>{fpct(pctOf(ap, al))}</td>
            </tr></tfoot>
          ); })() : null}
        </table>
      </div>
    </div>
  );
}

/* Days Occupied line chart (Power BI style): occupied-days % per month with a
   value label above each point and the month under each point. avgDaysOcc is
   average occupied days in the month → shown as % of the month's calendar days. */
function DaysOccupied({ rows }: { rows: { month: string; avgDaysOcc: Num }[] }) {
  const dim = (label: string) => { const [mo, yr] = label.split(" "); const mi = MON.indexOf(mo); return mi < 0 ? 30 : new Date(+yr, mi + 1, 0).getDate(); };
  const pts = rows.filter((r) => r.avgDaysOcc != null).map((r) => ({ month: r.month, pct: Math.min(100, (Number(r.avgDaysOcc) / dim(r.month)) * 100) }));
  if (pts.length < 2) return <div style={{ color: "var(--p-muted)", fontSize: 12 }}>Not enough data.</div>;
  const vals = pts.map((p) => p.pct);
  const min = Math.max(0, Math.min(...vals) - 1), max = Math.min(100, Math.max(...vals) + 1), span = max - min || 1;
  const W = 300, H = 132, padX = 22, padTop = 18, padBot = 16;
  const x = (i: number) => padX + (i * (W - 2 * padX)) / (pts.length - 1);
  const y = (v: number) => padTop + (1 - (v - min) / span) * (H - padTop - padBot);
  const path = vals.map((v, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Days Occupied by month">
      <path d={path} fill="none" stroke="var(--p-blue)" strokeWidth={2} />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.pct)} r={2.6} fill="var(--p-blue)" />
          <text x={x(i)} y={y(p.pct) - 5} textAnchor="middle" fontSize="9" fill="var(--p-ink)">{p.pct.toFixed(1)}%</text>
          <text x={x(i)} y={H - 4} textAnchor="middle" fontSize="8.5" fill="var(--p-muted)">{p.month.replace(" 20", " '")}</text>
        </g>
      ))}
    </svg>
  );
}
