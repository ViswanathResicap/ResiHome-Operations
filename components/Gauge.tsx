import type { GaugeData } from "@/lib/types";
import { pct, usd, num } from "@/lib/format";

function fmt(v: number, f: GaugeData["format"]) {
  if (f === "percent") return pct(v);
  if (f === "currency") return usd(v);
  return num(v);
}

// 180° gauge: value & target mapped across [min,max].
export function Gauge({ g }: { g: GaugeData }) {
  const span = g.max - g.min || 1;
  const clamp = (v: number) => Math.max(0, Math.min(1, (v - g.min) / span));
  const a = clamp(g.value);
  const t = clamp(g.target);

  const R = 70, CX = 90, CY = 86, W = 14;
  const toXY = (frac: number) => {
    const ang = Math.PI * (1 - frac); // 180°→0°
    return [CX + R * Math.cos(ang), CY - R * Math.sin(ang)];
  };
  const arc = (f0: number, f1: number) => {
    const [x0, y0] = toXY(f0);
    const [x1, y1] = toXY(f1);
    // The gauge spans at most 180°, so the sweep is always the minor arc.
    return `M ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1}`;
  };
  // For cost gauges (higherIsBetter === false) being under target is good.
  const onTarget = (g.higherIsBetter ?? true) ? g.value >= g.target : g.value <= g.target;
  const valColor = onTarget ? "var(--good)" : "var(--warn)";

  return (
    <div className="card gauge">
      <div className="title">{g.label}</div>
      <svg viewBox="0 0 180 104" width="100%" height="104" role="img" aria-label={g.label}>
        <path d={arc(0, 1)} stroke="var(--line)" strokeWidth={W} fill="none" strokeLinecap="round" />
        <path d={arc(0, a)} stroke={valColor} strokeWidth={W} fill="none" strokeLinecap="round" />
        {(() => { const [tx, ty] = toXY(t); const [ix, iy] = toXY(Math.max(0, t - 0.001));
          return <line x1={ix} y1={iy} x2={tx} y2={ty} stroke="var(--ink)" strokeWidth={3} />; })()}
      </svg>
      <div className="readout" style={{ color: valColor }}>{fmt(g.value, g.format)}</div>
      <div className="target">Target {fmt(g.target, g.format)}</div>
    </div>
  );
}
