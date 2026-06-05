# ResiHome Operations Dashboard

Web replication of the company's **"ResiHome Summary"** Power BI report, served as a
web app the team can access at a URL. This repo is the standalone home for that app
(eventually a 2FA landing page the dashboard embeds into).

## Project phases

1. **Phase 1 — Faithful 1:1 replication** of the existing Power BI (data + every visual). _← current_
2. **Phase 2 — Clean up & optimize** the data sources / structure.
3. **Phase 3 — Redesign** the dashboard with web-native features.

## Data sources

The Power BI model pulls from three places (the table-name prefix tells you which):

| Prefix | Source | Access | Notes |
|---|---|---|---|
| `DW_` | **Snowflake** `PROD_ANALYTICS` (BI views / star schema) | ✅ have access | The bulk of the model. Business logic lives in dbt. |
| `GS_` | **Google Sheets** (published-to-web CSV) | ✅ public URLs | e.g. `GS_RentCast`, `GS_RateCards`, `GS_CodeViolations`. No auth needed. |
| `SP_` | **SharePoint** (`residentialcapital.sharepoint.com/sites/Hayden-Workspace`) | ⚠️ needs auth | e.g. `SP_PPW`, `SP_Engrain`. CSVs in Shared Documents. |

Other prefixes (`SEL_`, `0_`, `PM_`, `QC_`, `LTO`) are selection/helper, measure-holder,
or derived tables defined inside the model — see `docs/SOURCE_MAP.md`.

## Repo layout

```
powerbi-source/        The Power BI project (.pbip / TMDL+PBIR text files) — source of truth for replication
  ResiHome Summary.SemanticModel/   tables, measures (DAX), relationships, M source defs
  ResiHome Summary.Report/          pages & visuals (Summary page first)
docs/                  Analysis & handoff docs (SOURCE_MAP, page specs, replication handoff)
.ingest/               Drive file-ID maps used to mirror the .pbip from Google Drive (internal)
```

## Architecture (planned)

Standalone **Next.js** app + a Snowflake connector (`snowflake-sdk`) with an **hourly cache**
layer (scheduled queries → cached results; pages serve cached data, mirroring Power BI's
scheduled refresh — fast pages, low warehouse cost). The **Summary page** is the first build,
then we iterate page-by-page.

_Status: Phase 1 — ingesting & mapping the Power BI model. See `docs/`._
