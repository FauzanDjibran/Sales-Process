import { notFound, redirect } from "next/navigation";
import { PurchaseRequestForm } from "@/components/purchasing/purchase-request-form";
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
  const options = await purchaseRequestOptions(request.header.item_type, request.lines.map((l) => Number(l.item_id)));
  return (
    <>
      <PurchaseRequestForm kind={own} mode="view" request={request} options={options} can={purchaseRequestAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="pur_request" rowId={request.id} />
    </>
  );
}
