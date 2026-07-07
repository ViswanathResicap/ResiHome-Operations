import { TabPage } from "@/components/TabPage";

export const dynamic = "force-dynamic";

export default function Page() {
  return <TabPage title="Renewals / Move-Outs" endpoint="/api/renewals" />;
}
