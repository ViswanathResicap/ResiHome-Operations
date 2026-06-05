import type { PropertySummaryRow } from "@/lib/types";
import { num } from "@/lib/format";

// Replicates the "Property Summary" pivot: rows = Organization > Region >
// Subdivision, columns = Occupancy status (matrix), values = property count.
export function PropertySummaryTable({ rows }: { rows: PropertySummaryRow[] }) {
  const statuses = Array.from(new Set(rows.map((r) => r.status))).sort();
  const orgs = Array.from(new Set(rows.map((r) => r.organization))).sort();

  const cell = (org: string, status: string) =>
    rows.filter((r) => r.organization === org && r.status === status)
        .reduce((s, r) => s + r.count, 0);
  const orgTotal = (org: string) =>
    rows.filter((r) => r.organization === org).reduce((s, r) => s + r.count, 0);
  const statusTotal = (status: string) =>
    rows.filter((r) => r.status === status).reduce((s, r) => s + r.count, 0);
  const grand = rows.reduce((s, r) => s + r.count, 0);

  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Organization</th>
            {statuses.map((s) => <th key={s}>{s}</th>)}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {orgs.map((org) => (
            <tr key={org}>
              <td>{org}</td>
              {statuses.map((s) => <td key={s}>{num(cell(org, s)) }</td>)}
              <td>{num(orgTotal(org))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            {statuses.map((s) => <td key={s}>{num(statusTotal(s))}</td>)}
            <td>{num(grand)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
