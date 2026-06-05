// AUTO-GENERATED from the .pbip mirror. Do not edit by hand.
// Native-query SQL preserved from powerbi-source/.../tables/*.tmdl

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

