import { notFound, redirect } from "next/navigation";
import { PurchaseOrderForm } from "@/components/purchasing/purchase-order-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getPurchaseOrder, purchaseOrderOptions } from "@/lib/erp/purchase-order";
import {
  PURCHASE_ORDER_KINDS,
  purchaseOrderAbilities,
  purchaseOrderIsEditable,
  purchaseOrderKindOf,
  type PurchaseOrderKind,
} from "@/lib/erp/purchase-order-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const k = PURCHASE_ORDER_KINDS[kind as PurchaseOrderKind];
  if (!k) notFound();
  const actor = await requirePermission("PURCHASE_ORDER_EDIT", `${k.path}/${id}/edit`);
  const order = await getPurchaseOrder(Number(id));
  if (!order) notFound();
  const own = purchaseOrderKindOf(order.header.item_type);
  if (own !== kind || !purchaseOrderIsEditable(order.status)) redirect(`${PURCHASE_ORDER_KINDS[own].path}/${order.id}`);
  const options = await purchaseOrderOptions(order.header.item_type, order.lines.flatMap((l) => l.request_line_ids));
  return (
    <>
      <PurchaseOrderForm kind={own} mode="edit" order={order} options={options} can={purchaseOrderAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="pur_order" rowId={order.id} />
    </>
  );
}
