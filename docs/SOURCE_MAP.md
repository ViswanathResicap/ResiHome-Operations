# Source map — ResiHome Summary semantic model

Generated from the mirrored `.pbip` SemanticModel (40 tables, 214 DAX measures). This is the
authoritative map of where every table's data comes from, for the web replication.

Connection (all Snowflake tables): account `ota12822.us-east-1`, warehouse `DEVELOPER_WH`,
database **`PROD_REPLICA`** for `Value.NativeQuery` tables (note: the report's *native queries*
read `PROD_REPLICA`, but the SQL itself joins **`PROD_ANALYTICS.DBT_RESICAP.*`** dims/facts and
`PROD_REPLICA.HBPM_DBO/HBAM_DBO/HUBSPOT/RENTLY.*` source tables). Our cached web app can run the
same native SQL or point at the curated `PROD_ANALYTICS` objects.

## By source type

### SNOWFLAKE (23 tables) — we have access
`DW_Properties, DW_Tenant, DW_Tenant_Secondary, DW_Tenant_Receipts, DW_Tenant_Monthly_Charges,
DW_Deals, DW_Leads, DW_Listings, DW_Renewals, DW_Turns, DW_WO, DW_MoveOut, DW_Occupancy,
DW_Showings, DW_Inspections, DW_Rent_Comps, DW_Off Market, PM_BOM, PM_Listings_BOM,
PM_PropStatus_ALL, 0_Days, 0_Days_Agent, SEL_Contact_Owner`
- Each carries a `Value.NativeQuery(Snowflake.Databases(...){[Name="PROD_REPLICA"]}[Data], "<SQL>")`.
- The embedded SQL is preserved verbatim in each table's `.tmdl` partition — these ARE the
  extract/transform definitions to reproduce (e.g. `PM_BOM` = DIM_PROPERTY × month-spine with
  status history; `DW_Occupancy`/`DW_Showings`/`DW_Rent_Comps`/`DW_Tenant_Monthly_Charges` carry
  large multi-CTE queries). Common org roll-up: `ORGANIZATION_KEY → {RP SFR, RB DRC, Hudson Oak,
  Rocklyn Homes, ROI Property Group, Newstar}`; common filters: `PROPERTY_STATE='Active'`,
  `Current_Flag='Y'`, portfolio/org exclusions.
- `DW_Tenant_Charges` partition is named `sentinel` (classification fell through to "inline");
  treat as Snowflake — verify its source expression in the tmdl during build.

### CALCULATED_DAX (4 tables) — derived in-model, no external source
- **`0_Month`** — the KPI engine. A calculated date spine (`CALENDAR` last ~2yr, day=1) holding
  **55 measures**: EOM Collections, Turnover %, Renewal %/Actual, Net Turn Cost, Internal
  Maintenance, occupancy (BOM/EOM), leasing funnel (MIs, HF, leads→apps), rent growth, etc.
- **`0_DRC`** — acquisition-org metrics; `SUMMARIZE(FILTER(DW_Properties, ORG IN {RB DRC, Hudson
  Oak, Rocklyn Homes, ROI Property Group, Newstar}), …)` + listing/app/LTO measures.
- **`LTO`**, **`0_Month_Exp`** — calculated helper tables.

### SHAREPOINT (4 tables) — ⚠️ need an access path for the web app
`residentialcapital.sharepoint.com/sites/Hayden-Workspace/Shared Documents/`
- **`SP_Engrain`** → `Engrain.csv` — **DECIDED: becomes admin-managed table** (seed at
  `data/seed/engrain_unit_map.csv`). No SharePoint needed.
- **`SP_PPW`** → `PPW.csv` — open question (admin-managed vs. SharePoint pull).
- **`GS_CodeViolations`** → `CodePermit.csv` (despite `GS_` prefix, it's SharePoint).
- **`QC_ResiAims`** → SharePoint file.

### GOOGLE_SHEETS (3 tables) — published CSV, public URL, no auth
- **`GS_RentCast`** → `docs.google.com/.../pub?gid=0&output=csv` (13 cols: listing/rent estimates).
- **`GS_RateCards`**, **`SEL_Transcard`** → published Google Sheet CSVs.
- App can fetch these directly on the hourly cache schedule.

### INLINE / SELECTION (5 tables) — hardcoded "enter data" lists in the model
`SEL_CR_CL, SEL_Collections_Type, SEL_DemandLetters, SEL_LeaseType, SEL_WO_CHART` — small
slicer/selection value tables defined in M (`#table`/literal). Reproduce as static app config.

## Measures
214 DAX measures across the model (full catalog: `.ingest/measures_catalog.md`). Concentrations:
`0_Month` (55), `0_DRC` (~40), `DW_Renewals` (14), `DW_Listings` (14), `0_Days_Agent` (~13),
`DW_Tenant` (10), `DW_Deals` (9), `DW_Turns` (8), `DW_Tenant_Charges` (8). These encode the
business logic the Summary page renders; reproduce as SQL/app logic against the cached datasets.

## Replication implication
The bulk of the dashboard is Snowflake (native-query datasets + DAX measures over them). Phase 1:
run the native queries (or curated `PROD_ANALYTICS` equivalents) on an hourly cache, reproduce the
`0_Month`/`0_DRC` calculated logic + measures, fetch the 3 Google Sheets directly, and replace
`SP_Engrain` with the admin-managed table. Only `SP_PPW`, `GS_CodeViolations`/`CodePermit`, and
`QC_ResiAims` still need a SharePoint decision.
