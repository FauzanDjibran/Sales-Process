import { notFound, redirect } from "next/navigation";
import { ProductionPlanForm } from "@/components/production/production-plan-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getProductionPlan, productionPlanCurrent, productionPlanOptions } from "@/lib/erp/production-plan";
import { productionPlanAbilities, productionPlanIsEditable } from "@/lib/erp/production-plan-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_PLAN_EDIT", `/production/plan/${id}/edit`);
  const plan = await getProductionPlan(Number(id));
  if (!plan) notFound();
  if (!productionPlanIsEditable(plan.status)) redirect(`/production/plan/${plan.id}`);
  return (
    <>
      <ProductionPlanForm mode="edit" plan={plan} options={await productionPlanOptions(productionPlanCurrent(plan), plan.id)} released={{}} orders={[]} materials={[]} can={productionPlanAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="prd_plan" rowId={plan.id} />
    </>
  );
}
