# ResiHome Operations — Handoff

Transfer notes for merging this app into the org repo / the new ops page. This is
the human-facing overview; `/.claude/rules/Summary.md` has the deep reference for
the flagship Summary tab.

## What this is
A Next.js web app that reproduces the **"ResiHome Summary" Power BI report** and the
operational tabs, backed by **live Snowflake** with **committed snapshots** so default
views load instantly (and work even without DB credentials).

- **Stack:** Next.js 15 (App Router), React 19, TypeScript, `snowflake-sdk`, Leaflet
  (maps), `jose` + `bcryptjs` (auth), `tsx` (scripts).
- **Tabs:** Summary (flagship, pixel-faithful fixed-canvas), Off-Market, On Market,
  Future Move-In, Collections, Renewals / Move-Outs, Turnkey, Maintenance, DRC.

## Run locally
```bash
npm install
# create .env.local with the env vars below
npm run dev            # http://localhost:3020  (see package.json script/port)
```
Log in with a user from `APP_USERS` (see Auth).

## Environment variables
Set these in `.env.local` locally and in the host (Vercel → Settings → Env Vars) for
Production **and** Preview. **`.env.local` is gitignored and NOT in the transfer zip —
provision secrets separately.**

| Var | Purpose |
|---|---|
| `SNOWFLAKE_ACCOUNT` | Snowflake account |
| `SNOWFLAKE_USERNAME` | user |
| `SNOWFLAKE_PASSWORD` | password (or use the `SNOWFLAKE_PRIVATE_KEY*` keypair vars) |
| `SNOWFLAKE_WAREHOUSE` | warehouse |
| `SNOWFLAKE_ROLE` | role (currently `RESICAP_ANALYST`) |
| `APP_USERS` | base64 JSON of `[{u, bcrypt-hash}]` — the login user list |

Generate `APP_USERS`: `node scripts/make-users.mjs "user=password" ...` and paste the
printed base64 line.

## Architecture / data flow
- **Auth:** `middleware.ts` gates all routes → redirects to `/login`, 401s API;
  excludes `/login`, `/api/auth/*`, static. Session cookie `resihome_session`
  (jose JWT, 8h) in `lib/auth.ts`. Users come from `APP_USERS`.
- **Pages:** `app/<tab>/page.tsx` are server components (mostly `force-dynamic`) that
  render client views in `components/`. Summary = `app/page.tsx` → `SummaryView`.
- **Data layer:**
  - `lib/snowflake.ts` — connection.
  - `lib/generated/sql.ts` — the heavy, exact "native" mirror queries (`DW_*`,
    `PM_BOM`, …). **Never edit** — they reproduce the Power BI model.
  - `lib/datasets.ts` — `source(name)` projects only needed columns from those
    queries as a subquery. Wraps as `FROM (\n <sql> \n)` (the newline is required —
    it terminates trailing `--comments`; a bare `(${SQL})` breaks with "unexpected EOF").
  - `lib/pbi-sources.ts` — `PM_BOM_SQL` (slim) + `PM_LISTINGS_BOM_SQL`.
  - API routes in `app/api/<tab>/route.ts` run the queries and return JSON.
- **Snapshots (key pattern):** `data/snapshots/*.json` are committed precomputed
  default-view payloads. Routes serve the snapshot instantly for the default
  (no-filter) view and only hit live Snowflake for filtered/other-month/`?fresh=1`
  requests. This is why the deployed app shows real data even with no DB env, and why
  it doesn't hit Vercel's 60s function limit on the default view.
  - Regenerate: `npx tsx scripts/precompute.ts` (targets the last complete month).
  - `.github/workflows/refresh.yml` runs it daily (needs the 5 `SNOWFLAKE_*` secrets
    in the repo's Actions secrets).
- `data/all-property-export.json` — a bundled Power BI CSV export (~8,516 rows) that
  backs the Summary "All Property Export" table (fields the live query can't source).

## Deployment
- Vercel project builds from the connected repo/branch. Set the env vars above.
- If sharing a preview externally, note **Deployment Protection** (Vercel Auth) will
  block non-team viewers — turn it off for the project or add the viewer to the team.
- The app's own login (`APP_USERS`) is the access gate regardless.

## Status (as of handoff)
**Matching Power BI (Summary, validated):** top KPI cards; Property Summary region
table (incl. Inspection column); Property Map; gauge labels/scales/targets; Portfolio
Metrics cards; All Property Export (from the CSV); Tenant cards.

**Open / blocked** (tracked in the Snowflake data ticket):
- `VW_MASTER_MM_WORKORDER` won't compile (`ambiguous column 'COUNTY_COUNT'`) → blocks
  90+ Run Rate Spend.
- Full `PM_BOM` (with `Days Occ`, `Owned Days`, `1_Move-Out`, `1_Occ_Status (DW)`) not
  available → blocks Days Occupied and the exact EOM Occupancy.
- ASM underwriting views broken/missing (`GOODDATA_MASTER_DATASETS` schema absent).
- DRC Conversion (leads funnel), Tenant Demographics extra columns, By-Org / By-Month
  measure tables — pending CSV export or the blocked measures.

## Merging into the org repo / new ops page
- Recommended: bring this in via a **PR** (preserves history) rather than a zip drop.
- To minimize conflicts, mount the BI as a **self-contained section/route** inside the
  ops app rather than merging two apps file-by-file — most overlap is routing, layout,
  auth, and global CSS.
- On the org side, set the env vars + the daily-refresh Actions secrets, and commit the
  `data/snapshots/*` + `data/all-property-export.json` so default views work immediately.
