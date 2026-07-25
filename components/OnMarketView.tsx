"use client";

// Power BI-fidelity "On Market - Listings & Leads" page. Served from the committed
// PBI exports via /api/onmarket (data/onmarket-export.json): count charts + tables
// are computed from the exports; custom/weighted visuals (KPI cards, Leads Created,
// Self-Showings) are frozen to the report's values. Region slicer filters the tables.

import { useEffect, useMemo, useState } from "react";
import { SmartTable } from "@/components/SmartTable";
import { MultiSelect } from "@/components/MultiSelect";

type Num = number | null;
type Row = Record<string, string>;
interface OM {
  _meta: { generatedAt: string; note?: string };
  kpisTop: { activeListings: number; avgDom: Num; daysVacant: Num; leadsL7: Num; leadsWW: Num; appsL7: Num; netHfL7: Num; appConvL7: Num; miConvL7: Num };
  kpisActive: { activeListings: number; avgPrice: Num; listPerSqft: Num; concessionPct: Num; preListings: Num; mirThisMonth: Num; lListL7: Num; wShowingL7: Num; priceChangeL7: Num; wApps: Num; vsUw: Num };
  newListingsByMonth: { month: string; n: number }[];
  leadsCreated: { month: string; leads: number; appPct: Num; miPct: Num }[];
  domByRegion: { region: string; dom: Num }[];
  listingsByAgent: { agent: string; n: number }[];
  listingsByDom: { bucket: string; n: number }[];
  listings: Row[];
  agentPullThrough: { agent: string; mayApp: Num; mayMi: Num; junApp: Num; junMi: Num; totApp: Num; totMi: Num }[];
  selfShowingsByRegion: { region: string; n: number }[];
  selfShowingsByMonth: { month: string; n: number }[];
  issues: { accessL7: Num; needsCleanL7: Num; landscapeL7: Num; showingsYesterday: Num; showingsL7: Num; showingGrowth: Num };
  showings: Row[];
  filters: { orgs: string[]; regions: string[] };
}

const fnum = (v: Num) => (v == null ? "—" : Math.round(Number(v)).toLocaleString("en-US"));
const fpct = (v: Num) => (v == null ? "(Blank)" : `${Number(v).toFixed(1)}%`);
const fmoney = (v: Num) => (v == null ? "—" : `$${Math.round(Number(v)).toLocaleString("en-US")}`);
const fmoney2 = (v: Num) => (v == null ? "—" : `$${Number(v).toFixed(2)}`);
const fdec = (v: Num, d = 1) => (v == null ? "—" : Number(v).toFixed(d));
const bpct = (v: Num) => (v == null ? "" : `${Number(v).toFixed(1)}%`);

const Card = ({ v, l, cls }: { v: string; l: string; cls?: string }) => (
  <div className="p-card"><div className={`v${cls ? " " + cls : ""}`}>{v}</div><div className="l">{l}</div></div>
);

// Vertical bar chart (value above, label below).
function VBar({ data, color = "#118dff", fmtV = (n: number) => String(n) }: { data: { label: string; n: number }[]; color?: string; fmtV?: (n: number) => string }) {
  if (!data.length) return <div style={{ color: "var(--p-muted)", fontSize: 12, padding: 20 }}>No data.</div>;
  const max = Math.max(1, ...data.map((d) => d.n));
  const W = Math.max(300, data.length * 40), H = 190, pad = 26, bw = Math.min(30, (W - pad) / data.length - 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
      {data.map((d, i) => {
        const x = pad + i * ((W - pad) / data.length), h = ((H - pad - 18) * d.n) / max, y = H - pad - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={h} fill={color} rx={2} />
            <text x={x + bw / 2} y={y - 3} textAnchor="middle" fontSize="9" fontWeight="600" fill="var(--p-ink)">{fmtV(d.n)}</text>
            <text x={x + bw / 2} y={H - pad + 11} textAnchor="middle" fontSize="8" fill="var(--p-muted)">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

// Horizontal bar chart (label left).
function HBar({ data, color = "#8a2be2", max: mx }: { data: { label: string; n: number }[]; color?: string; max?: number }) {
  if (!data.length) return <div style={{ color: "var(--p-muted)", fontSize: 12, padding: 20 }}>No data.</div>;
  const max = mx ?? Math.max(1, ...data.map((d) => d.n));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 320, overflow: "auto" }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5 }}>
          <span style={{ width: 110, textAlign: "right", color: "var(--p-ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
          <div style={{ flex: 1, background: "#f0eff0", borderRadius: 2 }}>
            <div style={{ width: `${(d.n / max) * 100}%`, background: color, height: 12, borderRadius: 2 }} />
          </div>
          <span style={{ width: 28, color: "var(--p-muted)" }}>{d.n}</span>
        </div>
      ))}
    </div>
  );
}

