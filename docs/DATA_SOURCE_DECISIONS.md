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

### `SP_PPW` → **still open**
- Property/work-order CSV (`PPW.csv`), columns incl. `PPW #`, Property Address/State/City,
  Work Order Status, Work Type Name, Company Name, Daily Due/Invoice Date. Has a calculated
  `1_Property_key` linking to `DW_Properties` by Address + State.
- **Options:** (a) same admin-managed pattern as Engrain if it's relatively static / manually
  maintained; (b) keep a SharePoint pull via app registration if it's frequently updated by
  others. **Need owner input** on how `PPW.csv` is maintained today.

## Google Sheets dependencies (the `GS_` tables)
`GS_RentCast`, `GS_RateCards`, `GS_CodeViolations` are **published-to-web CSVs** (public
`docs.google.com/.../pub?output=csv` URLs). The app can fetch these directly on the hourly
cache schedule — no auth, no change needed. (Could later migrate to the same admin-managed
pattern if desired.)
