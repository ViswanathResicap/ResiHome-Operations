"use client";

// Compact multi-select slicer: a dropdown of checkboxes with Select-all / Clear.
// Shows "All" when nothing is picked, the value when one, "N selected" for many.
import { useEffect, useRef, useState } from "react";

export function MultiSelect({
  options, selected, onChange, placeholder = "All", disabled,
}: {
  options: string[];
  selected: string[];
  onChange: (s: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const toggle = (o: string) => onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]);
  const summary = selected.length === 0 ? placeholder : selected.length === 1 ? selected[0] : `${selected.length} selected`;
  const shown = q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options;

  return (
    <div className="ms" ref={ref}>
      <button type="button" className="control dd-input ms-trigger" disabled={disabled} onClick={() => setOpen((o) => !o)}>
        <span className="ms-val">{summary}</span><span className="ms-caret">▾</span>
      </button>
      {open && !disabled && (
        <div className="ms-pop">
          <div className="ms-actions">
            <button type="button" onClick={() => onChange(options.slice())}>Select all</button>
            <button type="button" onClick={() => onChange([])}>Clear</button>
          </div>
          {options.length > 8 && (
            <input className="ms-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          )}
          <div className="ms-list">
            {shown.map((o) => (
              <label key={o} className="ms-opt">
                <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
                <span>{o}</span>
              </label>
            ))}
            {!shown.length && <div className="ms-empty">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}
