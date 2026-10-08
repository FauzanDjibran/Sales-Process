import { PermitRequestList } from "@/components/sales/permit-request-list";
import { requirePermission } from "@/lib/erp/auth";
import { listPermitRequests } from "@/lib/erp/permit-request";
import { permitRequestAbilities } from "@/lib/erp/permit-request-workflow";

export const dynamic = "force-dynamic";

/** The Pengajuan Perizinan register (P137). */
export default async function Page() {
  const actor = await requirePermission("PERMIT_REQUEST_VIEW", "/sales/permit");
  return <PermitRequestList requests={await listPermitRequests()} can={permitRequestAbilities(actor.permissions)} />;
}
