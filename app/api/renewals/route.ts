import { NextResponse } from "next/server";
import { connect } from "@/lib/snowflake";
import { DB, orgCase, excl, esc, m, n, p, d as fdate, makeCache, type TabPayload } from "@/lib/dbt";

const CACHE = makeCache();
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const selOrg = url.searchParams.getAll("org").filter(Boolean), selRegion = url.searchParams.getAll("region").filter(Boolean), fresh = url.searchParams.get("fresh") === "1";
  const org = selOrg[0] || "", region = selRegion[0] || "";
  const orgIn = (col: string) => selOrg.length ? `AND (${col}) IN (${selOrg.map(v => `'${esc(v)}'`).join(",")})` : "";
  const regionIn = (col: string) => selRegion.length ? `AND ${col} IN (${selRegion.map(v => `'${esc(v)}'`).join(",")})` : "";
  const key = `${selOrg.join(",")}|${selRegion.join(",")}`;
  const c0 = CACHE.get(key); if (c0 && !fresh) return NextResponse.json(c0.payload);
  let conn: Awaited<ReturnType<typeof connect>>; try { conn = await connect(); } catch (e) { return NextResponse.json({ error: "Snowflake connection failed", detail: String(e) }, { status: 500 }); }
  const errors: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = async (l: string, sql: string): Promise<any[]> => { try { return await conn.query(sql); } catch (e) { errors.push(`${l}: ${(e as Error).message}`); return []; } };

  // ── Renewals (leasing accum) ──
  const LA = `FROM ${DB}.FCT_TENANT_LEASING_ACCUM la
    LEFT JOIN ${DB}.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY=la.ORGANIZATION_KEY
    LEFT JOIN ${DB}.DIM_REGION R ON R.REGION_KEY=la.REGION_KEY
    LEFT JOIN ${DB}.DIM_TENANT T ON T.TENANT_KEY=la.TENANT_KEY AND T.CURRENT_FLAG='Y'`;
  const orgWla = orgIn(orgCase("la"));
  const regionW = regionIn("R.REGION_NAME");
  const WHl = `${excl("la")} ${orgWla} ${regionW}`;
  const TK = `TO_NUMBER(TO_CHAR(CURRENT_DATE(),'YYYYMMDD'))`;
  const TK90 = `TO_NUMBER(TO_CHAR(DATEADD('day',90,CURRENT_DATE()),'YYYYMMDD'))`;
  const GROWTH = `IFF(la.LATEST_RENEWAL_RENT_AMOUNT>0 AND la.INITIAL_RENT_AMOUNT>0, la.LATEST_RENEWAL_RENT_AMOUNT/la.INITIAL_RENT_AMOUNT-1, NULL)`;

  const k = (await run("renewKpis", `SELECT
      COUNT(IFF(la.LATEST_RENEWAL_SIGNED_DATE >= DATEADD('day',-90,CURRENT_DATE()), 1, NULL)) AS RENEW_90,
      AVG(IFF(la.LATEST_RENEWAL_SIGNED_DATE >= DATEADD('day',-90,CURRENT_DATE()), ${GROWTH}, NULL)) * 100 AS RG,
      COUNT(IFF(la.CURRENT_LEASE_EXPIRATION_DATE_KEY BETWEEN ${TK} AND ${TK90}, 1, NULL)) AS EXP_90
    ${LA} WHERE ${WHl}`))[0] || {};

  // ── Move-outs (latest daily-notice snapshot) ──
  const NM = `FROM ${DB}.FCT_DAILY_TENANT_NOTICE_MOVE nm
    LEFT JOIN ${DB}.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY=nm.ORGANIZATION_KEY
    LEFT JOIN ${DB}.DIM_REGION R ON R.REGION_KEY=nm.REGION_KEY`;
  const orgWnm = orgIn(orgCase("nm"));
  const WHn = `${excl("nm")} AND nm.DATE_KEY = (SELECT MAX(DATE_KEY) FROM ${DB}.FCT_DAILY_TENANT_NOTICE_MOVE) ${orgWnm} ${regionW}`;
  const mo = (await run("moKpis", `SELECT
      COUNT(DISTINCT IFF(nm.ANTICIPATED_MOVE_OUT_DATE >= CURRENT_DATE(), nm.TENANT_KEY, NULL)) AS UPCOMING,
      COUNT(DISTINCT IFF(nm.NOTICE_DATE >= DATEADD('day',-30,CURRENT_DATE()), nm.TENANT_KEY, NULL)) AS NOTICE_30
    ${NM} WHERE ${WHn}`))[0] || {};

  const renewDetail = await run("renewDetail", `SELECT TRIM(COALESCE(T.FIRST_NAME,'')||' '||COALESCE(T.LAST_NAME,'')) AS NAME, R.REGION_NAME AS REGION, la.INITIAL_RENT_AMOUNT AS IR, la.LATEST_RENEWAL_RENT_AMOUNT AS RR, ${GROWTH}*100 AS RG, la.LATEST_RENEWAL_SIGNED_DATE AS SD, la.LATEST_LEASE_TERM AS TERM ${LA} WHERE ${WHl} AND la.LATEST_RENEWAL_SIGNED_DATE >= DATEADD('day',-90,CURRENT_DATE()) ORDER BY la.LATEST_RENEWAL_SIGNED_DATE DESC LIMIT 500`);
  const moDetail = await run("moDetail", `SELECT nm.ENTITYID, R.REGION_NAME AS REGION, nm.NOTICE_DATE AS ND, nm.ANTICIPATED_MOVE_OUT_DATE AS AMD, nm.OCCUPANCY_STATUS AS OS, nm.PROPERTY_STATUS AS PS ${NM} WHERE ${WHn} AND nm.ANTICIPATED_MOVE_OUT_DATE >= CURRENT_DATE() ORDER BY nm.ANTICIPATED_MOVE_OUT_DATE LIMIT 500`);
  const orgs = await run("orgs", `SELECT DISTINCT (${orgCase("la")}) AS S ${LA} WHERE ${excl("la")} ${regionW} ORDER BY 1`);
  const regions = await run("regions", `SELECT DISTINCT R.REGION_NAME AS S ${LA} WHERE ${excl("la")} ${orgWla} ORDER BY 1`);
  conn.close();

  const payload: TabPayload = {
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: "Renewals Signed (L90)", value: n(k.RENEW_90) },
      { label: "Avg Renewal Rent Growth", value: p(k.RG), tone: k.RG != null && Number(k.RG) < 0 ? "neg" : "pos" },
      { label: "Upcoming Expirations (90d)", value: n(k.EXP_90) },
      { label: "Upcoming Move-Outs", value: n(mo.UPCOMING) },
      { label: "Move-Out Notices (L30)", value: n(mo.NOTICE_30) },
    ],
    tables: [
      { title: "Renewals Signed (L90)", headers: ["Tenant", "Region", "Initial Rent", "Renewal Rent", "Rent Growth", "Signed", "Term (mo)"], aligns: ["l", "l", "r", "r", "r", "r", "r"], rows: renewDetail.map((r) => [String(r.NAME ?? "").trim() || "—", String(r.REGION ?? ""), m(r.IR), m(r.RR), p(r.RG), fdate(r.SD), n(r.TERM)]) },
      { title: "Upcoming Move-Outs", headers: ["Entity ID", "Region", "Notice Date", "Anticipated Move-Out", "Occupancy Status"], aligns: ["l", "l", "r", "r", "l"], rows: moDetail.map((r) => [String(r.ENTITYID ?? ""), String(r.REGION ?? ""), fdate(r.ND), fdate(r.AMD), String(r.OS ?? "")]), note: "From the latest daily move-out-notice snapshot." },
    ],
    filters: { orgs: orgs.map((r) => String(r.S)).filter(Boolean), regions: regions.map((r) => String(r.S)).filter(Boolean) },
    errors: errors.length ? errors : undefined,
  };
  CACHE.set(key, { at: Date.now(), payload });
  return NextResponse.json(payload);
}
