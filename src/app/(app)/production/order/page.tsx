import { ProductionOrderList } from "@/components/production/production-order-list";
import { requirePermission } from "@/lib/erp/auth";
import { listProductionOrders } from "@/lib/erp/production-order";
import { productionOrderAbilities } from "@/lib/erp/production-order-workflow";

export const dynamic = "force-dynamic";

/** The Perintah Produksi register (Walet step 3). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_ORDER_VIEW", "/production/order");
  return <ProductionOrderList orders={await listProductionOrders()} can={productionOrderAbilities(actor.permissions)} />;
}
