import { getSummaryCache } from "@/lib/cache";
import { SummaryView } from "@/components/SummaryView";

export default function SummaryPage() {
  // Instant committed snapshot; SummaryView fetches fresh data client-side.
  const d = getSummaryCache();
  return <SummaryView initialData={d} />;
}
