"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  placeholder?: string;
};

// Branded replacement for native <select> — a custom popup (rendered through a
// portal so the rail's overflow can't clip it) with a scrollable list, search
// for long lists, and single- or multi-select.
export function Dropdown({ label, options, selected, onChange, multiple = false, disabled, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const trigRef = useRef<HTMLButtonElement>(null);
  const panRef = useRef<HTMLDivElement>(null);

  const isDisabled = disabled || options.length === 0;

  const place = () => {
    const el = trigRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ top: r.bottom + 6, left: r.left, width: r.width });
  };

  useEffect(() => {
    if (!open) { setQuery(""); return; }
    place();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (trigRef.current?.contains(t) || panRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const reposition = () => place();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  const showSearch = options.length > 8;
  const filtered = query ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase())) : options;
  const summary = selected.length === 0 ? "All" : selected.length === 1 ? selected[0] : `${selected.length} selected`;

  const toggle = (o: string) => {
    if (multiple) onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]);
    else { onChange(selected.length === 1 && selected[0] === o ? [] : [o]); setOpen(false); }
  };

  return (
    <div className="slicer">
      <h4>{label}</h4>
      <button
        ref={trigRef}
        type="button"
        disabled={isDisabled}
        className={`dd-trigger${open ? " open" : ""}${selected.length ? " active" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={isDisabled ? "Available after the per-property refresh" : undefined}
      >
        <span className="dd-val">{isDisabled ? (placeholder ?? "All") : summary}</span>
        <span className="dd-caret" aria-hidden>▾</span>
      </button>

      {open && !isDisabled && rect && createPortal(
        <div ref={panRef} className="dd-panel" style={{ top: rect.top, left: rect.left, width: rect.width }}>
          {showSearch && (
            <input
              className="dd-search"
              autoFocus
              value={query}
              placeholder={`Search ${label.toLowerCase()}…`}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <div className="dd-actions">
            {multiple && <button type="button" className="dd-link" onClick={() => onChange(options.slice())}>Select all</button>}
            <button type="button" className="dd-link" onClick={() => onChange([])}>Clear</button>
          </div>
          <ul className="dd-list" role="listbox" aria-multiselectable={multiple}>
            {filtered.length === 0 ? (
              <li className="dd-empty">No matches</li>
            ) : (
              filtered.map((o) => {
                const on = selected.includes(o);
                return (
                  <li
                    key={o}
                    role="option"
                    aria-selected={on}
                    className={`dd-opt${on ? " on" : ""}`}
                    onClick={() => toggle(o)}
                  >
                    <span className={`dd-box${multiple ? "" : " radio"}${on ? " on" : ""}`} aria-hidden>{on ? "✓" : ""}</span>
                    <span className="dd-opt-label">{o}</span>
                  </li>
                );
              })
            )}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}
