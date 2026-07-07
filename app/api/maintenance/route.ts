import { NextResponse } from "next/server";
import { connect } from "@/lib/snowflake";
import { DB, orgCase, excl, esc, m, n, dec, makeCache, TTL, type TabPayload } from "@/lib/dbt";

const CACHE = makeCache();
export const dynamic = "force-dynamic";

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

  const FROM = `FROM ${DB}.FCT_WO_SUMMARY_V2 f
    JOIN ${DB}.DIM_WORKORDER_V2 W ON W.WORKORDER_KEY=f.WORKORDER_KEY AND W.CURRENT_FLAG='Y'
    LEFT JOIN ${DB}.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY=f.ORGANIZATION_KEY
    LEFT JOIN ${DB}.DIM_REGION R ON R.REGION_KEY=f.REGION_KEY`;
  const orgW = org ? `AND (${orgCase("f")}) = '${esc(org)}'` : "";
  const regionW = region ? `AND R.REGION_NAME = '${esc(region)}'` : "";
  const RECENT = `W.CREATED_DATE_KEY >= TO_NUMBER(TO_CHAR(DATEADD('day',-365,CURRENT_DATE()),'YYYYMMDD'))`;
  const WHERE = `${excl("f")} AND ${RECENT} ${orgW} ${regionW}`;
  const OPEN = `W.WORKORDER_STATUS NOT ILIKE '%clos%' AND W.WORKORDER_STATUS NOT ILIKE '%cancel%' AND W.WORKORDER_STATUS NOT ILIKE '%complet%'`;

  const k = (await run("kpis", `SELECT
      COUNT(DISTINCT IFF(${OPEN}, f.WORKORDER_KEY, NULL)) AS OPEN_WO,
      COUNT(DISTINCT IFF(W.CLOSED_DATE >= DATEADD('day',-90,CURRENT_DATE()), f.WORKORDER_KEY, NULL)) AS CLOSED_90,
      AVG(f.WO_CYCLE_TIME) AS CYCLE,
      SUM(IFF(f.CLIENT_INVOICE_DATE >= DATEADD('day',-90,CURRENT_DATE()), f.CLIENT_INVOICE_AMOUNT, 0)) AS INV_90,
      AVG(f.TICKET_CYCLE_TIME) AS TCYCLE,
      COUNT(DISTINCT f.WORKORDER_KEY) AS TOTAL_WO
    ${FROM} WHERE ${WHERE}`))[0] || {};

  const byStatus = await run("byStatus", `SELECT COALESCE(W.WORKORDER_STATUS,'(none)') AS S, COUNT(DISTINCT f.WORKORDER_KEY) AS N, AVG(f.WO_CYCLE_TIME) AS C ${FROM} WHERE ${WHERE} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
  const byCat = await run("byCat", `SELECT COALESCE(W.CATEGORY_NAME,'(none)') AS CAT, COUNT(DISTINCT f.WORKORDER_KEY) AS N, SUM(f.CLIENT_INVOICE_AMOUNT) AS INV ${FROM} WHERE ${WHERE} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
  const openDetail = await run("open", `SELECT MAX(W.HBH_WORKORDER_NO) AS WO, MAX(R.REGION_NAME) AS REGION, MAX(W.WORKORDER_STATUS) AS S, MAX(W.PRIORITY) AS PRI, MAX(W.CATEGORY_NAME) AS CAT, MAX(W.BILL_TO) AS BILL, SUM(f.CLIENT_INVOICE_AMOUNT) AS INV, MAX(f.WO_CYCLE_TIME) AS CYC ${FROM} WHERE ${WHERE} AND ${OPEN} GROUP BY f.WORKORDER_KEY ORDER BY CYC DESC NULLS LAST LIMIT 500`);
  const orgs = await run("orgs", `SELECT DISTINCT (${orgCase("f")}) AS S ${FROM} WHERE ${excl("f")} AND ${RECENT} ${regionW} ORDER BY 1`);
  const regions = await run("regions", `SELECT DISTINCT R.REGION_NAME AS S ${FROM} WHERE ${excl("f")} AND ${RECENT} ${orgW} ORDER BY 1`);
  conn.close();

  const payload: TabPayload = {
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: "Open Work Orders", value: n(k.OPEN_WO) },
      { label: "Closed (L90)", value: n(k.CLOSED_90) },
      { label: "Avg WO Cycle Time", value: dec(k.CYCLE, 1) },
      { label: "Avg Ticket Cycle", value: dec(k.TCYCLE, 1) },
      { label: "Client Invoice (L90)", value: m(k.INV_90) },
      { label: "Total WOs (L365)", value: n(k.TOTAL_WO) },
    ],
    tables: [
      { title: "Open WOs by Status", headers: ["Status", "WOs", "Avg Cycle"], aligns: ["l", "r", "r"], rows: byStatus.map((r) => [String(r.S), n(r.N), dec(r.C, 1)]) },
      { title: "WOs by Category", headers: ["Category", "WOs", "Client Invoice"], aligns: ["l", "r", "r"], rows: byCat.map((r) => [String(r.CAT), n(r.N), m(r.INV)]) },
      { title: "Open Work Order Detail", headers: ["WO #", "Region", "Status", "Priority", "Category", "Bill To", "Invoice", "Cycle"], aligns: ["l", "l", "l", "l", "l", "l", "r", "r"], rows: openDetail.map((r) => [String(r.WO ?? ""), String(r.REGION ?? ""), String(r.S ?? ""), String(r.PRI ?? ""), String(r.CAT ?? ""), String(r.BILL ?? ""), m(r.INV), dec(r.CYC, 1)]), note: "Open work orders created in the last 365 days (top 500 by cycle time)." },
    ],
    filters: { orgs: orgs.map((r) => String(r.S)).filter(Boolean), regions: regions.map((r) => String(r.S)).filter(Boolean) },
    errors: errors.length ? errors : undefined,
  };
  void num;
  CACHE.set(key, { at: Date.now(), payload });
  return NextResponse.json(payload);
}
