import { notFound, redirect } from "next/navigation";
import { CashPaymentForm } from "@/components/finance/cash-payment-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { cashPaymentOptions, getCashPayment } from "@/lib/erp/cash-payment";
import { cashBankTxIsEditable, cashPaymentAbilities } from "@/lib/erp/cash-bank-tx-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("CASH_PAYMENT_EDIT", `/finance/cash-bank/payment/${id}/edit`);
  const payment = await getCashPayment(Number(id));
  if (!payment) notFound();
  if (!cashBankTxIsEditable(payment.status)) redirect(`/finance/cash-bank/payment/${payment.id}`);
  const options = await cashPaymentOptions({ id: payment.id, docs: payment.lines.map((l) => ({ kind: l.kind, id: l.docId })) });
  return (
    <>
      <CashPaymentForm mode="edit" payment={payment} options={options} can={cashPaymentAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="fin_cash_bank_tx" rowId={payment.id} />
    </>
  );
}
