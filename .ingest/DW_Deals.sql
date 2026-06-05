/* =============================================================================
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
WHERE 1 = 1