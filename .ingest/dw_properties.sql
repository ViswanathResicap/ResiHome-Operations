/* =============================================================================
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
    AND (TI._FIVETRAN_DELETED = 'N' OR TI._FIVETRAN_DELETED IS NULL)