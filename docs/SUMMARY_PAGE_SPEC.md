# Summary page — replication spec (Phase 1, first scope)

Source: Power BI report page `ReportSectioneec532c7225390830bcc` ("Summary"), the active/first
page. Canvas **2000 × 2680**, `FitToWidth`. Mirrored visual JSON lives under
`powerbi-source/ResiHome Summary.Report/definition/pages/ReportSectioneec532c7225390830bcc/`.
Per-visual binding detail in `.ingest/spec_slice00..03.md`.

## Page-level filters (apply to every visual)
- `DW_Properties.OCCUPANCY_STATUS` **NOT IN** ('Dispositions')
- `DW_Properties.ORGANIZATION_NAME` **NOT** null

## Layout overview (49 visuals)
Coordinates are (x, y, w, h) on the 2000×2680 canvas. Left rail x≈0–270 = slicers. A vertical
divider line sits at x≈268. Content columns start at x≈290.

### Left rail — slicers (filters that drive the whole page)
| guid | control | field(s) |
|---|---|---|
| 04692ca2 | Org/Venture/Portfolio hierarchy | DW_Properties.ORGANIZATION_NAME, VENTURE_NO, PORTFOLIO_NAME |
| f90c1a4a / 33d72bc8 | Pod / Region | DW_Properties.POD, REGION_NAME |
| e5660a30 | Property Status | DW_Properties.OCCUPANCY_STATUS_SUMMARY |
| 2213ff0b | PM / APM Assigned | DW_Properties.PROPERTY_MANAGER, PROPERTY_MANAGER_ASSISTANT |
| 5e3d5d54 | Address Search | DW_Properties.FULL_ADDRESS (self-filter) |
| d80bef13 | Transfer Date | DW_Properties.Transfer_Date |
| 6af92fc9 | Subdivision | DW_Properties.SUBDIVISION |
| ffbf78c0 | Lease Type | DW_Properties.OCCUPANCY_STATUS (=Tenant/Trustee Leased) |
| 7398cc37 | Tenant Delinquent Status | DW_Properties.`1_Tenant Balance Status` |
| 8674ef79 | Tenant Balance | DW_Properties.`1_Tenant Balance` |
| 4a02bf1e | MONTH | 0_Month.BEG_OF_MONTH (last 4 months; pinned 2026-05-01) |
| a5e798e7 | (image) ResiHome logo | decorative |
| 751a3c30 | (line) divider | decorative |

### KPI cards — top row (y≈100) and mid band (y≈861–929, y≈1861)
| guid | title | measure |
|---|---|---|
| 53035cc9 | Total Properties | DW_Properties.`0_Count` |
| 0b9f72ed | Occupancy % | DW_Properties.`0_Current_Occupancy` |
| 240f49e8 | Active Listings | DW_Listings.`0_Listing Count (Card)` |
| 1ca6c57c | (month banner) | 0_Month.Title |
| 9832e692 | BOM Listings | 0_Month.`01_On Market List` |
| ce12839c | BOM Vacant | 0_Month.`0_Vacant #` |
| 3476773086 | Holding Fees | 0_Month.`01_HF_Monthly` |
| 26dd71e5 | Proj / Actual MIs | 0_Month.`01_MI_Combined` |
| 993f2138 | Proj / Actual MOs | 0_Month.`01_MoveOut_Forecast` |
| 219fd905 | Net Occupancy Gain | 0_Month.`01_Forecasted_Net_Occupancy` |
| faeceafe | Total Tenants | DW_Properties.`0_Count` |
| 2f5036dd | vs. UW Rent | DW_Properties.`0_Rent Var` |

### Gauges — KPI gauge bank (y≈699)
| guid | title | value measure | target/axis |
|---|---|---|---|
| 78f9ba54 | EOM Occupancy | 0_Month.`0_Occ_EOM %` | — |
| e66d5154 | EOM Collections | 0_Month.`04_EOM Collections` | target 95.5% (min .90 max .97) |
| 5fe32299 | Renewal | 0_Month.`0_Renewal %` | target .75 |
| 8eff3ad6 | BOM Listings Leased | 0_Month.`01_Lease_Listings %` | — |
| cdda90ae | WO Cycle Time | 0_Month.`04_Cycle Time` | — |
| 311dcc14 | Internal Maintenance | 0_Month.`04_Interal Maintenance` | target 0_Month.`04_IM_Goal` |
| 823264e0 | 90+ Run Rate Spend | 0_Month.`04_90+ Spend` | — |
| 401c5a42 | Net Turn Cost (All) | 0_Month.`04_Net Turn Cost` | target 1750 (min 1000 max 3000) |

