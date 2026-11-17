import { TransferList } from "@/components/production/transfer-list";
import { requirePermission } from "@/lib/erp/auth";
import { unitIdsOf } from "@/lib/erp/production-access";
import { listTransfers } from "@/lib/erp/production-transfer";
import { TRANSFER_PATH } from "@/lib/erp/production-transfer-shape";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("PRODUCTION_TRANSFER_VIEW", TRANSFER_PATH);
  const rows = await listTransfers(await unitIdsOf(actor));
  return <TransferList rows={rows} canCreate={actor.permissions.has("PRODUCTION_TRANSFER_CREATE")} />;
}
