import { notFound } from "next/navigation";
import { ProductionPlanForm } from "@/components/production/production-plan-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { ordersOfPlanLines, planMaterials, releasedByPlanLines } from "@/lib/erp/production-order";
import { getProductionPlan, productionPlanCurrent, productionPlanOptions } from "@/lib/erp/production-plan";
import { productionPlanAbilities } from "@/lib/erp/production-plan-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_PLAN_VIEW", "/production/plan");
  const plan = await getProductionPlan(Number(id));
  if (!plan) notFound();
  // What was released from each line, and the material the plan asks of the BoMs — composed here:
  // the Perintah depends on the plan, never the reverse (§3.1).
  const [options, released, orders, materials] = await Promise.all([
    productionPlanOptions(productionPlanCurrent(plan), plan.id),
    releasedByPlanLines(plan.lineIds),
    ordersOfPlanLines(plan.lineIds),
    planMaterials(plan.lines.map((l) => ({ itemId: Number(l.item_id), qty: Number(l.qty) }))),
  ]);
  return (
    <>
      <ProductionPlanForm mode="view" plan={plan} options={options} released={Object.fromEntries(released)} orders={orders} materials={materials} can={productionPlanAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="prd_plan" rowId={plan.id} />
    </>
  );
}