### Pivots / tables / chart / map (main content area)
| guid | type | title | grain → measures |
|---|---|---|---|
| 47670e22 | pivotTable | Property Summary | rows Org/Region/Subdiv/Floorplan/Address × col OCCUPANCY_STATUS_SUMMARY → DW_Properties.`0_Count` |
| 7a29264b | pivotTable | Portfolio performance (by Org/Region/Subdiv/Floorplan) | 17 monthly KPI measures (see below) |
| 100c623a | pivotTable | Monthly KPI trend (by month) | 16 monthly KPI measures |
| 293439b0 | pivotTable | Tenant Demo | rows Org/Region/Subdiv/Address → property + tenant demographics (beds/baths/sqft/rent/credit/income/age/pets/MTM/days-in-home) |
| f4f4ec57 | pivotTable | DRC LTO | rows Subdiv/Type/EntityID → LTO address/FP/NLS/sqft/current+new rent/rent-growth (ORG='RB DRC') |
| be0a7449 | pivotTable | DRC Conversion | rows Subdiv×Month → leads/applied/HF/apps:leads/appr% (ORG≠'RP SFR') |
| d8ca2b73 | lineChart | Days Occupied | Cat month × Series Org → 0_Month.`0_Days Occ` (last 6mo, ORG='RP SFR') |
| f3e109a4 | azureMap | Property Map | DW_Properties.FULL_ADDRESS |
| 7b1e31e0 | tableEx | In Process | 26 DW_Properties columns; filter DW_Turns.`1_Turn Status` in-progress |

### Decorative (no data): textboxes ea091650 "Portfolio Summary", b8174f52 "Tenant Leased Demographics", 88901a59 "All Property Export", 9d63c703 "Property Map", 154275eb "KPIs"; image a5e798e7; line 751a3c30.

## Tables the Summary page depends on
**Snowflake (`DW_`):** DW_Properties (primary), DW_Listings, DW_Deals, DW_Tenant, DW_Tenant_Charges,
DW_Tenant_Receipts, DW_Renewals, DW_Turns, DW_WO, DW_Leases, LTO.
**Measure-holder (`0_`):** 0_Month (the monthly KPI measure table — central), 0_Days.
**Selection (`SEL_`):** SEL_Collections_Type, SEL_LeaseType.
**PM:** PM_BOM.
_No GS_/SP_ tables are used on the Summary page — it's Snowflake + in-model measures only._ ✅ (good news for Phase 1: the first page needs only Snowflake access.)

## Measures to reproduce as SQL/app logic (the real work)
Nearly all KPIs are DAX measures on **`0_Month`** (and a few on DW_* tables). The exact DAX comes from
the SemanticModel mirror (see `docs/SOURCE_MAP.md` once generated). Key measures to port:
`0_Count`, `0_Current_Occupancy`, `0_Rent Var`, `0_Listing Count (Card)`;
`0_Month`: `0_Occ_BOM %`, `0_Occ_EOM %`, `01_Lease %`, `01_Lease_Listings %`, `04_EOM Collections`,
`0_Renewal %`, `04_Renewal`, `0_Renewal_Actual`, `0_Turnover %`, `04_Cycle Time`,
`04_Interal Maintenance`/`04_IM_Goal`, `04_90+ Spend`, `04_Net Turn Cost`, `0_Days Occ`,
`01_On Market List`, `0_Vacant #`, `01_HF_Monthly`, `01_MI_Combined`, `01_MoveOut_Forecast`,
`01_Forecasted_Net_Occupancy`, `0_All Homes`, `0_Avg_Rent`, `02_HF_PullThru`, `0_Release Growth`,
`0_Blended Spread %`, `04_Renewal_Rent_Growth`, `02_Leads`, `02_Leads_Applied`, `03_Apps:Leads`,
`03_Appr:Apps`.

## Mirror status
40 of 49 visual.json mirrored byte-valid. 9 had inline-decode corruption and/or genuine source
defects (cosmetic blocks); their **bindings are fully captured above / in the slice files**, files
omitted from the mirror rather than committed invalid: f3e109a4, 8eff3ad6, ce12839c, cdda90ae,
25911a48, 2f5036dd, 311dcc14, 4a02bf1e, 53035cc9. (Re-fetchable later if byte-exact copies are needed.)
