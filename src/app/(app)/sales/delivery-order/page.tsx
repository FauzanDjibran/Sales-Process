import { DeliveryOrderList } from "@/components/sales/delivery-order-list";
import { requirePermission } from "@/lib/erp/auth";
import { listDeliveryOrders } from "@/lib/erp/delivery-order";
import { deliveryOrderAbilities } from "@/lib/erp/delivery-order-workflow";

export const dynamic = "force-dynamic";

/** The Delivery Order register (P93). */
export default async function Page() {
  const actor = await requirePermission("DELIVERY_ORDER_VIEW", "/sales/delivery-order");
  return <DeliveryOrderList orders={await listDeliveryOrders()} can={deliveryOrderAbilities(actor.permissions)} />;
}
