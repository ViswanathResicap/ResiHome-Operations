import { getSummary } from "@/lib/summary";
import { SummaryView } from "@/components/SummaryView";

// Render with the live data already in hand (warm cache = instant) so the
// breakdowns and slicers are fully functional on first paint — no waiting for
// a client fetch. Cold starts fall back to the committed snapshot and warm in
// the background; the client then pulls the live rows.
export const dynamic = "force-dynamic";

export default async function SummaryPage() {
  const d = await getSummary();
  return <SummaryView initialData={d} />;
}
