# Summary page — visual spec, slice 00 (13 visuals)

Entities: DW_Properties, DW_Listings, DW_Deals, DW_Tenant_Charges, DW_Tenant_Receipts, LTO, 0_Month, 0_Days, SEL_Collections_Type, SEL_LeaseType

- **faeceafe** | card | "Total Tenants" | pos(296,1861,189,120) | Values: DW_Properties.`0_Count` | filters: OCCUPANCY_STATUS IN ('Trustee Leased','Tenant Leased'), deal-status
- **e66d5154** | gauge | "EOM Collections" | pos(502,699,210,160) | Y: 0_Month.`04_EOM Collections` | filters: DW_Tenant_Charges.ACCOUNT_NUMBER='4010', CREDITTYPEID≠2, DW_Tenant_Receipts.CREDITTYPEID≠2, SEL_Collections_Type.Value='Net (x-Concessions)', 0_Days.Max Day=1
- **d8ca2b73** | lineChart | "Days Occupied" | pos(298,1621,535,171) | Cat: 0_Month.BEG_OF_MONTH; Series: DW_Properties.ORGANIZATION_NAME; Y: 0_Month.`0_Days Occ` | filter: last 6 months, ORG='RP SFR'
- **f4f4ec57** | pivotTable | "DRC LTO" | pos(834,1621,787,361) | Rows: DW_Properties.SUBDIVISION, LTO.TYPE, LTO.ENTITYID; Values: LTO.`0_Address`,`0_FP`,`0_NLS`, Sum(SQUARE_FOOTAGE), Sum(C_AMOUNT)"Current Rent", Sum(N_AMOUNT)"New Rent", LTO.`0_RG` | filter: ORG='RB DRC'
- **f3e109a4** | azureMap | (Property Map) | pos(1138,238,849,374) | Cat: DW_Properties.FULL_ADDRESS | filters: OCCUPANCY_STATUS NOT IN ('Dispositions'), address exclude-list | INVALID mirror (large nested Exclude; bindings grepped)
- **ea091650** | textbox | DECORATIVE "Portfolio Summary" | pos(300,10,784,68)
- **ffbf78c0** | slicer | "Lease Type" | pos(0,1852,269,90) | DW_Properties.OCCUPANCY_STATUS | =('Tenant Leased','Trustee Leased')
- **b8174f52** | textbox | DECORATIVE "Tenant Leased Demographics" | pos(295,1793,538,67)
- **9832e692** | card | "BOM Listings" | pos(299,929,170,120) | Values: 0_Month.`01_On Market List` | filter: last 4 months, deal/listing-status
- **88901a59** | textbox | DECORATIVE "All Property Export" | pos(291,2328,769,52)
- **9d63c703** | textbox | DECORATIVE "Property Map" | pos(1138,182,647,51)
- **8674ef79** | slicer | "Tenant Balance" | pos(0,2071,271,163) | DW_Properties.`1_Tenant Balance` | filter: DW_Tenant_Charges.`1_Balance Age Category` NOT null
- **78f9ba54** | gauge | "EOM Occupancy" | pos(289,699,210,160) | Y: 0_Month.`0_Occ_EOM %` | filters: 0_Days.Max Day=1
