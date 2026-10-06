import { notFound, redirect } from "next/navigation";
import { PurchaseOrderForm } from "@/components/purchasing/purchase-order-form";
import { PurchaseOrderReceipts } from "@/components/purchasing/purchase-order-receipts";
import { purchaseOrderReceipts } from "@/lib/erp/receipt-note";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getPurchaseOrder, purchaseOrderOptions } from "@/lib/erp/purchase-order";
import { PURCHASE_ORDER_KINDS, purchaseOrderAbilities, purchaseOrderKindOf, type PurchaseOrderKind } from "@/lib/erp/purchase-order-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const k = PURCHASE_ORDER_KINDS[kind as PurchaseOrderKind];
  if (!k) notFound();
  const actor = await requirePermission("PURCHASE_ORDER_VIEW", k.path);
  const order = await getPurchaseOrder(Number(id));
  if (!order) notFound();
  // One table, two menus: a link that reached the other kind's page is sent on.
  const own = purchaseOrderKindOf(order.header.item_type);
  if (own !== kind) redirect(`${PURCHASE_ORDER_KINDS[own].path}/${order.id}`);
  const [options, receipts] = await Promise.all([
    purchaseOrderOptions(order.header.item_type, order.lines.flatMap((l) => l.request_line_ids)),
    purchaseOrderReceipts(order.id),
  ]);
  return (
    <>
      <PurchaseOrderForm kind={own} mode="view" order={order} options={options} can={purchaseOrderAbilities(actor.permissions)} />
      <PurchaseOrderReceipts receipts={receipts} />
      <RecordHistoryCard entityKey="pur_order" rowId={order.id} />
    </>
  );
}
