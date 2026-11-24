import { notFound, redirect } from "next/navigation";
import { PurchaseRequestForm } from "@/components/purchasing/purchase-request-form";
import { PurchaseRequestOrders } from "@/components/purchasing/purchase-request-orders";
import { purchaseRequestOrders } from "@/lib/erp/purchase-order";
import { PURCHASE_ORDER_KINDS } from "@/lib/erp/purchase-order-workflow";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getPurchaseRequest, purchaseRequestOptions } from "@/lib/erp/purchase-request";
import { PURCHASE_REQUEST_KINDS, kindOfItemType, purchaseRequestAbilities, type PurchaseRequestKind } from "@/lib/erp/purchase-request-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!PURCHASE_REQUEST_KINDS[kind as PurchaseRequestKind]) notFound();
  const actor = await requirePermission("PURCHASE_REQUEST_VIEW", PURCHASE_REQUEST_KINDS[kind as PurchaseRequestKind].path);
  const request = await getPurchaseRequest(Number(id));
  if (!request) notFound();
  // One table, two menus: a link that reached the other kind's page is sent on.
  const own = kindOfItemType(request.header.item_type);
  if (own !== kind) redirect(`${PURCHASE_REQUEST_KINDS[own].path}/${request.id}`);
  const [options, orders] = await Promise.all([
    purchaseRequestOptions(request.header.item_type, request.lines.map((l) => Number(l.item_id))),
    // The Purchase Order module's to read; composed here (§3.1).
    actor.permissions.has("PURCHASE_ORDER_VIEW") ? purchaseRequestOrders(request.id) : [],
  ]);
  return (
    <>
      <PurchaseRequestForm
        kind={own}
        mode="view"
        request={request}
        options={options}
        can={purchaseRequestAbilities(actor.permissions)}
        extraTabs={orders.length ? [{ key: "orders", label: "Purchase Order", icon: "clip", count: orders.length, content: <PurchaseRequestOrders basePath={PURCHASE_ORDER_KINDS[own].path} orders={orders} /> }] : []}
      />
      <RecordHistoryCard entityKey="pur_request" rowId={request.id} />
    </>
  );
}
