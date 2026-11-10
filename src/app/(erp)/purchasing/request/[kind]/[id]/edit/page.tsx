import { notFound, redirect } from "next/navigation";
import { PurchaseRequestForm } from "@/components/purchasing/purchase-request-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getPurchaseRequest, purchaseRequestOptions } from "@/lib/erp/purchase-request";
import {
  PURCHASE_REQUEST_KINDS,
  kindOfItemType,
  purchaseRequestAbilities,
  purchaseRequestIsEditable,
  type PurchaseRequestKind,
} from "@/lib/erp/purchase-request-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const k = PURCHASE_REQUEST_KINDS[kind as PurchaseRequestKind];
  if (!k) notFound();
  const actor = await requirePermission("PURCHASE_REQUEST_EDIT", `${k.path}/${id}/edit`);
  const request = await getPurchaseRequest(Number(id));
  if (!request) notFound();
  const own = kindOfItemType(request.header.item_type);
  if (own !== kind || !purchaseRequestIsEditable(request.status)) redirect(`${PURCHASE_REQUEST_KINDS[own].path}/${request.id}`);
  const options = await purchaseRequestOptions(request.header.item_type, request.lines.map((l) => Number(l.item_id)));
  return (
    <>
      <PurchaseRequestForm kind={own} mode="edit" request={request} options={options} can={purchaseRequestAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="pur_request" rowId={request.id} />
    </>
  );
}
