import { CashReceiptList } from "@/components/finance/cash-receipt-list";
import { cashBookSummary } from "@/lib/erp/cash-bank";
import { requirePermission } from "@/lib/erp/auth";
import { parseRegisterQuery } from "@/lib/erp/register-query";
import { listCashReceipts } from "@/lib/erp/cash-bank-tx";
import { cashReceiptAbilities } from "@/lib/erp/cash-bank-tx-workflow";

export const dynamic = "force-dynamic";

/** The Penerimaan Kas & Bank register (P66). */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePermission("CASH_RECEIPT_VIEW", "/finance/cash-bank/receipt");
  const query = parseRegisterQuery(await searchParams, ["Draft", "Posted", "Cancelled"]);
  const [paged, cash] = await Promise.all([listCashReceipts(query), cashBookSummary()]);
  return <CashReceiptList paged={paged} cash={cash} can={cashReceiptAbilities(actor.permissions)} />;
}
