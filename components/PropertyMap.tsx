"use client";

// Real interactive US map for the Portfolio Summary. The source data has no
// lat/long (Power BI's UNITMAP geocodes addresses at render time), so we plot
// one bubble per region at its metro centroid, sized by property count. Uses
// Leaflet + free OpenStreetMap tiles (no API key). Leaflet is imported inside
// the effect so it never touches `window` during SSR.

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
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18, attribution: "© OpenStreetMap",
      }).addTo(map);

      const withCoords = regions
        .map((r) => ({ ...r, c: CENTROIDS[r.region] }))
        .filter((r): r is MapRegion & { c: [number, number] } => !!r.c && r.total > 0);

      const max = Math.max(1, ...withCoords.map((r) => r.total));
      const bounds: [number, number][] = [];
      for (const r of withCoords) {
        const radius = 6 + Math.sqrt(r.total / max) * 26;
        // Power BI palette: blue ring + green fill (larger metros lean greener).
        const green = r.total / max > 0.4;
        L.circleMarker(r.c, {
          radius, color: "#118dff", weight: 1.5,
          fillColor: green ? "#1aab40" : "#118dff", fillOpacity: 0.55,
        }).addTo(map).bindTooltip(`${r.region}: ${r.total.toLocaleString()} properties`, { direction: "top" });
        bounds.push(r.c);
      }
      map.setView([37.8, -96], 4); // continental US default
      // Fit to the metros AFTER the container has its real size (grid layout
      // can leave it 0-width at init, which makes an early fitBounds zoom out).
      setTimeout(() => { map.invalidateSize(); if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 6 }); }, 300);
    })();
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [regions]);

  return <div ref={elRef} className="p-map-live" role="img" aria-label="Property map by region" />;
}
