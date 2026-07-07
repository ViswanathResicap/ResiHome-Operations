import { NextResponse } from "next/server";
import { connect } from "@/lib/snowflake";
import { DB, orgCase, excl, esc, m, n, p, d as fdate, makeCache, type TabPayload } from "@/lib/dbt";

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

  const FROM = `FROM ${DB}.FCT_TENANT_LEASING_ACCUM la
    LEFT JOIN ${DB}.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY=la.ORGANIZATION_KEY
    LEFT JOIN ${DB}.DIM_REGION R ON R.REGION_KEY=la.REGION_KEY
    LEFT JOIN ${DB}.DIM_TENANT T ON T.TENANT_KEY=la.TENANT_KEY AND T.CURRENT_FLAG='Y'`;
  const orgW = org ? `AND (${orgCase("la")}) = '${esc(org)}'` : "";
  const regionW = region ? `AND R.REGION_NAME = '${esc(region)}'` : "";
  const CUR = `T.TENANT_STATUS NOT IN ('Past','Future')`;
  const WHERE = `${excl("la")} AND ${CUR} ${orgW} ${regionW}`;

  const k = (await run("kpis", `SELECT
      COUNT(IFF(la.BALANCE_DUE > 0, 1, NULL)) AS DELINQ,
      COUNT(*) AS TOTAL,
      SUM(la.BALANCE_DUE) AS BAL,
      SUM(la.PENDING_BALANCE) AS PENDING,
      AVG(IFF(la.BALANCE_DUE > 0, la.BALANCE_DUE, NULL)) AS AVGBAL
    ${FROM} WHERE ${WHERE}`))[0] || {};
  const delinqPct = k.DELINQ != null && k.TOTAL ? (Number(k.DELINQ) / Number(k.TOTAL)) * 100 : null;

  const chg = (await run("charges", `SELECT SUM(c.AMOUNT) AS AMT
    FROM ${DB}.FCT_TENANT_CHARGE_HIST c LEFT JOIN ${DB}.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY=c.ORGANIZATION_KEY LEFT JOIN ${DB}.DIM_REGION R ON R.REGION_KEY=c.REGION_KEY
    WHERE ${excl("c")} ${org ? `AND (${orgCase("c")})='${esc(org)}'` : ""} ${region ? `AND R.REGION_NAME='${esc(region)}'` : ""} AND c.START_DATE >= DATEADD('day',-30,CURRENT_DATE())`))[0] || {};

  const byRegion = await run("byRegion", `SELECT COALESCE(R.REGION_NAME,'(none)') AS REGION, COUNT(IFF(la.BALANCE_DUE>0,1,NULL)) AS DELINQ, SUM(la.BALANCE_DUE) AS BAL ${FROM} WHERE ${WHERE} GROUP BY 1 ORDER BY 3 DESC NULLS LAST LIMIT 25`);
  const topDelinq = await run("top", `SELECT TRIM(COALESCE(T.FIRST_NAME,'')||' '||COALESCE(T.LAST_NAME,'')) AS NAME, R.REGION_NAME AS REGION, la.BALANCE_DUE AS BAL, la.PENDING_BALANCE AS PEND, la.LAST_PAYMENT_DATE AS LPD, T.TENANT_STATUS AS TS ${FROM} WHERE ${WHERE} AND la.BALANCE_DUE > 0 ORDER BY la.BALANCE_DUE DESC LIMIT 500`);
  const orgs = await run("orgs", `SELECT DISTINCT (${orgCase("la")}) AS S ${FROM} WHERE ${excl("la")} AND ${CUR} ${regionW} ORDER BY 1`);
  const regions = await run("regions", `SELECT DISTINCT R.REGION_NAME AS S ${FROM} WHERE ${excl("la")} AND ${CUR} ${orgW} ORDER BY 1`);
  conn.close();

  const payload: TabPayload = {
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: "Delinquent Tenants", value: n(k.DELINQ) },
      { label: "% Delinquent", value: p(delinqPct) },
      { label: "Total Balance Due", value: m(k.BAL), tone: "neg" },
      { label: "Pending Balance", value: m(k.PENDING) },
      { label: "Avg Delinquent Bal", value: m(k.AVGBAL) },
      { label: "Charges (L30)", value: m(chg.AMT) },
    ],
    tables: [
      { title: "Delinquency by Region", headers: ["Region", "Delinquent", "Balance Due"], aligns: ["l", "r", "r"], rows: byRegion.map((r) => [String(r.REGION), n(r.DELINQ), m(r.BAL)]) },
      { title: "Top Delinquent Tenants", headers: ["Tenant", "Region", "Balance Due", "Pending", "Last Payment", "Status"], aligns: ["l", "l", "r", "r", "r", "l"], rows: topDelinq.map((r) => [String(r.NAME ?? "").trim() || "—", String(r.REGION ?? ""), m(r.BAL), m(r.PEND), fdate(r.LPD), String(r.TS ?? "")]), note: "Current tenants with an outstanding balance (top 500)." },
    ],
    stubs: [{ title: "Collection Rate (Paid ÷ Charged)", note: "Needs a receipts/payments source joined to charges — pending." }],
    filters: { orgs: orgs.map((r) => String(r.S)).filter(Boolean), regions: regions.map((r) => String(r.S)).filter(Boolean) },
    errors: errors.length ? errors : undefined,
  };
  CACHE.set(key, { at: Date.now(), payload });
  return NextResponse.json(payload);
}
