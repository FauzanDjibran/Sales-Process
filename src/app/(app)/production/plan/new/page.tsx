import { ProductionPlanForm } from "@/components/production/production-plan-form";
import { requirePermission } from "@/lib/erp/auth";
import { productionPlanOptions } from "@/lib/erp/production-plan";
import { productionPlanAbilities } from "@/lib/erp/production-plan-workflow";

export const dynamic = "force-dynamic";

/** A new Rencana Produksi (P168). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_PLAN_CREATE", "/production/plan/new");
  return <ProductionPlanForm mode="new" plan={null} options={await productionPlanOptions()} released={{}} orders={[]} materials={[]} can={productionPlanAbilities(actor.permissions)} />;
}
