export function KpiCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg";
}) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className={`value${tone ? " " + tone : ""}`}>{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}
