import { SummaryView } from "@/components/SummaryView";

// The Summary view fetches the rich /api/summary-v2 payload client-side
// (server-filtered by month/org/region), so no server data prop is needed.
export const dynamic = "force-dynamic";

export default function SummaryPage() {
  return <SummaryView />;
}
