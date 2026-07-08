// app/api/filters/route.ts
import { NextResponse } from "next/server";
import { connect } from "@/lib/snowflake";
export const maxDuration = 60;

export async function GET() {
  let conn: Awaited<ReturnType<typeof connect>> | null = null;
  try { conn = await connect(); }
  catch (e) { return NextResponse.json({ error: String(e) }, { status: 500 }); }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = async (sql: string): Promise<any[]> => {
    try { return await conn!.query(sql); } catch { return []; }
  };

  const BASE_JOINS = `
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON P.PROPERTY_KEY = PUS.PROPERTY_KEY
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY
    LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTIES HBAM ON HBAM.HBID = P.HBAM_PROPERTY_ID
    LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES HBPM ON HBPM.PROPERTYID = P.HBPM_PROPERTY_ID`;

  const FILT = `P.PROPERTY_STATE = 'Active' AND P.EntityID <> ''
    AND PO.Portfolio_KEY NOT IN (223,598,147,102,109,28,603,169,602,170,58,54)
    AND PUS.Organization_KEY NOT IN (16,17)
    AND PO.IS_Active_AM = 'Y' AND PO.Current_Flag = 'Y'
    AND P.Current_Flag = 'Y' AND PU.Current_Flag = 'Y'
    AND PUS.Occupancy_Status NOT IN ('Not Managed','Dispositions')
    AND (HBPM.PROPERTYSTATEID = 26 OR HBPM.PROPERTYSTATEID IS NULL)
    AND (HBAM.PROPERTYSTATUSID > 9 OR HBAM.PROPERTYSTATUSID IS NULL)
    AND (HBAM.PROPERTYSTATUSID NOT IN (53,75) OR HBAM.PROPERTYSTATUSID IS NULL)`;

  const [orgRows, regionRows, subRows, pmRows, mapRows] = await Promise.all([
    // Organizations — 7 groups matching Power BI
    run(`SELECT DISTINCT CASE
        WHEN PUS.ORGANIZATION_KEY IN (-1,18,26,28,48) THEN 'RP SFR'
        WHEN PUS.ORGANIZATION_KEY IN (27,50,51,52,54,45,55,53,56,57,66) THEN 'RB DRC'
        WHEN PUS.ORGANIZATION_KEY IN (58,59) THEN 'Hudson Oak'
        WHEN PUS.ORGANIZATION_KEY IN (62,63,64,65,68,69) THEN 'Rocklyn Homes'
        WHEN PUS.ORGANIZATION_KEY IN (61,70,71) THEN 'ROI Property Group'
        WHEN PUS.ORGANIZATION_KEY IN (72,73,74,75) THEN 'McKinley Homes'
        WHEN PUS.ORGANIZATION_KEY IN (67) THEN 'Newstar'
      END AS VAL
      FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS ${BASE_JOINS}
      WHERE ${FILT} AND VAL IS NOT NULL ORDER BY VAL`),

    // Regions — POD groups matching Power BI (FL, GA, SCATTERED, WEST)
    run(`SELECT DISTINCT CASE
        WHEN PUS.REGION_KEY IN (57,58,60,64,769,770) THEN 'FL'
        WHEN PUS.REGION_KEY IN (67,76) THEN 'GA'
        WHEN PUS.REGION_KEY IN (104,161,230,246,75,7) THEN 'SCATTERED'
        WHEN PUS.REGION_KEY IN (257,207,253,255) THEN 'WEST'
        ELSE NULL
      END AS VAL
      FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS ${BASE_JOINS}
      WHERE ${FILT} AND VAL IS NOT NULL ORDER BY VAL`),

    // Subdivisions
    run(`SELECT DISTINCT SUB.SUBDIVISION AS VAL
      FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS
      LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_SUBDIVISION SUB ON SUB.SUBDIVISION_KEY = PUS.SUBDIVISION_KEY
      ${BASE_JOINS}
      WHERE ${FILT} AND SUB.SUBDIVISION IS NOT NULL ORDER BY VAL`),

    // Property Managers
    run(`SELECT DISTINCT COALESCE(U.FirstName || ' ' || U.LastName,'(Blank)') AS VAL
      FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS
      ${BASE_JOINS}
      LEFT JOIN PROD_REPLICA.HBPM_DBO.USERS U ON U.USERID = HBPM.ASSIGNEDUSERID
      WHERE ${FILT} ORDER BY VAL`),

    // Map coordinates
    run(`SELECT
        TRY_TO_DOUBLE(P.LATITUDE) AS LAT,
        TRY_TO_DOUBLE(P.LONGITUDE) AS LON,
        CASE
          WHEN PUS.OCCUPANCY_STATUS IN ('Tenant Leased','Trustee Leased','Trustee Lease Honored') THEN 'leased'
          WHEN PUS.OCCUPANCY_STATUS IN ('Vacant - On Market','Vacant - Pre-Leasing') THEN 'on_market'
          WHEN PUS.OCCUPANCY_STATUS IN ('Vacant - Off Market','Vacant - Onboarding') THEN 'off_market'
          WHEN PUS.OCCUPANCY_STATUS = 'Vacant - Future Move In' THEN 'fmi'
          WHEN PUS.OCCUPANCY_STATUS IN ('Pending MOI/Rekey','Under Turnkey') THEN 'turnkey'
          ELSE 'other'
        END AS STATUS_GRP,
        P.ADDRESS
      FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS
      ${BASE_JOINS}
      WHERE ${FILT}
      AND TRY_TO_DOUBLE(P.LATITUDE) BETWEEN 20 AND 55
      AND TRY_TO_DOUBLE(P.LONGITUDE) BETWEEN -130 AND -60`),
  ]);

  conn.close();

  const vals = (rows: Record<string, unknown>[]) =>
    [...new Set(rows.map(r => String(r.VAL ?? "")).filter(Boolean))].sort();

  return NextResponse.json({
    organizations: vals(orgRows),
    regions: vals(regionRows),
    subdivisions: vals(subRows),
    propertyManagers: vals(pmRows),
    // Fixed Property Status list matching Power BI exactly
    propertyStatuses: [
      "Vacant - Off Market","Vacant - On Market","Vacant - FMI",
      "Trustee Leased","Tenant Leased","Turnkey"
    ],
    mapPoints: mapRows.map(r => ({
      lat: Number(r.LAT), lon: Number(r.LON),
      status: String(r.STATUS_GRP), address: String(r.ADDRESS ?? ""),
    })).filter(p => p.lat && p.lon),
  });
}