const tableFrom = (rows: Row[]) => {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const body = rows.map((r) => headers.map((h) => String(r[h] ?? "")));
  return { headers, body };
};

export function OnMarketView() {
  const [region, setRegion] = useState<string[]>([]);
  const [d, setD] = useState<OM | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/onmarket", { cache: "no-store" });
        const j = await r.json();
        if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
        setD(j as OM);
      } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
    })();
  }, []);

  const listings = useMemo(() => (d && region.length ? d.listings.filter((r) => region.includes(r["Region"])) : d?.listings ?? []), [d, region]);
  const showings = useMemo(() => (d && region.length ? d.showings.filter((r) => region.includes(r["Region"])) : d?.showings ?? []), [d, region]);
  const lTbl = useMemo(() => tableFrom(listings), [listings]);
  const sTbl = useMemo(() => tableFrom(showings), [showings]);

  const kt = d?.kpisTop, ka = d?.kpisActive;

  return (
    <div className="app pbi">
      <aside className="rail">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo" src="/resihome-logo.png" alt="ResiHome" />
        <div className="slicer"><h4>Organization</h4><MultiSelect options={d?.filters.orgs ?? []} selected={[]} onChange={() => {}} disabled /></div>
        <div className="slicer"><h4>Region</h4><MultiSelect options={d?.filters.regions ?? []} selected={region} onChange={setRegion} /></div>
        {region.length > 0 && <button className="dd-clear" onClick={() => setRegion([])}>Clear ✕</button>}
      </aside>

      <main className="canvas">
        <div className="pagehead">
          <h1>On Market — Listings &amp; Leads</h1>
          <div className="ctx">{d ? `Power BI export · ${new Date(d._meta.generatedAt).toLocaleDateString("en-US")}` : "Loading…"}</div>
        </div>
        {err && <div className="banner">Couldn’t load: {err}</div>}
        {!d && loading && <div className="p-loading">Loading On Market…</div>}

        {d && kt && ka && (<>
          {/* Top KPI row */}
          <div className="p-grid" style={{ gridTemplateColumns: "repeat(9,1fr)" }}>
            <Card v={fnum(kt.activeListings)} l="Active Listings" />
            <Card v={fdec(kt.avgDom, 1)} l="Average DOM" />
            <Card v={fdec(kt.daysVacant, 1)} l="Days Vacant" />
            <Card v={fnum(kt.leadsL7)} l="Leads (L7)" />
            <Card v={fpct(kt.leadsWW)} l="Leads W/W" />
            <Card v={fnum(kt.appsL7)} l="Apps (L7)" />
            <Card v={fnum(kt.netHfL7)} l="Net HF (L7)" />
            <Card v={fpct(kt.appConvL7)} l="App Conv (L7)" />
            <Card v={fpct(kt.miConvL7)} l="MI Conv (L7)" />
          </div>

          {/* Top charts */}
          <div className="p-grid" style={{ gridTemplateColumns: "1fr 1.2fr 1fr", marginTop: 16, alignItems: "start" }}>
            <div className="p-panel"><div className="ph">New Listings by Month</div><VBar data={d.newListingsByMonth.map((m) => ({ label: m.month.replace(" 20", " '"), n: m.n }))} color="#7b3f9e" /></div>
            <div className="p-panel"><div className="ph">DOM (by Region)</div><VBar data={d.domByRegion.map((r) => ({ label: r.region.replace(/^\w+: /, ""), n: Math.round(Number(r.dom) || 0) }))} /></div>
            <div className="p-panel"><div className="ph">Leads Created</div>
              <VBar data={d.leadsCreated.map((m) => ({ label: m.month.replace(" 2026", ""), n: m.leads }))} color="#118dff" fmtV={(n) => n.toLocaleString()} />
              <div style={{ display: "flex", justifyContent: "space-around", fontSize: 10, color: "var(--p-muted)" }}>
                {d.leadsCreated.map((m) => <span key={m.month}>App {bpct(m.appPct)} · MI {bpct(m.miPct)}</span>)}
              </div>
            </div>
          </div>

          {/* Active Listings section */}
          <div className="p-h1 u" style={{ marginTop: 18 }}>Active Listings</div>
          <div className="p-grid" style={{ gridTemplateColumns: "repeat(11,1fr)" }}>
            <Card v={fnum(ka.activeListings)} l="Active Listings" />
            <Card v={fmoney(ka.avgPrice)} l="Avg Price" />
            <Card v={fmoney2(ka.listPerSqft)} l="$ / SQFT" />
            <Card v={fpct(ka.concessionPct)} l="Concession %" />
            <Card v={fnum(ka.preListings)} l="Pre-Listings" />
            <Card v={fnum(ka.mirThisMonth)} l="MIR This Mo" />
            <Card v={fpct(ka.lListL7)} l="L / List L7" />
            <Card v={fpct(ka.wShowingL7)} l="W/Showing L7" />
            <Card v={fpct(ka.priceChangeL7)} l="Price Change L7" />
            <Card v={fpct(ka.wApps)} l="w/Apps" />
            <Card v={fpct(ka.vsUw)} l="Vs UW" cls={ka.vsUw != null && ka.vsUw < 0 ? "bad" : "good"} />
          </div>

          <div className="p-grid" style={{ gridTemplateColumns: "1fr 1.4fr", marginTop: 14, alignItems: "start" }}>
            <div className="p-panel"><div className="ph">Listings by Agent</div><HBar data={d.listingsByAgent.map((a) => ({ label: a.agent, n: a.n }))} /></div>
            <div className="p-panel"><div className="ph">Listings by DOM</div><VBar data={d.listingsByDom.map((b) => ({ label: b.bucket, n: b.n }))} color="#12239e" /></div>
          </div>

          {/* Active Listings table */}
          <div style={{ marginTop: 14 }}>
            <SmartTable title={`Active Listings (${fnum(listings.length)})`} headers={lTbl.headers} rows={lTbl.body} maxHeight={420} exportName="On-Market-Active-Listings" />
          </div>

          {/* Agent Pull Through — Monthly */}
          <div className="p-h2">Agent Pull Through — Monthly</div>
          <div className="p-tbl-wrap" style={{ maxHeight: 340 }}>
            <table className="p-tbl">
              <thead><tr>
                <th className="lbl">Agent</th><th>May App %</th><th>May MI %</th><th>June App %</th><th>June MI %</th><th>Total App %</th><th>Total MI %</th>
              </tr></thead>
              <tbody>
                {d.agentPullThrough.map((a, i) => (
                  <tr key={i}>
                    <td className="lbl">{a.agent}</td>
                    <td>{bpct(a.mayApp)}</td><td style={{ color: "#118dff" }}>{bpct(a.mayMi)}</td>
                    <td>{bpct(a.junApp)}</td><td style={{ color: "#118dff" }}>{bpct(a.junMi)}</td>
                    <td style={{ fontWeight: 700 }}>{bpct(a.totApp)}</td><td style={{ color: "#118dff", fontWeight: 700 }}>{bpct(a.totMi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 10.5, color: "var(--p-muted)", marginTop: 3 }}>Total columns are a simple May/June blend pending the volume counts (weighted Total in PBI).</div>

          {/* Showings */}
          <div className="p-h1" style={{ marginTop: 18 }}>Showings</div>
          <div className="p-grid" style={{ gridTemplateColumns: "repeat(6,1fr)" }}>
            <Card v={fnum(d.issues.accessL7)} l="Access Issue (L7)" />
            <Card v={fnum(d.issues.needsCleanL7)} l="Needs Clean/WO (L7)" />
            <Card v={fnum(d.issues.landscapeL7)} l="Landscape Issue (L7)" />
            <Card v={fnum(d.issues.showingsYesterday)} l="Showings Yesterday" />
            <Card v={fnum(d.issues.showingsL7)} l="Showings Last 7 Days" />
            <Card v={d.issues.showingGrowth == null ? "N/A" : fpct(d.issues.showingGrowth)} l="Showing Growth (W/W)" />
          </div>
          <div className="p-grid" style={{ gridTemplateColumns: "1.4fr 1fr", marginTop: 14, alignItems: "start" }}>
            <div className="p-panel"><div className="ph">Self-Showings by Region (Last 30 Days)</div><VBar data={d.selfShowingsByRegion.map((r) => ({ label: r.region.replace(/^\w+: /, ""), n: r.n }))} /></div>
            <div className="p-panel"><div className="ph">Self-Showings by Month</div><VBar data={d.selfShowingsByMonth.map((m) => ({ label: m.month.replace(" 20", " '"), n: m.n }))} color="#a1343c" fmtV={(n) => n.toLocaleString()} /></div>
          </div>
          <div style={{ marginTop: 14 }}>
            <SmartTable title={`Showings (${fnum(showings.length)})`} headers={sTbl.headers} rows={sTbl.body} maxHeight={380} exportName="On-Market-Showings" />
          </div>
        </>)}
      </main>
    </div>
  );
}
