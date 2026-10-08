import { notFound } from "next/navigation";
import { AdvanceForm } from "@/components/finance/advance-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getPermitAdvance, permitAdvanceOptions } from "@/lib/erp/permit-advance";
import { permitAdvanceAbilities } from "@/lib/erp/ar-advance-workflow";
import { settlementsOfDocument } from "@/lib/erp/cash-bank-tx";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PERMIT_ADVANCE_VIEW", "/finance/advance/permit");
  const advance = await getPermitAdvance(Number(id));
  if (!advance) notFound();
  const options = await permitAdvanceOptions({ id: advance.id, orderId: Number(advance.input.order_id) });
  return (
    <>
      <AdvanceForm
        mode="view"
        advance={advance}
        options={options}
        can={permitAdvanceAbilities(actor.permissions)}
        variant="permit"
        payments={await settlementsOfDocument("fin_ar_permit_advance", advance.id)}
      />
      <RecordHistoryCard entityKey="fin_ar_permit_advance" rowId={advance.id} />
    </>
  );
}
