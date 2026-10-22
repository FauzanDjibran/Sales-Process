import { ProductionOrderForm } from "@/components/production/production-order-form";
import { requirePermission } from "@/lib/erp/auth";
import { productionOrderOptions } from "@/lib/erp/production-order";
import { productionOrderAbilities } from "@/lib/erp/production-order-workflow";

export const dynamic = "force-dynamic";

/** A new Perintah Produksi (Walet step 3). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_ORDER_CREATE", "/production/order/new");
  return <ProductionOrderForm mode="new" order={null} options={await productionOrderOptions()} sent={{}} can={productionOrderAbilities(actor.permissions)} />;
}
