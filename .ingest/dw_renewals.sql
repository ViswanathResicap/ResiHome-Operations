/* =============================================================================
   RENEWALS DATASET
   -----------------------------------------------------------------------------
   Grain:      One row per tenant leasing-history record (the "current" lease),
               paired with the next lease (N_*) where one exists, enriched with
               tenant/property/eviction/inspection/renewal-deal context and a
               set of derived renewal-outcome buckets.
   Anchor:     PROD_REPLICA.HBPM_DBO.TENANTLEASINGHISTORIES (TLH)
   Branches off the property foundation; shares its organization roll-up logic.

   CLEANUP NOTES:
     [SYNC]  ORGANIZATION_KEY / ORGANIZATION_NAME CASE updated to mirror the
             master PROPERTY script (source of truth). This script's version was
             the most truncated of all (27-group was only 27,50,51,52).
             DELIBERATE OUTPUT CHANGE — see "ORG SYNC IMPACT".
     [FIX 1] COLLAPSED the duplicate EVICTIONS CTE. It was defined TWICE; only
             three of its columns are consumed downstream
             (EVICTION_EVICTIONSTATUSID, EVICTION_EVICTIONSTATUS,
             EVICTION_EVICTIONTERMINATEDDATE) and those are byte-identical across
             both definitions with the same FROM/filter/ranking — so a single
             definition is output-identical and removes the duplicate-name
             hazard. Kept the richer (COALESCE + EVICTION_DIQ) body.
     [FIX 2] DROPPED dead NT / LM joins inside RenewalNote (never referenced).
     [FIX 3] REMOVED the commented-out LR_O / TLH_O prior-lease scaffolding.
     [FIX 4] REMOVED the ORDER BY inside the RENEWALS CTE (ordering inside a CTE
             that is re-joined downstream has no effect on final output).

   ORG SYNC IMPACT (intended diff vs. original renewals output):
     Renewals tied to these orgs previously fell through to ELSE (raw key +
     unmapped O.ORGANIZATION_NAME); after the sync they roll up:
        54,45,55,53,56,57,66 -> 27 / 'RB DRC'   (added to the 27-group)
        58,59                -> 58 / 'Hudson Oak'
        62,63,64,65,68,69    -> 62 / 'Rocklyn Homes'
        61,70                -> 61 / 'ROI Property Group'
        67                   -> 67 / 'Newstar'
     An EXCEPT diff vs. the old output will show rows ONLY for these orgs.
   ============================================================================= */


/* -----------------------------------------------------------------------------
   CTE: LeaseRanking
   Forward + inverse rank of each lease per tenant, used to walk from the
   current lease (C_*) to the next lease (N_*).
   ----------------------------------------------------------------------------- */
WITH LeaseRanking AS (
    SELECT
         TenantLeasingHistoryId
        ,TenantInformationId
        ,RANK() OVER (PARTITION BY TenantInformationId ORDER BY TenantLeasingHistoryId ASC)  AS Lease_Rank
        ,RANK() OVER (PARTITION BY TenantInformationId ORDER BY TenantLeasingHistoryId DESC) AS Lease_Rank_INV
    FROM PROD_REPLICA.HBPM_DBO.TENANTLEASINGHISTORIES
    WHERE 1 = 1
        AND _FIVETRAN_DELETED <> 'Y'
)

/* -----------------------------------------------------------------------------
   CTE: RenewalNote
   Latest renewal note (NoteTypeId = 1, tenant object) per property.
   ----------------------------------------------------------------------------- */
,RenewalNote AS (
    SELECT
         MAX(NoteID) AS LatestNoteID
        ,P.PropertyId
    FROM PROD_REPLICA.HBPM_DBO.NOTES N
        LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI
            ON  TI.UserID = N.ObjectId
            AND N.ObjectTypeId = 502
        LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PAI
            ON PAI.UnitId = TI.UnitId
        LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES P
            ON P.PropertyID = PAI.PropertyId
    WHERE N.NoteTypeId = 1
        AND N.ObjectTypeId = 502
    GROUP BY P.PropertyId
)

/* -----------------------------------------------------------------------------
   CTE: EVICTION_COUNT
   Count of evictions per tenant/unit in the trailing 12 months.
   ----------------------------------------------------------------------------- */
,EVICTION_COUNT AS (
    SELECT
         UNITID
        ,TENANTINFORMATIONID
        ,COUNT(ID) AS EVICTION_COUNT
    FROM PROD_REPLICA.HBPM_DBO.EVICTIONS E
    WHERE TENANTINFORMATIONID IS NOT NULL
        AND CREATEDDATE >= DATEADD('YEAR', -1, GETDATE())
    GROUP BY UNITID, TENANTINFORMATIONID
)

/* -----------------------------------------------------------------------------
   CTE: EVICTIONS  (single, collapsed definition — see FIX 1)
   Most recent eviction per unit/tenant, with lookup-master descriptions and a
   days-in-queue (EVICTION_DIQ) measure. Consumed downstream via two aliases:
   EV (joined on tenant) and E (for the terminated date).
   ----------------------------------------------------------------------------- */
