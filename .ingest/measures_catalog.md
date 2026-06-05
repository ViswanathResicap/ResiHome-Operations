# DAX measures (from mirrored tables)

## 0_DRC  (46 measures)

- **1_Active Listings** = `CALCULATE(COUNT(DW_Listings[PROPERTY_KEY]),FILTER(DW_Listings,DW_Listings[LISTING_STATUS]="Active"&&DW_Listings[IS_PUBLISHED]="Y"))`
- **1_Active Pre-Listings** = `COALESCE(CALCULATE(COUNT(DW_Listings[PROPERTY_KEY]),FILTER(DW_Listings,DW_Listings[LISTING_STATUS]="Active"&&DW_Listings[IS_PUBLISHED]="Y"&&DW_Listings[PM_MIR]<>BLANK()&&DW_Listings[PM_MIR]>=TODAY())),0)`
- **1_Apps_30** = `COALESCE(CALCULATE(DISTINCTCOUNT(DW_Deals[DEAL_KEY]),FILTER(DW_Deals,DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[APPLICATION_SUBMIT_DATE]>=(TODAY()-30)&&DW_Deals[APPLICATION_SUBMIT_DATE]<=(TODAY()-1))),0)`
- **1_Apps_7** = `COALESCE(CALCULATE(DISTINCTCOUNT(DW_Deals[DEAL_KEY]),FILTER(DW_Deals,DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[APPLICATION_SUBMIT_DATE]>=(TODAY()-7)&&DW_Deals[APPLICATION_SUBMIT_DATE]<=(TODAY()-1))),0)`
- **1_Apps_S_30** = `COALESCE(CALCULATE(DISTINCTCOUNT(DW_Deals[DEAL_KEY]),FILTER(DW_Deals,DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[APPLICATION_STARTED_DATE]>=(TODAY()-30)&&DW_Deals[APPLICATION_STARTED_DATE]<=(TODAY()-1))),0)`
- **1_Apps_S_7** = `COALESCE(CALCULATE(DISTINCTCOUNT(DW_Deals[DEAL_KEY]),FILTER(DW_Deals,DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[APPLICATION_STARTED_DATE]>=(TODAY()-7)&&DW_Deals[APPLICATION_STARTED_DATE]<=(TODAY()-1))),0)`
- **1_Apps_S_Total** = `COALESCE(CALCULATE(DISTINCTCOUNT(DW_Deals[DEAL_KEY]),FILTER(DW_Deals,DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[APPLICATION_STARTED_DATE]<>BLANK())),0)`
- **1_Apps_Total** = `COALESCE(CALCULATE(DISTINCTCOUNT(DW_Deals[DEAL_KEY]),FILTER(DW_Deals,DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[APPLICATION_SUBMIT_DATE]<>BLANK())),0)`
- **1_Deposit Taken** = `COALESCE(CALCULATE(COUNT(DW_Listings[PROPERTY_KEY]),FILTER(DW_Listings,DW_Listings[FMI_FLAG]=1&&DW_Listings[CURRENT_DEAL_STATUS]<>"Closed Won"&&DW_Listings[CURRENT_DEAL_STATUS]<>"Deal Won"&&DW_Listings[MOST_RECENT_LISTING]="Yes")),0)`
- **1_HF_30** = `COALESCE(CALCULATE(DISTINCTCOUNT(DW_Deals[DEAL_KEY]),FILTER(DW_Deals,DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[CURRENT_DEAL_STATUS]<>"Closed Lost"&&DW_Deals[HF Date]>=(TODAY()-30)&&DW_Deals[HF Date]<=(TODAY()-1))),0)`
- **1_HF_7** = `COALESCE(CALCULATE(DISTINCTCOUNT(DW_Deals[DEAL_KEY]),FILTER(DW_Deals,DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[CURRENT_DEAL_STATUS]<>"Closed Lost"&&DW_Deals[HF Date]>=(TODAY()-7)&&DW_Deals[HF Date]<=(TODAY()-1))),0)`
- **1_HF_Total** = `COALESCE(CALCULATE(DISTINCTCOUNT(DW_Deals[DEAL_KEY]),FILTER(DW_Deals,DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[CURRENT_DEAL_STATUS]<>"Closed Lost"&&DW_Deals[HF Date]<>BLANK())),0)`
- **1_Leads L30** = `COALESCE(CALCULATE(DISTINCTCOUNT(DW_Leads[LEAD_KEY]),FILTER(DW_Leads,DW_Leads[PRIMARY_LEAD_ID]=BLANK()&&DW_Leads[LEAD_CREATED_DATE]>=(TODAY()-30)&&DW_Leads[LEAD_CREATED_DATE]<=(TODAY()-1))),0)`
- **1_Leads L7** = `COALESCE(CALCULATE(DISTINCTCOUNT(DW_Leads[LEAD_KEY]),FILTER(DW_Leads,DW_Leads[PRIMARY_LEAD_ID]=BLANK()&&DW_Leads[LEAD_CREATED_DATE]>=(TODAY()-7)&&DW_Leads[LEAD_CREATED_DATE]<=(TODAY()-1))),0)`
- **1_Leads_Total** = ```` COALESCE(CALCULATE(DISTINCTCOUNT(DW_Leads[LEAD_KEY]),DW_Leads[PRIMARY_LEAD_ID]=BLANK()),0) ````
- **1_MI_30** = `COALESCE(CALCULATE(DISTINCTCOUNT(DW_MoveOut[TENANT_KEY]),FILTER(DW_MoveOut,DW_MoveOut[LEASE_FROM_DATE]>=(TODAY()-30)&&DW_MoveOut[LEASE_FROM_DATE]<=(TODAY()-1))),0)`
- **1_MI_7** = `COALESCE(CALCULATE(DISTINCTCOUNT(DW_MoveOut[TENANT_KEY]),FILTER(DW_MoveOut,DW_MoveOut[LEASE_FROM_DATE]>=(TODAY()-7)&&DW_MoveOut[LEASE_FROM_DATE]<=(TODAY()-1))),0)`
- **1_MI_Total** = `COALESCE(CALCULATE(COUNT(DW_Tenant[TENANT_KEY])),0)`
- **1_Open_Apps** = `COALESCE(CALCULATE(DISTINCTCOUNT(DW_Deals[DEAL_KEY]),FILTER(DW_Deals,DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&OR(OR(DW_Deals[CURRENT_DEAL_STATUS]="Under Review",DW_Deals[CURRENT_DEAL_STATUS]="Conditional Approval"),DW_Deals[CURRENT_DEAL_STATUS]="Full Approval")&&DW_Deals[APP_STAGE]<>"Pending Denial")),0)`
- **2_Leased** = `COALESCE(CALCULATE(COUNT(DW_Properties[PROPERTY_KEY]),FILTER(DW_Properties,DW_Properties[OCCUPANCY_STATUS]="Tenant Leased"||DW_Properties[OCCUPANCY_STATUS]="Trustee Leased")),0)`
- **2_MI Ready** = `COALESCE(CALCULATE(COUNT('DW_Off Market'[PROPERTY_KEY]),FILTER('DW_Off Market',COALESCE('DW_Off Market'[DRC_CO_DATE],'DW_Off Market'[2_AM_QC_Result_Date])<>BLANK())),0)`
- **2_Total Homes** = `COALESCE(CALCULATE(COUNT(DW_Properties[PROPERTY_KEY])),0)`
- **3_ PSF** = ```` CALCULATE(DIVIDE(SUM(DW_Properties[CURRENT_RENT]), SUM(DW_Properties[SQUARE_FOOTAGE]), BLANK()),DW_Properties[OCCUPANCY_STATUS]="Tenant Leased") ````
- **3_In Place Rent** = ```` CALCULATE(AVERAGE(DW_Tenant[CURRENT_RENT]),DW_Tenant[OCCUPANCY_STATUS]="Tenant Leased") ````
- **3_List_Price** = `CALCULATE(AVERAGE(DW_Listings[CURRENT_LIST_PRICE]),FILTER(DW_Listings,DW_Listings[LISTING_STATUS]="Active"&&DW_Listings[IS_PUBLISHED]="Y"))`
- **3_List_Price (Deposit)** = `CALCULATE(AVERAGE(DW_Listings[CURRENT_LIST_PRICE]),FILTER(DW_Listings,DW_Listings[FMI_FLAG]=1&&DW_Listings[CURRENT_DEAL_STATUS]<>"Closed Won"&&DW_Listings[CURRENT_DEAL_STATUS]<>"Deal Won"&&DW_Listings[MOST_RECENT_LISTING]="Yes"))`
- **3_List_Price_UW** = `CALCULATE(AVERAGE(DW_Listings[UNDER_WRITTEN_RENT]),FILTER(DW_Listings,DW_Listings[LISTING_STATUS]="Active"&&DW_Listings[IS_PUBLISHED]="Y"))`
- **3_List_Price_UW (Deposit)** = `CALCULATE(AVERAGE(DW_Listings[UNDER_WRITTEN_RENT]),FILTER(DW_Listings,DW_Listings[FMI_FLAG]=1&&DW_Listings[CURRENT_DEAL_STATUS]<>"Closed Won"&&DW_Listings[CURRENT_DEAL_STATUS]<>"Deal Won"&&DW_Listings[MOST_RECENT_LISTING]="Yes"))`
- **3_List_PSF** = ```` CALCULATE(DIVIDE(SUM(DW_Listings[CURRENT_LIST_PRICE]), SUM(DW_Listings[SQUARE_FOOTAGE]), BLANK()),FILTER(DW_Listings,DW_Listings[LISTING_STATUS]="Active"&&DW_Listings[IS_PUBLISHED]="Y")) ````
- **3_List_PSF_UW** = ```` CALCULATE(DIVIDE(SUM(DW_Listings[UNDER_WRITTEN_RENT]), SUM(DW_Listings[SQUARE_FOOTAGE]), BLANK()),FILTER(DW_Listings,DW_Listings[LISTING_STATUS]="Active"&&DW_Listings[IS_PUBLISHED]="Y")) ````
- **3_MI Concessions** = ```` calculate(average(DW_Listings[CONCESSIONAMOUNT]),DW_Listings[LISTING_STATUS] = "Leased") ````
- **3_PSF_UW** = ```` CALCULATE(DIVIDE(SUM(DW_Properties[UNDER_WRITTEN_RENT]), SUM(DW_Properties[SQUARE_FOOTAGE]), BLANK()),DW_Properties[OCCUPANCY_STATUS]="Tenant Leased") ````
- **3_UW Rent** = ```` CALCULATE(AVERAGE(DW_Properties[UW_RENT_CURRENT]),DW_Properties[OCCUPANCY_STATUS]="Tenant Leased") ````
- **5_Blended Rent** = ```` CALCULATE(AVERAGE(DW_Properties[UNDER_WRITTEN_RENT]),DW_Properties[UNDER_WRITTEN_RENT]<>BLANK()) ````
- **5_Blended UW Trended Rent** = ```` CALCULATE(AVERAGE(DW_Properties[UNDER_WRITTEN_RENT]),DW_Properties[UNDER_WRITTEN_RENT]<>BLANK()) ````
- **5_Collections_EOM** = `CALCULATE([0_Collections_Switch],FILTER(DW_Tenant_Charges,DW_Tenant_Charges[ACCOUNT_NUMBER]="4010"&&DW_Tenant_Charges[CREDITTYPEID]<>2&&ROUND(DW_Tenant_Charges[CHARGE_DATE_BOM],0)=(DATE(YEAR(EOMONTH(TODAY(),-1)),MONTH(EOMONTH(TODAY(),-1)),1))),FILTER(SEL_Collections_Type,SEL_Collections_Type[Value]="Net (x-Concessions)"))`
- **5_Collections_MTD** = `CALCULATE([0_Collections_Switch],FILTER(DW_Tenant_Charges,DW_Tenant_Charges[ACCOUNT_NUMBER]="4010"&&DW_Tenant_Charges[CREDITTYPEID]<>2&&ROUND(DW_Tenant_Charges[CHARGE_DATE_BOM],0)=(DATE(YEAR(TODAY()),MONTH(TODAY()),1))),FILTER(SEL_Collections_Type,SEL_Collections_Type[Value]="Net (x-Concessions)"))`
- **2_FMI** = `CALCULATE(DISTINCTCOUNT(DW_Listings[PROPERTY_KEY]),FILTER(DW_Listings,DW_Listings[FMI_FLAG]=1&&DW_Listings[MOST_RECENT_LISTING]="Yes"&&DW_Listings[CURRENT_DEAL_STATUS]<>"Deal Won"&&DW_Listings[CURRENT_DEAL_STATUS]<>"Closed Won"))`
- **1_Apps_Approved_7** = `COALESCE(CALCULATE(DISTINCTCOUNT(DW_Deals[DEAL_KEY]),FILTER(DW_Deals,DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[APPLICATION_APPROVED_DATE]<>BLANK()&&DW_Deals[APPLICATION_SUBMIT_DATE]>=(TODAY()-7)&&DW_Deals[APPLICATION_SUBMIT_DATE]<=(TODAY()-1))),0)`
- **1_Apps_Approved_30** = `COALESCE(CALCULATE(DISTINCTCOUNT(DW_Deals[DEAL_KEY]),FILTER(DW_Deals,DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[APPLICATION_APPROVED_DATE]<>BLANK()&&DW_Deals[APPLICATION_SUBMIT_DATE]>=(TODAY()-30)&&DW_Deals[APPLICATION_SUBMIT_DATE]<=(TODAY()-1))),0)`
- **1_Apps_Approved_Total** = `COALESCE(CALCULATE(DISTINCTCOUNT(DW_Deals[DEAL_KEY]),FILTER(DW_Deals,DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[APPLICATION_APPROVED_DATE]<>BLANK()&&DW_Deals[APPLICATION_SUBMIT_DATE]<>BLANK())),0)`
- **3_Leased_Deposit_Rent** = ```` (CALCULATE(SUM(DW_Tenant[CURRENT_RENT]),FILTER(DW_Tenant,DW_Tenant[OCCUPANCY_STATUS]="Tenant Leased")) +  CALCULATE(SUM(DW_Listings[CURRENT_LIST_PRICE]),FILTER(DW_Listings,DW_Listings[FMI_FLAG]=1&&DW_Listings[CURRENT_DEAL_STATUS]<>"Closed Won"&&DW_Listings[CURRENT_DEAL_STATUS]<>"Deal Won"&&DW_Listings[MOST_RECENT_LISTING]="Yes"))) / (CALCULATE(DISTINCTCOUNT(DW_Tenant[TENANT_KEY]),FILTER(DW_Tenant,DW_Tenant[OCCUPANCY_STATUS]="Tenant Leased")) +  CALCULATE(DISTINCTCOUNT(DW_Listings[LISTING_KEY]),FILTER(DW_Listings,DW_Listings[FMI_FLAG]=1&&DW_Listings[CURRENT_DEAL_STATUS]<>"Closed Won"&&DW_Li …[truncated]`
- **3_Leased_Deposit_UW Rent** = ```` (CALCULATE(SUM(DW_Tenant[UNDER_WRITTEN_RENT]),FILTER(DW_Tenant,DW_Tenant[OCCUPANCY_STATUS]="Tenant Leased")) +  CALCULATE(SUM(DW_Listings[UNDER_WRITTEN_RENT]),FILTER(DW_Listings,DW_Listings[FMI_FLAG]=1&&DW_Listings[CURRENT_DEAL_STATUS]<>"Closed Won"&&DW_Listings[CURRENT_DEAL_STATUS]<>"Deal Won"&&DW_Listings[MOST_RECENT_LISTING]="Yes"))) / (CALCULATE(DISTINCTCOUNT(DW_Tenant[TENANT_KEY]),FILTER(DW_Tenant,DW_Tenant[OCCUPANCY_STATUS]="Tenant Leased")) +  CALCULATE(DISTINCTCOUNT(DW_Listings[LISTING_KEY]),FILTER(DW_Listings,DW_Listings[FMI_FLAG]=1&&DW_Listings[CURRENT_DEAL_STATUS]<>"Closed Won"& …[truncated]`
- **1_LTO_T90** = `CALCULATE([0_RG],FILTER(LTO,LTO[N_LEASESTART]>(TODAY()-90)))`
- **1_LTO_T90_Release** = `CALCULATE([0_RG],FILTER(LTO,LTO[N_LEASESTART]>(TODAY()-90)&&LTO[TYPE]="Re-Lease"))`
- **1_LTO_T90_Renewal** = `CALCULATE([0_RG],FILTER(LTO,LTO[N_LEASESTART]>(TODAY()-90)&&LTO[TYPE]="Renewal"))`

## 0_Days  (4 measures)

- **0_Collection_Day_Previous** = `MIN(CALCULATE(SUM(DW_Tenant_Receipts[PAID_AMOUNT]), FILTER(DW_Tenant_Receipts, DW_Tenant_Receipts[CHARGE_DATE].[Day]<=MAX('0_Days'[Day]) &&DATE(DW_Tenant_Receipts[CHARGE_DATE_BOM].[Year],DW_Tenant_Receipts[CHARGE_DATE_BOM].[MonthNo]+1,1) = FIRSTNONBLANK('0_Days'[Date],'0_Days'[Date]) &&OR( DW_Tenant_Receipts[RECEIVED_DATE].[Day]<=MAX('0_Days'[Day])&& DATE(DW_Tenant_Receipts[RECEIVED_DATE_BOM].[Year],DW_Tenant_Receipts[RECEIVED_DATE_BOM].[MonthNo]+1,1) = FIRSTNONBLANK('0_Days'[Date],'0_Days'[Date]),DW_Tenant_Receipts[RECEIVED_DATE]<=DW_Tenant_Receipts[CHARGE_DATE]))) / CALCULATE(SUM(DW_Tenant_C …[truncated]`
- **0_Collection vs LM** = `IF([0_Collection_Day_Net]<>BLANK()&&[0_Collection_Day_Previous]<>BLANK(),[0_Collection_Day_Net]-[0_Collection_Day_Previous],BLANK())`
- **0_Concessions_Day** = `IF(and(MAX('0_Days'[Day])>DAY(TODAY()),FIRSTNONBLANK('0_Days'[Month_No],'0_Days'[Month_No])=MONTH(TODAY())), BLANK(), CALCULATE(SUM(DW_Tenant_Receipts[PAID_AMOUNT]), FILTER(DW_Tenant_Receipts, DW_Tenant_Receipts[CREDITTYPEID] = 1 &&DW_Tenant_Receipts[CHARGE_DATE].[Day]<=MAX('0_Days'[Day]) &&DW_Tenant_Receipts[CHARGE_DATE_BOM]=FIRSTNONBLANK('0_Days'[Date],'0_Days'[Date]) )) )`
- **0_Collection_Day_Net** = `IF( AND( MAX('0_Days'[Day]) > DAY(TODAY()), FIRSTNONBLANK('0_Days'[Month_No], '0_Days'[Month_No]) = MONTH(TODAY()) && YEAR(FIRSTNONBLANK('0_Days'[Date], '0_Days'[Date])) = YEAR(TODAY()) ), BLANK(), MIN((CALCULATE(SUM(DW_Tenant_Receipts[PAID_AMOUNT]), FILTER(DW_Tenant_Receipts, DW_Tenant_Receipts[CHARGE_DATE].[Day] <= MAX('0_Days'[Day]) && DW_Tenant_Receipts[CHARGE_DATE_BOM] = FIRSTNONBLANK('0_Days'[Date],'0_Days'[Date]) && OR(DW_Tenant_Receipts[RECEIVED_DATE].[Day] <= MAX('0_Days'[Day]) && DW_Tenant_Receipts[RECEIVED_DATE_BOM] = FIRSTNONBLANK('0_Days'[Date],'0_Days'[Date]), DW_Tenant_Receipts[ …[truncated]`

## 0_Days_Agent  (13 measures)

- **00_Leads_C** = `CALCULATE(DISTINCTCOUNT(DW_Leads[LEAD_KEY]),FILTER(DW_Leads,DW_Leads[PRIMARY_LEAD_ID]=BLANK()&&DW_Leads[LEAD_CREATED_DATE]>=MIN('0_Days_Agent'[Date])&&DW_Leads[LEAD_CREATED_DATE]<=Max('0_Days_Agent'[Date])))`
- **00_Apps_Sub** = `CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]),FILTER(DW_Deals,DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[APPLICATION_SUBMIT_DATE]>=MIN('0_Days_Agent'[Date])&&DW_Deals[APPLICATION_SUBMIT_DATE]<=Max('0_Days_Agent'[Date])))`
- **00_HF** = `CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]),FILTER(DW_Deals,DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[HF Date]>=MIN('0_Days_Agent'[Date])&&DW_Deals[HF Date]<=Max('0_Days_Agent'[Date])))`
- **00_App_Per_Lead** = ```` DIVIDE( [00_Apps_Sub], [00_Leads_C], BLANK() ) ````
- **00_MI** = `CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]),FILTER(DW_Deals,DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[CONVERT_TO_RESIDENT_DATE]>=MIN('0_Days_Agent'[BOM])&&DW_Deals[CONVERT_TO_RESIDENT_DATE]<=TODAY()&&DW_Deals[CONVERT_TO_RESIDENT_DATE]<=Max('0_Days_Agent'[Date])&&DW_Deals[CURRENT_DEAL_STATUS]="Closed Won"))`
- **00_Approval:MI** = `CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]),FILTER(DW_Deals,DW_Deals[CURRENT_DEAL_STATUS]<>"Closed Lost"&&DW_Deals[CURRENT_DEAL_STATUS]<>"Deal Lost"&&DW_Deals[CURRENT_DEAL_STATUS]<>"Rejected"&&DW_Deals[APPLICATION_APPROVED_DATE]<>BLANK()&&DW_Deals[APPLICATION_SUBMIT_DATE]<>BLANK()&&DW_Deals[APP_STAGE]<>"Under Review"&&DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[APPLICATION_STARTED_DATE]>=MIN('0_Days_Agent'[Date])&&DW_Deals[APPLICATION_STARTED_DATE]<=Max('0_Days_Agent'[Date]))) / CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]),FILTER(DW_Deals,DW_Deals[APPLICATION_APPROVED_DATE]<>BLANK()&&DW_Deals[APPLICA …[truncated]`
- **00_MI_Per_Lead** = ```` DIVIDE( [00_MI], [00_Leads_C], BLANK() ) ````
- **00_Apps_Started** = `CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]),FILTER(DW_Deals,DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[APPLICATION_STARTED_DATE]>=MIN('0_Days_Agent'[Date])&&DW_Deals[APPLICATION_STARTED_DATE]<=Max('0_Days_Agent'[Date])))`
- **00_App Completion** = ```` DIVIDE( [00_Apps_Sub], [00_Apps_Started], BLANK() ) ````
- **00_Approval** = `CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]),FILTER(DW_Deals,DW_Deals[APPLICATION_APPROVED_DATE]<>BLANK()&&DW_Deals[APPLICATION_SUBMIT_DATE]<>BLANK()&&DW_Deals[APP_STAGE]<>"Under Review"&&DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[APPLICATION_SUBMIT_DATE]>=MIN('0_Days_Agent'[Date])&&DW_Deals[APPLICATION_SUBMIT_DATE]<=Max('0_Days_Agent'[Date]))) / CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]),FILTER(DW_Deals,DW_Deals[APPLICATION_SUBMIT_DATE]<>BLANK()&&DW_Deals[APP_STAGE]<>"Under Review"&&DW_Deals[PRIMARY_LEAD_ID]=BLANK()&&DW_Deals[APPLICATION_SUBMIT_DATE]>=MIN('0_Days_Agent'[Date])&&DW_Deals[APPLICATIO …[truncated]`
- **00_Avg Listings** = ```` (CALCULATE(DISTINCTCOUNT(PM_Listings_BOM[PROPERTY_KEY]),FILTER(PM_Listings_BOM,PM_Listings_BOM[CALENDAR_DATE_BOM]=MIN('0_Days_Agent'[BOM]))) + CALCULATE(DISTINCTCOUNT(PM_Listings_BOM[PROPERTY_KEY]),FILTER(PM_Listings_BOM,EOMONTH(PM_Listings_BOM[CALENDAR_DATE_BOM],-2)+1=MAX('0_Days_Agent'[BOM])))) /2 ````
- **00_Leads/Day** = `[00_Leads_C]/[00_Avg Listings]/CALCULATE(DISTINCTCOUNT('0_Days_Agent'[Date]),FILTER('0_Days_Agent',[PRIOR_CHECK]=1))`
- **00_Implied Days** = ```` DIVIDE( (1/(.82*[00_Approval]*[00_App_Per_Lead])), [00_Leads/Day], BLANK() ) ````

## 0_Month  (55 measures)

- **01_HF_Monthly** = `CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]),FILTER(DW_Deals,DW_Deals[HF (BOM)]<=Max('0_Month'[BEG_OF_MONTH])&&DW_Deals[HF (BOM)]>=Min('0_Month'[BEG_OF_MONTH])))`
- **01_On Market List** = `CALCULATE(COUNT(PM_Listings_BOM[PROPERTY_KEY]),FILTER(PM_Listings_BOM,PM_Listings_BOM[CALENDAR_DATE_BOM]>=MIN('0_Month'[BEG_OF_MONTH])&&PM_Listings_BOM[CALENDAR_DATE_BOM]<=MAX('0_Month'[BEG_OF_MONTH])))`
- **0_Occupied #** = `CALCULATE(DISTINCTCOUNT(PM_BOM[HBPM_PropertyID]),FILTER(PM_BOM,PM_BOM[BEG_OF_MONTH]<=MAX('0_Month'[BEG_OF_MONTH])&&PM_BOM[BEG_OF_MONTH]>=MIN('0_Month'[BEG_OF_MONTH])&&PM_BOM[1_Occ_Status (DW)]>=1479&&PM_BOM[1_Occ_Status (DW)]<=1481&&PM_BOM[Days Occ]>0&&OR(PM_BOM[1_Move-Out]=BLANK(),PM_BOM[1_Move-Out]>MAX('0_Month'[BEG_OF_MONTH]))))`
- **0_Occ_BOM %** = `CALCULATE([0_Occupied #] / [0_Stabilized],FILTER('0_Month','0_Month'[BEG_OF_MONTH]=MIN('0_Month'[BEG_OF_MONTH]))) //[0_Ten Leased #]/[0_Owned]`
- **0_Stabilized** = ```` CALCULATE(DISTINCTCOUNT(PM_BOM[HBPM_PropertyID]),filter(FILTER(PM_BOM,PM_BOM[BEG_OF_MONTH]<=MAX('0_Month'[BEG_OF_MONTH])&&PM_BOM[BEG_OF_MONTH]>=MIN('0_Month'[BEG_OF_MONTH])), -- AND(PM_PropStatus_BOM[Occ_Status (DW)]=1476,PM_PropStatus_BOM[Compliance]<>"Not Cleared to List")|| -- ||AND(PM_PropStatus_BOM[Occ_Status (DW)]=1483,PM_PropStatus_BOM[Compliance]<>"Not Cleared to List") -- ||AND(PM_PropStatus_BOM[Occ_Status (DW)]=1489,PM_PropStatus_BOM[Compliance]<>"Not Cleared to List") PM_BOM[1_Occ_Status (DW)]=1476 ||PM_BOM[1_Occ_Status (DW)]=1483 ||PM_BOM[1_Occ_Status (DW)]=1489 ||PM_BOM[1_Occ_ …[truncated]`
- **01_Lease_Vacant %** = ```` DIVIDE( COALESCE(([01_MoveIn Monthly]+[01_FMI Monthly]),0), [0_Vacant #], BLANK() ) ````
- **0_Renewal %** = `CALCULATE(DW_Renewals[0_Active Renew %],FILTER(DW_Renewals,DW_Renewals[1_C_LeaseEnd(BOM)]<=MAX('0_Month'[BEG_OF_MONTH])&&DW_Renewals[1_C_LeaseEnd(BOM)]>=MIN('0_Month'[BEG_OF_MONTH])))`
- **0_All Homes** = `CALCULATE(COUNT(PM_BOM[HBPM_PropertyID]),FILTER(PM_BOM,PM_BOM[BEG_OF_MONTH]<=MAX('0_Month'[BEG_OF_MONTH]) && PM_BOM[BEG_OF_MONTH]>=MIN('0_Month'[BEG_OF_MONTH])&&PM_BOM[Occupancy_Status]<>BLANK())) / (DISTINCTCOUNT('0_Month'[BEG_OF_MONTH]))`
- **0_Collection %_Rent** = `CALCULATE([0_Collections_Switch],FILTER(DW_Tenant_Charges,DW_Tenant_Charges[CHARGE_DATE_BOM]>=min('0_Month'[BEG_OF_MONTH])&&DW_Tenant_Charges[CHARGE_DATE_BOM]<=max('0_Month'[BEG_OF_MONTH])&&DW_Tenant_Charges[ACCOUNT_NUMBER]="4010"&&DW_Tenant_Charges[CREDITTYPEID]<>2),FILTER('0_Days','0_Days'[Max Day]=1),FILTER(SEL_Collections_Type,SEL_Collections_Type[Value]="Net (x-Concessions)"))`
- **0_Blended Spread %** = ```` ( CALCULATE(SUM(DW_Renewals[N_AMOUNT]),FILTER(DW_Renewals,DW_Renewals[Lease Eligibility]="Eligible"&&DW_Renewals[N_AMOUNT]<>BLANK()&&DW_Renewals[1_C_LeaseEnd(BOM)]>=MIN('0_Month'[BEG_OF_MONTH])&&DW_Renewals[1_C_LeaseEnd(BOM)]<=MAX('0_Month'[BEG_OF_MONTH]))) + CALCULATE(SUM(DW_Turns[N_INITIAL_RENT]),FILTER(DW_Turns,DW_Turns[O_CURRENT_RENT]<>BLANK()&&COALESCE(DW_Turns[N_INITIAL_RENT],DW_Turns[N_CURRENT_RENT])<>BLANK()&&DW_Turns[N_Lease_FROM (BOM)]>=MIN('0_Month'[BEG_OF_MONTH])&&DW_Turns[N_Lease_FROM (BOM)]<=MAX('0_Month'[BEG_OF_MONTH])&& DW_Turns[Lease Type]="Tenant")) ) / ( CALCULATE(SUM(DW …[truncated]`
- **0_Turnover %** = ```` DIVIDE( [01_MoveOut_Forecast], [0_Occupied #], BLANK() ) ````
- **0_Days Occ** = ```` CALCULATE(DIVIDE(SUM(PM_BOM[Days Occ]), SUM(PM_BOM[Owned Days]), BLANK()),FILTER(PM_BOM,PM_BOM[BEG_OF_MONTH]>=MIN('0_Month'[BEG_OF_MONTH])&&PM_BOM[BEG_OF_MONTH]<=MAX('0_Month'[BEG_OF_MONTH]))) ````
- **0_Retention** = `1 -'0_Month'[0_Turnover %]`
- **01_MoveIn Monthly** = `CALCULATE(DISTINCTCOUNT(DW_MoveOut[TENANT_KEY]),FILTER(DW_MoveOut,DW_MoveOut[MOVEIN_BOM]<=Max('0_Month'[BEG_OF_MONTH])&&DW_MoveOut[MOVEIN_BOM]>=MIN('0_Month'[BEG_OF_MONTH])))`
- **0_FMI #** = `CALCULATE(DISTINCTCOUNT(PM_BOM[HBPM_PropertyID]),FILTER(PM_BOM,PM_BOM[BEG_OF_MONTH]<=MAX('0_Month'[BEG_OF_MONTH])&&PM_BOM[BEG_OF_MONTH]>=MIN('0_Month'[BEG_OF_MONTH])&&PM_BOM[1_Occ_Status (DW)]=1478))`
- **02_Leads** = `CALCULATE(DISTINCTCOUNT(DW_Leads[LEAD_KEY]),FILTER(DW_Leads,DW_Leads[1_Lead_INTERESTED (BOM)]>=MIN('0_Month'[BEG_OF_MONTH])&&DW_Leads[1_Lead_INTERESTED (BOM)]<=MAX('0_Month'[BEG_OF_MONTH])&&DW_Leads[PRIMARY_LEAD_ID]=BLANK()))`
- **02_Leads_Applied** = `CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]),FILTER(DW_Deals,DW_Deals[App Submit (BOM)]>=MIN('0_Month'[BEG_OF_MONTH])&&DW_Deals[App Submit (BOM)]<=MAX('0_Month'[BEG_OF_MONTH])&&DW_Deals[APPLICATION_SUBMIT_DATE]<>BLANK()))`
- **02_Leads_Applied_App** = `CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]),FILTER(DW_Deals,DATE(YEAR(DW_Deals[APPLICATION_APPROVED_DATE]),MONTH(DW_Deals[APPLICATION_APPROVED_DATE]),1)>=MIN('0_Month'[BEG_OF_MONTH])&&DATE(YEAR(DW_Deals[APPLICATION_APPROVED_DATE]),MONTH(DW_Deals[APPLICATION_APPROVED_DATE]),1)<=MAX('0_Month'[BEG_OF_MONTH])&&DW_Deals[APPLICATION_SUBMIT_DATE]<>BLANK()&&DW_Deals[APPLICATION_APPROVED_DATE]<>BLANK()))`
- **02_Leads_HF** = `CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]),FILTER(DW_Deals,DW_Deals[HF (BOM)]>=MIN('0_Month'[BEG_OF_MONTH])&&DW_Deals[HF (BOM)]<=MAX('0_Month'[BEG_OF_MONTH])&&DW_Deals[HF Date]<>BLANK()))`
- **02_Leads_MI** = `CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]),FILTER(DW_Deals,DATE(YEAR(COALESCE(DW_Deals[CONVERT_TO_RESIDENT_DATE],DW_Deals[EXPECTED_MOVE_IN_DATE])),MONTH(COALESCE(DW_Deals[CONVERT_TO_RESIDENT_DATE],DW_Deals[EXPECTED_MOVE_IN_DATE])),1)>=MIN('0_Month'[BEG_OF_MONTH])&&DATE(YEAR(COALESCE(DW_Deals[CONVERT_TO_RESIDENT_DATE],DW_Deals[EXPECTED_MOVE_IN_DATE])),MONTH(COALESCE(DW_Deals[CONVERT_TO_RESIDENT_DATE],DW_Deals[EXPECTED_MOVE_IN_DATE])),1)<=MAX('0_Month'[BEG_OF_MONTH])&&DW_Deals[HF Date]<>BLANK()&&OR(DW_Deals[CONVERT_TO_RESIDENT_DATE]<>BLANK(),DW_Deals[EXPECTED_MOVE_IN_DATE]>=TODAY())))`
- **03_Apps:Leads** = ```` DIVIDE( COALESCE([02_Leads_Applied],0), [02_Leads], BLANK() ) ````
- **03_MI:Apps** = ```` DIVIDE( COALESCE([02_Leads_MI],0), [02_Leads_Applied], BLANK() ) ````
- **03_MI:Leads** = ```` DIVIDE( COALESCE([02_Leads_MI],0), [02_Leads], BLANK() ) ````
- **04_EOM Collections** = `CALCULATE([0_Collection_Day_Net],FILTER(DW_Tenant_Charges,DW_Tenant_Charges[CHARGE_DATE_BOM]>=min('0_Month'[BEG_OF_MONTH])&&DW_Tenant_Charges[CHARGE_DATE_BOM]<=max('0_Month'[BEG_OF_MONTH])&&DW_Tenant_Charges[ACCOUNT_NUMBER]="4010"&&DW_Tenant_Charges[CREDITTYPEID]<>2),FILTER('0_Days','0_Days'[Max Day]=1),FILTER(SEL_Collections_Type,SEL_Collections_Type[Value]="Net (x-Concessions)"))`
- **03_Appr:Apps** = ```` DIVIDE( IF([02_Leads_Applied]>0,COALESCE([02_Leads_Applied_App], [02_Leads_Applied],0), BLANK() ),BLANK()) ````
- **0_Avg_Rent** = `CALCULATE(AVERAGE(PM_BOM[CURRENT_RENT]),FILTER(PM_BOM,PM_BOM[BEG_OF_MONTH]<=MAX('0_Month'[BEG_OF_MONTH])&&PM_BOM[BEG_OF_MONTH]>=MIN('0_Month'[BEG_OF_MONTH])))`
- **0_Active_Listings** = ```` CALCULATE(DISTINCTCOUNT(DW_Listings[PROPERTY_KEY]),DW_Listings[LISTING_STATUS]="Active") ````
- **03_HF:MI** = ```` DIVIDE( COALESCE([02_Leads_MI],0), [02_Leads_HF], BLANK() ) ````
- **04_90+ Spend** = `CALCULATE([0_Run Rate (90+ Spend)],FILTER(PM_BOM,PM_BOM[BEG_OF_MONTH] >= MIN('0_Month'[BEG_OF_MONTH]) && PM_BOM[BEG_OF_MONTH] <= MAX('0_Month'[BEG_OF_MONTH])))`
- **04_Net Turn Cost** = `CALCULATE(AVERAGE(DW_Turns[1_Net Turn Cost_Collected]),FILTER(DW_Turns,DW_Turns[1_Turn Status]="Turn Completed" --&&DW_Turns[1_Turn Type]="Regular" &&DW_Turns[TURN_COMPLETED_BOM] >= MIN('0_Month'[BEG_OF_MONTH]) &&DW_Turns[TURN_COMPLETED_BOM]  <= MAX('0_Month'[BEG_OF_MONTH])))`
- **04_Renewal** = `CALCULATE(DW_Renewals[0_R_Renewal %],FILTER(DW_Renewals,DW_Renewals[1_Lease Type]="Tenant Leased"&&DW_Renewals[1_C_LeaseEnd(BOM)]<=MAX('0_Month'[BEG_OF_MONTH])&&DW_Renewals[1_C_LeaseEnd(BOM)]>=MIN('0_Month'[BEG_OF_MONTH])))`
- **04_Cycle Time** = `CALCULATE(AVERAGE(DW_WO[1_DIQ/CycleTime]),FILTER(DW_WO,DW_WO[WORKORDER_STATUS]="Closed"&&DW_WO[Closed Date_BOM]>=MIN('0_Month'[BEG_OF_MONTH])&&DW_WO[Closed Date_BOM]<=max('0_Month'[BEG_OF_MONTH])))`
- **02_HF_PullThru** = ```` DIVIDE( [01_HF_Monthly], [01_On Market List], BLANK() ) ````
- **05_Turn_MO-Scope** = `CALCULATE(AVERAGE(DW_Turns[Days_MoveOut_Scope]),FILTER(DW_Turns,EOMONTH(DW_Turns[HC_SCOPE_COMPLETED_DATE],0)=MIN('0_Month'[END_OF_MONTH])))`
- **05_Turn_Scope-Tkt** = `CALCULATE(AVERAGE(DW_Turns[Days_Scope_TKT_Created]),FILTER(DW_Turns,EOMONTH(DW_Turns[TKT_CREATED_MIN],0)=MIN('0_Month'[END_OF_MONTH])))`
- **05_Turn_Tkt Created-Closed** = `CALCULATE(AVERAGE(DW_Turns[Days_TKT_Created_TKT_Closed]),FILTER(DW_Turns,EOMONTH(DW_Turns[TKT_CLOSED_MAX],0)=MIN('0_Month'[END_OF_MONTH])))`
- **05_Turn_Tkt Closed - QC** = `CALCULATE(AVERAGE(DW_Turns[Days_TKT_Closed_QC]),FILTER(DW_Turns,EOMONTH(DW_Turns[HC_TURN_COMPLETED_DATE],0)=MIN('0_Month'[END_OF_MONTH])))`
- **05_Turn_Tkt MO-QC** = `CALCULATE(AVERAGE(DW_Turns[Days_MoveOut_Closed_QC]),FILTER(DW_Turns,EOMONTH(DW_Turns[HC_TURN_COMPLETED_DATE],0)=MIN('0_Month'[END_OF_MONTH])))`
- **05_Turn_Tkt MO-List** = `CALCULATE(AVERAGE(DW_Turns[Days_MoveOut_List]),FILTER(DW_Turns,EOMONTH(DW_Turns[N_LISTING_DATE],0)=MIN('0_Month'[END_OF_MONTH])))`
- **01_FMI Monthly** = `CALCULATE(DISTINCTCOUNT(DW_Listings[RENT_LIST_HIST_ID]),FILTER(DW_Listings,DW_Listings[LEASE_START_DATE_BOM]>=MIN('0_Month'[BEG_OF_MONTH])&&DW_Listings[LEASE_START_DATE_BOM]<=MAX('0_Month'[BEG_OF_MONTH])&&DW_Listings[CURRENT_DEAL_STATUS]<>"Deal Won"&&DW_Listings[CURRENT_DEAL_STATUS]<>"Closed Won"&&DW_Listings[MOST_RECENT_LISTING]="Yes"&&DW_Listings[FMI_FLAG]=1))`
- **01_MI_Combined** = `COALESCE([01_MoveIn Monthly] + [01_FMI Monthly],0)`
- **01_MoveOut_Forecast** = `CALCULATE(DISTINCTCOUNT(DW_MoveOut[TENANT_KEY]),FILTER(DW_MoveOut,DW_MoveOut[MOVEOUT_BOM]<=MAX('0_Month'[BEG_OF_MONTH])&&DW_MoveOut[MOVEOUT_BOM]>=MIN('0_Month'[BEG_OF_MONTH]))) + CALCULATE(DISTINCTCOUNT(DW_MoveOut[TENANT_KEY]),FILTER(DW_MoveOut,DW_MoveOut[MOVEOUT]=BLANK()&&DW_MoveOut[1_Renewal Result]<>"Pending"&&DW_MoveOut[EVICITON_AMOD_FLAG]=0&&DW_MoveOut[STRATEGY_NAME]<>"Repair/Sell"&&DW_MoveOut[MOVE_OUT_FORECAST_BOM]<=MAX('0_Month'[BEG_OF_MONTH])&&DW_MoveOut[MOVE_OUT_FORECAST_BOM]>=MIN('0_Month'[BEG_OF_MONTH])))`
- **01_Forecasted_Net_Occupancy** = `COALESCE([01_MI_Combined] - [01_MoveOut_Forecast],0)`
- **0_Eviction %** = `CALCULATE(DW_Renewals[0_Eviction Exposure],FILTER(DW_Renewals,DW_Renewals[1_C_LeaseEnd(BOM)]>=MIN('0_Month'[BEG_OF_MONTH])&&DW_Renewals[1_C_LeaseEnd(BOM)]<=MAX('0_Month'[BEG_OF_MONTH])))`
- **0_Vacant #** = ```` CALCULATE(COUNT(PM_BOM[HBPM_PropertyID]),FILTER(PM_BOM,AND(PM_BOM[BEG_OF_MONTH]<=MAX('0_Month'[BEG_OF_MONTH])&&PM_BOM[BEG_OF_MONTH]>=MIN('0_Month'[BEG_OF_MONTH]), PM_BOM[1_Occ_Status (DW)]= 1476 || PM_BOM[1_Occ_Status (DW)]= 1477 || PM_BOM[1_Occ_Status (DW)]= 1478 || PM_BOM[1_Occ_Status (DW)]= 1483 || PM_BOM[1_Occ_Status (DW)]= 1489 || PM_BOM[1_Occ_Status (DW)]= 10000))) ````
- **01_Lease_Listings %** = ```` DIVIDE( COALESCE(([01_MoveIn Monthly]+[01_FMI Monthly]),0), [01_On Market List], BLANK() ) ````
- **0_Occ_EOM %** = ```` IFERROR(CALCULATE(([0_Occupied #]+[01_Forecasted_Net_Occupancy])/[0_Stabilized],FILTER('0_Month','0_Month'[BEG_OF_MONTH]=MAX('0_Month'[BEG_OF_MONTH]))),BLANK()) ````
- **01_Lease %** = `DIVIDE( COALESCE(([01_MoveIn Monthly]+[01_FMI Monthly]),0), [0_Vacant #], BLANK() )`
- **04_Renewal_Rent_Growth** = `CALCULATE([0_Rent Growth],FILTER(DW_Renewals,DW_Renewals[1_C_LeaseEnd(BOM)]>=MIN('0_Month'[BEG_OF_MONTH])&&DW_Renewals[1_C_LeaseEnd(BOM)]<=MAX('0_Month'[BEG_OF_MONTH])))`
- **0_Renewal_Actual** = `CALCULATE([0_Active Renew %],FILTER(DW_Renewals,DW_Renewals[Lease Eligibility]="Eligible"&&DW_Renewals[1_C_LeaseEnd(BOM)]<=MAX('0_Month'[BEG_OF_MONTH])&&DW_Renewals[1_C_LeaseEnd(BOM)]>=MIN('0_Month'[BEG_OF_MONTH])))`
- **0_Release Growth** = ```` CALCULATE([0_Turn_Rent Growth],FILTER(DW_Turns,DW_Turns[O_CURRENT_RENT]<>BLANK()&&COALESCE(DW_Turns[N_INITIAL_RENT],DW_Turns[N_CURRENT_RENT])<>BLANK()&&DW_Turns[N_Lease_FROM (BOM)]<=MAX('0_Month'[BEG_OF_MONTH])&&DW_Turns[N_Lease_FROM (BOM)]>=MIN('0_Month'[BEG_OF_MONTH])&& DW_Turns[Lease Type]="Tenant")) ````
- **01_HF_Monthly_Rent** = `CALCULATE(AVERAGE(DW_Deals[CURRENTLISTPRICE]),FILTER(DW_Deals,DW_Deals[HF (BOM)]<>BLANK()&&DW_Deals[HF (BOM)]<=Max('0_Month'[BEG_OF_MONTH])&&DW_Deals[HF (BOM)]>=Min('0_Month'[BEG_OF_MONTH])))`
- **04_Interal Maintenance** = `CALCULATE(SUM(DW_WO[CLIENT_INVOICE_AMOUNT]),FILTER(DW_WO,DW_WO[WORKORDER_STATUS]="Closed"&&DW_WO[IS_INTERNAL_VENDOR]="Y"&&DW_WO[Closed Date_BOM]>=MIN('0_Month'[BEG_OF_MONTH])&&DW_WO[Closed Date_BOM]<=MAX('0_Month'[BEG_OF_MONTH])))`
- **04_IM_Goal** = `DISTINCTCOUNT(DW_Properties[POD])*2*2000*4`
- **0_Occ_EOM_2** = `IFERROR(CALCULATE(([0_Occupied #] + [01_Forecasted_Net_Occupancy]+ CALCULATE( DISTINCTCOUNT(DW_Listings[RENT_LIST_HIST_ID]), FILTER( DW_Listings, DW_Listings[LEASE_START_DATE_BOM] >= EOMONTH(MIN('0_Month'[BEG_OF_MONTH]), 0) + 1 && DW_Listings[LEASE_START_DATE_BOM] <= EOMONTH(MIN('0_Month'[BEG_OF_MONTH]), 1) && DW_Listings[CURRENT_DEAL_STATUS] <> "Deal Won" && DW_Listings[CURRENT_DEAL_STATUS] <> "Closed Won" && DW_Listings[MOST_RECENT_LISTING] = "Yes" && DW_Listings[FMI_FLAG] = 1 ) ) -CALCULATE( DISTINCTCOUNT(DW_MoveOut[TENANT_KEY]), DW_MoveOut[MOVEOUT] = BLANK(), DW_MoveOut[1_Renewal Result] < …[truncated]`

## DW_Deals  (9 measures)

- **0_Deal Count** = ```` DISTINCTCOUNT(DW_Deals[EMAIL]) + 0 ````
- **0_Rent Var (HF)** = ```` CALCULATE(DIVIDE(SUM(DW_Deals[CURRENTLISTPRICE]), SUM(DW_Deals[1_ASM_Blended]), BLANK()),FILTER(DW_Deals,DW_Deals[CURRENT_DEAL_STATUS]<>"Closed Lost"&&DW_Deals[CURRENTLISTPRICE]<>BLANK()&&DW_Deals[1_ASM_Blended]<>blank())) - 1 ````
- **0_Deal Count (Raw)** = `DISTINCTCOUNT(DW_Deals[EMAIL])`
- **0_Deal W/W** = ```` VAR thisWeek = CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]), DW_Deals[APPLICATION_SUBMIT_DATE] >= TODAY()-7, DW_Deals[APPLICATION_SUBMIT_DATE] <= TODAY()-1) VAR lastWeek = CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]), DW_Deals[APPLICATION_SUBMIT_DATE] >= TODAY()-14, DW_Deals[APPLICATION_SUBMIT_DATE] <= TODAY()-8) RETURN DIVIDE(thisWeek, lastWeek) ````
- **0_Deal Count FORMAT** = `IF(max(DW_Deals[HF (BOM)])=DATE(YEAR(TODAY()),MONTH(TODAY()),1),BLANK(),DISTINCTCOUNT(DW_Deals[EMAIL]) )`
- **0_HF_Net** = `CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]),FILTER(DW_Deals,DW_Deals[CURRENT_DEAL_STATUS]<>"Closed Lost"&&DW_Deals[CURRENT_DEAL_STATUS]<>"Property Listed"&&DW_Deals[CURRENT_DEAL_STATUS]<>"Deal Lost"&&DW_Deals[CURRENT_DEAL_STATUS]<>"Deal On Hold"&&DW_Deals[CURRENT_DEAL_STATUS]<>"Rejected"))`
- **0_HF_Gross** = `CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]))`
- **0_Approval** = ```` CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]),FILTER(DW_Deals,DW_Deals[APPLICATION_APPROVED_DATE]<>BLANK()&&DW_Deals[APPLICATION_SUBMIT_DATE]<>BLANK()&&DW_Deals[APP_STAGE]<>"Under Review"&&DW_Deals[PRIMARY_LEAD_ID]=BLANK())) / CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]),FILTER(DW_Deals,DW_Deals[APPLICATION_SUBMIT_DATE]<>BLANK()&&DW_Deals[APP_STAGE]<>"Under Review"&&DW_Deals[PRIMARY_LEAD_ID]=BLANK())) ````
- **0_App_IP** = `CALCULATE(DISTINCTCOUNT(DW_Deals[EMAIL]),FILTER(DW_Deals,DW_Deals[APP_STAGE]="Aplication Started"&&DW_Deals[DAYS_SINCE_APP_SUBMIT]<=30))`

