import { notFound } from "next/navigation";
import { PurchaseRequestList } from "@/components/purchasing/purchase-request-list";
import { requirePermission } from "@/lib/erp/auth";
import { listPurchaseRequests } from "@/lib/erp/purchase-request";
import { PURCHASE_REQUEST_KINDS, purchaseRequestAbilities, type PurchaseRequestKind } from "@/lib/erp/purchase-request-workflow";

export const dynamic = "force-dynamic";

/** The Purchase Request register of one kind — Barang or Jasa (P123). */
export default async function Page({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const k = PURCHASE_REQUEST_KINDS[kind as PurchaseRequestKind];
  if (!k) notFound();
  const actor = await requirePermission("PURCHASE_REQUEST_VIEW", k.path);
  return <PurchaseRequestList kind={kind as PurchaseRequestKind} rows={await listPurchaseRequests(k.itemType)} can={purchaseRequestAbilities(actor.permissions)} />;
}
