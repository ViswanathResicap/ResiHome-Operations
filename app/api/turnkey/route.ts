import { NextResponse } from "next/server";
import { connect } from "@/lib/snowflake";
import { esc, m, n, dec, p, d as fdate, makeCache, type TabPayload } from "@/lib/dbt";
import { DW_TURNS_SQL } from "@/lib/dw-turns-sql";

const CACHE = makeCache();
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Turnkey (Turns) tab — real turn data from DW_Turns: in-process turns and
// completed turns (trailing 6 months) with turn cost, days-in-turn, MO→MI
// days, and rent growth. DW_Turns is heavy (~20s) so we run it ONCE and split
// in JS; cached 30 min.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const org = url.searchParams.get("org") || "", region = url.searchParams.get("region") || "", fresh = url.searchParams.get("fresh") === "1";
  const key = `${org}|${region}`;
  const c0 = CACHE.get(key); if (c0 && !fresh) return NextResponse.json(c0.payload);
  let conn: Awaited<ReturnType<typeof connect>>; try { conn = await connect(); } catch (e) { return NextResponse.json({ error: "Snowflake connection failed", detail: String(e) }, { status: 500 }); }
  const errors: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = async (l: string, sql: string): Promise<any[]> => { try { return await conn.query(sql); } catch (e) { errors.push(`${l}: ${(e as Error).message}`); return []; } };
  const num = (v: unknown) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

  const orgW = org ? `AND t.ORGANIZATION_NAME = '${esc(org)}'` : "";
  const regionW = region ? `AND t.Region_Name = '${esc(region)}'` : "";
  // In-process = latest turn per property, not yet re-leased. Completed = turn
  // completed in the trailing 6 months. One pass over DW_Turns for both.
  const rows = await run("turns", `
    SELECT t.O_TURN_ID, t.EntityID, t.Region_Name AS REGION, t.ORGANIZATION_NAME AS ORG, t.STRATEGY_NAME AS STRATEGY,
      t.FloorPlan AS FP, t.SQUARE_FOOTAGE AS SQFT, t.O_Current_Rent AS O_RENT, t.N_Current_Rent AS N_RENT,
      t.O_Move_Out AS MO, t.N_MoveIn AS MI, t.TURN_COMPLETED, t.TURN_COMPLETED_BOM,
      t.TKT_COST, t.MoveOutReceipts_Final AS MOR, t.RENT_GROWTH, t.HC_TURN_REPORT_STATUS AS QC,
      t.WO_STATUS, t.TKT_WOS_OPEN, t.TKT_WOS_CLOSED, t.ON_MARKET_FLAG,
      t."Days_ActiveInTurn" AS DAYS_ACTIVE, t."Days_MoveOut_MoveIn" AS DAYS_MO_MI, t."Days_TKT_Created_TKT_Closed" AS DAYS_TKT,
      CASE WHEN t.N_MoveIn IS NULL AND t.RECENT_TURN_RANK = 1 THEN 1 ELSE 0 END AS IS_INPROCESS,
      CASE WHEN t.TURN_COMPLETED_BOM >= DATE_TRUNC('month',DATEADD('month',-5,CURRENT_DATE())) THEN 1 ELSE 0 END AS IS_COMPLETED_6MO
    FROM (${DW_TURNS_SQL}) t
    WHERE (t.N_MoveIn IS NULL AND t.RECENT_TURN_RANK = 1)
       OR t.TURN_COMPLETED_BOM >= DATE_TRUNC('month',DATEADD('month',-5,CURRENT_DATE()))
    ${orgW} ${regionW}`);

  const inProc = rows.filter((r) => Number(r.IS_INPROCESS) === 1);
  const done = rows.filter((r) => Number(r.IS_COMPLETED_6MO) === 1);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const netCost = (r: Record<string, unknown>) => Math.max(0, (num(r.TKT_COST) ?? 0) - (num(r.MOR) ?? 0));

  const kpiAvgDaysActive = avg(inProc.map((r) => num(r.DAYS_ACTIVE)).filter((v): v is number => v != null));
  const kpiNetCost = avg(done.map(netCost).filter((v) => v > 0));
  const kpiDaysMoMi = avg(done.map((r) => num(r.DAYS_MO_MI)).filter((v): v is number => v != null));
  const kpiRentGrowth = avg(done.map((r) => num(r.RENT_GROWTH)).filter((v): v is number => v != null));

  // Filter options from the rows (portfolio spans most orgs/regions).
  const uniq = (xs: unknown[]) => Array.from(new Set(xs.map((x) => String(x ?? "")).filter(Boolean))).sort();

  conn.close();

  const payload: TabPayload = {
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: "Turns In Process", value: n(inProc.length) },
      { label: "Avg Days In Turn", value: dec(kpiAvgDaysActive, 1) },
      { label: "Completed (Trailing 6mo)", value: n(done.length) },
      { label: "Avg Net Turn Cost", value: m(kpiNetCost) },
      { label: "Avg Days MO→MI", value: dec(kpiDaysMoMi, 1) },
      { label: "Avg Turn Rent Growth", value: p(kpiRentGrowth == null ? null : kpiRentGrowth * 100), tone: kpiRentGrowth != null && kpiRentGrowth < 0 ? "neg" : "pos" },
    ],
    tables: [
      { title: `Turns In Process (${inProc.length})`, headers: ["Entity ID", "Region", "Org", "Strategy", "Move-Out", "Days In Turn", "WOs Open", "WOs Closed", "QC", "Turn Cost", "On Market"], aligns: ["l", "l", "l", "l", "r", "r", "r", "r", "l", "r", "l"],
        rows: inProc.sort((a, b) => (num(b.DAYS_ACTIVE) ?? 0) - (num(a.DAYS_ACTIVE) ?? 0)).slice(0, 800).map((r) => [
          String(r.ENTITYID ?? ""), String(r.REGION ?? ""), String(r.ORG ?? ""), String(r.STRATEGY ?? "") || "—",
          fdate(r.MO as string), n(r.DAYS_ACTIVE), n(r.TKT_WOS_OPEN), n(r.TKT_WOS_CLOSED), String(r.QC ?? "") || "—", m(netCost(r)), Number(r.ON_MARKET_FLAG) === 1 ? "Yes" : "—",
        ]), note: "Latest turn per property, not yet re-leased." },
      { title: `Completed Turns — Trailing 6 Months (${done.length})`, headers: ["Entity ID", "Region", "Org", "Move-Out", "Move-In", "Days MO→MI", "Turn Cost", "Rent Growth", "QC"], aligns: ["l", "l", "l", "r", "r", "r", "r", "r", "l"],
        rows: done.sort((a, b) => new Date(String(b.TURN_COMPLETED ?? 0)).getTime() - new Date(String(a.TURN_COMPLETED ?? 0)).getTime()).slice(0, 800).map((r) => [
          String(r.ENTITYID ?? ""), String(r.REGION ?? ""), String(r.ORG ?? ""), fdate(r.MO as string), fdate(r.MI as string),
          n(r.DAYS_MO_MI), m(netCost(r)), p(num(r.RENT_GROWTH) == null ? null : (num(r.RENT_GROWTH) as number) * 100), String(r.QC ?? "") || "—",
        ]) },
    ],
    filters: { orgs: uniq(rows.map((r) => r.ORG)), regions: uniq(rows.map((r) => r.REGION)) },
    errors: errors.length ? errors : undefined,
  };
  CACHE.set(key, { at: Date.now(), payload });
  return NextResponse.json(payload);
}
