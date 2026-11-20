import { CashTransferList } from "@/components/finance/cash-transfer-list";
import { requirePermission } from "@/lib/erp/auth";
import { listCashTransfers } from "@/lib/erp/cash-transfer";
import { CASH_TRANSFER_PATH, cashTransferAbilities } from "@/lib/erp/cash-transfer-workflow";

export const dynamic = "force-dynamic";

/** The Transfer Kas & Bank register (P299). */
export default async function Page() {
  const actor = await requirePermission("CASH_TRANSFER_VIEW", CASH_TRANSFER_PATH);
  return <CashTransferList rows={await listCashTransfers()} can={cashTransferAbilities(actor.permissions)} />;
}
