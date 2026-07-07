import { OnMarketView } from "@/components/OnMarketView";

// On Market fetches /api/onmarket client-side (server-filtered by org/region).
export const dynamic = "force-dynamic";

export default function OnMarketPage() {
  return <OnMarketView />;
}
