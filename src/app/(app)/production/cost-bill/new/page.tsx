import { CostBillForm } from "@/components/production/cost-bill-form";
import { requirePermission } from "@/lib/erp/auth";
import { costBillOptions } from "@/lib/erp/production-cost-bill";
import { COST_BILL_PATH, costBillAbilities } from "@/lib/erp/production-cost-bill-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("PRODUCTION_COST_BILL_CREATE", `${COST_BILL_PATH}/new`);
  return <CostBillForm mode="new" bill={null} options={await costBillOptions()} can={costBillAbilities(actor.permissions)} />;
}
