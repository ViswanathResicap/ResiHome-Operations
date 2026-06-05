import { getSummaryCache } from "@/lib/cache";
import { KpiCard } from "@/components/KpiCard";
import { Gauge } from "@/components/Gauge";
import { SlicerRail } from "@/components/SlicerRail";
import { PropertySummaryTable } from "@/components/PropertySummaryTable";
import { MonthlyTrendTable } from "@/components/MonthlyTrendTable";
import { pct, num } from "@/lib/format";

const show = (v: number | null, fmt: (n: number) => string) =>
  v === null || v === undefined ? "—" : fmt(v);

export default function SummaryPage() {
  const d = getSummaryCache();
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
        <div className="grid gauge-row">
          {([
            ["EOM Collections", d.gauges?.eomCollections],
            ["Renewal", d.gauges?.renewal],
            ["Net Turn Cost (All)", d.gauges?.netTurnCost],
            ["Internal Maintenance", d.gauges?.internalMaintenance],
          ] as const).map(([label, g]) =>
            g ? (
              <Gauge key={label} g={g} />
            ) : (
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
