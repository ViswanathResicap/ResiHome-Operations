import type { MonthlyTrendRow } from "@/lib/types";
import { pct, usd, num } from "@/lib/format";

const cell = (v: number | null, fmt: (n: number) => string) =>
  v === null || v === undefined ? "—" : fmt(v);

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
              <td>{cell(r.homes, num)}</td>
              <td>{cell(r.avgRent, (n) => usd(n))}</td>
              <td>{cell(r.occBom, (n) => pct(n))}</td>
              <td>{cell(r.occEom, (n) => pct(n))}</td>
              <td>{cell(r.collections, (n) => pct(n))}</td>
              <td>{cell(r.renewal, (n) => pct(n))}</td>
              <td>{cell(r.turnover, (n) => pct(n))}</td>
              <td>{cell(r.netTurnCost, (n) => usd(n))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