## DW_Inspections  (1 measures)

- **0_Inspection_Count** = ```` DISTINCTCOUNT(DW_Inspections[INSPECTION_ID]) + 0 ````

## DW_Leads  (3 measures)

- **0_Leads_Card** = `CALCULATE(DISTINCTCOUNT(DW_Leads[LEAD_KEY])) +0`
- **0_Leads** = ```` CALCULATE(DISTINCTCOUNT(DW_Leads[LEAD_key]),DW_Leads[PRIMARY_LEAD_ID]=BLANK()) ````
- **0_Leads W/W** = ```` VAR thisWeek = CALCULATE(DISTINCTCOUNT(DW_Leads[LEAD_KEY]), DW_Leads[LEAD_CREATED_DATE] >= TODAY()-7, DW_Leads[LEAD_CREATED_DATE] <= TODAY()-1) VAR lastWeek = CALCULATE(DISTINCTCOUNT(DW_Leads[LEAD_KEY]), DW_Leads[LEAD_CREATED_DATE] >= TODAY()-14, DW_Leads[LEAD_CREATED_DATE] <= TODAY()-8) RETURN DIVIDE(thisWeek, lastWeek) ````

## DW_Listings  (14 measures)

- **0_MoveIns** = `COUNT(DW_Listings[PROPERTY_KEY]) + 0`
- **0_% Listings w/ Leads** = ```` CALCULATE(DISTINCTCOUNT(DW_Listings[PROPERTY_KEY]),DW_Listings[1_Leads_L7]<>BLANK()) / CALCULATE(DISTINCTCOUNT(DW_Listings[PROPERTY_KEY])) + 0 ````
- **0_% Listings w/ Apps** = ```` CALCULATE(DISTINCTCOUNT(DW_Listings[PROPERTY_KEY]),DW_Listings[1_Applications_Open]<>BLANK()) / CALCULATE(DISTINCTCOUNT(DW_Listings[PROPERTY_KEY])) +0 ````
- **0_Rent Var (MI)** = ```` CALCULATE(DIVIDE(SUM(DW_Listings[CURRENT_RENT]), SUM(DW_Listings[UNDER_WRITTEN_RENT]), BLANK()),FILTER(DW_Listings,DW_Listings[CURRENT_RENT]<>BLANK()&&DW_Listings[UNDER_WRITTEN_RENT]<>blank())) - 1 ````
- **0_Rent Var (Lease)** = ```` IF(sum(DW_Listings[LAST_LEASE_AMOUNT])=BLANK(),BLANK(), CALCULATE(DIVIDE(SUM(DW_Listings[CURRENT_LIST_PRICE]), SUM(DW_Listings[LAST_LEASE_AMOUNT]), BLANK()),FILTER(DW_Listings,DW_Listings[CURRENT_LIST_PRICE]<>BLANK()&&DW_Listings[LAST_LEASE_AMOUNT]<>blank()))-1) ````
- **0_Listing Count** = ```` COUNT(DW_Listings[PROPERTY_KEY]) ````
- **0_Listing Var** = ```` CALCULATE(DIVIDE(SUM(DW_Listings[CURRENT_LIST_PRICE]), SUM(DW_Listings[ASM_BLENDED_UW_RENT]), BLANK()),FILTER(DW_Listings,DW_Listings[CURRENT_LIST_PRICE]<>BLANK()&&DW_Listings[ASM_BLENDED_UW_RENT]<>BLANK())) -1 ````
- **0_Listing Count (Card)** = `DISTINCTCOUNT(DW_Listings[PROPERTY_KEY]) + 0`
- **0_% Listings w/ Showings** = `CALCULATE(DISTINCTCOUNT(DW_Listings[PROPERTY_KEY]),FILTER(DW_Listings,DW_Listings[1_Showings_L7]<>BLANK()||DW_Listings[LISTING_DOM]<=3)) / CALCULATE(DISTINCTCOUNT(DW_Listings[PROPERTY_KEY])) + 0`
- **0_% Listings w/ Modifications** = ```` CALCULATE(DISTINCTCOUNT(DW_Listings[PROPERTY_KEY]),FILTER(DW_Listings,AND(DW_Listings[Days_Since_Reduction_Active]<=7,DW_Listings[Days_Since_Reduction_Active]<>BLANK())||AND(DW_Listings[Days_On_Market_Active]<=7,DW_Listings[Days_On_Market_Active]<>BLANK()))) / CALCULATE(DISTINCTCOUNT(DW_Listings[PROPERTY_KEY])) ````
- **0_List/Sq** = ```` DIVIDE(SUM(DW_Listings[CURRENT_LIST_PRICE]), SUM(DW_Listings[SQUARE_FOOTAGE]), BLANK()) ````
- **0_Leads_per_DOM** = ```` DIVIDE(SUM(DW_Listings[1_Leads_L7_Created]), SUM(DW_Listings[Days_On_Market_Active_Last_Week]), BLANK()) ````
- **1_Concession %** = ```` DIVIDE(SUM(DW_Listings[CONCESSIONAMOUNT]), SUM(DW_Listings[CURRENT_LIST_PRICE]), BLANK()) ````
- **0_Rent Var (RentCast)** = `IF(SUM(DW_Listings[CURRENT_LIST_PRICE])<>BLANK()&&SUM(DW_Listings[1_Rent_Cast_Estimate])<>BLANK(),CALCULATE(SUM(DW_Listings[CURRENT_LIST_PRICE]) / sum(DW_Listings[1_Rent_Cast_Estimate]),FILTER(DW_Listings,DW_Listings[CURRENT_LIST_PRICE]<>BLANK()&&DW_Listings[1_Rent_Cast_Estimate]<>BLANK())) -1,BLANK())`

