import { NextResponse } from "next/server";
import { connect } from "@/lib/snowflake";

// On Market data — active rental listings from the working DBT source
// (FCT_PROP_RENTAL_LISTING_HIST → DIM_LISTING → FCT_PROPERTY_UNIT_SUMMARY),
// mirroring summary-v2's listings join/filter. Leads/Showings/1099-inspection
// sections of the PBI page have no wired source yet, so the UI stubs those.
// 30-min in-memory cache keyed by org|region (?fresh=1 forces recompute).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CACHE = new Map<string, { at: number; payload: any }>();
const TTL = 30 * 60 * 1000;

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const org = url.searchParams.get("org") || "";
  const region = url.searchParams.get("region") || "";
  const fresh = url.searchParams.get("fresh") === "1";
  const key = `${org}|${region}`;
  const cached = CACHE.get(key);
  if (cached && !fresh) return NextResponse.json(cached.payload);

  let conn: Awaited<ReturnType<typeof connect>> | null = null;
  try { conn = await connect(); }
  catch (e) { return NextResponse.json({ error: "Snowflake connection failed", detail: String(e) }, { status: 500 }); }

  const errors: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = async (label: string, sql: string): Promise<any[]> => {
    try { return await conn!.query(sql); }
    catch (e) { errors.push(`${label}: ${(e as Error).message}`); return []; }
  };
  const esc = (s: string) => s.replace(/'/g, "''");

  const ORG_CASE = `CASE
    WHEN PUS.ORGANIZATION_KEY IN (-1,18,26,28,48) THEN 'RP SFR'
    WHEN PUS.ORGANIZATION_KEY IN (27,50,51,52,54,45,55,53,56,57,66) THEN 'RB DRC'
    WHEN PUS.ORGANIZATION_KEY IN (58,59) THEN 'Hudson Oak'
    WHEN PUS.ORGANIZATION_KEY IN (62,63,64,65,68,69) THEN 'Rocklyn Homes'
    WHEN PUS.ORGANIZATION_KEY IN (61,70,71) THEN 'ROI Property Group'
    WHEN PUS.ORGANIZATION_KEY IN (72,73,74,75) THEN 'McKinley Homes'
    WHEN PUS.ORGANIZATION_KEY IN (67) THEN 'Newstar'
    ELSE O.ORGANIZATION_NAME END`;

  const FROM = `
    FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_RENTAL_LISTING_HIST RLH
    JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_LISTING DL ON DL.LISTING_KEY=RLH.LISTING_KEY
    JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS ON PUS.PROPERTY_KEY=RLH.PROPERTY_KEY
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON P.PROPERTY_KEY=PUS.PROPERTY_KEY AND P.CURRENT_FLAG='Y'
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO ON PO.PORTFOLIO_KEY=PUS.PORTFOLIO_KEY
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU ON PU.PROPERTY_UNIT_KEY=PUS.PROPERTY_UNIT_KEY
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_REGION R ON R.REGION_KEY=PUS.REGION_KEY
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY=PUS.ORGANIZATION_KEY
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_SUBDIVISION SD ON SD.SUBDIVISION_KEY=PUS.SUBDIVISION_KEY AND SD.CURRENT_FLAG='Y'
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_FLOORPLAN FP ON FP.FLOORPLAN_KEY=PUS.FLOORPLAN_KEY AND FP.CURRENT_FLAG='Y'
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_COUNTY CO ON CO.COUNTY_KEY=PUS.COUNTY_KEY
    LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES HBPM ON HBPM.PROPERTYID=P.HBPM_PROPERTY_ID
    LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTIES HBAM ON HBAM.HBID=P.HBAM_PROPERTY_ID`;

  const FILT_BASE = `
    PO.Portfolio_KEY NOT IN (223,598,147,102,109,28,603,169,602,170,58,54)
    AND PUS.Organization_KEY NOT IN (16,17) AND PO.IS_Active_AM='Y' AND PO.Current_Flag='Y'
    AND P.Current_Flag='Y' AND PU.Current_Flag='Y'
    AND PUS.Occupancy_Status NOT IN ('Not Managed','Dispositions')
    AND (HBPM.PROPERTYSTATEID=26 OR HBPM.PROPERTYSTATEID IS NULL)
    AND (HBAM.PROPERTYSTATUSID>9 OR HBAM.PROPERTYSTATUSID IS NULL)
    AND (HBAM.PROPERTYSTATUSID NOT IN (53,75) OR HBAM.PROPERTYSTATUSID IS NULL)
    AND P.PROPERTY_STATE='Active' AND P.EntityID<>''`;
  const orgWhere = org ? `AND (${ORG_CASE}) = '${esc(org)}'` : "";
  const regionWhere = region ? `AND R.REGION_NAME = '${esc(region)}'` : "";
  const FILT = `${FILT_BASE} ${orgWhere} ${regionWhere}`;
  const ACTIVE = `RLH.LISTING_STATUS='Active' AND DL.IS_PUBLISHED='Y'`;
  const DOM = `DATEDIFF('day', RLH.LISTING_DATE, CURRENT_DATE())`;

  const kpiRaw = await run("kpis", `
    SELECT COUNT(*) AS CNT,
      AVG(${DOM}) AS DOM,
      AVG(RLH.CURRENT_LIST_PRICE) AS PRICE,
      AVG(RLH.CURRENT_LIST_PRICE / NULLIF(PU.SQUARE_FOOTAGE,0)) AS PSQFT,
      AVG(IFF(RLH.CONCESSION_TYPE IS NOT NULL AND RLH.CONCESSION_TYPE <> '', 1.0, 0)) * 100 AS CONC,
      AVG(RLH.CURRENT_LIST_PRICE / NULLIF(RLH.INITIAL_LIST_PRICE,0) - 1) * 100 AS VAR
    ${FROM} WHERE ${ACTIVE} AND ${FILT}`);
  const k = kpiRaw[0] || {};
  const numOr = (v: unknown) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

  const byMonthRaw = await run("byMonth", `
    SELECT TO_CHAR(DATE_TRUNC('month', RLH.LISTING_DATE),'Mon YYYY') AS MONTH,
      MIN(RLH.LISTING_DATE) AS SORT, COUNT(*) AS N
    ${FROM} WHERE ${FILT} AND RLH.LISTING_DATE >= DATEADD('month',-11,DATE_TRUNC('month',CURRENT_DATE()))
    GROUP BY 1 ORDER BY SORT`);

  const byAgentRaw = await run("byAgent", `
    SELECT COALESCE(NULLIF(TRIM(RLH.LEASING_AGENT),''),'(Unassigned)') AS AGENT, COUNT(*) AS N
    ${FROM} WHERE ${ACTIVE} AND ${FILT} GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);

  const byDomRaw = await run("byDom", `
    SELECT CASE
      WHEN ${DOM} <= 7 THEN '0-7' WHEN ${DOM} <= 14 THEN '8-14' WHEN ${DOM} <= 30 THEN '15-30'
      WHEN ${DOM} <= 60 THEN '31-60' WHEN ${DOM} <= 90 THEN '61-90' ELSE '90+' END AS BUCKET,
      COUNT(*) AS N
    ${FROM} WHERE ${ACTIVE} AND ${FILT} GROUP BY 1`);

  const listRaw = await run("listings", `
    SELECT P.ENTITYID, R.REGION_NAME AS REGION, RLH.LISTING_STATUS AS STATUS,
      COALESCE(SD.SUBDIVISION,'') AS SUBDIVISION, COALESCE(FP.FLOORPLAN,'') AS FLOORPLAN, COALESCE(CO.COUNTY_NAME,'') AS COUNTY,
      PU.BEDROOMS AS BED, PU.BATHROOMS AS BATH, PU.SQUARE_FOOTAGE AS SQFT,
      RLH.CURRENT_LIST_PRICE AS PRICE, RLH.INITIAL_LIST_PRICE AS INIT_PRICE, RLH.CONCESSION_TYPE AS CONCESSION,
      COALESCE(NULLIF(TRIM(RLH.LEASING_AGENT),''),'(Unassigned)') AS AGENT,
      RLH.LISTING_DATE AS LDATE, ${DOM} AS DOM, P.ADDRESS
    ${FROM} WHERE ${ACTIVE} AND ${FILT} ORDER BY DOM DESC LIMIT 2000`);

  const orgOptRaw = await run("orgs", `SELECT DISTINCT (${ORG_CASE}) AS S ${FROM} WHERE ${ACTIVE} AND ${FILT_BASE} ${regionWhere} ORDER BY 1`);
  const regionOptRaw = await run("regions", `SELECT DISTINCT R.REGION_NAME AS S ${FROM} WHERE ${ACTIVE} AND ${FILT_BASE} ${orgWhere} ORDER BY 1`);

  conn.close();

  const payload = {
    generatedAt: new Date().toISOString(),
    errors: errors.length ? errors : undefined,
    kpis: {
      activeListings: numOr(k.CNT) ?? 0,
      avgDom: numOr(k.DOM),
      avgPrice: numOr(k.PRICE),
      listPerSqft: numOr(k.PSQFT),
      concessionPct: numOr(k.CONC),
      listingVar: numOr(k.VAR),
    },
    byMonth: byMonthRaw.map((r) => ({ month: String(r.MONTH), n: Number(r.N) })),
    byAgent: byAgentRaw.map((r) => ({ agent: String(r.AGENT), n: Number(r.N) })),
    byDom: byDomRaw.map((r) => ({ bucket: String(r.BUCKET), n: Number(r.N) })),
    listings: listRaw.map((r) => ({
      entityId: String(r.ENTITYID ?? ""), region: String(r.REGION ?? ""), status: String(r.STATUS ?? ""),
      subdivision: String(r.SUBDIVISION ?? ""), floorplan: String(r.FLOORPLAN ?? ""), county: String(r.COUNTY ?? ""),
      bed: numOr(r.BED), bath: numOr(r.BATH), sqft: numOr(r.SQFT),
      price: numOr(r.PRICE), initPrice: numOr(r.INIT_PRICE), concession: r.CONCESSION ? String(r.CONCESSION) : "",
      agent: String(r.AGENT ?? ""), listingDate: r.LDATE ? String(r.LDATE) : null, dom: numOr(r.DOM), address: String(r.ADDRESS ?? ""),
    })),
    filters: {
      orgs: orgOptRaw.map((r) => String(r.S)).filter(Boolean),
      regions: regionOptRaw.map((r) => String(r.S)).filter(Boolean),
    },
  };

  CACHE.set(key, { at: Date.now(), payload });
  return NextResponse.json(payload);
}
