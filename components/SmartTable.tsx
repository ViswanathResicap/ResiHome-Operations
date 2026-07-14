"use client";

// Reusable table with: click-to-sort (asc/desc/none, numeric-aware),
// drag-to-resize columns (handle between headers), and export-to-Excel (CSV).
import { useMemo, useRef, useState } from "react";

type Cell = string | number;

export function SmartTable({
  title, headers, rows, aligns, blue, maxHeight = 460, exportName,
}: {
  title?: string;
  headers: string[];
  rows: Cell[][];
  aligns?: ("l" | "r")[];
  blue?: boolean;
  maxHeight?: number;
  exportName?: string;
}) {
  const [sort, setSort] = useState<{ c: number; d: 1 | -1 } | null>(null);
  const [widths, setWidths] = useState<Record<number, number>>({});
  const drag = useRef<{ c: number; x: number; w: number } | null>(null);

  const num = (v: Cell): number | null => {
    if (typeof v === "number") return v;
    const s = String(v ?? "").replace(/[$,%\s]/g, "");
    if (s === "" || s === "—") return null;
    const n = Number(s);
    return Number.isNaN(n) ? null : n;
  };

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const { c, d } = sort;
    return [...rows].sort((a, b) => {
      const an = num(a[c]), bn = num(b[c]);
      if (an !== null && bn !== null) return (an - bn) * d;
      if (an !== null) return -1 * d;            // numbers before blanks
      if (bn !== null) return 1 * d;
      return String(a[c] ?? "").localeCompare(String(b[c] ?? "")) * d;
    });
  }, [rows, sort]);

  const clickHead = (i: number) =>
    setSort((s) => (s && s.c === i ? (s.d === 1 ? { c: i, d: -1 } : null) : { c: i, d: 1 }));

  const startResize = (i: number, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
    drag.current = { c: i, x: e.clientX, w: widths[i] ?? th.offsetWidth };
    const move = (ev: MouseEvent) => {
      if (!drag.current) return;
      const w = Math.max(48, drag.current.w + (ev.clientX - drag.current.x));
      setWidths((p) => ({ ...p, [drag.current!.c]: w }));
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const exportCsv = () => {
    const esc = (v: Cell) => {
      const s = String(v ?? "");
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = [headers.map(esc).join(","), ...sorted.map((r) => r.map(esc).join(","))].join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (exportName || title || "table").replace(/[^\w.-]+/g, "_") + ".csv";
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 5px", gap: 8 }}>
        {title ? <div className="p-tbl-title" style={{ margin: 0 }}>{title}</div> : <span />}
        <button className="tbl-export" onClick={exportCsv} title="Export to Excel (CSV)">⤓ Excel</button>
      </div>
      <div className="p-tbl-wrap" style={{ maxHeight }}>
        <table className={`p-tbl${blue ? " blue" : ""}`}>
          <thead><tr>{headers.map((h, i) => (
            <th key={i} className={(aligns?.[i] ?? "r") === "l" ? "lbl" : undefined}
              style={{ width: widths[i], position: "relative", cursor: "pointer", userSelect: "none" }}
              onClick={() => clickHead(i)}>
              {h}{sort && sort.c === i ? (sort.d === 1 ? " ▲" : " ▼") : ""}
              <span onMouseDown={(e) => startResize(i, e)} onClick={(e) => e.stopPropagation()}
                style={{ position: "absolute", right: -1, top: 0, height: "100%", width: 7, cursor: "col-resize" }} />
            </th>
          ))}</tr></thead>
          <tbody>
            {sorted.map((r, ri) => (
              <tr key={ri}>{r.map((c, ci) => (
                <td key={ci} className={(aligns?.[ci] ?? "r") === "l" ? "lbl" : undefined} style={{ width: widths[ci] }}>{c}</td>
              ))}</tr>
            ))}
            {!sorted.length && <tr><td className="lbl" colSpan={headers.length} style={{ color: "var(--p-muted)" }}>No rows.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
