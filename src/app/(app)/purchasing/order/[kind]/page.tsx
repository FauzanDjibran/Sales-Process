import { notFound } from "next/navigation";
import { PurchaseOrderList } from "@/components/purchasing/purchase-order-list";
import { requirePermission } from "@/lib/erp/auth";
import { listPurchaseOrders } from "@/lib/erp/purchase-order";
import { PURCHASE_ORDER_KINDS, purchaseOrderAbilities, type PurchaseOrderKind } from "@/lib/erp/purchase-order-workflow";

export const dynamic = "force-dynamic";

/** The Purchase Order register of one kind — Barang or Jasa (P124). */
export default async function Page({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const k = PURCHASE_ORDER_KINDS[kind as PurchaseOrderKind];
  if (!k) notFound();
  const actor = await requirePermission("PURCHASE_ORDER_VIEW", k.path);
  return <PurchaseOrderList kind={kind as PurchaseOrderKind} rows={await listPurchaseOrders(k.itemType)} can={purchaseOrderAbilities(actor.permissions)} />;
}
