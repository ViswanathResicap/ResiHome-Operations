"use client";

// Fixed-layout canvas that reproduces a Power BI page pixel-for-pixel: visuals
// are absolutely positioned at their exact PBIX coordinates on a canvas of the
// page's native size, then the whole canvas is scaled to fit the viewport width
// (like Power BI's "Fit to page"). Nothing reflows or shrinks individually —
// the layout stays identical to Power BI at every screen size.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const useIso = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function PbiCanvas({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useIso(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / width));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div ref={wrap} style={{ width: "100%", overflow: "hidden", height: height * scale }}>
      <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left", position: "relative" }}>
        {children}
      </div>
    </div>
  );
}

/** One absolutely-positioned visual box at exact PBIX (x, y, w, h). */
export function PbiBox({ x, y, w, h, children, pad = 0 }: { x: number; y: number; w: number; h: number; children: ReactNode; pad?: number }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, padding: pad, boxSizing: "border-box", overflow: "hidden" }}>
      {children}
    </div>
  );
}
