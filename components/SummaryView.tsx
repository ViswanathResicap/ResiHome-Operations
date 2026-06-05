"use client";

import { useMemo, useState } from "react";
import type { SummaryCache } from "@/lib/types";
import { KpiCard } from "./KpiCard";
import { Gauge } from "./Gauge";
import { PropertySummaryTable } from "./PropertySummaryTable";
import { MonthlyTrendTable } from "./MonthlyTrendTable";
import { pct, num } from "@/lib/format";

const ALL = "All";
const LEASED = new Set(["Tenant Leased", "Trustee Leased"]);
const show = (v: number | null, fmt: (n: number) => string) =>
  v == null ? "—" : fmt(v);

export function SummaryView({ data: d }: { data: SummaryCache }) {
  const [org, setOrg] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);

  const orgs = useMemo(
    () => Array.from(new Set(d.propertySummary.map((r) => r.organization))).sort(),
    [d.propertySummary]
  );
  const statuses = useMemo(
    () => Array.from(new Set(d.propertySummary.map((r) => r.status))).sort(),
    [d.propertySummary]
  );

  const filtered = useMemo(
    () =>
      d.propertySummary.filter(
        (r) => (org === ALL || r.organization === org) && (status === ALL || r.status === status)
      ),
    [d.propertySummary, org, status]
  );

  const isFiltered = org !== ALL || status !== ALL;
  // Total Properties & Total Tenants derive cleanly from the (filtered) matrix.
  const totalProps = isFiltered
    ? filtered.reduce((s, r) => s + r.count, 0)
    : d.kpis.totalProperties;
  const totalTenants = isFiltered
    ? filtered.filter((r) => LEASED.has(r.status)).reduce((s, r) => s + r.count, 0)
    : d.kpis.totalTenants;

  const k = d.kpis;
  const isSample = d._meta.source === "SAMPLE";

  return (
    <div className="app">
      <aside className="rail">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo" src="/resihome-logo.png" alt="ResiHome" />
        <div className="accent" />
        <div className="tagline">OPERATIONS · SUMMARY</div>

        <div className="slicer">
          <h4>Organization</h4>
          <select className="control" value={org} onChange={(e) => setOrg(e.target.value)}>
            <option value={ALL}>All</option>
            {orgs.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
        <div className="slicer">
          <h4>Property Status</h4>
          <select className="control" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value={ALL}>All</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {isFiltered && (
          <button
            className="control"
            style={{ marginTop: 10, cursor: "pointer", color: "var(--brand-dark)", width: "100%" }}
            onClick={() => { setOrg(ALL); setStatus(ALL); }}
          >
            Clear filters ✕
          </button>
        )}

        {[
          "Pod / Region", "PM / APM Assigned", "Subdivision",
          "Address Search", "Tenant Delinquent Status", "Month",
        ].map((label) => (
          <div className="slicer" key={label} title="Granular filtering ships with the next data refresh">
            <h4>{label}</h4>
            <select className="control" disabled defaultValue="all" style={{ opacity: 0.55 }}>
              <option value="all">All</option>
            </select>
          </div>
        ))}
      </aside>

      <main className="canvas">
        <div className="pagehead">
          <h1>Summary</h1>
          <div className="ctx">
            {isSample ? "Sample" : "Live · Snowflake"} · active portfolio ·{" "}
            {new Date(d._meta.generatedAt).toLocaleString("en-US")}
          </div>
        </div>

        {isFiltered && (
          <div className="banner">
            Filtered{org !== ALL ? ` · ${org}` : ""}{status !== ALL ? ` · ${status}` : ""} —
            applies to Property Summary, Total Properties &amp; Total Tenants. Other tiles are
            portfolio-wide for now.
          </div>
        )}

        <div className="grid kpi-row">
          <KpiCard label="Total Properties" value={show(totalProps, num)} />
          <KpiCard label="Occupancy %" value={show(isFiltered ? null : k.occupancyPct, (n) => pct(n))} />
          <KpiCard label="Active Listings" value={show(isFiltered ? null : k.activeListings, num)} />
          <KpiCard label="Total Tenants" value={show(totalTenants, num)} />
          <KpiCard label="vs. UW Rent" value={show(isFiltered ? null : k.rentVar, (n) => pct(n))}
            tone={k.rentVar == null ? undefined : k.rentVar >= 0 ? "pos" : "neg"} />
          <KpiCard label="Holding Fees" value={show(isFiltered ? null : k.holdingFees, num)} />
        </div>

        <div className="section-title">Monthly Performance</div>
        <div className="grid gauge-row">
          {([
            ["EOM Collections", d.gauges?.eomCollections],
            ["Renewal", d.gauges?.renewal],
            ["Net Turn Cost (All)", d.gauges?.netTurnCost],
            ["Internal Maintenance", d.gauges?.internalMaintenance],
          ] as const).map(([label, g]) =>
            g ? <Gauge key={label} g={g} /> : (
              <div key={label} className="card gauge" style={{ color: "var(--muted)" }}>
                <div className="title">{label}</div>
                <div style={{ padding: "26px 0", fontSize: 12 }}>pending</div>
              </div>
            )
          )}
        </div>

        <div className="grid kpi-row" style={{ marginTop: 12 }}>
          <KpiCard label="Proj / Actual MIs" value={show(k.projActualMis, num)} />
          <KpiCard label="Net Occupancy Gain" value={show(k.netOccupancyGain, num)} />
          <KpiCard label="Turnover %" value={show(k.turnoverPct, (n) => pct(n))} />
        </div>

        <div className="section-title">Property Summary</div>
        {filtered.length ? (
          <PropertySummaryTable rows={filtered} />
        ) : (
          <div className="card" style={{ color: "var(--muted)" }}>No properties match the filter.</div>
        )}

        <div className="section-title">Monthly KPI Trend</div>
        {d.monthlyTrend.length ? (
          <MonthlyTrendTable rows={d.monthlyTrend} />
        ) : (
          <div className="card" style={{ color: "var(--muted)" }}>Monthly KPI trend — pending.</div>
        )}
      </main>
    </div>
  );
}
