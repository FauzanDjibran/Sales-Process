import { notFound, redirect } from "next/navigation";
import { TransferForm } from "@/components/production/transfer-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { TRANSFER_WORKFLOW, prodDocIsEditable } from "@/lib/erp/production-doc-workflow";
import { transferCurrent, transferOptions, getTransfer } from "@/lib/erp/production-transfer";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_TRANSFER_EDIT", `${TRANSFER_WORKFLOW.path}/${id}/edit`);
  const transfer = await getTransfer(Number(id));
  if (!transfer) notFound();
  if (!prodDocIsEditable(transfer.status)) redirect(`${TRANSFER_WORKFLOW.path}/${transfer.id}`);
  return (
    <>
      <TransferForm mode="edit" transfer={transfer} options={await transferOptions(transferCurrent(transfer))} can={TRANSFER_WORKFLOW.abilities(actor.permissions)} />
      <RecordHistoryCard entityKey="prd_transfer" rowId={transfer.id} />
    </>
  );
}
