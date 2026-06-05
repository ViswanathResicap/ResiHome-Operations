import { getSummaryCache } from "@/lib/cache";
import { KpiCard } from "@/components/KpiCard";
import { Gauge } from "@/components/Gauge";
import { SlicerRail } from "@/components/SlicerRail";
import { PropertySummaryTable } from "@/components/PropertySummaryTable";
import { MonthlyTrendTable } from "@/components/MonthlyTrendTable";
import { pct, usd, num } from "@/lib/format";

export const dynamic = "force-dynamic";

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
            Active portfolio · excludes Dispositions ·{" "}
            {new Date(d._meta.generatedAt).toLocaleString("en-US")}
          </div>
        </div>

        {isSample && (
          <div className="banner">
            <strong>Sample data.</strong> {d._meta.note ?? ""} Run{" "}
            <code>npm run refresh</code> (with Snowflake credentials) to populate
            real figures from the cached native queries.
          </div>
        )}

        <div className="grid kpi-row">
          <KpiCard label="Total Properties" value={num(k.totalProperties)} />
          <KpiCard label="Occupancy %" value={pct(k.occupancyPct)} />
          <KpiCard label="Active Listings" value={num(k.activeListings)} />
          <KpiCard label="Total Tenants" value={num(k.totalTenants)} />
          <KpiCard
            label="vs. UW Rent"
            value={pct(k.rentVar)}
            tone={k.rentVar >= 0 ? "pos" : "neg"}
          />
          <KpiCard label="Holding Fees" value={num(k.holdingFees)} />
        </div>

        <div className="section-title">Monthly Performance</div>
        <div className="grid gauge-row">
          <Gauge g={d.gauges.eomCollections} />
          <Gauge g={d.gauges.renewal} />
          <Gauge g={d.gauges.netTurnCost} />
          <Gauge g={d.gauges.internalMaintenance} />
        </div>

        <div className="grid kpi-row" style={{ marginTop: 12 }}>
          <KpiCard label="Proj / Actual MIs" value={num(k.projActualMis)} />
          <KpiCard label="Net Occupancy Gain" value={num(k.netOccupancyGain)} />
          <KpiCard label="Turnover %" value={pct(k.turnoverPct)} />
        </div>

        <div className="section-title">Property Summary</div>
        <PropertySummaryTable rows={d.propertySummary} />

        <div className="section-title">Monthly KPI Trend</div>
        <MonthlyTrendTable rows={d.monthlyTrend} />
      </main>
    </div>
  );
}
