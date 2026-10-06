import { CashPaymentList } from "@/components/finance/cash-payment-list";
import { requirePermission } from "@/lib/erp/auth";
import { listCashPayments } from "@/lib/erp/cash-payment";
import { cashPaymentAbilities } from "@/lib/erp/cash-bank-tx-workflow";

export const dynamic = "force-dynamic";

/** The Pengeluaran Kas & Bank register (P127). */
export default async function Page() {
  const actor = await requirePermission("CASH_PAYMENT_VIEW", "/finance/cash-bank/payment");
  return <CashPaymentList rows={await listCashPayments()} can={cashPaymentAbilities(actor.permissions)} />;
}