,EVICTIONS AS (
    SELECT
         UNITID
        ,ET.Description AS EVICTION_EVICTIONTYPE
        ,TENANTINFORMATIONID
        ,ID AS EVICTION_ID
        ,RANK() OVER (PARTITION BY UNITID, TENANTINFORMATIONID ORDER BY ID DESC) AS RECENT_RANK
        ,EVICTIONCOMPANY AS EVICTION_EVICTIONCOMPANY
        ,EVICTIONSOURCE  AS EVICTION_EVICTIONSOURCE
        ,DATESENTTOATTORNEY                     AS EVICTION_DATESENTTOATTORNEY
        ,COALESCE(DATEFILED, DATESENTTOATTORNEY) AS EVICTION_DATEFILED
        ,VENDORSCHEDULED                        AS EVICTION_VENDORSCHEDULED
        ,CASHFORKEYSAMOUNT                      AS EVICTION_CASHFORKEYSAMOUNT
        ,ESTIMATEDVACATEDATE                    AS EVICTION_ESTIMATEDVACATEDATE
        ,DATESCHEDULEDWITHVENDOR                AS EVICTION_DATESCHEDULEDWITHVENDOR
        ,COURTDATESETDATE                       AS EVICTION_COURTDATESETDATE
        ,JUDGMENTDATE                           AS EVICTION_JUDGMENTDATE
        ,CASHFORKEYSCHEDULEDDATE                AS EVICTION_CASHFORKEYSCHEDULEDDATE
        ,PENDINGLOCKOUTDATE                     AS EVICTION_PENDINGLOCKOUTDATE
        ,LOCKOUTSCHEDULEDDATE                   AS EVICTION_LOCKOUTSCHEDULEDDATE
        ,WRITREQUESTEDDATE                      AS EVICTION_WRITREQUESTEDDATE
        ,LASTEDITEDDATE                         AS EVICTION_LASTEDITEDDATE
        ,EVICTIONTERMINATEDDATE                 AS EVICTION_EVICTIONTERMINATEDDATE
        ,DEFENDANTAPPEALDATE                    AS EVICTION_DEFENDANTAPPEALDATE
        ,ANSWERFILEDDATE                        AS EVICTION_ANSWERFILEDDATE
        ,VACATEDATE                             AS EVICTION_VACATEDATE
        ,CASE
            WHEN ES.Description IN ('Filed with County', 'Sent to Attorney')
                THEN DATEDIFF('day', COALESCE(DATEFILED, DATESENTTOATTORNEY), GETDATE())
            WHEN ES.Description IN ('Court Date Set')
                THEN DATEDIFF('day', COURTDATESETDATE, GETDATE())
            WHEN ES.Description IN ('Judgement')
                THEN DATEDIFF('day', JUDGMENTDATE, GETDATE())
            WHEN ES.Description IN ('Writ of Possesion')
                THEN DATEDIFF('day', WRITREQUESTEDDATE, GETDATE())
            WHEN ES.Description IN ('Pending Lockout')
                THEN DATEDIFF('day', COALESCE(LOCKOUTSCHEDULEDDATE, PENDINGLOCKOUTDATE), GETDATE())
            WHEN ES.Description IN ('Lockout Scheduled')
                THEN DATEDIFF('day', LOCKOUTSCHEDULEDDATE, GETDATE())
            WHEN ES.Description NOT IN ('Eviction Terminated', 'Vacated - Skipped', 'Vacated - Completed')
                THEN DATEDIFF('day', LASTEDITEDDATE, GETDATE())
            ELSE NULL
         END AS EVICTION_DIQ
        ,CFK.Description AS EVICTION_CASHFORKEYSTATUS
        ,OI.Description  AS EVICTION_OCCUPANTS_INTENSION
        ,VS.Description  AS EVICTION_VACATESOURCE
        ,ES.Description  AS EVICTION_EVICTIONSTATUS
        ,OT.Description  AS EVICTION_OCCUPANTTYPE
        ,EVICTIONNOTES   AS EVICTION_EVICTIONNOTES
        ,E.EVICTIONSTATUSID AS EVICTION_EVICTIONSTATUSID
    FROM PROD_REPLICA.HBPM_DBO.EVICTIONS E
        LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS CFK ON E.CASHFORKEYSTATUSID = CFK.LOOKUPMASTERID
        LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS ES  ON E.EVICTIONSTATUSID   = ES.LOOKUPMASTERID
        LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS OI  ON E.OCCUINTENSIONID    = OI.LOOKUPMASTERID
        LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS VS  ON E.VACATESOURCEID     = VS.LOOKUPMASTERID
        LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS OT  ON E.OCCUPANTTYPEID     = OT.LOOKUPMASTERID
        LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS ET  ON E.EVICTIONTYPEID     = ET.LOOKUPMASTERID
    WHERE TENANTINFORMATIONID IS NOT NULL
    QUALIFY RECENT_RANK = 1
)

/* -----------------------------------------------------------------------------
   CTE: HUBSPOT
   Live HubSpot property records (entity id -> hubspot record id).
   ----------------------------------------------------------------------------- */
,HUBSPOT AS (
    SELECT
         ID
        ,PROPERTY_ENTITY_ID
    FROM PROD_REPLICA.HUBSPOT_2.PROPERTIES
    WHERE 1 = 1
        AND PROPERTY_ENTITY_ID IS NOT NULL
        AND (_fivetran_deleted = FALSE OR _fivetran_deleted IS NULL)
)

/* -----------------------------------------------------------------------------
   CTE: LAST_CALL
   Most recent outbound-call timestamp per HBPM tenant, from HubSpot contacts.
   ----------------------------------------------------------------------------- */
,LAST_CALL AS (
    SELECT
         PROPERTY_HBPM_TENANT_ID
        ,MAX(TO_VARCHAR(CONVERT_TIMEZONE('America/New_York', PROPERTY_LAST_CALL_DATE_TIMESTAMP),
                        'YYYY-MM-DD HH24:MI:SS')) AS PROPERTY_LAST_CALL_DATE
    FROM PROD_REPLICA.HUBSPOT_2.CONTACT
    WHERE 1 = 1
        AND PROPERTY_HBPM_TENANT_ID IS NOT NULL
    GROUP BY PROPERTY_HBPM_TENANT_ID
)

/* -----------------------------------------------------------------------------
   CTE: RENEWAL_DEAL
   Renewal-pipeline deals with their offered rates, joined to the HubSpot deal
   record. Excludes two bad entity ids and a long list of bad deal ids.
   ----------------------------------------------------------------------------- */
