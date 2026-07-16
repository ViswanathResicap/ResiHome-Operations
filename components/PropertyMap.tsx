"use client";

// Portfolio Summary map, styled to match the Power BI "Property Map" Azure Maps
// visual: a green terrain basemap with many small blue property bubbles clustered
// over each metro. The source data has no per-property lat/long (Power BI geocodes
// addresses at render time), so we scatter a deterministic cluster of bubbles
// around each metro centroid, sized in count to the region's property total — this
// reproduces the Azure "bubble layer" look and the relative density per metro.
// Leaflet is imported inside the effect so it never touches `window` during SSR.

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

// Metro centroids for the regions in the portfolio (lat, lng).
const CENTROIDS: Record<string, [number, number]> = {
  "GA: Atlanta": [33.749, -84.388], "SC: Greenville": [34.851, -82.394],
  "TX: Dallas": [32.777, -96.797], "FL: Tampa": [27.95, -82.457],
  "FL: Orlando": [28.538, -81.379], "TN: Nashville": [36.163, -86.781],
  "OK: Oklahoma City": [35.468, -97.516], "AL: Huntsville": [34.73, -86.586],
  "TX: Houston": [29.76, -95.369], "AL: Birmingham": [33.519, -86.81],
  "FL: Jacksonville": [30.332, -81.656], "NC: Charlotte": [35.227, -80.843],
  "AZ: Phoenix": [33.448, -112.074], "FL: Miami": [25.762, -80.192],
  "GA: Savannah": [32.081, -81.091], "IN: Indianapolis": [39.768, -86.158],
  "FL: Space Coast": [28.296, -80.703], "FL: Cape Coral": [26.563, -81.95],
  "NC: Raleigh": [35.78, -78.639], "NC: Greensboro": [36.073, -79.792],
  "SC: Columbia": [34.001, -81.035], "SC: Charleston": [32.777, -79.931],
  "TN: Memphis": [35.149, -90.049], "TX: San Antonio": [29.424, -98.494],
  "TX: Austin": [30.267, -97.743], "FL: Fort Myers": [26.64, -81.872],
};

export interface MapRegion { region: string; total: number }

// Deterministic PRNG (mulberry32) so the scatter is stable across re-renders.
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

export function PropertyMap({ regions }: { regions: MapRegion[] }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !elRef.current || mapRef.current) return;
      const map = L.map(elRef.current, { scrollWheelZoom: false, attributionControl: true });
      mapRef.current = map;
      // Green terrain basemap (Azure-Maps-like). Esri World Topo — free, no key.
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 18, attribution: "Tiles © Esri",
      }).addTo(map);

      const withCoords = regions
        .map((r) => ({ ...r, c: CENTROIDS[r.region] }))
        .filter((r): r is MapRegion & { c: [number, number] } => !!r.c && r.total > 0);

      const bounds: [number, number][] = [];
      for (const r of withCoords) {
        bounds.push(r.c);
        // One bubble per ~6 properties (clamped), scattered in a gaussian cluster
        // around the metro so dense metros read as a big blue blob, like Power BI.
        const n = Math.max(3, Math.min(350, Math.round(r.total / 6)));
        const spread = 0.12 + 0.16 * Math.sqrt(n / 350); // bigger metros spread wider
        const rand = rng(hash(r.region));
        for (let i = 0; i < n; i++) {
          // Sum of 3 uniforms ≈ gaussian → denser core, sparse edges.
          const gx = (rand() + rand() + rand() - 1.5) * spread;
          const gy = (rand() + rand() + rand() - 1.5) * spread;
          const lat = r.c[0] + gy;
          const lng = r.c[1] + gx / Math.cos((r.c[0] * Math.PI) / 180);
          L.circleMarker([lat, lng], {
            radius: 5, color: "#0b5cad", weight: 1,
            fillColor: "#2b7de9", fillOpacity: 0.7,
          }).addTo(map);
        }
        // Invisible hit target with the region tooltip at the metro center.
        L.circleMarker(r.c, { radius: 10, opacity: 0, fillOpacity: 0 })
          .addTo(map).bindTooltip(`${r.region}: ${r.total.toLocaleString()} properties`, { direction: "top" });
      }
      map.setView([32.5, -85], 5); // Southeast US default
      // Fit AFTER the container has its real size (grid layout can leave it 0-width
      // at init, which makes an early fitBounds zoom out too far).
      setTimeout(() => { map.invalidateSize(); if (bounds.length) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 6 }); }, 300);
    })();
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [regions]);

  return <div ref={elRef} className="p-map-live" role="img" aria-label="Property map" />;
}
