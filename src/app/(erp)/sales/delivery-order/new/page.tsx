import { DeliveryOrderForm } from "@/components/sales/delivery-order-form";
import { requirePermission } from "@/lib/erp/auth";
import { deliveryOrderOptions } from "@/lib/erp/delivery-order";
import { deliveryOrderAbilities } from "@/lib/erp/delivery-order-workflow";

export const dynamic = "force-dynamic";

/** A new Delivery Order — with `?co=<id>`, started from that order; `?so=<id>` also ticks that Sales Order's lines. */
export default async function Page({ searchParams }: { searchParams: Promise<{ co?: string; so?: string }> }) {
  const actor = await requirePermission("DELIVERY_ORDER_CREATE", "/sales/delivery-order/new");
  const { co, so } = await searchParams;
  return (
    <DeliveryOrderForm
      mode="new"
      order={null}
      options={await deliveryOrderOptions()}
      can={deliveryOrderAbilities(actor.permissions)}
      presetCustomerOrderId={Number(co) || null}
      presetSalesOrderId={Number(so) || null}
    />
  );
}
