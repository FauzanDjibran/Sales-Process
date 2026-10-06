import { notFound } from "next/navigation";
import { PurchaseOrderForm } from "@/components/purchasing/purchase-order-form";
import { requirePermission } from "@/lib/erp/auth";
import { purchaseOrderOptions } from "@/lib/erp/purchase-order";
import { PURCHASE_ORDER_KINDS, purchaseOrderAbilities, type PurchaseOrderKind } from "@/lib/erp/purchase-order-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const k = PURCHASE_ORDER_KINDS[kind as PurchaseOrderKind];
  if (!k) notFound();
  const actor = await requirePermission("PURCHASE_ORDER_CREATE", `${k.path}/new`);
  return (
    <PurchaseOrderForm
      kind={kind as PurchaseOrderKind}
      mode="new"
      order={null}
      options={await purchaseOrderOptions(k.itemType)}
      can={purchaseOrderAbilities(actor.permissions)}
    />
  );
}
