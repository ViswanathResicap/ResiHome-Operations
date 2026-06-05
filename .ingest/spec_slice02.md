# Summary page — visual spec, slice 02 (13 visuals)

Entities used: DW_Properties, DW_Listings, DW_Tenant, DW_Deals, DW_Turns, DW_WO, DW_Renewals, DW_Leases, 0_Month, PM_BOM, SEL_LeaseType

- **240f49e8** | card | "Active Listings" | pos(691,100,205,121) | Values: DW_Listings.`0_Listing Count (Card)` | filters: DW_Listings.LISTING_STATUS='Active', IS_PUBLISHED='Y', + occupancy/tenant
- **47670e22** | pivotTable | "Property Summary" | pos(300,238,833,379) | Cols: DW_Properties.OCCUPANCY_STATUS_SUMMARY; Rows: ORGANIZATION_NAME, REGION_NAME, SUBDIVISION, FLOORPLAN, FULL_ADDRESS; Values: DW_Properties.`0_Count`
- **3476773086** | card | "Holding Fees" | pos(650,928,170,120) | Values: 0_Month.`01_HF_Monthly` | filters: DW_Deals.`HF Date` last 4 months, CURRENT_DEAL_STATUS
- **6af92fc9** | slicer | "Subdivision" | pos(0,234,270,77) | DW_Properties.SUBDIVISION (syncGroup SUBDIVISION)
- **293439b0** | pivotTable | "Tenant Demo" | pos(295,1994,1152,334) | Rows: DW_Properties.ORGANIZATION_NAME,REGION_NAME,SUBDIVISION,FULL_ADDRESS; Values: DW_Properties.`0_Count_Raw`, DW_Tenant.`0_MTM`, Sum(BEDROOMS/BATHROOMS/SQUARE_FOOTAGE/YEAR_BUILT/UNDER_WRITTEN_RENT), Sum(DW_Tenant.CURRENT_RENT), `0_Rent Var`, `0_Rent / Sqft`, Sum(OCCUPANTS), `0_Dem_% Pets`, Sum(TENANT_AGE), Sum(AVERAGE_CREDIT_SCORE), Sum(COMBINED_INCOME), `0_Days_In_Home` | filter: OCCUPANCY_STATUS IN ('Tenant Leased','Trustee Leased') + 25 more
- **311dcc14** | gauge | "Internal Maintenance" | pos(1787,699,210,158) | Y: 0_Month.`04_Interal Maintenance`; target: 0_Month.`04_IM_Goal` | filters: DW_WO.IS_INTERNAL_VENDOR='Y', COMPANY_NAME NOT IN (credit card/GE/builder-warranty vendors), PM_BOM run-rate
- **53035cc9** | card | "Total Properties" | pos(300,100,190,120) | Values: DW_Properties.`0_Count`
- **401c5a42** | gauge | "Net Turn Cost (All)" | pos(1358,699,210,159) | Y: 0_Month.`04_Net Turn Cost`; axis target 1750 min 1000 max 3000 | filters: DW_Turns excludes turn IDs 20373/18896/21897, TURN_COMPLETED_BOM
- **4a02bf1e** | slicer | "MONTH" | pos(13,698,255,159) | 0_Month.BEG_OF_MONTH | last 4 months; pinned 2026-05-01
- **5fe32299** | gauge | "Renewal" | pos(716,699,210,159) | Y: 0_Month.`0_Renewal %`; target 0.75 | filters: SEL_LeaseType.`Lease Type`='Tenant Leased', DW_Renewals.`0_Renewal Chart %`
- **5e3d5d54** | slicer | "Address Search" | pos(1,463,270,121) | DW_Properties.FULL_ADDRESS (selfFilter)
- **7398cc37** | slicer | "Tenant Delinquent Status" | pos(0,1961,271,88) | DW_Properties.`1_Tenant Balance Status`
- **2f5036dd** | card | "vs. UW Rent" | pos(494,1861,191,120) | Values: DW_Properties.`0_Rent Var` | filters: DW_Deals/Listings deal-status, SEL_LeaseType NOT null