## DW_MoveOut  (3 measures)

- **0_Distinct MO** = `DISTINCTCOUNT(DW_MoveOut[LEASE_ID]) + 0`
- **0_Distinct MO (Clean)** = `DISTINCTCOUNT(DW_MoveOut[LEASE_ID])`
- **0_Rent Var (MoveOut)** = ```` CALCULATE(DIVIDE(SUM(DW_MoveOut[CURRENT_RENT]), SUM(DW_MoveOut[1_ASM_Blended]), BLANK()),FILTER(DW_MoveOut,DW_MoveOut[CURRENT_RENT]<>BLANK()&&DW_MoveOut[1_ASM_Blended]<>blank())) - 1 ````

## DW_Off Market  (3 measures)

- **0_Off_Market_Count** = `DISTINCTCOUNT('DW_Off Market'[PROPERTY_KEY]) + 0`
- **0_Squatter / Other** = `CALCULATE(DISTINCTCOUNT('DW_Off Market'[PROPERTY_KEY]),FILTER('DW_Off Market','DW_Off Market'[REASONOFFMARKETNAME]="Squatter")) + 0 & " / " & CALCULATE(DISTINCTCOUNT('DW_Off Market'[PROPERTY_KEY]),FILTER('DW_Off Market','DW_Off Market'[REASONOFFMARKETNAME]<>"Squatter"&&'DW_Off Market'[REASONOFFMARKETNAME]<>BLANK()&&'DW_Off Market'[REASONOFFMARKETNAME]<>"Maintenance In Progress")) + 0`
- **0_DRC Var** = `IF(MIN(DW_Properties[1_DRC_Status])="Off-Market",BLANK(),CALCULATE(sum(DW_Properties[1_DRC_Price]) / SUM(DW_Properties[UNDER_WRITTEN_RENT]) ,FILTER(DW_Properties,DW_Properties[1_DRC_Price]<>BLANK()&&DW_Properties[UNDER_WRITTEN_RENT]<>BLANK()))-1)`

