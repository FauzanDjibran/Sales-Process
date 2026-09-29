import { notFound, redirect } from "next/navigation";
import { AdvanceForm } from "@/components/finance/advance-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getSalesAdvance, salesAdvanceOptions } from "@/lib/erp/sales-advance";
import { advanceIsEditable, salesAdvanceAbilities } from "@/lib/erp/sales-advance-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("SALES_ADVANCE_EDIT", `/finance/advance/sales/${id}/edit`);
  const advance = await getSalesAdvance(Number(id));
  if (!advance) notFound();
  if (!advanceIsEditable(advance.status)) redirect(`/finance/advance/sales/${advance.id}`);
  const options = await salesAdvanceOptions({ id: advance.id, orderId: Number(advance.input.order_id) });
  return (
    <>
      <AdvanceForm mode="edit" advance={advance} options={options} can={salesAdvanceAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="sal_advance" rowId={advance.id} />
    </>
  );
}
