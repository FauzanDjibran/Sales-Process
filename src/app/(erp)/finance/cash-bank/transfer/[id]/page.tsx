import { notFound } from "next/navigation";
import { CashTransferForm } from "@/components/finance/cash-transfer-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { cashTransferOptions, getCashTransfer } from "@/lib/erp/cash-transfer";
import { CASH_TRANSFER_PATH, cashTransferAbilities } from "@/lib/erp/cash-transfer-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("CASH_TRANSFER_VIEW", CASH_TRANSFER_PATH);
  const doc = await getCashTransfer(Number(id));
  if (!doc) notFound();
  return (
    <>
      <CashTransferForm mode="view" doc={doc} options={await cashTransferOptions()} can={cashTransferAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="fin_cash_bank_transfer" rowId={doc.id} />
    </>
  );
}
