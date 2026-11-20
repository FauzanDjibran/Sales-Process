import { CashTransferForm } from "@/components/finance/cash-transfer-form";
import { requirePermission } from "@/lib/erp/auth";
import { cashTransferOptions } from "@/lib/erp/cash-transfer";
import { CASH_TRANSFER_PATH, cashTransferAbilities } from "@/lib/erp/cash-transfer-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("CASH_TRANSFER_CREATE", `${CASH_TRANSFER_PATH}/new`);
  return <CashTransferForm mode="new" doc={null} options={await cashTransferOptions()} can={cashTransferAbilities(actor.permissions)} />;
}