,RENEWAL_DEAL AS (
    SELECT
         R.DEAL_KEY
        ,R.DEAL_ID
        ,R.CURRENT_DEAL_STATUS
        ,TO_DATE(R.LEASE_START_DATE_KEY::TEXT,  'yyyymmdd') AS RENEWAL_START_DATE
        ,TO_DATE(R.LEASE_END_DATE_KEY::TEXT,    'yyyymmdd') AS RENEWAL_END_DATE
        ,TO_DATE(R.LEASE_SIGNED_DATE_KEY::TEXT, 'yyyymmdd') AS RENEWAL_SIGNED_DATE
        ,R.FIRST_NAME
        ,R.LAST_NAME
        ,R.EMAIL
        ,R.PHONE
        ,R.DEAL_OWNER
        ,R.DEAL_NAME
        ,D.PROPERTY_HS_OBJECT_ID
        ,TO_DATE(D.PROPERTY_CREATEDATE::TEXT, 'AUTO') AS CREATED_DATE
        ,D.PROPERTY_LEASE_DRAFTING_STATUS
        ,D.PROPERTY_PRIMARY_APPLICANT_NAME
        ,D.PROPERTY_PROPERTY_ID
        ,D.PROPERTY_ENTITY_ID
        ,D.PROPERTY_ADDRESS
        ,D.PROPERTY_MINIMUM_ACCEPTABLE_RENEWAL_RATE_MARR_ AS MARR
        ,D.PROPERTY_N_12_MONTH_RENEWAL_RATE AS RATE_12_MONTH
        ,D.PROPERTY_N_15_MONTH_RENEWAL_RATE AS RATE_15_MONTH
        ,D.PROPERTY_N_18_MONTH_RENEWAL_RATE AS RATE_18_MONTH
        ,COALESCE(D.PROPERTY_N_24_MONTH_RENEWAL_RATE, D.PROPERTY_N_25_MONTH_RENEWAL_RATE) AS RATE_24_MONTH
        ,D.PROPERTY_MARKET_RENT AS MARKET_RENT
    FROM "PROD_ANALYTICS"."DBT_RESICAP"."DIM_DEAL" R
        LEFT JOIN "PROD_REPLICA"."HUBSPOT_2"."DEAL" D
            ON D.DEAL_ID = R.DEAL_ID
    WHERE 1 = 1
        AND R.DEAL_PIPELINE = 'Renewals'
        AND D.PROPERTY_ENTITY_ID NOT IN ('13545864', '63653634')
        AND R.DEAL_ID NOT IN (
            16852651365,16852662951,16852818188,16852625001,16852830527,16852588187,16852902240,
            16852535222,16852602181,16852613985,16852551050,16851979618,16852902250,16852685735,
            16852606516,16852609954,16852591747,16852838701,16852805227,16852670267,16852769112,
            16852640109,16852769109,16852024887,16852571050,16852651357,16852582701,16852840328,
            16852647079,16852038791,16852575895)
)

/* -----------------------------------------------------------------------------
   CTE: UW_RENT
   Latest underwriting rent change per unit (max RENTLOGID per ENTITYID1).
   ----------------------------------------------------------------------------- */
,UW_RENT_MAX AS (
    SELECT
         MAX(RENTLOGID) AS RENTLOGID
        ,ENTITYID1
    FROM PROD_REPLICA.HBPM_DBO.RENTLOGS
    GROUP BY ENTITYID1
)

,UW_RENT AS (
    SELECT
         RentLogs.ENTITYID1     AS HBPM_UnitID
        ,RentLogs.ORIGINALVALUE AS UW_Rent_Prior
        ,RentLogs.UPDATEVALUE   AS UW_Rent_Current
        ,RentLogs.OCCUREDON     AS UW_Update_Date
    FROM UW_RENT_MAX
        LEFT JOIN PROD_REPLICA.HBPM_DBO.RENTLOGS RentLogs
            ON RentLogs.RENTLOGID = UW_RENT_MAX.RENTLOGID
)

/* -----------------------------------------------------------------------------
   HappyCo inspection chain (Trustee-Leased renewal inspections)
   CLEAN_ITEM -> CLEAN_UNIT -> CLEAN_INPSECTION -> HAPPY_CO_DETAIL -> HAPPY_CO_RENEWAL
   ----------------------------------------------------------------------------- */
,CLEAN_ITEM AS (
    SELECT
         ITEM._MODIFIED
        ,ITEM._ID      AS ITEM_ID
        ,ITEM.SECTION  AS ITEM_Section
        ,ITEM.ITEM     AS ITEM_Item
        ,ITEM.RATINGS  AS ITEM_Ratings
        ,ITEM.NOTES    AS ITEM_Notes
        ,ITEM.INSPECTION_ID
        ,RANK() OVER (PARTITION BY ITEM.INSPECTION_ID
                      ORDER BY DATE_TRUNC('min', _FIVETRAN_SYNCED) DESC) AS UPDATE_RANK
        ,RANK() OVER (PARTITION BY ITEM_SECTION, ITEM_ITEM, ITEM.INSPECTION_ID
                      ORDER BY DATE_TRUNC('min', _MODIFIED) DESC,
                               DATE_TRUNC('min', _DATE_UPDATED) DESC) AS RECENT_RANK
    FROM PROD_REPLICA.HAPPYCO_NEW.ITEM
)

,CLEAN_UNIT_PRE AS (
    SELECT
         UNIT._MODIFIED
        ,UNIT.ID          AS UNIT_ID
        ,UNIT.EXTERNAL_ID AS UNIT_EXTERNAL_ID
        ,UNIT.ADDRESS     AS UNIT_ADDRESS
        ,UNIT.LINE_1      AS UNIT_LINE_1
        ,RANK() OVER (PARTITION BY ID ORDER BY DATE_TRUNC('min', _MODIFIED) DESC) AS RECENT_RANK
    FROM PROD_REPLICA.HAPPY_CO.UNIT
)

