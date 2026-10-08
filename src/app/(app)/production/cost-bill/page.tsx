import { CostBillList } from "@/components/production/cost-bill-list";
import { requirePermission } from "@/lib/erp/auth";
import { listCostBills } from "@/lib/erp/production-cost-bill";
import { COST_BILL_PATH, costBillAbilities } from "@/lib/erp/production-cost-bill-workflow";

export const dynamic = "force-dynamic";

/** The Tagihan Biaya Produksi register (P150 M68). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_COST_BILL_VIEW", COST_BILL_PATH);
  return <CostBillList rows={await listCostBills()} can={costBillAbilities(actor.permissions)} />;
}
