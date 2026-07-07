import { getOffMarket } from "@/lib/offmarket";
import { OffMarketView } from "@/components/OffMarketView";

export const dynamic = "force-dynamic";

export default async function OffMarketPage() {
  const d = await getOffMarket();
  return <OffMarketView initialData={d} />;
}
