import { TabPage } from "@/components/TabPage";

export const dynamic = "force-dynamic";

export default function Page() {
  return <TabPage title="Future Move-In" endpoint="/api/futuremovein" />;
}
