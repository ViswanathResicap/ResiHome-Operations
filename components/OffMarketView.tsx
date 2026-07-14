"use client";

// Power BI-fidelity "Vacant Off-Market / QC" page. Left rail = Total Off Market
// + Avg Days Off-Market KPIs and slicers; a strip of 11 QC-status hero tiles
// (count + avg days-in-status); then the dense Off-Market property table.

import { useEffect, useMemo, useRef, useState } from "react";
import type { OffMarketCache, OffMarketRow, OffMarketHero } from "@/lib/types";
import { SmartTable } from "@/components/SmartTable";
import { MultiSelect } from "@/components/MultiSelect";

const fnum = (v: number | null | undefined) => (v == null ? "—" : Math.round(Number(v)).toLocaleString("en-US"));
const fdec = (v: number | null | undefined, d = 1) => (v == null ? "—" : Number(v).toFixed(d));
const fdate = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-US") : "—");
const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => !!x))).sort();

// Hero tiles in the exact Power BI strip order. `bucket` keys hero.avgDaysInStatus.
const TILES: { label: string; key: keyof OffMarketHero | "squatterOther"; bucket: string; good?: boolean }[] = [
  { label: "Final Walk (Con QC)", key: "finalWalkConQC", bucket: "Final Walk - Schedule QC" },
  { label: "Send / Under Con", key: "sendUnderCon", bucket: "Send / Under Construction" },
  { label: "Not PC Passed", key: "notPcPassed", bucket: "Not PC Passed" },
  { label: "Squatter / Other", key: "squatterOther", bucket: "Squatter / Other" },
  { label: "Pending Maint", key: "pendingMaint", bucket: "Pending Maintenance" },
  { label: "Pending RRQC", key: "pendingRRQC", bucket: "Pending RRQC" },
  { label: "RRQC Fail", key: "rrqcFail", bucket: "RRQC Fail" },
  { label: "Missing Rently", key: "missingRently", bucket: "Missing Rently" },
  { label: "RTL - (Needs Photos)", key: "rtlNeedsPhotos", bucket: "Ready to List - Awaiting Photos", good: true },
  { label: "Ready to List - PL", key: "readyToListPL", bucket: "Ready to List - Prelease", good: true },
  { label: "Ready to List", key: "readyToList", bucket: "Ready to List - On Market", good: true },
];

type FilterKey = "org" | "region" | "subdivision" | "propertyStatus" | "reasonOffMarket" | "offMarketStatus";
type Filters = Record<FilterKey, string[]> & { address: string };
const EMPTY: Filters = { org: [], region: [], subdivision: [], propertyStatus: [], reasonOffMarket: [], offMarketStatus: [], address: "" };
const FILTER_KEYS: FilterKey[] = ["org", "region", "subdivision", "propertyStatus", "reasonOffMarket", "offMarketStatus"];

