"use client";

import { useState } from "react";
import type { PropertySummaryRow } from "@/lib/types";
import { STATUS_BUCKETS, statusBucket } from "@/lib/types";
import { num } from "@/lib/format";

// "Property Summary": columns are status roll-ups (Off Market | On Market |
// Leased | Turnkey) + Total. Rows expand Organization → Region → Subdivision
// via the +/- button; clicking a row cross-filters the rest of the page.
type Agg = { buckets: Record<string, number>; total: number };
type Pick = { org: string; region?: string; subdivision?: string };
type Sel = { org: string | null; region: string | null; subdivision: string | null };
const emptyAgg = (): Agg => ({ buckets: Object.fromEntries(STATUS_BUCKETS.map((b) => [b, 0])), total: 0 });
const add = (a: Agg, status: string, c: number) => {
  a.total += c;
  const b = statusBucket(status);
  if (b) a.buckets[b] += c;
};
const byTotal = <T extends { agg: Agg }>(e: [string, T][]) => e.sort((a, b) => b[1].agg.total - a[1].agg.total);

export function PropertySummaryTable({ rows, drilldown = false, onPick, sel }: {
  rows: PropertySummaryRow[];
  drilldown?: boolean;
  onPick?: (p: Pick) => void;
  sel?: Sel;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // Organization → Region → Subdivision aggregation.
  const orgs = new Map<string, { agg: Agg; regions: Map<string, { agg: Agg; subs: Map<string, Agg> }> }>();
  for (const r of rows) {
    const o = orgs.get(r.organization) ?? { agg: emptyAgg(), regions: new Map() };
    add(o.agg, r.status, r.count);
    if (drilldown) {
      const reg = o.regions.get(r.region) ?? { agg: emptyAgg(), subs: new Map() };
      add(reg.agg, r.status, r.count);
      const sub = reg.subs.get(r.subdivision) ?? emptyAgg();
      add(sub, r.status, r.count);
      reg.subs.set(r.subdivision, sub);
      o.regions.set(r.region, reg);
    }
    orgs.set(r.organization, o);
  }

  const orgEntries = byTotal([...orgs.entries()]);
  const colTotal = (b: string) => orgEntries.reduce((s, [, o]) => s + o.agg.buckets[b], 0);
  const grand = orgEntries.reduce((s, [, o]) => s + o.agg.total, 0);

  const allKeys: string[] = [];
  for (const [orgName, o] of orgEntries) {
    if (o.regions.size) allKeys.push(orgName);
    for (const [regName, reg] of o.regions) if (reg.subs.size) allKeys.push(`${orgName}|${regName}`);
  }
  const canDrill = drilldown && allKeys.length > 0;

  const valueCells = (a: Agg) => (
    <>
      {STATUS_BUCKETS.map((b) => <td key={b}>{num(a.buckets[b])}</td>)}
      <td>{num(a.total)}</td>
    </>
  );
  const drill = (key: string, expandable: boolean) =>
    expandable ? (
      <button
        type="button"
        className="drill-btn"
        aria-label={open.has(key) ? "Collapse" : "Expand"}
        onClick={(e) => { e.stopPropagation(); toggle(key); }}
      >
        {open.has(key) ? "−" : "+"}
      </button>
    ) : <span className="drill-spacer" />;

  const pick = (p: Pick) => onPick?.(p);
  const rowCls = (base: string, on: boolean) => `${base}${onPick ? " row-pick" : ""}${on ? " picked" : ""}`;

  const trs: React.ReactNode[] = [];
  for (const [orgName, o] of orgEntries) {
    const oExpandable = drilldown && o.regions.size > 0;
    const oOn = !!sel && sel.org === orgName && !sel.region && !sel.subdivision;
    trs.push(
      <tr key={orgName} className={rowCls("lvl0", oOn)} onClick={() => pick({ org: orgName })}>
        <td className="lbl">{drill(orgName, oExpandable)}{orgName}</td>
        {valueCells(o.agg)}
      </tr>
    );
    if (!open.has(orgName)) continue;

    for (const [regName, reg] of byTotal([...o.regions.entries()])) {
      const rKey = `${orgName}|${regName}`;
      const rExpandable = reg.subs.size > 0;
      const rOn = !!sel && sel.org === orgName && sel.region === regName && !sel.subdivision;
      trs.push(
        <tr key={rKey} className={rowCls("lvl1", rOn)} onClick={() => pick({ org: orgName, region: regName })}>
          <td className="lbl">{drill(rKey, rExpandable)}{regName}</td>
          {valueCells(reg.agg)}
        </tr>
      );
      if (!open.has(rKey)) continue;

      for (const [subName, sub] of [...reg.subs.entries()].sort((a, b) => b[1].total - a[1].total)) {
        const sOn = !!sel && sel.org === orgName && sel.region === regName && sel.subdivision === subName;
        trs.push(
          <tr key={`${rKey}|${subName}`} className={rowCls("lvl2", sOn)}
            onClick={() => pick({ org: orgName, region: regName, subdivision: subName })}>
            <td className="lbl"><span className="drill-spacer" />{subName}</td>
            {valueCells(sub)}
          </tr>
        );
      }
    }
  }

  return (
    <>
      {canDrill && (
        <div className="tbl-toolbar">
          <button type="button" className="tbl-btn" onClick={() => setOpen(new Set(allKeys))}>⊞ Expand all</button>
          <button type="button" className="tbl-btn" onClick={() => setOpen(new Set())}>⊟ Collapse all</button>
        </div>
      )}
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th className="lbl">Organization{drilldown ? " › Region › Subdivision" : ""}</th>
              {STATUS_BUCKETS.map((b) => <th key={b}>{b}</th>)}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>{trs}</tbody>
          <tfoot>
            <tr>
              <td className="lbl">Total</td>
              {STATUS_BUCKETS.map((b) => <td key={b}>{num(colTotal(b))}</td>)}
              <td>{num(grand)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
