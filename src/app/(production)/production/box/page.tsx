import { BoxList } from "@/components/production/box-list";
import { requirePermission } from "@/lib/erp/auth";
import { unitIdsOf } from "@/lib/erp/production-access";
import { listBoxes } from "@/lib/erp/production-box";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("PRODUCTION_BOX_VIEW", "/production/box");
  return <BoxList rows={await listBoxes(await unitIdsOf(actor))} />;
}