## DW_Properties  (6 measures)

- **0_Count** = ```` if(ISBLANK(CALCULATE(DISTINCTCOUNT(DW_Properties[PROPERTY_KEY]))), 0, CALCULATE(DISTINCTCOUNT(DW_Properties[PROPERTY_KEY]))) ````
- **0_Rent Var** = ```` IF([0_Count_Raw]=BLANK(),BLANK(),CALCULATE(DIVIDE(SUM(DW_Properties[CURRENT_RENT]), SUM(DW_Properties[UNDER_WRITTEN_RENT]), BLANK()),FILTER(DW_Properties,DW_Properties[CURRENT_RENT]<>BLANK()&&DW_Properties[UNDER_WRITTEN_RENT]<>blank())) - 1) ````
- **0_Rent / Sqft** = ```` DIVIDE( CALCULATE(SUM(DW_Properties[CURRENT_RENT]), DW_Properties[CURRENT_RENT] <> BLANK(), DW_Properties[SQUARE_FOOTAGE] <> BLANK()), CALCULATE(SUM(DW_Properties[SQUARE_FOOTAGE]), DW_Properties[CURRENT_RENT] <> BLANK(), DW_Properties[SQUARE_FOOTAGE] <> BLANK()) ) ````
- **0_Count_Raw** = `CALCULATE(DISTINCTCOUNT(DW_Properties[PROPERTY_KEY]))`
- **0_Current_Occupancy** = ```` VAR occupied = CALCULATE(COUNTROWS(DW_Properties), DW_Properties[OCCUPANCY_STATUS_SUMMARYID] IN {7,8}) VAR total    = CALCULATE(COUNTROWS(DW_Properties), NOT ISBLANK(DW_Properties[OCCUPANCY_STATUS_SUMMARYID])) RETURN DIVIDE(occupied, total) ````
- **0_PPW_On_Schedule** = ```` CALCULATE(COUNTROWS(DW_Properties),DW_Properties[1_PPW_GC_Status]="On Schedule") / CALCULATE(COUNTROWS(DW_Properties),DW_Properties[1_PPW_GC_Status]<>BLANK()) ````

