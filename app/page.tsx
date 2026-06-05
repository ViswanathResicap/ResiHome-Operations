import { getSummary } from "@/lib/summary";
import { KpiCard } from "@/components/KpiCard";
import { Gauge } from "@/components/Gauge";
import { SlicerRail } from "@/components/SlicerRail";
import { PropertySummaryTable } from "@/components/PropertySummaryTable";
import { MonthlyTrendTable } from "@/components/MonthlyTrendTable";
import { pct, num } from "@/lib/format";

// Serve cached results, refreshed hourly (mirrors Power BI scheduled refresh).
export const revalidate = 3600;

const show = (v: number | null, fmt: (n: number) => string) =>
  v === null || v === undefined ? "—" : fmt(v);

export default async function SummaryPage() {
  const d = await getSummary();
  const k = d.kpis;
  const isSample = d._meta.source === "SAMPLE";

  return (
    <div className="app">
      <SlicerRail />
      <main className="canvas">
        <div className="pagehead">
          <h1>Summary</h1>
          <div className="ctx">
            {isSample ? "Sample" : "Live · Snowflake"} · active portfolio ·{" "}
            {new Date(d._meta.generatedAt).toLocaleString("en-US")}
          </div>
        </div>

        {isSample ? (
          <div className="banner">
            <strong>Sample data.</strong> {d._meta.note ?? ""} Set the{" "}
            <code>SNOWFLAKE_*</code> env vars to serve live figures.
          </div>
        ) : d._meta.note ? (
          <div className="banner">{d._meta.note}</div>
        ) : null}

        <div className="grid kpi-row">
          <KpiCard label="Total Properties" value={show(k.totalProperties, num)} />
          <KpiCard label="Occupancy %" value={show(k.occupancyPct, (n) => pct(n))} />
          <KpiCard label="Active Listings" value={show(k.activeListings, num)} />
          <KpiCard label="Total Tenants" value={show(k.totalTenants, num)} />
          <KpiCard
            label="vs. UW Rent"
            value={show(k.rentVar, (n) => pct(n))}
            tone={k.rentVar == null ? undefined : k.rentVar >= 0 ? "pos" : "neg"}
          />
          <KpiCard label="Holding Fees" value={show(k.holdingFees, num)} />
        </div>

        <div className="section-title">Monthly Performance</div>
        {d.gauges ? (
          <div className="grid gauge-row">
            <Gauge g={d.gauges.eomCollections} />
            <Gauge g={d.gauges.renewal} />
            <Gauge g={d.gauges.netTurnCost} />
            <Gauge g={d.gauges.internalMaintenance} />
          </div>
        ) : (
          <div className="card" style={{ color: "var(--muted)" }}>
            Gauges (EOM Collections · Renewal · Net Turn Cost · Internal
            Maintenance) — pending live wiring of the <code>0_Month</code> measures.
          </div>
        )}

        <div className="grid kpi-row" style={{ marginTop: 12 }}>
          <KpiCard label="Proj / Actual MIs" value={show(k.projActualMis, num)} />
          <KpiCard label="Net Occupancy Gain" value={show(k.netOccupancyGain, num)} />
          <KpiCard label="Turnover %" value={show(k.turnoverPct, (n) => pct(n))} />
        </div>

        <div className="section-title">Property Summary</div>
        {d.propertySummary.length ? (
          <PropertySummaryTable rows={d.propertySummary} />
        ) : (
          <div className="card" style={{ color: "var(--muted)" }}>No property summary rows.</div>
        )}

        <div className="section-title">Monthly KPI Trend</div>
        {d.monthlyTrend.length ? (
          <MonthlyTrendTable rows={d.monthlyTrend} />
        ) : (
          <div className="card" style={{ color: "var(--muted)" }}>
            Monthly KPI trend — pending live wiring of the <code>0_Month</code> measures.
          </div>
        )}
      </main>
    </div>
  );
}
