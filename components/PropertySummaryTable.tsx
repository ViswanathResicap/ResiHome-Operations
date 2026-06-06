"use client";

import { useState } from "react";
import type { PropertySummaryRow } from "@/lib/types";
import { STATUS_BUCKETS, statusBucket } from "@/lib/types";
import { num } from "@/lib/format";

// "Property Summary": columns are status roll-ups (Off Market | On Market |
// Leased | Turnkey) + Total. With drilldown on, rows expand Organization →
// Region → Subdivision; otherwise a flat Organization pivot.
type Agg = { buckets: Record<string, number>; total: number };
const emptyAgg = (): Agg => ({ buckets: Object.fromEntries(STATUS_BUCKETS.map((b) => [b, 0])), total: 0 });
const add = (a: Agg, status: string, c: number) => {
  a.total += c;
  const b = statusBucket(status);
  if (b) a.buckets[b] += c;
};
const byTotal = <T extends { agg: Agg }>(e: [string, T][]) => e.sort((a, b) => b[1].agg.total - a[1].agg.total);

export function PropertySummaryTable({ rows, drilldown = false }: { rows: PropertySummaryRow[]; drilldown?: boolean }) {
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

  const orgEntries = byTotal([...orgs.entries()].map(([k, v]) => [k, v] as [string, { agg: Agg }])) as
    [string, { agg: Agg; regions: Map<string, { agg: Agg; subs: Map<string, Agg> }> }][];
  const colTotal = (b: string) => orgEntries.reduce((s, [, o]) => s + o.agg.buckets[b], 0);
  const grand = orgEntries.reduce((s, [, o]) => s + o.agg.total, 0);

  const valueCells = (a: Agg) => (
    <>
      {STATUS_BUCKETS.map((b) => <td key={b}>{num(a.buckets[b])}</td>)}
      <td>{num(a.total)}</td>
    </>
  );
  const chevron = (expandable: boolean, isOpen: boolean) =>
    <span className="chev">{expandable ? (isOpen ? "▾" : "▸") : ""}</span>;

  const trs: React.ReactNode[] = [];
  for (const [orgName, o] of orgEntries) {
    const oExpandable = drilldown && o.regions.size > 0;
    const oOpen = open.has(orgName);
    trs.push(
      <tr key={orgName} className={`lvl0${oExpandable ? " row-exp" : ""}`} onClick={oExpandable ? () => toggle(orgName) : undefined}>
        <td className="lbl">{chevron(oExpandable, oOpen)}{orgName}</td>
        {valueCells(o.agg)}
      </tr>
    );
    if (!oOpen) continue;

    const regEntries = byTotal([...o.regions.entries()]);
    for (const [regName, reg] of regEntries) {
      const rKey = `${orgName}|${regName}`;
      const rExpandable = reg.subs.size > 0;
      const rOpen = open.has(rKey);
      trs.push(
        <tr key={rKey} className={`lvl1${rExpandable ? " row-exp" : ""}`} onClick={rExpandable ? () => toggle(rKey) : undefined}>
          <td className="lbl">{chevron(rExpandable, rOpen)}{regName}</td>
          {valueCells(reg.agg)}
        </tr>
      );
      if (!rOpen) continue;

      const subEntries = [...reg.subs.entries()].sort((a, b) => b[1].total - a[1].total);
      for (const [subName, sub] of subEntries) {
        trs.push(
          <tr key={`${rKey}|${subName}`} className="lvl2">
            <td className="lbl">{chevron(false, false)}{subName}</td>
            {valueCells(sub)}
          </tr>
        );
      }
    }
  }

  return (
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
  );
}
