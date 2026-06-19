import { getSummary } from "@/lib/summary";
import { SummaryView } from "@/components/SummaryView";

export const dynamic = "force-dynamic";

export default async function SummaryPage() {
  const d = await getSummary();
  return <SummaryView initialData={d} />;
}
