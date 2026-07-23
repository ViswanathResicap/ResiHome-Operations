# Summary tab — context

Web replica of the "ResiHome Summary" Power BI report: a fixed-canvas page laid
out at the report's exact pixel coordinates, backed by live Snowflake with a
committed snapshot for instant default load.

> Reflects the implementation on branch `viswanath-latest-work` (pending merge).
> Verify paths after merge; items marked **TODO** are unconfirmed.

## Entry point & data flow
- `app/page.tsx` — server component, `export const dynamic = "force-dynamic"`, renders `<SummaryView/>` (client). No server data fetch here.
- `components/SummaryView.tsx` (client) → fetches **`/api/summary-v2`** with query params, renders everything.
- `app/api/summary-v2/route.ts` — runs the Snowflake queries and returns the whole Summary payload. `maxDuration = 60`.
  - **Snapshot serving**: if the request is the default view (no filters, no search) **and** `SUMMARY_SNAPSHOT.selectedMonth === month`, returns the committed `data/snapshots/summary.json` instantly. Otherwise runs live. `?fresh=1` forces live.
  - Client caches each payload by a filter-key (`lib/client-cache.ts`) for instant re-nav.

## Key files
- `components/SummaryView.tsx` — the entire Summary page. Contains: formatters (`fnum`/`fpct`/`fmoney`/`fcnt` = blank-for-zero/`fdate`), `Tbl` (sortable, resizable, CSV-export table with sticky header + sticky footer; `wrapH` prop constrains height so the Total row stays visible inside fixed boxes), `Gauge`, `OrgMetricsTable` (expandable Org→Region→Subdivision→Floorplan), `DrcLtoTable`, `DrcConvTable`, `DaysOccupied`, and `PropertyMap` usage. Slicers are `MultiSelect`. Laid out via `PbiCanvas`/`PbiBox` at absolute PBIX coords.
- `components/PbiCanvas.tsx` — fixed-canvas engine. `PbiCanvas` scales a fixed-size canvas to fit width (ResizeObserver + CSS `transform: scale`). `PbiBox` = absolutely positioned `{x,y,w,h}`, **`overflow: hidden`**.
- `components/MultiSelect.tsx` — checkbox slicer (Select all / Clear / Search). Dropdown is **portaled to `document.body`** with `position: fixed` computed from the trigger rect, so `PbiBox` overflow can't clip it. Its popup CSS is global (not `.pbi`-scoped) because it renders outside `.pbi`.
- `components/PropertyMap.tsx` — Leaflet + Esri World Topo tiles (green terrain, no API key). No per-property lat/long exists, so it **scatters** deterministic blue bubbles per metro (count ∝ property total).
- `lib/pbi-sources.ts` — `PM_BOM_SQL` (slim: BOM/EOM occupancy status codes only) + `PM_LISTINGS_BOM_SQL`. The route imports these.
- `lib/generated/sql.ts` — heavy "native" mirror queries (`DW_PROPERTIES`, `DW_LISTINGS`, `DW_MOVEOUT`, `DW_DEALS`, `DW_TURNS`, a **fuller `PM_BOM`** with `DAYS_POST_90_MTD`, etc.). **Never edit** (exact PBI mirror).
- `lib/datasets.ts` — `source(name)` projects only needed columns from a generated query as a subquery. **Wraps as `FROM (\n <sql> \n)`** — the leading newline terminates any trailing `--comment` in the source. Registered datasets: properties, listings, pmBom, wo, turns, moveout, deals, offMarket.
- `data/snapshots/summary.json` — committed default-view payload (last complete month). Lets default views render real data **without Snowflake env**.
- `data/all-property-export.json` — bundled Power BI CSV export (~8,516 rows) that backs the **All Property Export** table (fields the live query couldn't source: Hubspot/Rently ids, PM/APM, lease dates, rent, emails, eviction). Route filters it by region + address/entity search.
- `scripts/precompute.ts` — regenerates all snapshots; targets the **last complete month** (matches the page default). Run: `npx tsx scripts/precompute.ts`.
- `.github/workflows/refresh.yml` — daily cron runs precompute; commits snapshots.
- `lib/snowflake.ts` — connection. `lib/auth.ts` + `middleware.ts` — login gate.

## External dependencies / env vars
- **Snowflake** (`snowflake-sdk`): `SNOWFLAKE_ACCOUNT`, `SNOWFLAKE_USERNAME`, `SNOWFLAKE_PASSWORD`, `SNOWFLAKE_WAREHOUSE`, `SNOWFLAKE_ROLE` (+ optional keypair: `SNOWFLAKE_PRIVATE_KEY` / `_PATH` / `_PASSPHRASE`). Role in use: `RESICAP_ANALYST`. Same 5 core vars are the GitHub Actions secrets for the daily refresh.
- **Auth**: `APP_USERS` = base64 of a JSON array `[{u, h}]` where `h` is a bcrypt hash (generate via `scripts/make-users.mjs "user=pass"`). Session cookie `resihome_session` = jose JWT, 8h (`lib/auth.ts`). `middleware.ts` redirects pages to `/login`, 401s API, excludes `/login` + `/api/auth/*` + static. **Env changes require a redeploy.**

## Conventions
- Slicers are multi-select → arrays sent as **repeated query params**: `org`, `region`, `status`, `subdivision`, `pm`, plus `q` (address/entity search) and `month`.
- **Org filter** uses an `ORG_CASE` SQL expression mapping `PUS.ORGANIZATION_KEY`→org name (e.g. `RB DRC` = keys 27,50,51,52,54,45,55,53,56,57,66); it ends in `ELSE O.ORGANIZATION_NAME`. `orgWhere = AND (ORG_CASE) IN (...)`.
- **Occupancy % card** = (Tenant Leased + Trustee Leased) / Total, summed from the region-table status buckets — not a tenant-activity ratio.
- **Default month** = last COMPLETE month (`months[1]` in SummaryView); the snapshot is precomputed for the same month so it's served instantly.
- Property Summary status buckets: Inspection=`Under Inspection`; Vacant-Off=`Vacant - Off Market`/`Onboarding`; Vacant-On=`Vacant - On Market`/`Pre-Leasing`; FMI=`Vacant - Future Move In`; Trustee=`Trustee Leased`/`Trustee Lease Honored`; Tenant=`Tenant Leased`; Turnkey=`Pending MOI/Rekey`/`Under Turnkey`. Canonical mapping in `.ingest/dw_properties.sql`.

## Pitfalls (learned the hard way)
- **Any query using `${orgWhere}` MUST join `DIM_OWNER_ORGANIZATION O`** (ORG_CASE ends in `O.ORGANIZATION_NAME`). Missing it → `invalid identifier 'O.ORGANIZATION_NAME'` only when an org is selected.
- **Wrapping a generated query as a subquery**: use `source(name)` (adds the newline before `)`). A bare `` `(${SQL})` `` breaks on the source's trailing `--comment` → `unexpected EOF`.
- **`PbiBox` `overflow:hidden` clips popups** → dropdowns must portal to body (done in MultiSelect). Any future in-canvas popover needs the same.
- **Snapshot only serves when `selectedMonth === month`.** If the default month drifts from the snapshot's month, the default view falls through to a **slow live query** (the `DW_MOVEOUT`-based measures are heavy, ~45s) → risk of Vercel's 60s timeout. Keep `precompute.ts`'s target month == the page default, and regenerate after data-shape changes.
- `summary.json` is large (~5 MB with the all-property rows) — fine as a bundled import.

## Blocked / TODO (Snowflake objects — see the open data ticket)
- **90+ Run Rate Spend**: needs `PROD_ANALYTICS.DBT_RESICAP_STG.VW_MASTER_MM_WORKORDER` — currently **won't compile** (`ambiguous column name 'COUNTY_COUNT'`). Holds `"Ongoing Maint Post Lease + 90"`.
- **EOM Occupancy** and **Days Occupied**: need the **full `PM_BOM`** query with computed columns `Days Occ`, `Owned Days`, `1_Move-Out`, `1_Occ_Status (DW)` — not materialized anywhere; the mirror only has status codes + `DAYS_POST_90_MTD`.
- **ASM underwriting** (`VW_ASM_ACQUISITION_AM`, `VW_ASM_UNDERWRITING_PROPERTIES`): broken (real view references missing schema `GOODDATA_MASTER_DATASETS`); `BI_DATASET_VIEWS` copies don't exist.
- Gauge **values** still off pending the above (PBI vs current): EOM Occupancy 81.3% vs 78.3%, BOM Listings Leased 47.1% vs 43.9%, 90+ Spend $2,680 vs $2,310.
- **DRC Conversion** (should be a leads funnel L/A/HF/A:L from the lead tables + `DW_Deals`), **Tenant Demographics** extra columns (Yr Built, Addtl Occs, w/ Pets, Avg Age, Credit Score, Income), and the **By-Org / By-Month** measure tables — pending (CSV export or the blocked measures). TODO: confirm exact DAX when unblocked.
