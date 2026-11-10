import { notFound } from "next/navigation";
import { PurchaseAdvanceForm } from "@/components/finance/purchase-advance-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getPurchaseAdvance, purchaseAdvanceOptions } from "@/lib/erp/ap-advance";
import { purchaseAdvanceAbilities } from "@/lib/erp/ap-advance-workflow";
import { settlementsOfDocument } from "@/lib/erp/cash-bank-tx";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PURCHASE_ADVANCE_VIEW", "/finance/advance/purchase");
  const advance = await getPurchaseAdvance(Number(id));
  if (!advance) notFound();
  const options = await purchaseAdvanceOptions({ id: advance.id, orderId: Number(advance.input.order_id) });
  return (
    <>
      <PurchaseAdvanceForm
        mode="view"
        advance={advance}
        options={options}
        can={purchaseAdvanceAbilities(actor.permissions)}
        payments={await settlementsOfDocument("fin_ap_advance", advance.id)}
      />
      <RecordHistoryCard entityKey="fin_ap_advance" rowId={advance.id} />
    </>
  );
}
