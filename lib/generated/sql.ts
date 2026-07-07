// AUTO-GENERATED from the .pbip mirror. Do not edit by hand.

export const DW_PROPERTIES_SQL = `/* =============================================================================
   MASTER PROPERTY DATASET
   -----------------------------------------------------------------------------
   Grain:      One row per property (DISTINCT applied).
   Anchor:     PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY (P)
   Enriches:   PM / AM / MM systems, tenant + lease, listings, notes
               (collections + move-in), eviction counts, rent logs,
               lease history, and HubSpot property fields.

   CLEANUP NOTES (behavior-preserving except where flagged):
     [FIX 1] ORGANIZATION_NAME: removed unreachable duplicate (61,70)->'Newstar'.
             First (61,70) branch returns 'ROI Property Group'; second was dead.
     [FIX 2] PROP_STATUS_FLAG: removed duplicated 'Occupied - No Tenant' block
             (identical condition appeared twice; second was unreachable).
     [FIX 3] REMOVED RB_Fence_Installed column and its RB_F join entirely
             (logic was broken — all three WHENs tested the same value — and
             the field is no longer needed).
     [FIX 4] DROPPED unused joins that were never referenced in SELECT, WHERE,
             or any downstream join (all are non-fanning single-row lookups /
             aggregated subqueries, so removal is output-identical):
               - AM_CONS  (HBAM_DBO.CONSTRUCTIONS)
               - OI, CFK, OT, VS  (four HBPM_DBO.LOOKUPMASTERS lookups)
               - MO       (most-recent move-out subquery)
             Also dropped dead NT / LM joins inside the two note CTEs.
   ============================================================================= */


/* -----------------------------------------------------------------------------
   CTE: CollectionsNote
   Most recent collections note (NoteTypeId = 3) per property.
   Notes attach either directly to a property or via tenant -> unit -> property.
   ----------------------------------------------------------------------------- */
WITH CollectionsNote AS (
    SELECT DISTINCT
         N.NOTEID                                                          AS LatestNoteID
        ,N.NOTETEXT                                                        AS CollectionNote
        ,N.CREATEDDATE                                                     AS CollectionNoteCreated
        ,P.PropertyId
        ,RANK() OVER (PARTITION BY P.PropertyId ORDER BY N.CREATEDDATE DESC) AS Recent_Rank
    FROM PROD_REPLICA.HBPM_DBO.NOTES N
        LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI
            ON  TI.UserID         = N.ObjectId
            AND N.ObjectTypeId    = 502
            AND TI."_FIVETRAN_DELETED" = 'N'
        LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PAI
            ON  PAI.UnitId        = TI.UnitId
            AND PAI."_FIVETRAN_DELETED" = 'N'
        LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES P
            ON  P.PropertyID      = COALESCE(PAI.PropertyId, N.ObjectID)
            AND P."_FIVETRAN_DELETED" = 'N'
    WHERE N.NoteTypeId = 3
    QUALIFY Recent_Rank = 1
)

/* -----------------------------------------------------------------------------
   CTE: MoveInNote
   Most recent move-in note (NoteTypeId = 7) per property. Same join pattern
   as CollectionsNote.
   ----------------------------------------------------------------------------- */
,MoveInNote AS (
    SELECT DISTINCT
         N.NOTEID                                                          AS LatestNoteID_MI
        ,N.NOTETEXT                                                        AS MI_Note
        ,N.CREATEDDATE                                                     AS MI_NoteCreated
        ,P.PropertyId
        ,RANK() OVER (PARTITION BY P.PropertyId ORDER BY N.CREATEDDATE DESC) AS Recent_Rank
    FROM PROD_REPLICA.HBPM_DBO.NOTES N
        LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI
            ON  TI.UserID         = N.ObjectId
            AND N.ObjectTypeId    = 502
            AND TI."_FIVETRAN_DELETED" = 'N'
        LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PAI
            ON  PAI.UnitId        = TI.UnitId
            AND PAI."_FIVETRAN_DELETED" = 'N'
        LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES P
            ON  P.PropertyID      = COALESCE(PAI.PropertyId, N.ObjectID)
            AND P."_FIVETRAN_DELETED" = 'N'
    WHERE N.NoteTypeId = 7
    QUALIFY Recent_Rank = 1
)

/* -----------------------------------------------------------------------------
   CTE: UW_RENT
   Latest underwriting rent change per unit, pulled from the most recent
   RentLogs row (max RENTLOGID) for each ENTITYID1 (= HBPM UnitId).
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
   CTE: LEASE_HIST
   Most recent qualifying lease per property. Limited to real leases
   (amount >= 500) that started on/after the property's RRQC pass date.
   Ranks by created date, then lease start, then lease-from date, then amount.
   ----------------------------------------------------------------------------- */
,LEASE_HIST AS (
    SELECT DISTINCT
         P.PROPERTY_KEY
        ,TO_DATE(TLA.LEASE_FROM_DATE_KEY::TEXT, 'yyyymmdd') AS LEASE_FROM_DATE
        ,TLH.AMOUNT
        ,RANK() OVER (
            PARTITION BY P.PROPERTY_KEY
            ORDER BY DATE_TRUNC('day', CREATED) DESC,
                     TLH.LEASESTART DESC,
                     TLA.LEASE_FROM_DATE_KEY DESC,
                     TLH.AMOUNT ASC
         ) AS RANK_1
    FROM PROD_REPLICA.HBPM_DBO.TENANTLEASINGHISTORIES TLH
        LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI
            ON TI.TenantInformationId = TLH.TenantInformationId
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT T
            ON  T.TENANT_INFORMATION_ID = TI.TenantInformationId
            AND T.Current_FLAG = 'Y'
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TLA
            ON TLA.TENANT_KEY = T.Tenant_Key
        LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PAI
            ON  PAI.UnitId = TI.UnitId
            AND PRIMARYTENANT = 'TRUE'
        LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES HBPM
            ON HBPM.PropertyId = PAI.PropertyId
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P
            ON  P.HBPM_PROPERTY_ID = HBPM.PROPERTYID
            AND P.Current_FLAG = 'Y'
        LEFT JOIN (
            SELECT MAX(Id) AS RRQC_ID, HBID
            FROM PROD_REPLICA.HBAM_DBO.RRQCCHANGELOGS
            GROUP BY HBID
        ) RRQC_MOST_RECENT
            ON RRQC_MOST_RECENT.HBID = P.HBAM_PROPERTY_ID
        LEFT JOIN PROD_REPLICA.HBAM_DBO.RRQCCHANGELOGS RRQC
            ON RRQC.ID = RRQC_MOST_RECENT.RRQC_ID
    WHERE 1 = 1
        AND TLA.LEASE_FROM_DATE_KEY IS NOT NULL
        AND T.Tenant_Status <> 'Future'
        AND TLH.AMOUNT <> 0
        AND TLH.AMOUNT >= 500
        AND RRQC.RRQCPassDate IS NOT NULL
        AND TO_DATE(TLA.LEASE_FROM_DATE_KEY::TEXT, 'yyyymmdd') >= RRQC.RRQCPassDate
    QUALIFY RANK_1 = 1
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
   CTE: HUBSPOT
   Current HubSpot property record (one per PROPERTY_ENTITY_ID), filtered to
   live, non-merged, non-deleted rows. Source of Rently device + utility +
   enrollment fields.
   ----------------------------------------------------------------------------- */
,HUBSPOT AS (
    SELECT
         ID
        ,PROPERTY_ENTITY_ID
        ,PROPERTY_RENTLY_SERIAL_SYNC_STATUS  AS RENTLY_SYNC_STATUS
        ,PROPERTY_ELECTRONIC_LOCKBOX_NUMBER  AS RENTLY_SERIAL_NUMBER
        ,PROPERTY_RENTLY_DEVICE_TYPE         AS RENTLY_DEVICE_TYPE
        ,PROPERTY_RENTLY_SH_HUB_STATUS       AS RENTLY_SH_HUB_STATUS
        ,PROPERTY_RENTLY_SH_HUB_SERIAL_ID    AS RENTLY_SH_HUB_SERIAL_ID
        ,PROPERTY_RENTLY_SH_LOCK_STATUS      AS RENTLY_SH_LOCK_STATUS
        ,PROPERTY_AIR_FILTERS_TOTAL_QUANTITY AS FILTER_QUANTITY
        ,PROPERTY_AIR_FILTERS_TYPE_1         AS FILTER_SIZE_1
        ,PROPERTY_AIR_FILTERS_TYPE_2         AS FILTER_SIZE_2
        ,PROPERTY_AIR_FILTERS_TYPE_3         AS FILTER_SIZE_3
        ,PROPERTY_ELECTRIC_PROVIDER
        ,PROPERTY_BUNDLED_UTILITIES
        ,PROPERTY_GAS_PROVIDER
        ,PROPERTY_OIL_PROPANE_PROVIDER
        ,PROPERTY_SEWER_PROVIDER
        ,PROPERTY_TRASH_PROVIDER
        ,PROPERTY_WATER_PROVIDER
        ,PROPERTY_INTERNET_ELIGIBLE
        ,PROPERTY_INTERNET_ENROLLED
        ,PROPERTY_CREDIT_REPORTING_ELIGIBLE
        ,PROPERTY_CREDIT_REPORTING_ENROLLED
        ,PROPERTY_EASY_LIVING_BUNDLE_ELIGIBLE
        ,PROPERTY_EASY_LIVING_BUNDLE_ENROLLED
        ,PROPERTY_PEST_CONTROL_ENROLLED
        ,PROPERTY_CONSERVICE_MONTHLY_FEE
        ,PROPERTY_RENTLY_SERIAL_ID_UPDATE_DATE
    FROM PROD_REPLICA.HUBSPOT_2.PROPERTIES
    WHERE 1 = 1
        AND PROPERTY_ENTITY_ID IS NOT NULL
        AND PROPERTY_HS_MERGED_OBJECT_IDS IS NULL
        AND (_fivetran_deleted = FALSE OR _fivetran_deleted IS NULL)
)


/* =============================================================================
   FINAL SELECT
   ============================================================================= */
SELECT DISTINCT
     P.PROPERTY_KEY

    -- ---- Cross-system property identifiers ----
    ,P.HBAM_PROPERTY_ID
    ,P.HBPM_PROPERTY_ID
    ,P.HBMM_PROPERTY_ID
    ,PU.PROPERTY_UNIT_KEY
    ,P.PROPERTY_STATE          AS "DW_PropertyState"
    ,HBPM.PropertyStateID      AS "PM_PropetyState"
    ,HBAM.PropertyState        AS "AM_PropertyState"
    ,P.HBH_PROPERTY_ID
    ,HBAM.ASSETID

    -- ---- Region / POD ----
    ,PUS.REGION_KEY
    ,CASE
        WHEN PUS.REGION_KEY IN (67,76)                  THEN 'GA'
        WHEN PUS.REGION_KEY IN (57,58,60,64,769,770)    THEN 'FL'
        WHEN PUS.REGION_KEY IN (104,161,230,246,75,7)   THEN 'SCATTERED'
        WHEN PUS.REGION_KEY IN (257,207,253,255)        THEN 'WEST'
        ELSE NULL
     END AS POD
    ,R.REGION_NAME

    -- ---- Organization (rolled-up key + name) ----
    ,CASE
        WHEN P.ORGANIZATION_KEY IN (-1,18,26,28,48)               THEN -1
        WHEN P.ORGANIZATION_KEY IN (27,50,51,52,54,45,55,53,56,57,66) THEN 27
        WHEN P.ORGANIZATION_KEY IN (58,59)                        THEN 58
        WHEN P.ORGANIZATION_KEY IN (62,63,64,65,68,69)            THEN 62
        WHEN P.ORGANIZATION_KEY IN (61,70)                        THEN 61
        WHEN P.ORGANIZATION_KEY IN (67)                           THEN 67
        ELSE P.ORGANIZATION_KEY
     END AS ORGANIZATION_KEY

    -- [FIX 1] removed unreachable duplicate (61,70)->'Newstar' branch.
    ,CASE
        WHEN P.ORGANIZATION_KEY IN (-1,18,26,28,48)               THEN 'RP SFR'
        WHEN P.ORGANIZATION_KEY IN (27,50,51,52,54,45,55,53,56,57,66) THEN 'RB DRC'
        WHEN P.ORGANIZATION_KEY IN (58,59)                        THEN 'Hudson Oak'
        WHEN P.ORGANIZATION_KEY IN (62,63,64,65,68,69)            THEN 'Rocklyn Homes'
        WHEN P.ORGANIZATION_KEY IN (61,70)                        THEN 'ROI Property Group'
        WHEN P.ORGANIZATION_KEY IN (67)                           THEN 'Newstar'
        ELSE O.ORGANIZATION_NAME
     END AS ORGANIZATION_NAME

    ,NULL AS PROPERTY_MANAGER_REGIONAL_EMAIL
    ,NULL AS PROPERTY_MANAGMENT_ALL_EMAIL

    -- ---- Venture number (parsed from portfolio name) ----
    ,CASE
        WHEN CHARINDEX(' VIII', PO.PORTFOLIO_NAME) > 0 THEN 'Venture VIII'
        WHEN CHARINDEX(' VII',  PO.PORTFOLIO_NAME) > 0 THEN 'Venture VII'
        WHEN CHARINDEX(' VI',   PO.PORTFOLIO_NAME) > 0 THEN 'Venture VI'
        WHEN CHARINDEX(' IV',   PO.PORTFOLIO_NAME) > 0 THEN 'Venture IV'
        WHEN CHARINDEX(' V',    PO.PORTFOLIO_NAME) > 0 THEN 'Venture V'
        WHEN CHARINDEX(' III',  PO.PORTFOLIO_NAME) > 0 THEN 'Venture III'
        WHEN CHARINDEX(' II',   PO.PORTFOLIO_NAME) > 0 THEN 'Venture II'
        WHEN CHARINDEX('Venture', PO.PORTFOLIO_NAME) > 0
             OR P.ORGANIZATION_KEY IN (-1,18,26,28,48,27)         THEN 'Venture I'
        ELSE 'All'
     END AS Venture_No
    ,PUS.PORTFOLIO_KEY
    ,PO.PORTFOLIO_NAME

    -- ---- Address breakdown ----
    ,P.ADDRESS || ', ' || COALESCE(CI.CITY_NAME, PM_CI.CityName) || ', ' || S.STATE_NAME || ' ' || P.ZIPCODE AS Full_Address
    ,P.ADDRESS
    ,LEFT(P.ADDRESS, CHARINDEX(' ', P.ADDRESS) - 1)                       AS ADDRESS_STREET_NO
    ,RIGHT(P.ADDRESS, LENGTH(P.Address) - CHARINDEX(' ', P.ADDRESS))      AS ADDRESS_STREET_NAME
    ,PUS.CITY_KEY
    ,CI.CITY_NAME
    ,PUS.STATE_KEY
    ,S.STATE_NAME
    ,S.STATE_CODE
    ,P.ZIPCODE
    ,COALESCE(CI.CITY_NAME, PM_CI.CityName) || ', ' || S.STATE_NAME || ' ' || P.ZIPCODE AS CITY_ST_ZIP
    ,PUS.COUNTY_KEY
    ,CO.COUNTY_NAME

    -- ---- Entity ID (with hardcoded overrides for 4 specific properties) ----
    ,CASE
        WHEN P.PROPERTY_KEY = 253325 THEN '20211012410E'
        WHEN P.PROPERTY_KEY = 209187 THEN '20211012414E'
        WHEN P.PROPERTY_KEY = 225057 THEN '20211012402E'
        WHEN P.PROPERTY_KEY = 234563 THEN '20211012406E'
        ELSE P.EntityID
     END AS ENTITYID
    ,P.PROPERTY_STATE
    ,P.PROPERTY_TYPE

    -- ---- Subdivision (with two value remaps) ----
    ,CASE WHEN PUS.SUBDIVISION_KEY = 204 THEN 201 ELSE PUS.SUBDIVISION_KEY END AS SUBDIVISION_KEY
    ,CASE WHEN SUB.SUBDIVISION = 'Wildwood Landing Ph 2' THEN 'Wildwood Landing' ELSE SUB.SUBDIVISION END AS SUBDIVISION
    ,P.FloorPlan
    ,PUS.FLOORPLAN_KEY
    ,AM_INS.POOLSERVICEREQUIRED

    -- ---- Purchase type ----
    ,BA.PurchaseType AS "Purchase_Type_ID"
    ,CASE BA.PurchaseType
        WHEN 1 THEN 'Foreclosure'
        WHEN 2 THEN 'MLS'
        WHEN 3 THEN 'Off-Market'
        WHEN 4 THEN 'Bulk'
        WHEN 5 THEN 'Deed in Lieu'
        WHEN 6 THEN 'I-Buyer'
        WHEN 7 THEN 'Non-Foreclosure'
        WHEN 8 THEN 'New Construction'
        ELSE NULL
     END AS "Purchase Type"

    -- ---- Status / occupancy ----
    ,PUS.PROPERTY_STATUS
    ,PUS.PROPERTY_STAGE
    ,PM_OC.OccupancyStatusId

    ,CASE
        WHEN PUS.Occupancy_Status = 'Trustee Lease Honored' THEN 'Trustee Leased'
        WHEN PUS.Property_Status = 'Tenant Lease' AND PUS.Occupancy_Status = 'Vacant - Future Move In' THEN 'Tenant Leased'
        ELSE PUS.Occupancy_Status
     END AS Occupancy_Status

    ,CASE
        WHEN PUS.Occupancy_Status = 'Trustee Occupied'                                  THEN 'Trustee Occupied'
        WHEN PUS.Occupancy_Status = 'Under Inspection'                                  THEN 'Inspection'
        WHEN PUS.Occupancy_Status = 'Under Construction'                                THEN 'Constuction'
        WHEN PUS.Occupancy_Status IN ('Vacant - Off Market', 'Vacant - Onboarding')     THEN 'Vacant - Off Market'
        WHEN PUS.Occupancy_Status IN ('Vacant - On Market', 'Vacant - Pre-Leasing')     THEN 'Vacant - On Market'
        WHEN PUS.Occupancy_Status = 'Tenant Leased'                                     THEN 'Tenant Leased'
        WHEN PUS.Property_Status = 'Tenant Lease' AND PUS.Occupancy_Status = 'Vacant - Future Move In' THEN 'Tenant Leased'
        WHEN PUS.Occupancy_Status = 'Vacant - Future Move In'                           THEN 'Vacant - FMI'
        WHEN PUS.Occupancy_Status IN ('Trustee Lease Honored', 'Trustee Leased')        THEN 'Trustee Leased'
        WHEN PUS.Occupancy_Status IN ('Pending MOI/Rekey', 'Under Turnkey')             THEN 'Turnkey'
        ELSE PUS.Occupancy_Status
     END AS Occupancy_Status_Summary

    ,CASE
        WHEN PUS.Occupancy_Status = 'Trustee Occupied'                                  THEN 1
        WHEN PUS.Occupancy_Status = 'Under Inspection'                                  THEN 2
        WHEN PUS.Occupancy_Status = 'Under Construction'                                THEN 3
        WHEN PUS.Occupancy_Status IN ('Vacant - Off Market', 'Vacant - Onboarding')     THEN 4
        WHEN PUS.Occupancy_Status IN ('Vacant - On Market', 'Vacant - Pre-Leasing')     THEN 5
        WHEN PUS.Occupancy_Status = 'Tenant Leased'                                     THEN 8
        WHEN PUS.Property_Status = 'Tenant Lease' AND PUS.Occupancy_Status = 'Vacant - Future Move In' THEN 8
        WHEN PUS.Occupancy_Status = 'Vacant - Future Move In'                           THEN 6
        WHEN PUS.Occupancy_Status IN ('Trustee Lease Honored', 'Trustee Leased')        THEN 7
        WHEN PUS.Occupancy_Status IN ('Pending MOI/Rekey', 'Under Turnkey')             THEN 9
        ELSE 10
     END AS Occupancy_Status_SummaryID

    -- ---- Unit physical attributes (PM override, else DW) ----
    ,COALESCE(PM_AI.Bedrooms,  PU.BEDROOMS)  AS BEDROOMS
    ,COALESCE(PM_AI.BATHROOMS, PU.BATHROOMS) AS BATHROOMS
    ,PU.SQUARE_FOOTAGE
    ,P.Year_Built
    ,PUS.Under_written_rent

    -- ---- Key dates ----
    ,COALESCE(TO_DATE(P.TRANSFER_DATE_KEY::TEXT, 'yyyymmdd'),
              TO_DATE(P.PURCHASE_DATE_KEY::TEXT, 'yyyymmdd')) AS "Transfer_Date"
    ,TO_DATE(P.PURCHASE_DATE_KEY::TEXT, 'yyyymmdd')           AS "Purchase_Date"
    ,TO_DATE(PROPERTY_SOLD_DATE_KEY::TEXT, 'yyyymmdd')        AS "Sold_Date"

    -- ---- Tenant ----
    ,TEN.CURRENT_RENT
    ,TI.UserID AS TEN_USER_ID
    ,TEN.TENANT_KEY
    ,TEN.LEASE_ID
    ,TEN.TENANT_STATUS
    ,TEN.EVICTION_STATUS
    ,TEN.MOVE_IN_DATE                AS TEN_MOVE_IN_DATE
    ,TEN.ANTICIPATED_MOVE_OUT_DATE   AS TEN_ANTICIPATED_MOVE_OUT_DATE
    ,TU.FIRST_NAME                   AS TEN_FIRST_NAME
    ,TU.LAST_NAME                    AS TEN_LAST_NAME
    ,TU.FULL_NAME                    AS TEN_FULL_NAME
    ,TU.EMAIL_ADDRESS                AS TEN_EMAIL
    ,TU.PHONE_NUMBER                 AS TEN_PHONE_NUMBER

    -- ---- Lease ----
    ,CASE WHEN TLA.LEASE_FROM_DATE_KEY IS NULL THEN 'Never Leased' ELSE 'Post First Lease' END AS INITIAL_LEASE
    ,TO_DATE(TLA.LEASE_SIGNED_DATE_KEY::TEXT, 'yyyymmdd') AS "LEASE_SIGNED_DATE"
    ,TO_DATE(TLA.LEASE_FROM_DATE_KEY::TEXT,   'yyyymmdd') AS "LEASE_FROM_DATE"
    ,TO_DATE(TLA.LEASE_TO_DATE_KEY::TEXT,     'yyyymmdd') AS "LEASE_TO_DATE"
    ,TI.MoveOut AS Tenant_Move_Out_Date
    ,CASE WHEN TEN.TENANT_STATUS <> 'Past' AND TI.IsSection8 = 1 THEN 'Yes' ELSE 'No' END AS Is_Section8
    ,CASE WHEN TI.MoveOut IS NOT NULL THEN 'Y' ELSE 'N' END AS MOVE_OUT_INDICATOR
    ,CASE WHEN TI.FiledWithCountyDate IS NOT NULL THEN 'Filed on' ELSE 'Not Filed On' END AS Filed_With_County_Status

    -- ---- Property management staff ----
    ,COALESCE(PM_U.FirstName  || ' ' || PM_U.LastName,  '(Blank)') AS Property_Manager
    ,PM_U.EmailAddress  AS Property_Manager_Email
    ,COALESCE(PM_UA.FirstName || ' ' || PM_UA.LastName, '(Blank)') AS Property_Manager_Assistant
    ,PM_UA.EmailAddress AS Property_Manager_Assistant_Email

    -- ---- Listing ----
    ,RL.RENT_LIST_HIST_ID AS RENTAL_LISTING_ID
    ,RL.LISTING_STATUS    AS "Listing_Status_Name"
    ,DL.IS_PUBLISHED      AS IS_PUBLISHED
    ,CASE WHEN RL.LISTING_STATUS = 'Active' AND DL.IS_PUBLISHED = 'Y' THEN DL.IS_PRELEASING ELSE NULL END AS PRE_LEASING
    ,RL.CURRENT_LIST_PRICE AS CurrentListPrice
    ,CASE WHEN RL.LISTING_STATUS = 'Withdrawn' THEN NULL
          ELSE TO_DATE(RL.LISTING_DATE_KEY::TEXT, 'yyyymmdd') END AS ListingDate

    -- [FIX 2] removed duplicated 'Occupied - No Tenant' block (was listed twice).
    ,CASE
        WHEN RL.LISTING_STATUS <> 'Active'
             AND PUS.Occupancy_Status = 'Vacant - On Market'
            THEN 'On Market - Inactive Listings'
        WHEN RL.LISTING_STATUS = 'Active'
             AND PUS.Occupancy_Status IN ('Vacant - Future Move In', 'Vacant - Off Market')
            THEN 'Off Market - Active Listings'
        WHEN PUS.Occupancy_Status IN ('Tenant Leased', 'Trustee Lease Honored', 'Trustee Leased')
             AND (TEN.TENANT_STATUS IS NULL OR TEN.TENANT_STATUS = 'Past')
            THEN 'Occupied - No Tenant'
        WHEN PUS.Occupancy_Status NOT IN ('Tenant Leased', 'Trustee Lease Honored', 'Trustee Leased')
             AND TEN.TENANT_STATUS IN ('Current', 'Notice', 'Under Eviction')
            THEN 'Vacant - With Tenant'
        ELSE NULL
     END AS PROP_STATUS_FLAG

    ,RRQC.RRQCPassDate

    -- ---- Trustee / off-market status ----
    ,PM_AI.TrusteeStatus
    ,TS.Description AS TrusteeStatusName
    ,PM_AI.ReasonOffMarketId
    ,ROM.Description AS ReasonOffMarketName
    ,PM_AI.OffMarketDate
    ,AM_PM.MoveInReady

    -- ---- Rent / GPR ----
    ,COALESCE(TEN.CURRENT_RENT, PUS.Under_written_rent) AS Gross_Potential_Rent

    -- ---- HBPM deep link ----
    ,'https://honeybadgerpm.com/PropertyModule#/PropertyDetails/'
        || HBPM.PROPERTYID || '/' || PM_AI.UnitID || '/0' AS HBPM_URL

    ,LEFT(P.ADDRESS, 10) AS "Address_Trim"
    ,DATE(GETDATE())     AS TODAY

    -- ---- Notes ----
    ,CN.CollectionNote
    ,CN.CollectionNoteCreated
    ,MI_NOTE.MI_Note
    ,MI_NOTE.MI_NoteCreated

    -- ---- Underwriting rent change ----
    ,UW_Rent.UW_Rent_Prior
    ,UW_Rent.UW_Rent_Current
    ,UW_Rent.UW_Update_Date AS UW_Update_Date

    -- ---- Lease history (most recent qualifying) ----
    ,LEASE_HIST.LEASE_FROM_DATE AS LAST_LEASE_START
    ,LEASE_HIST.AMOUNT          AS LAST_LEASE_AMOUNT

    -- ---- FMI-but-leased flag ----
    ,CASE
        WHEN (PUS.Occupancy_Status = 'Vacant - Future Move In' OR RL.LISTING_STATUS = 'Deposit Taken')
             AND TEN.TENANT_STATUS IN ('Active', 'Under Eviction', 'Notice')
             AND PUS.Occupancy_Status <> 'Tenant Leased'
            THEN 'Yes'
        ELSE 'No'
     END AS FMI_Tenant_Leased

    -- ---- Maintenance coordinator ----
    ,MM_U.FIRSTNAME || ' ' || MM_U.LASTNAME AS MC_ASSIGNED
    ,MM_U.EMAILADDRESS                       AS MC_EMAIL
    ,AM_STRATEGY.STRATEGYNAME                AS STRATEGY_NAME

    -- ---- Lawn care / GC responsibility ----
    ,GC.LookupMasterID AS GC_Responsibility_ID
    ,GC.Description     AS GC_Responsibility

    ,CASE WHEN RL.LISTING_STATUS = 'Withdrawn' THEN NULL ELSE PM_AI.MOVEINREADY END AS PM_MIR

    -- ---- HubSpot record + Rently devices ----
    ,HUBSPOT.ID AS HUBSPOT_RECORD_ID
    ,HUBSPOT.RENTLY_SYNC_STATUS
    ,HUBSPOT.RENTLY_SERIAL_NUMBER
    ,HUBSPOT.RENTLY_DEVICE_TYPE
    ,HUBSPOT.RENTLY_SH_HUB_STATUS
    ,HUBSPOT.RENTLY_SH_HUB_SERIAL_ID
    ,HUBSPOT.RENTLY_SH_LOCK_STATUS

    -- Rently smart-home next action (device type + hub/lock status driven)
    ,CASE
        WHEN HUBSPOT.RENTLY_DEVICE_TYPE NOT IN ('Smart Home Hub')
             AND HUBSPOT.RENTLY_SH_HUB_SERIAL_ID IS NOT NULL
             AND HUBSPOT.RENTLY_SH_HUB_STATUS = 'Online'
             AND HUBSPOT.RENTLY_SH_LOCK_STATUS = 'Offline'
            THEN 'Needs SH Lock'
        WHEN HUBSPOT.RENTLY_DEVICE_TYPE NOT IN ('Smart Home Hub')
             AND HUBSPOT.RENTLY_SH_HUB_SERIAL_ID IS NOT NULL
             AND HUBSPOT.RENTLY_SH_HUB_STATUS = 'Online'
             AND HUBSPOT.RENTLY_SH_LOCK_STATUS = 'Online'
            THEN 'Assign Hub - Remove Other Deivce'
        WHEN HUBSPOT.RENTLY_DEVICE_TYPE NOT IN ('Smart Home Hub')
             AND HUBSPOT.RENTLY_SH_HUB_SERIAL_ID IS NOT NULL
             AND HUBSPOT.RENTLY_SH_HUB_STATUS = 'Offline'
            THEN 'Remove Hub From Account'
        WHEN HUBSPOT.RENTLY_DEVICE_TYPE IN ('Smart Home Hub')
             AND HUBSPOT.RENTLY_SH_HUB_SERIAL_ID IS NOT NULL
             AND HUBSPOT.RENTLY_SH_HUB_STATUS = 'Offline'
             AND PUS.Occupancy_Status NOT IN ('Tenant Leased')
             AND PUS.Occupancy_Status IN ('Vacant - On Market', 'Vacant - Pre-Leasing')
             AND HUBSPOT.RENTLY_SH_LOCK_STATUS = 'Offline'
            THEN 'Needs SH Hub & Lock'
        WHEN HUBSPOT.RENTLY_DEVICE_TYPE IN ('Smart Home Hub')
             AND HUBSPOT.RENTLY_SH_HUB_SERIAL_ID IS NOT NULL
             AND HUBSPOT.RENTLY_SH_HUB_STATUS = 'Offline'
             AND PUS.Occupancy_Status NOT IN ('Tenant Leased')
             AND PUS.Occupancy_Status IN ('Vacant - On Market', 'Vacant - Pre-Leasing')
             AND HUBSPOT.RENTLY_SH_LOCK_STATUS = 'Online'
            THEN 'Needs SH Hub'
        WHEN HUBSPOT.RENTLY_DEVICE_TYPE IN ('Smart Home Hub')
             AND HUBSPOT.RENTLY_SH_HUB_SERIAL_ID IS NOT NULL
             AND HUBSPOT.RENTLY_SH_HUB_STATUS = 'Online'
             AND PUS.Occupancy_Status NOT IN ('Tenant Leased')
             AND HUBSPOT.RENTLY_SH_LOCK_STATUS = 'Offline'
            THEN 'Pair Lock to Hub'
        ELSE NULL
     END AS RENTLY_SH_ACTION

    -- ---- HubSpot air filters + utilities + enrollments ----
    ,HUBSPOT.FILTER_QUANTITY
    ,HUBSPOT.FILTER_SIZE_1
    ,HUBSPOT.FILTER_SIZE_2
    ,HUBSPOT.FILTER_SIZE_3
    ,HUBSPOT.PROPERTY_ELECTRIC_PROVIDER
    ,HUBSPOT.PROPERTY_BUNDLED_UTILITIES
    ,HUBSPOT.PROPERTY_GAS_PROVIDER
    ,HUBSPOT.PROPERTY_OIL_PROPANE_PROVIDER
    ,HUBSPOT.PROPERTY_SEWER_PROVIDER
    ,HUBSPOT.PROPERTY_TRASH_PROVIDER
    ,HUBSPOT.PROPERTY_WATER_PROVIDER
    ,HUBSPOT.PROPERTY_INTERNET_ELIGIBLE
    ,HUBSPOT.PROPERTY_INTERNET_ENROLLED
    ,HUBSPOT.PROPERTY_CREDIT_REPORTING_ELIGIBLE
    ,HUBSPOT.PROPERTY_CREDIT_REPORTING_ENROLLED
    ,HUBSPOT.PROPERTY_EASY_LIVING_BUNDLE_ELIGIBLE
    ,HUBSPOT.PROPERTY_EASY_LIVING_BUNDLE_ENROLLED
    ,HUBSPOT.PROPERTY_PEST_CONTROL_ENROLLED
    ,HUBSPOT.PROPERTY_CONSERVICE_MONTHLY_FEE
    ,HUBSPOT.PROPERTY_RENTLY_SERIAL_ID_UPDATE_DATE

    ,EC.EVICTION_COUNT

    -- [FIX 3] RB_Fence_Installed column removed (broken logic, no longer needed).

FROM PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P

    /* ---- Core property / unit summary ---- */
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS
        ON PUS.PROPERTY_KEY = P.PROPERTY_KEY

    /* ---- Cross-system property records (replica DBs) ---- */
    LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTIES HBAM
        ON HBAM.HBID = P.HBAM_PROPERTY_ID
    LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES HBPM
        ON HBPM.PROPERTYID = P.HBPM_PROPERTY_ID
    LEFT JOIN PROD_REPLICA.HBMM_DBO.PROPERTIES HBMM
        ON HBMM.PROPERTYID = P.HBMM_PROPERTY_ID

    /* ---- Staff ---- */
    LEFT JOIN PROD_REPLICA.HBMM_DBO.USERS MM_U
        ON MM_U.USERID = HBMM.MAINTENANCECOORDINATORID
    LEFT JOIN PROD_REPLICA.HBPM_DBO.USERS PM_U
        ON PM_U.UserID = HBPM.ASSIGNEDUSERID
    LEFT JOIN PROD_REPLICA.HBPM_DBO.USERS PM_UA
        ON PM_UA.UserID = HBPM.AssistantASSIGNEDUSERID

    /* ---- PM additional info (unit-level attributes, trustee, off-market) ---- */
    LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PM_AI
        ON  PM_AI.PROPERTYID = HBPM.PROPERTYID
        AND PM_AI."_FIVETRAN_DELETED" = 'N'

    /* ---- AM detail tables ---- */
    LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTYMANAGEMENTS AM_PM
        ON  AM_PM.PROPERTYMANAGEMENTID = HBAM.PropertyManagement_PropertyManagementId
        AND AM_PM.HBID = HBAM.HBID
        AND AM_PM."_FIVETRAN_DELETED" <> 'Y'
    LEFT JOIN PROD_REPLICA.HBAM_DBO.INSPECTIONS AM_INS
        ON  AM_INS.INSPECTIONID = HBAM.INSPECTION_INSPECTIONID
        AND AM_INS.HBID = HBAM.HBID
        AND AM_INS."_FIVETRAN_DELETED" <> 'Y'
    LEFT JOIN PROD_REPLICA.HBAM_DBO.BidAndAuctions AM_BA
        ON  AM_BA.BIDID = HBAM.BidAndAuction_BidId
        AND AM_BA.HBID = HBAM.HBID
        AND AM_BA."_FIVETRAN_DELETED" <> 'Y'
    LEFT JOIN PROD_REPLICA.HBAM_DBO.Strategies AM_STRATEGY
        ON AM_STRATEGY.STRATEGYID = AM_BA.BIDSTRATEGYSTATUS

    /* ---- Dimension lookups ---- */
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO
        ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_CITY CI
        ON CI.CITY_KEY = PUS.CITY_KEY
    LEFT JOIN PROD_REPLICA.HBPM_DBO.Cities PM_CI
        ON PM_CI.CityID = HBPM.CityID
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_STATE S
        ON S.STATE_KEY = PUS.STATE_KEY
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_COUNTY CO
        ON CO.COUNTY_KEY = PUS.COUNTY_KEY
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_REGION R
        ON R.REGION_KEY = PUS.REGION_KEY
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_SUBDIVISION SUB
        ON SUB.SUBDIVISION_KEY = PUS.SUBDIVISION_KEY

    /* ---- Lawn care responsibility (subdivision -> lookup) ---- */
    LEFT JOIN PROD_REPLICA.HBPM_DBO.SUBDIVISIONS SUBD
        ON SUBD.ID = SUB.HBPM_SUBDIVISION_ID
    LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS GC
        ON GC.LOOKUPMASTERID = SUBD.LAWNCARERESPONSIBILITYID

    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O
        ON O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU
        ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY

    /* ---- RRQC (most recent pass log) ---- */
    LEFT JOIN (
        SELECT MAX(Id) AS RRQC_ID, HBID
        FROM PROD_REPLICA.HBAM_DBO.RRQCCHANGELOGS
        GROUP BY HBID
    ) RRQC_MOST_RECENT
        ON RRQC_MOST_RECENT.HBID = P.HBAM_PROPERTY_ID
    LEFT JOIN PROD_REPLICA.HBAM_DBO.RRQCCHANGELOGS RRQC
        ON RRQC.ID = RRQC_MOST_RECENT.RRQC_ID

    /* ---- Bid & auction (purchase type) ---- */
    LEFT JOIN PROD_REPLICA.HBAM_DBO.BIDANDAUCTIONS BA
        ON  BA.BIDID = HBAM.BidAndAuction_BidId
        AND BA.HBID = P.HBAM_PROPERTY_ID

    /* ---- Current primary tenant lease (max lease per property) ----
       DIM_TENANT_CLEAN picks the latest LEASE_ID for each property among
       active primary tenants; TEN then re-pulls that tenant's full row. */
    LEFT JOIN (
        SELECT
             MAX(T.Lease_ID) AS LEASE_ID
            ,TLA.Property_key
        FROM PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT T
            LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TLA
                ON TLA.TENANT_KEY = T.Tenant_Key
            LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI
                ON TI.TENANTINFORMATIONID = T.Tenant_Information_id
        WHERE 1 = 1
            AND PRIMARY_TENANT = 'Y'
            AND CURRENT_FLAG = 'Y'
            AND TI._FIVETRAN_DELETED = 'N'
            AND TENANT_STATUS <> 'Past'
            AND RENT_DUE_DAY IS NOT NULL
            AND TLA.FCT_TENANT_LEASING_ACCUM_KEY NOT IN (70474)
        GROUP BY TLA.Property_key
    ) DIM_TENANT_CLEAN
        ON DIM_TENANT_CLEAN.PROPERTY_KEY = P.PROPERTY_KEY

    LEFT JOIN (
        SELECT T.*
        FROM PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT T
            LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI
                ON TI.TENANTINFORMATIONID = T.Tenant_Information_id
        WHERE TI.PRIMARYTENANT = 'Y'
    ) TEN
        ON  TEN.LEASE_ID = DIM_TENANT_CLEAN.LEASE_ID
        AND TEN.PRIMARY_TENANT = 'Y'
        AND TEN.CURRENT_FLAG = 'Y'
        AND TEN.RENT_DUE_DAY IS NOT NULL

    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TLA
        ON  TLA.TENANT_KEY = TEN.TENANT_KEY
        AND TLA.FCT_TENANT_LEASING_ACCUM_KEY NOT IN (70474)
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_USER TU
        ON TU.USER_KEY = TLA.USER_KEY
    LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI
        ON  TI.TenantInformationId = TEN.TENANT_INFORMATION_ID
        AND TI._FIVETRAN_DELETED <> 'Y'
    LEFT JOIN EVICTION_COUNT EC
        ON EC.TENANTINFORMATIONID = TI.TenantInformationId

    /* ---- Most recent rental listing per property ---- */
    LEFT JOIN (
        SELECT MAX(RENT_LIST_HIST_ID) AS ID, PROPERTY_KEY
        FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_RENTAL_LISTING_HIST
        GROUP BY PROPERTY_KEY
    ) RENTALLISTINGENTRIES_MOST_RECENT
        ON RENTALLISTINGENTRIES_MOST_RECENT.PROPERTY_KEY = P.PROPERTY_KEY
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_RENTAL_LISTING_HIST RL
        ON RL.RENT_LIST_HIST_ID = RENTALLISTINGENTRIES_MOST_RECENT.ID
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_LISTING DL
        ON RL.LISTING_KEY = DL.LISTING_KEY

    /* ---- PM lookup-master descriptions (TS = trustee status, ROM = reason
       off market) — both feed output columns. ---- */
    LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS TS
        ON TS.LookUpMasterId = PM_AI.TrusteeStatus
    LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS ROM
        ON ROM.LookUpMasterId = PM_AI.ReasonOffMarketId

    /* ---- Occupancy status id (lookup by description) ---- */
    LEFT JOIN (
        SELECT LookUpMasterId AS OccupancyStatusID, Description
        FROM PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS
        WHERE TypeID = 6
    ) PM_OC
        ON PM_OC.Description = PUS.Occupancy_Status

    /* ---- Notes ---- */
    LEFT JOIN CollectionsNote CN
        ON CN.PropertyID = P.HBPM_PROPERTY_ID
    LEFT JOIN MoveInNote MI_Note
        ON MI_Note.PropertyID = P.HBPM_PROPERTY_ID

    /* ---- Underwriting rent / HubSpot / lease history ---- */
    LEFT JOIN UW_RENT
        ON UW_Rent.HBPM_UnitID = PM_AI.UnitID
    LEFT JOIN HUBSPOT
        ON HUBSPOT.PROPERTY_ENTITY_ID = P.EntityID
    LEFT JOIN LEASE_HIST
        ON LEASE_HIST.Property_key = P.Property_key

WHERE 1 = 1
    AND (HBAM.PROPERTYSTATUSID > 9 OR HBAM.PROPERTYSTATUSID IS NULL)          -- out of bid
    AND P.PROPERTY_STATE = 'Active'
    AND P.EntityID <> ''
    AND (HBAM.PROPERTYSTATUSID NOT IN (53, 75) OR HBAM.PROPERTYSTATUSID IS NULL)
    AND PO.Portfolio_KEY NOT IN (223,598,147,102,109,28,603,169,602,170,58,54)
    AND PUS.Organization_KEY NOT IN (16, 17)
    AND PO.IS_Active_AM = 'Y'
    AND PO.Current_Flag = 'Y'
    AND P.Current_Flag = 'Y'
    AND PU.Current_Flag = 'Y'
    AND PUS.Occupancy_Status NOT IN ('Not Managed')
    AND (HBPM.PROPERTYSTATEID = 26 OR HBPM.PROPERTYSTATEID IS NULL)
    AND P.HBMM_Property_ID IS NOT NULL
    AND P.Property_Key NOT IN (166418, 57201, 23237, 166851, 229060)
    AND (TI._FIVETRAN_DELETED = 'N' OR TI._FIVETRAN_DELETED IS NULL)`;

export const DW_LISTINGS_SQL = `/* =============================================================================
   LISTINGS DATASET
   -----------------------------------------------------------------------------
   Grain:   One row per rental-listing-history record (anchor
            FCT_PROP_RENTAL_LISTING_HIST RLH), enriched with the matched active
            Deal, Tenant, price-change history, on-market notes, ASM/UW figures.
   CTE chain: UW_RENT_MAX/UW_RENT, OnMarketNote, LIST_CHANGE, HHI, DEALS,
            TENANT, ListDeal, LEASE_HIST -> final SELECT.

   CLEANUP NOTES:
     [SYNC]  The two ORGANIZATION_KEY / ORGANIZATION_NAME CASE blocks (in DEALS
             and in the final SELECT) were updated from the prior three-group
             form (adding only 58,59 -> 'Hudson Oak') to the full six-group
             roll-up that mirrors the master PROPERTY script (source of truth).
             DELIBERATE OUTPUT CHANGE limited to the organization columns.
     The TENANT CTE selects raw P.ORGANIZATION_KEY / O.ORGANIZATION_NAME (no
     CASE); those columns are NOT surfaced in the final SELECT, so they are left
     untouched. No CTEs or joins dropped; HHI is defined-but-unused in the
     original and preserved as-is.

   ORG SYNC IMPACT (intended diff vs. original output):
        added 66                  -> 27 / 'RB DRC'
        62,63,64,65,68,69         -> 62 / 'Rocklyn Homes'
        61,70                     -> 61 / 'ROI Property Group'
        67                        -> 67 / 'Newstar'
   ============================================================================= */

WITH UW_RENT_MAX AS (
	SELECT 
	MAx(RENTLOGID) RENTLOGID 
	, ENTITYID1
	FROM PROD_REPLICA.HBPM_DBO.RENTLOGS
	GROUP BY ENTITYID1) 
	
,UW_RENT AS (
	SELECT 
	 RentLogs.ENTITYID1 AS HBPM_UnitID
	,RentLogs.ORIGINALVALUE AS UW_Rent_Prior
	,RentLogs.UPDATEVALUE AS UW_Rent_Current
	,RentLogs.OCCUREDON  AS UW_Update_Date
	FROM UW_RENT_MAX
	LEFT JOIN PROD_REPLICA.HBPM_DBO.RENTLOGS RentLogs ON RentLogs.RENTLOGID = UW_RENT_MAX.RentLogID
	)

--******************************************************************************************************************************************
,OnMarketNote AS (
		SELECT DISTINCT 
	 	N.NOTEID AS LatestNoteID
	 	,N.NOTETEXT AS OnMarketNote
	 	,N.CREATEDDATE  AS OnMarketNoteCreated
	 	,DATEDIFF('Day',N.CREATEDDATE,GETDATE()) OnMarketNote_Days
	    ,P.PropertyId
	    ,U.FIRSTNAME || ' ' || U.LASTNAME AS OnMarketNote_Added_By
	    ,RANK() OVER( PARTITION BY P.PropertyId ORDER BY N.CREATEDDATE DESC) AS Recent_Rank
	
		FROM PROD_REPLICA.HBPM_DBO.NOTES N 
		LEFT JOIN PROD_REPLICA.HBPM_DBO.NOTETYPES NT ON NT.Id = N.NoteTypeId
		LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS LM ON LM.LookUpMasterId = N.ObjectTypeId
		LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES P ON P.PropertyID = N.ObjectID AND P."_FIVETRAN_DELETED" ='N'
		LEFT JOIN PROD_REPLICA.HBPM_DBO.USERS U ON U.USERID  = N.ADDEDBY 
	 	WHERE N.NoteTypeId = 19
	 --	AND PAI.PROPERTYID = 36301
	 	QUALIFY Recent_Rank = 1)
--**************************************************************************************************
,LIST_CHANGE AS ( 

SELECT 
LP.PROPERTY_LISTING_ID
,LP.LISTING_PRICE_CHANGE
,RANK() OVER(PARTITION BY LP.PROPERTY_LISTING_ID ORDER BY LP.ETL_UPDATE_DATE DESC, LISTING_PRICE_CHANGE DESC ) RECENT_RANK
,LP.INITIAL_LIST_PRICE
,LP.CURRENT_LIST_PRICE AS N_LIST_PRICE
,LP2.CURRENT_LIST_PRICE AS O_LIST_PRICE
,LP.CURRENT_LIST_PRICE - LP2.CURRENT_LIST_PRICE AS PRICE_CHANGE
,TO_DATE(CONVERT_TIMEZONE('EST',LP.ETL_UPDATE_DATE::date)) AS PRICE_CHANGE_DATE
,LP.ETL_UPDATE_DATE 

FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_LIST_STATUS_PRICE_HIST LP
LEFT JOIN (SELECT
            CURRENT_LIST_PRICE
           ,PROPERTY_LISTING_ID
		   ,ROW_NUMBER() OVER(PARTITION BY PROPERTY_LISTING_ID ORDER BY CHANGED_DATE_TIME DESC) RECENT_SUB_RANK
		FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_LIST_STATUS_PRICE_HIST
		WHERE INDEX_CHANGE_TYPE IN ('List Price', 'New')
		QUALIFY RECENT_SUB_RANK = 2
	) LP2 ON LP2.PROPERTY_LISTING_ID = LP.PROPERTY_LISTING_ID

WHERE
1=1
AND LP.INDEX_CHANGE_TYPE = 'List Price'
AND LP.LISTING_PRICE_CHANGE <> 0
--AND LP.PROPERTY_LISTING_ID = 6831744085

QUALIFY RECENT_RANK = 1  )
--*****************************************************************************
,HHI AS (Select 

D.Deal_ID 
,CASE WHEN sum(C_INC.Annual_Income) <30000 THEN NULL 
	  WHEN  sum(C_INC.Annual_Income) > 1000000 THEN NULL 
	  ELSE  sum(C_INC.Annual_Income) END AS HHI

FROM PROD_REPLICA.HUBSPOT.DEAL D
LEFT JOIN PROD_REPLICA.HUBSPOT.DEAL_CONTACT DC ON DC.DEAL_ID = D.DEAL_ID
LEFT JOIN (SELECT
				CONTACT_ID
				,COALESCE (
					SUM(CASE WHEN NAME = 'total_yearly_income' THEN value ELSE null END),
					SUM(CASE WHEN NAME = 'annual_salary' THEN value ELSE null END)) AS Annual_Income
				FROM PROD_REPLICA.HUBSPOT.COntact_PROPERTY_HISTORY
				
				WHERE 1=1 
				AND NAME IN ('annual_salary','total_yearly_income')
				GROUP BY CONTACT_ID ) C_INC ON C_INC.Contact_ID = DC.Contact_ID
				
WHERE 1=1 
GROUP BY D.DEAL_ID)

---***********************************************************************************************************************
,DEALS AS (SELECT 

P.PROPERTY_KEY
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
	      
,P.HBPM_PROPERTY_ID 
,P.EntityID
,P.Address
,PUS.Under_written_rent

,REC.RECEIEVABLE_ID
,PO.PORTFOLIO_NAME
,R.REGION_NAME

,D.SECURITY_DEPOSIT_ID
,D.DEAL_KEY
,D.DEAL_ID
,COALESCE(D.CURRENT_DEAL_STATUS,HUB_DEAL.DEAL_STAGE) AS CURRENT_DEAL_STATUS
,HUB_DEAL.APP_ID
,HUB_DEAL.APP_STAGE AS APP_STAGE

,D.COMBINED_INCOME * 12  AS COMBINED_INCOME
,DSH.LEAD_KEY
,D.APPLICATION_SUBMITTED_DATE::date AS Application_Submit_Date
,date_trunc('month',D.APPLICATION_SUBMITTED_DATE::date) as "App Submit (BOM)"
,CONVERT_TIMEZONE('EST', APPLICATION_STARTED_DATE::date) AS Application_Started_Date
,date_trunc('month',CONVERT_TIMEZONE('EST', APPLICATION_STARTED_DATE )::date) as App_Started_BOM

,DATEDIFF(DAY, COALESCE(D.APPLICATION_SUBMITTED_DATE ,to_date(L.Application_SUBMIT_Date_KEY::TEXT,'yyyymmdd'),CONVERT_TIMEZONE('EST', APPLICATION_STARTED_DATE::date),to_date(DSH.DEAL_CREATE_DATE_KEY::TEXT,'yyyymmdd')),GETDATE())  AS DAYS_SINCE_APP_SUBMIT

,L.First_Name ||  ' '  || L.Last_Name AS Lead_Name
,L.First_Name
,L.Last_Name
,L.PRIMARY_LEAD_ID
,D.EMail
,L.PHONE
,to_date(L.CREATED_DATE_KEY::TEXT,'yyyymmdd') AS Lead_Created_Date
,DATE_TRUNC('month', to_date(L.CREATED_DATE_KEY::TEXT,'yyyymmdd') ) AS "1_Lead (BOM)"

,to_date(DSH.DEAL_CREATE_DATE_KEY::TEXT,'yyyymmdd') AS DEAL_CREATE_DATE
,to_date(DSH.APPLICATION_APPROVED_DATE_KEY::TEXT,'yyyymmdd') AS APPLICATION_APPROVED_DATE
,to_date(DSH.DEAL_WON_DATE_KEY::TEXT,'yyyymmdd') AS DEAL_WON_DATE
,COALESCE(HUB_DEAL.PROPERTY_HOLDING_FEE_TRANSACTION_DATE,to_date(PAY.HOLDING_FEE_DATE_NEW::TEXT,'yyyymmdd'),to_date(DSH.HOLDING_FEE_PAID_DATE_KEY::TEXT,'yyyymmdd')) AS HOLDING_FEE_DATE_NEW
,to_date(DSH.LEASE_SIGNED_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_SIGNED_DATE
,to_date(DSH.CONVERT_TO_RESIDENT_DATE_KEY::TEXT,'yyyymmdd') AS CONVERT_TO_RESIDENT_DATE
,to_date(DSH.EXPECTED_MOVE_IN_DATE_KEY::TEXT,'yyyymmdd') AS EXPECTED_MOVE_IN_DATE
,COALESCE(to_date(DSH.LEASE_START_DATE_KEY::TEXT,'yyyymmdd'),
		  to_date(DSH.EXPECTED_MOVE_IN_DATE_KEY::TEXT,'yyyymmdd') ) AS LEASE_START_DATE
,to_date(DSH.LEASE_END_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_END_DATE
,U.USER_KEY
,TLA.Tenant_key
,COALESCE(to_date(TLA.INITIAL_LEASE_FROM_DATE_KEY::TEXT,'yyyymmdd'),
		  to_date(TLA.LEASE_FROM_DATE_KEY::TEXT,'yyyymmdd') ) AS TENANT_MOVE_IN

,D.DEAL_OWNER AS DEAL_OWNER
,L.CONTACT_OWNER
,D.AVERAGE_CREDIT_SCORE

,L.SOURCE
 ,'https://app.hubspot.com/contacts/22536354/record/0-3/' || D.DEAL_ID AS URL_HUBSPOT
,CASE WHEN DSH.CONVERT_TO_RESIDENT_DATE_KEY IS NOT NULL THEN 'Net HF' ELSE COALESCE(PAY.REFUNDED_FLAG, 'Net HF') END AS REFUNDED_FLAG 

,PM_AI.MOVEINREADY AS PM_MIR
,AM_CONS.PROJECTEDCOMPLETIONDATE	
,DATEADD(DAY,7,AM_CONS.PROJECTEDCOMPLETIONDATE) PCD_PLUS_SEVEN		
,DSH.LISTING_KEY

 ,HUB_DEAL.PROPERTY_LEASE_DRAFTING_STATUS AS LEASE_DRAFTING_STATUS
 ,HUB_DEAL.PROPERTY_MOVE_IN_FEE_PAYMENT_LINK AS MOVE_IN_FEE_PAYMENT_LINK
 ,HUB_DEAL.PROPERTY_MOVE_IN_CHARGES_PAID AS MOVE_IN_CHARGES_PAID
 ,HUB_DEAL.PROPERTY_DF_REFERENCE_NUMBER AS MOVE_IN_CHARGES_REFERENCE_ID
 ,HUB_DEAL.PROPERTY_IS_SECTION_8 AS IS_SECTION_8
 ,HUB_DEAL.PROPERTY_CONCESSION_DOLLAR_AMOUNT AS CONCESSION_DOLLAR_AMOUNT
  ,HUB_DEAL.PROPERTY_DENIAL_DISPUTE
  ,HUB_DEAL.PROPERTY_DENIAL_DISPUTE_COMMENTS
  ,HUB_DEAL.PROPERTY_DENIAL_DISPUTE_REASON
 ,HUB_DEAL.PROPERTY_APPLICATION_DENIAL_REASON
 ,DEAL_LOST.DEAL_LOST_REASON

FROM PROD_ANALYTICS.DBT_RESICAP.DIM_DEAL D
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_DEAL_STATUS_ACCUM DSH ON DSH.DEAL_KEY  = D.Deal_Key
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_LEAD L ON L.LEAD_KEY = DSH.Lead_Key

LEFT JOIN (SELECT
				Deal_ID 
				,Value AS RECEIEVABLE_ID
				FROM PROD_REPLICA.HUBSPOT.DEAL_PROPERTY_HISTORY
				
				WHERE 1=1
				--AND DEAL_ID =8496423848
				AND NAME = 'account_receivable'
				AND _FIVETRAN_ACTIVE = 'Y') REC ON REC.DEAL_ID = D.DEAL_ID	
				
LEFT JOIN (SELECT Charge_DATE_KEY, Property_Key, Receivable_ID, Amount 
			FROM PROD_ANALYTICS.DBT_RESICAP.FCT_LEASING_TRANSACTION
			WHERE 
			TRANSACTION_TYPE = 'Charges' 
			--AND IS_REVERSED = 'N' 
			AND Amount >= 500 
			AND GL_ACCOUNT_KEY IN (18)
			) CHG ON CHG.Receivable_ID = TRY_CAST(REC.RECEIEVABLE_ID AS INTEGER)

LEFT JOIN (SELECT

			LT.PROPERTY_KEY
			,MIN(LT.RECEIVED_ON_DATE_KEY) AS HOLDING_FEE_DATE_NEW
			,REFUND.REFUNDED_FLAG
			,MIN(LT.PAID_BY_USER_KEY) AS PAID_BY_USER_KEY 
		    ,LT.RECEIVABLE_ID
		    ,LT.TENANT_KEY
			,LT.AMOUNT
			FROM PROD_ANALYTICS.DBT_RESICAP.FCT_LEASING_TRANSACTION LT
			LEFT JOIN 	
				(SELECT
				 'Refunded' AS REFUNDED_FLAG 
				,PROPERTY_KEY
				,PAID_BY_USER_KEY
				,AMOUNT FROM PROD_ANALYTICS.DBT_RESICAP.FCT_LEASING_TRANSACTION
					WHERE 1=1 
					AND TRANSACTION_TYPE = 'Payment' ) REFUND ON REFUND.PROPERTY_KEY = LT.PROPERTY_KEY 
																AND REFUND.PAID_BY_USER_KEY = LT.PAID_BY_USER_KEY
																AND REFUND.AMOUNT = (LT.AMOUNT*-1)
			WHERE 1=1
			AND LT.TRANSACTION_TYPE = 'Payment' 
			AND LT.Amount >= 500
			AND LT.GL_ACCOUNT_KEY IN (18,-1) -- SD
			AND LT.RECEIVABLE_ID =1739849
		--	AND LT.PAID_BY_USER_KEY = 1663341
			GROUP BY
			 LT.PROPERTY_KEY
			,LT.RECEIVABLE_ID
			,LT.TENANT_KEY	
			,LT.AMOUNT
            ,REFUND.REFUNDED_FLAG
            ) PAY ON PAY.Receivable_ID = TRY_CAST(REC.RECEIEVABLE_ID AS INTEGER) AND PAY.Amount = CHG.Amount


LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_USER U ON U.USER_KEY = CASE WHEN DSH.User_key <> -1 THEN DSH.User_key
																	 ELSE Pay.PAID_BY_USER_KEY END
																			 
LEFT JOIN (SELECT TLA.* 
		FROM PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TLA
		LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT T ON T.Tenant_KEY = TLA.Tenant_key
		LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI ON TI.TENANTINFORMATIONID  = T.TENANT_INFORMATION_ID
		WHERE TI._FIVETRAN_DELETED <> 'Y'
		AND RENTDUEDAY IS NOT NULL
		AND T.TENANT_KEY NOT IN (70575) ) TLA ON TLA.USER_KEY = U.User_key

LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON 

P.PROPERTY_KEY = COALESCE ( PAY.Property_Key,
									CASE WHEN DSH.PROPERTY_KEY <> -1 THEN DSH.PROPERTY_KEY
									ELSE TLA.PROPERTY_KEY END)
								
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS ON PUS.PROPERTY_KEY  = P.PROPERTY_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY
LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES HBPM ON HBPM.PROPERTYID = P.HBPM_PROPERTY_ID --*REPLCA DB*
LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PM_AI ON PM_AI.PROPERTYID  = HBPM.PROPERTYID AND PM_AI."_FIVETRAN_DELETED" = 'N' 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_REGION R ON R.REGION_KEY = PUS.REGION_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY 
LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTIES HBAM ON HBAM.HBID = P.HBAM_PROPERTY_ID --*REPLCA DB*
LEFT JOIN PROD_REPLICA.HBAM_DBO.CONSTRUCTIONS AM_CONS ON AM_CONS.CONSTRUCTIONID = HBAM.CONSTRUCTION_CONSTRUCTIONID AND AM_CONS.HBID = HBAM.HBID AND AM_CONS."_FIVETRAN_DELETED" <> 'Y'

 LEFT JOIN (SELECT
               DEAL_ID
              ,VALUE AS DEAL_LOST_REASON
              FROM "PROD_REPLICA"."HUBSPOT_2"."DEAL_PROPERTY_HISTORY"
              WHERE 1=1
              AND name = 'deal_lost_reason'
              AND _FIVETRAN_ACTIVE = 'TRUE') DEAL_LOST ON DEAL_LOST.DEAL_ID = D.DEAL_ID


--REPLICA Section Start

LEFT JOIN (

SELECT 
  APP.PROPERTY_HOLDING_FEE_TRANSACTION_DATE
 ,CAST(COALESCE(HD.DEAL_PIPELINE_STAGE_ID,APP.PROPERTY_HS_PIPELINE_STAGE) AS INT) AS DEAL_PIPELINE_STAGE_ID
 ,COALESCE(D.DEAL_KEY,APP.APP_ID) AS DEAL_KEY_JOIN
 ,DPS.Label AS DEAL_STAGE
 ,APP_ID
  ,CASE 
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59173506 THEN 'Aplication Started'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 93217140 THEN 'Needs New Property'        
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59173507 THEN 'Under Review'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59187121 THEN 'Conditional Approval'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59187122 THEN 'Full Approval'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59187127 THEN 'Denial'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59187123 THEN 'Pre-Lease Compliance'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59187124 THEN 'Lease Drafting'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59187125 THEN 'Lease Executed'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59187126 THEN 'Move-In Scheduled'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59187128 THEN 'Closed Lost'
  ELSE NULL
  END AS APP_STAGE
 ,rank () over ( partition by COALESCE(D.DEAL_KEY,APP.APP_ID) ORDER BY HD.PROPERTY_HS_LASTMODIFIEDDATE, APP.APP_ID DESC) AS DEAL_RANK 
 ,HD.PROPERTY_LEASE_DRAFTING_STATUS
 ,HD.PROPERTY_LEASE_SIGNED_DATE
 ,HD.PROPERTY_MOVE_IN_FEE_PAYMENT_LINK
 ,HD.PROPERTY_MOVE_IN_CHARGES_PAID
 ,HD.PROPERTY_DF_REFERENCE_NUMBER
 ,HD.PROPERTY_IS_SECTION_8
 ,HD.PROPERTY_CONCESSION_DOLLAR_AMOUNT
 ,APP.PROPERTY_DENIAL_DISPUTE
 ,APP.PROPERTY_DENIAL_DISPUTE_COMMENTS
 ,APP.PROPERTY_DENIAL_DISPUTE_REASON
 ,APP.PROPERTY_APPLICATION_DENIAL_REASON
 
 FROM PROD_ANALYTICS.DBT_RESICAP.DIM_DEAL D
  LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_DEAL_STATUS_ACCUM DSH ON DSH.DEAL_KEY  = D.Deal_Key
  LEFT JOIN PROD_REPLICA.HUBSPOT_2.DEAL HD ON HD.DEAL_ID = D.DEAL_ID

  LEFT JOIN PROD_REPLICA.HUBSPOT_2.APPLICATION_TO_DEAL ATD ON ATD.TO_ID = D.DEAL_ID
   FULL JOIN (
  
    SELECT DISTINCT A.ID AS APP_ID, A.PROPERTY_UNIT_ID, A.PROPERTY_HS_PIPELINE_STAGE, A.PROPERTY_HOLDING_FEE_TRANSACTION_DATE, P.PROPERTY_KEY, A.PROPERTY_DENIAL_DISPUTE, A.PROPERTY_DENIAL_DISPUTE_COMMENTS, A.PROPERTY_DENIAL_DISPUTE_REASON, A.PROPERTY_APPLICATION_DENIAL_REASON
     
    FROM PROD_REPLICA.HUBSPOT_2.APPLICATION A              
    LEFT JOIN (select *,
              rank () over ( partition by FROM_ID ORDER BY _FIVETRAN_SYNCED DESC ) AS RECENT_RANK
              FROM PROD_REPLICA.HUBSPOT_2.APPLICATION_TO_PROPERTIES
              Qualify RECENT_RANK =1 ) ATP ON ATP.FROM_ID = A.ID
              LEFT JOIN PROD_REPLICA.HUBSPOT_2.PROPERTIES H_P ON H_P.ID = ATP.TO_ID
              LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON P.HBPM_PROPERTY_ID = H_P.PROPERTY_PROPERTY_ID
    WHERE IS_INTEGER(A.PROPERTY_HS_PIPELINE_STAGE)  ='True'
    AND A.PROPERTY_UNIT_ID IS NOT NULL
    AND APP_ID NOT IN (8472470544,8657787708,8657665830,6854090788)) --merged bad data        
              APP ON APP.APP_ID = ATD.FROM_ID AND APP.PROPERTY_KEY = DSH.PROPERTY_KEY
  
   LEFT JOIN 
      (SELECT * FROM PROD_REPLICA.HUBSPOT_2.DEAL_PIPELINE_STAGE 
                  WHERE _FIVETRAN_DELETED = 'N') DPS
       ON DPS.STAGE_ID = HD.DEAL_PIPELINE_STAGE_ID
   
  WHERE 1=1
  --AND DEAL_KEY_JOIN = 206925
  QUALIFY DEAL_RANK = 1 ) HUB_DEAL ON HUB_DEAL.DEAL_KEY_JOIN = D.DEAL_KEY
--Replica Section End       

WHERE 1=1

--AND HD.IS_DELETED <>'Y'
--AND COALESCE(D.CURRENT_DEAL_STATUS,HUB_DEAL.DEAL_STAGE) IS NOT NULL
AND P.Property_KEY IS NOT NULL
AND D.DEAL_PIPELINE <> 'Tour Pipeline'
AND D.DEAL_PIPELINE <> 'Renewals'
AND D.CURRENT_flag = 'Y'
AND (L.CURRENT_Flag = 'Y' OR DSH.LEAD_KEY = -1)
AND (L.IS_MERGED_LEAD IS NULL OR IS_MERGED_LEAD = 'N')
AND DSH.LEAD_KEY  IS NOT NULL
----AND L.Application_SUBMIT_Date_KEY IS NOT null
AND (TLA.TENANT_INFORMATION_ID <> 36986 OR TLA.TENANT_INFORMATION_ID IS NULL)



AND (HBAM.PROPERTYSTATUSID >9 OR HBAM.PROPERTYSTATUSID IS NULL) --out of bid
AND P.PROPERTY_STATE ='Active'
AND P.EntityID <> ''
AND (HBAM.PROPERTYSTATUSID NOT IN (53,75) OR HBAM.PROPERTYSTATUSID IS NULL)
AND PO.Portfolio_KEY NOT IN (223,598,147,102,109,28,603,169,602,170,58,54,169)
AND PUS.Organization_KEY not IN (16,17)
AND PO.IS_Active_AM = 'Y'
AND PO.Current_Flag = 'Y'
AND P.Current_Flag = 'Y'
AND PU.Current_Flag = 'Y'
AND PUS.Occupancy_Status NOT IN ('Not Managed')
AND (HBPM.PROPERTYSTATEID = 26 OR HBPM.PROPERTYSTATEID IS NULL) 

--AND DSH.HOLDING_FEE_PAID_DATE_KEY >= 20220201
--AND TLA.Tenant_Key = 4099
--AND D.deal_KEY = 105610
)
--Select * from Deals       
--WHERE Deals.DEAL_ID = 9871310690      	
 --**********************************************************************************************************************************             	
,TENANT AS (
 
SELECT

T.TENANT_KEY
,T.TENANT_INFORMATION_ID
,U.USER_KEY
,T.LEASE_ID
,RANK() OVER (PARTITION BY TS.Property_KEY ORDER BY Lease_ID ASC) AS Lease_Rank 
,PU.PROPERTY_UNIT_KEY
,TS.Property_KEY
,P.HBPM_PROPERTY_ID
,PO.Portfolio_Name
,P.ORGANIZATION_KEY
,O.ORGANIZATION_NAME
,P.Address
,P.EntityID
,PUS.Occupancy_Status

,U.FULL_NAME
,U.USER_STATUS
,U.EMAIL_ADDRESS
,U.PHONE_NUMBER
,T.TENANT_STATUS
,T.TENANT_TYPE
,T.PRIMARY_TENANT
,T.EVICTION_STATUS
,T.VEHICLES
,T.PETS
,T.MONTH_TO_MONTH
,T.LEASE_TERM
,to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd') AS NOTICE_DATE
,TLA.INITIAL_RENT_AMOUNT
,T.CURRENT_RENT
--,to_date(Deals.HOLDING_FEE_DATE_NEW::TEXT,'yyyymmdd') AS "HOLDING_FEE_DATE_NEW"
,to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd') AS CURRENT_LEASE_EXPIRATION_DATE
,to_date(TLA.LEASE_SIGNED_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_SIGNED_DATE
,to_date(TLA.LEASE_FROM_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_FROM_DATE
,to_date(TLA.LEASE_TO_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_TO_DATE

,to_date(T.DOB_DATE_KEY::TEXT,'yyyymmdd') AS DOB
,CASE WHEN COALESCE(RESI_TSUM.AVERAGE_CREDIT_SCORE, PM_D.AVERAGECREDITSCORE, DEALS.AVERAGE_CREDIT_SCORE) > 850 THEN NULL 
 ELSE COALESCE(RESI_TSUM.AVERAGE_CREDIT_SCORE, PM_D.AVERAGECREDITSCORE, DEALS.AVERAGE_CREDIT_SCORE)  END AS AVERAGE_CREDIT_SCORE
,COALESCE(RESI_TSUM.COMBINED_INCOME,PM_D.COMBINEDINCOME,DEALS.COMBINED_INCOME) COMBINEDINCOME
,RESI_TSUM.NUMBER_OF_CHILDREN
,RESI_TSUM.OCCUPANTS
,RESI_TSUM.TENANT_AGE
,RESI_TSUM.MONTHLY_INCOME
,RESI_TSUM.IS_RETIRED
,RESI_TSUM.IS_NOTICE
,RESI_TSUM.IS_UNDER_EVICTION
,HUB_PETS.PETS AS "PETS_AMOUNT"

,TI.MoveIn
,TI.MoveOut
,TI.PurchaseLetterPostedDate
,TI.DateNotified
,TI.FiledWithCountyDate
,TI.ResidentServedDate
,TI.CourtDateSetDate
,TI.JudgementDate
,TI.LockoutScheduledDate
,TI.VacateDate
,TI.AnticipatedMoveOutDate
,TI.IsSection8
,TI.IsMonthtoMonthLease
,TI.TenantDecidedMonthtoMonth
,TI.DoNotRenew
,TI.ReasonForNotRenewingId
,DNR.DESCRIPTION AS REASONFORNOTRENEWINGNAME
,PUS.Under_written_rent

FROM PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT T
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_ACTIVITY TS ON TS.TENANT_KEY = T.TENANT_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TLA ON TLA.TENANT_KEY = T.Tenant_Key
LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI ON TI.TenantInformationId = T.TENANT_INFORMATION_ID
LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS DNR on DNR.LookUpMasterId = TI.ReasonForNotRenewingId
LEFT JOIN PROD_REPLICA.HBPM_DBO.DEALS PM_D ON PM_D.LEADUSERID = TI.USERID AND PM_D.UNITID =TI.UNITID AND PM_D.SECURITYDEPOSITID IS NOT null
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_USER U ON U.USER_KEY = TS.USER_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON P.PROPERTY_KEY = TS.PROPERTY_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS ON PUS.PROPERTY_KEY  = P.PROPERTY_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_LEAD L ON L.lead_key = TS.LEAD_KEY 


LEFT JOIN DEALS ON Deals.User_key = TS.USER_KEY AND (Deals.Current_Deal_Status = 'Deal Won' OR Deals.Current_Deal_Status = 'Closed Won') AND Deals.PRoperty_key = P.Property_key AND Deals.SECURITY_DEPOSIT_ID IS NOT null
			
LEFT JOIN (SELECT C.ID, COUNT(PET.ID) PETS
			FROM PROD_REPLICA.HUBSPOT.PET 
			LEFT JOIN PROD_REPLICA.HUBSPOT.PET_TO_CONTACT PTC ON PTC.FROM_ID = PET.ID
			LEFT JOIN PROD_REPLICA.HUBSPOT.CONTACT C ON C.ID = PTC.TO_ID 
			GROUP BY C.ID) HUB_PETS ON HUB_PETS.ID = L.LEAD_ID
	
LEFT JOIN (SELECT 
			FCT_TENANT_SUMMARY_KEY 
			,TENANT_INFORMATION_ID 
			,AVERAGE_CREDIT_SCORE
			,COMBINED_INCOME
			,NUMBER_OF_CHILDREN
			,OCCUPANTS
			,TENANT_AGE
			,MONTHLY_INCOME
			,IS_RETIRED
			,IS_NOTICE
			,IS_UNDER_EVICTION
			FROM PROD_ANALYTICS.RESICAP.FCT_TENANT_SUMMARY R_TS
			LEFT JOIN PROD_ANALYTICS.RESICAP.DIM_TENANT R_T ON R_T.TENANT_KEY = R_TS.TENANT_KEY ) RESI_TSUM ON RESI_TSUM.TENANT_INFORMATION_ID = T.TENANT_INFORMATION_ID
						
WHERE 1=1
AND T.CURRENT_FLAG = 'Y'
AND T.PRIMARY_TENANT = 'Y'

AND T.Tenant_Status <> 'Future'
AND P.PROPERTY_STATE ='Active'
AND P.EntityID <> ''
AND TI._FIVETRAN_DELETED <> 'Y'
--AND (PS.PROPERTY_STATUS_ID NOT IN (53,75) OR PS.PROPERTY_STATUS_ID IS NULL)
AND PO.Portfolio_KEY NOT IN (1845, 2210, 2207, 2218, 1952,1867, 1916,1852,1771,1919,1873)
AND P.Organization_KEY not IN (16,17)
AND PO.IS_Active_AM = 'Y'
AND PO.Current_Flag = 'Y'
AND P.Current_Flag = 'Y'
AND PU.Current_Flag = 'Y'
AND PUS.Occupancy_Status NOT IN ('Property SOLD','Not Managed') 
AND TI.RENTDUEDAY IS NOT NULL
AND T.TENANT_KEY NOT IN (70575,76191)--bad DATA
AND TLA.FCT_TENANT_LEASING_ACCUM_KEY NOT IN (25236)) --bad DATA )
--AND T.TENANT_KEY NOT  (76191,76190))
--SELECT * FROM Tenant
--**************************************************************************************            	        	
,ListDeal AS (

SELECT

RLH.FCT_PRO_RENTAL_LISTING_HIST_KEY
,MIN(Deals.Deal_ID) DEAL_ID

FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_RENTAL_LISTING_HIST RLH
LEFT JOIN Deals ON Deals.PROPERTY_KEY = RLH.PROPERTY_KEY 


WHERE 1=1
AND RLH.LISTING_STATUS NOT IN ('Withdrawn', 'On Hold')
AND (Deals.Current_Deal_Status IN ('Pre-Lease Compliance','Lease Drafting','Lease Executed','Move-In Scheduled','Lease Signed (Working)','Lease Start Day','Post Move-In')
   OR Deals.APP_STAGE IN ('Pre-Lease Compliance','Lease Drafting','Lease Executed','Move-In Scheduled','Lease Signed (Working)','Lease Start Day','Post Move-In'))
AND Deals.Current_Deal_Status NOT IN ('Deal Lost', 'Rejected','Closed Lost','Property Listed')

AND APP_STAGE IS NOT NULL
AND DEALS.LISTING_KEY = RLH.LISTING_KEY
--AND DEALS.REFUNDED_FLAG IS NULL
--AND LISTING_DATE_KEY >  20220101 
--AND RLH.PRoperty_Key = 68292880
--AND RENT_LIST_HIST_ID = 6831764523

GROUP BY FCT_PRO_RENTAL_LISTING_HIST_KEY
)

     
/*SELECT * FROM ListDeal 
WHERE
-- RLH.Property_Key =15602
FCT_PRO_RENTAL_LISTING_HIST_KEY = 19164
*/



--**************************************************************************************
,LEASE_HIST AS 
(
SELECT DISTINCT
P.PROPERTY_KEY 
,to_date(TLA.LEASE_FROM_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_FROM_DATE
,TLH.AMOUNT
,RANK () OVER (PARTITION BY P.PROPERTY_KEY ORDER BY DATE_TRUNC('day',CREATED) DESC, TLH.LEASESTART DESC, TLA.LEASE_FROM_DATE_KEY DESC, TLH.AMOUNT ASC )  RANK_1
FROM PROD_REPLICA.HBPM_DBO.TENANTLEASINGHISTORIES TLH
LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI ON TI.TenantInformationId = TLH.TenantInformationId
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT T ON T.TENANT_INFORMATION_ID = TI.TenantInformationId AND T.Current_FLAG = 'Y'
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TLA ON TLA.TENANT_KEY = T.Tenant_Key
LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PAI ON PAI.UnitId = TI.UnitId AND PRIMARYTENANT = 'TRUE'
LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES HBPM ON HBPM.PropertyId = PAI.PropertyId
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON P.HBPM_PROPERTY_ID = HBPM.PROPERTYID AND P.Current_FLAG = 'Y'
LEFT JOIN (SELECT Max(Id) RRQC_ID ,HBID FROM PROD_REPLICA.HBAM_DBO.RRQCCHANGELOGS GROUP BY HBID) RRQC_MOST_RECENT ON RRQC_MOST_RECENT.HBID = P.HBAM_PROPERTY_ID
LEFT JOIN PROD_REPLICA.HBAM_DBO.RRQCCHANGELOGS RRQC ON RRQC.ID = RRQC_MOST_RECENT.RRQC_ID

WHERE 1=1
AND TLA.LEASE_FROM_DATE_KEY IS NOT NULL
AND T.Tenant_Status <> 'Future'
AND TLH.AMOUNT <> 0
AND TLH.AMOUNT >= 500
AND RRQC.RRQCPassDate IS NOT NULL 
AND to_date(TLA.LEASE_FROM_DATE_KEY::TEXT,'yyyymmdd') >= RRQC.RRQCPassDate
--AND P.PRoperty_key = 183910
QUALIFY RANK_1 = 1)
--**************************************************************************************

SELECT DISTINCT 

RLH.FCT_PRO_RENTAL_LISTING_HIST_KEY

,RLH.PROPERTY_KEY
,PU.PROPERTY_UNIT_KEY
,P.EntityID
,R.Region_Name
,COALESCE(PM_AI.Bedrooms, PU.BEDROOMS) AS BEDROOMS
,COALESCE(PM_AI.BATHROOMS, PU.BATHROOMS) AS BATHROOMS
,PU.SQUARE_FOOTAGE
,P.Year_Built
,P.ADDRESS || ', ' || CI.CITY_NAME || ', ' || S.STATE_NAME || ' ' || P.ZIPCODE AS Full_Address
,P.ADDRESS
,CI.CITY_NAME
,S.STATE_NAME
,S.STATE_CODE
,P.ZIPCODE
,CO.COUNTY_NAME
,SUB.SUBDIVISION
,P.FloorPlan
,COALESCE(to_date(P.TRANSFER_DATE_KEY::TEXT,'yyyymmdd'),to_date(P.PURCHASE_DATE_KEY::TEXT,'yyyymmdd')) AS "Transfer_Date"
,AM_PM.MoveInReady
,PM_AI.MOVEINREADY AS PM_MIR
,DATE_TRUNC('month',COALESCE(PM_AI.MOVEINREADY,GETDATE())) AS PM_MIR_BOM

,MO.MoveOut

,CASE  WHEN RLH.LISTING_STATUS <> 'Active' THEN NULL
	   WHEN PUS.Occupancy_Status = 'Tenant Leased' 
	   THEN NULL
	   WHEN RRQC.RRQCPassDate IS NULL THEN 0
	   ELSE DATEDIFF(DAY,GREATEST(
		COALESCE(RRQC.RRQCPassDate,to_date(P.TRANSFER_DATE_KEY::TEXT,'yyyymmdd'),to_date(P.PURCHASE_DATE_KEY::TEXT,'yyyymmdd'))
		,COALESCE(MO.MoveOut,'1900-01-01')),
		GETDATE()) END AS Days_Vacant	
		
,RLH.PORTFOLIO_KEY
,PO.Portfolio_Name
,PUS.Occupancy_Status
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
	      
,TO_date(RLH.LISTING_DATE_KEY::TEXT,'YYYYMMDD') AS LISTING_DATE
,TO_date(RLH.LISTING_END_DATE_KEY::TEXT,'YYYYMMDD') AS LISTING_END_DATE
,CASE WHEN TO_date(RLH.LISTING_END_DATE_KEY::TEXT,'YYYYMMDD') >= LC.PRICE_CHANGE_DATE THEN NULL
      ELSE LC.PRICE_CHANGE_DATE END AS RENT_MODIFIED_DATE
      
,COALESCE(HL.PROPERTY_LISTING_AGENT_FULL_NAME,RLH.LEASING_AGENT) AS LEASING_AGENT
,COALESCE(HL.PROPERTY_LISTING_AGENT_EMAIL,RL_U.EmailAddress) AS AGENT_EMAIL
,RLH.INITIAL_LIST_PRICE
,RLH.CURRENT_LIST_PRICE

,RLH.CONCESSION_TYPE_ID AS CONCESSION_TYPE_ID
,RLH.CONCESSION_TYPE AS CONCESSION_TYPE
,CASE WHEN RLH.CONCESSION_TYPE_ID = 4471 THEN ROUND(RLH.CONCESSION_MONTHS_OFF,1) || ' ' || RLH.CONCESSION_TYPE
	  WHEN RLH.CONCESSION_TYPE_ID = 4470 THEN ROUND(RLH.CONCESSION_AMOUNT,0) || ' ' || RLH.CONCESSION_TYPE
	  ELSE RLH.CONCESSION_TYPE 
	  END AS CONCESSION_TYPE_COMBINED
,to_date(RLH.CONCESSION_END_DATE_KEY::text,'yyyymmdd') AS CONCESSIONENDDATE
,RLH.CONCESSION_MONTHS_OFF AS CONCESSIONMONTHSOFF
,RLH.CONCESSION_AMOUNT AS CONCESSIONAMOUNT

,RLH.LISTING_STATUS
,RLH.RENT_LIST_HIST_ID
,D.DEAL_KEY
,D.CURRENT_DEAL_STATUS
,D.APP_STAGE
,D.DEAL_ID
,COALESCE (D.LEASE_START_DATE,Tenant.LEASE_FROM_DATE) AS LEASE_START_DATE
,DATE_TRUNC('month',COALESCE (D.LEASE_START_DATE,Tenant.LEASE_FROM_DATE)) AS LEASE_START_DATE_BOM
,COALESCE(D.LEASE_END_DATE,Tenant.LEASE_TO_DATE) AS LEASE_END_DATE
,COALESCE(D.LEASE_SIGNED_DATE,Tenant.LEASE_SIGNED_DATE) AS LEASE_SIGNED_DATE
,D.LEAD_KEY
,D.HOLDING_FEE_DATE_NEW
,U.FULL_NAME 
,D.EMAIL AS LEAD_EMAIL
,D.LEAD_NAME 
,D.PHONE AS LEAD_PHONE
,D.First_Name
,D.Last_Name
,Tenant.TENANT_KEY
,D.Deal_Owner
,CASE WHEN D.IS_SECTION_8 = 1 THEN 'Yes' ELSE 'No' END AS Section_8
,Tenant.CURRENT_RENT
,PUS.Under_written_rent
,D.APP_ID
,D.URL_HUBSPOT

,CASE WHEN (PUS.Occupancy_Status <> 'Vacant - Future Move In' AND RLH.LISTING_STATUS <> 'Deposit Taken') THEN NULL
	  WHEN D.CURRENT_DEAL_STATUS IS NULL OR (D.CURRENT_DEAL_STATUS = 'Closed Lost' AND (D.APP_STAGE IS NULL OR D.APP_STAGE = 'Closed Lost')) THEN -2
	  WHEN COALESCE (D.LEASE_START_DATE,Tenant.LEASE_FROM_DATE) < DAte(GETDATE()) AND COALESCE (D.LEASE_START_DATE,Tenant.LEASE_FROM_DATE) IS NOT NULL AND D.CURRENT_DEAL_STATUS <> 'Closed Lost' THEN -1
	  WHEN D.LEASE_START_DATE IS NULL AND D.CURRENT_DEAL_STATUS = 'Closed Lost' THEN 1
	  ELSE 2
	  END AS "Listings Format"
	  
,CASE WHEN (PUS.Occupancy_Status <> 'Vacant - Future Move In' AND RLH.LISTING_STATUS <> 'Deposit Taken') THEN NULL
	  WHEN D.CURRENT_DEAL_STATUS IS NULL OR (D.CURRENT_DEAL_STATUS = 'Closed Lost' AND (D.APP_STAGE IS NULL OR D.APP_STAGE = 'Closed Lost')) THEN 'Deal Lost'
	  WHEN COALESCE (D.LEASE_START_DATE,Tenant.LEASE_FROM_DATE) < DATE(GETDATE()) AND COALESCE (D.LEASE_START_DATE,Tenant.LEASE_FROM_DATE) IS NOT NULL AND D.CURRENT_DEAL_STATUS <> 'Closed Lost'  THEN 'Past Scheduled Move-In'
	  WHEN D.LEASE_START_DATE IS NULL AND D.CURRENT_DEAL_STATUS = 'Closed Lost' THEN 'Needs Move-In Date'
	  ELSE 'On Track'
	  END AS "Listings Format_Name"

,CASE WHEN (PUS.Occupancy_Status <> 'Vacant - Future Move In' AND RLH.LISTING_STATUS <> 'Deposit Taken') THEN NULL
      WHEN D.HOLDING_FEE_DATE_NEW IS null THEN NULL
      ELSE DATEDIFF(DAY, D.HOLDING_FEE_DATE_NEW, GETDATE() )
      END AS "Days Since HF"
      
,CASE WHEN D.LEASE_START_DATE IS NULL THEN NULL
      WHEN D.HOLDING_FEE_DATE_NEW IS Null THEN NULL
      WHEN D.LEASE_START_DATE >= D.HOLDING_FEE_DATE_NEW THEN  DATEDIFF(DAY, D.HOLDING_FEE_DATE_NEW, D.LEASE_START_DATE)
      END AS "Days HF-MI"
      
 ,CASE WHEN D.LEASE_START_DATE IS NULL THEN NULL
 	   WHEN TENANT.TENANT_KEY IS NULL THEN NULL 
 	   ELSE DATE_TRUNC('month',D.LEASE_START_DATE)
 	   END AS "Move-In (BOM)"
 	
,CASE WHEN RLH.LISTING_DATE_KEY IS NULL THEN NULL
      ELSE DATE_TRUNC('month',TO_date(RLH.LISTING_DATE_KEY::TEXT, 'YYYYMMDD'))
 	  END AS "List (BOM)"
 	  
,CASE WHEN RANK() OVER (PARTITION BY RLH.PROPERTY_KEY 
			  ORDER BY RLH.RENT_LIST_HIST_ID DESC) = 1 THEN 'Yes' ELSE 'No' END AS MOST_RECENT_LISTING
	  
,CASE WHEN D.LEASE_START_DATE IS NOT NULL THEN DATEDIFF(DAY,GETDATE(), D.LEASE_START_DATE ) 
	  ELSE NULL END AS "Days_Until_MI"

,CASE WHEN RLH.LISTING_STATUS ='Active' THEN DATEDIFF('day',to_date(RLH.LISTING_DATE_KEY::TEXT,'yyyymmdd'),GETDATE())  ELSE NULL END AS Listing_DOM


,CASE WHEN RLH.LISTING_DATE_KEY IS NULL THEN NULL 
	  WHEN RLH.LISTING_STATUS <> 'Active' THEN NULL
	  ELSE DATEDIFF(DAY,to_date(RLH.LISTING_DATE_KEY::TEXT,'yyyymmdd'),GETDATE())
	  END AS "Days_On_Market_Active"
	  
,CASE WHEN RLH.LISTING_DATE_KEY IS NULL THEN NULL 
	  WHEN RLH.LISTING_STATUS <> 'Active' THEN NULL
	  ELSE LEAST(7,DATEDIFF(DAY,to_date(RLH.LISTING_DATE_KEY::TEXT,'yyyymmdd'),GETDATE())-1)
	  END AS "Days_On_Market_Active_Last_Week"

,CASE WHEN RLH.LISTING_DATE_KEY IS NULL THEN NULL 
	  WHEN RLH.LISTING_STATUS <> 'Active' THEN NULL
	  ELSE 
	  TO_VARCHAR(TRUNCATE (DATEDIFF(DAY,to_date(RLH.LISTING_DATE_KEY::TEXT,'yyyymmdd'),GETDATE())/10 ) * 10) || ' - ' ||
	  TO_VARCHAR(TRUNCATE (DATEDIFF(DAY,to_date(RLH.LISTING_DATE_KEY::TEXT,'yyyymmdd'),GETDATE())/10 ) * 10 + 10)
	  END AS "Days_On_Market_Active_Bucket"

,CASE WHEN RLH.LISTING_DATE_KEY IS NULL THEN NULL 
	  WHEN RLH.LISTING_STATUS <> 'Active' THEN NULL
	  ELSE 
	  TRUNCATE (DATEDIFF(DAY,to_date(RLH.LISTING_DATE_KEY::TEXT,'yyyymmdd'),GETDATE())/10 ) * 10
	  END AS "Days_On_Market_Active_Sort"
	  
,CASE WHEN RLH.LISTING_DATE_KEY IS NULL THEN NULL
	  WHEN TO_date(RLH.LISTING_END_DATE_KEY::TEXT,'YYYYMMDD') >= LC.PRICE_CHANGE_DATE THEN NULL
	  WHEN RLH.LISTING_STATUS <> 'Active' THEN NULL
	  ELSE DATEDIFF(DAY,LC.PRICE_CHANGE_DATE,GETDATE())
	  END AS "Days_Since_Reduction_Active"

 --,CASE WHEN PM_AI.MOVEINREADY >= GETDATE() THEN 0 ELSE
 --DATETEDIFF('day',GREATEST(COALESCE(HCV.INSPECTION_COMPLETED_DATE,to_date(RLH.LISTING_DATE_KEY::TEXT,'yyyymmdd')),to_date(RLH.LISTING_DATE_KEY::TEXT,'yyyymmdd'),PM_AI.MOVEINREADY),GETDATE()) END AS Days_Since_Vacancy_Check
--,HCV.REPORT_STATUS AS HC_VACANCY_STATUS

,LC.N_LIST_PRICE
,LC.O_LIST_PRICE
,CASE WHEN LC.PRICE_CHANGE_DATE IS NOT NULL
	THEN COALESCE(LC.PRICE_CHANGE, RLH.CURRENT_LIST_PRICE - RLH.INITIAL_LIST_PRICE)
	ELSE NULL
	END AS PRICE_CHANGE


,HF.Description AS LISTING_DESCRIPTION
,CASE WHEN DL.LISTING_STATE = 'Inactive' AND PUS.Occupancy_Status = 'Tenant Leased' THEN 0
	  WHEN (RLH.LISTING_STATUS ='Deposit Taken' OR PUS.Occupancy_Status = 'Vacant - Future Move In')
      THEN 1 
      WHEN RLH.LISTING_STATUS IN ('Active','Leased') 
      AND D.CURRENT_DEAL_STATUS IN ('Pre-Lease Compliance','Lease Drafting','Lease Signed (Working)','Move-in Scheduled','Lease Start Day')
      THEN 1
ELSE 0 END AS FMI_FLAG

,LEASE_HIST.LEASE_FROM_DATE  AS LAST_LEASE_START
--,LEASE_HIST.AMOUNT      AS LAST_LEASE_AMOUNT
,HL.PROPERTY_LAST_LEASE_RATE     AS LAST_LEASE_AMOUNT
,'https://honeybadgerpm.com/PropertyModule#/PropertyDetails/' || HBPM.PROPERTYID || '/' || PM_AI.UnitID ||'/0' AS HBPM_URL

,ONN.OnMarketNote
,ONN.OnMarketNoteCreated
,ONN.OnMarketNote_Days
,ONN.OnMarketNote_Added_By
	
,ASM."Recalculated NOI" AS ASM_Recalculated_NOI
,ASM."In Place Rent"  AS ASM_In_Place_Rent
,ASM."Budget Rent"  AS ASM_Budget_Rent
,COALESCE(ASM."Original UW rent",PUS.Under_written_rent) AS ASM_Original_UW_Rent
,UWP."Projected cost basis" AS ASM_Cost_Basis
,CASE WHEN ASM."Recalculated NOI" IS NOT NULL AND UWP."Projected cost basis" IS NOT NULL 
 THEN ASM."Recalculated NOI" / UWP."Projected cost basis"
 ELSE NULL END AS ASM_Net_Yield

,CASE WHEN UW_Rent.UW_Update_Date IS NOT NULL THEN DATEDIFF('day',UW_Rent.UW_Update_Date,GETDATE())
      ELSE NULL END AS UW_Days_Since_Update
--,COALESCE( LEASE_HIST.AMOUNT,ASM."Original UW rent",PUS.Under_written_rent) AS ASM_Blended_UW_Rent
,COALESCE( HL.PROPERTY_LAST_LEASE_RATE,ASM."Original UW rent",PUS.Under_written_rent) AS ASM_Blended_UW_Rent

,CASE WHEN D.LEASE_START_DATE <= DATEADD(DAY,6,AM_CONS.PROJECTEDCOMPLETIONDATE) 
      AND AM_CONS.PROJECTEDCOMPLETIONDATE IS NOT NULL 
      AND D.LEASE_START_DATE IS NOT NULL
      THEN 'LSD Needs Pushed'
      ELSE 'LSD Good '
      END AS PCD_FLAG


,DL.IS_PUBLISHED as IS_PUBLISHED
,DL.IS_PRELEASING AS PRE_LEASING
,DL.LISTING_STATE
,DL.LISTING_KEY

,DL.LISTING_PRICE_MODIFICATION_DATE AS LISTING_PRICE_MODIFICATION_DATE

 ,D.LEASE_DRAFTING_STATUS
 ,D.MOVE_IN_FEE_PAYMENT_LINK
 ,D.MOVE_IN_CHARGES_PAID
 ,D.MOVE_IN_CHARGES_REFERENCE_ID

 
 ,CASE 
   WHEN D.CURRENT_DEAL_STATUS IN ('Lease Drafting','Lease Signed (Working)','Move-In Scheduled','Lease Executed','Lease Start Day' )
   OR D.APP_STAGE IN ('Lease Drafting','Lease Signed (Working)','Move-In Scheduled','Lease Executed','Lease Start Day' ) THEN
    (CASE WHEN D.LEASE_DRAFTING_STATUS <> 'Completed' THEN 'Pending Lease Signature'
     WHEN D.LEASE_DRAFTING_STATUS = 'Completed' AND D.MOVE_IN_CHARGES_PAID IS NULL THEN 'Pending Move-In Charges'
     WHEN D.LEASE_DRAFTING_STATUS = 'Completed' AND D.MOVE_IN_CHARGES_PAID IS NOT NULL THEN 'CODE READY' END)
   ELSE NULL
 END AS CODE_READY
 
      
FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_RENTAL_LISTING_HIST RLH
LEFT JOIN PROD_REPLICA.HUBSPOT_2.CUSTOM_LISTING HL ON HL.ID = RLH.Rent_LIST_HIST_ID
LEFT JOIN ListDeal LD ON LD.FCT_PRO_RENTAL_LISTING_HIST_KEY = RLH.FCT_PRO_RENTAL_LISTING_HIST_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_LISTING DL ON RLH.LISTING_KEY = DL.LISTING_KEY
LEFT JOIN Deals D ON D.Deal_ID = LD.Deal_ID
	AND (D.Current_Deal_Status IN ('Pre-Lease Compliance','Lease Drafting','Lease Executed','Move-In Scheduled','Lease Signed (Working)','Lease Start Day','Post Move-In')
         OR D.APP_STAGE IN ('Pre-Lease Compliance','Lease Drafting','Lease Executed','Move-In Scheduled','Lease Signed (Working)','Lease Start Day','Post Move-In'))
 	AND D.APP_STAGE IS NOT NULL
 	AND D.Current_Deal_Status NOT IN ('Deal Lost', 'Rejected','Closed Lost','Property Listed')

LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON P.PROPERTY_KEY = RLH.PROPERTY_KEY AND P.CURRENT_FLAG = 'Y'
LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES HBPM ON HBPM.PROPERTYID = P.HBPM_PROPERTY_ID --*REPLCA DB*
LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTIES HBAM ON HBAM.HBID = P.HBAM_PROPERTY_ID --*REPLCA DB*
LEFT JOIN PROD_REPLICA.HBAM_DBO.CONSTRUCTIONS AM_CONS ON AM_CONS.CONSTRUCTIONID = HBAM.CONSTRUCTION_CONSTRUCTIONID AND AM_CONS.HBID = HBAM.HBID AND AM_CONS."_FIVETRAN_DELETED" <> 'Y'
LEFT JOIN (SELECT Max(Id) RRQC_ID ,HBID FROM PROD_REPLICA.HBAM_DBO.RRQCCHANGELOGS GROUP BY HBID) RRQC_MOST_RECENT ON RRQC_MOST_RECENT.HBID = P.HBAM_PROPERTY_ID
LEFT JOIN PROD_REPLICA.HBAM_DBO.RRQCCHANGELOGS RRQC ON RRQC.ID = RRQC_MOST_RECENT.RRQC_ID

LEFT JOIN PROD_REPLICA.HBPM_DBO.USERS PM_U ON PM_U.UserID = HBPM.ASSIGNEDUSERID 
LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PM_AI ON PM_AI.PROPERTYID  = HBPM.PROPERTYID AND PM_AI."_FIVETRAN_DELETED" = 'N' 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS ON PUS.PROPERTY_KEY  = P.PROPERTY_KEY 
	LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY
	LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY 
	LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_REGION R ON R.REGION_KEY = PUS.REGION_KEY 
	LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY 
	LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_CITY CI ON CI.CITY_KEY = PUS.CITY_KEY 
	LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_STATE S ON S.STATE_KEY = PUS.STATE_KEY 
	LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_COUNTY CO ON CO.COUNTY_KEY = PUS.COUNTY_KEY 
	LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_SUBDIVISION SUB ON SUB.SUBDIVISION_KEY = PUS.SUBDIVISION_KEY 
LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTYMANAGEMENTS AM_PM ON AM_PM.PROPERTYMANAGEMENTID = HBAM.PropertyManagement_PropertyManagementId AND AM_PM.HBID = HBAM.HBID AND AM_PM."_FIVETRAN_DELETED" <> 'Y'
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_USER U ON U.USER_KEY = D.USER_KEY
LEFT JOIN TENANT ON TENANT.USER_KEY = D.USER_KEY 

LEFT JOIN (SELECT
			MAX(TI.MoveOut) MoveOut
			,TLA.Property_key
			FROM PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT T
				LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TLA ON TLA.TENANT_KEY = T.Tenant_Key
				LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI ON TI.TENANTINFORMATIONID = T.Tenant_Information_id
			WHERE 1=1
				AND PRIMARY_TENANT ='Y' 
				AND CURRENT_FLAG ='Y'
				AND RENT_DUE_DAY IS NOT NULL
				AND TI._FIVETRAN_DELETED = 'N'
				AND TI.MoveOut IS NOT NULL
			GROUP BY TLA.Property_key ) MO ON MO.PRoperty_key = P.Property_key
		

LEFT JOIN LIST_CHANGE LC ON LC.PROPERTY_LISTING_ID = RLH.RENT_LIST_HIST_ID
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_HOME_FEATURE HF ON HF.HOME_FEATURE_KEY = RLH.HOME_FEATURE_KEY

LEFT JOIN PROD_REPLICA.HBPM_DBO.RENTALLISTINGENTRIES DL_RL ON DL_RL.ID = RLH.RENT_LIST_HIST_ID -- Replica
LEFT JOIN PROD_REPLICA.HBPM_DBO."USERS" RL_U ON RL_U.USERID = DL_RL.LEASINGAGENTID 
LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS DL_CT ON DL_CT.LOOKUPMASTERID = DL_RL.CONCESSIONTYPEID -- Replica
LEFT JOIN LEASE_HIST ON LEASE_HIST.Property_key = P.Property_key
LEFT JOIN ONMarketNote ONN ON ONN.PropertyID = P.HBPM_PROPERTY_ID		

LEFT JOIN PROD_ANALYTICS.BI_DATASET_VIEWS.VW_ASM_ACQUISITION_AM ASM ON ASM."EntityID" = P.EntityID
LEFT JOIN PROD_ANALYTICS.BI_DATASET_VIEWS.VW_ASM_UNDERWRITING_PROPERTIES UWP ON UWP."Entity ID" = P.EntityID AND UWP."Source.Name" = 'AAA_DATA_TABLE'
LEFT JOIN UW_RENT ON UW_Rent.HBPM_UnitID = PM_AI.UnitID	

WHERE 1=1
AND RLH.LISTING_KEY IS NOT null
--AND RLH.LISTING_STATUS NOT IN ('Withdrawn', 'On Hold')
AND (RLH.LISTING_DATE_KEY IS NOT NULL OR RLH.LISTING_STATUS NOT IN ('Active'))
AND P.PROPERTY_STATE ='Active'
AND P.EntityID <> ''
AND RLH.CURRENT_LIST_PRICE <> 0
--AND (PS.PROPERTY_STATUS_ID NOT IN (53,75) OR PS.PROPERTY_STATUS_ID IS NULL)
AND PO.Portfolio_KEY NOT IN (1845, 2210, 2207, 2218, 1952,1867, 1916,1852,1771,1919,1873)
AND P.Organization_KEY not IN (16,17)
AND PO.IS_Active_AM = 'Y'
AND PO.Current_Flag = 'Y'
AND P.Current_Flag = 'Y'
AND PU.Current_Flag = 'Y'
AND PUS.Occupancy_Status NOT IN ('Property SOLD','Not Managed') 
AND RENT_LIST_HIST_ID NOT IN (8831,5319)`;

export const PM_BOM_SQL = `/* =============================================================================
   PM BOM DATASET (Beginning-of-Month property occupancy + post-90 days)
   -----------------------------------------------------------------------------
   Grain:   One row per property x beginning-of-month (anchor: Prop_Calendar =
            DIM_PROPERTY cross-joined to a generated month spine from 2024-01).
   CTE chain: Calendar, Prop_Calendar, Prop_Hist (status-history UNION current
            status), BOM_Status (latest status as-of EOM and as-of BOM),
            RENT_HIST, RENT_TEMP -> final SELECT.

   CLEANUP NOTES:
     No organization roll-up exists in this query (no ORGANIZATION_KEY /
     ORGANIZATION_NAME columns are produced), so NO org sync was applied. This
     pass is COSMETIC ONLY: header added, trailing semicolon removed; query
     logic is unchanged byte-for-byte.
     [FLAG]  The DIM_OWNER_ORGANIZATION O join (in Prop_Calendar and in the
             second leg of Prop_Hist) is referenced only in its own ON clause
             (O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY) and surfaces no column;
             the active org filter uses PUS.Organization_KEY. It is a one-row-
             per-key dimension LEFT JOIN, so it neither fans out nor filters and
             could be dropped, but is PRESERVED here to keep this a no-logic-
             change pass.

   ORG SYNC IMPACT: none (no organization columns in this dataset).
   ============================================================================= */

WITH Calendar AS (
    SELECT DATEADD('month', SEQ4(), DATE_FROM_PARTS(2024, 1, 1)) AS BEG_OF_MONTH
    FROM TABLE(GENERATOR(ROWCOUNT => 10000))
    WHERE BEG_OF_MONTH <= DATE_TRUNC('month', CURRENT_DATE())
)
  --Select * from Calendar
--***************************************************************************

,Prop_Calendar AS (
  Select
   P.HBPM_PROPERTY_ID AS PropertyId
   ,P.PROPERTY_KEY AS PROP_KEY
   ,P.ENTITYID
   ,BEG_OF_MONTH
  FROM PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P
  LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS ON PUS.PROPERTY_KEY  = P.PROPERTY_KEY 
  LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTIES HBAM ON HBAM.HBID = P.HBAM_PROPERTY_ID --*REPLCA DB*
  LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES HBPM ON HBPM.PROPERTYID = P.HBPM_PROPERTY_ID --*REPLCA DB*
  LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PM_AI ON PM_AI.PROPERTYID  = HBPM.PROPERTYID AND PM_AI."_FIVETRAN_DELETED" = 'N' 
  LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY 
  LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY
  LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY 
  CROSS JOIN Calendar

  WHERE 1=1
	AND (HBAM.PROPERTYSTATUSID >9 OR HBAM.PROPERTYSTATUSID IS NULL) --out of bid
	AND P.PROPERTY_STATE ='Active'
	AND P.EntityID <> ''
	AND (HBAM.PROPERTYSTATUSID NOT IN (53,75) OR HBAM.PROPERTYSTATUSID IS NULL)
	AND PO.Portfolio_KEY NOT IN (223,598,147,102,109,28,603,169,602,170,58,54)
	AND PUS.Organization_KEY not IN (16,17)
	AND PO.IS_Active_AM = 'Y'
	AND PO.Current_Flag = 'Y'
	AND P.Current_Flag = 'Y'
	AND PU.Current_Flag = 'Y'
	AND PUS.Occupancy_Status NOT IN ('Not Managed')
	AND (HBPM.PROPERTYSTATEID = 26 OR HBPM.PROPERTYSTATEID IS NULL) 
	AND P.HBMM_Property_ID IS NOT NULL )
  --Select * from Prop_Calendar
--***************************************************************************

,Prop_Hist AS (
  SELECT
   P.HBPM_PROPERTY_ID AS PropertyId
   ,P.PROPERTY_KEY  AS PROP_KEY
  ,FCT_PROP_UNIT_STATUS_HIST_KEY AS AuditLogId
  ,LM.LOOKUPMASTERID AS AfterValue
  ,NEW_OCCUPANCY_STATUS AS Occupancy_Status
  ,to_date(CHANGED_DATE_KEY::TEXT,'yyyymmdd') AS LogDateTime
  
  FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_UNIT_STATUS_HIST PSH
  LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS LM ON LM.DESCRIPTION = PSH.NEW_OCCUPANCY_STATUS 
  LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON P.PROPERTY_KEY = PSH.PROPERTY_KEY 
  WHERE 1=1

    AND P.PROPERTY_STATE ='Active'
    AND P.EntityID <> ''
    AND P.Current_Flag = 'Y'
    AND P.HBMM_Property_ID IS NOT NULL

UNION ALL

Select 
   P.HBPM_PROPERTY_ID AS PropertyId
   ,P.Property_key AS PROP_KEY
  ,1 As AuditLogId
  ,LM.LOOKUPMASTERID AS OccupancyStatusId
  ,PUS.OCCUPANCY_STATUS
  ,P.Created_Date AS LogDateTime
  
  FROM PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P
  LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS ON PUS.PROPERTY_KEY  = P.PROPERTY_KEY 
  LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTIES HBAM ON HBAM.HBID = P.HBAM_PROPERTY_ID --*REPLCA DB*
  LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES HBPM ON HBPM.PROPERTYID = P.HBPM_PROPERTY_ID --*REPLCA DB*
  LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PM_AI ON PM_AI.PROPERTYID  = HBPM.PROPERTYID AND PM_AI."_FIVETRAN_DELETED" = 'N' 
  LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY 
  LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY
  LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY
  LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS LM ON LM.DESCRIPTION = PUS.OCCUPANCY_STATUS 
  
  LEFT JOIN (Select DISTINCT Property_Key FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_UNIT_STATUS_HIST PSH) AL  ON AL.Property_key = P.Property_Key
 
  WHERE 1=1
	AND (HBAM.PROPERTYSTATUSID >9 OR HBAM.PROPERTYSTATUSID IS NULL) --out of bid
	AND P.PROPERTY_STATE ='Active'
	AND P.EntityID <> ''
	AND (HBAM.PROPERTYSTATUSID NOT IN (53,75) OR HBAM.PROPERTYSTATUSID IS NULL)
	AND PO.Portfolio_KEY NOT IN (223,598,147,102,109,28,603,169,602,170,58,54)
	AND PUS.Organization_KEY not IN (16,17)
	AND PO.IS_Active_AM = 'Y'
	AND PO.Current_Flag = 'Y'
	AND P.Current_Flag = 'Y'
	AND PU.Current_Flag = 'Y'
	AND PUS.Occupancy_Status NOT IN ('Not Managed')
	AND (HBPM.PROPERTYSTATEID = 26 OR HBPM.PROPERTYSTATEID IS NULL) 
	AND P.HBMM_Property_ID IS NOT NULL
    AND AL.Property_Key is not null )

--Select * from Prop_Hist
--WHERE PropertyId = 47719
--338866
--***************************************************************************

 ,BOM_Status AS (
   Select 
   MAX(Prop_Hist.AuditLogID) AuditLogID
   ,MAX(Prop_Hist_2.AuditLogID) AuditLogID_2
   ,Prop_Calendar.PropertyId
   ,Prop_Calendar.PROP_KEY
   ,Prop_Calendar.EntityId
   ,Prop_Calendar.BEG_OF_MONTH
   From Prop_Calendar
   LEFT JOIN Prop_Hist ON Prop_Hist.PropertyId = Prop_Calendar.PropertyId
   				     AND Prop_Hist.LogDateTime < DATEADD(day,1,Last_day(BEG_OF_MONTH))
   LEFT JOIN Prop_Hist AS Prop_Hist_2 ON Prop_Hist_2.PropertyId = Prop_Calendar.PropertyId
   				     AND Prop_Hist_2.LogDateTime < BEG_OF_MONTH
   
   GROUP BY
   Prop_Calendar.PropertyId
  ,Prop_Calendar.PROP_KEY
  ,Prop_Calendar.EntityId
   ,Prop_Calendar.BEG_OF_MONTH)
   
  -- Select * from BOM_Status
   -- WHERE 
--***************************************************************************
 ,RENT_HIST AS (
 
 SELECT 
 PROPERTY_KEY
 ,FCT_PROP_UNIT_RENT_HIST_KEY
 ,RENT_CHANGED_DATE
 ,RANK() OVER( PARTITION BY PROPERTY_KEY ORDER BY RENT_CHANGED_DATE DESC) CHANGED_RANK
 ,CURRENT_RENT
 
 FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_UNIT_RENT_HIST
 WHERE CURRENT_RENT IS NOT NULL )
--***************************************************************************	
 ,RENT_TEMP AS (
 Select 
   BOM_Status.PropertyId AS HBPM_PropertyID
   ,BOM_Status.PROP_KEY
   ,BOM_Status.EntityId
   ,BOM_Status.BEG_OF_MONTH
   ,MAX(FCT_PROP_UNIT_RENT_HIST_KEY) FCT_PROP_UNIT_RENT_HIST_KEY
    FROM BOM_Status
    LEFT JOIN RENT_HIST ON RENT_HIST.PROPERTY_KEY = BOM_Status.PROP_KEY AND RENT_HIST.RENT_CHANGED_DATE <= DATEADD('day',1,LAST_DAY(BOM_Status.BEG_OF_MONTH,'month'))
    GROUP BY
    BOM_Status.PropertyId 
   ,BOM_Status.PROP_KEY
   ,BOM_Status.EntityId
   ,BOM_Status.BEG_OF_MONTH
 )
--***************************************************************************	 
 Select 
   BOM_Status.PropertyId AS HBPM_PropertyID
   ,BOM_Status.PROP_KEY
   ,BOM_Status.EntityId
   ,BOM_Status.BEG_OF_MONTH
   ,Prop_Hist.AfterValue
   ,Prop_Hist.Occupancy_Status
   ,Prop_Hist_2.AfterValue AS BEG_MONTH_VALUE
   ,Prop_Hist_2.Occupancy_Status AS BEG_MONTH_OCC_STATUS
   
   ,to_Date( DATEADD('day',90,P.FIRST_LEASE_START_DATE_POST_RRQC)) FIRST_LEASE_PLUS_90
   
   ,CASE
   WHEN P.FIRST_LEASE_START_DATE_POST_RRQC IS NULL
   			OR to_Date( DATEADD('day',90,P.FIRST_LEASE_START_DATE_POST_RRQC)) >= LAST_DAY(BOM_Status.BEG_OF_MONTH)
   			THEN NULL
   WHEN GREATEST(BOM_Status.BEG_OF_MONTH, to_Date( DATEADD('day',90,P.FIRST_LEASE_START_DATE_POST_RRQC))) > DATEFROMPARTS(year(GETDATE()),MONTH(GETDATE()),DAY(GETDATE())) THEN NULL
   ELSE DATEDIFF('day',
   				GREATEST(DATEADD('day',91,P.FIRST_LEASE_START_DATE_POST_RRQC),BOM_Status.BEG_OF_MONTH),
   				LEAST(DATEFROMPARTS(year(GETDATE()),MONTH(GETDATE()),DAY(GETDATE())),LAST_DAY(BOM_Status.BEG_OF_MONTH))) + 
   		(CASE WHEN BOM_Status.BEG_OF_MONTH = date_trunc('month',GETDATE()) THEN 1 ELSE 1 END)
   END AS DAYS_POST_90_MTD
  
  ,CASE
   WHEN P.FIRST_LEASE_START_DATE_POST_RRQC IS NULL
   			OR to_Date( DATEADD('day',90,P.FIRST_LEASE_START_DATE_POST_RRQC)) >= LAST_DAY(BOM_Status.BEG_OF_MONTH)
   			THEN NULL
   WHEN GREATEST(BOM_Status.BEG_OF_MONTH, to_Date( DATEADD('day',90,P.FIRST_LEASE_START_DATE_POST_RRQC))) > DATEFROMPARTS(year(GETDATE()),MONTH(GETDATE()),DAY(GETDATE())) THEN NULL
   ELSE DATEDIFF('day',
   				GREATEST(DATEADD('day',91,P.FIRST_LEASE_START_DATE_POST_RRQC),BOM_Status.BEG_OF_MONTH),
   				LAST_DAY(BOM_Status.BEG_OF_MONTH)) + 1
   END AS DAYS_POST_90_FULL
   
   ,to_date(PROPERTY_SOLD_DATE_KEY::TEXT,'yyyymmdd') AS SOLD_DATE
      ,CURRENT_RENT
   
   from BOM_Status
   LEFT JOIN Prop_Hist ON Prop_Hist.PropertyId = BOM_Status.PropertyId AND Prop_Hist.AuditLogId = BOM_Status.AuditLogID
   LEFT JOIN Prop_Hist Prop_Hist_2 ON Prop_Hist_2.PropertyId = BOM_Status.PropertyId AND Prop_Hist_2.AuditLogId = BOM_Status.AuditLogID_2
   
   LEFT JOIN RENT_TEMP ON RENT_TEMP.PROP_KEY = BOM_Status.PROP_KEY AND RENT_TEMP.BEG_OF_MONTH = BOM_Status.BEG_OF_MONTH
   LEFT JOIN RENT_HIST ON RENT_HIST.FCT_PROP_UNIT_RENT_HIST_KEY = RENT_TEMP.FCT_PROP_UNIT_RENT_HIST_KEY
   LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON P.PROPERTY_KEY  = BOM_Status.PROP_KEY
 
   WHERE 1=1
  -- AND BOM_Status.BEG_OF_MONTH = '2023-01-01'
  -- AND BOM_Status.EntityId = 'RP3OK00146'
  -- ORDER BY  DAYS_POST_90_MTD ASC

 --***************************************************************************
   
 --  SELECT * FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_UNIT_STATUS_HIST`;

export const DW_WO_SQL = `/* =============================================================================
   WORK ORDER (WO) DATASET
   -----------------------------------------------------------------------------
   Grain:   One row per ticket / work order (DISTINCT), created on or after
            2025-01-01, enriched with property, vendor, invoice, turn linkage
            (O_TURN_ID), and related prior/next work orders.
   Anchor:  PROD_ANALYTICS.DBT_RESICAP.DIM_TICKET (TI)
   CTE chain: HHI -> DEALS -> TENANT -> Turnkey -> WO_TURN ; WO_DETAIL feeds
              WO_TURN / WO_RELATED / final SELECT.

   CLEANUP NOTES:
     [SYNC]  ORGANIZATION_KEY / ORGANIZATION_NAME CASE blocks updated to mirror
             the master PROPERTY script (source of truth). Originals used the old
             single-group form labeled 'Resicap SFR' (and a 4-key variant in
             Turnkey); corrected to the full six-group roll-up with 'RP SFR'.
             Output-affecting ONLY in WO_DETAIL (see "ORG SYNC IMPACT"); the DEALS,
             TENANT, and Turnkey org columns are computed but never surfaced or
             used downstream, so syncing them is cosmetic / for consistency.
     No dead CTEs: HHI->DEALS->TENANT->Turnkey->WO_TURN and WO_DETAIL all feed
     the final result; nothing was dropped.

   ORG SYNC IMPACT (intended diff vs. original output -- WO_DETAIL org columns):
     Rows for these orgs previously fell through to ELSE; after sync they roll up:
        18,26,28,48          -> -1 / 'RP SFR'   (label change from 'Resicap SFR')
        27,50,51,52,54,45,55,53,56,57,66 -> 27 / 'RB DRC'
        58,59                -> 58 / 'Hudson Oak'
        62,63,64,65,68,69    -> 62 / 'Rocklyn Homes'
        61,70                -> 61 / 'ROI Property Group'
        67                   -> 67 / 'Newstar'
   ============================================================================= */

WITH HHI AS (Select 

D.Deal_ID 
,CASE WHEN sum(C_INC.Annual_Income) <30000 THEN NULL 
	  WHEN  sum(C_INC.Annual_Income) > 1000000 THEN NULL 
	  ELSE  sum(C_INC.Annual_Income) END AS HHI

FROM PROD_REPLICA.HUBSPOT.DEAL D
LEFT JOIN PROD_REPLICA.HUBSPOT.DEAL_CONTACT DC ON DC.DEAL_ID = D.DEAL_ID
LEFT JOIN (SELECT
				CONTACT_ID
				,COALESCE (
					SUM(CASE WHEN NAME = 'total_yearly_income' THEN value ELSE null END),
					SUM(CASE WHEN NAME = 'annual_salary' THEN value ELSE null END)) AS Annual_Income
				FROM PROD_REPLICA.HUBSPOT.COntact_PROPERTY_HISTORY
				
				WHERE 1=1 
				AND NAME IN ('annual_salary','total_yearly_income')
				GROUP BY CONTACT_ID ) C_INC ON C_INC.Contact_ID = DC.Contact_ID
				
WHERE 1=1 
GROUP BY D.DEAL_ID)

---***********************************************************************************************************************
,DEALS AS (SELECT 

 P.PROPERTY_KEY
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
,P.HBPM_PROPERTY_ID 
,P.EntityID
,P.Address
,PUS.Under_written_rent

,REC.RECEIEVABLE_ID
,PO.PORTFOLIO_NAME
,R.REGION_NAME

,D.SECURITY_DEPOSIT_ID
,D.DEAL_KEY
,D.DEAL_ID
,D.CURRENT_DEAL_STATUS
,COALESCE(HHI.HHI,D.COMBINED_INCOME) AS COMBINED_INCOME
,DSH.LEAD_KEY
,to_date(L.Application_SUBMIT_Date_KEY::TEXT,'yyyymmdd') AS Application_Submit_Date
, DATEDIFF(DAY, COALESCE(to_date(L.Application_SUBMIT_Date_KEY::TEXT,'yyyymmdd'),to_date(DSH.DEAL_CREATE_DATE_KEY::TEXT,'yyyymmdd')),GETDATE())  AS DAYS_SINCE_APP_SUBMIT

,L.First_Name ||  ' '  || L.Last_Name AS Lead_Name
,L.PRIMARY_LEAD_ID
,D.EMail
,to_date(L.CREATED_DATE_KEY::TEXT,'yyyymmdd') AS Lead_Created_Date
,DATE_TRUNC('month', to_date(L.CREATED_DATE_KEY::TEXT,'yyyymmdd') ) AS "1_Lead (BOM)"

,to_date(DSH.DEAL_CREATE_DATE_KEY::TEXT,'yyyymmdd') AS DEAL_CREATE_DATE
,to_date(DSH.APPLICATION_APPROVED_DATE_KEY::TEXT,'yyyymmdd') AS APPLICATION_APPROVED_DATE
,to_date(DSH.DEAL_WON_DATE_KEY::TEXT,'yyyymmdd') AS DEAL_WON_DATE
,COALESCE(to_date(PAY.HOLDING_FEE_DATE_NEW::TEXT,'yyyymmdd'),to_date(DSH.HOLDING_FEE_PAID_DATE_KEY::TEXT,'yyyymmdd')) AS HOLDING_FEE_DATE_NEW
,to_date(DSH.LEASE_SIGNED_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_SIGNED_DATE
,to_date(DSH.CONVERT_TO_RESIDENT_DATE_KEY::TEXT,'yyyymmdd') AS CONVERT_TO_RESIDENT_DATE
,to_date(DSH.EXPECTED_MOVE_IN_DATE_KEY::TEXT,'yyyymmdd') AS EXPECTED_MOVE_IN_DATE
,COALESCE(to_date(DSH.LEASE_START_DATE_KEY::TEXT,'yyyymmdd'),
		  to_date(DSH.EXPECTED_MOVE_IN_DATE_KEY::TEXT,'yyyymmdd') ) AS LEASE_START_DATE
,to_date(DSH.LEASE_END_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_END_DATE
,U.USER_KEY
,TLA.Tenant_key
,COALESCE(to_date(TLA.INITIAL_LEASE_FROM_DATE_KEY::TEXT,'yyyymmdd'),
		  to_date(TLA.LEASE_FROM_DATE_KEY::TEXT,'yyyymmdd') ) AS TENANT_MOVE_IN
,COALESCE (HO.FIRST_NAME || ' ' || HO.LAST_NAME ,CO.FIRST_NAME || ' ' || CO.LAST_NAME, 'Billy Mixon') AS DEAL_OWNER
,D.AVERAGE_CREDIT_SCORE
,CO.CONTACT_ID
,L.SOURCE
,'https://app.hubspot.com/contacts/5444448/contact/' || CO.CONTACT_ID AS URL_HUBSPOT

FROM PROD_ANALYTICS.DBT_RESICAP.DIM_DEAL D
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_DEAL_STATUS_ACCUM DSH ON DSH.DEAL_KEY  = D.Deal_Key
LEFT JOIN PROD_REPLICA.HUBSPOT.DEAL HD ON HD.DEAL_ID = D.DEAL_ID
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_LEAD L ON L.LEAD_KEY = DSH.Lead_Key

LEFT JOIN (SELECT
				Deal_ID 
				,Value AS RECEIEVABLE_ID
				FROM PROD_REPLICA.HUBSPOT.DEAL_PROPERTY_HISTORY
				
				WHERE 1=1
				--AND DEAL_ID =8496423848
				AND NAME = 'account_receivable'
				AND _FIVETRAN_ACTIVE = 'Y') REC ON REC.DEAL_ID = D.DEAL_ID	
				
LEFT JOIN (SELECT Charge_DATE_KEY, Property_Key, Receivable_ID, Amount 
			FROM PROD_ANALYTICS.DBT_RESICAP.FCT_LEASING_TRANSACTION
			WHERE 
			TRANSACTION_TYPE = 'Charges' 
			--AND IS_REVERSED = 'N' 
			AND Amount >= 500 
			AND GL_ACCOUNT_KEY IN (18) ) CHG ON CHG.Receivable_ID = TRY_CAST(REC.RECEIEVABLE_ID AS INTEGER)

LEFT JOIN (SELECT
			MIN(RECEIVED_ON_DATE_KEY) AS HOLDING_FEE_DATE_NEW
			,PROPERTY_KEY
			,PAID_BY_USER_KEY
		    ,RECEIVABLE_ID
		    ,TENANT_KEY
			,AMOUNT
			FROM PROD_ANALYTICS.DBT_RESICAP.FCT_LEASING_TRANSACTION
			WHERE 
			TRANSACTION_TYPE = 'Payment' 
			--AND IS_REVERSED = 'N' 
			AND Amount >= 500 -- Weed OUT noise
			AND GL_ACCOUNT_KEY IN (18,-1) -- SD
			GROUP BY
			 PROPERTY_KEY
			 ,PAID_BY_USER_KEY
			,RECEIVABLE_ID
			,TENANT_KEY
			,AMOUNT) PAY ON PAY.Receivable_ID = TRY_CAST(REC.RECEIEVABLE_ID AS INTEGER) AND PAY.Amount = CHG.Amount


LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_USER U ON U.USER_KEY = CASE WHEN DSH.User_key <> -1 THEN DSH.User_key
																	 ELSE Pay.PAID_BY_USER_KEY END
																			 
LEFT JOIN (SELECT TLA.* 
		FROM PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TLA
		LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT T ON T.Tenant_KEY = TLA.Tenant_key
		LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI ON TI.TENANTINFORMATIONID  = T.TENANT_INFORMATION_ID
		WHERE TI._FIVETRAN_DELETED <> 'Y'
		AND RENTDUEDAY IS NOT NULL
		AND T.TENANT_KEY NOT IN (70575)) TLA ON TLA.USER_KEY = U.User_key

LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON 

(CASE WHEN 
		PAY.Property_Key IS NOT NULL 
		OR DSH.PROPERTY_KEY <> -1
		OR TLA.PROPERTY_KEY IS NOT NULL  
	THEN P.PROPERTY_KEY = COALESCE ( PAY.Property_Key,
									CASE WHEN DSH.PROPERTY_KEY <> -1 THEN DSH.PROPERTY_KEY
									ELSE TLA.PROPERTY_KEY END)
									
	ELSE P.Address = LEFT(HD.PROPERTY_ADDRESS,CHARINDEX(',',HD.PROPERTY_ADDRESS)-1) END )
									
									
LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTIES HBAM ON HBAM.HBID = P.HBAM_PROPERTY_ID
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS ON PUS.PROPERTY_KEY  = P.PROPERTY_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY
LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES HBPM ON HBPM.PROPERTYID = P.HBPM_PROPERTY_ID --*REPLCA DB*
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_REGION R ON R.REGION_KEY = PUS.REGION_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY 


LEFT JOIN PROD_REPLICA.HUBSPOT.DEAL_PROPERTY_HISTORY DPH ON DPH.DEAL_ID = D.DEAL_ID AND DPH._FIVETRAN_ACTIVE = 'Y' AND DPH.NAME = 'owner_id'  --HUBSPOT ACTUAL
LEFT JOIN PROD_REPLICA.HUBSPOT.OWNER HO ON HO.OWNER_ID = TRY_CAST(DPH.VALUE AS INTEGER)   
LEFT JOIN HHI ON HHI.Deal_ID = D.Deal_ID

LEFT JOIN (select DISTINCT 
		DC.DEAL_ID, C.ID AS CONTACT_ID, CO.FIRST_NAME, CO.LAST_NAME
		FROM PROD_REPLICA.HUBSPOT.DEAL_CONTACT DC 
		JOIN PROD_REPLICA.HUBSPOT.DEAL D ON D.Deal_ID = DC.DEAL_ID
		JOIN PROD_REPLICA.HUBSPOT.CONTACT C ON C.ID = DC.CONTACT_ID AND C._FIVETRAN_DELETED ='FALSE'
		LEFT JOIN PROD_REPLICA.HUBSPOT.CONTACT_PROPERTY_HISTORY CPH ON CPH.CONTACT_ID = C.ID AND CPH.NAME='hubspot_owner_id' AND CPH._FIVETRAN_ACTIVE = 'Y'
		LEFT JOIN PROD_REPLICA.HUBSPOT.OWNER CO ON CO.OWNER_ID = CPH.VALUE     

		WHERE 1=1
		AND D.PROPERTY_APPLICANT_EMAIL =  C.PROPERTY_EMAIL
		) CO ON CO.DEAL_ID = D.DEAL_ID


WHERE 1=1

AND HD.IS_DELETED <>'Y'
AND P.Property_KEY IS NOT NULL
AND D.Current_Deal_Status IS NOT NULL
AND D.CURRENT_flag = 'Y'
AND L.CURRENT_Flag = 'Y'
AND DSH.LEAD_KEY  IS NOT NULL
--AND L.Application_SUBMIT_Date_KEY IS NOT null
AND (TLA.TENANT_INFORMATION_ID <> 36986 OR TLA.TENANT_INFORMATION_ID IS NULL)


AND (HBAM.PROPERTYSTATUSID >9 OR HBAM.PROPERTYSTATUSID IS NULL) --out of bid
AND P.PROPERTY_STATE ='Active'
AND P.EntityID <> ''
AND (HBAM.PROPERTYSTATUSID NOT IN (53,75) OR HBAM.PROPERTYSTATUSID IS NULL)
AND PO.Portfolio_KEY NOT IN (223,598,147,102,109,28,603,169,602,170,58,54,169)
AND PUS.Organization_KEY not IN (16,17)
AND PO.IS_Active_AM = 'Y'
AND PO.Current_Flag = 'Y'
AND P.Current_Flag = 'Y'
AND PU.Current_Flag = 'Y'
AND PUS.Occupancy_Status NOT IN ('Not Managed')
AND (HBPM.PROPERTYSTATEID = 26 OR HBPM.PROPERTYSTATEID IS NULL) 

--AND DSH.HOLDING_FEE_PAID_DATE_KEY >= 20220201
--AND TLA.Tenant_Key = 4099
--AND D.DEAL_ID = 9265777025
)
--SELECT * FROM Deals
--****************************************************************************************************************
            	
,TENANT AS (
 
SELECT

 T.TENANT_KEY
,T.TENANT_INFORMATION_ID
,TS.USER_KEY
,T.LEASE_ID
,RANK() OVER (PARTITION BY TS.Property_KEY ORDER BY Lease_ID ASC) AS Lease_Rank 
,PU.PROPERTY_UNIT_KEY
,TS.Property_KEY
,P.HBPM_PROPERTY_ID
,PO.Portfolio_Name
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
,P.Address
,P.EntityID
,PUS.Occupancy_Status

,U.FULL_NAME
,U.USER_STATUS
,U.EMAIL_ADDRESS
,U.PHONE_NUMBER
,T.TENANT_STATUS
,T.TENANT_TYPE
,T.PRIMARY_TENANT
,T.EVICTION_STATUS
,T.VEHICLES
,T.PETS
,T.MONTH_TO_MONTH
,T.LEASE_TERM
,to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd') AS NOTICE_DATE
,TLA.INITIAL_RENT_AMOUNT
,T.CURRENT_RENT
,Deals.HOLDING_FEE_DATE_NEW AS "HOLDING_FEE_DATE_NEW"
,to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd') AS CURRENT_LEASE_EXPIRATION_DATE
,to_date(TLA.LEASE_SIGNED_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_SIGNED_DATE
,to_date(TLA.LEASE_FROM_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_FROM_DATE
,to_date(TLA.LEASE_TO_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_TO_DATE

,to_date(T.DOB_DATE_KEY::TEXT,'yyyymmdd') AS DOB
,CASE WHEN COALESCE(RESI_TSUM.AVERAGE_CREDIT_SCORE, PM_D.AVERAGECREDITSCORE, DEALS.AVERAGE_CREDIT_SCORE) > 850 THEN NULL 
 ELSE COALESCE(RESI_TSUM.AVERAGE_CREDIT_SCORE, PM_D.AVERAGECREDITSCORE, DEALS.AVERAGE_CREDIT_SCORE)  END AS AVERAGE_CREDIT_SCORE
,COALESCE(RESI_TSUM.COMBINED_INCOME,PM_D.COMBINEDINCOME,DEALS.COMBINED_INCOME) COMBINEDINCOME
,RESI_TSUM.NUMBER_OF_CHILDREN
,RESI_TSUM.OCCUPANTS
,RESI_TSUM.TENANT_AGE
,RESI_TSUM.MONTHLY_INCOME
,RESI_TSUM.IS_RETIRED
,RESI_TSUM.IS_NOTICE
,RESI_TSUM.IS_UNDER_EVICTION
,HUB_PETS.PETS AS "PETS_AMOUNT"

,TI.MoveIn
,TI.MoveOut
,TI.PurchaseLetterPostedDate
,TI.DateNotified
,TI.FiledWithCountyDate
,TI.ResidentServedDate
,TI.CourtDateSetDate
,TI.JudgementDate
,TI.LockoutScheduledDate
,TI.VacateDate
,TI.AnticipatedMoveOutDate
,TI.IsSection8
,TI.IsMonthtoMonthLease
,TI.TenantDecidedMonthtoMonth
,TI.DoNotRenew
,TI.ReasonForNotRenewingId
,DNR.DESCRIPTION AS REASONFORNOTRENEWINGNAME
,PUS.Under_written_rent
,AM_PM.MoveInReady
,'https://honeybadgerpm.com/ReportingModule/ViewReport?reportId=1807&UnitId='||TI.UnitID||'&UserId='||TI.UserID||'#/' AS URL_SODA
,CASE WHEN TI.MoveOut IS NULL THEN NULL WHEN TI.MoveOutComplte = 'Y' THEN 'Yes' ELSE 'No' END AS MoveOutComplete


FROM PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT T
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_ACTIVITY TS ON TS.TENANT_KEY = T.TENANT_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TLA ON TLA.TENANT_KEY = T.Tenant_Key
LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI ON TI.TenantInformationId = T.TENANT_INFORMATION_ID
LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS DNR on DNR.LookUpMasterId = TI.ReasonForNotRenewingId
LEFT JOIN PROD_REPLICA.HBPM_DBO.DEALS PM_D ON PM_D.LEADUSERID = TI.USERID AND PM_D.UNITID =TI.UNITID AND PM_D.SECURITYDEPOSITID IS NOT null
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_USER U ON U.USER_KEY = TS.USER_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON P.PROPERTY_KEY = TS.PROPERTY_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS ON PUS.PROPERTY_KEY  = P.PROPERTY_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_LEAD L ON L.lead_key = TS.LEAD_KEY 
LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTIES HBAM ON HBAM.HBID = P.HBAM_PROPERTY_ID --*REPLCA DB*
LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTYMANAGEMENTS AM_PM ON AM_PM.PROPERTYMANAGEMENTID = HBAM.PropertyManagement_PropertyManagementId AND AM_PM.HBID = HBAM.HBID

LEFT JOIN DEALS ON Deals.User_key = TS.USER_KEY AND Deals.Current_Deal_Status = 'Deal Won' AND Deals.PRoperty_key = P.Property_key AND Deals.SECURITY_DEPOSIT_ID IS NOT null
			
LEFT JOIN (SELECT C.ID, COUNT(PET.ID) PETS
			FROM PROD_REPLICA.HUBSPOT.PET 
			LEFT JOIN PROD_REPLICA.HUBSPOT.PET_TO_CONTACT PTC ON PTC.FROM_ID = PET.ID
			LEFT JOIN PROD_REPLICA.HUBSPOT.CONTACT C ON C.ID = PTC.TO_ID 
			GROUP BY C.ID) HUB_PETS ON HUB_PETS.ID = L.LEAD_ID
	
LEFT JOIN (SELECT 
			FCT_TENANT_SUMMARY_KEY 
			,TENANT_INFORMATION_ID 
			,AVERAGE_CREDIT_SCORE
			,R_TS.COMBINED_INCOME
			,NUMBER_OF_CHILDREN
			,OCCUPANTS
			,TENANT_AGE
			,MONTHLY_INCOME
			,IS_RETIRED
			,IS_NOTICE
			,IS_UNDER_EVICTION
			FROM PROD_ANALYTICS.RESICAP.FCT_TENANT_SUMMARY R_TS
			LEFT JOIN PROD_ANALYTICS.RESICAP.DIM_TENANT R_T ON R_T.TENANT_KEY = R_TS.TENANT_KEY ) RESI_TSUM ON RESI_TSUM.TENANT_INFORMATION_ID = T.TENANT_INFORMATION_ID
						
WHERE 1=1
AND T.CURRENT_FLAG = 'Y'
AND T.PRIMARY_TENANT = 'Y'

AND P.PROPERTY_STATE ='Active'
AND P.EntityID <> ''
AND TI._FIVETRAN_DELETED <> 'Y'
AND RENTDUEDAY IS NOT NULL
--AND (PS.PROPERTY_STATUS_ID NOT IN (53,75) OR PS.PROPERTY_STATUS_ID IS NULL)
AND PO.Portfolio_KEY NOT IN (223,598,147,102,109,28,603,169,602,170,58,54,169)
AND P.Organization_KEY not IN (16,17)
AND PO.IS_Active_AM = 'Y'
AND PO.Current_Flag = 'Y'
AND P.Current_Flag = 'Y'
AND PU.Current_Flag = 'Y'
AND PUS.Occupancy_Status NOT IN ('Property SOLD','Not Managed')
AND T.TENANT_KEY NOT IN (70575) )

--SELECT * FROM Tenant
--**************************************************************************************        

,Turnkey AS (
 SELECT 
 --DISTINCT 
 Tenant.Lease_ID AS O_TURN_ID
,Tenant.Lease_Rank AS  O_Lease_Rank
,Tenant.Tenant_KEY AS O_Tenant_KEY

,Tenant.PROPERTY_UNIT_KEY
,Tenant.Property_KEY
,Tenant.HBPM_Property_Id
,Tenant.Portfolio_Name
,Tenant.Address
,Tenant.EntityID
,Tenant.Occupancy_Status
,Tenant.FULL_NAME AS Tenant_Full_Name
,Tenant.EMAIL_ADDRESS AS Tenant_Email_Address
,Tenant.PHONE_NUMBER AS  Tenant_Phone_Number
,Tenant.TENANT_STATUS AS Tenant_Status

,Tenant.CURRENT_RENT AS O_Current_Rent
,Tenant.HOLDING_FEE_DATE_NEW AS O_HOLDING_FEE_DATE
,Tenant.LEASE_FROM_DATE AS O_LEASE_FROM_DATE
,Tenant.LEASE_TO_DATE AS O_LEASE_TO_DATE
,Tenant.NOTICE_DATE AS O_Notice_Date
,Tenant.MoveOut AS O_Move_Out

,Tenant_New.Lease_ID AS N_TURN_ID
,Tenant_New.Lease_Rank AS  N_Lease_Rank
,COALESCE(Tenant_New.INITIAL_RENT_AMOUNT,Tenant_New.CURRENT_RENT) AS N_Initial_Rent
,Tenant_New.CURRENT_RENT AS N_Current_Rent
,Tenant_New.HOLDING_FEE_DATE_NEW AS N_HOLDING_FEE_DATE
,Tenant_New.LEASE_FROM_DATE AS N_LEASE_FROM_DATE
,Tenant_New.LEASE_TO_DATE AS N_LEASE_TO_DATE
,Tenant_New.MoveOut AS N_Move_Out
,CASE
        WHEN Tenant.ORGANIZATION_KEY IN (-1,18,26,28,48)                   THEN -1
        WHEN Tenant.ORGANIZATION_KEY IN (27,50,51,52,54,45,55,53,56,57,66) THEN 27
        WHEN Tenant.ORGANIZATION_KEY IN (58,59)                            THEN 58
        WHEN Tenant.ORGANIZATION_KEY IN (62,63,64,65,68,69)                THEN 62
        WHEN Tenant.ORGANIZATION_KEY IN (61,70)                            THEN 61
        WHEN Tenant.ORGANIZATION_KEY IN (67)                               THEN 67
        ELSE Tenant.ORGANIZATION_KEY
     END AS ORGANIZATION_KEY
,CASE
        WHEN Tenant.ORGANIZATION_KEY IN (-1,18,26,28,48)                   THEN 'RP SFR'
        WHEN Tenant.ORGANIZATION_KEY IN (27,50,51,52,54,45,55,53,56,57,66) THEN 'RB DRC'
        WHEN Tenant.ORGANIZATION_KEY IN (58,59)                            THEN 'Hudson Oak'
        WHEN Tenant.ORGANIZATION_KEY IN (62,63,64,65,68,69)                THEN 'Rocklyn Homes'
        WHEN Tenant.ORGANIZATION_KEY IN (61,70)                            THEN 'ROI Property Group'
        WHEN Tenant.ORGANIZATION_KEY IN (67)                               THEN 'Newstar'
        ELSE Tenant.ORGANIZATION_NAME
     END AS ORGANIZATION_NAME
,Tenant.MoveInReady
,Tenant.URL_SODA
,Tenant.MoveOutComplete


FROM Tenant
LEFT JOIN Tenant AS Tenant_New ON TENANT_NEW.Property_Key = TENANT.Property_Key AND (TENANT_NEW.Lease_Rank = TENANT .Lease_Rank +1)
WHERE 1=1
AND Tenant.MoveOut IS NOT NULL
AND Tenant.Occupancy_Status <> 'Dispositions')

--SELECT * FROM Turnkey

--**************************************************************************************
,WO_DETAIL AS (
SELECT 

TI.TICKET_KEY
,TI.TICKET_ID
,WO.WORKORDER_KEY
,TI.TICKET_TYPE
,COALESCE(TI.TICKET_TYPE, 'Maintenance') AS TICKET_TYPE_CLOSED
,TI.TICKET_STATUS
,WO.WORKORDER_ID
,COALESCE(WO.MAINT_ID,TI.ID_KEY) AS MAINT_ID
,WO.HBH_ID_KEY
 
,CASE WHEN COALESCE(WO.WORKORDER_STATUS,TI.TICKET_STATUS) = 'WO Accepted' AND to_date(INSP_START_DATE_KEY ::TEXT,'yyyymmdd') IS NULL THEN 'WO Accepted (TBD)'
      WHEN COALESCE(WO.WORKORDER_STATUS,TI.TICKET_STATUS) = 'WO Accepted' AND to_date(INSP_START_DATE_KEY ::TEXT,'yyyymmdd') < DATEADD(D, -1, GETDATE()) THEN 'WO Accepted (Past Due)'
      WHEN COALESCE(WO.WORKORDER_STATUS,TI.TICKET_STATUS) = 'WO Accepted' THEN 'WO Accepted (Scheduled)'

      WHEN COALESCE(WO.WORKORDER_STATUS,TI.TICKET_STATUS) = 'WO Pending Completion' AND to_date(WO_END_DATE_KEY ::TEXT,'yyyymmdd') IS NULL THEN 'WO Pending Completion (TBD)'
      WHEN COALESCE(WO.WORKORDER_STATUS,TI.TICKET_STATUS) = 'WO Pending Completion' AND to_date(WO_END_DATE_KEY::TEXT,'yyyymmdd') < DATEADD(D, -1, GETDATE()) THEN 'WO Pending Completion (Past Due)'
      WHEN COALESCE(WO.WORKORDER_STATUS,TI.TICKET_STATUS) = 'WO Pending Completion' THEN 'WO Pending Completion (Scheduled)'
      ELSE COALESCE(WO.WORKORDER_STATUS,TI.TICKET_STATUS) 
      END AS WORKORDER_STATUS

,COALESCE(WO.PRIORITY,TI.PRIORITY) AS PRIORITY
,WO.BILL_TO

,P.Property_Key
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
,PO.Portfolio_Name
,P.EntityId
,COALESCE(DRC.DRC_CO_DATE,P.RRQC_PASS_DATE) AS RRQC_PASS_DATE_MM
,P.FIRST_LEASE_START_DATE_POST_RRQC
,CASE WHEN 
	to_date(TI.CREATED_DATE_KEY::TEXT,'YYYYMMDD') >= DATEADD(DAY,90,P.FIRST_LEASE_START_DATE_POST_RRQC)
	AND P.FIRST_LEASE_START_DATE_POST_RRQC IS NOT NULL
	AND PUS.Occupancy_Status <> 'Dispositions'
	AND TI.TICKET_TYPE <> 'Dispositions'
	AND COALESCE(TI.TICKET_TYPE, 'Maintenance') NOT IN ('PPI','Turnkey','Evictions')
	AND WO.BILL_TO = 'Owner'
	AND (WO.INSURANCE_CLAIM = 'N' OR WO.INSURANCE_CLAIM IS NULL)
	THEN 1 	ELSE 0 	END AS ONGOING_90_DAY_SPEND

,P.Address
,R.Region_ID
,R.Region_Name

--,WOST.TENANT_USER_KEY
,WOST.VENDOR_KEY
,V.VENDOR_ID
,V.COMPANY_NAME
,V.IS_W2_VENDOR
,V.IS_INTERNAL_VENDOR
,CASE WHEN V.CURRENT_VENDOR_STAGE = 'Compliant' THEN 'Active' ELSE V.CURRENT_VENDOR_STAGE END AS "CURRENT_VENDOR_STAGE"
,V.VENDOR_STANDING
,V.EMAIL_ADDRESS AS VENDOR_EMAIL
,V.PHONE_NUMBER AS VENDOR_PHONE
,WO.MAINT_APPROVED
,COALESCE(WO.MANAGED_BY,TI.MANAGED_BY) AS MANAGED_BY

,WO.APPROVED_BY_OWNER
,WO.SENT_FOR_OWNER_APPROVAL
,WO.EST_APPROVED_BY_OWNER
,WO.NOTE_IS_OWNER
,to_date(WO.NOTE_CREATED_DATE_KEY::TEXT,'YYYYMMDD') AS NOTE_CREATED_DATE
,WO.NOTE_TEXT
,WO.INSURANCE_CLAIM

,WO.APPROVAL_NOTE
,WO.APPROVAL_STATUS
,WO.APPROVER_NAME	
,to_date(WO.APPROVAL_DATE_KEY::TEXT,'YYYYMMDD') AS OA_APPROVAL_DATE
,CONVERT_TIMEZONE('EST', WO.APPROVED_DATE::timestamp) APPROVED_DATE

,to_date(TI.CREATED_DATE_KEY::TEXT,'YYYYMMDD') AS TICKET_CREATED_DATE
,to_date(WO.CREATED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_CREATED_DATE
,to_date(WO.MODIFIED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_MODIFIED_DATE
,to_date(WOST.WO_REQUESTED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_REQUESTED_DATE
,to_date(WOST.WO_ACCEPTED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_ACCEPTED_DATE
,to_date(INSP_START_DATE_KEY ::TEXT,'yyyymmdd') AS INSP_START_DATE
,CASE WHEN COALESCE(WO.WORKORDER_STATUS,TI.TICKET_STATUS) = 'WO Accepted'
      AND (to_date(INSP_START_DATE_KEY ::TEXT,'yyyymmdd') IS NULL OR to_date(INSP_START_DATE_KEY ::TEXT,'yyyymmdd') < DATEADD(D, -1, GETDATE()) )
      THEN 1
      ELSE 0 
      END AS INSPECTION_START_FLAG
,to_date(WOST.WO_ESTIMATED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_ESTIMATED_DATE
,to_date(WOST.WO_AWAITING_OWNER_APPROVAL_DATE_KEY::TEXT,'YYYYMMDD') AS WO_AWAITING_OWNER_APPROVAL_DATE
,to_date(WO.SENT_FOR_OWNER_APVL_DATE_KEY::TEXT,'YYYYMMDD') AS SENT_FOR_OWNER_APVL_DATE
,to_date(WOST.WO_OWNER_APPROVAL_DATE_KEY::TEXT,'YYYYMMDD') AS WO_OWNER_APPROVAL_DATE
,to_date(WOST.WO_PENDING_COMPLETION_DATE_KEY::TEXT,'YYYYMMDD') AS WO_PENDING_COMPLETION_DATE
,to_date(WO_START_DATE_KEY::TEXT,'YYYYMMDD') AS WO_START_DATE
,to_date(WO_END_DATE_KEY::TEXT,'YYYYMMDD') AS WO_END_DATE
,CASE WHEN COALESCE(WO.WORKORDER_STATUS,TI.TICKET_STATUS) = 'WO Pending Completion'
      AND (to_date(WO_END_DATE_KEY ::TEXT,'yyyymmdd') IS NULL OR to_date(WO_END_DATE_KEY::TEXT,'yyyymmdd') < DATEADD(D, -1, GETDATE()) )
      THEN 1
      ELSE 0 
      END AS COMPLETION_END_FLAG

,CONVERT_TIMEZONE('EST', DBT_WOI.CLIENT_INVOICE_TIME::timestamp) AS CLIENT_INVOICE_DATE
,COALESCE (to_date(DBT_WOI.VENDOR_INVOICE_DATE_KEY::TEXT,'YYYYMMDD'), to_date(WOST.WO_CLOSED_DATE_KEY::TEXT,'YYYYMMDD') ,to_date(TI.MODIFIED_DATE_KEY::TEXT,'YYYYMMDD'))  AS VENDOR_INVOICE_DATE
,to_date(WOST.WO_COMPLETED_AWAITING_APPROVAL_DATE_KEY::TEXT,'YYYYMMDD') AS WO_COMPLETED_AWAITING_APPROVAL_DATE
,to_date(WOST.WO_UNBILLED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_UNBILLED_DATE
,COALESCE(to_date(WOST.WO_CLOSED_DATE_KEY::TEXT,'YYYYMMDD'),to_date(WOST.WO_CANCELLED_DATE_KEY::TEXT,'YYYYMMDD')) AS WO_CLOSED_DATE
,to_date(WOST.WO_CANCELLED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_CANCELLED_DATE

,DBT_WOI.CLIENT_INVOICE_NO
,DBT_WOI.CLIENT_MATERIAL_CHARGE
,DBT_WOI.CLIENT_HOURLY_LABOR_CHARGE
,DBT_WOI.CLIENT_FLAT_LABOR_CHARGE
,CASE WHEN WO.WORKORDER_STATUS ='Closed' THEN ZEROIFNULL(DBT_WOI.CLIENT_INVOICE_AMOUNT) ELSE DBT_WOI.CLIENT_INVOICE_AMOUNT END AS CLIENT_INVOICE_AMOUNT
,EST.CLIENT_ESTIMATE 
,DBT_WOI.VENDOR_MATERIAL_CHARGE
,DBT_WOI.VENDOR_HOURLY_LABOR_CHARGE
,DBT_WOI.VENDOR_FLAT_LABOR_CHARGE
,DBT_WOI.VENDOR_INVOICE_AMOUNT
,DBT_WOI.VENDOR_INVOICE_NO
,DBT_WOI.CLIENT_INVOICE_AMOUNT - DBT_WOI.VENDOR_INVOICE_AMOUNT AS "Invoice_Profit"

,C.CategoryID
,COALESCE(WO.CATEGORY_NAME,C.CATEGORYNAME,TI.TICKET_CATEGORY) AS CATEGORYNAME
,COALESCE(WO.WO_PROBLEM,MCD.WO_PROBLEM,TI.CATEGORY_DESCRIPTION) AS WO_PROBLEM

,CASE WHEN COALESCE(WO.CATEGORY_NAME,C.CATEGORYNAME,TI.TICKET_CATEGORY) IN ('(Plumber (Licensed)', 'Plumbing - Minor Repairs')
      AND (CONTAINS(COALESCE(MCD.WO_PROBLEM,TI.CATEGORY_DESCRIPTION),'clog')
        OR  CONTAINS(COALESCE(MCD.WO_PROBLEM,TI.CATEGORY_DESCRIPTION),'clog')
        OR  CONTAINS(COALESCE(MCD.WO_PROBLEM,TI.CATEGORY_DESCRIPTION),'stopped')
        OR  CONTAINS(COALESCE(MCD.WO_PROBLEM,TI.CATEGORY_DESCRIPTION),'drain')
        OR  CONTAINS(COALESCE(MCD.WO_PROBLEM,TI.CATEGORY_DESCRIPTION),'garbage')
        OR  CONTAINS(COALESCE(MCD.WO_PROBLEM,TI.CATEGORY_DESCRIPTION),'back')
        OR  CONTAINS(COALESCE(MCD.WO_PROBLEM,TI.CATEGORY_DESCRIPTION),'overflow') )
      AND WO.BILL_TO = 'Owner'
      AND PUS.OCCUPANCY_STATUS = 'Tenant Leased'
      THEN 'Yes'
      ELSE NULL 
      END AS Tenant_Bill_Back_Review

      
,COALESCE(WO.WO_SOLUTION,MCD.WO_Solution) WO_Solution
,CASE WHEN WO.Maint_ID IS NOT NULL THEN 'https://honeybadgermm.com/Maintenance#/CreateWorkOrder/' || WO.Maint_ID 
	  ELSE 'https://honeybadgermm.com/Maintenance#/EditTicket/' || TI.ID_KEY END AS HBMM_URL
,'https://vendor.honeybadgermm.com/Home#/VenWODetails/' || WO.Maint_ID AS HBVM_URL

,DATE_TRUNC('month',COALESCE (to_date(CONVERT_TIMEZONE('EST', DBT_WOI.CLIENT_INVOICE_TIME::timestamp)),
                              to_date(WOST.WO_CLOSED_DATE_KEY::TEXT,'YYYYMMDD'),
                              to_date(WOST.WO_CANCELLED_DATE_KEY::TEXT,'YYYYMMDD'),
                              to_date(WO.MODIFIED_DATE_KEY::TEXT,'YYYYMMDD'),
                              to_date(TI.MODIFIED_DATE_KEY::TEXT,'YYYYMMDD'))) AS "1_Invoice (BOM)"

,CASE WHEN WO.WORKORDER_STATUS = 'Cancelled' OR TI.TICKET_STATUS = 'Cancelled' THEN NULL
      WHEN COALESCE (to_date(DBT_WOI.VENDOR_INVOICE_DATE_KEY::TEXT,'YYYYMMDD'),
                    to_date(WOST.WO_CLOSED_DATE_KEY::TEXT,'YYYYMMDD')) IS NOT NULL THEN 
                    DATEDIFF(DAY,to_date(TI.CREATED_DATE_KEY::TEXT,'YYYYMMDD'),COALESCE (to_date(DBT_WOI.VENDOR_INVOICE_DATE_KEY::TEXT,'YYYYMMDD'), to_date(WOST.WO_CLOSED_DATE_KEY::TEXT,'YYYYMMDD')))
                    
      WHEN WO.WORKORDER_STATUS = 'Closed' AND COALESCE (to_date(DBT_WOI.VENDOR_INVOICE_DATE_KEY::TEXT,'YYYYMMDD'), to_date(WOST.WO_CLOSED_DATE_KEY::TEXT,'YYYYMMDD')) IS NULL THEN NULL 
      --WHEN WO.WORKORDER_ID IS NULL THEN  NULL
      ELSE DATEDIFF(DAY,to_date(TI.CREATED_DATE_KEY::TEXT,'YYYYMMDD'),GETDATE())
      END AS "1_DIQ/CycleTime"

 ,CASE WHEN V.VENDOR_KEY IN (33018,33014,32987,33019,196,32555,906,1274,1929) THEN 'Warranty Vendor' ELSE 'External Vendor' END AS Warranty
 ,CASE WHEN V.VENDOR_KEY IN (33018,33014,32987,33019,196,32555,906,1274,1929) THEN V.Company_Name ELSE NULL END AS Warranty_Vendor_Name
,DATEDIFF('day',COALESCE(LAST_STATUS.LAST_CHANGED_DATE,to_date(TI.CREATED_DATE_KEY::TEXT,'YYYYMMDD')),GETDATE()) AS DIQ
,COALESCE(CASE WHEN WO.WORKORDER_STATUS ='Closed' THEN ZEROIFNULL(DBT_WOI.CLIENT_INVOICE_AMOUNT) ELSE DBT_WOI.CLIENT_INVOICE_AMOUNT END
,EST.CLIENT_ESTIMATE) AS "1_Client Amount (Est/Inv)"

,MM_MASTER."NoteText" AS WO_NOTE_TEXT
,MM_MASTER."Note Created Date" AS WO_NOTE_CREATED_DATE
,MM_MASTER."NoteAddedBy" AS WO_NOTE_ADDED_BY
,MM_MASTER."Note Added By Email" AS WO_NOTE_ADDED_BY_EMAIL
,CASE WHEN MM_MASTER."Note Added By Email" LIKE '%@resi%' THEN 'Y' ELSE 'N' END AS WO_NOTE_IS_INTERNAL

,MM_MASTER."Owner_Notes" AS WO_NOTE_OWNER
,MM_MASTER."Owner_Note_CreatedDate" AS WO_NOTE_OWNER_CREATED_DATE
,MM_MASTER."Owner Note Added By" AS WO_NOTE_OWNER_ADDED_BY
,MM_MASTER."Owner Note Added By Email" AS WO_NOTE_OWNER_ADDED_BY_EMAIL
,CASE WHEN MM_MASTER."Owner Note Added By Email" LIKE '%@resi%' THEN 'Y' ELSE 'N' END AS WO__OWNER_NOTE_IS_INTERNAL

,CASE WHEN TI.TICKET_TYPE IN ('Turnkey','Evictions', 'Trespassers/Vandalism') 
      OR C.CATEGORYNAME = 'Unit Turns (Paint/Clean/Minor Repairs)' THEN 1 ELSE NULL 
      END AS IS_TURN

,CASE WHEN WO.WORKORDER_STATUS = 'Closed' THEN NULL
      WHEN (DATEDIFF('day',
      
   COALESCE(
   GREATEST(
    CASE WHEN MM_MASTER."Note Added By Email" LIKE '%@resi%' 
         THEN MM_MASTER."Note Created Date" 
         ELSE to_date(TI.CREATED_DATE_KEY::TEXT,'YYYYMMDD')
    END,
    
    CASE WHEN MM_MASTER."Owner Note Added By Email" LIKE '%@resi%' 
         THEN MM_MASTER."Owner_Note_CreatedDate" 
         ELSE to_date(TI.CREATED_DATE_KEY::TEXT,'YYYYMMDD') 
    END), to_date(TI.CREATED_DATE_KEY::TEXT,'YYYYMMDD'))
    ,GETDATE()) > 5 
          AND DATEDIFF(DAY,to_date(TI.CREATED_DATE_KEY::TEXT,'YYYYMMDD'),GETDATE()) > 5)
          OR (DATEDIFF(DAY,to_date(TI.CREATED_DATE_KEY::TEXT,'YYYYMMDD'),GETDATE()) > 5
          AND MM_MASTER."Note Created Date" IS NULL
          AND MM_MASTER."Owner_Note_CreatedDate" IS NULL)
          THEN '>5 No Notes'
      END AS NOTE_FLAG
      
,BA.PurchaseType AS "Purchase_Type_ID"
,CASE 
		WHEN BA.PurchaseType = 1 THEN 'Foreclosure'
		WHEN BA.PurchaseType = 2 THEN 'MLS'
		WHEN BA.PurchaseType = 3 THEN 'Off-Market'
		WHEN BA.PurchaseType = 4 THEN 'Bulk'
		WHEN BA.PurchaseType = 5 THEN 'Deed in Lieu'
		WHEN BA.PurchaseType = 6 THEN 'I-Buyer'
		WHEN BA.PurchaseType = 7 THEN 'Non-Foreclosure'
		WHEN BA.PurchaseType = 8 THEN 'New Construction'
		ELSE Null	
END AS "Purchase Type"   
,to_date(P.PURCHASE_DATE_KEY::TEXT,'yyyymmdd') AS "Purchase_Date"

,CASE WHEN PUS.Occupancy_Status = 'Trustee Lease Honored' THEN 'Trustee Leased' 
	      WHEN PUS.Property_Status = 'Tenant Lease' AND PUS.Occupancy_Status = 'Vacant - Future Move In' THEN 'Tenant Leased'
	      ELSE PUS.Occupancy_Status END AS Occupancy_Status
	      
,WO.NOTE_BILL_TO

,CASE WHEN ((DBT_WOI.CLIENT_OWNER_RESPONSIBLE_AMOUNT = DBT_WOI.CLIENT_TENANT_RESPONSIBLE_AMOUNT AND DBT_WOI.CLIENT_TENANT_RESPONSIBLE_AMOUNT =  DBT_WOI.CLIENT_CONSTRUCTION_RESPONSIBLE_AMOUNT)
	  OR( DBT_WOI.CLIENT_OWNER_RESPONSIBLE_AMOUNT IS NOT NULL AND DBT_WOI.CLIENT_TENANT_RESPONSIBLE_AMOUNT IS NOT NULL AND DBT_WOI.CLIENT_CONSTRUCTION_RESPONSIBLE_AMOUNT IS NOT NULL))
	  AND WO.BILL_TO = 'Owner'
	  THEN  COALESCE(DBT_WOI.CLIENT_INVOICE_AMOUNT,0)
	  ELSE 0 END AS CLIENT_OWNER_RESPONSIBLE_AMOUNT

,CASE WHEN ((DBT_WOI.CLIENT_OWNER_RESPONSIBLE_AMOUNT = DBT_WOI.CLIENT_TENANT_RESPONSIBLE_AMOUNT AND DBT_WOI.CLIENT_TENANT_RESPONSIBLE_AMOUNT =  DBT_WOI.CLIENT_CONSTRUCTION_RESPONSIBLE_AMOUNT)
	  OR( DBT_WOI.CLIENT_OWNER_RESPONSIBLE_AMOUNT IS NOT NULL AND DBT_WOI.CLIENT_TENANT_RESPONSIBLE_AMOUNT IS NOT NULL AND DBT_WOI.CLIENT_CONSTRUCTION_RESPONSIBLE_AMOUNT IS NOT NULL))
	  AND WO.BILL_TO = 'Tenant'
	  THEN   COALESCE(DBT_WOI.CLIENT_INVOICE_AMOUNT,0)
	  ELSE 0 END AS CLIENT_TENANT_RESPONSIBLE_AMOUNT
	  
,CASE WHEN ((DBT_WOI.CLIENT_OWNER_RESPONSIBLE_AMOUNT = DBT_WOI.CLIENT_TENANT_RESPONSIBLE_AMOUNT AND DBT_WOI.CLIENT_TENANT_RESPONSIBLE_AMOUNT =  DBT_WOI.CLIENT_CONSTRUCTION_RESPONSIBLE_AMOUNT)
	  OR( DBT_WOI.CLIENT_OWNER_RESPONSIBLE_AMOUNT IS NOT NULL AND DBT_WOI.CLIENT_TENANT_RESPONSIBLE_AMOUNT IS NOT NULL AND DBT_WOI.CLIENT_CONSTRUCTION_RESPONSIBLE_AMOUNT IS NOT NULL))
	  AND WO.BILL_TO = 'Construction'
	  THEN   COALESCE(DBT_WOI.CLIENT_INVOICE_AMOUNT,0)
	  ELSE 0 END AS CLIENT_CONSTRUCTION_RESPONSIBLE_AMOUNT
	  
    ,TU.FULL_NAME AS TEN_FULL_NAME
	,TU.EMAIL_ADDRESS AS TEN_EMAIL
    ,TU.PHONE_NUMBER AS TEN_PHONE
    ,CASE WHEN PUS.OCCUPANCY_STATUS ='Tenant Leased' THEN TIN.MOVEIN ELSE NULL END AS "1_MI_Date"
    ,CASE WHEN PUS.OCCUPANCY_STATUS ='Tenant Leased' THEN DATEDIFF(DAY,TIN.MOVEIN,GETDATE()) ELSE NULL END AS "1_Days_Since_MI"

FROM PROD_ANALYTICS.DBT_RESICAP.DIM_TICKET TI
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TICKET_STATUS_ACCUM TSA ON TSA.TICKET_KEY  = TI.TICKET_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_WO_STATUS_ACCUM WOST ON WOST.TICKET_KEY  = TI.TICKET_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_WORKORDER WO ON WO.WORKORDER_KEY = WOST.WORKORDER_KEY AND WO.CURRENT_FLAG = 'Y'
LEFT JOIN PROD_ANALYTICS.BI_MASTER_DATASETS.MASTER_MM_WORKORDER MM_MASTER ON MM_MASTER."IDKey" = COALESCE(WO.MAINT_ID,TI.ID_KEY)

LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_VENDOR V ON V.VENDOR_KEY = WOST.VENDOR_KEY

LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_WO_INVOICE DBT_WOI ON DBT_WOI.WORKORDER_KEY  = WO.WorkORder_key
LEFT JOIN (SELECT 
				WORKORDER_KEY AS DBT_WO_KEY
				,SUM (MARKUP_AMOUNT) AS CLIENT_ESTIMATE
				FROM PROD_ANALYTICS.DBT_RESICAP.FCT_WO_ESTIMATED_MATERIAL
				GROUP BY WORKORDER_KEY ) EST ON EST.DBT_WO_KEY = WOST.WORKORDER_KEY
				

LEFT JOIN (SELECT 
				Min(MaintenanceCategoryDetailId) AS MaintenanceCategoryDetailID
				,MIN(CategoryDescription) AS WO_Problem
				,MIN(VENDORNOTES) AS WO_Solution
				,MaintenanceIDKey
                FROM PROD_REPLICA.HBMM_DBO.MAINTENANCECATEGORYDETAILS 
                --WHERE MaintenanceIDKey = 668614
				GROUP BY MaintenanceIDKey) MCD on MCD.MaintenanceIdkey = WO.MAINT_ID 
				
LEFT JOIN (SELECT 
WORKORDER_KEY
,MAX(CHANGED_DATE) LAST_CHANGED_DATE
FROM PROD_ANALYTICS.DBT_RESICAP.FCT_WO_STATUS_HIST
GROUP BY WORKORDER_KEY) LAST_STATUS ON LAST_STATUS.WORKORDER_KEY = WO.WORKORDER_KEY

LEFT JOIN PROD_REPLICA.HBMM_DBO.MaintenanceCategoryDetails on MaintenanceCategoryDetails.MaintenanceCategoryDetailId = MCD.MaintenanceCategoryDetailID
LEFT JOIN PROD_REPLICA.HBMM_DBO.MaintenanceCategories C on C.CategoryId = MaintenanceCategoryDetails.CategoryId
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON P.PROPERTY_KEY = TSA.PROPERTY_KEY AND P.CURRENT_FLAG ='Y'
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS ON PUS.PROPERTY_KEY = P.PROPERTY_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_REGION R ON R.REGION_KEY = PUS.REGION_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY 

LEFT JOIN (SELECT
			MAX(T.Lease_ID) LEASE_ID
			,TLA.Property_key
			FROM PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT T
			LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TLA ON TLA.TENANT_KEY = T.Tenant_Key
			LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI ON TI.TENANTINFORMATIONID = T.Tenant_Information_id
			WHERE 1=1
			AND PRIMARY_TENANT ='Y' 
			AND CURRENT_FLAG ='Y'
			AND TI._FIVETRAN_DELETED = 'N'
			AND TENANT_STATUS <> 'Past'
			AND RENT_DUE_DAY IS NOT NULL
		    AND TLA.FCT_TENANT_LEASING_ACCUM_KEY NOT IN (70474)
			--AND TLA.PROPERTY_KEY = 243368
			--AND TENANT_PORTAL_ACTIVATE_ID = 'Y'
			GROUP BY TLA.Property_key ) DIM_TENANT_CLEAN ON DIM_TENANT_CLEAN.PROPERTY_KEY = P.PROPERTY_KEY
			
	--/*		
	LEFT JOIN (SELECT T.* FROM
					PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT T
					LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI ON TI.TENANTINFORMATIONID = T.Tenant_Information_id
					WHERE TI.PRIMARYTENANT = 'Y') TEN
	ON TEN.LEASE_ID = DIM_TENANT_CLEAN.LEASE_ID
			AND TEN.PRIMARY_TENANT ='Y' 
			AND TEN.CURRENT_FLAG ='Y'
			AND TEN.RENT_DUE_DAY IS NOT NULL
		--	AND TEN.TENANT_KEY NOT IN (70575)
	
			
	LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TLA ON TLA.TENANT_KEY = TEN.TENANT_KEY AND TLA.FCT_TENANT_LEASING_ACCUM_KEY NOT IN (70474)
	LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_USER TU ON TU.USER_KEY = TLA.USER_KEY
	LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TIN ON TIN.TenantInformationId = TEN.TENANT_INFORMATION_ID AND TIN._FIVETRAN_DELETED <> 'Y'

LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTIES HBAM ON HBAM.HBID = P.HBAM_PROPERTY_ID --*REPLCA DB*
LEFT JOIN PROD_REPLICA.HBAM_DBO.BidAndAuctions BA ON BA.BIDID = HBAM.BidAndAuction_BidId AND BA.HBID = HBAM.HBID AND BA."_FIVETRAN_DELETED" <> 'Y'


LEFT JOIN (SELECT 
				ASSETNUM AS ENTITYID
				,"8_CABINETS_INTERIOR_TRIM" AS CABINETS_PRELEASE_DATE
				,"14_QC_2" AS QC_TRIGGER_DATE
				,"116_CO_ISSUED_DATE" AS DRC_CO_DATE
			from PROD_REPLICA.RESIBUILT_MALLEO_RESIBUILTMALLEO.POWERBI_STAGE
			WHERE "_FIVETRAN_DELETED" = 'N' ) DRC ON DRC.EntityID = P.EntityID

WHERE 1=1 

AND (TI.TICKET_STATUS <> 'Cancelled' OR (TI.TICKET_STATUS = 'Cancelled' AND WO.WORKORDER_KEY IS NOT NULL))
--AND (WO.WORKORDER_STATUS <> 'Cancelled' OR WO.WORKORDER_STATUS IS NULL)
--AND ((TI.TICKET_STATUS = 'Closed' AND WO.WORKORDER_KEY IS NOT NULL)
--	OR (TI.TICKET_STATUS = 'Open' AND WO.WORKORDER_KEY IS NOT NULL )
--	OR (TI.TICKET_STATUS <> 'Closed' AND TI.TICKET_STATUS <> 'Open') 
--	)
		
AND TI.CREATED_DATE_KEY > '20220101'
--AND WO.WORKORDER_STATUS = 'New'
AND P.PROPERTY_STATE ='Active'
AND P.EntityID <> ''
--AND (PS.PROPERTY_STATUS_ID NOT IN (53,75) OR PS.PROPERTY_STATUS_ID IS NULL)
AND PO.Portfolio_KEY NOT IN (1845, 2210, 2207, 2218, 1952,1867, 1916,1852,1771,1919,1873)
AND P.Organization_KEY not IN (16,17)
AND PO.IS_Active_AM = 'Y'
AND PO.Current_Flag = 'Y'
AND P.Current_Flag = 'Y'
AND PU.Current_Flag = 'Y'
AND PUS.Occupancy_Status NOT IN ('Property SOLD','Not Managed')
)

--**************************************************************************************
,WO_TURN AS (
SELECT 
WO_DETAIL.TICKET_KEY
,WO_DETAIL.WORKORDER_KEY
,MIN(Turnkey.O_TURN_ID) O_Turn_ID
--,*

FROM WO_DETAIL
LEFT JOIN Turnkey ON Turnkey.Property_key = WO_DETAIL.Property_key

WHERE 1=1
AND (TICKET_TYPE = 'Turnkey' OR CategoryName = 'Unit Turns (Paint/Clean/Minor Repairs)')
AND TICKET_CREATED_DATE >= to_date(COALESCE(O_Notice_Date,Turnkey.O_MOVE_OUT)::TEXT,'AUTO')
AND (TICKET_CREATED_DATE <= Turnkey.N_LEASE_FROM_DATE OR N_LEASE_FROM_DATE IS NULL)
--AND  WO_DETAIL.TICKET_KEY = 477640

GROUP BY 
WO_DETAIL.TICKET_KEY
,WO_DETAIL.WORKORDER_KEY)
--**************************************************************************************
,WO_RELATED AS (

SELECT 
WO_DETAIL.MAINT_ID
,MAX(WOD2.WORKORDER_KEY) AS WO_PREV
,MIN(WOD3.WORKORDER_KEY) AS WO_NEXT

FROM WO_DETAIL
LEFT JOIN WO_DETAIL WOD2 ON WOD2.PROPERTY_KEY = WO_DETAIL.PROPERTY_KEY 
                            AND WOD2.CategoryID = WO_DETAIL.CategoryID
                            AND WOD2.WORKORDER_STATUS  <> 'Cancelled'
                            AND WOD2.TICKET_STATUS <> 'Cancelled'
                            AND WOD2.TICKET_CREATED_DATE >= DATEADD('day',-30,WO_DETAIL.TICKET_CREATED_DATE)
                            AND WOD2.TICKET_CREATED_DATE < WO_DETAIL.TICKET_CREATED_DATE
                            AND WOD2.MAINT_ID <> WO_DETAIL.MAINT_ID

LEFT JOIN WO_DETAIL WOD3 ON WOD3.PROPERTY_KEY = WO_DETAIL.PROPERTY_KEY 
                            AND WOD3.CategoryID = WO_DETAIL.CategoryID
                            AND WOD3.WORKORDER_STATUS  <> 'Cancelled'
                            AND WOD3.TICKET_STATUS <> 'Cancelled'
                            AND WOD3.TICKET_CREATED_DATE <= DATEADD('day',30,WO_DETAIL.TICKET_CREATED_DATE)
                            AND WOD3.TICKET_CREATED_DATE > WO_DETAIL.TICKET_CREATED_DATE
                            AND WOD3.MAINT_ID <> WO_DETAIL.MAINT_ID
                            
                            
GROUP BY WO_DETAIL.MAINT_ID)

--SELECT * FROM WO_RELATED
--**************************************************************************************

SELECT DISTINCT
WO_DETAIL.*
,WO_TURN.O_TURN_ID
,WO_RELATED.WO_PREV
,WO_RELATED.WO_NEXT

FROM WO_DETAIL
LEFT JOIN WO_TURN 
				ON WO_TURN.TICKET_KEY = WO_DETAIL.TICKET_KEY
				AND (CASE WHEN WO_TURN.WORKORDER_KEY IS NOT NULL
					THEN WO_TURN.WORKORDER_KEY = WO_DETAIL.WORKORDER_KEY
					ELSE 1=1 END)
					
LEFT JOIN WO_RELATED ON WO_RELATED.MAINT_ID = WO_DETAIL.MAINT_ID

WHERE 1=1
AND WO_DETAIL.TICKET_CREATED_DATE >= '1/1/2025'`;

export const DW_TURNS_SQL = `/* =============================================================================
   TURNS DATASET
   -----------------------------------------------------------------------------
   Grain:   One row per turn (anchored on Turnkey.O_Turn_ID), combining tenant
            move-out/move-in pairing, HappyCo scope & QC inspections, turn work
            orders, listings, and move-out charge/receipt reconciliation.
   Anchor:  Turnkey CTE (built from TENANT self-join old->new lease).
   Large CTE chain: CollectionsNote, PICS, CLEAN_ITEM/UNIT/INSPECTION,
            HAPPY_CO_DETAIL/SCOPE/QC, RESIWALK_INS/ANSWER_AGG/SCOPE/QC, UW_RENT,
            HHI, DEALS, TENANT, HAPPY_CO_TURN, Turnkey, Turn_Listings, MoveOut*,
            BadDebt, WO_DETAIL, WO_TURN, TURN_WO_SUMMARY -> final SELECT.

   CLEANUP NOTES:
     [SYNC]  ORGANIZATION_KEY / ORGANIZATION_NAME CASE blocks in DEALS, TENANT,
             Turnkey, and WO_DETAIL updated from the prior two-group form
             (-1.. -> 'RP SFR', 27.. -> 'RB DRC') to the full six-group roll-up
             that mirrors the master PROPERTY script (source of truth).
             DELIBERATE OUTPUT CHANGE limited to the organization columns.
     No CTEs or joins dropped: every CTE feeds the final result (directly or via
     Turnkey / WO_TURN / TURN_WO_SUMMARY). The commented-out legacy HHI HubSpot
     block and the commented-out RESI_TSUM join are preserved exactly as found.

   [RESIWALK ADD] HAPPY_CO_SCOPE and HAPPY_CO_QC now UNION ALL in ResiWalk
     (HubSpot-native) inspections so Turn data uses BOTH sources:
        - RESIWALK_SCOPE: template pm_scope_rate_card -> '(PM) Scope Inspection'
        - RESIWALK_QC:    template pm_turn_reinspect_qc -> '(PM) Turn Inspection'
     Property link: INSPECTION.PROPERTY_ENTITY_ID -> DIM_PROPERTY.ENTITYID (1:1).
     Status filter: ResiWalk native lowercase 'completed'.
     ISSUE_COUNT mapped from rate_card_line answer count (each scoped line = an
     identified deficiency), mirroring HappyCo's HC_*_ISSUE_COUNT.
     HC_SCOPE_REPORT_STATUS has no ResiWalk analog -> NULL.
     HC_TURN_REPORT_STATUS read from the inspection-object result field
     (inspection_result) and standardized to the HappyCo vocabulary:
        'pass' -> 'Pass', 'fail' -> 'Fail', anything else/blank -> NULL.
     The result column is referenced dynamically via GET(OBJECT_CONSTRUCT(HI.*),..)
     so the query COMPILES before Fivetran adds the column to the replica (no
     completed Turn/QC inspections have populated it yet); it resolves to NULL
     today and maps live Pass/Fail values automatically once the field syncs.
     As of build: 12 completed Scope inspections (live), 0 completed Turn/QC
     inspections (QC leg is forward-compatible plumbing, 0 rows today).
   ============================================================================= */

WITH CollectionsNote AS (
		SELECT DISTINCT 
	 	N.NOTEID AS LatestNoteID
	 	,N.NOTETEXT AS CollectionNote
	 	,N.CREATEDDATE  AS CollectionNoteCreated
	 	,DATEDIFF('Day',N.CREATEDDATE,GETDATE()) CollectionNote_Days
	    ,P.PropertyId
	    ,TI.UserID
	    ,U.FIRSTNAME || ' ' || U.LASTNAME AS CollectionNote_Added_By
	    ,RANK() OVER( PARTITION BY TI.UserID ORDER BY N.CREATEDDATE DESC) AS Recent_Rank
	
		FROM PROD_REPLICA.HBPM_DBO.NOTES N 
		LEFT JOIN PROD_REPLICA.HBPM_DBO.NOTETYPES NT ON NT.Id = N.NoteTypeId
		LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS LM ON LM.LookUpMasterId = N.ObjectTypeId
		LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI ON TI.UserID = N.ObjectId AND N.ObjectTypeId = 502 AND TI."_FIVETRAN_DELETED" = 'N'
		LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PAI ON PAI.UnitId = TI.UnitId AND PAI."_FIVETRAN_DELETED" ='N'
		LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES P ON P.PropertyID = COALESCE(PAI.PropertyId, N.ObjectID) AND P."_FIVETRAN_DELETED" ='N'
		LEFT JOIN PROD_REPLICA.HBPM_DBO.USERS U ON U.USERID  = N.ADDEDBY 
	 	WHERE N.NoteTypeId = 3
	 --	AND PAI.PROPERTYID = 36301
	 	QUALIFY Recent_Rank = 1)

--****************************************************************************
,PICS AS (
 SELECT
  MAX(PHOTO_COUNT) AS Picture_Count
  ,TRY_TO_NUMERIC(UNIT_) AS PM_PropertyID
  FROM "PROD_REPLICA"."RENTLY"."_3_0_DATA"
  WHERE 1=1
  AND TRY_TO_NUMERIC(UNIT_) IS NOT NULL
  GROUP BY UNIT_
)

--****************************************************************************

,CLEAN_ITEM AS (

SELECT 
  ITEM._MODIFIED
 ,ITEM.ID AS ITEM_ID
 ,ITEM.SECTION AS  ITEM_Section
 ,ITEM.ITEM  AS ITEM_Item
 ,ITEM.RATINGS AS  ITEM_Ratings
 ,ITEM.NOTES  AS  ITEM_Notes
 ,ITEM.INSPECTION_ID
 ,RANK() OVER( PARTITION BY ITEM.INSPECTION_ID ORDER BY DATE_TRUNC('min',_FIVETRAN_SYNCED)  DESC) UPDATE_RANK
 ,RANK() OVER( PARTITION BY ITEM_SECTION, ITEM_ITEM, ITEM.INSPECTION_ID ORDER BY DATE_TRUNC('min',_MODIFIED)  DESC) RECENT_RANK
FROM PROD_REPLICA.HAPPYCO_NEW.ITEM_2025 ITEM
)
--AND ITEM_SECTION = 'Report Status' )


,CLEAN_UNIT_PRE AS (
 SELECT 
   UNIT._MODIFIED
  ,UNIT.ID AS UNIT_ID
  ,UNIT.EXTERNAL_ID AS UNIT_EXTERNAL_ID 
  ,UNIT.ADDRESS AS UNIT_ADDRESS
  ,UNIT.LINE_1 AS UNIT_LINE_1
  ,RANK() OVER( PARTITION BY ID ORDER BY DATE_TRUNC('min',_MODIFIED) DESC) RECENT_RANK
FROM PROD_REPLICA.HAPPY_CO.UNIT)

,CLEAN_UNIT AS (
 SELECT DISTINCT
  CLEAN_UNIT_PRE.*
  ,COALESCE (P1.PROPERTY_KEY,P2.PROPERTY_KEY,P3.PROPERTY_KEY,P4.PROPERTY_KEY ) AS PROPERTY_KEY
  ,P1.PROPERTY_KEY P1
  ,P2.PROPERTY_KEY P2
  ,P3.PROPERTY_KEY P3
  ,P4.PROPERTY_KEY  P4
 FROM CLEAN_UNIT_PRE
  LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P1 ON TO_CHAR(P1.HBAM_PROPERTY_ID) = CLEAN_UNIT_PRE.UNIT_EXTERNAL_ID AND P1.CURRENT_FLAG = 'Y' AND P1.PROPERTY_STATE = 'Active' AND P1.PROPERTY_STATUS <> 'Property Sold'
  LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P2 ON  P2.ENTITYID = CLEAN_UNIT_PRE.UNIT_EXTERNAL_ID  AND P2.CURRENT_FLAG = 'Y' AND P2.PROPERTY_STATE = 'Active' AND P2.PROPERTY_STATUS <> 'Property Sold'
  LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P3 ON  INITCAP(TRIM(P3.ADDRESS))  = INITCAP(TRIM(CLEAN_UNIT_PRE.UNIT_LINE_1))  AND P3.CURRENT_FLAG = 'Y' AND P3.PROPERTY_STATE = 'Active' AND P3.PROPERTY_STATUS <> 'Property Sold'
  LEFT JOIN (SELECT LEFT(INITCAP(TRIM(ADDRESS)),9) ADD_TRIM, MAX(PROPERTY_KEY) PROPERTY_KEY
             FROM PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY
             WHERE CURRENT_FLAG = 'Y' AND PROPERTY_STATE = 'Active' AND PROPERTY_STATUS <> 'Property Sold'
             GROUP BY LEFT(INITCAP(TRIM(ADDRESS)),9) ) P4
  	         ON  ADD_TRIM  = LEFT(INITCAP(TRIM(COALESCE(CLEAN_UNIT_PRE.UNIT_LINE_1,UNIT_ADDRESS))),9) 

  WHERE CLEAN_UNIT_PRE.RECENT_RANK = 1)
 
 
,CLEAN_INPSECTION AS (
 SELECT
  INS._MODIFIED
  ,INS._LINE
 ,INS.INSPECTION_ID
 ,INS.INSPECTION_INSPECTOR_NAME
 ,INS.INSPECTION_COMPLETED_DATE
 ,INS.INSPECTION_STATUS
 ,CASE WHEN INS.INSPECTION_TEMPLATE = '(QC) Turn RRQC Inspection' THEN '(QC) Turn Inspection'
      ELSE  INS.INSPECTION_TEMPLATE END AS INSPECTION_TEMPLATE
 ,INS.INSPECTION_LINK
 ,INS.UNIT_ID
 ,RANK() OVER( PARTITION BY INS.INSPECTION_ID ORDER BY DATE_TRUNC('min',_MODIFIED) DESC) RECENT_RANK
FROM PROD_REPLICA.HAPPY_CO.INSPECTION INS
WHERE INSPECTION_ID NOT IN ('wAS8twd-A-rGt','Qqzpo2d-A-3c2')
)
------------------------------------------------

,HAPPY_CO_DETAIL AS (
SELECT DISTINCT 

 CLEAN_UNIT.PROPERTY_KEY
,CLEAN_UNIT.UNIT_ID
,CLEAN_UNIT.UNIT_EXTERNAL_ID
,CLEAN_UNIT.UNIT_Address
,CLEAN_UNIT.UNIT_LINE_1
,RANK() OVER(PARTITION BY CLEAN_UNIT.PROPERTY_KEY, CLEAN_INPSECTION.INSPECTION_TEMPLATE ORDER BY CLEAN_INPSECTION.INSPECTION_COMPLETED_DATE DESC, CLEAN_INPSECTION.INSPECTION_ID DESC) RECENT_INS_RANK
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
,CASE WHEN CLEAN_ITEM.ITEM_Section = 'Report Status' AND CLEAN_ITEM.ITEM_ITEM = 'Pass/Fail' THEN 1 ELSE 0 END AS Report_Status
,CASE WHEN CLEAN_ITEM.ITEM_ITEM = 'Deficiencies corrected from Scope' THEN 1 ELSE 0 END AS TURN_LINE
,CASE WHEN CLEAN_ITEM.ITEM_Section = 'Pre Leasing Status' THEN 1 ELSE 0 END AS PreLease_Status

FROM CLEAN_INPSECTION 
LEFT JOIN CLEAN_ITEM ON CLEAN_ITEM.INSPECTION_ID = CLEAN_INPSECTION.INSPECTION_ID AND CLEAN_ITEM.RECENT_RANK = 1 AND CLEAN_ITEM.UPDATE_RANK = 1 
LEFT JOIN CLEAN_UNIT ON CLEAN_UNIT.UNIT_ID = CLEAN_INPSECTION.UNIT_ID AND CLEAN_UNIT.RECENT_RANK = 1

WHERE 1=1
AND CLEAN_INPSECTION.RECENT_RANK = 1 
AND CLEAN_INPSECTION.INSPECTION_STATUS = 'Complete'
--AND CLEAN_INPSECTION.INSPECTION_TEMPLATE LIKE '%(QC)%'
--AND CLEAN_INPSECTION.INSPECTION_TEMPLATE NOT LIKE '%(PM)%') OR CLEAN_INPSECTION.INSPECTION_TEMPLATE = '(PM) Pre Move-Out')
--AND CLEAN_INPSECTION.INSPECTION_TEMPLATE LIKE '%(PM) (QC) - Vacancy & Security Check%'
AND CLEAN_ITEM.ITEM_SECTION IS NOT NULL
)

--SELECT * FROM HAPPY_CO_DETAIL
--WHERE Property_key = 46390

-----------------------------------------------------------------------------------------------
-- [RESIWALK ADD] ResiWalk (HubSpot-native) inspection rows, header-level.
-- PROPERTY_ENTITY_ID -> DIM_PROPERTY.ENTITYID (clean 1:1). inspection_result
-- read dynamically (column not yet in replica) and standardized to HappyCo
-- Pass/Fail vocabulary.
,RESIWALK_INS AS (
 SELECT
  HI.ID AS INSPECTION_ID
 ,P.PROPERTY_KEY
 ,COALESCE(HI.PROPERTY_LINK_MASTER, HI.PROPERTY_PDF_MASTER_URL) AS INSPECTION_LINK
 ,HI.PROPERTY_COMPLETED_AT::DATE AS INSPECTION_COMPLETED_DATE
 ,HI.PROPERTY_TEMPLATE_TYPE
 -- Standardize ResiWalk inspection_result ('pass'/'fail') to the HappyCo
 -- HC_TURN_REPORT_STATUS vocabulary ('Pass'/'Fail'), which drives the downstream
 -- PASS_MINOR + TKT_*_Fail logic. Dynamic GET() reference so the query compiles
 -- before Fivetran adds the column to the replica (no completed Turn/QC inspections
 -- have populated it yet); resolves to NULL today, maps live values once it syncs.
 ,CASE LOWER(TRIM(GET(OBJECT_CONSTRUCT(HI.*), 'PROPERTY_INSPECTION_RESULT')::TEXT))
    WHEN 'pass' THEN 'Pass'
    WHEN 'fail' THEN 'Fail'
    ELSE NULL
  END AS INSPECTION_RESULT_STD
 FROM PROD_REPLICA.HUBSPOT_2.INSPECTION HI
 LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON P.ENTITYID = HI.PROPERTY_ENTITY_ID AND P.CURRENT_FLAG = 'Y'
 WHERE (HI._FIVETRAN_DELETED = FALSE OR HI._FIVETRAN_DELETED IS NULL)
 AND HI.PROPERTY_TEMPLATE_TYPE IN ('pm_scope_rate_card','pm_turn_reinspect_qc')
 AND LOWER(HI.PROPERTY_STATUS) = 'completed'
 AND P.PROPERTY_KEY IS NOT NULL
)

,RESIWALK_ANSWER_AGG AS (
 SELECT
  ATI.TO_ID AS INSPECTION_ID
 ,COUNT(CASE WHEN A.PROPERTY_ANSWER_TYPE = 'rate_card_line' THEN 1 END) AS RATE_CARD_LINE_COUNT
 FROM PROD_REPLICA.HUBSPOT_2.INSPECTION_ANSWER_TO_INSPECTION ATI
 JOIN PROD_REPLICA.HUBSPOT_2.INSPECTION_ANSWER A ON A.ID = ATI.FROM_ID
   AND (A._FIVETRAN_DELETED = FALSE OR A._FIVETRAN_DELETED IS NULL)
 GROUP BY ATI.TO_ID
)

-- Mirrors HAPPY_CO_SCOPE output columns exactly (for UNION ALL below).
,RESIWALK_SCOPE AS (
 SELECT
  R.PROPERTY_KEY
 ,R.INSPECTION_LINK AS HC_SCOPE_INSPECTION_LINK
 ,R.INSPECTION_COMPLETED_DATE AS HC_SCOPE_COMPLETED_DATE
 ,CAST(NULL AS TEXT) AS HC_SCOPE_REPORT_STATUS
 ,AGG.RATE_CARD_LINE_COUNT AS HC_SCOPE_ISSUE_COUNT
 ,RANK() OVER( PARTITION BY R.PROPERTY_KEY, R.INSPECTION_COMPLETED_DATE ORDER BY R.INSPECTION_LINK DESC) AS Recent_Rank
 FROM RESIWALK_INS R
 LEFT JOIN RESIWALK_ANSWER_AGG AGG ON AGG.INSPECTION_ID = R.INSPECTION_ID
 WHERE R.PROPERTY_TEMPLATE_TYPE = 'pm_scope_rate_card'
)

-- Mirrors HAPPY_CO_QC output columns exactly (for UNION ALL below).
,RESIWALK_QC AS (
 SELECT
  R.PROPERTY_KEY
 ,R.INSPECTION_LINK AS HC_TURN_INSPECTION_LINK
 ,R.INSPECTION_COMPLETED_DATE AS HC_TURN_COMPLETED_DATE
 ,R.INSPECTION_RESULT_STD AS HC_TURN_REPORT_STATUS
 ,AGG.RATE_CARD_LINE_COUNT AS HC_TURN_ISSUE_COUNT
 ,RANK() OVER( PARTITION BY R.PROPERTY_KEY, R.INSPECTION_COMPLETED_DATE ORDER BY R.INSPECTION_LINK DESC) AS Recent_Rank
 FROM RESIWALK_INS R
 LEFT JOIN RESIWALK_ANSWER_AGG AGG ON AGG.INSPECTION_ID = R.INSPECTION_ID
 WHERE R.PROPERTY_TEMPLATE_TYPE = 'pm_turn_reinspect_qc'
)

-----------------------------------------------------------------------------------------------
,HAPPY_CO_SCOPE AS (

SELECT 
 HCD.PROPERTY_KEY
,HCD.INSPECTION_LINK AS HC_SCOPE_INSPECTION_LINK
,HCD.INSPECTION_COMPLETED_DATE AS  HC_SCOPE_COMPLETED_DATE
,MAX(CASE WHEN Report_Status = 1 THEN ITEM_Ratings ELSE NULL END) AS HC_SCOPE_REPORT_STATUS
,SUM(CASE WHEN ITEM_Ratings = 'Issue' THEN 1 ELSE NULL END) AS HC_SCOPE_ISSUE_COUNT
,RANK() OVER( PARTITION BY HCD.PROPERTY_KEY, HCD.INSPECTION_COMPLETED_DATE ORDER BY HC_SCOPE_INSPECTION_LINK DESC) AS Recent_Rank

FROM HAPPY_CO_DETAIL HCD
WHERE 1=1
--AND HCD.RECENT_INS_RANK = 1
AND ITEM_SECTION <> 'Locks'
--AND HCD.INSPECTION_TEMPLATE IN ('(QC) Scope Inspection','(PM) Scope Inspection','(PM) Squatter Scope')
AND HCD.INSPECTION_TEMPLATE IN ('(QC) Scope Inspection','(PM) Scope Inspection','(PM) Scope Inspection (BI FIX ONLY)','(PM) Squatter Scope')
--AND HCD.Property_key =234243

GROUP BY
 HCD.PROPERTY_KEY
,HCD.INSPECTION_LINK
,HCD.INSPECTION_COMPLETED_DATE
--QUALIFY Recent_Rank = 1

UNION ALL

SELECT
 PROPERTY_KEY
,HC_SCOPE_INSPECTION_LINK
,HC_SCOPE_COMPLETED_DATE
,HC_SCOPE_REPORT_STATUS
,HC_SCOPE_ISSUE_COUNT
,Recent_Rank
FROM RESIWALK_SCOPE

)
-----------------------------------------------------------------------------------------------
,HAPPY_CO_QC AS (

SELECT 
 HCD.PROPERTY_KEY
,HCD.INSPECTION_LINK AS HC_TURN_INSPECTION_LINK
,HCD.INSPECTION_COMPLETED_DATE  AS  HC_TURN_COMPLETED_DATE
,MAX(CASE WHEN Report_Status = 1  THEN ITEM_Ratings ELSE NULL END) AS HC_TURN_REPORT_STATUS
,SUM(CASE WHEN CONTAINS(ITEM_Ratings,'No') AND TURN_LINE = 1 THEN 1 ELSE NULL END) AS HC_TURN_ISSUE_COUNT
,RANK() OVER( PARTITION BY HCD.PROPERTY_KEY, HCD.INSPECTION_COMPLETED_DATE ORDER BY HCD.INSPECTION_LINK DESC) AS Recent_Rank

FROM HAPPY_CO_DETAIL HCD
WHERE 1=1
--AND HCD.RECENT_INS_RANK = 1
AND ITEM_SECTION <> 'Locks'
AND (HCD.INSPECTION_TEMPLATE LIKE '(QC) Turn Inspection%'
    OR HCD.INSPECTION_TEMPLATE LIKE '(PM) Turn Inspection%')
--AND HCD.Property_key =251448
    
GROUP BY
 HCD.PROPERTY_KEY
,HCD.INSPECTION_LINK
,HCD.INSPECTION_COMPLETED_DATE
--QUALIFY Recent_Rank = 1

UNION ALL

SELECT
 PROPERTY_KEY
,HC_TURN_INSPECTION_LINK
,HC_TURN_COMPLETED_DATE
,HC_TURN_REPORT_STATUS
,HC_TURN_ISSUE_COUNT
,Recent_Rank
FROM RESIWALK_QC

)


-----------------------------------------------------------------------------------------------
-----------------------------------------------------------------------------------------------
,UW_RENT_MAX AS (
	SELECT 
	MAX(RENTLOGID) RENTLOGID 
	, ENTITYID1
	FROM PROD_REPLICA.HBPM_DBO.RENTLOGS
	GROUP BY ENTITYID1) 
	
,UW_RENT AS (
	SELECT 
	 RentLogs.ENTITYID1 AS HBPM_UnitID
	,RentLogs.ORIGINALVALUE AS UW_Rent_Prior
	,RentLogs.UPDATEVALUE AS UW_Rent_Current
	,RentLogs.OCCUREDON  AS UW_Update_Date
	FROM UW_RENT_MAX
	LEFT JOIN PROD_REPLICA.HBPM_DBO.RENTLOGS RentLogs ON RentLogs.RENTLOGID = UW_RENT_MAX.RentLogID)

-----------------------------------------------------------------------------------------------
,HHI AS (
/*Select 

D.Deal_ID 
,CASE WHEN sum(C_INC.Annual_Income) <30000 THEN NULL 
	  WHEN  sum(C_INC.Annual_Income) > 1000000 THEN NULL 
	  ELSE  sum(C_INC.Annual_Income) END AS HHI

FROM PROD_REPLICA.HUBSPOT.DEAL D
LEFT JOIN PROD_REPLICA.HUBSPOT.DEAL_CONTACT DC ON DC.DEAL_ID = D.DEAL_ID
LEFT JOIN (SELECT
				CONTACT_ID
				,COALESCE (
					SUM(CASE WHEN NAME = 'total_yearly_income' THEN value ELSE null END),
					SUM(CASE WHEN NAME = 'annual_salary' THEN value ELSE null END)) AS Annual_Income
				FROM PROD_REPLICA.HUBSPOT.COntact_PROPERTY_HISTORY
				
				WHERE 1=1 
				AND NAME IN ('annual_salary','total_yearly_income')
				GROUP BY CONTACT_ID ) C_INC ON C_INC.Contact_ID = DC.Contact_ID
				
WHERE 1=1 
GROUP BY D.DEAL_ID*/

SELECT dd.DEAL_KEY 
,CASE 
	WHEN dl.TOTAL_YEARLY_INCOME <30000 THEN NULL  
	WHEN dl.TOTAL_YEARLY_INCOME > 1000000 THEN NULL 
	ELSE dl.TOTAL_YEARLY_INCOME
END AS HHI
FROM PROD_ANALYTICS.DBT_RESICAP.FCT_DEAL_STATUS_ACCUM f_deal
JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_DEAL dd 
	ON f_deal.DEAL_KEY = dd.DEAL_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_LEAD dl 
	ON f_deal.LEAD_KEY = dl.LEAD_KEY 
)

---***********************************************************************************************************************
,DEALS AS (SELECT 

P.PROPERTY_KEY
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
,P.HBPM_PROPERTY_ID 
,P.EntityID
,P.Address
,PUS.Under_written_rent

,REC.RECEIEVABLE_ID
,PO.PORTFOLIO_NAME
,R.REGION_NAME

,D.SECURITY_DEPOSIT_ID
,D.DEAL_KEY
,D.DEAL_ID
,COALESCE(D.CURRENT_DEAL_STATUS,HUB_DEAL.DEAL_STAGE) AS CURRENT_DEAL_STATUS
,HUB_DEAL.APP_ID
,HUB_DEAL.APP_STAGE AS APP_STAGE

,D.COMBINED_INCOME * 12  AS COMBINED_INCOME
,DSH.LEAD_KEY
,D.APPLICATION_SUBMITTED_DATE::date AS Application_Submit_Date
,date_trunc('month',D.APPLICATION_SUBMITTED_DATE::date) as "App Submit (BOM)"
,CONVERT_TIMEZONE('EST', APPLICATION_STARTED_DATE::date) AS Application_Started_Date
,date_trunc('month',CONVERT_TIMEZONE('EST', APPLICATION_STARTED_DATE )::date) as App_Started_BOM

,DATEDIFF(DAY, COALESCE(D.APPLICATION_SUBMITTED_DATE ,to_date(L.Application_SUBMIT_Date_KEY::TEXT,'yyyymmdd'),to_date(DSH.DEAL_CREATE_DATE_KEY::TEXT,'yyyymmdd')),GETDATE())  AS DAYS_SINCE_APP_SUBMIT

,L.First_Name ||  ' '  || L.Last_Name AS Lead_Name
,L.PRIMARY_LEAD_ID
,D.EMail
,L.PHONE
,to_date(L.CREATED_DATE_KEY::TEXT,'yyyymmdd') AS Lead_Created_Date
,DATE_TRUNC('month', to_date(L.CREATED_DATE_KEY::TEXT,'yyyymmdd') ) AS "1_Lead (BOM)"

,to_date(DSH.DEAL_CREATE_DATE_KEY::TEXT,'yyyymmdd') AS DEAL_CREATE_DATE
,to_date(DSH.APPLICATION_APPROVED_DATE_KEY::TEXT,'yyyymmdd') AS APPLICATION_APPROVED_DATE
,to_date(DSH.DEAL_WON_DATE_KEY::TEXT,'yyyymmdd') AS DEAL_WON_DATE
,COALESCE(HUB_DEAL.PROPERTY_HOLDING_FEE_TRANSACTION_DATE,to_date(PAY.HOLDING_FEE_DATE_NEW::TEXT,'yyyymmdd'),to_date(DSH.HOLDING_FEE_PAID_DATE_KEY::TEXT,'yyyymmdd')) AS HOLDING_FEE_DATE_NEW
,to_date(DSH.LEASE_SIGNED_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_SIGNED_DATE
,to_date(DSH.CONVERT_TO_RESIDENT_DATE_KEY::TEXT,'yyyymmdd') AS CONVERT_TO_RESIDENT_DATE
,to_date(DSH.EXPECTED_MOVE_IN_DATE_KEY::TEXT,'yyyymmdd') AS EXPECTED_MOVE_IN_DATE
,COALESCE(to_date(DSH.LEASE_START_DATE_KEY::TEXT,'yyyymmdd'),
		  to_date(DSH.EXPECTED_MOVE_IN_DATE_KEY::TEXT,'yyyymmdd') ) AS LEASE_START_DATE
,to_date(DSH.LEASE_END_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_END_DATE
,U.USER_KEY
,TLA.Tenant_key
,COALESCE(to_date(TLA.INITIAL_LEASE_FROM_DATE_KEY::TEXT,'yyyymmdd'),
		  to_date(TLA.LEASE_FROM_DATE_KEY::TEXT,'yyyymmdd') ) AS TENANT_MOVE_IN

,D.DEAL_OWNER AS DEAL_OWNER
,L.CONTACT_OWNER
,D.AVERAGE_CREDIT_SCORE

,L.SOURCE
,'https://app.hubspot.com/contacts/22536354/contact/' || L.LEAD_ID AS URL_HUBSPOT
,CASE WHEN DSH.CONVERT_TO_RESIDENT_DATE_KEY IS NOT NULL THEN 'Net HF' ELSE COALESCE(PAY.REFUNDED_FLAG, 'Net HF') END AS REFUNDED_FLAG 

,PM_AI.MOVEINREADY AS PM_MIR
,AM_CONS.PROJECTEDCOMPLETIONDATE	
,DATEADD(DAY,7,AM_CONS.PROJECTEDCOMPLETIONDATE) PCD_PLUS_SEVEN		
,DSH.LISTING_KEY

 ,HUB_DEAL.PROPERTY_LEASE_DRAFTING_STATUS AS LEASE_DRAFTING_STATUS
 ,HUB_DEAL.PROPERTY_MOVE_IN_FEE_PAYMENT_LINK AS MOVE_IN_FEE_PAYMENT_LINK
 ,HUB_DEAL.PROPERTY_MOVE_IN_CHARGES_PAID AS MOVE_IN_CHARGES_PAID
 ,HUB_DEAL.PROPERTY_DF_REFERENCE_NUMBER AS MOVE_IN_CHARGES_REFERENCE_ID

FROM PROD_ANALYTICS.DBT_RESICAP.DIM_DEAL D
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_DEAL_STATUS_ACCUM DSH ON DSH.DEAL_KEY  = D.Deal_Key
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_LEAD L ON L.LEAD_KEY = DSH.Lead_Key

LEFT JOIN (SELECT
				Deal_ID 
				,Value AS RECEIEVABLE_ID
				FROM PROD_REPLICA.HUBSPOT.DEAL_PROPERTY_HISTORY
				
				WHERE 1=1
				--AND DEAL_ID =8496423848
				AND NAME = 'account_receivable'
				AND _FIVETRAN_ACTIVE = 'Y') REC ON REC.DEAL_ID = D.DEAL_ID	
				
LEFT JOIN (SELECT Charge_DATE_KEY, Property_Key, Receivable_ID, Amount 
			FROM PROD_ANALYTICS.DBT_RESICAP.FCT_LEASING_TRANSACTION
			WHERE 
			TRANSACTION_TYPE = 'Charges' 
			--AND IS_REVERSED = 'N' 
			AND Amount >= 500 
			AND GL_ACCOUNT_KEY IN (18)
			) CHG ON CHG.Receivable_ID = TRY_CAST(REC.RECEIEVABLE_ID AS INTEGER)

LEFT JOIN (SELECT

			LT.PROPERTY_KEY
			,MIN(LT.RECEIVED_ON_DATE_KEY) AS HOLDING_FEE_DATE_NEW
			,REFUND.REFUNDED_FLAG
			,MIN(LT.PAID_BY_USER_KEY) AS PAID_BY_USER_KEY 
		    ,LT.RECEIVABLE_ID
		    ,LT.TENANT_KEY
			,LT.AMOUNT
			FROM PROD_ANALYTICS.DBT_RESICAP.FCT_LEASING_TRANSACTION LT
			LEFT JOIN 	
				(SELECT
				 'Refunded' AS REFUNDED_FLAG 
				,PROPERTY_KEY
				,PAID_BY_USER_KEY
				,AMOUNT FROM PROD_ANALYTICS.DBT_RESICAP.FCT_LEASING_TRANSACTION
					WHERE 1=1 
					AND TRANSACTION_TYPE = 'Payment' ) REFUND ON REFUND.PROPERTY_KEY = LT.PROPERTY_KEY 
																AND REFUND.PAID_BY_USER_KEY = LT.PAID_BY_USER_KEY
																AND REFUND.AMOUNT = (LT.AMOUNT*-1)
			WHERE 1=1
			AND LT.TRANSACTION_TYPE = 'Payment' 
			AND LT.Amount >= 500
			AND LT.GL_ACCOUNT_KEY IN (18,-1) -- SD
			AND LT.RECEIVABLE_ID =1739849
		--	AND LT.PAID_BY_USER_KEY = 1663341
			GROUP BY
			 LT.PROPERTY_KEY
			,LT.RECEIVABLE_ID
			,LT.TENANT_KEY	
			,LT.AMOUNT
            ,REFUND.REFUNDED_FLAG
            ) PAY ON PAY.Receivable_ID = TRY_CAST(REC.RECEIEVABLE_ID AS INTEGER) AND PAY.Amount = CHG.Amount


LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_USER U ON U.USER_KEY = CASE WHEN DSH.User_key <> -1 THEN DSH.User_key
																	 ELSE Pay.PAID_BY_USER_KEY END
																			 
LEFT JOIN (SELECT TLA.* 
		FROM PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TLA
		LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT T ON T.Tenant_KEY = TLA.Tenant_key
		LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI ON TI.TENANTINFORMATIONID  = T.TENANT_INFORMATION_ID
		WHERE TI._FIVETRAN_DELETED <> 'Y'
		AND RENTDUEDAY IS NOT NULL
		AND T.TENANT_KEY NOT IN (70575) ) TLA ON TLA.USER_KEY = U.User_key

LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON 

P.PROPERTY_KEY = COALESCE ( PAY.Property_Key,
									CASE WHEN DSH.PROPERTY_KEY <> -1 THEN DSH.PROPERTY_KEY
									ELSE TLA.PROPERTY_KEY END)
								
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS ON PUS.PROPERTY_KEY  = P.PROPERTY_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY
LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES HBPM ON HBPM.PROPERTYID = P.HBPM_PROPERTY_ID --*REPLCA DB*
LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PM_AI ON PM_AI.PROPERTYID  = HBPM.PROPERTYID AND PM_AI."_FIVETRAN_DELETED" = 'N' 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_REGION R ON R.REGION_KEY = PUS.REGION_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY 
LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTIES HBAM ON HBAM.HBID = P.HBAM_PROPERTY_ID --*REPLCA DB*
LEFT JOIN PROD_REPLICA.HBAM_DBO.CONSTRUCTIONS AM_CONS ON AM_CONS.CONSTRUCTIONID = HBAM.CONSTRUCTION_CONSTRUCTIONID AND AM_CONS.HBID = HBAM.HBID AND AM_CONS."_FIVETRAN_DELETED" <> 'Y'

--REPLICA Section Start

LEFT JOIN (

SELECT 
  APP.PROPERTY_HOLDING_FEE_TRANSACTION_DATE
 ,CAST(COALESCE(HD.DEAL_PIPELINE_STAGE_ID,APP.PROPERTY_HS_PIPELINE_STAGE) AS INT) AS DEAL_PIPELINE_STAGE_ID
 ,COALESCE(D.DEAL_KEY,APP.APP_ID) AS DEAL_KEY_JOIN
 ,DPS.Label AS DEAL_STAGE
 ,APP_ID
  ,CASE 
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59173506 THEN 'Aplication Started'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 93217140 THEN 'Needs New Property'        
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59173507 THEN 'Under Review'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59187121 THEN 'Conditional Approval'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59187122 THEN 'Full Approval'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59187127 THEN 'Pending Denial'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59187123 THEN 'Pre-Lease Compliance'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59187124 THEN 'Lease Drafting'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59187125 THEN 'Lease Executed'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59187126 THEN 'Move-In Scheduled'
  WHEN APP.PROPERTY_HS_PIPELINE_STAGE = 59187128 THEN 'Closed Lost'
  ELSE NULL
  END AS APP_STAGE
 ,rank () over ( partition by APP.APP_ID ORDER BY HD.PROPERTY_HS_LASTMODIFIEDDATE DESC) AS DEAL_RANK 
 ,HD.PROPERTY_LEASE_DRAFTING_STATUS
 ,HD.PROPERTY_LEASE_SIGNED_DATE
 ,HD.PROPERTY_MOVE_IN_FEE_PAYMENT_LINK
 ,HD.PROPERTY_MOVE_IN_CHARGES_PAID
 ,HD.PROPERTY_DF_REFERENCE_NUMBER

 
 FROM PROD_ANALYTICS.DBT_RESICAP.DIM_DEAL D
  LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_DEAL_STATUS_ACCUM DSH ON DSH.DEAL_KEY  = D.Deal_Key
  LEFT JOIN PROD_REPLICA.HUBSPOT_2.DEAL HD ON HD.DEAL_ID = D.DEAL_ID

  LEFT JOIN PROD_REPLICA.HUBSPOT_2.APPLICATION_TO_DEAL ATD ON ATD.TO_ID = D.DEAL_ID
   FULL JOIN (
  
    SELECT DISTINCT A.ID AS APP_ID, A.PROPERTY_UNIT_ID, A.PROPERTY_HS_PIPELINE_STAGE, A.PROPERTY_HOLDING_FEE_TRANSACTION_DATE, P.PROPERTY_KEY
    FROM PROD_REPLICA.HUBSPOT_2.APPLICATION A
    LEFT JOIN (select *,
              rank () over ( partition by FROM_ID ORDER BY _FIVETRAN_SYNCED DESC ) AS RECENT_RANK
              FROM PROD_REPLICA.HUBSPOT_2.APPLICATION_TO_PROPERTIES
              Qualify RECENT_RANK =1 ) ATP ON ATP.FROM_ID = A.ID
              LEFT JOIN PROD_REPLICA.HUBSPOT_2.PROPERTIES H_P ON H_P.ID = ATP.TO_ID
              LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON P.HBPM_PROPERTY_ID = H_P.PROPERTY_PROPERTY_ID
    WHERE IS_INTEGER(A.PROPERTY_HS_PIPELINE_STAGE)  ='True'
    AND A.PROPERTY_UNIT_ID IS NOT NULL
    AND APP_ID NOT IN (8472470544,8657787708,8657665830)) --merged bad data        
              APP ON APP.APP_ID = ATD.FROM_ID AND APP.PROPERTY_KEY = DSH.PROPERTY_KEY
  
   LEFT JOIN 
      (SELECT * FROM PROD_REPLICA.HUBSPOT_2.DEAL_PIPELINE_STAGE 
                  WHERE _FIVETRAN_DELETED = 'N') DPS
       ON DPS.STAGE_ID = HD.DEAL_PIPELINE_STAGE_ID
   
  WHERE 1=1
  --AND DEAL_KEY_JOIN = 116812
  QUALIFY DEAL_RANK = 1 ) HUB_DEAL ON HUB_DEAL.DEAL_KEY_JOIN = D.DEAL_KEY
--Replica Section End       

WHERE 1=1

--AND HD.IS_DELETED <>'Y'
--AND COALESCE(D.CURRENT_DEAL_STATUS,HUB_DEAL.DEAL_STAGE) IS NOT NULL
AND P.Property_KEY IS NOT NULL
AND D.DEAL_PIPELINE <> 'Tour Pipeline'
AND D.CURRENT_flag = 'Y'
AND (L.CURRENT_Flag = 'Y' OR DSH.LEAD_KEY = -1)
AND DSH.LEAD_KEY  IS NOT NULL
----AND L.Application_SUBMIT_Date_KEY IS NOT null
AND (TLA.TENANT_INFORMATION_ID <> 36986 OR TLA.TENANT_INFORMATION_ID IS NULL)
	

AND (HBAM.PROPERTYSTATUSID >9 OR HBAM.PROPERTYSTATUSID IS NULL) --out of bid
AND P.PROPERTY_STATE ='Active'
AND P.EntityID <> ''
AND (HBAM.PROPERTYSTATUSID NOT IN (53,75) OR HBAM.PROPERTYSTATUSID IS NULL)
AND PO.Portfolio_KEY NOT IN (223,598,147,102,109,28,603,169,602,170,58,54,169)
AND PUS.Organization_KEY not IN (16,17)
AND PO.IS_Active_AM = 'Y'
AND PO.Current_Flag = 'Y'
AND P.Current_Flag = 'Y'
AND PU.Current_Flag = 'Y'
AND PUS.Occupancy_Status NOT IN ('Not Managed')
AND (HBPM.PROPERTYSTATEID = 26 OR HBPM.PROPERTYSTATEID IS NULL) 

--AND DSH.HOLDING_FEE_PAID_DATE_KEY >= 20220201
--AND TLA.Tenant_Key = 4099
--AND D.deal_KEY = 105610
)
--****************************************************************************************************************
            	
,TENANT AS (
 
SELECT

 T.TENANT_KEY
,T.TENANT_INFORMATION_ID
,TS.USER_KEY
,T.LEASE_ID
,RANK() OVER (PARTITION BY TS.Property_KEY ORDER BY Lease_ID ASC) AS Lease_Rank
,PU.PROPERTY_UNIT_KEY
,TS.Property_KEY
,P.HBPM_PROPERTY_ID
,PO.Portfolio_Name
      
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
      
,P.Address
,P.EntityID
,PUS.Occupancy_Status
,R.REGION_NAME

,U.FULL_NAME
,U.USER_STATUS
,U.EMAIL_ADDRESS
,U.PHONE_NUMBER
,T.TENANT_STATUS
,T.TENANT_TYPE
,T.PRIMARY_TENANT
,T.EVICTION_STATUS
,T.VEHICLES
,T.PETS
,T.MONTH_TO_MONTH
,T.LEASE_TERM
,to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd') AS NOTICE_DATE
,TLA.INITIAL_RENT_AMOUNT
,T.CURRENT_RENT
,Deals.HOLDING_FEE_DATE_NEW AS "HOLDING_FEE_DATE_NEW"
,to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd') AS CURRENT_LEASE_EXPIRATION_DATE
,to_date(TLA.LEASE_SIGNED_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_SIGNED_DATE
,to_date(TLA.LEASE_FROM_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_FROM_DATE
,to_date(TLA.LEASE_TO_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_TO_DATE

,to_date(T.DOB_DATE_KEY::TEXT,'yyyymmdd') AS DOB
,CASE WHEN  DEALS.AVERAGE_CREDIT_SCORE > 850 THEN NULL ELSE DEALS.AVERAGE_CREDIT_SCORE  END AS AVERAGE_CREDIT_SCORE
,DEALS.COMBINED_INCOME COMBINEDINCOME
,L.NUMBER_OF_CHILDREN
,COALESCE(L.OCCUPANTS,1) OCCUPANTS
,DATEDIFF('year',to_date(T.DOB_DATE_KEY::TEXT,'yyyymmdd'),GETDATE()) TENANT_AGE
,L.MONTHLY_INCOME
,L.IS_RETIRED
,(CASE WHEN T.NOTICE_DATE IS NOT NULL THEN 'Y' ELSE 'N' END) AS IS_NOTICE
,(CASE WHEN T.EVICTION_STATUS IS NOT NULL THEN 'Y' ELSE 'N' END) AS IS_UNDER_EVICTION
,CASE WHEN T.PETS ='Y' THEN COALESCE(L.number_of_pets,1) ELSE COALESCE(L.number_of_pets,0) END AS "PETS_AMOUNT"

,TI.MoveIn
,TI.MoveOut
,TI.PurchaseLetterPostedDate
,TI.DateNotified
,TI.FiledWithCountyDate
,TI.ResidentServedDate
,TI.CourtDateSetDate
,TI.JudgementDate
,TI.LockoutScheduledDate
,TI.VacateDate
,TI.AnticipatedMoveOutDate
,TI.IsSection8
,TI.IsMonthtoMonthLease
,TI.TenantDecidedMonthtoMonth
,TI.DoNotRenew
,TI.ReasonForNotRenewingId
,DNR.DESCRIPTION AS REASONFORNOTRENEWINGNAME
,PUS.Under_written_rent
,AM_PM.MoveInReady
,'https://honeybadgerpm.com/ReportingModule/ViewReport?reportId=1807&UnitId='||TI.UnitID||'&UserId='||TI.UserID||'#/' AS URL_SODA
,CASE WHEN TI.MoveOut IS NULL THEN NULL WHEN TI.MoveOutComplte = 'Y' THEN 'Yes' ELSE 'No' END AS MoveOutComplete
,PM_AI.ReasonOffMarketId --*
,ROM.Description AS ReasonOffMarketName
,Offmarket.OffMarketDate
,to_date(PU.Move_In_Ready::TEXT,'yyyymmdd') AS MOVE_IN_READY

,UW_Rent.UW_Rent_Prior   
,UW_Rent.UW_Rent_Current   
,UW_Rent.UW_Update_Date 

,PICS.PICTURE_COUNT
,AM_STRATEGY.STRATEGYNAME AS STRATEGY_NAME

,CN.CollectionNote
,CN.CollectionNoteCreated
,CN.CollectionNote_Days
,CN.CollectionNote_Added_By
,CASE WHEN HUB_PETS.PETS > 0 OR T.PEts ='Y' THEN 'PET' ELSE NULL END AS PET_FLAG
,PU.SQUARE_FOOTAGE
,P.FloorPlan
,'Re-Lease' AS TYPE

FROM PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT T
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_ACTIVITY TS ON TS.TENANT_KEY = T.TENANT_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TLA ON TLA.TENANT_KEY = T.Tenant_Key
LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI ON TI.TenantInformationId = T.TENANT_INFORMATION_ID
LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS DNR on DNR.LookUpMasterId = TI.ReasonForNotRenewingId
--LEFT JOIN PROD_REPLICA.HBPM_DBO.DEALS PM_D ON PM_D.LEADUSERID = TI.USERID AND PM_D.UNITID =TI.UNITID AND PM_D.SECURITYDEPOSITID IS NOT null
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_USER U ON U.USER_KEY = TS.USER_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON P.PROPERTY_KEY = TS.PROPERTY_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS ON PUS.PROPERTY_KEY  = P.PROPERTY_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_REGION R ON R.REGION_KEY = PUS.REGION_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_LEAD L ON L.lead_key = TS.LEAD_KEY 
LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTIES HBAM ON HBAM.HBID = P.HBAM_PROPERTY_ID --*REPLCA DB*
LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTYMANAGEMENTS AM_PM ON AM_PM.PROPERTYMANAGEMENTID = HBAM.PropertyManagement_PropertyManagementId AND AM_PM.HBID = HBAM.HBID
	LEFT JOIN PROD_REPLICA.HBAM_DBO.BidAndAuctions AM_BA ON AM_BA.BIDID = HBAM.BidAndAuction_BidId AND AM_BA.HBID = HBAM.HBID AND AM_BA."_FIVETRAN_DELETED" <> 'Y'
	LEFT JOIN PROD_REPLICA.HBAM_DBO.Strategies AM_STRATEGY ON AM_STRATEGY.STRATEGYID = AM_BA.BIDSTRATEGYSTATUS 

LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES HBPM ON HBPM.PROPERTYID = P.HBPM_PROPERTY_ID --*REPLCA DB*
LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PM_AI ON PM_AI.PROPERTYID  = HBPM.PROPERTYID AND PM_AI."_FIVETRAN_DELETED" = 'N' 
LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS ROM ON ROM.LookUpMasterId = PM_AI.ReasonOffMarketId
LEFT JOIN CollectionsNote CN ON CN.UserID = TI.UserID

LEFT JOIN DEALS ON Deals.DEAL_KEY = TS.DEAL_KEY
 AND Deals.Current_Deal_Status NOT IN ('Deal Lost', 'Rejected','Closed Lost','Property Listed')
 AND Deals.APP_STAGE NOT IN ('Pending Denial','Closed Lost','Needs New Property')
 AND Deals.APP_STAGE IS NOT NULL
			
LEFT JOIN (SELECT C.ID, COUNT(PET.ID) PETS
			FROM PROD_REPLICA.HUBSPOT.PET 
			LEFT JOIN PROD_REPLICA.HUBSPOT.PET_TO_CONTACT PTC ON PTC.FROM_ID = PET.ID
			LEFT JOIN PROD_REPLICA.HUBSPOT.CONTACT C ON C.ID = PTC.TO_ID 
			GROUP BY C.ID) HUB_PETS ON HUB_PETS.ID = L.LEAD_ID
	
/*LEFT JOIN (SELECT 
			FCT_TENANT_SUMMARY_KEY 
			,TENANT_INFORMATION_ID 
			,AVERAGE_CREDIT_SCORE
			,R_TS.COMBINED_INCOME
			,NUMBER_OF_CHILDREN
			,OCCUPANTS
			,TENANT_AGE
			,MONTHLY_INCOME
			,IS_RETIRED
			,IS_NOTICE
			,IS_UNDER_EVICTION
			FROM PROD_ANALYTICS.RESICAP.FCT_TENANT_SUMMARY R_TS
			LEFT JOIN PROD_ANALYTICS.RESICAP.DIM_TENANT R_T ON R_T.TENANT_KEY = R_TS.TENANT_KEY ) RESI_TSUM ON RESI_TSUM.TENANT_INFORMATION_ID = T.TENANT_INFORMATION_ID*/

LEFT JOIN (
			SELECT 
			PROPERTY_KEY  
			,MAX(to_date(CHANGED_DATE_KEY::TEXT,'yyyymmdd')) OffMarketDate
			FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_UNIT_STATUS_HIST
			
			WHERE 1=1
			AND NEW_OCCUPANCY_STATUS = 'Vacant - Off Market'
			GROUP BY PROPERTY_KEY ) OffMarket ON OffMarket.Property_key = P.Property_key			

LEFT JOIN UW_RENT ON UW_Rent.HBPM_UnitID = PM_AI.UnitID				
LEFT JOIN PICS ON PICS.PM_PropertyID = P.HBPM_PROPERTY_ID	

WHERE 1=1
AND T.CURRENT_FLAG = 'Y'
AND T.PRIMARY_TENANT = 'Y'

AND P.PROPERTY_STATE ='Active'
AND P.EntityID <> ''
AND TI._FIVETRAN_DELETED <> 'Y'
AND TI.RENTDUEDAY IS NOT NULL
--AND (PS.PROPERTY_STATUS_ID NOT IN (53,75) OR PS.PROPERTY_STATUS_ID IS NULL)
AND PO.Portfolio_KEY NOT IN (223,598,147,102,109,28,603,169,602,170,58,54,169)
AND P.Organization_KEY not IN (16,17)
AND PO.IS_Active_AM = 'Y'
AND PO.Current_Flag = 'Y'
AND P.Current_Flag = 'Y'
AND PU.Current_Flag = 'Y'
AND PUS.Occupancy_Status NOT IN ('Property SOLD','Not Managed'))
-- T.TENANT_KEY NOT IN (70575))
--SELECT * FROM Tenant
--**************************************************************************************        
,HAPPY_CO_TURN AS (
SELECT
Tenant.Lease_ID
,Tenant.Property_Key
,Tenant.MoveOut
,MIN(HAPPY_CO_SCOPE.HC_SCOPE_COMPLETED_DATE) HC_SCOPE_COMPLETED_DATE
,MIN(HAPPY_CO_QC.HC_TURN_COMPLETED_DATE) HC_TURN_COMPLETED_DATE
FROM Tenant
LEFT JOIN HAPPY_CO_SCOPE ON HAPPY_CO_SCOPE.Property_Key = Tenant.Property_key
                            AND HAPPY_CO_SCOPE.HC_SCOPE_COMPLETED_DATE >= Tenant.MoveOut
                            AND HAPPY_CO_SCOPE.Recent_Rank = 1
                            
LEFT JOIN HAPPY_CO_QC ON  HAPPY_CO_QC.Property_Key = Tenant.Property_key
                            AND HAPPY_CO_QC.HC_TURN_COMPLETED_DATE  >= Tenant.MoveOut
                            AND  HAPPY_CO_QC.Recent_Rank = 1
WHERE 1=1
--AND  Tenant.Property_Key = 251448
--AND HAPPY_CO_SCOPE.Recent_Rank = 1
--AND HAPPY_CO_QC.Recent_Rank = 1
--AND Tenant.Lease_ID = 234243
GROUP BY
 Tenant.Lease_ID
,Tenant.Property_Key
,Tenant.MoveOut
)
--**************************************************************************************    
,Turnkey AS (
 SELECT 
 --DISTINCT 
 Tenant.Lease_ID AS O_TURN_ID
,Tenant.Lease_Rank AS  O_Lease_Rank
,Tenant.Tenant_KEY AS O_Tenant_KEY
,Tenant.TENANT_STATUS AS O_Tenant_Status
,Tenant.FULL_NAME AS O_Tenant_FULL_NAME
,Tenant.EMAIL_ADDRESS AS O_Tenant_EMAIL_ADDRESS

,Tenant.PROPERTY_UNIT_KEY
,Tenant.Property_KEY
,Tenant.HBPM_Property_Id
,Tenant.Portfolio_Name
,Tenant.Address
,Tenant.EntityID
,Tenant.Occupancy_Status
,Tenant.Region_Name
,Tenant.SQUARE_FOOTAGE
,Tenant.FloorPlan
,Tenant.TYPE

,Tenant.CURRENT_RENT AS O_Current_Rent
,Tenant.HOLDING_FEE_DATE_NEW AS O_HOLDING_FEE_DATE
,Tenant.MoveIn AS O_MoveIn
,Tenant.LEASE_FROM_DATE AS O_LEASE_FROM_DATE
,Tenant.LEASE_TO_DATE AS O_LEASE_TO_DATE
,Tenant.NOTICE_DATE AS O_Notice_Date
,Tenant.AnticipatedMoveOutDate AS O_AnticipatedMoveOutDate
,Tenant.MoveOut AS O_Move_Out
,DATE_TRUNC('month',Tenant.MoveOut) AS O_Move_Out_BOM

,Tenant_New.Lease_ID AS N_TURN_ID
,Tenant_New.Lease_Rank AS  N_Lease_Rank
,COALESCE(Tenant_New.INITIAL_RENT_AMOUNT,Tenant_New.CURRENT_RENT) AS N_Initial_Rent
,Tenant_New.CURRENT_RENT AS N_Current_Rent
,Tenant_New.HOLDING_FEE_DATE_NEW AS N_HOLDING_FEE_DATE
,Tenant_New.MoveIn AS N_MoveIn
,Tenant_New.LEASE_FROM_DATE AS N_LEASE_FROM_DATE
,Tenant_New.LEASE_TO_DATE AS N_LEASE_TO_DATE
,Tenant_New.MoveOut AS N_Move_Out

,CASE
        WHEN Tenant.ORGANIZATION_KEY IN (-1,18,26,28,48)                   THEN -1
        WHEN Tenant.ORGANIZATION_KEY IN (27,50,51,52,54,45,55,53,56,57,66) THEN 27
        WHEN Tenant.ORGANIZATION_KEY IN (58,59)                            THEN 58
        WHEN Tenant.ORGANIZATION_KEY IN (62,63,64,65,68,69)                THEN 62
        WHEN Tenant.ORGANIZATION_KEY IN (61,70)                            THEN 61
        WHEN Tenant.ORGANIZATION_KEY IN (67)                               THEN 67
        ELSE Tenant.ORGANIZATION_KEY
     END AS ORGANIZATION_KEY
,CASE
        WHEN Tenant.ORGANIZATION_KEY IN (-1,18,26,28,48)                   THEN 'RP SFR'
        WHEN Tenant.ORGANIZATION_KEY IN (27,50,51,52,54,45,55,53,56,57,66) THEN 'RB DRC'
        WHEN Tenant.ORGANIZATION_KEY IN (58,59)                            THEN 'Hudson Oak'
        WHEN Tenant.ORGANIZATION_KEY IN (62,63,64,65,68,69)                THEN 'Rocklyn Homes'
        WHEN Tenant.ORGANIZATION_KEY IN (61,70)                            THEN 'ROI Property Group'
        WHEN Tenant.ORGANIZATION_KEY IN (67)                               THEN 'Newstar'
        ELSE Tenant.ORGANIZATION_NAME
     END AS ORGANIZATION_NAME

,Tenant.MoveInReady
,Tenant.URL_SODA
,Tenant.MoveOutComplete
,Tenant.Move_In_Ready AS Listing_MI_READY_DATE

,HAPPY_CO_SCOPE.HC_SCOPE_INSPECTION_LINK
,HAPPY_CO_SCOPE.HC_SCOPE_COMPLETED_DATE
,HAPPY_CO_SCOPE.HC_SCOPE_REPORT_STATUS
,HAPPY_CO_SCOPE.HC_SCOPE_ISSUE_COUNT

,HAPPY_CO_QC.HC_TURN_INSPECTION_LINK
,HAPPY_CO_QC.HC_TURN_COMPLETED_DATE
,HAPPY_CO_QC.HC_TURN_REPORT_STATUS
,HAPPY_CO_QC.HC_TURN_ISSUE_COUNT

,CASE WHEN HAPPY_CO_QC.HC_TURN_REPORT_STATUS = 'Pass' AND HAPPY_CO_QC.HC_TURN_ISSUE_COUNT > 0 THEN 'Pass (Minor Fail)'
      WHEN HAPPY_CO_QC.HC_TURN_REPORT_STATUS = 'Pass w/Minor Fails' THEN 'Pass (Minor Fail)'
      ELSE NULL END AS PASS_MINOR
,Tenant.ReasonOffMarketName
,Tenant.OffMarketDate

,Tenant.UW_Rent_Prior   
,Tenant.UW_Rent_Current   
,Tenant.UW_Update_Date

,Tenant.PICTURE_COUNT
,Tenant.STRATEGY_NAME
,Tenant.REASONFORNOTRENEWINGNAME

,Tenant.CollectionNote
,Tenant.CollectionNoteCreated
,Tenant.CollectionNote_Days
,Tenant.CollectionNote_Added_By
,Tenant.PET_FLAG

FROM Tenant
LEFT JOIN Tenant AS Tenant_New ON TENANT_NEW.Property_Key = TENANT.Property_Key AND (TENANT_NEW.Lease_Rank = TENANT .Lease_Rank +1)
LEFT JOIN HAPPY_CO_TURN HCT ON HCT.Lease_ID = Tenant.Lease_ID 
LEFT JOIN HAPPY_CO_SCOPE ON HAPPY_CO_SCOPE.HC_SCOPE_COMPLETED_DATE = HCT.HC_SCOPE_COMPLETED_DATE AND HAPPY_CO_SCOPE.Property_key = HCT.Property_key AND HAPPY_CO_SCOPE.RECENT_RANK = 1
LEFT JOIN HAPPY_CO_QC ON HAPPY_CO_QC.HC_TURN_COMPLETED_DATE = HCT.HC_TURN_COMPLETED_DATE AND HAPPY_CO_QC.Property_key = HCT.Property_key AND HAPPY_CO_QC.RECENT_RANK = 1

WHERE 1=1
AND (Tenant.MoveOut IS NOT NULL OR Tenant.AnticipatedMoveOutDate <= DATEADD('day',60, GETDATE() ) )
--AND Tenant.Occupancy_Status <> 'Dispositions'
--AND  Tenant.Property_Key = 251448
)

--SELECT * FROM Turnkey
--WHERE Property_key= 226644
--**************************************************************************************
,Turn_Listings AS (

SELECT 
MIN(RENT_LIST_HIST_ID) RENT_LIST_HIST_KEY
,O_Turn_ID 
,Turnkey.Property_key
FROM Turnkey

LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_RENTAL_LISTING_HIST RLH ON RLH.PROPERTY_KEY  = Turnkey.Property_key
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_LISTING DL  ON DL.LISTING_KEY  = RLH.LISTING_KEY 

WHERE 1=1

AND to_date(RLH.LISTING_DATE_KEY::TEXT,'yyyymmdd')  >= O_LEASE_FROM_DATE
AND to_date(RLH.LISTING_DATE_KEY::TEXT,'yyyymmdd') <= COALESCE(N_LEASE_FROM_DATE,'1/1/9999')
--AND ((RLH.LISTING_STATUS <> 'Leased' AND N_LEASE_FROM_DATE IS NULL) OR N_LEASE_FROM_DATE IS NOT NULL ) 
AND RLH.LISTING_STATUS <> 'Withdrawn'
AND ((RLH.LISTING_STATUS IN ('Active','Deposit Taken', 'Leased') AND DL.LISTING_STATE IS NOT NULL AND DL.IS_PUBLISHED <> 'N')
      OR RLH.LISTING_STATUS IN ('Deposit Taken', 'Leased'))

--AND Turnkey.Property_key =242795
GROUP BY
O_Turn_ID 
,Turnkey.Property_key ) 


--SELECT * FROM Turn_Listings
--WHERE Property_KEy = 245796
--**************************************************************************************
,MoveOutLineItems AS ( 
	 
SELECT 
  TI.LEASEID
 ,LT.Amount as Payments
 ,GL.Description as GlAccountDesc 
 ,AR.Description as Description
 ,TI.USERID 
FROM PROD_ANALYTICS.DBT_RESICAP.FCT_LEASING_TRANSACTION LT
LEFT JOIN PROD_REPLICA.HBPM_DBO.MoveOutSettleCharges MSC ON MSC.RECEIVABLESID = LT.RECEIVABLE_ID AND MSC._FIVETRAN_DELETED = 'N'
LEFT JOIN PROD_REPLICA.HBPM_DBO.AccountsReceivables AR ON  AR.ReceivableID = LT.RECEIVABLE_ID 
LEFT JOIN PROD_REPLICA.HBPM_DBO.GLAccounts GL ON  GL.GLAccountID  = AR.GLACCOUNTID 

LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT TEN ON TEN.LEASE_ID = AR.LeaseID AND TEN.PRIMARY_TENANT = 'Y'  AND TEN.CURRENT_FLAG = 'Y'
LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI ON TI.TenantInformationId = TEN.TENANT_INFORMATION_ID
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TS ON TS.TENANT_KEY = TEN.TENANT_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_USER U ON U.USER_KEY = TS.USER_KEY

WHERE 1=1
--AND TI.LeaseId = 20019
AND AR.RECEIVABLESTATUSID = 901 --Active
AND AR."_FIVETRAN_DELETED"='N'
AND LT.TRANSACTION_TYPE = 'Charges'
AND LT.STATUS = 'Active'
AND LT.IS_CREDIT = 'N'
AND  GL.GLAccountID = 20

--AND MS.TenantInformationId = 35868
)
	
--SELECT * FROM MoveOutLineItems
--WHERE USerID =1074545
--*****************************************************************************************
,MoveOutCharges AS (
SELECT 
	LeaseID
	,SUM(Payments) MoveOutCharges
FROM MoveOutLineItems
WHERE LeaseID IS NOT NULL
AND Description NOT LIKE '%Early Term%'
AND Description NOT LIKE '%Insufficient Notice%'
AND Description NOT LIKE '%Prorated%'
GROUP BY LEASEID
)
--*****************************************************************************************
,BadDebt AS (
Select 
ARD.ReceiptId
,MAX(AR.CreditTypeID) CreditTYpeID
FROM PROD_REPLICA.HBPM_DBO.ACCOUNTSRECEIPTDETAILS ARD
LEFT JOIN PROD_REPLICA.HBPM_DBO.ACCOUNTSRECEIVABLES AR ON AR.ReceivableID = ARD.ReceivableId
WHERE AR.ReceivableStatusId = 901
GROUP BY ARD.ReceiptId )
--*****************************************************************************************
,MoveOutLineItemsReceipts AS (
  
SELECT 
  TI.LEASEID
 ,LT.Amount as Payments
 ,LT.CHARGE_GL_ACCOUNT_NAME as GlAccountDesc 
 ,ARV.Description as Description
 ,LT.IS_CREDIT
 ,BD.CreditTypeId
 ,CASE WHEN BD.CreditTypeId = 1 THEN 'Concession'
     WHEN BD.CreditTypeId = 2 THEN 'Bad Debt' END AS Credit_Type_Name
 ,TI.USERID 

FROM PROD_ANALYTICS.DBT_RESICAP.FCT_LEASING_TRANSACTION LT
LEFT JOIN PROD_REPLICA.HBPM_DBO.ACCOUNTSRECEIPTDETAILS ARD ON  ARD.RECEIPTDETAILID = LT.RECEIPT_DETAIL_ID AND ARD."_FIVETRAN_DELETED"='N'
LEFT JOIN PROD_REPLICA.HBPM_DBO.ACCOUNTSRECEIPTS AR ON AR.RECEIPTID = ARD.RECEIPTID AND AR."_FIVETRAN_DELETED"='N'
LEFT join PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS RS ON RS.LOOKUPMASTERID = AR.RECEIPTSTATUSID 
LEFT join PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS PT ON PT.LOOKUPMASTERID = AR.PAIDBYTYPEID 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_GL_ACCOUNT GL ON GL.GL_ACCOUNT_KEY = LT.GL_ACCOUNT_KEY 
LEFT JOIN BadDebt BD ON BD.ReceiptID = ARD.ReceiptID
LEFT JOIN PROD_REPLICA.HBPM_DBO.AccountsReceivables ARV ON  ARV.ReceivableID = LT.RECEIVABLE_ID 

LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT TEN ON TEN.LEASE_ID = AR.LeaseID AND TEN.PRIMARY_TENANT = 'Y'  AND TEN.CURRENT_FLAG = 'Y'
LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI ON TI.TenantInformationId = TEN.TENANT_INFORMATION_ID
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TS ON TS.TENANT_KEY = TEN.TENANT_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_USER U ON U.USER_KEY = TS.USER_KEY

WHERE 1=1
AND LT.TRANSACTION_TYPE = 'Payment'
AND LT.Tenant_Key IS NOT NULL	
AND (AR.RECEIPTSTATUSID IN (901,904) OR AR.RECEIPTSTATUSID Is null) --Active/Pending
AND ARD."_FIVETRAN_DELETED"='N'
AND AR."_FIVETRAN_DELETED"='N'
AND LT.STATUS = 'Active'
AND LT.IS_CREDIT = 'N'
AND  LT.CHARGE_GL_ACCOUNT_NUMBER = '4016'
  
--ORDER BY LEASEID DESC
)
--*****************************************************************************************
,MoveOutReceipts AS (
SELECT 
	LeaseID
	,SUM(CASE WHEN CreditTypeId IS NULL THEN Payments ELSE 0 END) MoveOutReceipts_PAID
  	,SUM(CASE WHEN CreditTypeId = 1 THEN Payments ELSE 0 END ) MoveOutReceipts_CONCESSION
  	,SUM(CASE WHEN CreditTypeId = 2 THEN Payments ELSE 0 END) MoveOutReceipts_BAD_DEBT
  	,SUM(Payments) MoveOutReceipts_TOTAL
  
  
FROM MoveOutLineItemsReceipts
WHERE LeaseID IS NOT NULL
AND Description NOT LIKE '%Early Term%'
AND Description NOT LIKE '%Insufficient Notice%'
AND Description NOT LIKE '%Prorated%'
GROUP BY LEASEID
)

--*****************************************************************************************

,WO_DETAIL AS (
SELECT 
 
TI.TICKET_KEY
,WO.WORKORDER_KEY
,TI.TICKET_TYPE
,COALESCE(TI.TICKET_TYPE, 'Maintenance') AS TICKET_TYPE_CLOSED
,TI.TICKET_STATUS
,WO.WORKORDER_ID
,WO.MAINT_ID
,WO.HBH_ID_KEY
,WO.WORKORDER_STATUS
,WO.PRIORITY
,WO.BILL_TO

,P.Property_Key

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

,PO.Portfolio_Name
,P.EntityId
,P.Address
,R.Region_ID
,R.Region_Name

--,WOST.TENANT_USER_KEY
,WOST.VENDOR_KEY
,V.VENDOR_ID
,V.COMPANY_NAME
,CASE WHEN V.CURRENT_VENDOR_STAGE = 'Compliant' THEN 'Active' ELSE V.CURRENT_VENDOR_STAGE END AS "CURRENT_VENDOR_STAGE"
,V.VENDOR_STANDING
,WO.MAINT_APPROVED
,WO.MANAGED_BY

,WO.APPROVED_BY_OWNER
,WO.IS_WARRANTY_WRK

,WO.SENT_FOR_OWNER_APPROVAL
,WO.EST_APPROVED_BY_OWNER
,WO.CHANGE_RQST_NEEDED
,WO.CR_SENT_FOR_OWNER_APPROVAL
,WO.CR_APPROVED_BY_OWNER
,WO.ONSITE_APPROVAL
,WO.NOTE_IS_OWNER
,to_date(WO.NOTE_CREATED_DATE_KEY::TEXT,'YYYYMMDD') AS NOTE_CREATED_DATE
,WO.NOTE_TEXT
,WO.APPROVAL_STATUS
,to_date(WO.APPROVAL_DATE_KEY::TEXT,'YYYYMMDD') AS APPROVAL_DATE
,WO.APPROVER_MESSAGE
,WO.APPROVER

,to_date(TI.CREATED_DATE_KEY::TEXT,'YYYYMMDD') AS TICKET_CREATED_DATE
,to_date(WO.CREATED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_CREATED_DATE
,to_date(WO.MODIFIED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_MODIFIED_DATE
,to_date(WOST.WO_REQUESTED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_REQUESTED_DATE
,to_date(WOST.WO_ACCEPTED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_ACCEPTED_DATE
,to_date(WOST.WO_ESTIMATED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_ESTIMATED_DATE
,to_date(WOST.WO_RE_ESTIMATED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_RE_ESTIMATED_DATE
,to_date(WOST.WO_AWAITING_OWNER_APPROVAL_DATE_KEY::TEXT,'YYYYMMDD') AS WO_AWAITING_OWNER_APPROVAL_DATE
,to_date(WO.SENT_FOR_OWNER_APVL_DATE_KEY::TEXT,'YYYYMMDD') AS SENT_FOR_OWNER_APVL_DATE
,to_date(WOST.WO_OWNER_APPROVAL_DATE_KEY::TEXT,'YYYYMMDD') AS WO_OWNER_APPROVAL_DATE
,to_date(WOST.WO_PENDING_COMPLETION_DATE_KEY::TEXT,'YYYYMMDD') AS WO_PENDING_COMPLETION_DATE
,to_date(DBT_WOI.CLIENT_INVOICE_DATE_KEY::TEXT,'YYYYMMDD') AS CLIENT_INVOICE_DATE
,COALESCE (to_date(DBT_WOI.VENDOR_INVOICE_DATE_KEY::TEXT,'YYYYMMDD'), to_date(WOST.WO_CLOSED_DATE_KEY::TEXT,'YYYYMMDD') )  AS VENDOR_INVOICE_DATE
,to_date(WOST.WO_COMPLETED_AWAITING_APPROVAL_DATE_KEY::TEXT,'YYYYMMDD') AS WO_COMPLETED_AWAITING_APPROVAL_DATE
,to_date(WOST.WO_UNBILLED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_UNBILLED_DATE
,to_date(WOST.WO_CLOSED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_CLOSED_DATE
,to_date(WOST.WO_CANCELLED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_CANCELLED_DATE
,to_date(WO_START_DATE_KEY::TEXT,'YYYYMMDD') AS WO_START_DATE
,to_date(WO_END_DATE_KEY::TEXT,'YYYYMMDD') AS WO_END_DATE

,DBT_WOI.CLIENT_INVOICE_NO
,DBT_WOI.CLIENT_MATERIAL_CHARGE
,DBT_WOI.CLIENT_HOURLY_LABOR_CHARGE
,DBT_WOI.CLIENT_FLAT_LABOR_CHARGE
,CASE WHEN WO.WORKORDER_STATUS ='Closed' THEN ZEROIFNULL(DBT_WOI.CLIENT_INVOICE_AMOUNT) ELSE DBT_WOI.CLIENT_INVOICE_AMOUNT END AS CLIENT_INVOICE_AMOUNT
,EST.CLIENT_ESTIMATE 
,DBT_WOI.VENDOR_MATERIAL_CHARGE
,DBT_WOI.VENDOR_HOURLY_LABOR_CHARGE
,DBT_WOI.VENDOR_FLAT_LABOR_CHARGE
,DBT_WOI.VENDOR_INVOICE_AMOUNT
,DBT_WOI.VENDOR_INVOICE_NO
,DBT_WOI.CLIENT_INVOICE_AMOUNT - DBT_WOI.VENDOR_INVOICE_AMOUNT AS "Invoice_Profit"

,C.CategoryID
,C.CATEGORYNAME
,MCD.WO_PROBLEM
,MCD.WO_Solution
,'https://honeybadgermm.com/Maintenance#/CreateWorkOrder/' || WO.Maint_ID AS HBMM_URL

,DATE_TRUNC('month',COALESCE (to_date(DBT_WOI.CLIENT_INVOICE_DATE_KEY::TEXT,'YYYYMMDD'), to_date(WOST.WO_CLOSED_DATE_KEY::TEXT,'YYYYMMDD'))) AS "1_Invoice (BOM)"

,CASE WHEN COALESCE (to_date(DBT_WOI.VENDOR_INVOICE_DATE_KEY::TEXT,'YYYYMMDD'), to_date(WOST.WO_CLOSED_DATE_KEY::TEXT,'YYYYMMDD')) IS NOT NULL THEN DATEDIFF(DAY,to_date(TI.CREATED_DATE_KEY::TEXT,'YYYYMMDD'),COALESCE (to_date(DBT_WOI.VENDOR_INVOICE_DATE_KEY::TEXT,'YYYYMMDD'), to_date(WOST.WO_CLOSED_DATE_KEY::TEXT,'YYYYMMDD')))
      WHEN WO.WORKORDER_STATUS = 'Closed' AND COALESCE (to_date(DBT_WOI.VENDOR_INVOICE_DATE_KEY::TEXT,'YYYYMMDD'), to_date(WOST.WO_CLOSED_DATE_KEY::TEXT,'YYYYMMDD')) IS NULL THEN NULL 
	  ELSE DATEDIFF(DAY,to_date(TI.CREATED_DATE_KEY::TEXT,'YYYYMMDD'),GETDATE())
      END AS "1_DIQ/CycleTime"

 ,CASE WHEN V.VENDOR_KEY IN (33018,33014,32987,33019,196,32555,906,1274,1929) THEN 'Warranty Vendor' ELSE 'External Vendor' END AS Warranty
 ,CASE WHEN V.VENDOR_KEY IN (33018,33014,32987,33019,196,32555,906,1274,1929) THEN V.Company_Name ELSE NULL END AS Warranty_Vendor_Name

,MM_MASTER."NoteText" AS WO_NOTE_TEXT
,MM_MASTER."Note Created Date" AS WO_NOTE_CREATED_DATE
,MM_MASTER."NoteAddedBy" AS WO_NOTE_ADDED_BY
 
FROM PROD_ANALYTICS.DBT_RESICAP.DIM_TICKET TI
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TICKET_STATUS_ACCUM TSA ON TSA.TICKET_KEY  = TI.TICKET_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_WO_STATUS_ACCUM WOST ON WOST.TICKET_KEY  = TI.TICKET_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_WORKORDER WO ON WO.WORKORDER_KEY = WOST.WORKORDER_KEY AND WO.CURRENT_FLAG = 'Y'
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_VENDOR V ON V.VENDOR_KEY = WOST.VENDOR_KEY

LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_WO_INVOICE DBT_WOI ON DBT_WOI.WORKORDER_KEY  = WO.WorkORder_key
LEFT JOIN (SELECT 
				WORKORDER_KEY AS DBT_WO_KEY
				,SUM (MARKUP_AMOUNT) AS CLIENT_ESTIMATE
				FROM PROD_ANALYTICS.DBT_RESICAP.FCT_WO_ESTIMATED_MATERIAL
				GROUP BY WORKORDER_KEY ) EST ON EST.DBT_WO_KEY = WOST.WORKORDER_KEY
				

LEFT JOIN (SELECT 
				Min(MaintenanceCategoryDetailId) AS MaintenanceCategoryDetailID
				,MIN(CategoryDescription) AS WO_Problem
				,MIN(VENDORNOTES) AS WO_Solution
				,MaintenanceIDKey
                FROM PROD_REPLICA.HBMM_DBO.MAINTENANCECATEGORYDETAILS 
                --WHERE MaintenanceIDKey = 668614
				GROUP BY MaintenanceIDKey) MCD on MCD.MaintenanceIdkey = WO.MAINT_ID 

LEFT JOIN PROD_REPLICA.HBMM_DBO.MaintenanceCategoryDetails on MaintenanceCategoryDetails.MaintenanceCategoryDetailId = MCD.MaintenanceCategoryDetailID
LEFT JOIN PROD_REPLICA.HBMM_DBO.MaintenanceCategories C on C.CategoryId = MaintenanceCategoryDetails.CategoryId
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON P.PROPERTY_KEY = TSA.PROPERTY_KEY AND P.CURRENT_FLAG ='Y'
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS ON PUS.PROPERTY_KEY = P.PROPERTY_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_REGION R ON R.REGION_KEY = PUS.REGION_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY 
LEFT JOIN PROD_ANALYTICS.BI_MASTER_DATASETS.MASTER_MM_WORKORDER MM_MASTER ON MM_MASTER."IDKey" = COALESCE(WO.MAINT_ID,TI.ID_KEY)

WHERE 1=1 
AND (WO.WORKORDER_STATUS <> 'Cancelled' OR WO.WORKORDER_STATUS IS NULL)
AND TI.TICKET_STATUS <> 'Cancelled'
AND ((TI.TICKET_STATUS = 'Closed' AND WO.WORKORDER_KEY IS NOT NULL)
	OR (TI.TICKET_STATUS = 'Open' AND WO.WORKORDER_KEY IS NOT NULL )
	OR (TI.TICKET_STATUS <> 'Closed' AND TI.TICKET_STATUS <> 'Open') )
		
AND TI.CREATED_DATE_KEY > '20210101'

AND P.PROPERTY_STATE ='Active'
AND P.EntityID <> ''
--AND (PS.PROPERTY_STATUS_ID NOT IN (53,75) OR PS.PROPERTY_STATUS_ID IS NULL)
AND PO.Portfolio_KEY NOT IN (1845, 2210, 2207, 2218, 1952,1867, 1916,1852,1771,1919,1873)
AND P.Organization_KEY not IN (16,17)
AND PO.IS_Active_AM = 'Y'
AND PO.Current_Flag = 'Y'
AND P.Current_Flag = 'Y'
AND PU.Current_Flag = 'Y'
AND PUS.Occupancy_Status NOT IN ('Property SOLD','Not Managed')
--AND P.Property_key= 223502
)


--**************************************************************************************
,WO_TURN AS (
SELECT 
WO_DETAIL.TICKET_KEY
,WO_DETAIL.WORKORDER_KEY
,MIN(Turnkey.O_TURN_ID) O_Turn_ID

FROM WO_DETAIL
LEFT JOIN Turnkey ON Turnkey.Property_key = WO_DETAIL.Property_key

WHERE 1=1
AND (TICKET_TYPE = 'Turnkey' OR CategoryName = 'Unit Turns (Paint/Clean/Minor Repairs)')
AND TICKET_TYPE <> 'Trespassers/Vandalism'
AND TICKET_CREATED_DATE >=  to_date(LEAST(Turnkey.O_MOVE_OUT,O_Notice_Date)::TEXT,'AUTO')
AND (TICKET_CREATED_DATE <= Turnkey.N_LEASE_FROM_DATE OR N_LEASE_FROM_DATE IS NULL)
--AND Turnkey.Property_key= 223502

GROUP BY 
WO_DETAIL.TICKET_KEY
,WO_DETAIL.WORKORDER_KEY)

--SELECT * FROM WO_TURN 

--**************************************************************************************
,TURN_WO_SUMMARY AS (
SELECT 

WO_TURN.O_TURN_ID
,MIN(TICKET_CREATED_DATE) AS TKT_Created_Min
,MAX(TICKET_CREATED_DATE) AS TKT_Created_Max
,MAX(WO_NOTE_TEXT) AS WO_NOTE_TEXT
,MAX(WO_END_DATE) AS WO_END_DATE
,MAX(WO_REQUESTED_DATE) AS WO_REQUESTED_DATE
,MIN(WORKORDER_STATUS) AS WO_STATUS
,MAX(WO_NOTE_CREATED_DATE) AS WO_NOTE_CREATED_DATE
,MAX(WO_NOTE_ADDED_BY) AS WO_NOTE_ADDED_BY

,MAX(COALESCE(CLIENT_INVOICE_DATE,WO_CLOSED_DATE,VENDOR_INVOICE_DATE)) AS TKT_Closed_Max

,SUM(CASE WHEN (TICKET_STATUS = 'Open' AND WORKORDER_STATUS NOT IN ('Closed','Unbilled','Completed Awaiting Approval'))
			OR (TICKET_STATUS = 'New' AND WO_DETAIL.WORKORDER_KEY IS NULL) THEN 1 ELSE NULL END) AS TKT_WOS_OPEN
			
,SUM(CASE WHEN WORKORDER_STATUS IN ('Closed','Unbilled','Completed Awaiting Approval') THEN 1 ELSE NULL END) AS TKT_WOS_CLOSED

,MIN(CASE WHEN HC_TURN_REPORT_STATUS = 'Fail' AND TICKET_CREATED_DATE >= HC_TURN_COMPLETED_DATE
		THEN TICKET_CREATED_DATE ELSE NULL END ) AS TKT_Created_HARD_Fail
		
,MAX(CASE WHEN HC_TURN_REPORT_STATUS ='Fail' AND TICKET_CREATED_DATE >= HC_TURN_COMPLETED_DATE
		THEN COALESCE(CLIENT_INVOICE_DATE,WO_CLOSED_DATE,VENDOR_INVOICE_DATE) ELSE NULL END ) AS TKT_Closed_HARD_Fail
		
,MIN(CASE WHEN Turnkey.PASS_MINOR = 'Pass (Minor Fail)' AND TICKET_CREATED_DATE >= HC_TURN_COMPLETED_DATE
		THEN TICKET_CREATED_DATE ELSE NULL END ) AS TKT_Created_MINOR_Fail
		
,MAX(CASE WHEN Turnkey.PASS_MINOR = 'Pass (Minor Fail)' AND TICKET_CREATED_DATE >= HC_TURN_COMPLETED_DATE
		THEN COALESCE(CLIENT_INVOICE_DATE,WO_CLOSED_DATE,VENDOR_INVOICE_DATE) ELSE NULL END ) AS TKT_Closed_MINOR_Fail
		
,SUM(GREATEST(COALESCE(CLIENT_INVOICE_AMOUNT,CLIENT_ESTIMATE),COALESCE(CLIENT_ESTIMATE,CLIENT_INVOICE_AMOUNT))) AS TKT_COST

FROM WO_DETAIL
JOIN WO_TURN 
				ON WO_TURN.TICKET_KEY = WO_DETAIL.TICKET_KEY
				AND (CASE WHEN WO_DETAIL.WORKORDER_KEY IS NULL THEN 1=1
				ELSE WO_TURN.WORKORDER_KEY = WO_DETAIL.WORKORDER_KEY END)
								
LEFT JOIN Turnkey ON Turnkey.O_Turn_ID  =  WO_TURN.O_Turn_ID
				
GROUP BY
WO_TURN.O_TURN_ID
)
--SELECT * FROM TURN_WO_SUMMARY 
--WHERE O_TURN_ID =  23369
--**************************************************************************************

 
 SELECT
Turnkey.*
,f_listing.RENT_LIST_HIST_ID AS RENT_LIST_HIST_KEY
,d_listing.LISTING_DATE AS N_Listing_Date
,f_listing.CURRENT_LIST_PRICE AS N_Listing_Price
,d_listing.listing_status AS N_Listing_Status
,TKT_CREATED_MIN
,TKT_CREATED_MAX
,TKT_Closed_Max
,TKT_WOS_OPEN
,TKT_WOS_CLOSED
,TKT_CREATED_HARD_FAIL
,TKT_CLOSED_HARD_FAIL
,TKT_CREATED_MINOR_FAIL
,TKT_CLOSED_MINOR_FAIL
,WO_STATUS
,WO_END_DATE
,WO_REQUESTED_DATE
,WO_NOTE_TEXT
,WO_NOTE_CREATED_DATE
,WO_NOTE_ADDED_BY

,CASE WHEN (TKT_WOS_OPEN IS NULL OR HC_TURN_REPORT_STATUS ='Pass') AND PASS_MINOR IS NULL
	THEN COALESCE(TKT_COST,0)
	ELSE TKT_COST 
	END AS TKT_COST

,CASE WHEN (TKT_WOS_OPEN IS NULL OR HC_TURN_REPORT_STATUS ='Pass') AND (HC_TURN_COMPLETED_DATE IS NOT NULL OR N_LEASE_FROM_DATE IS NOT NULL OR TKT_Closed_Max IS NOT NULL)
      THEN LEAST(
                 COALESCE(HC_TURN_COMPLETED_DATE, '12/31/9999'::date),
                 COALESCE(N_LEASE_FROM_DATE, '12/31/9999'::date),
                 COALESCE(TKT_Closed_Max, '12/31/9999'::date))
      ELSE NULL
      END AS TURN_COMPLETED
      
,CASE WHEN (TKT_WOS_OPEN IS NULL OR HC_TURN_REPORT_STATUS ='Pass') AND (HC_TURN_COMPLETED_DATE IS NOT NULL OR N_LEASE_FROM_DATE IS NOT NULL OR TKT_Closed_Max IS NOT NULL)
      THEN DATE_TRUNC('month',
      			 LEAST(  
      			 COALESCE(HC_TURN_COMPLETED_DATE, '12/31/9999'::date),
                 COALESCE(N_LEASE_FROM_DATE, '12/31/9999'::date),
                 COALESCE(TKT_Closed_Max, '12/31/9999'::date)))::date
      ELSE NULL
      END AS TURN_COMPLETED_BOM
      
,CASE WHEN Turnkey.O_CURRENT_RENT > 0 AND COALESCE(Turnkey.N_INITIAL_RENT,Turnkey.N_CURRENT_RENT) >0  
      THEN DIV0NULL(COALESCE(Turnkey.N_INITIAL_RENT,Turnkey.N_CURRENT_RENT), Turnkey.O_CURRENT_RENT) - 1
	  ELSE NULL END AS RENT_GROWTH
	  
,CASE WHEN Turnkey.O_CURRENT_RENT > 0 AND f_listing.CURRENT_LIST_PRICE >0  
      THEN  DIV0NULL(COALESCE( f_listing.CURRENT_LIST_PRICE,Turnkey.N_CURRENT_RENT), Turnkey.O_CURRENT_RENT) - 1
	  ELSE NULL END AS RENT_GROWTH_LIST


,CASE WHEN Turnkey.O_Move_Out IS NOT NULL AND HC_SCOPE_COMPLETED_DATE IS NOT NULL THEN DATEDIFF(DAY, Turnkey.O_Move_Out, HC_SCOPE_COMPLETED_DATE) 
	  ELSE NULL END AS "Days_MoveOut_Scope"
	  
,CASE WHEN HC_SCOPE_COMPLETED_DATE IS NOT NULL AND TKT_CREATED_MIN IS NOT NULL THEN DATEDIFF(DAY,  HC_SCOPE_COMPLETED_DATE, TKT_CREATED_MIN) 
	  ELSE NULL END AS "Days_Scope_TKT_Created"
	  	  
,CASE WHEN TKT_CREATED_MIN IS NOT NULL AND TKT_Closed_Max IS NOT NULL THEN DATEDIFF(DAY, TKT_CREATED_MIN, TKT_Closed_Max) 
	  ELSE NULL END AS "Days_TKT_Created_TKT_Closed"
	  
,CASE WHEN Turnkey.O_Move_Out IS NOT NULL AND COALESCE(TKT_Closed_Max, HC_TURN_COMPLETED_DATE) IS NOT NULL THEN DATEDIFF(DAY, Turnkey.O_Move_Out, COALESCE(TKT_Closed_Max, HC_TURN_COMPLETED_DATE))
	  ELSE NULL END AS "Days_MO_TKT_Closed"
	  
,CASE WHEN TKT_Closed_Max IS NOT NULL AND HC_TURN_COMPLETED_DATE IS NOT NULL THEN DATEDIFF(DAY, TKT_Closed_Max, HC_TURN_COMPLETED_DATE) 
	  ELSE NULL END AS "Days_TKT_Closed_QC"
	  
,CASE WHEN d_listing.LISTING_DATE IS NOT NULL AND HC_TURN_COMPLETED_DATE IS NOT NULL THEN DATEDIFF(DAY, HC_TURN_COMPLETED_DATE, d_listing.LISTING_DATE) 
	  ELSE NULL END AS "Days_QC_List"
	  
,CASE WHEN Turnkey.O_Move_Out IS NOT NULL AND HC_TURN_COMPLETED_DATE IS NOT NULL THEN DATEDIFF(DAY, Turnkey.O_Move_Out, HC_TURN_COMPLETED_DATE)
	  ELSE NULL END AS "Days_MoveOut_Closed_QC"
	  
,CASE WHEN Turnkey.O_Move_Out IS NOT NULL AND d_listing.LISTING_DATE IS NOT NULL THEN DATEDIFF(DAY, COALESCE(Turnkey.O_Move_Out,O_AnticipatedMoveOutDate), d_listing.LISTING_DATE) 
	  ELSE NULL END AS "Days_MoveOut_List"
	  
,CASE WHEN Turnkey.O_Move_Out IS NOT NULL AND N_HOLDING_FEE_DATE IS NOT NULL THEN DATEDIFF(DAY, Turnkey.O_Move_Out, N_HOLDING_FEE_DATE) 
	  ELSE NULL END AS "Days_MoveOut_HoldingFee"

,CASE WHEN Turnkey.O_Move_Out IS NOT NULL AND N_MoveIn IS NOT NULL THEN DATEDIFF(DAY, Turnkey.O_Move_Out, N_MoveIn) 
	  ELSE NULL END AS "Days_MoveOut_MoveIn"
	  
,CASE WHEN N_MoveIn IS NULL THEN COALESCE (DATEDIFF(DAY, COALESCE(Turnkey.O_Move_Out,O_AnticipatedMoveOutDate), GETDATE()) , 0)
	  ELSE NULL END  AS "Days_ActiveInTurn"
	  
,CASE WHEN d_listing.LISTING_DATE IS NOT NULL THEN  DATEDIFF(DAY, d_listing.LISTING_DATE, COALESCE (N_MoveIn,GETDATE()) )
	  ELSE NULL END  AS "Days_On_Market"
	  
,CASE WHEN DATEDIFF(DAY, Turnkey.O_Move_Out, GETDATE()) <=30 THEN 'Under 30 Days' ELSE 'Over 30 Days' END AS MOVE_OUT_TIMING	  
	  
,CASE WHEN d_listing.listing_status IN ('Active') AND WO_END_DATE IS NOT NULL AND WO_END_DATE >= Listing_MI_READY_DATE AND  WO_END_DATE >= GETDATE()  THEN 'Push MIRD' ELSE NULL END AS MIRD_FLAG
	  
,DATE_TRUNC('month', d_listing.LISTING_DATE) AS "1_N_List (BOM)"
,DATE_TRUNC('month', N_MoveIn) AS "1_N_Lease_FROM (BOM)"
,d_listing.IS_PUBLISHED AS N_IS_PUBLISHED
,CASE WHEN Turnkey.MOVEOUTCOMPLETE = 'Yes' THEN COALESCE(MOC.MoveOutCharges,0.001) ELSE NULL END AS MoveOutCharges
,RANK () OVER( PARTITION BY Turnkey.Property_key ORDER BY f_listing.RENT_LIST_HIST_ID DESC) AS RECENT_TURN_RANK
,CASE WHEN N_LISTING_DATE IS NOT NULL AND N_MoveIn IS NULL THEN 1 ELSE NULL END AS ON_MARKET_FLAG 

,CASE WHEN Turnkey.MOVEOUTCOMPLETE = 'Yes' THEN COALESCE(MoveOutReceipts_PAID,0.001) + COALESCE(MoveOutReceipts_CONCESSION,0.001) ELSE NULL END AS MoveOutReceipts_Final
,CASE WHEN Turnkey.MOVEOUTCOMPLETE = 'Yes' THEN COALESCE(MOC.MoveOutCharges,0.001) - COALESCE(MoveOutReceipts_PAID,0.001) - COALESCE(MoveOutReceipts_CONCESSION,0.001) ELSE NULL END AS MoveOutReceipts_OUTSTANDING

,MoveOutReceipts_PAID
,MoveOutReceipts_CONCESSION
,MoveOutReceipts_BAD_DEBT
,MoveOutReceipts_TOTAL

,CASE WHEN HSP.PROPERTY_SEPTIC_FEE = '35' THEN 'Yes' ELSE NULL END AS SEPTIC_FLAG
,CONVERT_TIMEZONE('EST', SODA_COMPLETION_DATE::date) AS SODA_COMPLETION_DATE

FROM Turnkey
LEFT JOIN Turn_Listings TL ON TL.O_Turn_ID = Turnkey.O_Turn_ID AND TL.Property_Key = Turnkey.Property_key
left join PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_RENTAL_LISTING_HIST f_listing on TL.rent_list_hist_key = f_listing.RENT_LIST_HIST_ID
left join PROD_ANALYTICS.DBT_RESICAP.DIM_LISTING d_listing on f_listing.LISTING_KEY = d_listing.LISTING_KEY and d_listing.CURRENT_FLAG = 'Y'
LEFT JOIN TURN_WO_SUMMARY TWS ON TWS.O_Turn_ID = Turnkey.O_Turn_ID 
LEFT JOIN MoveOutCharges MOC ON MOC.LeaseID = Turnkey.O_Turn_ID 
LEFT JOIN MoveOutReceipts MOR ON MOR.LeaseID = Turnkey.O_Turn_ID 
LEFT JOIN (
            SELECT
                UPPER(P.PROPERTY_ENTITY_ID) AS PROPERTY_ENTITY_ID
                ,P.PROPERTY_SEPTIC_FEE
                ,RANK () OVER(PARTITION BY UPPER(P.PROPERTY_ENTITY_ID) ORDER BY _FIVETRAN_SYNCED DESC) RANK 
                FROM PROD_REPLICA.HUBSPOT_2.PROPERTIES P
                QUALIFY Rank = 1 ) HSP ON HSP.PROPERTY_ENTITY_ID = Turnkey.EntityId

LEFT JOIN "PROD_ANALYTICS"."DBT_RESICAP"."FCT_TENANT_ACTIVITY" FTA ON FTA.Tenant_KEY = Turnkey.O_Tenant_KEY


WHERE 1=1
--AND Turnkey.EntityID = 'RPTX00219'
--AND Turnkey.O_Turn_ID = 23369`;

export const DW_MOVEOUT_SQL = `/* =============================================================================
   MOVE OUT DATASET
   -----------------------------------------------------------------------------
   Grain:   One row per current primary tenant (anchor DIM_TENANT T), carrying
            move-out / notice / eviction milestones plus the IMPORT_* early-term
            and rent-responsible charge calculations.
   CTE chain: MoveOutNotes, RENTLY -> final SELECT off DIM_TENANT.

   CLEANUP NOTES:
     [SYNC]  The single ORGANIZATION_KEY / ORGANIZATION_NAME CASE block in the
             final SELECT was updated from the prior three-group form
             (adding only 58,59 -> 'Hudson Oak') to the full six-group roll-up
             that mirrors the master PROPERTY script (source of truth).
             DELIBERATE OUTPUT CHANGE limited to the organization columns.
     [FLAG]  IMPORT_GL_ACCOUNT returns the integer literals 4550 and 4945500.
             Unlike the tenant-script '5530-0000' issue, these are written as
             plain integers (no dash), so they evaluate as intended GL codes and
             are LEFT UNCHANGED. Noting only so the value is on the record.
     No CTEs or joins dropped.

   ORG SYNC IMPACT (intended diff vs. original output):
        added 66                  -> 27 / 'RB DRC'
        62,63,64,65,68,69         -> 62 / 'Rocklyn Homes'
        61,70                     -> 61 / 'ROI Property Group'
        67                        -> 67 / 'Newstar'
   ============================================================================= */

WITH MoveOutNotes AS (
	SELECT
 	N.NOTEID AS LatestNoteID_MO
 	,N.NOTETEXT AS MO_Note
 	,N.CREATEDDATE  AS MO_NoteCreated
    ,P.PropertyId
    ,RANK() OVER( PARTITION BY P.PropertyId ORDER BY N.CREATEDDATE DESC) AS Recent_Rank

	FROM PROD_REPLICA.HBPM_DBO.NOTES N 
	LEFT JOIN PROD_REPLICA.HBPM_DBO.NOTETYPES NT ON NT.Id = N.NoteTypeId
	LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS LM ON LM.LookUpMasterId = N.ObjectTypeId
	LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI ON TI.UserID = N.ObjectId AND N.ObjectTypeId = 502 AND TI."_FIVETRAN_DELETED" = 'N'
	LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PAI ON PAI.UnitId = TI.UnitId AND PAI."_FIVETRAN_DELETED" ='N'
	LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES P ON P.PropertyID = PAI.PropertyId AND P."_FIVETRAN_DELETED" ='N'
 	WHERE N.NoteTypeId = 8
 --	AND PAI.PROPERTYID = 36301
 	QUALIFY Recent_Rank = 1)
 	
 --********************************************************************************************************************************************************
 ,RENTLY AS (
 SELECT
  MAX(STATUS_TITLE) AS Rently_Property_Status
  ,TRY_TO_NUMERIC(UNIT_)  AS PM_PropertyID
  FROM "PROD_REPLICA"."RENTLY"."_3_0_DATA"
  WHERE 1=1
  AND TRY_TO_NUMERIC(UNIT_) IS NOT NULL
  GROUP BY UNIT_
  )
  --********************************************************************************************************************************************************

  SELECT

 T.TENANT_KEY
,T.TENANT_INFORMATION_ID
,TS.USER_KEY
,T.LEASE_ID
,RANK() OVER (PARTITION BY TS.Property_KEY ORDER BY Lease_ID ASC) AS Lease_Rank 
--,RANK() OVER (PARTITION BY TS.Property_KEY ORDER BY Lease_ID DESC) AS Lease_Rank_Inv
,PU.PROPERTY_UNIT_KEY
,TS.Property_KEY
,P.HBPM_PROPERTY_ID
,PO.Portfolio_Name
,R.REGION_NAME
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
,P.Address
,P.EntityID
,PUS.CITY_KEY
,CI.CITY_NAME
,PUS.STATE_KEY
,S.STATE_NAME
,S.STATE_CODE
,P.ZIPCODE
,CASE WHEN PUS.Occupancy_Status = 'Trustee Lease Honored' THEN 'Trustee Leased' 
      WHEN PUS.Property_Status = 'Tenant Lease' AND PUS.Occupancy_Status = 'Vacant - Future Move In' THEN 'Tenant Leased'
      ELSE PUS.Occupancy_Status END AS Occupancy_Status

,U.FIRST_NAME
,U.LAST_NAME
 ,U.FULL_NAME
,U.USER_STATUS
,U.EMAIL_ADDRESS
,U.PHONE_NUMBER
,T.TENANT_STATUS
,T.TENANT_TYPE
,T.PRIMARY_TENANT
,T.EVICTION_STATUS
,T.MONTH_TO_MONTH
,T.LEASE_TERM
,to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd') AS NOTICE_DATE
,TLA.INITIAL_RENT_AMOUNT
,T.CURRENT_RENT
,to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd') AS CURRENT_LEASE_EXPIRATION_DATE
,to_date(TLA.LEASE_SIGNED_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_SIGNED_DATE
,to_date(TLA.LEASE_FROM_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_FROM_DATE
,to_date(TLA.LEASE_TO_DATE_KEY::TEXT,'yyyymmdd') AS LEASE_TO_DATE
,RESI_TSUM.IS_NOTICE
,RESI_TSUM.IS_UNDER_EVICTION

,DSA.HOLDING_FEE_PAID_DATE 
,CASE WHEN TI.MoveIn IS NOT NULL AND DSA.HOLDING_FEE_PAID_DATE IS NOT NULL THEN DATEDIFF(DAY, DSA.HOLDING_FEE_PAID_DATE,TI.MoveIn) 
      ELSE NULL END AS Days_HoldingFee_MoveIn

,TI.MoveIn
,DATE_TRUNC('month',TI.MoveIn) MOVEIN_BOM
,CASE 
	WHEN GREATEST(DATEDIFF(DAY, TI.MoveIn,COALESCE(TI.MoveOut,GETDATE())),0) <=5
	AND T.TENANT_STATUS = 'Past'
	THEN 1 ELSE 0
END AS EXCLUDE_FILTER

,TI.PurchaseLetterPostedDate
,TI.DateNotified
,TI.FiledWithCountyDate
,CASE WHEN TI.FiledWithCountyDate IS NOT NULL THEN 'Filed on' ELSE 'Not Filed On' END AS Filed_With_County_Status
,TI.ResidentServedDate
,TI.CourtDateSetDate
,TI.JudgementDate
,TI.LockoutScheduledDate
,TI.VacateDate
,TI.AnticipatedMoveOutDate
,TI.IsSection8
,TI.IsMonthtoMonthLease
,TI.TenantDecidedMonthtoMonth
,TI.DoNotRenew
,TI.ReasonForNotRenewingId
,CASE WHEN T.NOTICE_DATE_KEY IS NOT NULL AND TI.MoveOut IS NOT NULL 
      THEN DATEDIFF('day',to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd'),COALESCE(TI.MoveOut,TI.AnticipatedMoveOutDate)) END AS DAYS_OF_NOTICE
      
 ,CASE WHEN T.NOTICE_DATE_KEY IS NOT NULL AND to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd') IS NOT NULL 
      THEN DATEDIFF('day',TI.MoveOut,to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')) END AS DAYS_MO_BEFORE_EXP
      
,TI.MoveOut
,DATE_TRUNC('month',TI.MoveOut) MOVEOUT_BOM
,CASE WHEN TI.MoveOut IS NOT NULL THEN 1 ELSE 0 END AS MOVE_OUT_INDICATOR

,CASE WHEN TI.MoveOut IS NULL THEN NULL WHEN TI.MoveOutComplte = 'Y' THEN 'Yes' ELSE 'No' END AS MoveOutComplete
,CASE WHEN TI.MoveOut IS NULL THEN NULL WHEN TI.MoveOutComplte = 'Y' THEN 1 ELSE 0 END AS MoveOutComplete_Indicator

,DNR.DESCRIPTION AS REASONFORNOTRENEWINGNAME
,AM_PM.MoveInReady
,COALESCE(TI.MoveOut,TI.AnticipatedMoveOutDate,
	CASE WHEN (T.MONTH_TO_MONTH = 'Y' OR TI.TENANTDECIDEDMONTHTOMONTH = 1 OR TI.REASONFORNOTRENEWINGID = 3143 )
			 AND TI.AnticipatedMoveOutDate IS NULL THEN NULL ELSE 
		     to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd') END) AS  Move_Out_Forecast
		     
,DATE_TRUNC('month',COALESCE(TI.MoveOut,TI.AnticipatedMoveOutDate,
	CASE WHEN (T.MONTH_TO_MONTH = 'Y' OR TI.TENANTDECIDEDMONTHTOMONTH = 1 OR TI.REASONFORNOTRENEWINGID = 3143 )
			 AND TI.AnticipatedMoveOutDate IS NULL THEN NULL ELSE 
		     to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd') END)) AS  Move_Out_Forecast_BOM
		     
,CASE WHEN T.TENANT_STATUS = 'Notice'
      AND (DATEADD('day',30,TI.AnticipatedMoveOutDate) < to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd'))
      AND (TI.ReasonForNotRenewingId IS NULL OR TI.ReasonForNotRenewingId NOT IN (3157,3158,3156,3168,3142))
      THEN DATEDIFF('day',TI.AnticipatedMoveOutDate,to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd'))
      ELSE NULL
      END AS EARLY_TERM_DAYS

,CASE 
WHEN TI.MoveOut IS NOT NULL AND TI.MoveOutComplte = 'N' THEN 1
WHEN TI.MoveOut IS NOT NULL AND TI.MoveOutComplte = 'Y' AND DATEDIFF(DAY,TI.MoveOut,GETDATE()) BETWEEN 0 AND 180 THEN 1
WHEN TI.MoveOut IS NULL AND T.MONTH_TO_MONTH = 'N' AND COALESCE(TI.MoveOut,TI.AnticipatedMoveOutDate,to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')) < GETDATE() THEN 1 
WHEN DATEDIFF(DAY,COALESCE(TI.MoveOut,TI.AnticipatedMoveOutDate,to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')),GETDATE()) BETWEEN -60 AND 30 THEN 1
ELSE 0
END AS Move_Out_Forecast_Filter
,CASE 
	WHEN TI.MoveOut IS NULL
	AND ( T.MONTH_TO_MONTH = 'N' OR (T.MONTH_TO_MONTH = 'Y' AND TI.AnticipatedMoveOutDate < GETDATE()) )
	AND DATEDIFF(DAY,COALESCE (TI.MoveOut,TI.AnticipatedMoveOutDate,to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')),GETDATE()) >= 0 THEN 1 
	WHEN TI.MoveOut IS NULL
	AND T.MONTH_TO_MONTH = 'Y'
	AND DATEDIFF(DAY,COALESCE (TI.MoveOut,TI.AnticipatedMoveOutDate,to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')),GETDATE()) >= 0 THEN NULL
	ELSE 0 END AS Past_Move_Out
,'https:/honeybadgerpm.com/ReportingModule/ViewReport?reportId=1807&UnitId='||TI.UnitID||'&UserId='||TI.UserID||'#/' AS URL_SODA
,'https://honeybadgerpm.com/PropertyModule#/PropertyDetails/' || HBPM.PROPERTYID || '/' || PM_AI.UnitID ||'/0' AS HBPM_URL
,'https://honeybadgerpm.com/PeopleModule#/TenantDetails/' || U.USER_ID || '/' || T.TENANT_INFORMATION_ID   AS HBPM_TENANT_URL

,MO_NOTE.MO_Note
,MO_NOTE.MO_NoteCreated
,CASE WHEN T.TENANT_STATUS = 'Under Eviction' AND TI.AnticipatedMoveOutDate = LAST_DAY(GETDATE()) THEN 1 ELSE 0 END AS EVICITON_AMOD_FLAG
,GREATEST(DATEDIFF('day',TI.MoveOut,GETDATE()),0) AS Days_Since_MO
,RRQC.RRQCPassDate  AS RRQC_Result_Date
,CASE WHEN RRQC.RRQCPassDate IS NOT NULL THEN 'Pass' ELSE NULL END AS RRQC_Result
,AM_STRATEGY.STRATEGYNAME AS STRATEGY_NAME
,Rently.Rently_Property_Status
,CONVERT_TIMEZONE('EST', FTA.SODA_COMPLETION_DATE::date) AS SODA_COMPLETION_DATE
,date_trunc('month',CONVERT_TIMEZONE('EST', FTA.SODA_COMPLETION_DATE::date)) AS SODA_COMPLETION_DATE_BOM
,CASE WHEN TI.MoveOut IS NOT NULL AND FTA.SODA_COMPLETION_DATE IS NOT NULL 
      THEN DATEDIFF('day',TI.MoveOut,CONVERT_TIMEZONE('EST', FTA.SODA_COMPLETION_DATE::date))
      ELSE NULL 
      END AS DAY_TO_COMPLETE_SODA
 ,'Charge' AS IMPORT_TYPE 
 ,GETDATE() AS IMPORT_Due_Date
 
 ,CASE WHEN (DNR.DESCRIPTION = 'Military Transfer' OR T.TENANT_STATUS <> 'Notice') THEN NULL
 	
 WHEN DATEDIFF(DAY,TI.AnticipatedMoveOutDate, to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')) > 60 
 	  THEN TI.AnticipatedMoveOutDate

 	  WHEN DATEDIFF(DAY,TI.AnticipatedMoveOutDate, to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')) <= 60 
      AND to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd') <= to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')
     
      THEN GREATEST(
              LEAST(DATEADD('day',60,to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd')), DATEADD('day',30, to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY::TEXT,'yyyymmdd'))),
               to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd'))
    
      WHEN to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd') >= to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')
      THEN DATEADD('day',30,to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd'))
 	
 END AS RENT_RESPONSBLE_DATE
 
 
 ,CASE WHEN (DNR.DESCRIPTION = 'Military Transfer' OR T.TENANT_STATUS = 'Under Eviction') THEN NULL
	  
      WHEN DATEDIFF(DAY,TI.AnticipatedMoveOutDate, to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')) > 60 
       AND TI.AnticipatedMoveOutDate IS NOT NULL
       THEN ROUND(T.CURRENT_RENT * 2,2)
     
       WHEN DATEDIFF(DAY,TI.AnticipatedMoveOutDate, to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')) <= 60 
          AND to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd') <= to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')
          AND TI.AnticipatedMoveOutDate IS NOT NULL 
          AND T.NOTICE_DATE_KEY IS NOT NULL 
          THEN ROUND(
          GREATEST(
            DATEDIFF(DAY,TI.AnticipatedMoveOutDate,
            GREATEST(
              LEAST(DATEADD('day',60,to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd')), DATEADD('day',30, to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY::TEXT,'yyyymmdd'))),
               to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')))
              ,0)
          * T.CURRENT_RENT/30,2)

      WHEN to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd') >= to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')
          AND TI.AnticipatedMoveOutDate IS NOT NULL 
          AND T.NOTICE_DATE_KEY IS NOT NULL 
          THEN ROUND(GREATEST(LEAST(30,30 - DATEDIFF('day',to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd'),TI.AnticipatedMoveOutDate)),0) * T.CURRENT_RENT/30,2)
          
       ELSE NULL END AS IMPORT_AMOUNT
       
,CASE WHEN (DNR.DESCRIPTION = 'Military Transfer' OR T.TENANT_STATUS = 'Under Eviction') THEN NULL 
	   WHEN DATEDIFF(DAY,TI.AnticipatedMoveOutDate,to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')) > 60 AND TI.AnticipatedMoveOutDate IS NOT NULL
       THEN 4550 ELSE 4945500 END AS IMPORT_GL_ACCOUNT
       
 ,CASE WHEN (DNR.DESCRIPTION = 'Military Transfer' OR T.TENANT_STATUS = 'Under Eviction') THEN NULL 
	   WHEN DATEDIFF(DAY,TI.AnticipatedMoveOutDate,to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')) > 60 AND TI.AnticipatedMoveOutDate IS NOT NULL
       THEN 'Move Out Charges - Early Termination Fee' ELSE 'Insufficient Notice / Rent Responsible' END AS IMPORT_GL_ACCOUNT_DESC
 
 ,CASE WHEN (DNR.DESCRIPTION = 'Military Transfer' OR T.TENANT_STATUS = 'Under Eviction') THEN NULL 
	  WHEN DATEDIFF(DAY,TI.AnticipatedMoveOutDate,to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')) > 60 AND TI.AnticipatedMoveOutDate IS NOT NULL
       THEN  'Early Termination Fee'
     
        WHEN DATEDIFF(DAY,TI.AnticipatedMoveOutDate, to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')) <= 60 
          AND to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd') <= to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')
          AND TI.AnticipatedMoveOutDate IS NOT NULL 
          AND T.NOTICE_DATE_KEY IS NOT NULL 
       THEN 'Rent Responsible: ' || MONTH(TI.AnticipatedMoveOutDate) || '-' || DAY(TI.AnticipatedMoveOutDate) || ' - ' ||
       MONTH(GREATEST(
              LEAST(DATEADD('day',60,to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd')), DATEADD('day',30, to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY::TEXT,'yyyymmdd'))),
               to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd'))) || '-' ||
       DAY(GREATEST(
              LEAST(DATEADD('day',60,to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd')), DATEADD('day',30, to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY::TEXT,'yyyymmdd'))),
               to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')))
       
      WHEN to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd') >= to_date(TLA.CURRENT_LEASE_EXPIRATION_DATE_KEY ::TEXT,'yyyymmdd')
         AND TI.AnticipatedMoveOutDate IS NOT NULL 
         AND T.NOTICE_DATE_KEY IS NOT NULL 
       THEN 'Rent Responsible: ' || MONTH(TI.AnticipatedMoveOutDate) || '-' || DAY(TI.AnticipatedMoveOutDate) || ' - ' ||
       MONTH(DATEADD('day',30,to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd'))) || '-' || DAY(DATEADD('day',30,to_date(T.NOTICE_DATE_KEY::TEXT,'yyyymmdd')))
       
       ELSE NULL END AS IMPORT_DESCRIPTION
 
 , NULL AS IMPORT_HBPM_User
 , NULL AS IMPORT_Tenant_Note
 , NULL AS IMPORT_Tenant_Note_Type
 

FROM PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT T
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_ACTIVITY TS ON TS.TENANT_KEY = T.TENANT_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TLA ON TLA.TENANT_KEY = T.Tenant_Key
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_DEAL_STATUS_ACCUM DSA ON DSA.DEAL_KEY = TLA.DEAL_KEY 
LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI ON TI.TenantInformationId = T.TENANT_INFORMATION_ID
LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS DNR on DNR.LookUpMasterId = TI.ReasonForNotRenewingId
LEFT JOIN PROD_REPLICA.HBPM_DBO.DEALS PM_D ON PM_D.LEADUSERID = TI.USERID AND PM_D.UNITID =TI.UNITID AND PM_D.SECURITYDEPOSITID IS NOT null
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_USER U ON U.USER_KEY = TS.USER_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON P.PROPERTY_KEY = TS.PROPERTY_KEY
LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES HBPM ON HBPM.PROPERTYID = P.HBPM_PROPERTY_ID --*REPLCA DB*
LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PM_AI ON PM_AI.PROPERTYID  = HBPM.PROPERTYID AND PM_AI."_FIVETRAN_DELETED" = 'N' 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS ON PUS.PROPERTY_KEY  = P.PROPERTY_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_REGION R ON R.REGION_KEY = PUS.REGION_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_CITY CI ON CI.CITY_KEY = PUS.CITY_KEY 
LEFT JOIN PROD_REPLICA.HBPM_DBO.Cities PM_CI ON PM_CI.CityID = HBPM.CityID
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_STATE S ON S.STATE_KEY = PUS.STATE_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_LEAD L ON L.lead_key = TS.LEAD_KEY 
LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTIES HBAM ON HBAM.HBID = P.HBAM_PROPERTY_ID --*REPLCA DB*
LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTYMANAGEMENTS AM_PM ON AM_PM.PROPERTYMANAGEMENTID = HBAM.PropertyManagement_PropertyManagementId AND AM_PM.HBID = HBAM.HBID
LEFT JOIN (SELECT Max(Id) RRQC_ID ,HBID FROM PROD_REPLICA.HBAM_DBO.RRQCCHANGELOGS GROUP BY HBID) RRQC_MOST_RECENT ON RRQC_MOST_RECENT.HBID = P.HBAM_PROPERTY_ID
LEFT JOIN PROD_REPLICA.HBAM_DBO.RRQCCHANGELOGS RRQC ON RRQC.ID = RRQC_MOST_RECENT.RRQC_ID
LEFT JOIN PROD_REPLICA.HBAM_DBO.BidAndAuctions AM_BA ON AM_BA.BIDID = HBAM.BidAndAuction_BidId AND AM_BA.HBID = HBAM.HBID AND AM_BA."_FIVETRAN_DELETED" <> 'Y'
LEFT JOIN PROD_REPLICA.HBAM_DBO.Strategies AM_STRATEGY ON AM_STRATEGY.STRATEGYID = AM_BA.BIDSTRATEGYSTATUS 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_ACTIVITY FTA ON FTA.Tenant_KEY = T.Tenant_KEY

LEFT JOIN MoveOutNotes MO_Note ON MO_Note.PropertyID = P.HBPM_PROPERTY_ID
LEFT JOIN Rently Rently ON Rently.PM_PropertyID = P.HBPM_PROPERTY_ID

LEFT JOIN (SELECT 
		FCT_TENANT_SUMMARY_KEY 
		,TENANT_INFORMATION_ID 
		,AVERAGE_CREDIT_SCORE
		,R_TS.COMBINED_INCOME
		,NUMBER_OF_CHILDREN
		,OCCUPANTS
		,TENANT_AGE
		,MONTHLY_INCOME
		,IS_RETIRED
		,IS_NOTICE
		,IS_UNDER_EVICTION
		
		FROM PROD_ANALYTICS.RESICAP.FCT_TENANT_SUMMARY R_TS
		LEFT JOIN PROD_ANALYTICS.RESICAP.DIM_TENANT R_T ON R_T.TENANT_KEY = R_TS.TENANT_KEY ) RESI_TSUM ON RESI_TSUM.TENANT_INFORMATION_ID = T.TENANT_INFORMATION_ID
					
WHERE 1=1
AND T.CURRENT_FLAG = 'Y'
AND T.PRIMARY_TENANT = 'Y'
AND P.PROPERTY_STATE ='Active'
AND P.EntityID <> ''
AND TI._FIVETRAN_DELETED <> 'Y'
AND TI.RENTDUEDAY IS NOT NULL
--AND (PS.PROPERTY_STATUS_ID NOT IN (53,75) OR PS.PROPERTY_STATUS_ID IS NULL)
AND PO.Portfolio_KEY NOT IN (1845, 2210, 2207, 2218, 1952,1867, 1916,1852,1771,1919,1873,169)
AND P.Organization_KEY not IN (16,17)
AND PO.IS_Active_AM = 'Y'
AND PO.Current_Flag = 'Y'
AND P.Current_Flag = 'Y'
AND PU.Current_Flag = 'Y'
AND PUS.Occupancy_Status NOT IN ('Property SOLD','Not Managed')
AND T.TENANT_KEY NOT IN (76191)

--AND P.ENTITYID = 'RPGFL00013'`;

export const DW_DEALS_SQL = `/* =============================================================================
   DEALS DATASET
   -----------------------------------------------------------------------------
   Grain:      One row per deal (DIM_DEAL), enriched with lead, property,
               security-deposit / holding-fee transactions, Findigs application,
               the HubSpot application+deal pipeline stage (HUB_DEAL), and the
               matched rental listing.
   Anchor:     PROD_ANALYTICS.DBT_RESICAP.DIM_DEAL (D)
   Branches off the property foundation; shares its property-eligibility WHERE
   filters and organization roll-up logic.

   CLEANUP NOTES:
     [SYNC]  ORGANIZATION_KEY / ORGANIZATION_NAME CASE blocks updated to mirror
             the master PROPERTY script (source of truth). DELIBERATE OUTPUT
             CHANGE — see "ORG SYNC IMPACT".
     [FIX 1] DROPPED unused join: AM_CONS (HBAM_DBO.CONSTRUCTIONS) — referenced
             only in its own ON clause, never selected/filtered. Single-row
             lookup, so removal is output-identical.
     [FIX 2] DROPPED unused join: SUB (DIM_SUBDIVISION) — same situation.

   DELIBERATELY KEPT (look unused but are load-bearing):
     - CHG (charges subquery) is never SELECTed, but the PAY join depends on it
       via "PAY.Amount = CHG.Amount". Removing CHG would change PAY, which feeds
       HOLDING_FEE_DATE_NEW and REFUNDED_FLAG. KEPT.
     - PU is never SELECTed but is filtered in WHERE (PU.Current_Flag = 'Y').

   ORG SYNC IMPACT (intended diff vs. original deals output):
     Deals tied to these orgs previously fell through to ELSE (raw key +
     unmapped O.ORGANIZATION_NAME); after the sync they roll up:
        66                  -> 27 / 'RB DRC'
        62,63,64,65,68,69   -> 62 / 'Rocklyn Homes'
        61,70               -> 61 / 'ROI Property Group'
        67                  -> 67 / 'Newstar'
     An EXCEPT diff vs. the old output will show rows ONLY for these orgs.

   KNOWN FRAGILITIES (flagged, not changed):
     - FINDIGS.* and Deals.* are star-expanded; upstream column changes alter
       output shape.
     - PAY / CHG subqueries are hard-pinned to RECEIVABLE_ID = 1739849 in their
       WHERE clauses (looks like leftover debug scoping). Preserved as-is — VERIFY
       whether that filter is intentional, since it constrains the whole
       holding-fee/refund branch to one receivable.
     - "App Submit (BOM)" / "1_Lead (BOM)" etc. mix naming conventions; left as-is.
   ============================================================================= */


/* -----------------------------------------------------------------------------
   CTE: FINDIGS
   Most recent Findigs application per applicant. Star-expanded into DEALS via
   FINDIGS.* — adding columns here changes the final output shape.
   ----------------------------------------------------------------------------- */
WITH FINDIGS AS (
    SELECT
         FINDIGS_APP_ID
        ,FINDIGS_APPLICANT_ID
        ,FINDIGS_GROUP_ID
        ,APPLICATION_TOPICS_TOTAL
        ,APPLICATION_TOPICS_PROGRESS
        ,COALESCE(APPLICATION_TOPICS_PROGRESS / APPLICATION_TOPICS_TOTAL, 0) AS FINDIGS_APPLICATION_PERCENT_COMPLETE
        ,TO_DATE(GROUP_SUBMITTED_AT::TEXT, 'AUTO') AS FINDIGS_APPLICATION_SUBMITTED
        ,GROUP_STATUS          AS FINDIGS_APPLICATION_STATUS
        ,GROUP_WORKFLOW_STATUS AS FINDIGS_APPLICATION_WORKFLOW_STATUS
        ,TO_DATE(GROUP_DECISIONED_AT::TEXT,     'AUTO') AS FINDIGS_GROUP_DECISIONED_AT
        ,TO_DATE(GROUP_PENDING_REVIEW_AT::TEXT, 'AUTO') AS FINDIGS_GROUP_PENDING_REVIEW_AT
        ,APPLICANT_EMPLOYMENT_EMPLOYER_NAME
        ,APPLICANT_EMPLOYMENT_JOB_TITLE
        ,APPLICANT_EMPLOYMENT_START_DATE
        ,APPLICANT_EMPLOYMENT_STATUS
        ,APPLICANT_CURRENT_HOUSING_ADDRESS_LINE_1
        ,APPLICANT_CURRENT_HOUSING_CITY
        ,APPLICANT_CURRENT_HOUSING_STATE
        ,APPLICANT_CURRENT_HOUSING_ZIP
        ,APPLICANT_CURRENT_HOUSING_ADDRESS_LINE_1 || ', ' || APPLICANT_CURRENT_HOUSING_CITY || ', '
            || APPLICANT_CURRENT_HOUSING_STATE || ', ' || APPLICANT_CURRENT_HOUSING_ZIP AS APPLICANT_CURRENT_HOUSING_FULL_ADDRESS
        ,APPLICANT_CURRENT_HOUSING_TYPE
        ,APPLICANT_CURRENT_HOUSING_PAYMENT_AMOUNT
        ,APPLICANT_DESIRED_MOVE_IN_DATE
        ,APPLICANT_HOUSEHOLD_NUM_DEPENDENTS
        ,APPLICANT_HOUSEHOLD_NUM_PETS
        ,APPLICANT_HOUSEHOLD_NUM_VEHICLES
        ,RANK() OVER (PARTITION BY FINDIGS_APPLICANT_ID ORDER BY APPLICATION_LAST_UPDATED_AT DESC) AS FINDIGS_RECENT_RANK
    FROM SHARE_FINDIGS_RESICAP.PUBLIC.APPLICATIONS_RESICAP
    QUALIFY FINDIGS_RECENT_RANK = 1
)

/* -----------------------------------------------------------------------------
   CTE: DEALS
   The core deal row. Resolves property via a COALESCE across the payment,
   deal-status, and tenant-leasing sources, then applies property-eligibility
   filters.
   ----------------------------------------------------------------------------- */
,DEALS AS (
    SELECT
         P.PROPERTY_KEY

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

        ,P.HBPM_PROPERTY_ID
        ,P.EntityID
        ,PUS.Under_written_rent
        ,REC.RECEIEVABLE_ID
        ,PO.PORTFOLIO_NAME
        ,R.REGION_NAME

        -- ---- Deal core ----
        ,D.SECURITY_DEPOSIT_ID
        ,D.DEAL_KEY
        ,D.DEAL_ID
        ,COALESCE(D.CURRENT_DEAL_STATUS, HUB_DEAL.DEAL_STAGE) AS CURRENT_DEAL_STATUS
        ,HUB_DEAL.APP_ID
        ,HUB_DEAL.APP_STAGE AS APP_STAGE
        ,D.COMBINED_INCOME * 12 AS COMBINED_INCOME
        ,DSH.LEAD_KEY

        -- ---- Application timing ----
        ,D.APPLICATION_SUBMITTED_DATE::date AS Application_Submit_Date
        ,DATE_TRUNC('month', D.APPLICATION_SUBMITTED_DATE::date) AS "App Submit (BOM)"
        ,CONVERT_TIMEZONE('EST', APPLICATION_STARTED_DATE::date) AS Application_Started_Date
        ,DATE_TRUNC('month', CONVERT_TIMEZONE('EST', APPLICATION_STARTED_DATE)::date) AS App_Started_BOM
        ,DATEDIFF(DAY,
            COALESCE(D.APPLICATION_SUBMITTED_DATE,
                     TO_DATE(L.Application_SUBMIT_Date_KEY::TEXT, 'yyyymmdd'),
                     CONVERT_TIMEZONE('EST', APPLICATION_STARTED_DATE::date),
                     TO_DATE(DSH.DEAL_CREATE_DATE_KEY::TEXT, 'yyyymmdd')),
            GETDATE()) AS DAYS_SINCE_APP_SUBMIT

        -- ---- Lead identity ----
        ,L.First_Name || ' ' || L.Last_Name AS Lead_Name
        ,L.PRIMARY_LEAD_ID
        ,D.EMail
        ,L.PHONE
        ,TO_DATE(L.CREATED_DATE_KEY::TEXT, 'yyyymmdd') AS Lead_Created_Date
        ,DATE_TRUNC('month', TO_DATE(L.CREATED_DATE_KEY::TEXT, 'yyyymmdd')) AS "1_Lead (BOM)"

        -- ---- Deal lifecycle dates ----
        ,TO_DATE(DSH.DEAL_CREATE_DATE_KEY::TEXT,          'yyyymmdd') AS DEAL_CREATE_DATE
        ,TO_DATE(DSH.APPLICATION_APPROVED_DATE_KEY::TEXT, 'yyyymmdd') AS APPLICATION_APPROVED_DATE
        ,TO_DATE(DSH.DEAL_WON_DATE_KEY::TEXT,             'yyyymmdd') AS DEAL_WON_DATE
        ,COALESCE(HUB_DEAL.PROPERTY_HOLDING_FEE_TRANSACTION_DATE,
                  TO_DATE(PAY.HOLDING_FEE_DATE_NEW::TEXT,        'yyyymmdd'),
                  TO_DATE(DSH.HOLDING_FEE_PAID_DATE_KEY::TEXT,   'yyyymmdd')) AS HOLDING_FEE_DATE_NEW
        ,TO_DATE(DSH.LEASE_SIGNED_DATE_KEY::TEXT,        'yyyymmdd') AS LEASE_SIGNED_DATE
        ,TO_DATE(DSH.CONVERT_TO_RESIDENT_DATE_KEY::TEXT, 'yyyymmdd') AS CONVERT_TO_RESIDENT_DATE
        ,TO_DATE(DSH.EXPECTED_MOVE_IN_DATE_KEY::TEXT,    'yyyymmdd') AS EXPECTED_MOVE_IN_DATE
        ,COALESCE(TO_DATE(DSH.LEASE_START_DATE_KEY::TEXT,     'yyyymmdd'),
                  TO_DATE(DSH.EXPECTED_MOVE_IN_DATE_KEY::TEXT, 'yyyymmdd')) AS LEASE_START_DATE
        ,TO_DATE(DSH.LEASE_END_DATE_KEY::TEXT, 'yyyymmdd') AS LEASE_END_DATE
        ,U.USER_KEY
        ,TLA.Tenant_key
        ,COALESCE(TO_DATE(TLA.INITIAL_LEASE_FROM_DATE_KEY::TEXT, 'yyyymmdd'),
                  TO_DATE(TLA.LEASE_FROM_DATE_KEY::TEXT,         'yyyymmdd')) AS TENANT_MOVE_IN

        -- ---- Ownership / score / source ----
        ,D.DEAL_OWNER AS DEAL_OWNER
        ,L.CONTACT_OWNER
        ,D.AVERAGE_CREDIT_SCORE
        ,L.SOURCE
        ,'https://app.hubspot.com/contacts/22536354/record/0-3/' || D.DEAL_ID AS URL_HUBSPOT

        -- Net HF if converted to resident; otherwise the payment refund flag
        ,CASE WHEN DSH.CONVERT_TO_RESIDENT_DATE_KEY IS NOT NULL
              THEN 'Net HF'
              ELSE COALESCE(PAY.REFUNDED_FLAG, 'Net HF')
         END AS REFUNDED_FLAG

        ,PM_AI.MOVEINREADY AS PM_MIR
        ,DSH.LISTING_KEY

        -- ---- HubSpot deal/application pipeline detail (HUB_DEAL) ----
        ,HUB_DEAL.PROPERTY_LEASE_DRAFTING_STATUS    AS LEASE_DRAFTING_STATUS
        ,HUB_DEAL.PROPERTY_MOVE_IN_FEE_PAYMENT_LINK AS MOVE_IN_FEE_PAYMENT_LINK
        ,HUB_DEAL.PROPERTY_MOVE_IN_CHARGES_PAID     AS MOVE_IN_CHARGES_PAID
        ,HUB_DEAL.PROPERTY_DF_REFERENCE_NUMBER      AS MOVE_IN_CHARGES_REFERENCE_ID
        ,HUB_DEAL.PROPERTY_IS_SECTION_8             AS IS_SECTION_8
        ,HUB_DEAL.PROPERTY_CONCESSION_DOLLAR_AMOUNT AS CONCESSION_DOLLAR_AMOUNT
        ,HUB_DEAL.PROPERTY_DENIAL_DISPUTE
        ,HUB_DEAL.PROPERTY_DENIAL_DISPUTE_COMMENTS
        ,HUB_DEAL.PROPERTY_DENIAL_DISPUTE_REASON
        ,HUB_DEAL.PROPERTY_APPLICATION_DENIAL_REASON
        ,HUB_DEAL.PROPERTY_RENT_QUALIFICATION_DEFICIT
        ,DEAL_LOST.DEAL_LOST_REASON

        ,CASE
            WHEN HUB_DEAL.APP_STAGE IN ('Full Approval', 'Conditional Approval')
                THEN 'Pending HF'
            WHEN HUB_DEAL.APP_STAGE IN ('Aplication Started', 'Application Started')
                THEN COALESCE(ROUND(FINDIGS_APPLICATION_PERCENT_COMPLETE * 100, 0), 0) || '%'
            ELSE HUB_DEAL.APP_STAGE
         END AS APP_STAGE_DETAIL

        -- All Findigs columns (star-expanded — see CTE note)
        ,FINDIGS.*

    FROM PROD_ANALYTICS.DBT_RESICAP.DIM_DEAL D

        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_DEAL_STATUS_ACCUM DSH
            ON DSH.DEAL_KEY = D.Deal_Key
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_LEAD L
            ON L.LEAD_KEY = DSH.Lead_Key
        LEFT JOIN "PROD_REPLICA"."HUBSPOT_2"."CONTACT" C
            ON C.ID = L.LEAD_ID

        /* Receivable id from HubSpot deal-property history */
        LEFT JOIN (
            SELECT Deal_ID, Value AS RECEIEVABLE_ID
            FROM PROD_REPLICA.HUBSPOT.DEAL_PROPERTY_HISTORY
            WHERE 1 = 1
                AND NAME = 'account_receivable'
                AND _FIVETRAN_ACTIVE = 'Y'
        ) REC
            ON REC.DEAL_ID = D.DEAL_ID

        /* Security-deposit CHARGE rows (>= $500, GL 18).
           NOTE: never selected, but PAY joins on CHG.Amount — load-bearing. */
        LEFT JOIN (
            SELECT Charge_DATE_KEY, Property_Key, Receivable_ID, Amount
            FROM PROD_ANALYTICS.DBT_RESICAP.FCT_LEASING_TRANSACTION
            WHERE TRANSACTION_TYPE = 'Charges'
                AND Amount >= 500
                AND GL_ACCOUNT_KEY IN (18)
        ) CHG
            ON CHG.Receivable_ID = TRY_CAST(REC.RECEIEVABLE_ID AS INTEGER)

        /* Security-deposit PAYMENT rows + refund detection. */
        LEFT JOIN (
            SELECT
                 LT.PROPERTY_KEY
                ,MIN(LT.RECEIVED_ON_DATE_KEY) AS HOLDING_FEE_DATE_NEW
                ,REFUND.REFUNDED_FLAG
                ,MIN(LT.PAID_BY_USER_KEY) AS PAID_BY_USER_KEY
                ,LT.RECEIVABLE_ID
                ,LT.TENANT_KEY
                ,LT.AMOUNT
            FROM PROD_ANALYTICS.DBT_RESICAP.FCT_LEASING_TRANSACTION LT
                LEFT JOIN (
                    SELECT
                         'Refunded' AS REFUNDED_FLAG
                        ,PROPERTY_KEY
                        ,PAID_BY_USER_KEY
                        ,AMOUNT
                    FROM PROD_ANALYTICS.DBT_RESICAP.FCT_LEASING_TRANSACTION
                    WHERE 1 = 1
                        AND TRANSACTION_TYPE = 'Payment'
                ) REFUND
                    ON  REFUND.PROPERTY_KEY     = LT.PROPERTY_KEY
                    AND REFUND.PAID_BY_USER_KEY = LT.PAID_BY_USER_KEY
                    AND REFUND.AMOUNT           = (LT.AMOUNT * -1)
            WHERE 1 = 1
                AND LT.TRANSACTION_TYPE = 'Payment'
                AND LT.Amount >= 500
                AND LT.GL_ACCOUNT_KEY IN (18, -1)   -- SD
                AND LT.RECEIVABLE_ID = 1739849      -- FRAGILITY: hard-pinned receivable (verify intent)
            GROUP BY
                 LT.PROPERTY_KEY
                ,LT.RECEIVABLE_ID
                ,LT.TENANT_KEY
                ,LT.AMOUNT
                ,REFUND.REFUNDED_FLAG
        ) PAY
            ON  PAY.Receivable_ID = TRY_CAST(REC.RECEIEVABLE_ID AS INTEGER)
            AND PAY.Amount        = CHG.Amount

        /* Deal user (status-accum user, falling back to the payer) */
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_USER U
            ON U.USER_KEY = CASE WHEN DSH.User_key <> -1 THEN DSH.User_key
                                 ELSE PAY.PAID_BY_USER_KEY END

        /* Tenant leasing accumulator (deleted/invalid tenants filtered out) */
        LEFT JOIN (
            SELECT TLA.*
            FROM PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TLA
                LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT T
                    ON T.Tenant_KEY = TLA.Tenant_key
                LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI
                    ON TI.TENANTINFORMATIONID = T.TENANT_INFORMATION_ID
            WHERE TI._FIVETRAN_DELETED <> 'Y'
                AND RENTDUEDAY IS NOT NULL
                AND T.TENANT_KEY NOT IN (70575)
        ) TLA
            ON TLA.USER_KEY = U.User_key

        /* Resolve the property: payment property, else deal-status property,
           else tenant-leasing property. */
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P
            ON P.PROPERTY_KEY = COALESCE(
                   PAY.Property_Key,
                   CASE WHEN DSH.PROPERTY_KEY <> -1 THEN DSH.PROPERTY_KEY
                        ELSE TLA.PROPERTY_KEY END)

        /* Property dimensions + eligibility-filter sources */
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS
            ON PUS.PROPERTY_KEY = P.PROPERTY_KEY
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU
            ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY   -- used by WHERE (PU.Current_Flag)
        LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES HBPM
            ON HBPM.PROPERTYID = P.HBPM_PROPERTY_ID
        LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PM_AI
            ON  PM_AI.PROPERTYID = HBPM.PROPERTYID
            AND PM_AI."_FIVETRAN_DELETED" = 'N'
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO
            ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_REGION R
            ON R.REGION_KEY = PUS.REGION_KEY
        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O
            ON O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY
        LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTIES HBAM
            ON HBAM.HBID = P.HBAM_PROPERTY_ID

        LEFT JOIN FINDIGS
            ON FINDIGS.FINDIGS_APPLICANT_ID = C.PROPERTY_FINDIGS_APPLICANT_ID

        /* Deal lost reason from HubSpot deal-property history */
        LEFT JOIN (
            SELECT DEAL_ID, VALUE AS DEAL_LOST_REASON
            FROM "PROD_REPLICA"."HUBSPOT_2"."DEAL_PROPERTY_HISTORY"
            WHERE 1 = 1
                AND name = 'deal_lost_reason'
                AND _FIVETRAN_ACTIVE = 'TRUE'
        ) DEAL_LOST
            ON DEAL_LOST.DEAL_ID = D.DEAL_ID

        /* ------------------------------------------------------------------
           HUB_DEAL: HubSpot replica section.
           Reconciles the deal (HD) and application (APP) sides of the pipeline
           via a FULL JOIN so a deal can be matched to its application stage
           even when only one side exists, then ranks to one row per deal.
           ------------------------------------------------------------------ */
        LEFT JOIN (
            SELECT
                 APP.PROPERTY_HOLDING_FEE_TRANSACTION_DATE
                ,CAST(COALESCE(HD.DEAL_PIPELINE_STAGE_ID, APP.PROPERTY_HS_PIPELINE_STAGE) AS INT) AS DEAL_PIPELINE_STAGE_ID
                ,COALESCE(D.DEAL_KEY, APP.APP_ID) AS DEAL_KEY_JOIN
                ,DPS.Label AS DEAL_STAGE
                ,APP_ID
                ,CASE APP.PROPERTY_HS_PIPELINE_STAGE
                    WHEN 59173506 THEN 'Aplication Started'
                    WHEN 93217140 THEN 'Needs New Property'
                    WHEN 59173507 THEN 'Under Review'
                    WHEN 59187121 THEN 'Conditional Approval'
                    WHEN 59187122 THEN 'Full Approval'
                    WHEN 59187127 THEN 'Denial'
                    WHEN 59187123 THEN 'Pre-Lease Compliance'
                    WHEN 59187124 THEN 'Lease Drafting'
                    WHEN 59187125 THEN 'Lease Executed'
                    WHEN 59187126 THEN 'Move-In Scheduled'
                    WHEN 59187128 THEN 'Closed Lost'
                    ELSE NULL
                 END AS APP_STAGE
                ,RANK() OVER (
                    PARTITION BY COALESCE(D.DEAL_KEY, APP.APP_ID)
                    ORDER BY HD.PROPERTY_HS_LASTMODIFIEDDATE, APP.APP_ID DESC
                 ) AS DEAL_RANK
                ,HD.PROPERTY_LEASE_DRAFTING_STATUS
                ,HD.PROPERTY_LEASE_SIGNED_DATE
                ,HD.PROPERTY_MOVE_IN_FEE_PAYMENT_LINK
                ,HD.PROPERTY_MOVE_IN_CHARGES_PAID
                ,HD.PROPERTY_DF_REFERENCE_NUMBER
                ,HD.PROPERTY_IS_SECTION_8
                ,HD.PROPERTY_CONCESSION_DOLLAR_AMOUNT
                ,APP.PROPERTY_DENIAL_DISPUTE
                ,APP.PROPERTY_DENIAL_DISPUTE_COMMENTS
                ,APP.PROPERTY_DENIAL_DISPUTE_REASON
                ,APP.PROPERTY_APPLICATION_DENIAL_REASON
                ,APP.PROPERTY_RENT_QUALIFICATION_DEFICIT
            FROM PROD_ANALYTICS.DBT_RESICAP.DIM_DEAL D
                LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_DEAL_STATUS_ACCUM DSH
                    ON DSH.DEAL_KEY = D.Deal_Key
                LEFT JOIN PROD_REPLICA.HUBSPOT_2.DEAL HD
                    ON HD.DEAL_ID = D.DEAL_ID
                LEFT JOIN PROD_REPLICA.HUBSPOT_2.APPLICATION_TO_DEAL ATD
                    ON ATD.TO_ID = D.DEAL_ID

                /* Application side: most recent app->property mapping per app,
                   excluding known merged/bad app ids. */
                FULL JOIN (
                    SELECT DISTINCT
                         A.ID AS APP_ID
                        ,A.PROPERTY_RENT_QUALIFICATION_DEFICIT
                        ,A.PROPERTY_UNIT_ID
                        ,A.PROPERTY_HS_PIPELINE_STAGE
                        ,A.PROPERTY_HOLDING_FEE_TRANSACTION_DATE
                        ,P.PROPERTY_KEY
                        ,A.PROPERTY_DENIAL_DISPUTE
                        ,A.PROPERTY_DENIAL_DISPUTE_COMMENTS
                        ,A.PROPERTY_DENIAL_DISPUTE_REASON
                        ,A.PROPERTY_APPLICATION_DENIAL_REASON
                    FROM PROD_REPLICA.HUBSPOT_2.APPLICATION A
                        LEFT JOIN (
                            SELECT *,
                                RANK() OVER (PARTITION BY FROM_ID ORDER BY _FIVETRAN_SYNCED DESC) AS RECENT_RANK
                            FROM PROD_REPLICA.HUBSPOT_2.APPLICATION_TO_PROPERTIES
                            QUALIFY RECENT_RANK = 1
                        ) ATP
                            ON ATP.FROM_ID = A.ID
                        LEFT JOIN PROD_REPLICA.HUBSPOT_2.PROPERTIES H_P
                            ON H_P.ID = ATP.TO_ID
                        LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P
                            ON P.HBPM_PROPERTY_ID = H_P.PROPERTY_PROPERTY_ID
                    WHERE IS_INTEGER(A.PROPERTY_HS_PIPELINE_STAGE) = 'True'
                        AND A.PROPERTY_UNIT_ID IS NOT NULL
                        AND APP_ID NOT IN (8472470544, 8657787708, 8657665830, 6854090788)  -- merged bad data
                ) APP
                    ON  APP.APP_ID       = ATD.FROM_ID
                    AND APP.PROPERTY_KEY = DSH.PROPERTY_KEY

                LEFT JOIN (
                    SELECT *
                    FROM PROD_REPLICA.HUBSPOT_2.DEAL_PIPELINE_STAGE
                    WHERE _FIVETRAN_DELETED = 'N'
                ) DPS
                    ON DPS.STAGE_ID = HD.DEAL_PIPELINE_STAGE_ID
            WHERE 1 = 1
            QUALIFY DEAL_RANK = 1
        ) HUB_DEAL
            ON HUB_DEAL.DEAL_KEY_JOIN = D.DEAL_KEY

    WHERE 1 = 1
        AND P.Property_KEY IS NOT NULL
        AND D.DEAL_PIPELINE <> 'Tour Pipeline'
        AND D.DEAL_PIPELINE <> 'Renewals'
        AND D.CURRENT_flag = 'Y'
        AND (L.CURRENT_Flag = 'Y' OR DSH.LEAD_KEY = -1)
        AND (L.IS_MERGED_LEAD IS NULL OR IS_MERGED_LEAD = 'N')
        AND DSH.LEAD_KEY IS NOT NULL
        AND (TLA.TENANT_INFORMATION_ID <> 36986 OR TLA.TENANT_INFORMATION_ID IS NULL)

        /* Property-eligibility filters (mirror master property script) */
        AND (HBAM.PROPERTYSTATUSID > 9 OR HBAM.PROPERTYSTATUSID IS NULL)          -- out of bid
        AND P.PROPERTY_STATE = 'Active'
        AND P.EntityID <> ''
        AND (HBAM.PROPERTYSTATUSID NOT IN (53, 75) OR HBAM.PROPERTYSTATUSID IS NULL)
        AND PO.Portfolio_KEY NOT IN (223,598,147,102,109,28,603,169,602,170,58,54,169)
        AND PUS.Organization_KEY NOT IN (16, 17)
        AND PO.IS_Active_AM = 'Y'
        AND PO.Current_Flag = 'Y'
        AND P.Current_Flag = 'Y'
        AND PU.Current_Flag = 'Y'
        AND PUS.Occupancy_Status NOT IN ('Not Managed')
        AND (HBPM.PROPERTYSTATEID = 26 OR HBPM.PROPERTYSTATEID IS NULL)
)


/* =============================================================================
   FINAL SELECT
   Deal rows + matched listing + derived day/month metrics.
   ============================================================================= */
SELECT
     Deals.*
    ,RLH.RENT_LIST_HIST_ID
    ,TO_DATE(RLH.LISTING_DATE_KEY::TEXT, 'yyyymmdd') AS LISTINGDATE
    ,DATEDIFF('day', TO_DATE(RLH.LISTING_DATE_KEY::TEXT, 'yyyymmdd'), GETDATE()) AS LISTING_DOM
    ,RLH.CURRENT_LIST_PRICE AS CurrentListPrice
    ,RLH.LISTING_STATUS     AS Listing_Status

    ,CASE WHEN TO_DATE(RLH.LISTING_DATE_KEY::TEXT, 'yyyymmdd') IS NOT NULL
               AND HOLDING_FEE_DATE_NEW IS NOT NULL
          THEN DATEDIFF(DAY, TO_DATE(RLH.LISTING_DATE_KEY::TEXT, 'yyyymmdd'), HOLDING_FEE_DATE_NEW)
          ELSE NULL
     END AS "Days_List-HF"

    ,CASE WHEN Deals.LEASE_START_DATE IS NOT NULL
          THEN DATEDIFF(DAY, HOLDING_FEE_DATE_NEW, Deals.LEASE_START_DATE)
          ELSE NULL
     END AS "Days_Until_MI"

    ,DATE_TRUNC('month', HOLDING_FEE_DATE_NEW) AS "HF (BOM)"
    ,DATE_TRUNC('month', DEAL_CREATE_DATE)     AS "DEAL_CREATED (BOM)"

FROM Deals
    LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_RENTAL_LISTING_HIST RLH
        ON RLH.LISTING_KEY = Deals.LISTING_KEY
WHERE 1 = 1`;


export const DW_OFF_MARKET_SQL = `/* =============================================================================
   OFF MARKET DATASET
   -----------------------------------------------------------------------------
   Grain:   One row per active property (anchor DIM_PROPERTY P), enriched with
            most-recent + initial rental listing, AM/MM/QC status, Rently device
            data, construction/BuilderMetrix milestones, off-market notes, UW rent.
   CTE chain: PICS, OffMarketNote, RENTLY_CLEAN, UW_RENT_MAX/UW_RENT, VANDALISM,
            WO, WO_Summary, MAX_LEASE, Tenant_Listings, BUILDER_MATRIX_DETAIL,
            BUILDER_MATRIX_SUMMARY, HUBSPOT -> final SELECT.

   CLEANUP NOTES:
     [SYNC]  The single ORGANIZATION_KEY / ORGANIZATION_NAME CASE block in the
             final SELECT was updated to the full six-group roll-up that mirrors
             the master PROPERTY script (source of truth). The prior form used an
             extended member list for group 27 but was missing org 66 and the
             58/59, 62.., 61/70, 67 groups. DELIBERATE OUTPUT CHANGE limited to
             the organization columns.
     No CTEs or joins dropped. MAX_LEASE and Tenant_Listings are defined-but-
             unused in the original and preserved as-is; the PM_OC and AM_INS
             joins (also unreferenced in SELECT) are likewise preserved.

   ORG SYNC IMPACT (intended diff vs. original output):
        added 66                  -> 27 / 'RB DRC'
        58,59                     -> 58 / 'Hudson Oak'
        62,63,64,65,68,69         -> 62 / 'Rocklyn Homes'
        61,70                     -> 61 / 'ROI Property Group'
        67                        -> 67 / 'Newstar'
   ============================================================================= */

WITH PICS AS (

 SELECT
  MAX(PHOTO_COUNT) AS Picture_Count
  ,TRY_TO_NUMERIC(UNIT_) AS PM_PropertyID
  FROM "PROD_REPLICA"."RENTLY"."_3_0_DATA"
  WHERE 1=1
  AND TRY_TO_NUMERIC(UNIT_) IS NOT NULL
  GROUP BY UNIT_
)

,OffMarketNote AS (
		SELECT DISTINCT 
	 	N.NOTEID AS LatestNoteID
	 	,N.NOTETEXT AS OffMarketNote
	 	,N.CREATEDDATE  AS OffMarketNoteCreated
	 	,DATEDIFF('Day',N.CREATEDDATE,GETDATE()) OffMarketNote_Days
	    ,P.PropertyId
	    ,U.FIRSTNAME || ' ' || U.LASTNAME AS OffMarketNote_Added_By
	    ,RANK() OVER( PARTITION BY P.PropertyId ORDER BY N.CREATEDDATE DESC) AS Recent_Rank
	
		FROM PROD_REPLICA.HBPM_DBO.NOTES N 
		LEFT JOIN PROD_REPLICA.HBPM_DBO.NOTETYPES NT ON NT.Id = N.NoteTypeId
		LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS LM ON LM.LookUpMasterId = N.ObjectTypeId
		LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES P ON P.PropertyID = N.ObjectID AND P."_FIVETRAN_DELETED" ='N'
		LEFT JOIN PROD_REPLICA.HBPM_DBO.USERS U ON U.USERID  = N.ADDEDBY 
	 	WHERE N.NoteTypeId = 20
	 --	AND PAI.PROPERTYID = 36301
	 	QUALIFY Recent_Rank = 1)

--*******************************************

,RENTLY_CLEAN AS (
SELECT 
 Rently.ID AS Rently_Prop_ID
,TRY_TO_NUMERIC(Rently.UNIT_) AS UNIT_
,Rently.STARDARD_ADDRESS
,Rently.LOCKBOX
,Rently.STATUS_TITLE
,Rently.ACTIVE
,to_date(Rently.LB_ASSIGNED_DATE::TEXT,'AUTO') LB_ASSIGNED_DATE
,to_date(Rently.AUTOSHOWING_DATE::TEXT,'AUTO') AUTOSHOWING_DATE
,RANK() OVER( PARTITION BY Rently.UNIT_ ORDER BY Rently.LB_ASSIGNED_DATE DESC, DATE_TRUNC('min', _FIVETRAN_SYNCED) DESC, Rently.ID DESC) Rank_1

FROM PROD_REPLICA.RENTLY.PROPERTIES RENTLY
WHERE 1=1
AND UNIT_ IS NOT NULL
AND MANAGER_APP_ACCESS_ALLOWED = 1 
AND TRY_TO_NUMERIC(Rently.UNIT_) IS NOT NULL
QUALIFY RANK_1 = 1
)

--******************************************************************************************************************************************************
,UW_RENT_MAX AS (
	SELECT 
	MAx(RENTLOGID) RENTLOGID 
	, ENTITYID1
	FROM PROD_REPLICA.HBPM_DBO.RENTLOGS
	GROUP BY ENTITYID1) 
	
,UW_RENT AS (
	SELECT 
	 RentLogs.ENTITYID1 AS HBPM_UnitID
	,RentLogs.ORIGINALVALUE AS UW_Rent_Prior
	,RentLogs.UPDATEVALUE AS UW_Rent_Current
	,RentLogs.OCCUREDON  AS UW_Update_Date
	FROM UW_RENT_MAX
	LEFT JOIN PROD_REPLICA.HBPM_DBO.RENTLOGS RentLogs ON RentLogs.RENTLOGID = UW_RENT_MAX.RentLogID
	)

--******************************************************************************************************************************************
,VANDALISM AS (
SELECT 
PROPERTY_KEY
,MAX(CHANGE_TIME) AS VANDALISM_DATE
FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_VACANT_OFF_MARKET_HIST
WHERE REASON_FOR_OFF_MARKET = 'Vandalism'
GROUP BY PROPERTY_KEY)
--******************************************************************************************************************************************
,WO AS (

SELECT 
 
TI.TICKET_KEY
,WO.WORKORDER_KEY
,TI.TICKET_TYPE
,TI.TICKET_STATUS
,WO.WORKORDER_ID
,WO.MAINT_ID
,WO.WORKORDER_STATUS
,WO.PRIORITY
,WO.BILL_TO

,P.Property_Key

,to_date(TI.CREATED_DATE_KEY::TEXT,'YYYYMMDD') AS TICKET_CREATED_DATE
,to_date(WO.CREATED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_CREATED_DATE
,to_date(WOST.WO_ESTIMATED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_ESTIMATED_DATE
,to_date(WOST.WO_PENDING_COMPLETION_DATE_KEY::TEXT,'YYYYMMDD') AS WO_PENDING_COMPLETION_DATE
,to_date(WOST.WO_COMPLETED_AWAITING_APPROVAL_DATE_KEY::TEXT,'YYYYMMDD') AS WO_COMPLETED_AWAITING_APPROVAL_DATE
,to_date(WOST.WO_UNBILLED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_UNBILLED_DATE
,to_date(WOST.WO_CLOSED_DATE_KEY::TEXT,'YYYYMMDD') AS WO_CLOSED_DATE

,C.CategoryID
,C.CATEGORYNAME
,MCD.WO_PROBLEM
,MCD.WO_Solution

 ,CASE WHEN V.VENDOR_ID IN (17689,17783,17959,18747,19140) THEN 'Warranty Vendor' ELSE 'External Vendor' END AS Warranty
 ,'https://honeybadgermm.com/Maintenance#/CreateWorkOrder/' || WO.Maint_ID AS HBMM_URL       
FROM PROD_ANALYTICS.DBT_RESICAP.DIM_TICKET TI
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TICKET_STATUS_ACCUM TSA ON TSA.TICKET_KEY  = TI.TICKET_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_WO_STATUS_ACCUM WOST ON WOST.TICKET_KEY  = TI.TICKET_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_WORKORDER WO ON WO.WORKORDER_KEY = WOST.WORKORDER_KEY AND WO.CURRENT_FLAG = 'Y'
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_VENDOR V ON V.VENDOR_KEY = WOST.VENDOR_KEY			
LEFT JOIN (SELECT 
				Min(MaintenanceCategoryDetailId) AS MaintenanceCategoryDetailID
				,MIN(CategoryDescription) AS WO_Problem
				,MIN(VENDORNOTES) AS WO_Solution
				,MaintenanceIDKey
                FROM PROD_REPLICA.HBMM_DBO.MAINTENANCECATEGORYDETAILS 
                --WHERE MaintenanceIDKey = 668614
				GROUP BY MaintenanceIDKey) MCD on MCD.MaintenanceIdkey = WO.MAINT_ID 
LEFT JOIN PROD_REPLICA.HBMM_DBO.MaintenanceCategoryDetails on MaintenanceCategoryDetails.MaintenanceCategoryDetailId = MCD.MaintenanceCategoryDetailID
LEFT JOIN PROD_REPLICA.HBMM_DBO.MaintenanceCategories C on C.CategoryId = MaintenanceCategoryDetails.CategoryId
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P ON P.PROPERTY_KEY = TSA.PROPERTY_KEY AND P.CURRENT_FLAG ='Y'
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS ON PUS.PROPERTY_KEY = P.PROPERTY_KEY
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY 
WHERE 1=1 
AND (WO.WORKORDER_STATUS <> 'Cancelled' OR WO.WORKORDER_STATUS IS NULL)
AND TI.TICKET_STATUS <> 'Cancelled'
AND TI.TICKET_TYPE <> 'PPI'
AND ((TI.TICKET_STATUS = 'Closed' AND WO.WORKORDER_KEY IS NOT NULL)
	OR (TI.TICKET_STATUS = 'Open' AND WO.WORKORDER_KEY IS NOT NULL )
	OR (TI.TICKET_STATUS <> 'Closed' AND TI.TICKET_STATUS <> 'Open') )	
AND TI.CREATED_DATE_KEY > '20210101'
AND P.PROPERTY_STATE ='Active'
AND P.EntityID <> ''
--AND (PS.PROPERTY_STATUS_ID NOT IN (53,75) OR PS.PROPERTY_STATUS_ID IS NULL)
AND PO.Portfolio_KEY NOT IN (1845, 2210, 2207, 2218, 1952,1867, 1916,1852,1771,1919,1873)
AND P.Organization_KEY not IN (16,17)
AND PO.IS_Active_AM = 'Y'
AND PO.Current_Flag = 'Y'
AND P.Current_Flag = 'Y'
AND PU.Current_Flag = 'Y'
AND PUS.Occupancy_Status NOT IN ('Property SOLD','Not Managed') 
)

,WO_Summary AS (
SELECT 
WO.Property_Key
,MAX( TICKET_CREATED_DATE) AS "2_MM_TKT_Created_Date"
,SUM( CASE WHEN WORKORDER_STATUS = 'Closed'OR WORKORDER_STATUS = 'Unbilled' THEN 0 ELSE 1 END) AS "2_MM_WO_Open_Count"
,COALESCE(MAX(WO_CLOSED_DATE),MAX(WO_UNBILLED_DATE) )  AS "2_MM_WO_Closed_Date"
,SUM( CASE WHEN WORKORDER_STATUS = 'Closed' OR WORKORDER_STATUS = 'Unbilled' THEN 1 ELSE 0 END) AS "2_MM_WO_Closed Count"
FROM 
WO
GROUP BY Property_Key
)
--******************************************************************************************************************************************************
,MAX_LEASE AS (

SELECT
 MAX(T.Lease_ID) LEASE_ID
 ,TLA.Property_key
FROM PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT T
 LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TLA ON TLA.TENANT_KEY = T.Tenant_Key
 LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI ON TI.TENANTINFORMATIONID = T.Tenant_Information_id

WHERE 1=1
 AND PRIMARY_TENANT ='Y' 
 AND CURRENT_FLAG ='Y'
 AND RENT_DUE_DAY IS NOT NULL
 AND TI._FIVETRAN_DELETED = 'N'
 AND TI.CURRENTRENT >500
GROUP BY TLA.Property_key )

--************************************************************************************************************
,Tenant_Listings AS (

SELECT 
 MIN(RENT_LIST_HIST_ID) RENT_LIST_HIST_KEY
 ,TEN.Lease_ID  
 ,TLA.Property_key
FROM PROD_ANALYTICS.DBT_RESICAP.DIM_TENANT TEN
 LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_TENANT_LEASING_ACCUM TLA ON TLA.TENANT_KEY = TEN.Tenant_Key
 LEFT JOIN PROD_REPLICA.HBPM_DBO.TENANTINFORMATIONS TI ON TI.TENANTINFORMATIONID = TEN.Tenant_Information_id

 LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_RENTAL_LISTING_HIST RLH ON RLH.PROPERTY_KEY  = TLA.Property_Key

 WHERE 1=1
 AND PRIMARY_TENANT ='Y' 
 AND CURRENT_FLAG ='Y'
 AND RENT_DUE_DAY IS NOT NULL
 AND TI._FIVETRAN_DELETED = 'N'
 AND TI.CURRENTRENT >500 
 
 AND to_date(RLH.LISTING_DATE_KEY::TEXT,'yyyymmdd') <= DATEADD(DAY,10,to_date(COALESCE(TLA.INITIAL_LEASE_FROM_DATE_KEY,TLA.LEASE_FROM_DATE_KEY)::TEXT,'yyyymmdd'))
 AND RLH.LISTING_STATUS <> 'Withdrawn'
 AND RLH.LISTING_STATUS <> 'On Hold'
 
 GROUP BY
  TEN.Lease_ID  
 ,TLA.Property_key ) 

--************************************************************************************************************
 ,BUILDER_MATRIX_DETAIL AS (

SELECT
   JM.JOBAID
  ,T0.ProjectId
  ,T0.JobNo

  ,CASE WHEN  T1.StageDescription ='CABINETS' THEN MAX(T0.ActualEndDate) ELSE NULL END AS BUILDERMATRIX_CABINETS
  ,CASE WHEN  T1.StageDescription ='FINAL MECHANICAL' THEN MAX(T0.ActualEndDate) ELSE NULL END AS BUILDERMATRIX_FINAL_MECHANICAL
  ,CASE WHEN  T1.StageDescription ='FLOORING' THEN MAX(T0.ActualEndDate) ELSE NULL END AS BUILDERMATRIX_FLOORING
  ,CASE WHEN  T1.StageDescription ='INTERIOR FINISHES' THEN MAX(T0.ActualEndDate) ELSE NULL END AS BUILDERMATRIX_INTERIOR_FINISHES
  ,CASE WHEN  T1.StageDescription ='DRYWALL' THEN MAX(T0.ActualEndDate) ELSE NULL END AS BUILDERMATRIX_DRYWALL
  ,CASE WHEN  T1.StageDescription ='ROUGH MECHANICALS' THEN MAX(T0.ActualEndDate) ELSE NULL END AS BUILDERMATRIX_ROUGH_MECHANICALS
  ,CASE WHEN  T1.StageDescription ='FRAME' THEN MAX(T0.ActualEndDate) ELSE NULL END AS BUILDERMATRIX_FRAME
  ,CASE WHEN  T1.StageDescription ='FOUNDATION' THEN MAX(T0.ActualEndDate) ELSE NULL END AS BUILDERMATRIX_FOUNDATION
  ,CASE WHEN  T1.StageDescription ='LANDSCAPING' THEN MAX(T0.ActualEndDate) ELSE NULL END AS BUILDERMATRIX_LANDSCAPING
  ,CASE WHEN  T1.StageDescription ='QC 2' THEN MAX(T0.ActualEndDate) ELSE NULL END AS BUILDERMATRIX_QC_2
  ,CASE WHEN  T1.StageDescription ='CO' THEN MAX(T0.ActualEndDate) ELSE NULL END AS BUILDERMATRIX_CO_DATE
  
FROM PROD_REPLICA.BUILDERMETRIX_RESIBUILT.BUILDER_SCHEDULEMASTERDETAIL T0
  LEFT JOIN PROD_REPLICA.BUILDERMETRIX_RESIBUILT.BUILDER_SCHEDULETASKMASTER T1
    ON T0.BuilderId = T1.BuilderId
    AND T0.TaskCode = T1.TaskCode
    AND T0.StageCode = T1.StageCode
LEFT JOIN PROD_REPLICA.BUILDERMETRIX_RESIBUILT.BUILDER_JOBMASTER JM ON JM.JobNo = T0.JOBNO

WHERE 1=1
AND T0.BuilderId = 'BT-311420' 
--AND T0.ProjectID <> '60297' 
--AND JOBAID = 'RBGA0065-2046'

GROUP BY
  T0.ProjectId,
  T0.JobNo,
  JM.JOBAID,
  T1.StageDescription)
  
--************************************************************************************************************
,BUILDER_MATRIX_SUMMARY AS (
 
 SELECT
   JOBAID
  ,PROJECTID
  ,JOBNO
  
,to_Date(MAX(BUILDERMATRIX_CABINETS)) AS BUILDERMATRIX_CABINETS
,to_Date(MAX(BUILDERMATRIX_FINAL_MECHANICAL)) AS BUILDERMATRIX_FINAL_MECHANICAL
,to_Date(MAX(BUILDERMATRIX_FLOORING)) AS BUILDERMATRIX_FLOORING
,to_Date(MAX(BUILDERMATRIX_INTERIOR_FINISHES)) AS BUILDERMATRIX_INTERIOR_FINISHES
,to_Date(MAX(BUILDERMATRIX_DRYWALL)) AS BUILDERMATRIX_DRYWALL
,to_Date(MAX(BUILDERMATRIX_ROUGH_MECHANICALS)) AS BUILDERMATRIX_ROUGH_MECHANICALS
,to_Date(MAX(BUILDERMATRIX_FRAME)) AS BUILDERMATRIX_FRAME
,to_Date(MAX(BUILDERMATRIX_FOUNDATION)) AS BUILDERMATRIX_FOUNDATION
,to_Date(MAX(BUILDERMATRIX_LANDSCAPING)) AS BUILDERMATRIX_LANDSCAPING
,to_Date(MAX(BUILDERMATRIX_QC_2)) AS BUILDERMATRIX_QC_2
,to_Date(MAX(BUILDERMATRIX_CO_DATE)) AS BUILDERMATRIX_CO_DATE


FROM BUILDER_MATRIX_DETAIL
GROUP BY
  JOBAID
 ,PROJECTID
 ,JOBNO)
 --******************************************************************************************************************************************	
	
	,HUBSPOT AS (
      SELECT

       ID
       ,PROPERTY_ENTITY_ID
       ,PROPERTY_RENTLY_SERIAL_SYNC_STATUS  AS RENTLY_SYNC_STATUS
       ,PROPERTY_ELECTRONIC_LOCKBOX_NUMBER AS RENTLY_SERIAL_NUMBER
       ,PROPERTY_RENTLY_DEVICE_TYPE AS RENTLY_DEVICE_TYPE
       ,PROPERTY_RENTLY_SH_HUB_STATUS AS RENTLY_SH_HUB_STATUS
       ,PROPERTY_RENTLY_SH_HUB_SERIAL_ID  AS RENTLY_SH_HUB_SERIAL_ID
       ,PROPERTY_RENTLY_SH_LOCK_STATUS  AS RENTLY_SH_LOCK_STATUS
       ,PROPERTY_CO_DATE
       ,property_rently_serial_id_update_date

      FROM PROD_REPLICA.HUBSPOT_2.PROPERTIES
      WHERE 1=1
      AND PROPERTY_ENTITY_ID is not null
     -- AND ARCHIVED = FALSE
      AND PROPERTY_HS_MERGED_OBJECT_IDS IS null
      AND (_fivetran_deleted = FALSE OR _fivetran_deleted  is null)) 
 --************************************************************************************************************
SELECT DISTINCT

P.PROPERTY_KEY


,P.HBAM_PROPERTY_ID
,P.HBPM_PROPERTY_ID
,P.HBMM_PROPERTY_ID
,R.REGION_NAME
,P.FloorPlan
,SUB.SUBDIVISION
,PUS.FLOORPLAN_KEY
,PUS.SUBDIVISION_KEY
,P.ZIPCODE
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

,PO.PORTFOLIO_NAME
,P.ADDRESS || ', ' || COALESCE (CI.CITY_NAME, PM_CI.CityName) || ', ' || S.STATE_NAME || ' ' || P.ZIPCODE AS Full_Address
,P.ADDRESS
,P.ENTITYID
,BA.PurchaseType AS "Purchase_Type_ID"
,CASE 
	WHEN BA.PurchaseType = 1 THEN 'Foreclosure'
	WHEN BA.PurchaseType = 2 THEN 'MLS'
	WHEN BA.PurchaseType = 3 THEN 'Off-Market'
	WHEN BA.PurchaseType = 4 THEN 'Bulk'
	WHEN BA.PurchaseType = 5 THEN 'Deed in Lieu'
	WHEN BA.PurchaseType = 6 THEN 'I-Buyer'
	WHEN BA.PurchaseType = 7 THEN 'Non-Foreclosure'
	WHEN BA.PurchaseType = 8 THEN 'New Construction'
	ELSE Null	
END AS "Purchase Type"

,CASE WHEN PUS.Occupancy_Status = 'Trustee Lease Honored' THEN 'Trustee Leased' 
      WHEN PUS.Property_Status = 'Tenant Lease' AND PUS.Occupancy_Status = 'Vacant - Future Move In' THEN 'Tenant Leased'
      ELSE PUS.Occupancy_Status END AS Occupancy_Status

,CASE WHEN PUS.Occupancy_Status = 'Trustee Occupied' THEN 'Trustee Occupied'
	  WHEN PUS.Occupancy_Status = 'Under Inspection' THEN 'Inspection'
	  WHEN PUS.Occupancy_Status = 'Under Construction' THEN 'Constuction'
	  WHEN PUS.Occupancy_Status = 'Vacant - Off Market' OR PUS.Occupancy_Status = 'Vacant - Onboarding' THEN 'Vacant - Off Market'
	  WHEN PUS.Occupancy_Status = 'Vacant - On Market' OR PUS.Occupancy_Status = 'Vacant - Pre-Leasing' THEN 'Vacant - On Market'
	  WHEN PUS.Occupancy_Status = 'Tenant Leased' THEN 'Tenant Leased'
	  WHEN PUS.Property_Status = 'Tenant Lease' AND PUS.Occupancy_Status = 'Vacant - Future Move In' THEN 'Tenant Leased'
	  WHEN PUS.Occupancy_Status = 'Vacant - Future Move In' THEN 'Vacant - FMI'
	  WHEN PUS.Occupancy_Status = 'Trustee Lease Honored' OR PUS.Occupancy_Status = 'Trustee Leased' THEN 'Trustee Leased'
	  WHEN PUS.Occupancy_Status = 'Pending MOI/Rekey' OR  PUS.Occupancy_Status = 'Under Turnkey' THEN 'Turnkey'
	  ELSE PUS.Occupancy_Status END AS Occupancy_Status_Summary

,CASE WHEN PUS.Occupancy_Status = 'Trustee Occupied' THEN 1
	  WHEN PUS.Occupancy_Status = 'Under Inspection' THEN 2
	  WHEN PUS.Occupancy_Status = 'Under Construction' THEN 3
	  WHEN PUS.Occupancy_Status = 'Vacant - Off Market' OR PUS.Occupancy_Status = 'Vacant - Onboarding'  THEN 4
	  WHEN PUS.Occupancy_Status = 'Vacant - On Market' OR PUS.Occupancy_Status = 'Vacant - Pre-Leasing' THEN 5
	  WHEN PUS.Occupancy_Status = 'Tenant Leased' THEN 8
	  WHEN PUS.Property_Status = 'Tenant Lease' AND PUS.Occupancy_Status = 'Vacant - Future Move In' THEN 8
	  WHEN PUS.Occupancy_Status = 'Vacant - Future Move In' THEN 6
	  WHEN PUS.Occupancy_Status = 'Trustee Lease Honored' OR PUS.Occupancy_Status = 'Trustee Leased' THEN 7
	  WHEN PUS.Occupancy_Status = 'Pending MOI/Rekey' OR  PUS.Occupancy_Status = 'Under Turnkey' THEN 9
	  ELSE 10 END AS Occupancy_Status_SummaryID

,PUS.PROPERTY_STATUS AS AM_Property_Status
,COALESCE(PM_AI.Bedrooms, PU.BEDROOMS) AS BEDROOMS
,COALESCE(PM_AI.BATHROOMS, PU.BATHROOMS) AS BATHROOMS
,PU.SQUARE_FOOTAGE
,P.Year_Built
,COALESCE(to_date(P.TRANSFER_DATE_KEY::TEXT,'yyyymmdd'),to_date(P.PURCHASE_DATE_KEY::TEXT,'yyyymmdd'),P.CREATED_DATE) AS "Transfer_Date"
,to_date(P.PURCHASE_DATE_KEY::TEXT,'yyyymmdd') AS "Purchase_Date"

,RL.RENT_LIST_HIST_ID AS RENTAL_LISTING_ID
,RL.LISTING_STATUS AS "Listing_Status_Name"
,to_date(RL.LISTING_DATE_KEY::TEXT,'yyyymmdd') AS ListingDate

,RL_I.RENT_LIST_HIST_ID AS INITIAL_RENTAL_LISTING_ID
,RL_I.LISTING_STATUS AS "INITIAL_Listing_Status_Name"
,to_date(RL_I.LISTING_DATE_KEY::TEXT,'yyyymmdd') AS INITIAL_Listing_Date
,Date_trunc('month',to_date(RL_I.LISTING_DATE_KEY::TEXT,'yyyymmdd') )AS INITIAL_Listing_Date_BOM

,PM_AI.ReasonOffMarketId --*
,PM_AI.MOVEINREADY AS PM_MIR
,ROM.Description AS ReasonOffMarketName
,OffMarket.OffMarketDate
,AM_PM.MoveInReady
,AM_CON.PROJECTEDCOMPLETIONDATE

,to_date(P.INITIAL_LEASE_DATE_KEY::TEXT,'yyyymmdd') AS INITIAL_LEASE_DATE
,'https://honeybadgerpm.com/PropertyModule#/PropertyDetails/' || HBPM.PROPERTYID || '/' || PM_AI.UnitID ||'/0' AS HBPM_URL
,'https://honeybadgermm.com/Property#/PropertyDetails/' || P.HBMM_PROPERTY_ID AS HBMM_URL
,'https://honeybadgeram.com/Listings/Edit?hbid=' || P.HBAM_PROPERTY_ID ||'&target=100#tabid=17' AS HBAM_URL
,DATE(GETDATE()) AS TODAY


,RRQC.RRQCPassDate  AS "2_AM_QC_Result_Date"
,CASE WHEN RRQC.RRQCPassDate IS NOT NULL THEN 'Pass' ELSE NULL END AS "2_AM_QC_Result"
,RRQC.QCManagerName AS "2_AM_Result_Manager"

,WO_Summary."2_MM_TKT_Created_Date"
,WO_Summary."2_MM_WO_Open_Count"
,WO_Summary."2_MM_WO_Closed_Date"
,WO_Summary."2_MM_WO_Closed Count"

,Rently.LOCKBOX AS RENTLY_LOCKBOX
,Rently.STATUS_TITLE AS RENTLY_STATUS
,Rently.ACTIVE AS RENTLY_ACTIVE
,Rently.LB_ASSIGNED_DATE AS RENTLY_LB_ASSIGNED_DATE
,Rently.AUTOSHOWING_DATE AS RENTLY_AUTOSHOWING_DATE
,CON_QC.FINAL_WALK_DATE
,COALESCE (CON_QC.FINAL_WALK_DATE,AM_PM.MoveInReady) AS CON_DATE_FW_OR_COMPLETE

,PICS.PICTURE_COUNT
,COALESCE(DRC.CABINETS_PRELEASE_DATE,BMS.BUILDERMATRIX_CABINETS) AS CABINETS_PRELEASE_DATE
,COALESCE(DRC.QC_TRIGGER_DATE,BMS.BUILDERMATRIX_QC_2) AS QC_TRIGGER_DATE
,COALESCE(HUBSPOT.PROPERTY_CO_DATE,DRC.DRC_CO_DATE,BMS.BUILDERMATRIX_CO_DATE) AS DRC_CO_DATE

,OFFN.OffMarketNote
,OFFN.OffMarketNoteCreated
,OFFN.OffMarketNote_Days
,OFFN.OffMarketNote_Added_By

,UW_Rent.UW_Rent_Prior   
,UW_Rent.UW_Rent_Current   
,UW_Rent.UW_Update_Date AS UW_Update_Date
,CASE WHEN UW_Rent.UW_Update_Date IS NOT NULL THEN DATEDIFF('day',UW_Rent.UW_Update_Date,GETDATE())
      ELSE NULL END AS UW_Days_Since_Update
      
,Vandalism.VANDALISM_DATE

FROM PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY P
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROPERTY_UNIT_SUMMARY PUS ON PUS.PROPERTY_KEY  = P.PROPERTY_KEY 
LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTIES HBAM ON HBAM.HBID = P.HBAM_PROPERTY_ID --*REPLCA DB*
LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTIES HBPM ON HBPM.PROPERTYID = P.HBPM_PROPERTY_ID --*REPLCA DB*
LEFT JOIN PROD_REPLICA.HBPM_DBO.USERS PM_U ON PM_U.UserID = HBPM.ASSIGNEDUSERID 
LEFT JOIN PROD_REPLICA.HBPM_DBO.PROPERTYADDLINFOES PM_AI ON PM_AI.PROPERTYID  = HBPM.PROPERTYID AND PM_AI."_FIVETRAN_DELETED" = 'N' 
LEFT JOIN PROD_REPLICA.HBAM_DBO.PROPERTYMANAGEMENTS AM_PM ON AM_PM.PROPERTYMANAGEMENTID = HBAM.PropertyManagement_PropertyManagementId AND AM_PM.HBID = HBAM.HBID AND AM_PM."_FIVETRAN_DELETED" <> 'Y'
LEFT JOIN PROD_REPLICA.HBAM_DBO.INSPECTIONS AM_INS ON AM_INS.INSPECTIONID = HBAM.INSPECTION_INSPECTIONID AND AM_INS.HBID = HBAM.HBID AND AM_INS."_FIVETRAN_DELETED" <> 'Y'
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PORTFOLIO PO ON PO.PORTFOLIO_KEY = PUS.PORTFOLIO_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_CITY CI ON CI.CITY_KEY = PUS.CITY_KEY 
LEFT JOIN PROD_REPLICA.HBPM_DBO.Cities PM_CI ON PM_CI.CityID = HBPM.CityID
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_STATE S ON S.STATE_KEY = PUS.STATE_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_COUNTY CO ON CO.COUNTY_KEY = PUS.COUNTY_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_REGION R ON R.REGION_KEY = PUS.REGION_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_SUBDIVISION SUB ON SUB.SUBDIVISION_KEY = PUS.SUBDIVISION_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_OWNER_ORGANIZATION O ON O.ORGANIZATION_KEY = PUS.ORGANIZATION_KEY 
LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.DIM_PROPERTY_UNIT PU ON PU.PROPERTY_UNIT_KEY = PUS.PROPERTY_UNIT_KEY
LEFT JOIN (SELECT Max(Id) RRQC_ID ,HBID FROM PROD_REPLICA.HBAM_DBO.RRQCCHANGELOGS GROUP BY HBID) RRQC_MOST_RECENT ON RRQC_MOST_RECENT.HBID = P.HBAM_PROPERTY_ID
LEFT JOIN PROD_REPLICA.HBAM_DBO.RRQCCHANGELOGS RRQC ON RRQC.ID = RRQC_MOST_RECENT.RRQC_ID
LEFT JOIN PROD_REPLICA.HBAM_DBO.BIDANDAUCTIONS BA ON BA.BIDID = HBAM.BidAndAuction_BidId AND BA.HBID = P.HBAM_PROPERTY_ID
LEFT JOIN PROD_REPLICA.HBAM_DBO.CONSTRUCTIONS AM_CON ON AM_CON.ConstructionID = HBAM.CONSTRUCTION_CONSTRUCTIONID AND AM_CON.HBID = HBAM.HBID AND AM_CON."_FIVETRAN_DELETED" <> 'Y'

LEFT JOIN PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS ROM ON ROM.LookUpMasterId = PM_AI.ReasonOffMarketId
LEFT JOIN (SELECT LookUpMasterId AS OccupancyStatusID, Description FROM PROD_REPLICA.HBPM_DBO.LOOKUPMASTERS WHERE TypeID = 6 ) PM_OC ON PM_OC.Description = PUS.Occupancy_Status 


LEFT JOIN (SELECT 
			MAX(RENT_LIST_HIST_ID) ID
			,PROPERTY_KEY
			FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_RENTAL_LISTING_HIST
			GROUP BY PROPERTY_KEY) RENTALLISTINGENTRIES_MOST_RECENT ON RENTALLISTINGENTRIES_MOST_RECENT.PROPERTY_KEY = P.PROPERTY_KEY

LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_RENTAL_LISTING_HIST RL ON RL.RENT_LIST_HIST_ID = RENTALLISTINGENTRIES_MOST_RECENT.ID

LEFT JOIN (SELECT 
			MIN(RENT_LIST_HIST_ID) ID
			,PROPERTY_KEY
			FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_RENTAL_LISTING_HIST
			WHERE 1=1
			AND Listing_Status <> 'Withdrawn'
			AND Listing_Status <> 'On Hold'
			GROUP BY PROPERTY_KEY) RENTALLISTINGENTRIES_INITIAL ON RENTALLISTINGENTRIES_INITIAL.PROPERTY_KEY = P.PROPERTY_KEY

LEFT JOIN PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_RENTAL_LISTING_HIST RL_I ON RL_I.RENT_LIST_HIST_ID = RENTALLISTINGENTRIES_INITIAL.ID
LEFT JOIN WO_Summary ON WO_Summary.Property_Key = P.Property_key
				
LEFT JOIN (
			SELECT 
			PROPERTY_KEY  
			,MAX(to_date(CHANGED_DATE_KEY::TEXT,'yyyymmdd')) OffMarketDate
			FROM PROD_ANALYTICS.DBT_RESICAP.FCT_PROP_UNIT_STATUS_HIST
			
			WHERE 1=1
			AND NEW_OCCUPANCY_STATUS = 'Vacant - Off Market'
			GROUP BY PROPERTY_KEY ) OffMarket ON OffMarket.Property_key = P.Property_key


LEFT JOIN Rently_CLEAN Rently ON Rently.UNIT_ = P.HBPM_PROPERTY_ID AND Rently.RANK_1 = 1 

LEFT JOIN (
			SELECT 
			HBID
			,MIN(OCCUREDON) FINAL_WALK_DATE
			FROM PROD_REPLICA.HBAM_DBO.PROPERTYHISTORIES
			WHERE CURRENTPROPERTYSTATUSID  = 21
			GROUP BY HBID ) CON_QC ON CON_QC.HBID = P.HBAM_Property_iD

LEFT JOIN PICS ON PICS.PM_PropertyID = P.HBPM_PROPERTY_ID										


LEFT JOIN (SELECT 
				ASSETNUM AS ENTITYID
				,"8_CABINETS_INTERIOR_TRIM" AS CABINETS_PRELEASE_DATE
				,"14_QC_2" AS QC_TRIGGER_DATE
				,"116_CO_ISSUED_DATE" AS DRC_CO_DATE
			from PROD_REPLICA.RESIBUILT_MALLEO_RESIBUILTMALLEO.POWERBI_STAGE
			WHERE "_FIVETRAN_DELETED" = 'N' ) DRC ON DRC.EntityID = P.EntityID

LEFT JOIN OffMarketNote OFFN ON OFFN.PropertyID = P.HBPM_PROPERTY_ID			
LEFT JOIN UW_RENT ON UW_Rent.HBPM_UnitID = PM_AI.UnitID	
LEFT JOIN Vandalism ON Vandalism.PROPERTY_KEY = P.Property_key

LEFT JOIN BUILDER_MATRIX_SUMMARY BMS ON BMS. JOBAID = P.EntityID
LEFT JOIN HUBSPOT ON HUBSPOT.PROPERTY_ENTITY_ID = P.EntityID

WHERE 1=1
AND (HBAM.PROPERTYSTATUSID >9 OR HBAM.PROPERTYSTATUSID IS NULL) --out of bid
AND P.PROPERTY_STATE ='Active'
AND P.EntityID <> ''
AND (HBAM.PROPERTYSTATUSID NOT IN (53,75) OR HBAM.PROPERTYSTATUSID IS NULL)
AND PO.Portfolio_KEY NOT IN (223,598,147,102,109,28,603,169,602,170,58,54)
AND PUS.Organization_KEY not IN (16,17)
AND PO.IS_Active_AM = 'Y'
AND PO.Current_Flag = 'Y'
AND P.Current_Flag = 'Y'
AND PU.Current_Flag = 'Y'
AND PUS.Occupancy_Status NOT IN ('Not Managed')
AND (HBPM.PROPERTYSTATEID = 26 OR HBPM.PROPERTYSTATEID IS NULL) 
AND P.HBMM_Property_ID IS NOT NULL
AND P.Property_Key NOT IN (166418,57201,23237,166851)
--AND LEAD_CREATED_DATE >= '01/01/2024')
--AND P.Address LIKE '2536 Columbia%'

---*****************************************************************************
/*
WHERE 1=1
AND P.PROPERTY_KEY in (521633)
*/`;
