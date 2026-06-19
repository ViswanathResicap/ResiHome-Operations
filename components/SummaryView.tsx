"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";

import type { SummaryCache } from "@/lib/types";

interface RegionRow { region:string; vacantOff:number; vacantOn:number; vacantFMI:number; trustee:number; tenant:number; turnkey:number; total:number; }
interface OrgRow { org:string; offMarket:number; onMarket:number; leased:number; turnkey:number; total:number; avgRent?:number; bomOcc?:number|null; eomOcc?:number|null; bomOccNum?:number; eomOccNum?:number; stabilized?:number; }
interface MonthTrend { month:string; renewal:number|null; collections:number|null; }
interface MapPoint { lat:number; lon:number; status:string; address:string; }
interface PortfolioMetrics { bomListings:number; bomVacant:number; holdingFees:number; actualMIs:number; actualMOs:number; netOccGain:number; turnoverPct:number; }
interface FPRow  { floorplan:string; homes:number; avgRent:number|null; bomOcc:number|null; eomOcc:number|null; netOccGain:number; }
interface SubRow { subdivision:string; homes:number; avgRent:number|null; bomOcc:number|null; eomOcc:number|null; netOccGain:number; floorplans:FPRow[]; }
interface RegRow { region:string; homes:number; avgRent:number|null; bomOcc:number|null; eomOcc:number|null; netOccGain:number; subdivisions:SubRow[]; }
interface SummaryV2 { generatedAt:string; heroKpis:{totalProperties:number;occupancyPct:number;activeListings:number}; regionRows:RegionRow[]; eomOccupancy:number|null; eomCollections:number|null; renewal:number|null; bomListingsLeased:number|null; woCycleTime:number|null; netTurnCost:number|null; runRateSpend:number|null; internalMaintenance:number|null; holdingFees:number; monthlyTrend:MonthTrend[]; orgSummary:OrgRow[]; orgSubMap?:Record<string,RegRow[]>; portfolioMetrics?:PortfolioMetrics; errors?:string[]; }
interface FilterOptions { organizations:string[]; regions:string[]; subdivisions:string[]; propertyManagers:string[]; propertyStatuses:string[]; mapPoints:MapPoint[]; }
interface ActiveFilters { orgs:string[]; regions:string[]; subdivisions:string[]; statuses:string[]; pms:string[]; address:string; }

const MONTHS = ["March 2026","April 2026","May 2026","June 2026"];
const EMPTY: ActiveFilters = { orgs:[], regions:[], subdivisions:[], statuses:[], pms:[], address:"" };
const fmt1 = (n:number) => n.toFixed(1)+"%";
const fmtN = (n:number) => n.toLocaleString();
const fmtPct = (n:number|null|undefined) => n==null ? "—" : n.toFixed(1)+"%";
const fmtCur = (n:number|null|undefined) => n==null ? "—" : "$"+Math.round(n).toLocaleString("en-US");

// ── Power BI style slicer ─────────────────────────────────────────────────────
function PBICheckbox({ checked, onChange }: { checked:boolean; onChange:()=>void }) {
  return (
    <div onClick={onChange} style={{
      width:14, height:14, border:`2px solid ${checked?"#117865":"#999"}`,
      borderRadius:2, background:checked?"#117865":"#fff",
      display:"flex", alignItems:"center", justifyContent:"center",
      cursor:"pointer", flexShrink:0,
    }}>
      {checked && <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
        <path d="M1 3.5L3.5 6L8 1" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>}
    </div>
  );
}

