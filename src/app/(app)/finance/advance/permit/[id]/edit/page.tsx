import { notFound, redirect } from "next/navigation";
import { AdvanceForm } from "@/components/finance/advance-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getPermitAdvance, permitAdvanceOptions } from "@/lib/erp/permit-advance";
import { advanceIsEditable, permitAdvanceAbilities } from "@/lib/erp/ar-advance-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PERMIT_ADVANCE_EDIT", `/finance/advance/permit/${id}/edit`);
  const advance = await getPermitAdvance(Number(id));
  if (!advance) notFound();
  if (!advanceIsEditable(advance.status)) redirect(`/finance/advance/permit/${advance.id}`);
  const options = await permitAdvanceOptions({ id: advance.id, orderId: Number(advance.input.order_id) });
  return (
    <>
      <AdvanceForm mode="edit" advance={advance} options={options} can={permitAdvanceAbilities(actor.permissions)} variant="permit" />
      <RecordHistoryCard entityKey="fin_ar_permit_advance" rowId={advance.id} />
    </>
  );
}
