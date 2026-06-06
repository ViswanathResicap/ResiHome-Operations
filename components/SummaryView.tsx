"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SummaryCache, PropertyRow, PropertySummaryRow } from "@/lib/types";
import { LEASED_STATUSES } from "@/lib/types";
import { KpiCard } from "./KpiCard";
import { Gauge } from "./Gauge";
import { Dropdown } from "./Dropdown";
import { PropertySummaryTable } from "./PropertySummaryTable";
import { MonthlyTrendTable } from "./MonthlyTrendTable";
import { pct, num } from "@/lib/format";

const LEASED = new Set(LEASED_STATUSES);
const show = (v: number | null, fmt: (n: number) => string) => (v == null ? "—" : fmt(v));
const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort();
// Empty selection = no filter (All); otherwise keep rows whose value is selected.
const inSel = (sel: string[], v: string) => sel.length === 0 || sel.includes(v);

type MultiKey = "org" | "status" | "region" | "subdivision" | "pm" | "apm" | "pod";
type Filters = Record<MultiKey, string[]> & { address: string };
const EMPTY: Filters = { org: [], status: [], region: [], subdivision: [], pm: [], apm: [], pod: [], address: "" };

export function SummaryView({ initialData }: { initialData: SummaryCache }) {
  // Render the instant committed snapshot, then swap in fresh data from the
  // cron-warmed API (full per-property rows + live numbers) once it arrives.
  const [d, setData] = useState<SummaryCache>(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [justUpdated, setJustUpdated] = useState(false);
  // Background refresh: the page keeps showing the latest good data and stays
  // fully interactive; fresh numbers are swapped in when they arrive. A ref
  // guards against overlapping fetches (e.g. double-clicks). `dataRef` mirrors
  // the rendered data so we never downgrade live rows to a sample fallback.
  const inflight = useRef(false);
  const dataRef = useRef(d);
  useEffect(() => { dataRef.current = d; }, [d]);
  const load = async (fresh: boolean) => {
    if (inflight.current) return;
    inflight.current = true;
    setRefreshing(true);
    try {
      const r = await fetch(`/api/summary${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
      const j = r.ok ? ((await r.json()) as SummaryCache) : null;
      if (j && j._meta) {
        const incomingProps = j.properties?.length ?? 0;
        const currentProps = dataRef.current.properties?.length ?? 0;
        const incomingLive = j._meta.source === "SNOWFLAKE";
        const currentLive = dataRef.current._meta.source === "SNOWFLAKE";
        // Only swap in data that isn't a downgrade: keep current live rows
        // rather than clobbering them with a sample/empty fallback.
        const keepCurrent = (currentProps > 0 && incomingProps === 0) || (currentLive && !incomingLive);
        if (!keepCurrent) {
          setData(j);
          setJustUpdated(true);
          setTimeout(() => setJustUpdated(false), 2600);
        }
      }
    } catch { /* keep current data */ } finally {
      inflight.current = false;
      setRefreshing(false);
    }
  };
  useEffect(() => { load(false); /* initial hydrate */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [f, setF] = useState<Filters>(EMPTY);
  const setMulti = (k: MultiKey, v: string[]) => setF((p) => ({ ...p, [k]: v }));
  const props = d.properties ?? null;
  const fullMode = !!props && props.length > 0;

  // Slicer options (from per-property rows in full mode; else just org/status).
  const opts = useMemo(() => {
    if (fullMode) return {
      org: uniq(props!.map((p) => p.org)), status: uniq(props!.map((p) => p.status)),
      region: uniq(props!.map((p) => p.region)), subdivision: uniq(props!.map((p) => p.subdivision)),
      pm: uniq(props!.map((p) => p.pm)), apm: uniq(props!.map((p) => p.apm)),
      pod: uniq(props!.map((p) => p.pod)),
    };
    return { org: uniq(d.propertySummary.map((r) => r.organization)), status: uniq(d.propertySummary.map((r) => r.status)),
      region: [], subdivision: [], pm: [], apm: [], pod: [] };
  }, [fullMode, props, d.propertySummary]);

  const active = f.address !== "" || (Object.keys(EMPTY) as (keyof Filters)[])
    .some((k) => k !== "address" && (f[k] as string[]).length > 0);

  // Build the (filtered) Property Summary matrix + derived counts.
  const { matrix, totalProps, totalTenants, occupancy, rentVar } = useMemo(() => {
    let matrix: PropertySummaryRow[];
    let totalProps: number, leased: number;
    let rentVar: number | null = fullMode ? null : d.kpis.rentVar;

    if (fullMode) {
      const fp = props!.filter((p) =>
        inSel(f.org, p.org) && inSel(f.status, p.status) &&
        inSel(f.region, p.region) && inSel(f.subdivision, p.subdivision) &&
        inSel(f.pm, p.pm) && inSel(f.apm, p.apm) && inSel(f.pod, p.pod) &&
        (f.address === "" || p.address.toLowerCase().includes(f.address.toLowerCase())));
      const g = new Map<string, PropertySummaryRow>();
      for (const p of fp) {
        // SFR homes (and any property without a subdivision) roll up as "Scattered".
        const region = p.region || "—";
        const subdivision = /\bSFR\b/i.test(p.org) || !p.subdivision ? "Scattered" : p.subdivision;
        const key = `${p.org}|${region}|${subdivision}|${p.status}`;
        const cur = g.get(key) ?? { organization: p.org, region, subdivision, status: p.status, count: 0 };
        cur.count++; g.set(key, cur);
      }
      matrix = Array.from(g.values());
      totalProps = fp.length;
      leased = fp.filter((p) => LEASED.has(p.status)).length;
      const rs = fp.filter((p) => p.rent != null && p.uw != null);
      const sr = rs.reduce((s, p) => s + (p.rent as number), 0);
      const su = rs.reduce((s, p) => s + (p.uw as number), 0);
      rentVar = su ? sr / su - 1 : null;
    } else {
      matrix = d.propertySummary.filter((r) =>
        inSel(f.org, r.organization) && inSel(f.status, r.status));
      totalProps = matrix.reduce((s, r) => s + r.count, 0);
      leased = matrix.filter((r) => LEASED.has(r.status)).reduce((s, r) => s + r.count, 0);
    }
    // Report's 0_Current_Occupancy = leased (summaryId 7,8) / all properties
    // (summaryId is never null in the source, so the denominator is every property).
    return { matrix, totalProps, totalTenants: leased, occupancy: totalProps ? leased / totalProps : null, rentVar };
  }, [fullMode, props, f, d.propertySummary, d.kpis.rentVar]);

  const k = d.kpis;
  const isSample = d._meta.source === "SAMPLE";

  // Filtered funnel KPIs: when a filter is active, recompute the monthly flow
  // measures from per-property rows + latest-month flow events (keyed by
  // PROPERTY_KEY). Unfiltered, we show the exact server totals.
  const funnel = useMemo(() => {
    if (!fullMode || !active || !props) return null;
    const pass = (p: PropertyRow) =>
      inSel(f.org, p.org) && inSel(f.status, p.status) && inSel(f.region, p.region) &&
      inSel(f.subdivision, p.subdivision) && inSel(f.pm, p.pm) && inSel(f.apm, p.apm) && inSel(f.pod, p.pod) &&
      (f.address === "" || p.address.toLowerCase().includes(f.address.toLowerCase()));
    const keyMap = new Map(props.map((p) => [p.key, p]));
    const countFlow = (evs?: { key: string; id: string }[]) => {
      const s = new Set<string>();
      for (const e of evs ?? []) { const p = keyMap.get(e.key); if (p && pass(p)) s.add(e.id); }
      return s.size;
    };
    const fp = props.filter(pass);
    const leased = fp.filter((p) => LEASED.has(p.status)).length;
    const fl = d.flows;
    const mi = fl ? countFlow(fl.moveIns) : null;
    const mof = fl ? countFlow(fl.moveOuts) : null;
    return {
      activeListings: fp.filter((p) => p.activeListing).length,
      holdingFees: fl ? countFlow(fl.holdingFees) : null,
      projActualMis: mi,
      netOccupancyGain: mi != null && mof != null ? mi - mof : null,
      turnoverPct: mof != null && leased ? mof / leased : null,
    };
  }, [fullMode, active, props, f, d.flows]);

  // KPI value: filtered (when a filter is active) else the exact server total.
  const fk = (server: number | null, filtered: number | null | undefined) =>
    active ? (filtered ?? null) : server;

  const slicer = (label: string, key: MultiKey) => (
    <Dropdown key={label} label={label} options={opts[key]} selected={f[key]}
      onChange={(v) => setMulti(key, v)} multiple disabled={opts[key].length === 0} />
  );

  return (
    <div className="app">
      <aside className="rail">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo" src="/resihome-logo.png" alt="ResiHome" />
        <div className="accent" />
        <div className="tagline">OPERATIONS · SUMMARY</div>

        {slicer("Organization", "org")}
        {slicer("Property Status", "status")}
        {slicer("POD", "pod")}
        {slicer("Region", "region")}
        {slicer("PM Assigned", "pm")}
        {slicer("APM Assigned", "apm")}
        {slicer("Subdivision", "subdivision")}
        <div className="slicer">
          <h4>Address Search</h4>
          <input className="control dd-input" placeholder={fullMode ? "Search address…" : "—"} disabled={!fullMode}
            value={f.address} onChange={(e) => setF((p) => ({ ...p, address: e.target.value }))}
            style={fullMode ? {} : { opacity: 0.55 }} />
        </div>

        {active && (
          <button className="dd-clear" onClick={() => setF(EMPTY)}>Clear filters ✕</button>
        )}
      </aside>

      <main className="canvas">
        <div className="pagehead">
          <h1>Summary</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="ctx">
              {isSample ? "Sample" : "Live · Snowflake"} · updated{" "}
              {new Date(d._meta.generatedAt).toLocaleString("en-US")}
              {refreshing && <span className="refresh-pill"><span className="spin">↻</span> refreshing in background…</span>}
              {!refreshing && justUpdated && <span className="updated-pill">✓ updated</span>}
            </div>
            <button className="refresh-btn" onClick={() => load(true)} aria-busy={refreshing}>
              <span className={refreshing ? "spin" : ""}>↻</span> {refreshing ? "Refreshing" : "Refresh data"}
            </button>
          </div>
        </div>
        {refreshing && <div className="refresh-bar" aria-hidden />}

        {!fullMode && (
          <div className="banner">
            Per-property data hasn’t loaded — drill-down &amp; the full slicers are unavailable.
            <span style={{ opacity: 0.85 }}>
              {" "}(source: {d._meta.source}; properties: {d.properties?.length ?? 0}
              {d._meta.errors?.length ? `; error: ${d._meta.errors[0]}` : ""})
            </span>
          </div>
        )}
        {active && (
          <div className="banner">Filtered — all KPI tiles &amp; the Property Summary reflect the current selection. (Monthly Performance gauges remain portfolio-wide.)</div>
        )}

        <div className="grid kpi-row">
          <KpiCard label="Total Properties" value={show(totalProps, num)} />
          <KpiCard label="Occupancy %" value={show(occupancy, (n) => pct(n))} />
          <KpiCard label="Active Listings" value={show(fk(k.activeListings, funnel?.activeListings), num)} />
          <KpiCard label="Total Tenants" value={show(totalTenants, num)} />
          <KpiCard label="vs. UW Rent" value={show(rentVar, (n) => pct(n))}
            tone={rentVar == null ? undefined : rentVar >= 0 ? "pos" : "neg"} />
          <KpiCard label="Holding Fees" value={show(fk(k.holdingFees, funnel?.holdingFees), num)} />
        </div>

        <div className="section-title">Monthly Performance</div>
        <div className="grid gauge-row">
          {([["EOM Collections", d.gauges?.eomCollections], ["Renewal", d.gauges?.renewal],
            ["Net Turn Cost (All)", d.gauges?.netTurnCost], ["Internal Maintenance", d.gauges?.internalMaintenance],
          ] as const).map(([label, g]) =>
            g ? <Gauge key={label} g={g} /> : (
              <div key={label} className="card gauge" style={{ color: "var(--muted)" }}>
                <div className="title">{label}</div><div style={{ padding: "26px 0", fontSize: 12 }}>pending</div>
              </div>))}
        </div>

        <div className="grid kpi-row" style={{ marginTop: 12 }}>
          <KpiCard label="Proj / Actual MIs" value={show(fk(k.projActualMis, funnel?.projActualMis), num)} />
          <KpiCard label="Net Occupancy Gain" value={show(fk(k.netOccupancyGain, funnel?.netOccupancyGain), num)} />
          <KpiCard label="Turnover %" value={show(fk(k.turnoverPct, funnel?.turnoverPct), (n) => pct(n))} />
        </div>

        <div className="section-title">Property Summary</div>
        {matrix.length ? <PropertySummaryTable rows={matrix} drilldown={fullMode} />
          : <div className="card" style={{ color: "var(--muted)" }}>No properties match the filter.</div>}

        <div className="section-title">Monthly KPI Trend</div>
        {d.monthlyTrend.length ? <MonthlyTrendTable rows={d.monthlyTrend} />
          : <div className="card" style={{ color: "var(--muted)" }}>Monthly KPI trend — pending.</div>}
      </main>
    </div>
  );
}
