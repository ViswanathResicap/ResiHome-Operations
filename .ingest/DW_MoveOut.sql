/* =============================================================================
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

--AND P.ENTITYID = 'RPGFL00013'