import { NextResponse } from "next/server";
import { connect } from "@/lib/snowflake";
import { DB, orgCase, excl, esc, m, n, dec, d as fdate, makeCache, type TabPayload } from "@/lib/dbt";

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

  const FROM = `FROM ${DB}.FCT_DEAL_STATUS_ACCUM f LEFT JOIN ${DB}.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY=f.ORGANIZATION_KEY LEFT JOIN ${DB}.DIM_REGION R ON R.REGION_KEY=f.REGION_KEY`;
  const orgW = org ? `AND (${orgCase("f")}) = '${esc(org)}'` : "";
  const regionW = region ? `AND R.REGION_NAME = '${esc(region)}'` : "";
  const WHERE = `${excl("f")} ${orgW} ${regionW}`;
  const INPROG = `f.CURRENT_DEAL_STATUS NOT ILIKE '%won%' AND f.CURRENT_DEAL_STATUS NOT ILIKE '%lost%' AND f.CURRENT_DEAL_STATUS NOT ILIKE '%dead%' AND f.CURRENT_DEAL_STATUS NOT ILIKE '%cancel%' AND f.CURRENT_DEAL_STATUS NOT ILIKE '%clos%' AND f.CURRENT_DEAL_STATUS NOT ILIKE '%reject%' AND f.CURRENT_DEAL_STATUS NOT ILIKE '%denied%' AND f.CURRENT_DEAL_STATUS NOT ILIKE '%declin%'`;
  const TK = `TO_NUMBER(TO_CHAR(CURRENT_DATE(),'YYYYMMDD'))`;
  const KMINUS = (days: number) => `TO_NUMBER(TO_CHAR(DATEADD('day',-${days},CURRENT_DATE()),'YYYYMMDD'))`;
  const KDATE = (col: string) => `TO_DATE(TO_CHAR(NULLIF(${col},0)),'YYYYMMDD')`;

  const k = (await run("kpis", `SELECT
      COUNT(DISTINCT IFF(${INPROG}, f.DEAL_KEY, NULL)) AS INPROG,
      COUNT(DISTINCT IFF(f.DEAL_CREATE_DATE_KEY >= ${KMINUS(90)}, f.DEAL_KEY, NULL)) AS APPS_90,
      COUNT(DISTINCT IFF(f.APPLICATION_APPROVED_DATE_KEY >= ${KMINUS(90)}, f.DEAL_KEY, NULL)) AS APPR_90,
      COUNT(DISTINCT IFF(f.EXPECTED_MOVE_IN_DATE_KEY > ${TK} OR f.LEASE_START_DATE_KEY > ${TK}, f.DEAL_KEY, NULL)) AS FUTURE_MI,
      COUNT(DISTINCT IFF(f.LEASE_START_DATE_KEY BETWEEN ${KMINUS(30)} AND ${TK}, f.DEAL_KEY, NULL)) AS MI_30
    ${FROM} WHERE ${WHERE}`))[0] || {};

  const hfWhere = `${excl("h")} ${org ? `AND (${orgCase("h")}) = '${esc(org)}'` : ""} ${region ? `AND R.REGION_NAME='${esc(region)}'` : ""}`;
  const hf = (await run("hf", `SELECT COUNT(DISTINCT h.DEAL_KEY) AS CNT, SUM(h.AMOUNT) AS AMT
    FROM ${DB}.FCT_HOLDING_FEE_TRANSACTION h LEFT JOIN ${DB}.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY=h.ORGANIZATION_KEY LEFT JOIN ${DB}.DIM_REGION R ON R.REGION_KEY=h.REGION_KEY
    WHERE ${hfWhere} AND h.TRANSACTION_DATE >= DATEADD('day',-90,CURRENT_DATE())`))[0] || {};

  const byStatus = await run("byStatus", `SELECT COALESCE(f.CURRENT_DEAL_STATUS,'(none)') AS S, COUNT(DISTINCT f.DEAL_KEY) AS N ${FROM} WHERE ${WHERE} AND ${INPROG} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
  const fmiByMonth = await run("fmiMonth", `SELECT TO_CHAR(${KDATE("f.LEASE_START_DATE_KEY")},'Mon YYYY') AS MO, MIN(${KDATE("f.LEASE_START_DATE_KEY")}) AS SORT, COUNT(DISTINCT f.DEAL_KEY) AS N ${FROM} WHERE ${WHERE} AND f.LEASE_START_DATE_KEY > ${TK} GROUP BY 1 ORDER BY SORT LIMIT 12`);
  const detail = await run("detail", `SELECT f.DEAL_ID, R.REGION_NAME AS REGION, f.CURRENT_DEAL_STATUS AS S, f.HOLDING_FEE_PAID_DATE AS HF, ${KDATE("f.EXPECTED_MOVE_IN_DATE_KEY")} AS EMI, ${KDATE("f.LEASE_START_DATE_KEY")} AS LSD, f.DAYS_TO_MOVEIN AS DTM, f.RENTAL_RATE AS RENT ${FROM} WHERE ${WHERE} AND ${INPROG} ORDER BY f.EXPECTED_MOVE_IN_DATE_KEY NULLS LAST LIMIT 500`);
  const orgs = await run("orgs", `SELECT DISTINCT (${orgCase("f")}) AS S ${FROM} WHERE ${excl("f")} ${regionW} ORDER BY 1`);
  const regions = await run("regions", `SELECT DISTINCT R.REGION_NAME AS S ${FROM} WHERE ${excl("f")} ${orgW} ORDER BY 1`);
  conn.close();

  const payload: TabPayload = {
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: "Deals in Progress", value: n(k.INPROG) },
      { label: "Applications (L90)", value: n(k.APPS_90) },
      { label: "Approved (L90)", value: n(k.APPR_90) },
      { label: "Future Move-Ins", value: n(k.FUTURE_MI) },
      { label: "Move-Ins (L30)", value: n(k.MI_30) },
      { label: "Holding Fees (L90)", value: n(hf.CNT) },
    ],
    tables: [
      { title: "Deals in Progress by Status", headers: ["Status", "Deals"], aligns: ["l", "r"], rows: byStatus.map((r) => [String(r.S), n(r.N)]) },
      { title: "Future Move-Ins by Month", headers: ["Month", "Deals"], aligns: ["l", "r"], rows: fmiByMonth.map((r) => [String(r.MO ?? ""), n(r.N)]) },
      { title: "Deals in Progress Detail", headers: ["Deal ID", "Region", "Status", "HF Paid", "Exp. Move-In", "Lease Start", "Days to MI", "Rent"], aligns: ["l", "l", "l", "r", "r", "r", "r", "r"], rows: detail.map((r) => [String(r.DEAL_ID ?? ""), String(r.REGION ?? ""), String(r.S ?? ""), fdate(r.HF), fdate(r.EMI), fdate(r.LSD), n(r.DTM), m(r.RENT)]), note: "In-progress deals (top 500 by expected move-in)." },
    ],
    filters: { orgs: orgs.map((r) => String(r.S)).filter(Boolean), regions: regions.map((r) => String(r.S)).filter(Boolean) },
    errors: errors.length ? errors : undefined,
  };
  void dec;
  CACHE.set(key, { at: Date.now(), payload });
  return NextResponse.json(payload);
}