function PBISlicer({ label, options, selected, onChange }: {
  label:string; options:string[]; selected:string[]; onChange:(v:string[])=>void;
}) {
  const [open, setOpen] = useState(true);
  const allSelected = selected.length === 0;

  const toggle = (v:string) => {
    if (allSelected) {
      onChange(options.filter(x => x !== v));
    } else if (selected.includes(v)) {
      const next = selected.filter(x => x !== v);
      onChange(next.length === 0 ? [] : next);
    } else {
      const next = [...selected, v];
      onChange(next.length === options.length ? [] : next);
    }
  };

  const isChecked = (o:string) => allSelected || selected.includes(o);

  return (
    <div style={{marginBottom:6}}>
      <div style={{
        borderBottom:"2px solid #c8a000", paddingBottom:2, marginBottom:0,
        display:"flex", justifyContent:"space-between", alignItems:"center",
        cursor:"pointer",
      }} onClick={()=>setOpen(o=>!o)}>
        <span style={{fontSize:11,fontWeight:600,color:"#252525"}}>{label}</span>
        <span style={{fontSize:10,color:"#888"}}>{open?"∧":"∨"}</span>
      </div>

      {!open && (
        <div onClick={()=>setOpen(true)} style={{
          padding:"4px 8px", background:"#fff", border:"1px solid #e0e0e0",
          fontSize:11, color:"#252525", cursor:"pointer", marginBottom:4,
        }}>
          {allSelected ? "All" : `${selected.length} of ${options.length} selected`}
        </div>
      )}

      {open && (
        <div style={{
          border:"1px solid #e0e0e0", borderTop:"none",
          maxHeight:200, overflowY:"auto", background:"#fff", marginBottom:6,
        }}>
          <div onClick={()=>onChange([])} style={{
            display:"flex", alignItems:"center", gap:8,
            padding:"5px 10px", cursor:"pointer",
            borderBottom:"1px solid #f0f0f0",
            fontSize:11, color:"#252525",
            background: allSelected ? "#f0faf6" : "#fff",
          }}>
            <PBICheckbox checked={allSelected} onChange={()=>onChange([])}/>
            <span style={{fontWeight:600}}>Select all</span>
          </div>

          {options.map(o => (
            <div key={o} onClick={()=>toggle(o)} style={{
              display:"flex", alignItems:"center", gap:0,
              padding:"4px 8px", cursor:"pointer", fontSize:11, color:"#252525",
              background: isChecked(o) && !allSelected ? "#f0faf6" : "transparent",
            }}>
              <span style={{color:"#ccc",fontSize:9,width:16,flexShrink:0}}>∨</span>
              <PBICheckbox checked={isChecked(o)} onChange={()=>toggle(o)}/>
              <span style={{marginLeft:8,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AddressSearch({ value, onChange }: { value:string; onChange:(v:string)=>void }) {
  return (
    <div style={{marginBottom:8}}>
      <div style={{borderBottom:"2px solid #c8a000",paddingBottom:2,marginBottom:0}}>
        <span style={{fontSize:11,fontWeight:600,color:"#252525"}}>Address Search</span>
      </div>
      <div style={{border:"1px solid #e0e0e0",background:"#fff",display:"flex",alignItems:"center",padding:"4px 6px",gap:4}}>
        <span style={{color:"#aaa",fontSize:12}}>🔍</span>
        <input value={value} onChange={e=>onChange(e.target.value)} placeholder="Search"
          style={{flex:1,border:"none",outline:"none",fontSize:11,background:"transparent"}}/>
      </div>
      <div style={{border:"1px solid #e0e0e0",borderTop:"none",padding:"4px 8px",fontSize:11,color:"#252525",display:"flex",alignItems:"center",gap:6}}>
        <input type="checkbox" defaultChecked style={{width:13,height:13,accentColor:"#217346"}}/>
        Select all
      </div>
    </div>
  );
}

function TransferDate() {
  return (
    <div style={{marginBottom:8}}>
      <div style={{borderBottom:"2px solid #c8a000",paddingBottom:2,marginBottom:4}}>
        <span style={{fontSize:11,fontWeight:600,color:"#252525"}}>Transfer Date</span>
      </div>
      <div style={{display:"flex",gap:6,alignItems:"center"}}>
        <div style={{flex:1,border:"1px solid #e0e0e0",padding:"3px 6px",display:"flex",alignItems:"center",gap:4,fontSize:10}}>
          <input type="date" defaultValue="1999-12-17" style={{border:"none",outline:"none",fontSize:10,width:"100%",background:"transparent"}}/>
        </div>
        <div style={{flex:1,border:"1px solid #e0e0e0",padding:"3px 6px",display:"flex",alignItems:"center",gap:4,fontSize:10}}>
          <input type="date" defaultValue="2026-06-15" style={{border:"none",outline:"none",fontSize:10,width:"100%",background:"transparent"}}/>
        </div>
      </div>
    </div>
  );
}

function MonthSelector({ selected, onChange }: { selected:string; onChange:(m:string)=>void }) {
  return (
    <div style={{marginBottom:8}}>
      <div style={{borderBottom:"2px solid #c8a000",paddingBottom:2,marginBottom:4}}>
        <span style={{fontSize:11,fontWeight:600,color:"#252525"}}>MONTH</span>
      </div>
      {MONTHS.map(m=>(
        <label key={m} style={{display:"flex",alignItems:"center",gap:8,padding:"3px 4px",cursor:"pointer",fontSize:11,color:"#252525"}}>
          <input type="radio" name="month" value={m} checked={selected===m} onChange={()=>onChange(m)}
            style={{accentColor:"#e91e8c",width:13,height:13}}/>
          {m}
        </label>
      ))}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  card: { background:"#fff",border:"1px solid #e5e7eb",borderRadius:6,padding:"10px 8px",textAlign:"center" as const,fontFamily:'"Segoe UI",sans-serif' },
  cardTitle: { fontSize:9,fontWeight:700,textTransform:"uppercase" as const,letterSpacing:".3px",color:"#374151",marginBottom:2 },
  th: { background:"#1f2937",color:"#fff",padding:"5px 8px",fontSize:10,textTransform:"uppercase" as const,letterSpacing:".3px",textAlign:"center" as const,whiteSpace:"nowrap" as const },
  td: { padding:"4px 8px",fontSize:11,textAlign:"center" as const,borderBottom:"1px solid #f3f4f6" },
  thSm: { background:"#1f2937",color:"#fff",padding:"4px 5px",fontSize:9,textTransform:"uppercase" as const,letterSpacing:".2px",textAlign:"center" as const,whiteSpace:"nowrap" as const },
  tdSm: { padding:"3px 5px",fontSize:10,textAlign:"center" as const,borderBottom:"1px solid #f3f4f6" },
};

type GaugeFmt = "pct" | "num" | "currency";
function fmtVal(v:number, f:GaugeFmt) {
  if (f==="pct") return v.toFixed(1)+"%";
  if (f==="currency") return "$"+v.toLocaleString("en-US",{maximumFractionDigits:0});
  return v.toFixed(1);
}
function fmtAxis(v:number, f:GaugeFmt) {
  if (f==="pct") return v+"%";
  if (f==="currency") return v>=1000?"$"+Math.round(v/1000)+"K":"$"+v;
  return String(v);
}
function Gauge({ label, value, target, min, max, higher=true, fmt="pct" }:
  { label:string; value:number|null; target:number; min:number; max:number; higher?:boolean; fmt?:GaugeFmt }) {
  if (value===null) return <div style={S.card}><div style={S.cardTitle}>{label}</div><div style={{color:"#9ca3af",fontSize:10,padding:"14px 0"}}>pending</div></div>;
  const span=max-min||1, clamp=(v:number)=>Math.max(0,Math.min(1,(v-min)/span));
  const a=clamp(value), t=clamp(target);
  const R=52,CX=70,CY=62;
  const toXY=(f:number)=>{const ang=Math.PI*(1-f);return[CX+R*Math.cos(ang),CY-R*Math.sin(ang)];};
  const arc=(f0:number,f1:number)=>{const[x0,y0]=toXY(f0);const[x1,y1]=toXY(f1);return`M${x0} ${y0}A${R} ${R} 0 0 1 ${x1} ${y1}`;};
  const ok=higher?value>=target:value<=target, col=ok?"#16a34a":"#dc2626";
  const[tx,ty]=toXY(t);
  return (
    <div style={S.card}>
      <div style={S.cardTitle}>{label}</div>
      <svg viewBox="0 0 140 80" width="100%" height="68">
        <path d={arc(0,1)} stroke="#e5e7eb" strokeWidth={10} fill="none" strokeLinecap="round"/>
        <path d={arc(0,a)} stroke={col} strokeWidth={10} fill="none" strokeLinecap="round"/>
        <circle cx={tx} cy={ty} r={4} fill="#374151"/>
        <text x={16} y={78} fontSize="8" fill="#9ca3af">{fmtAxis(min,fmt)}</text>
        <text x={124} y={78} fontSize="8" fill="#9ca3af" textAnchor="end">{fmtAxis(max,fmt)}</text>
      </svg>
      <div style={{fontSize:16,fontWeight:700,color:col,marginTop:-4}}>{fmtVal(value,fmt)}</div>
      <div style={{fontSize:9,color:"#9ca3af"}}>Target {fmtVal(target,fmt)}</div>
    </div>
  );
}

// ── Property Map ──────────────────────────────────────────────────────────────
function PropertyMap({ points }: { points:MapPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<unknown>(null);

  useEffect(() => {
    if (!ref.current || mapRef.current || !points.length) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const L = (window as any).L;
      if (!ref.current || mapRef.current) return;
      const map = L.map(ref.current).setView([33,-90],4);
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap",maxZoom:18}).addTo(map);
      const colors: Record<string,string> = { leased:"#2563eb",on_market:"#f59e0b",off_market:"#6b7280",fmi:"#10b981",turnkey:"#8b5cf6",other:"#9ca3af" };
      points.forEach(p=>{
        L.circleMarker([p.lat,p.lon],{radius:5,fillColor:colors[p.status]||"#9ca3af",color:"#fff",weight:1,opacity:1,fillOpacity:.85})
          .bindPopup(`<b>${p.address}</b><br/>${p.status.replace("_"," ")}`).addTo(map);
      });
    };
    document.head.appendChild(script);
  }, [points]);

  return (
    <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:4}}>Property Map</div>
      <div ref={ref} style={{flex:1,borderRadius:4,minHeight:190,background:"#e8f4ea"}}/>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,fontSize:9,marginTop:4}}>
        {[["#2563eb","Leased"],["#f59e0b","On Market"],["#6b7280","Off Market"],["#10b981","FMI"],["#8b5cf6","Turnkey"]].map(([c,l])=>(
          <span key={l} style={{display:"flex",alignItems:"center",gap:3}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:c,display:"inline-block"}}/>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}


// ── Portfolio Org Table — 3 level expand with +/- ───────────────────────────
const COLS = ["Organization","Homes","Avg Rent","BOM Occ","Net Occ Gain","EOM Occ",
  "Next EOM Occ","HF Pull-Thru","BOM Vacant Leased","EOM Collections","Retention",
  "Turnover","Renewal","Renewal Rent Growth","Release Rent Growth","Blended Rent Growth",
  "90+ Maint. Spend","Net Turn Cost"];

const TH = ({ h, left=false }:{ h:string; left?:boolean }) => (
  <th style={{ background:"#1f2937", color:"#fff", padding:"4px 5px", fontSize:9,
    textTransform:"uppercase" as const, letterSpacing:".2px", whiteSpace:"nowrap" as const,
    textAlign: left?"left" as const:"center" as const, fontWeight:600 }}>{h}</th>
);

function OrgTD({ v, left=false, bold=false, indent=0, color }:{
  v:string|number; left?:boolean; bold?:boolean; indent?:number; color?:string;
}) {
  return (
    <td style={{ padding:"3px 5px", fontSize:10, borderBottom:"1px solid #f0f0f0",
      textAlign: left?"left" as const:"center" as const,
      fontWeight: bold?700:400, paddingLeft: indent ? indent+5 : 5,
      color: color ?? "#1f2937" }}>
      {v}
    </td>
  );
}

const DASH_COLS = 12; // columns after EOM Occ that show —

function PortfolioOrgTable({ orgSummary, orgSubMap, pm, eomCollections,
  bomListingsLeased, renewal, runRateSpend, netTurnCost,
  totalBomOcc, totalEomOcc, totalAvgRent, totalHomes }: {
  orgSummary: OrgRow[];
  orgSubMap: Record<string, RegRow[]>;
  pm: PortfolioMetrics|undefined;
  eomCollections: number|null; bomListingsLeased: number|null;
  renewal: number|null; runRateSpend: number|null; netTurnCost: number|null;
  totalBomOcc: number|null; totalEomOcc: number|null;
  totalAvgRent: number; totalHomes: number;
}) {
  // expandedOrg, expandedReg, expandedSub — each a Set of keys
  const [expOrg, setExpOrg] = React.useState<Set<string>>(new Set());
  const [expReg, setExpReg] = React.useState<Set<string>>(new Set());
  const [expSub, setExpSub] = React.useState<Set<string>>(new Set());

  const togOrg = (k:string) => setExpOrg(s=>{ const n=new Set(s); n.has(k)?n.delete(k):n.add(k); return n; });
  const togReg = (k:string) => setExpReg(s=>{ const n=new Set(s); n.has(k)?n.delete(k):n.add(k); return n; });
  const togSub = (k:string) => setExpSub(s=>{ const n=new Set(s); n.has(k)?n.delete(k):n.add(k); return n; });

  const Btn = ({ expanded, onClick }:{ expanded:boolean; onClick:()=>void }) => (
    <span onClick={e=>{e.stopPropagation();onClick();}} style={{
      display:"inline-flex", alignItems:"center", justifyContent:"center",
      width:14, height:14, border:"1px solid #aaa", borderRadius:2,
      marginRight:5, cursor:"pointer", fontSize:11, fontWeight:700,
      background:"#fff", color:"#374151", flexShrink:0, lineHeight:1,
    }}>{expanded ? "−" : "+"}</span>
  );

  const dashes = Array(DASH_COLS).fill("—");

  return (
    <div>
      <div style={{fontSize:13,fontWeight:800,textDecoration:"underline" as const,marginBottom:6}}>
        Portfolio Metrics — By Organization
      </div>
      <div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:6,overflow:"auto",marginBottom:16}}>
        <table style={{borderCollapse:"collapse" as const,width:"100%"}}>
          <thead><tr>{COLS.map((h,i)=><TH key={h} h={h} left={i===0}/>)}</tr></thead>
          <tbody>
            {orgSummary
              .filter(r=>r.org && r.org!=="Other")
              .sort((a,b)=>{
                const ORDER = ["Hudson Oak","McKinley Homes","Newstar","RB DRC","Rocklyn Homes","ROI Property Group","RP SFR","RP RESIBUILT HOLDINGS 3 II LLC"];
                const ai = ORDER.indexOf(a.org); const bi = ORDER.indexOf(b.org);
                if(ai===-1 && bi===-1) return a.org.localeCompare(b.org);
                if(ai===-1) return 1; if(bi===-1) return -1;
                return ai - bi;
              })
              .map((r, ri)=>{
              const regions = orgSubMap[r.org] ?? [];
              const orgOpen = expOrg.has(r.org);
              const netGain = (r.eomOccNum??0)-(r.bomOccNum??0);
              const rowBg   = ri%2===0 ? "#fff" : "#f9fafb";

              return (
                <React.Fragment key={r.org}>
                  {/* ── Level 1: Org ── */}
                  <tr style={{background:rowBg}}>
                    <td style={{padding:"3px 5px",fontSize:10,borderBottom:"1px solid #f0f0f0",fontWeight:700,color:"#1f2937"}}>
                      {regions.length>0 && <Btn expanded={orgOpen} onClick={()=>togOrg(r.org)}/>}
                      {regions.length===0 && <span style={{width:19,display:"inline-block"}}/>}
                      {r.org}
                    </td>
                    <OrgTD v={fmtN(r.total)}/>
                    <OrgTD v={r.avgRent?"$"+fmtN(r.avgRent):"—"}/>
                    <OrgTD v={fmtPct(r.bomOcc)}/>
                    <OrgTD v={netGain!==0?(netGain>0?"+":"")+netGain:"—"}/>
                    <OrgTD v={fmtPct(r.eomOcc)}/>
                    {dashes.map((_,i)=><OrgTD key={i} v="—"/>)}
                  </tr>

                  {/* ── Level 2: Region ── */}
                  {orgOpen && regions.map(reg=>{
                    const regKey = r.org+"|"+reg.region;
                    const regOpen = expReg.has(regKey);
                    return (
                      <React.Fragment key={regKey}>
                        <tr style={{background:"#f5fffe"}}>
                          <td style={{padding:"3px 5px",paddingLeft:20,fontSize:10,borderBottom:"1px solid #f0f0f0",color:"#374151"}}>
                            {reg.subdivisions.length>0 && <Btn expanded={regOpen} onClick={()=>togReg(regKey)}/>}
                            {reg.subdivisions.length===0 && <span style={{width:19,display:"inline-block"}}/>}
                            {reg.region}
                          </td>
                          <OrgTD v={fmtN(reg.homes)}/>
                          <OrgTD v={reg.avgRent?"$"+fmtN(reg.avgRent):"—"}/>
                          <OrgTD v={fmtPct(reg.bomOcc)}/>
                          <OrgTD v={reg.netOccGain!==0?(reg.netOccGain>0?"+":"")+reg.netOccGain:"—"}/>
                          <OrgTD v={fmtPct(reg.eomOcc)}/>
                          {dashes.map((_,i)=><OrgTD key={i} v="—"/>)}
                        </tr>

                        {/* ── Level 3: Subdivision ── */}
                        {regOpen && reg.subdivisions.map(sub=>{
                          const subKey = regKey+"|"+sub.subdivision;
                          const subOpen = expSub.has(subKey);
                          return (
                            <React.Fragment key={subKey}>
                              <tr style={{background:"#f0faf8"}}>
                                <td style={{padding:"3px 5px",paddingLeft:36,fontSize:10,borderBottom:"1px solid #f0f0f0",color:"#374151"}}>
                                  {sub.floorplans.length>0 && <Btn expanded={subOpen} onClick={()=>togSub(subKey)}/>}
                                  {sub.floorplans.length===0 && <span style={{width:19,display:"inline-block"}}/>}
                                  {sub.subdivision}
                                </td>
                                <OrgTD v={fmtN(sub.homes)}/>
                                <OrgTD v={sub.avgRent?"$"+fmtN(sub.avgRent):"—"}/>
                                <OrgTD v={fmtPct(sub.bomOcc)}/>
                                <OrgTD v={sub.netOccGain!==0?(sub.netOccGain>0?"+":"")+sub.netOccGain:"—"}/>
                                <OrgTD v={fmtPct(sub.eomOcc)}/>
                                {dashes.map((_,i)=><OrgTD key={i} v="—"/>)}
                              </tr>

                              {/* ── Level 4: Floorplan ── */}
                              {subOpen && sub.floorplans.map(fp=>(
                                <tr key={subKey+"|"+fp.floorplan} style={{background:"#f7fffd"}}>
                                  <td style={{padding:"3px 5px",paddingLeft:54,fontSize:10,borderBottom:"1px solid #f0f0f0",color:"#6b7280"}}>
                                    <span style={{width:19,display:"inline-block"}}/>
                                    {fp.floorplan}
                                  </td>
                                  <OrgTD v={fmtN(fp.homes)}/>
                                  <OrgTD v={fp.avgRent?"$"+fmtN(fp.avgRent):"—"}/>
                                  <OrgTD v={fmtPct(fp.bomOcc)}/>
                                  <OrgTD v={fp.netOccGain!==0?(fp.netOccGain>0?"+":"")+fp.netOccGain:"—"}/>
                                  <OrgTD v={fmtPct(fp.eomOcc)}/>
                                  {dashes.map((_,i)=><OrgTD key={i} v="—"/>)}
                                </tr>
                              ))}
                            </React.Fragment>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              );
            })}

            {/* ── Total row ── */}
            <tr style={{borderTop:"2px solid #e91e8c",background:"#f9fafb"}}>
              <td style={{padding:"3px 5px",fontSize:10,fontWeight:800,color:"#1f2937",borderBottom:"1px solid #f0f0f0"}}>
                <span style={{width:19,display:"inline-block"}}/>Total
              </td>
              <OrgTD bold v={fmtN(totalHomes)}/>
              <OrgTD bold v={"$"+fmtN(totalAvgRent)}/>
              <OrgTD bold v={fmtPct(totalBomOcc)}/>
              <OrgTD bold v={pm?(pm.netOccGain>=0?"+":"")+fmtN(pm.netOccGain):"—"}/>
              <OrgTD bold v={fmtPct(totalEomOcc)}/>
              <OrgTD v="—"/><OrgTD v="—"/>
              <OrgTD bold v={fmtPct(bomListingsLeased)}/>
              <OrgTD bold v={fmtPct(eomCollections)}/>
              <OrgTD v="—"/>
              <OrgTD bold v={pm?pm.turnoverPct.toFixed(1)+"%":"—"}/>
              <OrgTD bold v={fmtPct(renewal)}/>
              <OrgTD v="—"/><OrgTD v="—"/><OrgTD v="—"/>
              <OrgTD bold v={fmtCur(runRateSpend)}/>
              <OrgTD bold v={fmtCur(netTurnCost)}/>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ── Main Component ────────────────────────────────────────────────────────────
export function SummaryView({ initialData }: { initialData: SummaryCache }) {
  const [v2, setV2] = useState<SummaryV2|null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState("May 2026");
  const [filters, setFilters] = useState<ActiveFilters>(EMPTY);
  const [filterOpts, setFilterOpts] = useState<FilterOptions>({organizations:[],regions:[],subdivisions:[],propertyManagers:[],propertyStatuses:[],mapPoints:[]});
  const [lastUpdated, setLastUpdated] = useState<string|null>(null);
  void initialData;

  useEffect(()=>{
    fetch("/api/filters").then(r=>r.ok?r.json():null).then(d=>{if(d) setFilterOpts(d);}).catch(()=>{});
  },[]);

  const buildParams = useCallback((month:string, f:ActiveFilters) => {
    const p = new URLSearchParams({ month });
    if (f.orgs.length===1) p.set("org", f.orgs[0]);
    if (f.regions.length===1) p.set("region", f.regions[0]);
    if (f.statuses.length===1) p.set("status", f.statuses[0]);
    return p.toString();
  },[]);

  const load = useCallback(async (month:string, f:ActiveFilters)=>{
    setLoading(true);
    try {
      const r = await fetch(`/api/summary-v2?${buildParams(month,f)}`,{cache:"no-store"});
      if (r.ok) { const d=await r.json(); setV2(d); setLastUpdated(new Date(d.generatedAt).toLocaleString("en-US")); }
    } catch(e){console.error(e);}
    finally{setLoading(false);}
  },[buildParams]);

  useEffect(()=>{load(selectedMonth,filters);},[selectedMonth,filters,load]);

  const setF = (key:keyof ActiveFilters, val:unknown)=>setFilters(f=>({...f,[key]:val}));
  const hasFilters = filters.orgs.length>0||filters.regions.length>0||filters.subdivisions.length>0||filters.statuses.length>0||filters.pms.length>0||filters.address!=="";

  const regionRows  = v2?.regionRows??[];
  const orgSummary  = v2?.orgSummary??[];
  const monthlyTrend = v2?.monthlyTrend??[];
  const heroKpis    = v2?.heroKpis;
  const pm          = v2?.portfolioMetrics;

  const regionTotals = regionRows.reduce((acc,r)=>({
    vacantOff:acc.vacantOff+r.vacantOff, vacantOn:acc.vacantOn+r.vacantOn, vacantFMI:acc.vacantFMI+r.vacantFMI,
    trustee:acc.trustee+r.trustee, tenant:acc.tenant+r.tenant, turnkey:acc.turnkey+r.turnkey, total:acc.total+r.total,
  }),{vacantOff:0,vacantOn:0,vacantFMI:0,trustee:0,tenant:0,turnkey:0,total:0});

  const totalLeased     = orgSummary.reduce((a,r)=>a+r.leased,0);
  const totalStabilized = orgSummary.reduce((a,r)=>a+(r.stabilized??0),0);
  const totalBomOccNum  = orgSummary.reduce((a,r)=>a+(r.bomOccNum??0),0);
  const totalEomOccNum  = orgSummary.reduce((a,r)=>a+(r.eomOccNum??0),0);
  const totalBomOcc     = totalStabilized>0 ? totalBomOccNum/totalStabilized*100 : null;
  const totalEomOcc     = totalStabilized>0 ? totalEomOccNum/totalStabilized*100 : null;
  const totalNetGain    = totalEomOccNum - totalBomOccNum;
  const totalAvgRent    = totalLeased>0 ? Math.round(orgSummary.reduce((a,r)=>a+(r.avgRent??0)*r.leased,0)/totalLeased) : 0;
  const totalHomes      = orgSummary.reduce((a,r)=>a+r.total,0);

  return (
    <div style={{display:"flex",minHeight:"100vh",fontFamily:'"Segoe UI",Tahoma,sans-serif',background:"#f3f4f6",fontSize:12}}>

      {/* ── Slicer Rail ── */}
      <aside style={{width:240,flexShrink:0,background:"#fff",borderRight:"1px solid #e0e0e0",padding:"12px 12px",position:"sticky",top:0,height:"100vh",overflowY:"auto"}}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/resihome-logo.png" alt="ResiHome" style={{width:150,display:"block",marginBottom:8}}/>
        <div style={{height:2,width:36,background:"#e91e8c",borderRadius:2,margin:"4px 0 10px"}}/>
        <PBISlicer label="Organization"   options={filterOpts.organizations}   selected={filters.orgs}       onChange={v=>setF("orgs",v)}/>
        <PBISlicer label="Region"         options={filterOpts.regions}         selected={filters.regions}    onChange={v=>setF("regions",v)}/>
        <PBISlicer label="Subdivision"    options={filterOpts.subdivisions}    selected={filters.subdivisions} onChange={v=>setF("subdivisions",v)}/>
        <PBISlicer label="Property Status" options={filterOpts.propertyStatuses} selected={filters.statuses} onChange={v=>setF("statuses",v)}/>
        <PBISlicer label="Property Manager" options={filterOpts.propertyManagers} selected={filters.pms}    onChange={v=>setF("pms",v)}/>
        <AddressSearch value={filters.address} onChange={v=>setF("address",v)}/>
        <TransferDate/>
        {hasFilters&&(
          <button onClick={()=>setFilters(EMPTY)} style={{width:"100%",padding:"4px 0",background:"#f5f5f5",border:"1px solid #d1d5db",borderRadius:3,cursor:"pointer",fontSize:11,color:"#374151",marginBottom:8}}>
            ✕ Clear all filters
          </button>
        )}
        <MonthSelector selected={selectedMonth} onChange={setSelectedMonth}/>
        <button onClick={()=>load(selectedMonth,filters)} disabled={loading}
          style={{marginTop:10,width:"100%",padding:"7px 0",background:"#e91e8c",color:"#fff",border:"none",borderRadius:5,cursor:loading?"wait":"pointer",fontWeight:700,fontSize:12}}>
          {loading?"↻ Loading...":"↻ Refresh data"}
        </button>
        {lastUpdated&&<div style={{fontSize:9,color:"#9ca3af",marginTop:4,textAlign:"center"}}>{lastUpdated}</div>}
      </aside>

      {/* ── Main Canvas ── */}
      <main style={{flex:1,padding:"14px 18px 48px",overflow:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"2px solid #e91e8c",paddingBottom:6,marginBottom:12}}>
          <h1 style={{margin:0,fontSize:16,fontWeight:800,textDecoration:"underline"}}>Portfolio Summary</h1>
          <div style={{fontSize:10,color:"#9ca3af"}}>Live · Snowflake · {selectedMonth}</div>
        </div>

        {hasFilters&&<div style={{padding:"5px 10px",background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:5,fontSize:11,color:"#1e40af",marginBottom:10}}>
          🔍 Filtered · {[...filters.orgs,...filters.regions,...filters.statuses,...filters.pms].join(" · ")||"Custom filter active"}
        </div>}

        {loading&&!v2&&<div style={{textAlign:"center",padding:48,color:"#9ca3af"}}>↻ Loading from Snowflake...</div>}
        {!loading&&!v2&&<div style={{padding:14,background:"#fef3c7",border:"1px solid #fbbf24",borderRadius:6,fontSize:11,color:"#92400e"}}>⚠️ Data not loaded — click <strong>Refresh data</strong>.</div>}

        {v2&&(<>
          {/* Hero KPIs */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
            {[
              {label:"TOTAL PROPERTIES", val:fmtN(heroKpis!.totalProperties)},
              {label:"OCCUPANCY %",       val:`${heroKpis!.occupancyPct}%`},
              {label:"ACTIVE LISTINGS",   val:fmtN(heroKpis!.activeListings)},
            ].map(k=>(
              <div key={k.label} style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:6,padding:"14px 18px",boxShadow:"0 1px 3px rgba(0,0,0,.06)"}}>
                <div style={{fontSize:26,fontWeight:700,color:"#1f2937"}}>{k.val}</div>
                <div style={{fontSize:10,color:"#6b7280",textTransform:"uppercase",letterSpacing:".4px",marginTop:3}}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Regional Table + Map */}
          <div style={{display:"grid",gridTemplateColumns:"58% 40%",gap:12,marginBottom:16}}>
            <div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:6,overflow:"auto"}}>
              <table style={{borderCollapse:"collapse",width:"100%"}}>
                <thead><tr>
                  {["Region","Vacant-Off","Vacant-On","FMI","Trustee","Tenant","Turnkey","Total"].map((h,i)=>(
                    <th key={h} style={{...S.th,textAlign:i===0?"left":"center"}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {regionRows.map((r,i)=>(
                    <tr key={r.region} style={{background:i%2===0?"#fff":"#f9fafb"}}>
                      <td style={{...S.td,textAlign:"left",fontSize:10}}>{r.region}</td>
                      <td style={S.td}>{r.vacantOff||""}</td><td style={S.td}>{r.vacantOn||""}</td>
                      <td style={S.td}>{r.vacantFMI||""}</td><td style={S.td}>{r.trustee||""}</td>
                      <td style={S.td}>{r.tenant.toLocaleString()}</td><td style={S.td}>{r.turnkey||""}</td>
                      <td style={{...S.td,fontWeight:700}}>{r.total.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr style={{borderTop:"2px solid #e91e8c"}}>
                  <td style={{...S.td,textAlign:"left",fontWeight:800}}>Total</td>
                  <td style={{...S.td,fontWeight:800}}>{regionTotals.vacantOff||""}</td>
                  <td style={{...S.td,fontWeight:800}}>{regionTotals.vacantOn||""}</td>
                  <td style={{...S.td,fontWeight:800}}>{regionTotals.vacantFMI||""}</td>
                  <td style={{...S.td,fontWeight:800}}>{regionTotals.trustee||""}</td>
                  <td style={{...S.td,fontWeight:800}}>{regionTotals.tenant.toLocaleString()}</td>
                  <td style={{...S.td,fontWeight:800}}>{regionTotals.turnkey||""}</td>
                  <td style={{...S.td,fontWeight:800}}>{regionTotals.total.toLocaleString()}</td>
                </tr></tfoot>
              </table>
            </div>
            <div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:6,padding:10,minHeight:240}}>
              {filterOpts.mapPoints.length>0
                ? <PropertyMap points={filterOpts.mapPoints}/>
                : <div style={{height:"100%",display:"flex",alignItems:"center",justifyContent:"center",color:"#9ca3af",fontSize:11,minHeight:200}}>↻ Loading map...</div>
              }
            </div>
          </div>

          {/* KPI Gauges */}
          <div style={{fontSize:13,fontWeight:800,textDecoration:"underline",marginBottom:8}}>KPIs</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(8,1fr)",gap:8,marginBottom:16}}>
            <Gauge label="EOM Occupancy"       value={v2.eomOccupancy}        target={96}    min={90}   max={97}    higher={true}  fmt="pct"/>
            <Gauge label="EOM Collections"     value={v2.eomCollections}      target={95.5}  min={90}   max={97}    higher={true}  fmt="pct"/>
            <Gauge label="Renewal"             value={v2.renewal}             target={75}    min={0}    max={100}   higher={true}  fmt="pct"/>
            <Gauge label="BOM Listings Leased" value={v2.bomListingsLeased}   target={50}    min={0}    max={70}    higher={true}  fmt="pct"/>
            <Gauge label="WO Cycle Time"       value={v2.woCycleTime}         target={9.5}   min={7}    max={16}    higher={false} fmt="num"/>
            <Gauge label="Net Turn Cost"       value={v2.netTurnCost}         target={1750}  min={1000} max={3000}  higher={false} fmt="currency"/>
            <Gauge label="90+ Run Rate Spend"  value={v2.runRateSpend}        target={1700}  min={1000} max={2500}  higher={false} fmt="currency"/>
            <Gauge label="Internal Maint."     value={v2.internalMaintenance} target={64000} min={0}    max={64000} higher={false} fmt="currency"/>
          </div>

          {/* Portfolio Metrics Bar */}
          <div style={{fontSize:13,fontWeight:800,textDecoration:"underline",marginBottom:8}}>Portfolio Metrics — {selectedMonth}</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:8,marginBottom:14}}>
            {[
              {label:"BOM Listings",       val: pm ? fmtN(pm.bomListings)           : fmtN(heroKpis!.activeListings)},
              {label:"BOM Vacant",         val: pm ? fmtN(pm.bomVacant)             : fmtN(regionTotals.vacantOff+regionTotals.vacantOn+regionTotals.vacantFMI)},
              {label:"Holding Fees",       val: pm ? fmtN(pm.holdingFees)           : fmtN(v2.holdingFees)},
              {label:"Proj / Actual MIs",  val: pm ? fmtN(pm.actualMIs)             : "—"},
              {label:"Proj / Actual MOs",  val: pm ? fmtN(pm.actualMOs)             : "—"},
              {label:"Net Occupancy Gain", val: pm ? fmtN(pm.netOccGain)            : "—"},
              {label:"Turnover %",         val: pm ? pm.turnoverPct.toFixed(1)+"%"  : "—"},
            ].map(k=>(
              <div key={k.label} style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:6,padding:"10px 12px"}}>
                <div style={{fontSize:20,fontWeight:700,color:"#1f2937"}}>{k.val}</div>
                <div style={{fontSize:9,color:"#6b7280",textTransform:"uppercase",letterSpacing:".3px",marginTop:3}}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* ── Portfolio Metrics — By Organization (18 cols, expandable) ── */}
          <PortfolioOrgTable
            orgSummary={orgSummary}
            orgSubMap={v2.orgSubMap??{}}
            pm={pm}
            eomCollections={v2.eomCollections}
            bomListingsLeased={v2.bomListingsLeased}
            renewal={v2.renewal}
            runRateSpend={v2.runRateSpend}
            netTurnCost={v2.netTurnCost}
            totalBomOcc={totalBomOcc}
            totalEomOcc={totalEomOcc}
            totalAvgRent={totalAvgRent}
            totalHomes={totalHomes}
          />

          {/* Property Summary (original org table — Off Market / On Market / Leased / Turnkey) */}
          <div style={{fontSize:13,fontWeight:800,textDecoration:"underline",marginBottom:8}}>Property Summary</div>
          <div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:6,overflow:"auto",marginBottom:16}}>
            <table style={{borderCollapse:"collapse",width:"100%"}}>
              <thead><tr>
                {["Organization","Off Market","On Market","Leased","Turnkey","Total"].map((h,i)=>(
                  <th key={h} style={{...S.th,textAlign:i===0?"left":"center"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {orgSummary.map((r,i)=>(
                  <tr key={r.org} style={{background:i%2===0?"#fff":"#f9fafb"}}>
                    <td style={{...S.td,textAlign:"left"}}>{r.org}</td>
                    <td style={S.td}>{r.offMarket||""}</td>
                    <td style={S.td}>{r.onMarket||""}</td>
                    <td style={S.td}>{r.leased.toLocaleString()}</td>
                    <td style={S.td}>{r.turnkey||""}</td>
                    <td style={{...S.td,fontWeight:700}}>{r.total.toLocaleString()}</td>
                  </tr>
                ))}
                <tr style={{borderTop:"2px solid #e91e8c"}}>
                  <td style={{...S.td,textAlign:"left",fontWeight:800}}>Total</td>
                  <td style={{...S.td,fontWeight:800}}>{orgSummary.reduce((a,r)=>a+r.offMarket,0)||""}</td>
                  <td style={{...S.td,fontWeight:800}}>{orgSummary.reduce((a,r)=>a+r.onMarket,0)||""}</td>
                  <td style={{...S.td,fontWeight:800}}>{orgSummary.reduce((a,r)=>a+r.leased,0).toLocaleString()}</td>
                  <td style={{...S.td,fontWeight:800}}>{orgSummary.reduce((a,r)=>a+r.turnkey,0)||""}</td>
                  <td style={{...S.td,fontWeight:800}}>{orgSummary.reduce((a,r)=>a+r.total,0).toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Monthly Trend */}
          <div style={{fontSize:13,fontWeight:800,textDecoration:"underline",marginBottom:8}}>Monthly KPI Trend</div>
          <div style={{background:"#fff",border:"1px solid #e5e7eb",borderRadius:6,overflow:"auto"}}>
            <table style={{borderCollapse:"collapse",width:"100%"}}>
              <thead><tr>
                {["Month","EOM Collections","Renewal"].map((h,i)=>(
                  <th key={h} style={{...S.th,textAlign:i===0?"left":"center"}}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {monthlyTrend.map((r,i)=>(
                  <tr key={r.month} style={{background:i%2===0?"#fff":"#f9fafb"}}>
                    <td style={{...S.td,textAlign:"left"}}>{r.month}</td>
                    <td style={S.td}>{r.collections!=null?fmt1(r.collections):"—"}</td>
                    <td style={S.td}>{r.renewal!=null?fmt1(r.renewal):"—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {v2.errors?.length ? <div style={{marginTop:10,padding:"6px 10px",background:"#fef3c7",border:"1px solid #fbbf24",borderRadius:6,fontSize:10,color:"#92400e"}}>⚠️ {v2.errors[0]}</div> : null}
        </>)}
      </main>
    </div>
  );
}