export function OffMarketView({ initialData }: { initialData: OffMarketCache }) {
  const [d, setD] = useState<OffMarketCache>(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [f, setF] = useState<Filters>(EMPTY);
  const inflight = useRef(false);
  const dataRef = useRef(d);
  useEffect(() => { dataRef.current = d; }, [d]);

  const load = async (fresh: boolean) => {
    if (inflight.current) return;
    inflight.current = true; setRefreshing(true);
    try {
      const r = await fetch(`/api/offmarket${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
      const j = r.ok ? ((await r.json()) as OffMarketCache) : null;
      if (j && j._meta) {
        const keep = dataRef.current._meta.source === "SNOWFLAKE" && j._meta.source !== "SNOWFLAKE";
        if (!keep) setD(j);
      }
    } catch { /* keep current */ } finally { inflight.current = false; setRefreshing(false); }
  };
  useEffect(() => {
    if (!d.rows.length || d._meta.source !== "SNOWFLAKE") load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const opts = useMemo(() => ({
    org: uniq(d.rows.map((r) => r.org)),
    region: uniq(d.rows.map((r) => r.region)),
    subdivision: uniq(d.rows.map((r) => r.subdivision)),
    propertyStatus: uniq(d.rows.map((r) => r.occupancyStatus)),
    reasonOffMarket: uniq(d.rows.map((r) => r.reasonOffMarket)),
    offMarketStatus: uniq(d.rows.map((r) => r.status)),
  }), [d.rows]);

  const active = FILTER_KEYS.some((k) => f[k].length > 0) || f.address !== "";
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((p) => ({ ...p, [k]: v }));

  const rows: OffMarketRow[] = useMemo(() => d.rows.filter((r) =>
    (!f.org.length || f.org.includes(r.org)) && (!f.region.length || f.region.includes(r.region)) &&
    (!f.subdivision.length || f.subdivision.includes(r.subdivision)) && (!f.propertyStatus.length || f.propertyStatus.includes(r.occupancyStatus)) &&
    (!f.reasonOffMarket.length || f.reasonOffMarket.includes(r.reasonOffMarket ?? "")) &&
    (!f.offMarketStatus.length || f.offMarketStatus.includes(r.status ?? "")) &&
    (!f.address || r.address.toLowerCase().includes(f.address.toLowerCase()))
  ), [d.rows, f]);

  const isSample = d._meta.source === "SAMPLE";
  const slicer = (label: string, key: FilterKey) => (
    <div className="slicer" key={key}><h4>{label}</h4>
      <MultiSelect options={opts[key]} selected={f[key]} onChange={(sel) => set(key, sel)} disabled={!opts[key].length} />
    </div>
  );

  const TH: string[] = ["Entity ID", "Owner", "Subdivision", "Floorplan", "Region", "Address", "Property Status", "Strategy", "Purchase Type", "PC Status", "Transfer Date", "Days Off-Mkt", "DIQ", "Con/Final Walk", "Off-Market Date", "Reason Off-Market", "WOs Open", "WOs Closed", "Last TKT", "Last WO Closed"];
  const AL: ("l" | "r")[] = ["l", "l", "l", "l", "l", "l", "l", "l", "l", "l", "r", "r", "r", "r", "r", "l", "r", "r", "r", "r"];
  const tableRows: string[][] = useMemo(() => rows.map((r) => [
    r.entityId, r.org, r.subdivision, r.floorplan || "—", r.region, r.address,
    r.occupancyStatus, "—", r.purchaseType || "—", r.pcStatus ?? "—", fdate(r.transferDate),
    fnum(r.daysOffMarket), fnum(r.diq), fdate(r.conCompleteOrFinalWalk), fdate(r.offMarketDate), r.reasonOffMarket ?? "—",
    fnum(r.wosOpen), fnum(r.wosClosed), fdate(r.lastTktCreated), fdate(r.lastWoClosed),
  ]), [rows]);

  return (
    <div className="app pbi">
      <aside className="rail">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo" src="/resihome-logo.png" alt="ResiHome" />
        <div className="kpi-mini"><div className="v">{fnum(d.offMarketSelected)}</div><div className="l">Total Off Market</div></div>
        <div className="kpi-mini"><div className="v">{fdec(d.avgDaysOffMarket, 1)}</div><div className="l">Avg Days Off-Market</div></div>
        {slicer("Organization", "org")}
        {slicer("Region", "region")}
        {slicer("Subdivision", "subdivision")}
        {slicer("Property Status", "propertyStatus")}
        {slicer("Reason Off Market", "reasonOffMarket")}
        {slicer("Off Market Status", "offMarketStatus")}
        <div className="slicer"><h4>Address Search</h4>
          <input className="control dd-input" placeholder="Search address…" value={f.address} onChange={(e) => set("address", e.target.value)} /></div>
        {active && <button className="dd-clear" onClick={() => setF(EMPTY)}>Clear filters ✕</button>}
      </aside>

      <main className="canvas">
        <div className="pagehead">
          <h1>Vacant Off-Market / QC</h1>
          <div className="ctx">
            {isSample ? "Sample" : "Live · Snowflake"} · updated {new Date(d._meta.generatedAt).toLocaleString("en-US")}
            {refreshing && <span className="refresh-pill"><span className="spin">↻</span> loading…</span>}
            <button className="refresh-btn" onClick={() => load(true)} aria-busy={refreshing}><span className={refreshing ? "spin" : ""}>↻</span> Refresh</button>
          </div>
        </div>
        {refreshing && <div className="refresh-bar" aria-hidden />}
        {d._meta.note && <div className="banner">{d._meta.note}</div>}

        {/* Hero tiles */}
        <div className="p-grid" style={{ gridTemplateColumns: "repeat(11,1fr)", marginTop: 6 }}>
          {TILES.map((t) => {
            const count = t.key === "squatterOther" ? `${d.hero.squatter} / ${d.hero.other}` : fnum(d.hero[t.key] as number);
            const days = d.hero.avgDaysInStatus[t.bucket];
            return (
              <div className={`p-card sm${t.good ? " pos" : ""}`} key={t.label} style={{ minHeight: 82 }}>
                <div className="v">{count}</div>
                <div className="l" style={{ fontSize: 10 }}>{t.label}</div>
                <div style={{ fontSize: 10, color: "var(--p-muted)", marginTop: 3 }}>{days != null ? fdec(days, 1) : "(Blank)"}</div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: "var(--p-muted)", margin: "3px 2px 0", textAlign: "right" }}>tile sub-value = avg Days in Status</div>

        {/* Off-Market table (sortable, resizable, exportable) */}
        <div style={{ marginTop: 14 }}>
          <SmartTable title={`Off-Market (${fnum(rows.length)})`} headers={TH} rows={tableRows} aligns={AL} maxHeight={560} exportName="Off-Market" />
        </div>
      </main>
    </div>
  );
}
