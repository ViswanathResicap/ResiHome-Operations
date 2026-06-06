import type { PropertySummaryRow } from "@/lib/types";
import { STATUS_BUCKETS, statusBucket } from "@/lib/types";
import { num } from "@/lib/format";

// "Property Summary": rows = Organization, columns = status roll-ups
// (Off Market | On Market | Leased | Turnkey) + Total across every status.
export function PropertySummaryTable({ rows }: { rows: PropertySummaryRow[] }) {
  const orgs = Array.from(new Set(rows.map((r) => r.organization)));
  const byOrg = new Map<string, { buckets: Record<string, number>; total: number }>();
  for (const o of orgs) byOrg.set(o, { buckets: Object.fromEntries(STATUS_BUCKETS.map((b) => [b, 0])), total: 0 });
  for (const r of rows) {
    const d = byOrg.get(r.organization)!;
    d.total += r.count;
    const b = statusBucket(r.status);
    if (b) d.buckets[b] += r.count;
  }

  const orgRows = orgs.map((o) => ({ org: o, ...byOrg.get(o)! })).sort((a, b) => b.total - a.total);
  const colTotal = (b: string) => orgRows.reduce((s, r) => s + r.buckets[b], 0);
  const grand = orgRows.reduce((s, r) => s + r.total, 0);

  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Organization</th>
            {STATUS_BUCKETS.map((b) => <th key={b}>{b}</th>)}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {orgRows.map((r) => (
            <tr key={r.org}>
              <td>{r.org}</td>
              {STATUS_BUCKETS.map((b) => <td key={b}>{num(r.buckets[b])}</td>)}
              <td>{num(r.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            {STATUS_BUCKETS.map((b) => <td key={b}>{num(colTotal(b))}</td>)}
            <td>{num(grand)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
