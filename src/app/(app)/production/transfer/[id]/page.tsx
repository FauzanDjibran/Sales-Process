import { notFound } from "next/navigation";
import { TransferForm } from "@/components/production/transfer-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { TRANSFER_WORKFLOW } from "@/lib/erp/production-doc-workflow";
import { transferCurrent, transferOptions, getTransfer } from "@/lib/erp/production-transfer";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_TRANSFER_VIEW", TRANSFER_WORKFLOW.path);
  const transfer = await getTransfer(Number(id));
  if (!transfer) notFound();
  const options = await transferOptions(transferCurrent(transfer));
  return (
    <>
      <TransferForm mode="view" transfer={transfer} options={options} can={TRANSFER_WORKFLOW.abilities(actor.permissions)} />
      <RecordHistoryCard entityKey="prd_transfer" rowId={transfer.id} />
    </>
  );
}
