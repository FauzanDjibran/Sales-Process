import { notFound } from "next/navigation";
import { CashReceiptForm } from "@/components/finance/cash-receipt-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { cashReceiptOptions, getCashReceipt } from "@/lib/erp/cash-bank-tx";
import { cashReceiptAbilities } from "@/lib/erp/cash-bank-tx-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("CASH_RECEIPT_VIEW", "/finance/cash-bank/receipt");
  const receipt = await getCashReceipt(Number(id));
  if (!receipt) notFound();
  const options = await cashReceiptOptions({ id: receipt.id, docIds: receipt.lines.map((l) => l.docId) });
  return (
    <>
      <CashReceiptForm mode="view" receipt={receipt} options={options} can={cashReceiptAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="fin_cash_bank_tx" rowId={receipt.id} />
    </>
  );
}
