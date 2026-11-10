import { CashPaymentList } from "@/components/finance/cash-payment-list";
import { cashBookSummary } from "@/lib/erp/cash-bank";
import { requirePermission } from "@/lib/erp/auth";
import { parseRegisterQuery } from "@/lib/erp/register-query";
import { listCashPayments } from "@/lib/erp/cash-payment";
import { cashPaymentAbilities } from "@/lib/erp/cash-bank-tx-workflow";

export const dynamic = "force-dynamic";

/** The Pengeluaran Kas & Bank register (P127). */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePermission("CASH_PAYMENT_VIEW", "/finance/cash-bank/payment");
  const query = parseRegisterQuery(await searchParams, ["Draft", "Posted", "Cancelled"]);
  const [paged, cash] = await Promise.all([listCashPayments(query), cashBookSummary()]);
  return <CashPaymentList paged={paged} cash={cash} can={cashPaymentAbilities(actor.permissions)} />;
}
