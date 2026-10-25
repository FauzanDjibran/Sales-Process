import { HandoverForm } from "@/components/production/handover-form";
import { requirePermission } from "@/lib/erp/auth";
import { handoverOptions } from "@/lib/erp/production-handover";
import { handoverAbilities } from "@/lib/erp/production-handover-workflow";

export const dynamic = "force-dynamic";

/** A new hand-over (P167). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_HANDOVER_CREATE", "/production/handover/new");
  return <HandoverForm mode="new" handover={null} options={await handoverOptions()} can={handoverAbilities(actor.permissions)} />;
}
