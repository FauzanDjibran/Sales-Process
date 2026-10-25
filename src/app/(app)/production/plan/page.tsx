import { ProductionPlanList } from "@/components/production/production-plan-list";
import { requirePermission } from "@/lib/erp/auth";
import { listProductionPlans } from "@/lib/erp/production-plan";
import { productionPlanAbilities } from "@/lib/erp/production-plan-workflow";

export const dynamic = "force-dynamic";

/** The Rencana Produksi register (P168). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_PLAN_VIEW", "/production/plan");
  return <ProductionPlanList plans={await listProductionPlans()} can={productionPlanAbilities(actor.permissions)} />;
}
