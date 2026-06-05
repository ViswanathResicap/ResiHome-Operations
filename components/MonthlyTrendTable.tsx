import type { MonthlyTrendRow } from "@/lib/types";
import { pct, usd, num } from "@/lib/format";

// Replicates the monthly-KPI trend pivot (rows = month, the 0_Month measures).
export function MonthlyTrendTable({ rows }: { rows: MonthlyTrendRow[] }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Month</th>
            <th>Homes</th>
            <th>Avg Rent</th>
            <th>BOM Occ</th>
            <th>EOM Occ</th>
            <th>Collections</th>
            <th>Renewal</th>
            <th>Turnover</th>
            <th>Net Turn Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month}>
              <td>{r.month}</td>
              <td>{num(r.homes)}</td>
              <td>{usd(r.avgRent)}</td>
              <td>{pct(r.occBom)}</td>
              <td>{pct(r.occEom)}</td>
              <td>{pct(r.collections)}</td>
              <td>{pct(r.renewal)}</td>
              <td>{pct(r.turnover)}</td>
              <td>{usd(r.netTurnCost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
