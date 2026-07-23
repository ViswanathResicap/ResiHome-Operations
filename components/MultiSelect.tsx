"use client";

// Compact multi-select slicer: a dropdown of checkboxes with Select-all / Clear.
// Shows "All" when nothing is picked, the value when one, "N selected" for many.
// The dropdown panel is rendered in a PORTAL on <body> and positioned to the
// trigger with position:fixed — so it is never clipped by an ancestor's
// overflow:hidden (e.g. the Summary tab's fixed PbiCanvas boxes) or trapped by a
// transformed/stacked ancestor.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 2, width: r.width });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const reposition = () => place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const trigger = () => { if (!open) place(); setOpen((o) => !o); };
  const toggle = (o: string) => onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]);
  const summary = selected.length === 0 ? placeholder : selected.length === 1 ? selected[0] : `${selected.length} selected`;
  const shown = q ? options.filter((o) => o.toLowerCase().includes(q.toLowerCase())) : options;

  return (
    <div className="ms" ref={ref}>
      <button type="button" className="control dd-input ms-trigger" disabled={disabled} onClick={trigger}>
        <span className="ms-val">{summary}</span><span className="ms-caret">▾</span>
      </button>
      {open && !disabled && pos && typeof document !== "undefined" && createPortal(
        <div className="ms-pop" ref={popRef} style={{ left: pos.left, top: pos.top, width: pos.width }}>
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
        </div>,
        document.body,
      )}
    </div>
  );
}
