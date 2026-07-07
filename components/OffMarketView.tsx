"use client";

// Power BI-fidelity "Vacant Off-Market / QC" page. Left rail = Total Off Market
// + Avg Days Off-Market KPIs and slicers; a strip of 11 QC-status hero tiles
// (count + avg days-in-status); then the dense Off-Market property table.

import { useEffect, useMemo, useRef, useState } from "react";
import type { OffMarketCache, OffMarketRow, OffMarketHero } from "@/lib/types";

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
type Filters = Record<FilterKey, string> & { address: string };
const EMPTY: Filters = { org: "", region: "", subdivision: "", propertyStatus: "", reasonOffMarket: "", offMarketStatus: "", address: "" };

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

  const active = (Object.keys(EMPTY) as (keyof Filters)[]).some((k) => f[k] !== "");
  const set = (k: keyof Filters, v: string) => setF((p) => ({ ...p, [k]: v }));

  const rows: OffMarketRow[] = useMemo(() => d.rows.filter((r) =>
    (!f.org || r.org === f.org) && (!f.region || r.region === f.region) &&
    (!f.subdivision || r.subdivision === f.subdivision) && (!f.propertyStatus || r.occupancyStatus === f.propertyStatus) &&
    (!f.reasonOffMarket || (r.reasonOffMarket ?? "") === f.reasonOffMarket) &&
    (!f.offMarketStatus || (r.status ?? "") === f.offMarketStatus) &&
    (!f.address || r.address.toLowerCase().includes(f.address.toLowerCase()))
  ), [d.rows, f]);

  const isSample = d._meta.source === "SAMPLE";
  const slicer = (label: string, key: FilterKey) => (
    <div className="slicer" key={key}><h4>{label}</h4>
      <select className="control dd-input" value={f[key]} onChange={(e) => set(key, e.target.value)} disabled={!opts[key].length}>
        <option value="">All</option>{opts[key].map((o) => <option key={o} value={o}>{o}</option>)}
      </select></div>
  );

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

        {/* Off-Market table */}
        <div className="p-tbl-title" style={{ marginTop: 14 }}>Off-Market ({fnum(rows.length)})</div>
        <div className="p-tbl-wrap" style={{ maxHeight: 560 }}>
          <table className="p-tbl">
            <thead><tr>
              <th className="lbl">Entity ID</th><th className="lbl">Owner</th><th className="lbl">Subdivision</th><th className="lbl">Floorplan</th><th className="lbl">Region</th><th className="lbl">Address</th>
              <th className="lbl">Property Status</th><th className="lbl">Strategy</th><th className="lbl">Purchase Type</th><th className="lbl">PC Status</th><th>Transfer Date</th>
              <th>Days Off-Mkt</th><th>DIQ</th><th>Con/Final Walk</th><th>Off-Market Date</th><th className="lbl">Reason Off-Market</th>
              <th>WOs Open</th><th>WOs Closed</th><th>Last TKT</th><th>Last WO Closed</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="lbl">{r.entityId}</td><td className="lbl">{r.org}</td><td className="lbl">{r.subdivision}</td><td className="lbl">{r.floorplan || "—"}</td><td className="lbl">{r.region}</td><td className="lbl">{r.address}</td>
                  <td className="lbl">{r.occupancyStatus}</td><td className="lbl">—</td><td className="lbl">{r.purchaseType || "—"}</td><td className="lbl">{r.pcStatus ?? "—"}</td><td>{fdate(r.transferDate)}</td>
                  <td>{fnum(r.daysOffMarket)}</td><td>{fnum(r.diq)}</td><td>{fdate(r.conCompleteOrFinalWalk)}</td><td>{fdate(r.offMarketDate)}</td><td className="lbl status">{r.reasonOffMarket ?? "—"}</td>
                  <td>{fnum(r.wosOpen)}</td><td>{fnum(r.wosClosed)}</td><td>{fdate(r.lastTktCreated)}</td><td>{fdate(r.lastWoClosed)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td className="lbl" colSpan={20} style={{ color: "var(--p-muted)" }}>No off-market properties match the filter.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
