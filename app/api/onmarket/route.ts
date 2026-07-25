import { NextResponse } from "next/server";
import ONMARKET from "@/data/onmarket-export.json";

// On Market is served from the committed Power BI exports (data/onmarket-export.json):
// count charts + the Active-Listings / Showings tables are computed from the exports,
// and the custom/weighted visuals (KPI cards, Leads Created, Self-Showings) are frozen
// to the report's values. The live Snowflake pipeline for this page doesn't reproduce
// the report, so we pin to the export until it's reconciled. Slicers filter client-side.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(ONMARKET);
}
