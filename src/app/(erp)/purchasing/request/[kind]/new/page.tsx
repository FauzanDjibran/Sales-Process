import { notFound } from "next/navigation";
import { PurchaseRequestForm } from "@/components/purchasing/purchase-request-form";
import { requirePermission } from "@/lib/erp/auth";
import { purchaseRequestOptions } from "@/lib/erp/purchase-request";
import { PURCHASE_REQUEST_KINDS, purchaseRequestAbilities, type PurchaseRequestKind } from "@/lib/erp/purchase-request-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const k = PURCHASE_REQUEST_KINDS[kind as PurchaseRequestKind];
  if (!k) notFound();
  const actor = await requirePermission("PURCHASE_REQUEST_CREATE", `${k.path}/new`);
  return (
    <PurchaseRequestForm
      kind={kind as PurchaseRequestKind}
      mode="new"
      request={null}
      options={await purchaseRequestOptions(k.itemType)}
      can={purchaseRequestAbilities(actor.permissions)}
    />
  );
}
