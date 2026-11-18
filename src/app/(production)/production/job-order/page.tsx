import { JobOrderList } from "@/components/production/job-order-list";
import { requirePermission } from "@/lib/erp/auth";
import { unitIdsOf } from "@/lib/erp/production-access";
import { listJobOrders } from "@/lib/erp/production-job-order";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("PRODUCTION_JOB_ORDER_VIEW", "/production/job-order");
  return <JobOrderList rows={await listJobOrders(await unitIdsOf(actor))} />;
}