,CLEAN_UNIT AS (
    SELECT DISTINCT
         CLEAN_UNIT_PRE.*
        ,COALESCE(P1.PROPERTY_KEY, P2.PROPERTY_KEY, P3.PROPERTY_KEY, P4.PROPERTY_KEY) AS PROPERTY_KEY
    FROM CLEAN_UNIT_PRE
        /* Four fallback property matches: HBAM id, entity id, full address, then a
           10-char address prefix. */
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P1
            ON  TO_CHAR(P1.HBAM_PROPERTY_ID) = CLEAN_UNIT_PRE.UNIT_EXTERNAL_ID
            AND P1.CURRENT_FLAG = 'Y' AND P1.PROPERTY_STATE = 'Active'
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P2
            ON  P2.ENTITYID = CLEAN_UNIT_PRE.UNIT_EXTERNAL_ID
            AND P2.CURRENT_FLAG = 'Y' AND P2.PROPERTY_STATE = 'Active'
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P3
            ON  INITCAP(TRIM(P3.ADDRESS)) = INITCAP(TRIM(CLEAN_UNIT_PRE.UNIT_LINE_1))
            AND P3.CURRENT_FLAG = 'Y' AND P3.PROPERTY_STATE = 'Active'
        LEFT JOIN (
            SELECT LEFT(INITCAP(TRIM(ADDRESS)), 10) AS ADD_TRIM, MAX(PROPERTY_KEY) AS PROPERTY_KEY
            FROM PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY
            WHERE CURRENT_FLAG = 'Y' AND PROPERTY_STATE = 'Active'
            GROUP BY LEFT(INITCAP(TRIM(ADDRESS)), 10)
        ) P4
            ON ADD_TRIM = LEFT(INITCAP(TRIM(CLEAN_UNIT_PRE.UNIT_LINE_1)), 10)
    WHERE CLEAN_UNIT_PRE.RECENT_RANK = 1
)

,CLEAN_INPSECTION AS (
    SELECT
         INS._MODIFIED
        ,INS._LINE
        ,INS.INSPECTION_ID
        ,INS.INSPECTION_INSPECTOR_NAME
        ,INS.INSPECTION_COMPLETED_DATE
        ,INS.INSPECTION_STATUS
        ,INS.INSPECTION_TEMPLATE
        ,INS.INSPECTION_LINK
        ,INS.UNIT_ID
        ,RANK() OVER (PARTITION BY INS.INSPECTION_ID ORDER BY DATE_TRUNC('min', _MODIFIED) DESC) AS RECENT_RANK
    FROM PROD_REPLICA.HAPPY_CO.INSPECTION INS
)

,HAPPY_CO_DETAIL AS (
    SELECT DISTINCT
         CLEAN_UNIT.PROPERTY_KEY
        ,CLEAN_UNIT.UNIT_ID
        ,CLEAN_UNIT.UNIT_EXTERNAL_ID
        ,CLEAN_UNIT.UNIT_Address
        ,CLEAN_UNIT.UNIT_LINE_1
        ,RANK() OVER (PARTITION BY CLEAN_UNIT.PROPERTY_KEY
                      ORDER BY CLEAN_INPSECTION.INSPECTION_COMPLETED_DATE DESC,
                               CLEAN_INPSECTION.INSPECTION_ID DESC) AS RECENT_INS_RANK
        ,CLEAN_INPSECTION.INSPECTION_ID
        ,CLEAN_INPSECTION.INSPECTION_INSPECTOR_NAME
        ,CLEAN_INPSECTION._LINE
        ,CLEAN_INPSECTION.INSPECTION_COMPLETED_DATE
        ,CLEAN_INPSECTION.INSPECTION_STATUS
        ,CLEAN_INPSECTION.INSPECTION_TEMPLATE
        ,CLEAN_INPSECTION.INSPECTION_LINK
        ,CLEAN_ITEM.ITEM_Section
        ,CLEAN_ITEM.ITEM_Item
        ,CLEAN_ITEM.ITEM_Ratings
        ,CLEAN_ITEM.ITEM_Notes
        ,CASE WHEN CLEAN_ITEM.ITEM_Section = 'Report Status' THEN 1 ELSE 0 END AS Report_Status
        ,CASE WHEN CLEAN_ITEM.ITEM_Section = 'Pre Leasing Status' THEN 1 ELSE 0 END AS PreLease_Status
        ,CASE WHEN CLEAN_ITEM.ITEM_ITEM = 'Resident Maintaining the Home / Condition OK to Renew?' THEN 1 ELSE 0 END AS Renewal_Trustee_Status
    FROM CLEAN_INPSECTION
        LEFT JOIN CLEAN_ITEM
            ON  CLEAN_ITEM.INSPECTION_ID = CLEAN_INPSECTION.INSPECTION_ID
            AND CLEAN_ITEM.RECENT_RANK = 1
            AND CLEAN_ITEM.UPDATE_RANK = 1
        LEFT JOIN CLEAN_UNIT
            ON  CLEAN_UNIT.UNIT_ID = CLEAN_INPSECTION.UNIT_ID
            AND CLEAN_UNIT.RECENT_RANK = 1
    WHERE 1 = 1
        AND CLEAN_INPSECTION.RECENT_RANK = 1
        AND CLEAN_INPSECTION.INSPECTION_STATUS = 'Complete'
        AND CLEAN_INPSECTION.INSPECTION_TEMPLATE LIKE '%Trustee Leased Inspection%'
        AND CLEAN_ITEM.ITEM_SECTION IS NOT NULL
)

,HAPPY_CO_RENEWAL AS (
    SELECT
         HCD.PROPERTY_KEY
        ,HCD.INSPECTION_LINK
        ,HCD.INSPECTION_COMPLETED_DATE
        ,MAX(CASE WHEN Renewal_Trustee_Status = 1 THEN ITEM_Ratings ELSE NULL END) AS Renewal_Trustee_Status
    FROM HAPPY_CO_DETAIL HCD
    WHERE 1 = 1
        AND HCD.RECENT_INS_RANK = 1
    GROUP BY
         HCD.PROPERTY_KEY
        ,HCD.INSPECTION_LINK
        ,HCD.INSPECTION_COMPLETED_DATE
)

