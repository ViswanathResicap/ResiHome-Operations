"use client";

// Generic PBI-styled page for the operational tabs. Fetches a normalized
// TabPayload from the given endpoint (server-filtered by org/region) and
// renders the header, KPI strip, tables, and "pending source" stubs.

import { useCallback, useEffect, useState } from "react";
import { getCachedPayload, setCachedPayload } from "@/lib/client-cache";

interface Kpi { label: string; value: string; tone?: "pos" | "neg" }
interface Table { title: string; blue?: boolean; headers: string[]; aligns?: ("l" | "r")[]; rows: string[][]; note?: string }
interface Stub { title: string; note: string }
interface Payload { generatedAt: string; kpis: Kpi[]; tables: Table[]; stubs?: Stub[]; filters?: { orgs: string[]; regions: string[] }; errors?: string[] }

export function TabPage({ title, endpoint, kpiCols = 6 }: { title: string; endpoint: string; kpiCols?: number }) {
  const [org, setOrg] = useState("");
  const [region, setRegion] = useState("");
  const [d, setD] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    const qs = new URLSearchParams();
    if (org) qs.set("org", org);
    if (region) qs.set("region", region);
    const key = `${endpoint}?${qs.toString()}`;
    // Show any cached copy instantly, then refresh in the background.
    const cached = getCachedPayload<Payload>(key);
    if (cached && !force) { setD(cached); setLoading(false); } else { setLoading(true); }
    setErr(null);
    try {
      const r = await fetch(key, force ? { cache: "no-store" } : undefined);
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
      setCachedPayload(key, j);
      setD(j as Payload);
    } catch (e) { if (!cached) setErr((e as Error).message); } finally { setLoading(false); }
  }, [endpoint, org, region]);
  useEffect(() => { load(); }, [load]);

  const hasFilters = !!d?.filters;

  return (
    <div className="app pbi">
      <aside className="rail">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="logo" src="/resihome-logo.png" alt="ResiHome" />
        {hasFilters && (<>
          <div className="slicer"><h4>Organization</h4>
            <select className="control dd-input" value={org} onChange={(e) => setOrg(e.target.value)}>
              <option value="">All</option>{(d!.filters!.orgs ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
            </select></div>
          <div className="slicer"><h4>Region</h4>
            <select className="control dd-input" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">All</option>{(d!.filters!.regions ?? []).map((r) => <option key={r} value={r}>{r}</option>)}
            </select></div>
          {(org || region) && <button className="dd-clear" onClick={() => { setOrg(""); setRegion(""); }}>Clear filters ✕</button>}
        </>)}
      </aside>

      <main className="canvas">
        <div className="pagehead">
          <h1>{title}</h1>
          <div className="ctx">
            {d ? `Live · Snowflake · updated ${new Date(d.generatedAt).toLocaleString("en-US")}` : "Loading…"}
            {loading && <span className="refresh-pill"><span className="spin">↻</span> loading…</span>}
            <button className="refresh-btn" onClick={() => load(true)} aria-busy={loading}><span className={loading ? "spin" : ""}>↻</span> Refresh</button>
          </div>
        </div>
        {loading && <div className="refresh-bar" aria-hidden />}
        {err && <div className="banner">Couldn’t load live data: {err}</div>}
        {d?.errors?.length ? <div className="banner">Some measures returned errors: {d.errors[0]}{d.errors.length > 1 ? ` (+${d.errors.length - 1} more)` : ""}</div> : null}
        {!d && loading && <div className="p-loading">Loading live data…</div>}

        {d && (<>
          {d.kpis.length > 0 && (
            <div className="p-grid" style={{ gridTemplateColumns: `repeat(${Math.min(kpiCols, d.kpis.length)},1fr)`, marginTop: 4 }}>
              {d.kpis.map((kp, i) => (
                <div className="p-card" key={i}><div className={`v${kp.tone ? " " + (kp.tone === "pos" ? "good" : "bad") : ""}`}>{kp.value}</div><div className="l">{kp.label}</div></div>
              ))}
            </div>
          )}

          {d.tables.map((t, ti) => (
            <div key={ti} style={{ marginTop: 16 }}>
              <div className="p-tbl-title">{t.title}</div>
              <div className="p-tbl-wrap" style={{ maxHeight: 460 }}>
                <table className={`p-tbl${t.blue ? " blue" : ""}`}>
                  <thead><tr>{t.headers.map((h, i) => <th key={i} className={(t.aligns?.[i] ?? "r") === "l" ? "lbl" : undefined}>{h}</th>)}</tr></thead>
                  <tbody>
                    {t.rows.map((row, ri) => (
                      <tr key={ri}>{row.map((cell, ci) => <td key={ci} className={(t.aligns?.[ci] ?? "r") === "l" ? "lbl" : undefined}>{cell}</td>)}</tr>
                    ))}
                    {!t.rows.length && <tr><td className="lbl" colSpan={t.headers.length} style={{ color: "var(--p-muted)" }}>No rows.</td></tr>}
                  </tbody>
                </table>
              </div>
              {t.note && <div style={{ fontSize: 11, color: "var(--p-muted)", marginTop: 4 }}>{t.note}</div>}
            </div>
          ))}

          {d.stubs && d.stubs.length > 0 && (
            <div className="p-grid" style={{ gridTemplateColumns: `repeat(${Math.min(3, d.stubs.length)},1fr)`, marginTop: 18 }}>
              {d.stubs.map((s, i) => (
                <div key={i} style={{ minHeight: 130, border: "1px dashed var(--p-line)", borderRadius: 3, display: "grid", placeItems: "center", textAlign: "center", color: "var(--p-muted)", fontSize: 11, padding: 16 }}>
                  <div><div style={{ fontWeight: 700, color: "#8a8886", marginBottom: 3 }}>{s.title}</div>{s.note}</div>
                </div>
              ))}
            </div>
          )}
        </>)}
      </main>
    </div>
  );
}
