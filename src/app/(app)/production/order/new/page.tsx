import { ProductionOrderForm } from "@/components/production/production-order-form";
import { requirePermission } from "@/lib/erp/auth";
import { productionOrderOptions } from "@/lib/erp/production-order";
import { productionOrderAbilities } from "@/lib/erp/production-order-workflow";

export const dynamic = "force-dynamic";

/** A new Perintah Produksi (Walet step 3); `?planLine=` starts it from a Rencana Produksi's line (P168). */
export default async function Page({ searchParams }: { searchParams: Promise<{ planLine?: string }> }) {
  const actor = await requirePermission("PRODUCTION_ORDER_CREATE", "/production/order/new");
  const planLine = Number((await searchParams).planLine) || null;
  const options = await productionOrderOptions(planLine ? { planLineId: planLine, targetItemId: 0, routingId: null, workstationIds: [], bomIds: [], itemIds: [] } : null);
  return <ProductionOrderForm mode="new" order={null} options={options} sent={{}} can={productionOrderAbilities(actor.permissions)} fromPlanLine={planLine} />;
}