/* -----------------------------------------------------------------------------
   CTE: RENEWALS
   The core renewal row. Pairs the current lease (C_*) with the next lease (N_*)
   via LeaseRanking, derives renewal-result buckets, renewal-note flags, and
   pulls UW rent + HappyCo inspection + eviction context.
   ----------------------------------------------------------------------------- */
,RENEWALS AS (
    SELECT
         TLH.TENANTLEASINGHISTORYID
        ,TLH.TENANTINFORMATIONID
        ,T.TENANT_KEY
        ,T.CURRENT_FLAG
        ,P.PROPERTY_KEY
        ,P.HBPM_PROPERTY_ID
        ,PO.PORTFOLIO_NAME

        -- [SYNC] organization roll-up — mirrors master PROPERTY script.
        ,CASE
            WHEN P.ORGANIZATION_KEY IN (-1,18,26,28,48)                   THEN -1
            WHEN P.ORGANIZATION_KEY IN (27,50,51,52,54,45,55,53,56,57,66) THEN 27
            WHEN P.ORGANIZATION_KEY IN (58,59)                            THEN 58
            WHEN P.ORGANIZATION_KEY IN (62,63,64,65,68,69)                THEN 62
            WHEN P.ORGANIZATION_KEY IN (61,70)                            THEN 61
            WHEN P.ORGANIZATION_KEY IN (67)                               THEN 67
            ELSE P.ORGANIZATION_KEY
         END AS ORGANIZATION_KEY

        ,CASE
            WHEN P.ORGANIZATION_KEY IN (-1,18,26,28,48)                   THEN 'RP SFR'
            WHEN P.ORGANIZATION_KEY IN (27,50,51,52,54,45,55,53,56,57,66) THEN 'RB DRC'
            WHEN P.ORGANIZATION_KEY IN (58,59)                            THEN 'Hudson Oak'
            WHEN P.ORGANIZATION_KEY IN (62,63,64,65,68,69)                THEN 'Rocklyn Homes'
            WHEN P.ORGANIZATION_KEY IN (61,70)                            THEN 'ROI Property Group'
            WHEN P.ORGANIZATION_KEY IN (67)                               THEN 'Newstar'
            ELSE O.ORGANIZATION_NAME
         END AS ORGANIZATION_NAME

        ,P.ADDRESS
        ,P.ADDRESS || ', ' || COALESCE(CI.CITY_NAME, PM_CI.CityName) || ', ' || S.STATE_NAME || ' ' || P.ZIPCODE AS Full_Address
        ,P.ENTITYID
        ,TI.TENANTSTATUSID
        ,TS.DESCRIPTION AS "TENANTSTATUS"
        ,EV.EVICTION_EVICTIONSTATUSID
        ,EV.EVICTION_EVICTIONSTATUS AS "EVICTIONSTATUS"
        ,U.FULL_NAME
        ,U.EMAIL_ADDRESS
        ,U.PHONE_NUMBER
        ,TI.MOVEIN
        ,TI.MOVEOUT
        ,DATE_TRUNC('month', TI.MoveOut) AS MOVEOUT_BOM
        ,TI.AnticipatedMoveOutDate
        ,TI.MONTHTOMONTH
        ,TI.NOTICEDATE
        ,TI.ISMONTHTOMONTHLEASE
        ,TI.TENANTDECIDEDMONTHTOMONTH
        ,CASE WHEN TI.DONOTRENEW = FALSE THEN NULL ELSE TI.DONOTRENEW END AS DONOTRENEW
        ,TI.REASONFORNOTRENEWINGID
        ,TI.PrimaryTenant
        ,COALESCE(TI.IsSection8, 'N') AS IsSection8
        ,DNR.DESCRIPTION AS REASONFORNOTRENEWINGNAME

        -- ---- Current lease (C_*) ----
        ,TLH.CREATED        AS "C_CREATED"
        ,LR.Lease_Rank      AS "C_LEASENUMBER"
        ,LR.Lease_Rank_INV  AS "C_LEASENUMBER_INV"
        ,TLH.LEASESIGNED    AS "C_LEASESIGNED"
        ,TLH.LEASESTART     AS "C_LEASESTART"
        ,TLH.LEASEEND       AS "C_LEASEEND"
        ,TLH.ISRENEWAL      AS "C_ISRENEWAL"
        ,TLH.AMOUNT         AS "C_AMOUNT"
        ,F_TLH.LEASING_CONCESSION_AMOUNT AS "C_LEASING_CONCESSION"
        ,F_TLH.OWNER_CONCESSION_AMOUNT   AS "C_OWNER_CONCESSION"

        -- ---- Next lease (N_*) ----
        ,TLH_N.CREATED       AS "N_CREATED"
        ,LR_N.Lease_Rank     AS "N_LEASENUMBER"
        ,LR_N.Lease_Rank_INV AS "N_LEASENUMBER_INV"
        ,TLH_N.LEASESIGNED   AS "N_LEASESIGNED"
        ,TLH_N.LEASESTART    AS "N_LEASESTART"
        ,TLH_N.LEASEEND      AS "N_LEASEEND"
        ,TLH_N.ISRENEWAL     AS "N_ISRENEWAL"
        ,TLH_N.AMOUNT        AS "N_AMOUNT"
        ,F_TLH_N.LEASING_CONCESSION_AMOUNT AS "N_LEASING_CONCESSION"
        ,F_TLH_N.OWNER_CONCESSION_AMOUNT   AS "N_OWNER_CONCESSION"

        ,CASE WHEN TLH_N.AMOUNT IS NOT NULL AND TLH.AMOUNT IS NOT NULL
              THEN DIV0NULL(TLH_N.AMOUNT, TLH.AMOUNT) - 1
              ELSE NULL
         END AS RENT_GROWTH

        -- ---- Renewal eligibility / result buckets ----
        ,CASE WHEN TI.MOVEOUT IS NOT NULL AND TI.MOVEOUT < DATEADD(DAY, -30, TLH.LEASEEND)
              THEN 'Not Eligible' ELSE 'Eligible'
         END AS "Lease Eligibility"

        ,CASE WHEN TI.MOVEOUT IS NOT NULL AND TI.MOVEOUT < DATEADD(DAY, -30, TLH.LEASEEND)
              THEN 'Vacated Early' ELSE 'Vacated w/ Lease Exp'
         END AS "Lease Eligibility_FILTER"

        ,CASE
            WHEN TI.MOVEOUT IS NOT NULL AND TI.MOVEOUT < DATEADD(DAY, -30, TLH.LEASEEND)
                 AND (TI.REASONFORNOTRENEWINGID = 3156 OR TI.REASONFORNOTRENEWINGID = 3157)
                THEN ' Early Vacate - Evictions'
            WHEN TI.MOVEOUT IS NOT NULL AND TI.MOVEOUT < DATEADD(DAY, -30, TLH.LEASEEND)
                 AND TI.REASONFORNOTRENEWINGID <> 3156 AND TI.REASONFORNOTRENEWINGID <> 3164 AND TI.REASONFORNOTRENEWINGID <> 3157
                THEN ' Early Vacate - Other'
            WHEN TLH_N.LEASESIGNED IS NOT NULL OR TI.REASONFORNOTRENEWINGID = 3164
                THEN 'Renewed'
            WHEN TS.DESCRIPTION = 'Notice' OR TS.DESCRIPTION = 'Past'
                THEN 'Notice'
            WHEN TI.TENANTDECIDEDMONTHTOMONTH = 1 OR TI.REASONFORNOTRENEWINGID = 3143 OR TI.MONTHTOMONTH = 'Yes'
                THEN 'MTM'
            WHEN (TS.DESCRIPTION = 'Under Eviction') OR TI.REASONFORNOTRENEWINGID = 3156
                THEN 'Current Eviction'
            ELSE 'Pending'
         END AS "Renewal Result"

        ,CASE
            WHEN TI.MOVEOUT IS NOT NULL AND TI.MOVEOUT < DATEADD(DAY, -30, TLH.LEASEEND)
                 AND (TI.REASONFORNOTRENEWINGID = 3156 OR TI.REASONFORNOTRENEWINGID = 3157)
                THEN '6'
            WHEN TI.MOVEOUT IS NOT NULL AND TI.MOVEOUT < DATEADD(DAY, -30, TLH.LEASEEND)
                 AND TI.REASONFORNOTRENEWINGID <> 3156 AND TI.REASONFORNOTRENEWINGID <> 3164 AND TI.REASONFORNOTRENEWINGID <> 3157
                THEN '7'
            WHEN TLH_N.LEASESIGNED IS NOT NULL OR TI.REASONFORNOTRENEWINGID = 3164
                THEN '5'
            WHEN TS.DESCRIPTION = 'Notice' OR TS.DESCRIPTION = 'Past'
                THEN '2'
            WHEN TI.TENANTDECIDEDMONTHTOMONTH = 1 OR TI.REASONFORNOTRENEWINGID = 3143 OR TI.MONTHTOMONTH = 'Yes'
                THEN '3'
            WHEN (TS.DESCRIPTION = 'Under Eviction') OR TI.REASONFORNOTRENEWINGID = 3156
                THEN '4'
            ELSE '1'
         END AS "Renewal Result ID"

        ,CASE
            WHEN (TI.MONTHTOMONTH = 'Y' OR (C_LEASEEND IS NOT NULL AND C_LEASEEND < GETDATE())) AND TS.DESCRIPTION <> 'Past'
                THEN 1
            WHEN DATE_TRUNC('month', TLH.LEASEEND) <= DATEADD(MONTH, 3, DATE_TRUNC('month', GETDATE()))
                 AND DATE_TRUNC('month', TLH.LEASEEND) >= DATEADD(MONTH, -3, DATE_TRUNC('month', GETDATE()))
                THEN 1
            ELSE NULL
         END AS "YTD Filter"

        ,CASE
            WHEN DATE_TRUNC('month', TLH.LEASEEND) <= DATEADD(MONTH, 5, DATE_TRUNC('month', GETDATE()))
                 AND DATE_TRUNC('month', TLH.LEASEEND) >= DATEADD(MONTH, -3, DATE_TRUNC('month', GETDATE()))
                THEN 1
            ELSE NULL
         END AS "3M Filter"

        ,.67 AS "0_Renewal Goal"
        ,.1  AS "0_Rent_Growth_Goal"
        ,DATE_TRUNC('month', TLH.LEASEEND) AS "1_C_LeaseEnd(BOM)"

        ,CASE WHEN TLH_N.LEASESIGNED IS NOT NULL OR TI.MOVEOUT IS NULL THEN NULL
              ELSE DATE_TRUNC('month', COALESCE(TI.MOVEOUT, TLH.LEASEEND))
         END AS "Vacate Date (BOM)"

        ,RNOTE.NoteText    AS RenewalNote
        ,RNOTE.CreatedDate AS RenewalNoteCreated
        ,CASE
            WHEN TI.AnticipatedMoveOutDate IS NOT NULL
                 AND (RNOTE.CreatedDate IS NULL OR LAST_CALL.PROPERTY_LAST_CALL_DATE IS NULL)
                 AND TS.DESCRIPTION = 'Notice'
                THEN 'Needs Updated Renewal Note'
            WHEN TI.AnticipatedMoveOutDate IS NOT NULL
                 AND TI.NOTICEDATE > RNOTE.CreatedDate
                 AND TS.DESCRIPTION = 'Notice'
                 AND RU.FIRSTNAME || ' ' || RU.LASTNAME NOT IN
                     ('Abby Nolasco','Cedric Cagurol','Kelvin Espada','Lorelie Bate','Reste delarama','Roman Quesada')
                THEN 'Needs Updated Renewal Note'
            WHEN TI.AnticipatedMoveOutDate IS NOT NULL
                 AND TI.NOTICEDATE > LAST_CALL.PROPERTY_LAST_CALL_DATE
                 AND TS.DESCRIPTION = 'Notice'
                THEN 'Needs Updated Renewal Note'
            ELSE NULL
         END AS Renewal_Note_Flag

        ,RU.FIRSTNAME || ' ' || RU.LASTNAME AS RenewalNote_Added_By
        ,CASE
            WHEN PUS.Occupancy_Status = 'Trustee Lease Honored' THEN 'Trustee Leased'
            WHEN PUS.Property_Status = 'Tenant Lease' AND PUS.Occupancy_Status = 'Vacant - Future Move In' THEN 'Tenant Leased'
            ELSE PUS.Occupancy_Status
         END AS Occupancy_Status

        ,UW_Rent.UW_Rent_Prior
        ,UW_Rent.UW_Rent_Current
        ,UW_Rent.UW_Update_Date AS UW_Update_Date
        ,DATEDIFF('day', UW_Rent.UW_Update_Date, GETDATE()) AS UW_Days_Since_Update

        ,HCR.INSPECTION_LINK
        ,HCR.INSPECTION_COMPLETED_DATE
        ,HCR.Renewal_Trustee_Status
        ,'https://honeybadgerpm.com/PropertyModule#/PropertyDetails/' || HBPM.PROPERTYID || '/' || PM_AI.UnitID || '/0' AS HBPM_URL
        ,'https://honeybadgerpm.com/PeopleModule#/TenantDetails/'     || U.User_ID || '/' || TI.TenantInformationId AS TENANT_URL

        ,CASE WHEN TS.DESCRIPTION = 'Past' AND TI.MOVEOUT IS NULL THEN 'Missing MO Date' ELSE NULL END AS MO_DATE_FLAG

        ,CASE
            WHEN TS.DESCRIPTION = 'Past' THEN 'No'
            WHEN TLH_N.LEASESIGNED IS NOT NULL AND TLH_N.LEASEEND > TLH.LEASEEND THEN 'No'
            WHEN TI.MONTHTOMONTH = 'Y' OR (C_LEASEEND IS NOT NULL AND C_LEASEEND < GETDATE()) THEN 'Yes'
            ELSE 'No'
         END AS MTM_FLAG

        ,EC.EVICTION_COUNT
        ,E.EVICTION_EVICTIONTERMINATEDDATE
        ,AM_STRATEGY.STRATEGYNAME AS STRATEGY_NAME
        ,PU.SQUARE_FOOTAGE
        ,P.FloorPlan
        ,'Renewal' AS TYPE
        ,LAST_CALL.PROPERTY_LAST_CALL_DATE

    FROM PROD_REPLICA.HBPM_DBO.TENANTLEASINGHISTORIES TLH
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_HIST F_TLH
            ON F_TLH.TENANT_LEASING_HISTORY_ID = TLH.TenantLeasingHistoryId

        LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI
            ON TI.TenantInformationId = TLH.TenantInformationId
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT T
            ON  T.TENANT_INFORMATION_ID = TI.TenantInformationId
            AND T.Current_FLAG = 'Y'
        LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS TS
            ON TS.LookUpMasterId = TI.TenantStatusId
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_ACTIVITY TSUM
            ON TSUM.TENANT_KEY = T.TENANT_KEY
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_USER U
            ON U.USER_KEY = TSUM.USER_KEY

        LEFT JOIN EVICTIONS EV
            ON EV.TENANTINFORMATIONID = T.TENANT_INFORMATION_ID

        LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS DNR
            ON DNR.LookUpMasterId = TI.ReasonForNotRenewingId
        LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PAI
            ON PAI.UnitId = TI.UnitId
        LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES HBPM
            ON HBPM.PropertyId = PAI.PropertyId
        LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PM_AI
            ON  PM_AI.PROPERTYID = HBPM.PROPERTYID
            AND PM_AI."_FIVETRAN_DELETED" = 'N'
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P
            ON  P.HBPM_PROPERTY_ID = HBPM.PROPERTYID
            AND P.Current_FLAG = 'Y'
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS
            ON PUS.PROPERTY_KEY = P.PROPERTY_KEY
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU
            ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO
            ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O
            ON O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_CITY CI
            ON CI.CITY_KEY = PUS.CITY_KEY
        LEFT JOIN PROD_REPLICA.HBPM_DBO.Cities PM_CI
            ON PM_CI.CityID = HBPM.CityID
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_STATE S
            ON S.STATE_KEY = PUS.STATE_KEY
        LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTIES HBAM
            ON HBAM.HBID = P.HBAM_PROPERTY_ID
        LEFT JOIN PROD_REPLICA.HBAM_DBO.BidAndAuctions AM_BA
            ON  AM_BA.BIDID = HBAM.BidAndAuction_BidId
            AND AM_BA.HBID = HBAM.HBID
            AND AM_BA."_FIVETRAN_DELETED" <> 'Y'
        LEFT JOIN PROD_REPLICA.HBAM_DBO.Strategies AM_STRATEGY
            ON AM_STRATEGY.STRATEGYID = AM_BA.BIDSTRATEGYSTATUS

        /* Current lease rank, then walk to the next lease (rank + 1) */
        LEFT JOIN LeaseRanking LR
            ON LR.TenantLeasingHistoryId = TLH.TenantLeasingHistoryId
        LEFT JOIN LeaseRanking LR_N
            ON  LR_N.TenantInformationId = TLH.TenantInformationId
            AND LR_N.Lease_Rank = (LR.Lease_Rank + 1)
        LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTLEASINGHISTORIES TLH_N
            ON  TLH_N.TenantLeasingHistoryId = LR_N.TenantLeasingHistoryId
            AND TLH._FIVETRAN_DELETED <> 'Y'
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_HIST F_TLH_N
            ON F_TLH_N.TENANT_LEASING_HISTORY_ID = TLH_N.TenantLeasingHistoryId

        /* Renewal note + author */
        LEFT JOIN RenewalNote RN
            ON RN.PropertyID = P.HBPM_PROPERTY_ID
        LEFT JOIN PROD_REPLICA.HBPM_DBO.NOTES RNOTE
            ON RNOTE.NOTEID = RN.LatestNoteID
        LEFT JOIN PROD_REPLICA.HBPM_DBO.USERS RU
            ON RU.USERID = RNOTE.ADDEDBY

        LEFT JOIN UW_RENT
            ON UW_Rent.HBPM_UnitID = PAI.UnitID
        LEFT JOIN HAPPY_CO_RENEWAL HCR
            ON HCR.PROPERTY_KEY = P.PROPERTY_KEY
        LEFT JOIN EVICTION_COUNT EC
            ON EC.TENANTINFORMATIONID = TLH.TENANTINFORMATIONID
        LEFT JOIN EVICTIONS E
            ON E.TENANTINFORMATIONID = TI.TenantInformationId
        LEFT JOIN LAST_CALL
            ON LAST_CALL.PROPERTY_HBPM_TENANT_ID = TI.TenantInformationId

    WHERE 1 = 1
        AND TI.PrimaryTenant = 1
        AND TLH._FIVETRAN_DELETED <> 'Y'
        AND P.PROPERTY_STATE = 'Active'
        AND P.EntityID <> ''
        AND PO.Portfolio_KEY NOT IN (1845, 2210, 2207, 2218, 1952, 1867, 1916, 1852, 1771, 1919, 1873)
        AND P.Organization_KEY NOT IN (16, 17)
        AND PO.IS_Active_AM = 'Y'
        AND PO.Current_Flag = 'Y'
        AND P.Current_Flag = 'Y'
        AND PU.Current_Flag = 'Y'
        AND PUS.Occupancy_Status NOT IN ('Property SOLD', 'Not Managed')
        AND T.TENANT_KEY NOT IN (70575)
)