## DW_Renewals  (14 measures)

- **0_Rent Growth** = ```` if(average(DW_Renewals[N_AMOUNT])=BLANK(),BLANK(),CALCULATE( DIVIDE(AVERAGE(DW_Renewals[N_AMOUNT]), AVERAGE(DW_Renewals[C_AMOUNT]), BLANK()) -1,DW_Renewals[N_AMOUNT]<>BLANK())) ````
- **0_R_Renewal %** = ```` calculate(COUNTROWS(DW_Renewals),DW_Renewals[Renewal Result]="Renewed")/CALCULATE(COUNTROWS(DW_Renewals),DW_Renewals[STRATEGY_NAME]<>"Repair/Sell") ````
- **0_Renewal Count** = `COUNT(DW_Renewals[PROPERTY_KEY]) +0`
- **0_Current Rent** = ```` calculate(AVERAGE(DW_Renewals[C_AMOUNT]),DW_Renewals[N_AMOUNT]<>BLANK()) ````
- **0_Renewal Chart %** = ```` IF(MAX(DW_Renewals[YTD Filter])=1&&COUNT(DW_Renewals[PROPERTY_KEY])>0,COALESCE(calculate(COUNTROWS(DW_Renewals),DW_Renewals[N_LEASESIGNED]<>BLANK()),0)/COUNT(DW_Renewals[PROPERTY_KEY]), calculate(COUNTROWS(DW_Renewals),DW_Renewals[N_LEASESIGNED]<>BLANK())/COUNT(DW_Renewals[PROPERTY_KEY])) ````
- **0_Gross_Renewal (L3) %** = ```` calculate(COUNTROWS(DW_Renewals),FILTER(DW_Renewals,DW_Renewals[N_LEASESIGNED]<>BLANK()&&DW_Renewals[Lease Eligibility]="Eligible")) / CALCULATE(COUNT(DW_Renewals[PROPERTY_KEY]),DW_Renewals[Lease Eligibility]="Eligible") ````
- **0_Eligible** = ```` CALCULATE(COUNTROWS(DW_Renewals),DW_Renewals[Lease Eligibility]="Eligible") ````
- **0_Eviction Exposure** = `CALCULATE(COUNTROWS(DW_Renewals),FILTER(DW_Renewals,DW_Renewals[Renewal Result]="Current Eviction"||DW_Renewals[Renewal Result]=" Early Vacate - Evictions")) / CALCULATE(COUNTROWS(DW_Renewals))`
- **0_Max Renewal** = `CALCULATE(COUNTROWS(DW_Renewals),FILTER(DW_Renewals,DW_Renewals[Renewal Result]="Renewed"||DW_Renewals[Renewal Result]="Pending")) / CALCULATE(COUNTROWS(DW_Renewals),FILTER(DW_Renewals,AND(DW_Renewals[STRATEGY_NAME]<>"Repair/Sell",DW_Renewals[Renewal Result]="Renewed"||DW_Renewals[Renewal Result]="Notice"||DW_Renewals[Renewal Result]="MTM"||DW_Renewals[Renewal Result]="Pending")))`
- **0_ET_Other** = ```` CALCULATE(COUNTROWS(DW_Renewals),DW_Renewals[Renewal Result]=" Early Vacate - Other") / CALCULATE(COUNTROWS(DW_Renewals)) ````
- **0_Active Renew %** = ```` CALCULATE(COUNTROWS(DW_Renewals),DW_Renewals[Renewal Result]="Renewed") / CALCULATE(COUNTROWS(DW_Renewals),FILTER(DW_Renewals,AND(DW_Renewals[STRATEGY_NAME]<>"Repair/Sell",DW_Renewals[Renewal Result]="Renewed"||DW_Renewals[Renewal Result]="Notice"||DW_Renewals[Renewal Result]="MTM"))) ````
- **0_Implied Retention** = ```` (([0_Active Renew %] * CALCULATE(COUNTROWS(DW_Renewals),DW_Renewals[Renewal Result]="Pending") ) + (CALCULATE(COUNTROWS(DW_Renewals),DW_Renewals[Renewal Result]="Renewed"))) / CALCULATE(COUNTROWS(DW_Renewals)) ````
- **0_1_YR_Offer_Mrkt_Prem** = ```` if(AVERAGE(DW_Renewals[MARKET_RENT])=blank(),blank(),CALCULATE(DIVIDE(AVERAGE(DW_Renewals[RATE_12_MONTH]), AVERAGE(DW_Renewals[MARKET_RENT]), BLANK())-1,FILTER(DW_Renewals,DW_Renewals[RATE_12_MONTH]>0&&DW_Renewals[MARKET_RENT]>0))) ````
- **0_1_YR_Offer_Rent_Growth** = ```` if(AVERAGE(DW_Renewals[RATE_12_MONTH])=blank(),blank(),CALCULATE(DIVIDE(AVERAGE(DW_Renewals[RATE_12_MONTH]), AVERAGE(DW_Renewals[C_AMOUNT]), BLANK())-1,FILTER(DW_Renewals,DW_Renewals[RATE_12_MONTH]>0&&DW_Renewals[C_AMOUNT]>0))) ````

