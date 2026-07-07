"use client";

// Power BI-fidelity "On Market - Listings & Leads" page. Consumes /api/onmarket
// (live active-listing data from the DBT source). Leads-Created / 1099 Agent
// Review / Showings sections of the PBI page have no wired Snowflake source yet
// (DW_Leads / DW_Inspections / DW_Showings), so they render as clear stubs.

import { useCallback, useEffect, useMemo, useState } from "react";

type Num = number | null;
interface Listing { entityId: string; region: string; status: string; subdivision: string; floorplan: string; county: string; bed: Num; bath: Num; sqft: Num; price: Num; initPrice: Num; concession: string; agent: string; listingDate: string | null; dom: Num; address: string }
interface OM {
  generatedAt: string; errors?: string[];
  kpis: { activeListings: number; avgDom: Num; avgPrice: Num; listPerSqft: Num; concessionPct: Num; listingVar: Num };
  byMonth: { month: string; n: number }[];
  byAgent: { agent: string; n: number }[];
  byDom: { bucket: string; n: number }[];
  listings: Listing[];
  filters: { orgs: string[]; regions: string[] };
}

const fnum = (v: Num) => (v == null ? "—" : Math.round(Number(v)).toLocaleString("en-US"));
const fpct = (v: Num) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);
const fmoney = (v: Num) => (v == null ? "—" : `$${Math.round(Number(v)).toLocaleString("en-US")}`);
const fmoney2 = (v: Num) => (v == null ? "—" : `$${Number(v).toFixed(2)}`);
const fdec = (v: Num, d = 1) => (v == null ? "—" : Number(v).toFixed(d));
const fdate = (v: string | null) => { if (!v) return "—"; const d = new Date(v); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US"); };

const DOM_ORDER = ["0-7", "8-14", "15-30", "31-60", "61-90", "90+"];

// Vertical bar chart (labels below).
function VBar({ data, color = "#118dff", fmtV = (n: number) => String(n) }: { data: { label: string; n: number }[]; color?: string; fmtV?: (n: number) => string }) {
  if (!data.length) return <div style={{ color: "var(--p-muted)", fontSize: 12, padding: 20 }}>No data.</div>;
  const max = Math.max(1, ...data.map((d) => d.n));
  const W = Math.max(300, data.length * 46), H = 190, pad = 26, bw = Math.min(34, (W - pad) / data.length - 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
      {data.map((d, i) => {
        const x = pad + i * ((W - pad) / data.length), h = ((H - pad - 16) * d.n) / max, y = H - pad - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={h} fill={color} rx={2} />
            <text x={x + bw / 2} y={y - 3} textAnchor="middle" fontSize="9" fill="var(--p-ink)">{fmtV(d.n)}</text>
            <text x={x + bw / 2} y={H - pad + 11} textAnchor="middle" fontSize="8.5" fill="var(--p-muted)">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Horizontal bar chart (agent names left).
function HBar({ data, color = "#8a2be2" }: { data: { label: string; n: number }[]; color?: string }) {
  if (!data.length) return <div style={{ color: "var(--p-muted)", fontSize: 12, padding: 20 }}>No data.</div>;
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5 }}>
          <span style={{ width: 96, textAlign: "right", color: "var(--p-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
          <div style={{ flex: 1, background: "#f0eff0", borderRadius: 2 }}>
            <div style={{ width: `${(d.n / max) * 100}%`, background: color, height: 13, borderRadius: 2 }} />
          </div>
          <span style={{ width: 26, color: "var(--p-muted)" }}>{d.n}</span>
        </div>
      ))}
    </div>
  );
}

export function OnMarketView() {
  const [org, setOrg] = useState("");
  const [region, setRegion] = useState("");
  const [d, setD] = useState<OM | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    const qs = new URLSearchParams();
    if (org) qs.set("org", org);
    if (region) qs.set("region", region);
    try {
      const r = await fetch(`/api/onmarket?${qs.toString()}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
      setD(j as OM);
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, [org, region]);
  useEffect(() => { load(); }, [load]);

  const k = d?.kpis;
  const domData = useMemo(() => (d?.byDom ?? []).slice().sort((a, b) => DOM_ORDER.indexOf(a.bucket) - DOM_ORDER.indexOf(b.bucket)).map((b) => ({ label: b.bucket, n: b.n })), [d]);

  return (
    <div className="app pbi">
      <aside className="rail">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo" src="/resihome-logo.png" alt="ResiHome" />
        <div className="slicer"><h4>Organization</h4>
          <select className="control dd-input" value={org} onChange={(e) => setOrg(e.target.value)}>
            <option value="">All</option>{(d?.filters.orgs ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select></div>
        <div className="slicer"><h4>Region</h4>
          <select className="control dd-input" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All</option>{(d?.filters.regions ?? []).map((r) => <option key={r} value={r}>{r}</option>)}
          </select></div>
        {(org || region) && <button className="dd-clear" onClick={() => { setOrg(""); setRegion(""); }}>Clear filters ✕</button>}
      </aside>

      <main className="canvas">
        <div className="pagehead">
          <h1>On Market — Listings &amp; Leads</h1>
          <div className="ctx">
            {d ? `Live · Snowflake · updated ${new Date(d.generatedAt).toLocaleString("en-US")}` : "Loading…"}
            {loading && <span className="refresh-pill"><span className="spin">↻</span> loading…</span>}
            <button className="refresh-btn" onClick={load} aria-busy={loading}><span className={loading ? "spin" : ""}>↻</span> Refresh</button>
          </div>
        </div>
        {loading && <div className="refresh-bar" aria-hidden />}
        {err && <div className="banner">Couldn’t load live data: {err}</div>}
        {!d && loading && <div className="p-loading">Loading live listings…</div>}

        {d && (<>
          {/* Active Listings KPI strip */}
          <div className="p-h1 u">Active Listings</div>
          <div className="p-grid" style={{ gridTemplateColumns: "repeat(6,1fr)" }}>
            <div className="p-card"><div className="v">{fnum(k!.activeListings)}</div><div className="l">Active Listings</div></div>
            <div className="p-card"><div className="v">{fdec(k!.avgDom, 1)}</div><div className="l">Average DOM</div></div>
            <div className="p-card"><div className="v">{fmoney(k!.avgPrice)}</div><div className="l">Avg List Price</div></div>
            <div className="p-card"><div className="v">{fmoney2(k!.listPerSqft)}</div><div className="l">List $ / Sqft</div></div>
            <div className="p-card"><div className="v">{fpct(k!.concessionPct)}</div><div className="l">Concession %</div></div>
            <div className="p-card"><div className={`v ${k!.listingVar != null && k!.listingVar < 0 ? "bad" : "good"}`}>{fpct(k!.listingVar)}</div><div className="l">Listing Var</div></div>
          </div>

          {/* Charts row */}
          <div className="p-grid" style={{ gridTemplateColumns: "1.3fr 1fr 1fr", marginTop: 16, alignItems: "start" }}>
            <div className="p-panel"><div className="ph">New Listings by Month</div><VBar data={d.byMonth.map((m) => ({ label: m.month.replace(" 20", " '"), n: m.n }))} /></div>
            <div className="p-panel"><div className="ph">Listings by Agent</div><HBar data={d.byAgent.map((a) => ({ label: a.agent, n: a.n }))} /></div>
            <div className="p-panel"><div className="ph">Listings by DOM</div><VBar data={domData} color="#12239e" /></div>
          </div>

          {/* Active Listings table */}
          <div className="p-h2">Listings ({fnum(d.listings.length)})</div>
          <div className="p-tbl-wrap" style={{ maxHeight: 460 }}>
            <table className="p-tbl">
              <thead><tr>
                <th className="lbl">Entity ID</th><th className="lbl">Region</th><th className="lbl">Status</th><th className="lbl">Subdivision</th><th className="lbl">Floorplan</th><th className="lbl">County</th>
                <th>Bed</th><th>Bath</th><th>Sqft</th><th>List Price</th><th className="lbl">Concession</th><th className="lbl">Agent</th><th>Listing Date</th><th>DOM</th>
              </tr></thead>
              <tbody>
                {d.listings.map((r, i) => (
                  <tr key={i}>
                    <td className="lbl">{r.entityId}</td><td className="lbl">{r.region}</td><td className="lbl">{r.status}</td><td className="lbl">{r.subdivision || "—"}</td><td className="lbl">{r.floorplan || "—"}</td><td className="lbl">{r.county || "—"}</td>
                    <td>{fdec(r.bed, 0)}</td><td>{fdec(r.bath, 1)}</td><td>{fnum(r.sqft)}</td><td>{fmoney(r.price)}</td><td className="lbl">{r.concession || "—"}</td><td className="lbl">{r.agent}</td><td>{fdate(r.listingDate)}</td><td>{fnum(r.dom)}</td>
                  </tr>
                ))}
                {!d.listings.length && <tr><td className="lbl" colSpan={14} style={{ color: "var(--p-muted)" }}>No active listings match the filter.</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Leads / 1099 / Showings — pending sources */}
          <div className="p-h1">Leads &amp; Showings</div>
          <div className="p-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            <div className="pbi-stub" style={{ minHeight: 150, border: "1px dashed var(--p-line)", borderRadius: 3, display: "grid", placeItems: "center", textAlign: "center", color: "var(--p-muted)", fontSize: 11, padding: 16 }}>
              <div><div style={{ fontWeight: 700, color: "#8a8886", marginBottom: 3 }}>Leads Created / Leads per DOM</div>Needs the leads source (DW_Leads / FCT_LEASING_TRANSACTION) — pending.</div>
            </div>
            <div className="pbi-stub" style={{ minHeight: 150, border: "1px dashed var(--p-line)", borderRadius: 3, display: "grid", placeItems: "center", textAlign: "center", color: "var(--p-muted)", fontSize: 11, padding: 16 }}>
              <div><div style={{ fontWeight: 700, color: "#8a8886", marginBottom: 3 }}>1099 Agent Review</div>Needs the inspections source (DW_Inspections) — pending.</div>
            </div>
            <div className="pbi-stub" style={{ minHeight: 150, border: "1px dashed var(--p-line)", borderRadius: 3, display: "grid", placeItems: "center", textAlign: "center", color: "var(--p-muted)", fontSize: 11, padding: 16 }}>
              <div><div style={{ fontWeight: 700, color: "#8a8886", marginBottom: 3 }}>Showings / Self-Showings</div>Needs the showings source (DW_Showings) — pending.</div>
            </div>
          </div>
        </>)}
      </main>
    </div>
  );
}