/* -----------------------------------------------------------------------------
   CTE: DEAL_RANK
   Most recent renewal deal matched to each renewal row (by entity id and the
   renewal start landing within the current lease's renewal window).
   ----------------------------------------------------------------------------- */
,DEAL_RANK AS (
    SELECT
         R.TENANT_KEY
        ,R.PROPERTY_KEY
        ,R."C_LEASENUMBER"
        ,RD.DEAL_ID
        ,RANK() OVER (
            PARTITION BY R.TENANT_KEY, R.PROPERTY_KEY, R."C_LEASENUMBER"
            ORDER BY CREATED_DATE DESC, DEAL_KEY DESC
         ) AS DEAL_RANK
    FROM RENEWALS R
        LEFT JOIN RENEWAL_DEAL RD
            ON  RD.PROPERTY_ENTITY_ID = R.EntityID
            AND RD.RENEWAL_START_DATE >  DATEADD('day', -30, R."C_LEASEEND")
            AND RD.RENEWAL_START_DATE <= COALESCE(R."N_LEASESTART", DATE('12-31-9999', 'MM-DD-YYYY'))
            AND RD.CURRENT_DEAL_STATUS <> 'Renewal Canceled'
    QUALIFY DEAL_RANK = 1
)


/* =============================================================================
   FINAL SELECT
   Renewal rows + their matched renewal deal + a fixed late-fee import template.
   ============================================================================= */