## DW_Showings  (3 measures)

- **0_Showing_Count_Card** = `COUNT(DW_Showings[LEAD]) + 0`
- **0_Showing_Count** = `COUNT(DW_Showings[LEAD])`
- **0_Shows W/W** = `IFERROR((CALCULATE(COUNT(DW_Showings[LEAD]),FILTER(DW_Showings,DW_Showings[ACTIVITY_CREATED_AT]>=(TODAY()-7)&&DW_Showings[ACTIVITY_CREATED_AT]<=(TODAY()-1))) + 0 ) / CALCULATE(COUNT(DW_Showings[LEAD]),FILTER(DW_Showings,DW_Showings[ACTIVITY_CREATED_AT]>=(TODAY()-14)&&DW_Showings[ACTIVITY_CREATED_AT]<=(TODAY()-8))) -1,"N/A")`

## DW_Tenant  (10 measures)

- **0_% Delinquent** = ```` CALCULATE([0_Distinct_Tenant_Count],DW_Tenant[1_Balance]>0) / IF(HASONEVALUE(SEL_LeaseType[Lease Type]), CALCULATE([0_Distinct_Tenant_Count],filter(ALLEXCEPT(DW_Properties,DW_Properties[ORGANIZATION_NAME],DW_Properties[PORTFOLIO_NAME],DW_Properties[REGION_NAME],DW_Properties[OCCUPANCY_STATUS],DW_Properties[FULL_ADDRESS]),DW_Properties[OCCUPANCY_STATUS_SUMMARY]=SELECTEDVALUE(SEL_LeaseType[Lease Type])),ALLEXCEPT(DW_Tenant,DW_Tenant[TENANT_STATUS])), CALCULATE([0_Distinct_Tenant_Count],ALLEXCEPT(DW_Properties,DW_Properties[ORGANIZATION_NAME],DW_Properties[PORTFOLIO_NAME],DW_Properties[REGION …[truncated]`
- **0_Distinct_Tenant_Count** = `CALCULATE(DISTINCTCOUNT(DW_Tenant[PROPERTY_KEY])) + 0`
- **0_Rent Var (Ten)** = ```` CALCULATE(DIVIDE(SUM(DW_Tenant[CURRENT_RENT]), SUM(DW_Tenant[UNDER_WRITTEN_RENT]), BLANK()),FILTER(DW_Tenant,DW_Tenant[CURRENT_RENT]<>BLANK()&&DW_Tenant[UNDER_WRITTEN_RENT]<>blank())) - 1 ````
- **0_Days_In_Home** = `IF([0_Count_Raw]=BLANK(),BLANK(), ROUNDDOWN(AVERAGE(DW_Tenant[DAYS_IN_HOME])/365,0)&"y "&rounddown((AVERAGE(DW_Tenant[DAYS_IN_HOME]) - (ROUNDDOWN(AVERAGE(DW_Tenant[DAYS_IN_HOME])/365,0) *365))/30,0)&"m")`
- **0_% Delinquent (DIH)** = ```` CALCULATE([0_Distinct_Tenant_Count],DW_Properties[1_Tenant Balance Status (Rent)]="Delinquent") / CALCULATE([0_Distinct_Tenant_Count]) ````
- **0_Dem_% Children** = ```` CALCULATE(DIVIDE(SUM(DW_Tenant[DEM_HAS_CHILDREN]), DISTINCTCOUNT(DW_Tenant[TENANT_KEY]), BLANK())) ````
- **0_Dem_% Pets** = ```` CALCULATE(DIVIDE(SUM(DW_Tenant[DEM_WITH_PETS]), DISTINCTCOUNT(DW_Tenant[TENANT_KEY]), BLANK())) ````
- **0_MTM** = `CALCULATE(DISTINCTCOUNT(DW_Tenant[PROPERTY_KEY]),FILTER(DW_Tenant,DW_Tenant[TENANT_STATUS]<>"Past"&&OR(DW_Tenant[MONTH_TO_MONTH]="Y",DW_Tenant[CURRENT_LEASE_EXPIRATION_DATE]<>BLANK()&&DW_Tenant[CURRENT_LEASE_EXPIRATION_DATE]<TODAY())))`
- **0_Tenant Count FORMAT** = `IF(max(DW_Tenant[MOVEIN_BOM])=DATE(YEAR(TODAY()),MONTH(TODAY()),1),BLANK(),COUNT(DW_Tenant[TENANT_KEY]))`
- **1_Concession_%** = ```` DIVIDE(SUM(DW_Tenant[1_Concession_Amount]), SUM(DW_Tenant[CURRENT_RENT]), BLANK()) ````

## DW_Tenant_Charges  (8 measures)

- **0_Collection %** = ```` IF(SUM(DW_Tenant_Charges[Charge_Amount])>0, min(COALESCE(SUM(DW_Tenant_Receipts[PAID_AMOUNT]),0) /SUM(DW_Tenant_Charges[Charge_Amount]), 1), min(DIVIDE(SUM(DW_Tenant_Receipts[PAID_AMOUNT]), SUM(DW_Tenant_Charges[Charge_Amount]), BLANK()), 1)) ````
- **0_Collection_FORMAT %** = `IF(MAX(DW_Tenant_Charges[Charge_Date_BOM])=DATE(YEAR(TODAY()),MONTH(TODAY()),1),BLANK(),DW_Tenant_Charges[0_Collection %])`
- **0_Concessions** = ```` CALCULATE(SUM(DW_Tenant_Receipts[PAID_AMOUNT]),FILTER(DW_Tenant_Receipts,DW_Tenant_Receipts[CREDITTYPEID]=1)) ````
- **0_Collections_Net** = `IF(SUM(DW_Tenant_Charges[Charge_Amount])>0, min(COALESCE((SUM(DW_Tenant_Receipts[PAID_AMOUNT]) -[0_Concessions]),0) / (SUM(DW_Tenant_Charges[Charge_Amount]) - [0_Concessions]), 1), min((SUM(DW_Tenant_Receipts[PAID_AMOUNT]) - [0_Concessions]) /(SUM(DW_Tenant_Charges[Charge_Amount])- [0_Concessions]), 1))`
- **0_Collections_Switch** = `IF(SELECTEDVALUE(SEL_Collections_Type[Value])="Net (x-Concessions)",[0_Collections_Net],[0_Collection %])`
- **0_Unpaid** = `SUM(DW_Tenant_Charges[Charge_Amount]) - SUM(DW_Tenant_Receipts[PAID_AMOUNT])`
- **0_Delinquency** = `IF(DW_Tenant_Charges[0_Charges]>0, 1 - [0_Collections_Switch], BLANK())`
- **0_Charges** = `(SUM(DW_Tenant_Charges[Charge_Amount]) - IF(SELECTEDVALUE(SEL_Collections_Type[Value])="Gross",BLANK(),[0_Concessions]))`

## DW_Tenant_Receipts  (1 measures)

- **0_Receipts** = `(SUM(DW_Tenant_Receipts[PAID_AMOUNT]) - IF(SELECTEDVALUE(SEL_Collections_Type[Value])="Gross",BLANK(),[0_Concessions]))`

## DW_Turns  (8 measures)

- **0_Count_Turns** = ```` if(ISBLANK(CALCULATE(DISTINCTCOUNT(DW_Turns[PROPERTY_KEY]))), 0, CALCULATE(DISTINCTCOUNT(DW_Turns[PROPERTY_KEY]))) ````
- **0_Turn_Rent Growth** = ```` if(average(DW_Turns[O_LEASE_FROM_DATE])=blank(),blank(),CALCULATE( DIVIDE(AVERAGE(DW_Turns[N_CURRENT_RENT]), AVERAGE(DW_Turns[O_CURRENT_RENT]), BLANK()) -1,FILTER(DW_Turns,DW_Turns[N_CURRENT_RENT]<>BLANK()&&DW_Turns[O_CURRENT_RENT]<>BLANK()))) ````
- **0_Days in Status** = `AVERAGE(DW_Turns[1_Days in Status]) + 0`
- **0_List vs. Prior** = ```` DIVIDE(SUM(DW_Turns[N_LISTING_PRICE]), SUM(DW_Turns[O_CURRENT_RENT]), BLANK()) - 1 ````
- **0_MO Charges Collected %** = ```` MIN(CALCULATE(DIVIDE(SUM(DW_Turns[MOVEOUTRECEIPTS_FINAL]), SUM(DW_Turns[MOVEOUTCHARGES]), BLANK()),DW_Turns[1_Net Turn Cost_Collected]<>BLANK()),1) ````
- **0_Turn_Spend_Per_Day** = ```` CALCULATE(DIVIDE(SUM(DW_Turns[TKT_COST]), SUM(DW_Turns[1_Vendor Days]), BLANK()),DW_Turns[1_Vendor Days]<>BLANK()) ````
- **0_Eviction_Turns** = ```` CALCULATE(DISTINCTCOUNT(DW_Turns[PROPERTY_KEY]),DW_Turns[1_Turn Type]="Eviction")/ CALCULATE(DISTINCTCOUNT(DW_Turns[PROPERTY_KEY])) ````
- **0_RateCards** = ```` CALCULATE(COUNTROWS(DW_Turns),DW_Turns[1_Turn_Tkt_Substatus]="Unsubmitted") & " / " & CALCULATE(COUNTROWS(DW_Turns),DW_Turns[1_Turn_Tkt_Substatus]="Pending") & " / " & CALCULATE(COUNTROWS(DW_Turns),DW_Turns[1_Turn_Tkt_Substatus]="Approved") ````

## DW_WO  (5 measures)

- **0_TKT_Count** = `Count(DW_WO[TICKET_KEY])`
- **0_Cancelled** = ```` CALCULATE(COUNTROWS(DW_WO),DW_WO[WORKORDER_STATUS]="Cancelled") / CALCULATE(COUNTROWS(DW_WO),DW_WO[WORKORDER_STATUS]="Closed") ````
- **0_Tenant_Chargeback** = `CALCULATE(SUM(DW_WO[CLIENT_TENANT_RESPONSIBLE_AMOUNT]) / CALCULATE(SUM(DW_WO[CLIENT_INVOICE_AMOUNT])))`
- **0_Created** = `CALCULATE(COUNT(DW_WO[WORKORDER_KEY]),FILTER(DW_WO,DW_WO[WO_CREATED_DATE]>=(TODAY() - IF(SELECTEDVALUE(SEL_CR_CL[Date Filter]) = "Day" , 1, IF(SELECTEDVALUE(SEL_CR_CL[Date Filter]) = "WeeK" , 6, IF(SELECTEDVALUE(SEL_CR_CL[Date Filter]) = "Month" , 29,BLANK()))))))`
- **0_Closed** = `CALCULATE(COUNT(DW_WO[WORKORDER_KEY]),FILTER(DW_WO,COALESCE(DW_WO[CLIENT_INVOICE_DATE],DW_WO[WO_CLOSED_DATE])>=(TODAY() - IF(SELECTEDVALUE(SEL_CR_CL[Date Filter]) = "Day" , 1, IF(SELECTEDVALUE(SEL_CR_CL[Date Filter]) = "WeeK" , 6, IF(SELECTEDVALUE(SEL_CR_CL[Date Filter]) = "Month" , 29,BLANK()))))))`

## GS_CodeViolations  (1 measures)

- **0_Violation Count** = `DISTINCTCOUNT(GS_CodeViolations[Violation ID]) + 0`

## LTO  (4 measures)

- **0_FP** = `IF(ISFILTERED(LTO[ENTITYID]),FIRSTNONBLANK(LTO[FLOORPLAN],LTO[FLOORPLAN]),BLANK())`
- **0_Address** = `IF(ISFILTERED(LTO[ENTITYID]),FIRSTNONBLANK(LTO[ADDRESS],LTO[ADDRESS]),BLANK())`
- **0_NLS** = `IF(ISFILTERED(LTO[ENTITYID]),FIRSTNONBLANK(LTO[N_LEASESTART],LTO[N_LEASESTART]),BLANK())`
- **0_RG** = ```` IF( SUM(LTO[N_AMOUNT])<>BLANK()&&SUM(LTO[N_AMOUNT])<>BLANK(), (DIVIDE(SUM(LTO[N_AMOUNT]), SUM(LTO[C_AMOUNT]), BLANK())) -1, BLANK()) ````

## PM_BOM  (2 measures)

- **0_Run Rate (90+ Spend)** = ```` (DIVIDE(SUM(PM_BOM[MM Ongoing Spend Post Lease+90]), SUM(PM_BOM[DAYS_POST_90_MTD]), BLANK())) * 365 ````
- **0_Run Rate Monthly** = `FORMAT(SUM(PM_BOM[MM Ongoing Spend Post Lease+90]), "$#,###") &" / " & FORMAT(SUM(PM_BOM[DAYS_POST_90_FULL]) * 1700/365, "$#,###")`

## SEL_WO_CHART  (1 measures)

- **0_Value** = `VAR Choice = SELECTEDVALUE(SEL_WO_CHART[Value]) return IF(Choice="Count",[0_TKT_Count],IF(Choice="Invoice Amount",SUM(DW_WO[CLIENT_INVOICE_AMOUNT]),BLANK()))`

_Total: 214 measures across mirrored tables._
