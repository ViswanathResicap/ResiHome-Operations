import { getSummaryCache } from "@/lib/cache";
import { SummaryView } from "@/components/SummaryView";

export default function SummaryPage() {
  const d = getSummaryCache();
  return <SummaryView data={d} />;
}
