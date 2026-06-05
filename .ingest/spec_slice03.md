# Summary page — visual spec, slice 03 (10 visuals)

Entities: 0_Month, DW_Properties, DW_Tenant, DW_Listings, DW_Deals, DW_Renewals, DW_Tenant_Charges

- **1ca6c57c** | card | (month title banner) | pos(302,862,516,74) | Values: 0_Month.Title (Min)
- **26dd71e5** | card | "Proj / Actual MIs" | pos(825,927,170,120) | Values: 0_Month.`01_MI_Combined` | filters: DW_Tenant.EXCLUDE_FILTER=0, deal-status, 0_MoveIns
- **25911a48** | card | "Turnover Rate" (hdr off) | pos(1347,924,170,122) | Values: 0_Month.`0_Turnover %` | SOURCE DEFECT (cosmetic labels block brace imbalance; bindings grepped)
- **100c623a** | pivotTable | (monthly KPI trend) | pos(306,1263,1667,344) | Rows: 0_Month.BEG_OF_MONTH (Year+Month); Values (all 0_Month): 0_All Homes, 0_Avg_Rent, 0_Occ_BOM %, 01_Forecasted_Net_Occupancy, 0_Occ_EOM %, 02_HF_PullThru, 01_Lease %, 04_EOM Collections, 04_Renewal, 0_Turnover %, 0_Renewal_Actual, 04_Renewal_Rent_Growth, 0_Release Growth, 0_Blended Spread %, 04_90+ Spend, 04_Net Turn Cost | ~34 visual filters
- **33d72bc8** | slicer | "Pod / Region" | pos(0,154,270,83) | DW_Properties.POD, REGION_NAME
- **0b9f72ed** | card | "Occupancy %" | pos(496,100,188,121) | Values: DW_Properties.`0_Current_Occupancy` | filter: 0_Month.BEG_OF_MONTH last-2-months
- **154275eb** | textbox | DECORATIVE ("KPIs" 20pt) | pos(301,637,769,53)
- **219fd905** | card | "Net Occupancy Gain" | pos(1174,925,169,120) | Values: 0_Month.`01_Forecasted_Net_Occupancy` | filters: DW_Renewals.`1_Lease Type`='Tenant Leased', deal-status
- **04692ca2** | slicer | "Organization/Venture/Portfolio" hierarchy (hdr off) | pos(0,78,270,79) | DW_Properties.ORGANIZATION_NAME, VENTURE_NO, PORTFOLIO_NAME | filter: ORGANIZATION_NAME NOT null
- **2213ff0b** | slicer | "PM / APM Assigned" | pos(0,387,271,76) | DW_Properties.PROPERTY_MANAGER, PROPERTY_MANAGER_ASSISTANT

NOTE: source defect confirmed in 25911a48 (and earlier gauge e66d515...) — some cosmetic blocks in the .pbip export have brace imbalances; query/filter bindings unaffected.
