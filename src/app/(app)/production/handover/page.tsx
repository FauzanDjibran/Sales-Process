import { HandoverList } from "@/components/production/handover-list";
import { requirePermission } from "@/lib/erp/auth";
import { listHandovers } from "@/lib/erp/production-handover";
import { handoverAbilities } from "@/lib/erp/production-handover-workflow";

export const dynamic = "force-dynamic";

/** The hand-over register (P167). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_HANDOVER_VIEW", "/production/handover");
  return <HandoverList handovers={await listHandovers()} can={handoverAbilities(actor.permissions)} />;
}
