"use client";

import { useEffect, useMemo, useState } from "react";
import type { SummaryCache, PropertyRow, PropertySummaryRow } from "@/lib/types";
import { LEASED_STATUSES, STABILIZED_STATUSES } from "@/lib/types";
import { KpiCard } from "./KpiCard";
import { Gauge } from "./Gauge";
import { PropertySummaryTable } from "./PropertySummaryTable";
import { MonthlyTrendTable } from "./MonthlyTrendTable";
import { pct, num } from "@/lib/format";

const ALL = "All";
const LEASED = new Set(LEASED_STATUSES);
const STABLE = new Set(STABILIZED_STATUSES);
const show = (v: number | null, fmt: (n: number) => string) => (v == null ? "—" : fmt(v));
const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean))).sort();

type Filters = {
  org: string; status: string; region: string; subdivision: string;
  pm: string; apm: string; pod: string; delinquent: string; address: string;
};
const EMPTY: Filters = { org: ALL, status: ALL, region: ALL, subdivision: ALL,
  pm: ALL, apm: ALL, pod: ALL, delinquent: ALL, address: "" };

export function SummaryView({ initialData }: { initialData: SummaryCache }) {
  // Render the instant committed snapshot, then swap in fresh data from the
  // cron-warmed API (full per-property rows + live numbers) once it arrives.
  const [d, setData] = useState<SummaryCache>(initialData);
  useEffect(() => {
    let on = true;
    fetch("/api/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (on && j && j._meta) setData(j as SummaryCache); })
      .catch(() => {});
    return () => { on = false; };
  }, []);
  const [f, setF] = useState<Filters>(EMPTY);
  const set = (k: keyof Filters, v: string) => setF((p) => ({ ...p, [k]: v }));
  const props = d.properties ?? null;
  const fullMode = !!props && props.length > 0;

  // Slicer options (from per-property rows in full mode; else just org/status).
  const opts = useMemo(() => {
    if (fullMode) return {
      org: uniq(props!.map((p) => p.org)), status: uniq(props!.map((p) => p.status)),
      region: uniq(props!.map((p) => p.region)), subdivision: uniq(props!.map((p) => p.subdivision)),
      pm: uniq(props!.map((p) => p.pm)), apm: uniq(props!.map((p) => p.apm)),
      pod: uniq(props!.map((p) => p.pod)), delinquent: uniq(props!.map((p) => p.delinquent)),
    };
    return { org: uniq(d.propertySummary.map((r) => r.organization)), status: uniq(d.propertySummary.map((r) => r.status)),
      region: [], subdivision: [], pm: [], apm: [], pod: [], delinquent: [] };
  }, [fullMode, props, d.propertySummary]);

  const active = Object.entries(f).some(([k, v]) => (k === "address" ? v !== "" : v !== ALL));

  // Build the (filtered) Property Summary matrix + derived counts.
  const { matrix, totalProps, totalTenants, occupancy, rentVar } = useMemo(() => {
    let matrix: PropertySummaryRow[];
    let totalProps: number, leased: number, stable: number;
    let rentVar: number | null = fullMode ? null : d.kpis.rentVar;

    if (fullMode) {
      const fp = props!.filter((p) =>
        (f.org === ALL || p.org === f.org) && (f.status === ALL || p.status === f.status) &&
        (f.region === ALL || p.region === f.region) && (f.subdivision === ALL || p.subdivision === f.subdivision) &&
        (f.pm === ALL || p.pm === f.pm) && (f.apm === ALL || p.apm === f.apm) &&
        (f.pod === ALL || p.pod === f.pod) && (f.delinquent === ALL || p.delinquent === f.delinquent) &&
        (f.address === "" || p.address.toLowerCase().includes(f.address.toLowerCase())));
      const g = new Map<string, PropertySummaryRow>();
      for (const p of fp) {
        const key = `${p.org}|${p.status}`;
        const cur = g.get(key) ?? { organization: p.org, region: "—", subdivision: "—", status: p.status, count: 0 };
        cur.count++; g.set(key, cur);
      }
      matrix = Array.from(g.values());
      totalProps = fp.length;
      leased = fp.filter((p) => LEASED.has(p.status)).length;
      stable = fp.filter((p) => STABLE.has(p.status)).length;
      const rs = fp.filter((p) => p.rent != null && p.uw != null);
      const sr = rs.reduce((s, p) => s + (p.rent as number), 0);
      const su = rs.reduce((s, p) => s + (p.uw as number), 0);
      rentVar = su ? sr / su - 1 : null;
    } else {
      matrix = d.propertySummary.filter((r) =>
        (f.org === ALL || r.organization === f.org) && (f.status === ALL || r.status === f.status));
      totalProps = matrix.reduce((s, r) => s + r.count, 0);
      leased = matrix.filter((r) => LEASED.has(r.status)).reduce((s, r) => s + r.count, 0);
      stable = matrix.filter((r) => STABLE.has(r.status)).reduce((s, r) => s + r.count, 0);
    }
    return { matrix, totalProps, totalTenants: leased, occupancy: stable ? leased / stable : null, rentVar };
  }, [fullMode, props, f, d.propertySummary, d.kpis.rentVar]);

  const k = d.kpis;
  const isSample = d._meta.source === "SAMPLE";
  // Portfolio-wide tiles can't be re-filtered from cached aggregates.
  const port = (v: number | null) => (active ? null : v);

  const slicer = (label: string, key: keyof Filters, options: string[]) => (
    <div className="slicer" key={label}>
      <h4>{label}</h4>
      {options.length ? (
        <select className="control" value={f[key]} onChange={(e) => set(key, e.target.value)}>
          <option value={ALL}>All</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <select className="control" disabled defaultValue="all" style={{ opacity: 0.55 }} title="Needs the per-property refresh">
          <option value="all">All</option>
        </select>
      )}
    </div>
  );

  return (
    <div className="app">
      <aside className="rail">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo" src="/resihome-logo.png" alt="ResiHome" />
        <div className="accent" />
        <div className="tagline">OPERATIONS · SUMMARY</div>

        {slicer("Organization", "org", opts.org)}
        {slicer("Property Status", "status", opts.status)}
        {slicer("Pod / Region", "region", opts.region.length ? opts.region : opts.pod)}
        {slicer("PM Assigned", "pm", opts.pm)}
        {slicer("APM Assigned", "apm", opts.apm)}
        {slicer("Subdivision", "subdivision", opts.subdivision)}
        <div className="slicer">
          <h4>Address Search</h4>
          <input className="control" placeholder={fullMode ? "Search address…" : "—"} disabled={!fullMode}
            value={f.address} onChange={(e) => set("address", e.target.value)} style={fullMode ? {} : { opacity: 0.55 }} />
        </div>
        {slicer("Tenant Delinquent Status", "delinquent", opts.delinquent)}

        {active && (
          <button className="control" style={{ marginTop: 12, cursor: "pointer", color: "var(--brand-dark)", width: "100%" }}
            onClick={() => setF(EMPTY)}>Clear filters ✕</button>
        )}
      </aside>

      <main className="canvas">
        <div className="pagehead">
          <h1>Summary</h1>
          <div className="ctx">
            {isSample ? "Sample" : "Live · Snowflake"} · active portfolio ·{" "}
            {new Date(d._meta.generatedAt).toLocaleString("en-US")}
          </div>
        </div>

        {!fullMode && (
          <div className="banner">
            Filtering is limited to Organization &amp; Property Status until the per-property
            refresh runs (then all slicers + every property tile filter live).
          </div>
        )}
        {active && (
          <div className="banner">Filtered — property tiles &amp; Property Summary reflect the selection; monthly tiles are portfolio-wide.</div>
        )}

        <div className="grid kpi-row">
          <KpiCard label="Total Properties" value={show(totalProps, num)} />
          <KpiCard label="Occupancy %" value={show(occupancy, (n) => pct(n))} />
          <KpiCard label="Active Listings" value={show(port(k.activeListings), num)} />
          <KpiCard label="Total Tenants" value={show(totalTenants, num)} />
          <KpiCard label="vs. UW Rent" value={show(rentVar, (n) => pct(n))}
            tone={rentVar == null ? undefined : rentVar >= 0 ? "pos" : "neg"} />
          <KpiCard label="Holding Fees" value={show(port(k.holdingFees), num)} />
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
          <KpiCard label="Proj / Actual MIs" value={show(port(k.projActualMis), num)} />
          <KpiCard label="Net Occupancy Gain" value={show(port(k.netOccupancyGain), num)} />
          <KpiCard label="Turnover %" value={show(port(k.turnoverPct), (n) => pct(n))} />
        </div>

        <div className="section-title">Property Summary</div>
        {matrix.length ? <PropertySummaryTable rows={matrix} />
          : <div className="card" style={{ color: "var(--muted)" }}>No properties match the filter.</div>}

        <div className="section-title">Monthly KPI Trend</div>
        {d.monthlyTrend.length ? <MonthlyTrendTable rows={d.monthlyTrend} />
          : <div className="card" style={{ color: "var(--muted)" }}>Monthly KPI trend — pending.</div>}
      </main>
    </div>
  );
}
