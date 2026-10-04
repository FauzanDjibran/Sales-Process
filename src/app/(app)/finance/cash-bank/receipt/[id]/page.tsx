import { notFound } from "next/navigation";
import { CashReceiptForm } from "@/components/finance/cash-receipt-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { cashReceiptOptions, getCashReceipt } from "@/lib/erp/cash-bank-tx";
import { cashReceiptAbilities } from "@/lib/erp/cash-bank-tx-workflow";
import { taxDocsOf } from "@/lib/erp/tax-document";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("CASH_RECEIPT_VIEW", "/finance/cash-bank/receipt");
  const receipt = await getCashReceipt(Number(id));
  if (!receipt) notFound();
  const [options, taxDocs] = await Promise.all([
    cashReceiptOptions({ id: receipt.id, docs: receipt.lines.map((l) => ({ kind: l.kind, id: l.docId })) }),
    // The faktur uang muka and bukti potong its posting made — composed here (P100).
    receipt.status === "Posted" ? taxDocsOf("fin_cash_bank_tx", receipt.id) : Promise.resolve(null),
  ]);
  return (
    <>
      <CashReceiptForm mode="view" receipt={receipt} options={options} can={cashReceiptAbilities(actor.permissions)} taxDocs={taxDocs} />
      <RecordHistoryCard entityKey="fin_cash_bank_tx" rowId={receipt.id} />
    </>
  );
}
