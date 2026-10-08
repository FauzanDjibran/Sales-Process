import { AdvanceList } from "@/components/finance/advance-list";
import { requirePermission } from "@/lib/erp/auth";
import { listPermitAdvances } from "@/lib/erp/permit-advance";
import { permitAdvanceAbilities } from "@/lib/erp/ar-advance-workflow";

export const dynamic = "force-dynamic";

/** The Uang Muka Perizinan register (P137). */
export default async function Page() {
  const actor = await requirePermission("PERMIT_ADVANCE_VIEW", "/finance/advance/permit");
  const rows = await listPermitAdvances();
  // What was paid is kept on each bill (P132).
  const paid = Object.fromEntries(rows.map((r) => [r.id, r.paid]));
  return <AdvanceList rows={rows} paid={paid} can={permitAdvanceAbilities(actor.permissions)} variant="permit" />;
}
