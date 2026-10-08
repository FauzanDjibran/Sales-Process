import { PermitRequestForm } from "@/components/sales/permit-request-form";
import { requirePermission } from "@/lib/erp/auth";
import { permitRequestOptions } from "@/lib/erp/permit-request";
import { permitRequestAbilities } from "@/lib/erp/permit-request-workflow";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("PERMIT_REQUEST_CREATE", "/sales/permit/new");
  return (
    <PermitRequestForm mode="new" request={null} options={await permitRequestOptions()} can={permitRequestAbilities(actor.permissions)} />
  );
}
