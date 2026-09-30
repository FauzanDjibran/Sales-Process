import { CashReceiptForm } from "@/components/finance/cash-receipt-form";
import { requirePermission } from "@/lib/erp/auth";
import { cashReceiptOptions } from "@/lib/erp/cash-bank-tx";
import { cashReceiptAbilities } from "@/lib/erp/cash-bank-tx-workflow";

export const dynamic = "force-dynamic";

/** A new Penerimaan: Tujuan, then Partner, then the bills it pays (P67). */
export default async function Page() {
  const actor = await requirePermission("CASH_RECEIPT_CREATE", "/finance/cash-bank/receipt/new");
  return (
    <CashReceiptForm
      mode="new"
      receipt={null}
      options={await cashReceiptOptions()}
      can={cashReceiptAbilities(actor.permissions)}
    />
  );
}
