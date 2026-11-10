import { notFound, redirect } from "next/navigation";
import { PurchaseAdvanceForm } from "@/components/finance/purchase-advance-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getPurchaseAdvance, purchaseAdvanceOptions } from "@/lib/erp/ap-advance";
import { advanceIsEditable, purchaseAdvanceAbilities } from "@/lib/erp/ap-advance-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PURCHASE_ADVANCE_EDIT", `/finance/advance/purchase/${id}/edit`);
  const advance = await getPurchaseAdvance(Number(id));
  if (!advance) notFound();
  if (!advanceIsEditable(advance.status)) redirect(`/finance/advance/purchase/${advance.id}`);
  const options = await purchaseAdvanceOptions({ id: advance.id, orderId: Number(advance.input.order_id) });
  return (
    <>
      <PurchaseAdvanceForm mode="edit" advance={advance} options={options} can={purchaseAdvanceAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="fin_ap_advance" rowId={advance.id} />
    </>
  );
}
