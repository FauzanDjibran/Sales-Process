import { notFound, redirect } from "next/navigation";
import { CashReceiptForm } from "@/components/finance/cash-receipt-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { cashReceiptOptions, getCashReceipt } from "@/lib/erp/cash-bank-tx";
import { cashBankTxIsEditable, cashReceiptAbilities } from "@/lib/erp/cash-bank-tx-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("CASH_RECEIPT_EDIT", `/finance/cash-bank/receipt/${id}/edit`);
  const receipt = await getCashReceipt(Number(id));
  if (!receipt) notFound();
  if (!cashBankTxIsEditable(receipt.status)) redirect(`/finance/cash-bank/receipt/${receipt.id}`);
  const options = await cashReceiptOptions({ id: receipt.id, docIds: receipt.lines.map((l) => l.docId) });
  return (
    <>
      <CashReceiptForm mode="edit" receipt={receipt} options={options} can={cashReceiptAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="fin_cash_bank_tx" rowId={receipt.id} />
    </>
  );
}
