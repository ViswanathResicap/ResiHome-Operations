# Data source decisions

Living record of where each non-Snowflake source lands in the web app. (Snowflake `DW_`
tables are queried directly — see `SOURCE_MAP.md` once generated.)

## SharePoint dependencies (the two `SP_` tables)

The Power BI model pulls two CSVs from SharePoint
(`residentialcapital.sharepoint.com/sites/Hayden-Workspace`), which would otherwise require
app-level SharePoint auth (service account / app registration). Plan to retire that need:

### `SP_Engrain` → **app-managed admin table** ✅ decided (2026-06-05)
- **What it is:** unit → Engrain interactive-map lookup. 3,428 rows, 28 communities
  (one `Map ID` per community), 29 asset-id prefixes.
- **Columns:** `Unit ID` (int), `Asset ID` (text, e.g. `RBFL0006-0001`), `Map ID` (int,
  Engrain map id), `Community` (text).
- **Decision:** Do **not** pull from SharePoint. Bake the dataset into the app as a managed
  reference table, **editable directly via an admin-only settings page** in the web app.
  Removes one of the two SharePoint dependencies.
- **Seed data:** `data/seed/engrain_unit_map.csv` (the current export, committed).
- **Implementation note (for app phase):** load seed into the app's datastore on first run;
  expose an admin-only CRUD UI (add/edit/delete rows, plus CSV re-upload to bulk-replace).
  Gate behind the same auth as the eventual 2FA landing page; non-admins read-only.

## Out of scope — external scrape (decided 2026-06-05)
These three sources are being collected **via a separate external scraping process** and are
**not part of this app's data layer**. They are intentionally excluded from the refresh job, the
cache schema, and the page builds. (None of them feed the Summary page.)
- **`SP_PPW`** (SharePoint `PPW.csv`)
- **`GS_CodeViolations`** (SharePoint `CodePermit.csv` — despite the `GS_` prefix)
- **`QC_ResiAims`** (SharePoint)

Their `.tmdl` definitions remain in the `powerbi-source/` mirror for fidelity, but nothing in
the app references them.

## Google Sheets dependencies (the `GS_` tables we DO use)
`GS_RentCast`, `GS_RateCards`, `SEL_Transcard` are **published-to-web CSVs** (public
`docs.google.com/.../pub?output=csv` URLs). The app can fetch these directly on the hourly
cache schedule — no auth, no change needed.
