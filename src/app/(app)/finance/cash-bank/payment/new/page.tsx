import { CashPaymentForm } from "@/components/finance/cash-payment-form";
import { requirePermission } from "@/lib/erp/auth";
import { cashPaymentOptions } from "@/lib/erp/cash-payment";
import { cashPaymentAbilities } from "@/lib/erp/cash-bank-tx-workflow";

export const dynamic = "force-dynamic";

/** A new Pengeluaran: Tujuan, then Partner, then the bills it pays (P127). */
export default async function Page() {
  const actor = await requirePermission("CASH_PAYMENT_CREATE", "/finance/cash-bank/payment/new");
  return (
    <CashPaymentForm
      mode="new"
      payment={null}
      options={await cashPaymentOptions()}
      can={cashPaymentAbilities(actor.permissions)}
    />
  );
}
