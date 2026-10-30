import { TransferForm } from "@/components/production/transfer-form";
import { requirePermission } from "@/lib/erp/auth";
import { TRANSFER_WORKFLOW } from "@/lib/erp/production-doc-workflow";
import { transferOptions } from "@/lib/erp/production-transfer";

export const dynamic = "force-dynamic";

/** A new Production Transfer (R7). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_TRANSFER_CREATE", `${TRANSFER_WORKFLOW.path}/new`);
  return <TransferForm mode="new" transfer={null} options={await transferOptions()} can={TRANSFER_WORKFLOW.abilities(actor.permissions)} />;
}
