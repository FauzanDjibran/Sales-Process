import { CashReceiptList } from "@/components/finance/cash-receipt-list";
import { requirePermission } from "@/lib/erp/auth";
import { listCashReceipts } from "@/lib/erp/cash-bank-tx";
import { cashReceiptAbilities } from "@/lib/erp/cash-bank-tx-workflow";

export const dynamic = "force-dynamic";

/** The Penerimaan Kas & Bank register (P66). */
export default async function Page() {
  const actor = await requirePermission("CASH_RECEIPT_VIEW", "/finance/cash-bank/receipt");
  return <CashReceiptList rows={await listCashReceipts()} can={cashReceiptAbilities(actor.permissions)} />;
}
