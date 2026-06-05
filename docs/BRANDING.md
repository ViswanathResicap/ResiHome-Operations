# ResiHome branding (applied to the dashboard)

Derived from ResiHome's official logo (the wordmark embedded in the Power BI report and the
current `RESIHOME-TM` asset). Applied via the brand-guidelines method: brand color tokens +
heading/body typeface + logo.

## Logo
- `public/resihome-logo.png` — primary lockup: house mark + **RESI** (black) + **HOME** (pink).
  Used top-left in the slicer rail.
- `public/resihome-wordmark.png` — transparent-background wordmark (alternate use).

## Colors (CSS tokens in `app/globals.css`)
| Token | Hex | Use |
|---|---|---|
| `--brand` | `#ff005b` | ResiHome pink — primary accent (logo "HOME", headings, KPI top-rule, table headers, section titles, page rule) |
| `--brand-dark` | `#cc0049` | hover / text-on-tint |
| `--brand-tint` | `#ffe3ee` | table header fill |
| `--brand-tint-2` | `#fff0f6` | row hover / banner |
| `--ink` | `#15171a` | primary text (logo "RESI") |
| `--muted` | `#6b7280` | secondary text |
| `--good` / `--bad` | `#138a52` / `#b00020` | positive / negative KPI values |

(Palette read directly from the logo: dominant `#ff005b`/`#ff0060`, tints `#ff629b`, `#ffa5c3`,
on black/white.)

## Typography
- **Raleway** (brand typeface — confirmed by ResiHome brand asset naming) loaded via `next/font`
  (self-hosted, weights 400/600/700/800), exposed as `--font-raleway`.
- Headings 700–800; body 400; system-ui fallback.

## Applied to
KPI cards (pink top rule), monthly gauges (value color), Property Summary + Monthly Trend tables
(pink headers, hover tint), section titles, page header rule, and the slicer rail (logo + accent).