SELECT
     R.*
    ,RD.CURRENT_DEAL_STATUS AS RENEWAL_DEAL_STATUS
    ,RD.DEAL_OWNER          AS RENEWAL_OWNER
    ,RD.DEAL_NAME           AS RENEWAL_DEAL_NAME
    ,RD.DEAL_ID
    ,RD.MARR
    ,RD.RATE_12_MONTH
    ,RD.RATE_15_MONTH
    ,RD.RATE_18_MONTH
    ,RD.RATE_24_MONTH
    ,RD.MARKET_RENT
    ,RD.PROPERTY_LEASE_DRAFTING_STATUS AS RENEWAL_LEASE_STATUS
    ,'https://app.hubspot.com/contacts/22536354/record/0-3/' || RD.DEAL_ID || '/' AS RENEWAL_LINK
    ,HUBSPOT.ID AS HUBSPOT_RECORD_ID

    -- Fixed late-fee charge import template
    ,'Charge'              AS IMPORT_TYPE
    ,GETDATE()             AS IMPORT_Due_Date
    ,100                   AS IMPORT_AMOUNT
    ,4004063               AS IMPORT_GL_ACCOUNT
    ,'PM Renewal Late Fee' AS IMPORT_GL_ACCOUNT_DESC
    ,'Renewal Late Fee'    AS IMPORT_DESCRIPTION
    ,NULL AS IMPORT_HBPM_User
    ,NULL AS IMPORT_Tenant_Note
    ,NULL AS IMPORT_Tenant_Note_Type

    ,CASE
        WHEN EVICTION_COUNT >= 3
             AND "TENANTSTATUS" = 'Current'
             AND EVICTION_EVICTIONTERMINATEDDATE > DATEADD('d', -90, GETDATE())
             AND RD.CURRENT_DEAL_STATUS IS NOT NULL
             AND RD.CURRENT_DEAL_STATUS <> 'Renewal Won'
            THEN 'Send Non-Renewal'
        ELSE NULL
     END AS DNR_FLAG

FROM RENEWALS R
    LEFT JOIN DEAL_RANK DR
        ON  DR.TENANT_KEY    = R.TENANT_KEY
        AND DR.PROPERTY_KEY  = R.PROPERTY_KEY
        AND DR."C_LEASENUMBER" = R."C_LEASENUMBER"
    LEFT JOIN RENEWAL_DEAL RD
        ON RD.DEAL_ID = DR.DEAL_ID
    LEFT JOIN HUBSPOT
        ON HUBSPOT.PROPERTY_ENTITY_ID = R.EntityID