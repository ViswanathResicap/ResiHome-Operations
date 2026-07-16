"use client";

// Power BI-fidelity Summary page. Consumes the rich /api/summary-v2 payload
// (server-side filtered by month/org/region/status) and renders every section
// of the published "Portfolio Summary" report page: Portfolio Summary + Map,
// KPI gauges, Portfolio Metrics, org matrix, monthly trend, Days Occupied,
// DRC LTO / Conversion, Tenant Leased Demographics, All Property Export.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getCachedPayload, setCachedPayload } from "@/lib/client-cache";
import { MultiSelect } from "@/components/MultiSelect";
import { PbiCanvas, PbiBox } from "@/components/PbiCanvas";
import { PropertyMap } from "./PropertyMap";

/* ----------------------------- payload types ----------------------------- */
type Num = number | null;
interface RegRow { region: string; inspection: number; vacantOff: number; vacantOn: number; vacantFMI: number; trustee: number; tenant: number; turnkey: number; total: number }
interface OrgRow { org: string; avgRent: Num; offMarket: number; onMarket: number; leased: number; turnkey: number; total: number; bomOcc: Num; eomOcc: Num }
interface TrendRow { month: string; homes: Num; avgRent: Num; bomOcc: Num; netOccGain: Num; eomOcc: Num; hfPullThru: Num; bomVacantLeased: Num; collections: Num; retention: Num; turnover: Num; renewal: Num; renewalRentGrowth: Num; releaseRentGrowth: Num; blendedRentGrowth: Num; spend90: Num; netTurnCost: Num }
interface DrcLtoRow { community: string; type: string; entityId: string; address: string; floorplan: string; newLeaseStart: string; sqft: Num; currentRent: Num; newRent: Num; rentGrowth: Num }
interface DrcConvRow { community: string; month: string; l: Num; hf: Num; al: Num; appr: Num; apprPct: Num }
interface DemoRow { region: string; tenants: Num; mtm: Num; bed: Num; bath: Num; sqft: Num; uwRent: Num; rent: Num; rentVar: Num; rentPerSqft: Num; timeInHome: Num }
interface PropRow { entityId: string; hbpmId: string; assetId: string; hubspotId: string; rentlySerial: string; rentlyType: string; region: string; address: string; bed: Num; bath: Num; sqft: Num; subdivision: string; floorplan: string; county: string; propertyStatus: string; tenantStatus: string; tenantName: string }
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
// Count formatter that renders 0/blank as an empty cell, matching Power BI matrices.
const fcnt = (v: Num) => (v == null || Number(v) === 0 ? "" : Math.round(Number(v)).toLocaleString("en-US"));
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
function Tbl<T>({ cols, rows, blue, max, title, foot, wrapH }: {
  cols: Col<T>[]; rows: T[]; blue?: boolean; max?: number; title?: string; foot?: (rows: T[]) => (string | number)[] | null; wrapH?: number;
}) {
  const [sort, setSort] = useState<{ i: number; d: 1 | -1 } | null>(null);
  const [widths, setWidths] = useState<Record<number, number>>({});
  const drag = useRef<{ i: number; x: number; w: number } | null>(null);
  const raw = (r: T, k: string) => (r as Record<string, unknown>)[k];
  const asNum = (v: unknown): number | null => {
    if (typeof v === "number") return v;
    if (v == null || v === "") return null;
    const n = Number(String(v).replace(/[$,%\s]/g, ""));
    return Number.isNaN(n) ? null : n;
  };
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const k = cols[sort.i].key as string, d = sort.d;
    return [...rows].sort((a, b) => {
      const av = raw(a, k), bv = raw(b, k), an = asNum(av), bn = asNum(bv);
      if (an !== null && bn !== null) return (an - bn) * d;
      if (an !== null) return -1 * d;
      if (bn !== null) return 1 * d;
      return String(av ?? "").localeCompare(String(bv ?? "")) * d;
    });
  }, [rows, sort, cols]);
  const shown = max ? sorted.slice(0, max) : sorted;
  const footVals = foot ? foot(rows) : null;

  const clickHead = (i: number) => setSort((s) => (s && s.i === i ? (s.d === 1 ? { i, d: -1 } : null) : { i, d: 1 }));
  const startResize = (i: number, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
    drag.current = { i, x: e.clientX, w: widths[i] ?? th.offsetWidth };
    const move = (ev: MouseEvent) => { if (!drag.current) return; const w = Math.max(48, drag.current.w + (ev.clientX - drag.current.x)); setWidths((p) => ({ ...p, [drag.current!.i]: w })); };
    const up = () => { drag.current = null; window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const exportCsv = () => {
    const esc = (s: string) => (/[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
    const cell = (c: Col<T>, r: T) => { const v = raw(r, c.key as string); return c.fmt ? c.fmt(v, r) : (v == null ? "" : String(v)); };
    const lines = [cols.map((c) => esc(c.label)).join(","), ...sorted.map((r) => cols.map((c) => esc(cell(c, r))).join(","))].join("\r\n");
    const blob = new Blob(["﻿" + lines], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = (title || "table").replace(/[^\w.-]+/g, "_") + ".csv";
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 5px", gap: 8 }}>
        {title ? <div className="p-tbl-title" style={{ margin: 0 }}>{title}</div> : <span />}
        <button className="tbl-export" onClick={exportCsv} title="Export to Excel (CSV)">⤓ Excel</button>
      </div>
      <div className="p-tbl-wrap" style={wrapH ? { maxHeight: wrapH } : undefined}>
        <table className={`p-tbl${blue ? " blue" : ""}`}>
          <thead><tr>{cols.map((c, i) => (
            <th key={String(c.key)} className={c.lbl ? "lbl" : undefined} style={{ width: widths[i], position: "relative", cursor: "pointer", userSelect: "none" }} onClick={() => clickHead(i)}>
              {c.label}{sort && sort.i === i ? (sort.d === 1 ? " ▲" : " ▼") : ""}
              <span onMouseDown={(e) => startResize(i, e)} onClick={(e) => e.stopPropagation()} style={{ position: "absolute", right: -1, top: 0, height: "100%", width: 7, cursor: "col-resize" }} />
            </th>
          ))}</tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {cols.map((c, ci) => {
                  const v = raw(r, c.key as string);
                  return <td key={String(c.key)} style={{ width: widths[ci] }} className={[c.lbl ? "lbl" : "", c.cls ? c.cls(v, r) : ""].filter(Boolean).join(" ") || undefined}>
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
  // Dynamic last-4 months (newest first); radio picker. Default to the last
  // COMPLETE month (months[1]) to match the Power BI report, since the current
  // month (months[0]) is still in progress.
  const months = useMemo(() => recentMonths(4), []);
  const [month, setMonth] = useState(months[1] ?? months[0]);
  const [org, setOrg] = useState<string[]>([]);
  const [region, setRegion] = useState<string[]>([]);
  const [status, setStatus] = useState<string[]>([]);
  const [subdivision, setSubdivision] = useState<string[]>([]);
  const [mgr, setMgr] = useState<string[]>([]);
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

  const fKey = [org, region, status, subdivision, mgr].map((a) => a.join("~")).join("|") + "|" + search;
  const load = useCallback(async (force = false) => {
    const qs = new URLSearchParams({ month });
    org.forEach((v) => qs.append("org", v));
    region.forEach((v) => qs.append("region", v));
    status.forEach((v) => qs.append("status", v));
    subdivision.forEach((v) => qs.append("subdivision", v));
    mgr.forEach((v) => qs.append("pm", v));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, fKey]);
  useEffect(() => { load(); }, [load]);

  // Occupancy statuses for the Property Status slicer (matches PBI options).
  const STATUS_OPTS = ["Tenant Leased", "Trustee Leased", "Vacant - On Market", "Vacant - Off Market", "Vacant - FMI", "Under Turnkey", "Under Construction", "Pending MOI/Rekey"];

  const orgOpts = useMemo(() => (d?.orgSummary ?? []).map((o) => o.org).filter((o) => o && o !== "Total"), [d]);
  const regionOpts = useMemo(() => (d?.regionRows ?? []).map((r) => r.region).filter((r) => r && r !== "Total"), [d]);

  const gauges: GaugeCfg[] = d ? [
    { label: "EOM Occupancy", value: d.eomOccupancy, min: 90, max: 97, target: 96, fmt: fpct, higherIsBetter: true },
    { label: "EOM Collections", value: d.eomCollections, min: 90, max: 97, target: 95.5, fmt: fpct, higherIsBetter: true },
    { label: "Renewal", value: d.renewal, min: 0, max: 100, target: 75, fmt: fpct, higherIsBetter: true },
    { label: "BOM Listings Leased", value: d.bomListingsLeased, min: 0, max: 70, target: 50, fmt: fpct, higherIsBetter: true },
    { label: "W/O Cycle Time", value: d.woCycleTime, min: 7, max: 16, target: 16, fmt: (v) => fdec(v, 1), higherIsBetter: false },
    { label: "Net Turn Cost (All)", value: d.netTurnCost, min: 1000, max: 3000, target: 1750, fmt: fmoney, higherIsBetter: false },
    { label: "90+ Run Rate Spend", value: d.runRateSpend, min: 1000, max: 2500, target: 1400, fmt: fmoney, higherIsBetter: false },
    { label: "Internal Maintenance", value: d.internalMaintenance, min: 0, max: 64000, target: 64000, fmt: fmoney, higherIsBetter: false },
  ] : [];

  const pm = d?.portfolioMetrics;

  const slh: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#605e5c", textTransform: "uppercase", margin: "0 0 4px", letterSpacing: 0.3 };
  const cardX = (label: string, value: string, cls?: string) => (
    <div className="p-card" style={{ width: "100%", height: "100%", boxSizing: "border-box" }}>
      <div className={`v${cls ? " " + cls : ""}`}>{value}</div><div className="l">{label}</div>
    </div>
  );
  const gaugeX = [289, 502, 716, 930, 1144, 1358, 1572, 1787];
  const canvasW = 1990, canvasH = 2700;

  return (
    <div className="app pbi" style={{ display: "block", height: "auto", minHeight: "100vh", overflow: "auto" }}>
      <div className="pagehead" style={{ padding: "8px 16px" }}>
        <h1 style={{ margin: 0 }}>Summary</h1>
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

      {d && (
        <PbiCanvas width={canvasW} height={canvasH}>
          {/* Header */}
          <PbiBox x={0} y={6} w={290} h={62}>
            <svg viewBox="0 0 290 60" width="290" height="60" role="img" aria-label="ResiHome">
              <g fill="none" stroke="#231f20" strokeWidth="4.5" strokeLinejoin="round" strokeLinecap="round">
                <path d="M6 42 L34 10 L62 42" />
                <path d="M17 42 L34 22 L51 42" />
              </g>
              <text x="76" y="43" fontFamily="'Segoe UI Semibold','Segoe UI',Arial,sans-serif" fontWeight="700" fontSize="34" letterSpacing="0.5">
                <tspan fill="#231f20">RESI</tspan><tspan fill="#ec008c">HOME</tspan>
              </text>
            </svg>
          </PbiBox>
          <PbiBox x={300} y={14} w={784} h={60}><div style={{ fontFamily: '"Segoe UI Semibold","Segoe UI",sans-serif', fontSize: 30, fontWeight: 700, color: "#252423", borderBottom: "2px solid #252423", display: "inline-block", lineHeight: "40px" }}>Portfolio Summary</div></PbiBox>

          {/* Left rail slicers */}
          <PbiBox x={4} y={80} w={264} h={70}><div style={slh}>Organization</div><MultiSelect options={orgOpts} selected={org} onChange={setOrg} /></PbiBox>
          <PbiBox x={4} y={156} w={264} h={70}><div style={slh}>Region</div><MultiSelect options={regionOpts} selected={region} onChange={setRegion} /></PbiBox>
          <PbiBox x={4} y={236} w={264} h={70}><div style={slh}>Subdivision</div><MultiSelect options={opts.subdivisions} selected={subdivision} onChange={setSubdivision} /></PbiBox>
          <PbiBox x={4} y={312} w={264} h={70}><div style={slh}>Property Status</div><MultiSelect options={STATUS_OPTS} selected={status} onChange={setStatus} /></PbiBox>
          <PbiBox x={4} y={389} w={264} h={70}><div style={slh}>Property Manager</div><MultiSelect options={opts.propertyManagers} selected={mgr} onChange={setMgr} /></PbiBox>
          <PbiBox x={4} y={465} w={264} h={90}><div style={slh}>Address Search</div><input className="control dd-input" placeholder="Address or Entity ID…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") setSearch(searchInput.trim()); }} onBlur={() => setSearch(searchInput.trim())} />{search && <div className="dd-hint">Filtering “{search}”</div>}</PbiBox>
          <PbiBox x={13} y={600} w={255} h={250}><div style={slh}>Month</div><div className="month-radios">{[...months].reverse().map((m) => (<label key={m} className={`month-opt${m === month ? " on" : ""}`}><input type="radio" name="sum-month" checked={m === month} onChange={() => setMonth(m)} /> {m}</label>))}</div>{(org.length || region.length || status.length || subdivision.length || mgr.length || search) ? <button className="dd-clear" style={{ marginTop: 8 }} onClick={() => { setOrg([]); setRegion([]); setStatus([]); setSubdivision([]); setMgr([]); setSearch(""); setSearchInput(""); }}>Clear ✕</button> : null}</PbiBox>

          {/* Top KPI cards */}
          <PbiBox x={300} y={100} w={190} h={120}>{cardX("Total Properties", fnum(d.heroKpis.totalProperties))}</PbiBox>
          <PbiBox x={496} y={100} w={188} h={121}>{cardX("Occupancy %", fpct(d.heroKpis.occupancyPct))}</PbiBox>
          <PbiBox x={691} y={100} w={205} h={121}>{cardX("Active Listings", fnum(d.heroKpis.activeListings))}</PbiBox>

          {/* Property Summary table + Map */}
          <PbiBox x={300} y={238} w={833} h={379}><Tbl<RegRow> title="Property Summary" wrapH={330} cols={[
            { key: "region", label: "Region", lbl: true },
            { key: "inspection", label: "Inspection", fmt: (v) => fcnt(v as Num) },
            { key: "vacantOff", label: "Vacant - Off Market", fmt: (v) => fcnt(v as Num) },
            { key: "vacantOn", label: "Vacant - On Market", fmt: (v) => fcnt(v as Num) },
            { key: "vacantFMI", label: "Vacant - FMI", fmt: (v) => fcnt(v as Num) },
            { key: "trustee", label: "Trustee Leased", fmt: (v) => fcnt(v as Num) },
            { key: "tenant", label: "Tenant Leased", fmt: (v) => fcnt(v as Num) },
            { key: "turnkey", label: "Turnkey", fmt: (v) => fcnt(v as Num) },
            { key: "total", label: "Total", fmt: (v) => fnum(v as Num) },
          ]} rows={d.regionRows} foot={(rows) => ["Total", ...(["inspection", "vacantOff", "vacantOn", "vacantFMI", "trustee", "tenant", "turnkey", "total"] as const).map((k) => fnum(rows.reduce((s, r) => s + (r[k] || 0), 0)))]} /></PbiBox>
          <PbiBox x={1138} y={238} w={849} h={374}><div style={{ fontFamily: '"Segoe UI Semibold","Segoe UI",sans-serif', fontWeight: 700, fontSize: 14, color: "#1a4f7a", marginBottom: 4 }}>Property Map</div><div style={{ height: "calc(100% - 24px)" }}><PropertyMap regions={d.regionRows} /></div></PbiBox>

          {/* Gauges */}
          {gauges.map((g, i) => <PbiBox key={g.label} x={gaugeX[i]} y={699} w={210} h={160}><Gauge g={g} /></PbiBox>)}

          {/* Portfolio metric cards */}
          <PbiBox x={302} y={866} w={700} h={36}><div className="p-h2" style={{ margin: 0 }}>Portfolio Metrics — {d.selectedMonth}</div></PbiBox>
          <PbiBox x={299} y={909} w={170} h={120}>{cardX("BOM Listings", fnum(pm?.bomListings ?? null))}</PbiBox>
          <PbiBox x={474} y={909} w={171} h={120}>{cardX("BOM Vacant", fnum(pm?.bomVacant ?? null))}</PbiBox>
          <PbiBox x={650} y={909} w={170} h={120}>{cardX("Holding Fees", fnum(pm?.holdingFees ?? d.holdingFees))}</PbiBox>
          <PbiBox x={825} y={909} w={170} h={120}>{cardX("Proj / Actual MIs", fnum(pm?.actualMIs ?? null))}</PbiBox>
          <PbiBox x={998} y={909} w={170} h={120}>{cardX("Proj / Actual MOs", fnum(pm?.actualMOs ?? null))}</PbiBox>
          <PbiBox x={1174} y={909} w={169} h={120}>{cardX("Net Occ Gain", fnum(pm?.netOccGain ?? null))}</PbiBox>
          <PbiBox x={1347} y={909} w={170} h={122}>{cardX("Turnover %", fpct(pm?.turnoverPct ?? null))}</PbiBox>

          {/* Metric pivots */}
          <PbiBox x={306} y={1048} w={1667} h={207}><div className="p-h2" style={{ margin: "0 0 4px" }}>Portfolio Metrics by Organization</div><OrgMetricsTable tree={d.orgSubMap ?? {}} orgMetrics={d.orgMetrics ?? {}} order={(d.orgSummary ?? []).map((o) => o.org).filter((o) => o && o !== "Total")} /></PbiBox>
          <PbiBox x={306} y={1263} w={1667} h={350}><div className="p-h2" style={{ margin: "0 0 4px" }}>Portfolio Metrics by Month</div><Tbl<TrendRow> blue wrapH={280} cols={metricCols<TrendRow>("month", "Month")} rows={d.monthlyTrend} /></PbiBox>

          {/* Days Occupied + DRC */}
          <PbiBox x={298} y={1621} w={535} h={200}><div className="p-panel" style={{ height: "100%", boxSizing: "border-box" }}><div className="ph">Days Occupied</div><DaysOccupied rows={d.daysOccupied} /></div></PbiBox>
          <PbiBox x={834} y={1621} w={787} h={361}><DrcLtoTable rows={d.drcLto} /></PbiBox>
          <PbiBox x={1621} y={1621} w={364} h={361}><DrcConvTable rows={d.drcConversion} /></PbiBox>

          {/* Tenant Leased Demographics */}
          <PbiBox x={295} y={1900} w={538} h={36}><div className="p-h1" style={{ margin: 0 }}>Tenant Leased Demographics</div></PbiBox>
          <PbiBox x={296} y={1945} w={189} h={110}>{cardX("Total Tenants", fnum(d.tenantSummary.totalTenants))}</PbiBox>
          <PbiBox x={494} y={1945} w={191} h={110}>{cardX("vs. UW Rent", fpct(d.tenantSummary.avgVsUwRent), d.tenantSummary.avgVsUwRent != null && d.tenantSummary.avgVsUwRent < 0 ? "bad" : "good")}</PbiBox>
          <PbiBox x={295} y={2070} w={1152} h={300}><Tbl<DemoRow> title="Tenant Demo" wrapH={250} cols={[
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
          ]} rows={d.tenantDemographics} /></PbiBox>

          {/* All Property Export / In Process */}
          <PbiBox x={290} y={2400} w={1683} h={285}><Tbl<PropRow> title="All Property Export" max={300} wrapH={225} cols={[
            { key: "entityId", label: "EntityID", lbl: true },
            { key: "hbpmId", label: "HBPM Property ID", lbl: true },
            { key: "assetId", label: "ASSETID", lbl: true },
            { key: "hubspotId", label: "Hubspot ID", lbl: true },
            { key: "rentlySerial", label: "Rently Serial", lbl: true },
            { key: "rentlyType", label: "Rently Type", lbl: true },
            { key: "region", label: "Region", lbl: true },
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
            { key: "rrq", label: "RRQC", fmt: (v) => fdate(v as string) },
            { key: "tenantStatus", label: "Tenant Status", lbl: true },
            { key: "tenantName", label: "Tenant Name", lbl: true },
            { key: "allTenantEmails", label: "All Tenant Emails", lbl: true },
            { key: "evictionStatus", label: "Eviction Status", lbl: true },
            { key: "listDate", label: "List Date", fmt: (v) => fdate(v as string) },
            { key: "leaseStart", label: "Lease Start", fmt: (v) => fdate(v as string) },
            { key: "leaseEnd", label: "Lease End", fmt: (v) => fdate(v as string) },
            { key: "rent", label: "Rent", fmt: (v) => fmoney(v as Num) },
          ]} rows={d.allProperties} /></PbiBox>
        </PbiCanvas>
      )}
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
