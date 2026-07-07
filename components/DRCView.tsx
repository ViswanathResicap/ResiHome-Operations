"use client";

// DRC page — Lease-To-Own (LTO) pipeline + leads→approval conversion. Reuses
// the DRC datasets already computed by /api/summary-v2 (drcLto, drcConversion).

import { useCallback, useEffect, useMemo, useState } from "react";

type Num = number | null;
interface Lto { community: string; address: string; floorplan: string; newLeaseStart: string; sqft: Num; currentRent: Num; newRent: Num; rentGrowth: Num }
interface Conv { community: string; month: string; l: Num; hf: Num; al: Num; appr: Num; apprPct: Num }
interface V2 { generatedAt: string; selectedMonth: string; drcLto: Lto[]; drcConversion: Conv[]; errors?: string[] }

const fnum = (v: Num) => (v == null ? "—" : Math.round(Number(v)).toLocaleString("en-US"));
const fpct = (v: Num) => (v == null ? "—" : `${Number(v).toFixed(1)}%`);
const fmoney = (v: Num) => (v == null ? "—" : `$${Math.round(Number(v)).toLocaleString("en-US")}`);
const fdate = (v: string) => { if (!v) return "—"; const d = new Date(v); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US"); };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function lastMonth() { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${MON[d.getMonth()]} ${d.getFullYear()}`; }

export function DRCView() {
  const [d, setD] = useState<V2 | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const month = useMemo(() => lastMonth(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/summary-v2?month=${encodeURIComponent(month)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
      setD(j as V2);
    } catch (e) { setErr((e as Error).message); } finally { setLoading(false); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const kpis = useMemo(() => {
    if (!d) return null;
    const lto = d.drcLto ?? [], conv = d.drcConversion ?? [];
    const rg = lto.map((r) => r.rentGrowth).filter((v): v is number => v != null);
    return {
      ltoLeases: lto.length,
      avgRentGrowth: rg.length ? rg.reduce((a, b) => a + b, 0) / rg.length : null,
      leads: conv.reduce((a, r) => a + (r.l ?? 0), 0),
      apps: conv.reduce((a, r) => a + (r.al ?? 0), 0),
      appr: conv.reduce((a, r) => a + (r.appr ?? 0), 0),
    };
  }, [d]);
  const apprPct = kpis && kpis.apps ? (kpis.appr / kpis.apps) * 100 : null;

  return (
    <div className="app pbi">
      <aside className="rail">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo" src="/resihome-logo.png" alt="ResiHome" />
        <div className="slicer"><h4>Period</h4><div className="control dd-input" style={{ cursor: "default" }}>{month}</div></div>
      </aside>
      <main className="canvas">
        <div className="pagehead">
          <h1>DRC</h1>
          <div className="ctx">
            {d ? `Live · Snowflake · updated ${new Date(d.generatedAt).toLocaleString("en-US")}` : "Loading…"}
            {loading && <span className="refresh-pill"><span className="spin">↻</span> loading…</span>}
            <button className="refresh-btn" onClick={load} aria-busy={loading}><span className={loading ? "spin" : ""}>↻</span> Refresh</button>
          </div>
        </div>
        {loading && <div className="refresh-bar" aria-hidden />}
        {err && <div className="banner">Couldn’t load live data: {err}</div>}
        {!d && loading && <div className="p-loading">Loading DRC data…</div>}

        {d && kpis && (<>
          <div className="p-h1 u">DRC Conversion</div>
          <div className="p-grid" style={{ gridTemplateColumns: "repeat(5,1fr)" }}>
            <div className="p-card"><div className="v">{fnum(kpis.leads)}</div><div className="l">Leads</div></div>
            <div className="p-card"><div className="v">{fnum(kpis.apps)}</div><div className="l">Applications</div></div>
            <div className="p-card"><div className="v">{fnum(kpis.appr)}</div><div className="l">Approved</div></div>
            <div className="p-card"><div className="v">{fpct(apprPct)}</div><div className="l">Approval %</div></div>
            <div className="p-card"><div className="v">{fnum(kpis.ltoLeases)}</div><div className="l">LTO Leases</div></div>
          </div>

          <div className="p-grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 14, alignItems: "start" }}>
            <div>
              <div className="p-tbl-title">DRC LTO</div>
              <div className="p-tbl-wrap" style={{ maxHeight: 460 }}>
                <table className="p-tbl blue">
                  <thead><tr><th className="lbl">Community</th><th className="lbl">Address</th><th className="lbl">FP</th><th>New Lease</th><th>Sqft</th><th>Cur Rent</th><th>New Rent</th><th>RG</th></tr></thead>
                  <tbody>
                    {(d.drcLto ?? []).map((r, i) => (
                      <tr key={i}><td className="lbl">{r.community}</td><td className="lbl">{r.address}</td><td className="lbl">{r.floorplan || "—"}</td><td>{fdate(r.newLeaseStart)}</td><td>{fnum(r.sqft)}</td><td>{fmoney(r.currentRent)}</td><td>{fmoney(r.newRent)}</td><td className={r.rentGrowth != null && r.rentGrowth < 0 ? "neg" : "pos"}>{fpct(r.rentGrowth)}</td></tr>
                    ))}
                    {!(d.drcLto ?? []).length && <tr><td className="lbl" colSpan={8} style={{ color: "var(--p-muted)" }}>No LTO rows.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <div className="p-tbl-title">DRC Conversion by Community</div>
              <div className="p-tbl-wrap" style={{ maxHeight: 460 }}>
                <table className="p-tbl blue">
                  <thead><tr><th className="lbl">Community</th><th className="lbl">Month</th><th>Leads</th><th>HF</th><th>Apps</th><th>Appr</th><th>Appr %</th></tr></thead>
                  <tbody>
                    {(d.drcConversion ?? []).map((r, i) => (
                      <tr key={i}><td className="lbl">{r.community}</td><td className="lbl">{r.month}</td><td>{fnum(r.l)}</td><td>{fnum(r.hf)}</td><td>{fnum(r.al)}</td><td>{fnum(r.appr)}</td><td>{fpct(r.apprPct)}</td></tr>
                    ))}
                    {!(d.drcConversion ?? []).length && <tr><td className="lbl" colSpan={7} style={{ color: "var(--p-muted)" }}>No conversion rows.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>)}
      </main>
    </div>
  );
}
