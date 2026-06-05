# Summary page — visual spec, slice 01 (13 visuals)

Entities: DW_Properties, 0_Month, DW_Turns, DW_Listings, DW_Deals, DW_Renewals, DW_WO, PM_BOM

- **e5660a30** | slicer | "Property Status" | pos(0,310,271,77) | DW_Properties.OCCUPANCY_STATUS_SUMMARY
- **d80bef13** | slicer | "Transfer Date" | pos(3,598,269,85) | DW_Properties.Transfer_Date
- **be0a7449** | pivotTable | "DRC Conversion" | pos(1621,1621,364,361) | Rows: DW_Properties.SUBDIVISION, 0_Month.BEG_OF_MONTH; Values(0_Month): 02_Leads"L", 02_Leads_Applied"A", 01_HF_Monthly"HF", 03_Apps:Leads"A:L", 03_Appr:Apps"Appr %" | filter: ORG≠'RP SFR', last 4mo
- **8eff3ad6** | gauge | "BOM Listings Leased" | pos(930,700,210,160) | Y: 0_Month.`01_Lease_Listings %`; tooltips: 01_On Market List, 01_MoveIn Monthly | filter: ORG='RP SFR' | INVALID mirror (bindings grepped)
- **993f2138** | card | "Proj / Actual MOs" | pos(998,926,170,120) | Values: 0_Month.`01_MoveOut_Forecast` | filters: deal-status, DW_Renewals.0_Renewal Count
- **f90c1a4a** | slicer | "Pod / Region" | pos(0,155,270,78) | DW_Properties.POD, REGION_NAME
- **ce12839c** | card | "BOM Vacant" | pos(474,929,171,120) | Values: 0_Month.`0_Vacant #` | filter: last 4mo, deal/listing-status | INVALID mirror (bindings grepped)
- **cdda90ae** | gauge | "WO Cycle Time" | pos(1144,699,210,161) | Y: 0_Month.`04_Cycle Time` | filters: DW_WO.COMPANY_NAME NOT IN (ResiPro Construction/Restoration/Turns, Self-Solve, ResiBuilt Warranty), INSURANCE_CLAIM≠'Y' | INVALID mirror (bindings grepped)
- **a5e798e7** | image | DECORATIVE (Resihome logo png) | pos(0,8,270,61)
- **7b1e31e0** | tableEx | "In Process" | pos(290,2385,1679,284) | 26 cols all DW_Properties.*: ENTITYID, HBPM_PROPERTY_ID, ASSETID, HUBSPOT_RECORD_ID, RENTLY_SERIAL_NUMBER, RENTLY_DEVICE_TYPE, REGION_NAME, FULL_ADDRESS, BEDROOMS, BATHROOMS, SQUARE_FOOTAGE, SUBDIVISION, FLOORPLAN, COUNTY_NAME, PROPERTY_MANAGER, PROPERTY_MANAGER_ASSISTANT, OCCUPANCY_STATUS, RRQCPASSDATE, TENANT_STATUS, TEN_FULL_NAME, `1_All Tenant Emails`, EVICTION_STATUS, LISTINGDATE, LEASE_FROM_DATE, LEASE_TO_DATE, CURRENT_RENT | filter: DW_Turns.`1_Turn Status` NOT IN (null,'Turn Completed','Off Market'), N_LEASE_FROM_DATE=null
- **823264e0** | gauge | "90+ Run Rate Spend" | pos(1572,699,210,159) | Y: 0_Month.`04_90+ Spend` | filters: PM_BOM.`0_Run Rate (90+ Spend)`, ORG='RP SFR'
- **7a29264b** | pivotTable | (portfolio performance, by org/region/subdiv/floorplan) | pos(306,1056,1667,199) | Rows: DW_Properties.ORGANIZATION_NAME,REGION_NAME,SUBDIVISION,FLOORPLAN; Values(0_Month, 17): 0_All Homes, 0_Avg_Rent, 0_Occ_BOM %, 01_Forecasted_Net_Occupancy, 0_Occ_EOM %, 0_Occ_EOM_2, 02_HF_PullThru, 01_Lease %, 04_EOM Collections, 04_Renewal, 0_Turnover %, 0_Renewal_Actual, 04_Renewal_Rent_Growth, 0_Release Growth, 0_Blended Spread %, 04_90+ Spend, 04_Net Turn Cost
- **751a3c30** | shape(line) | DECORATIVE (vertical divider) | pos(268,8,29,2660)
