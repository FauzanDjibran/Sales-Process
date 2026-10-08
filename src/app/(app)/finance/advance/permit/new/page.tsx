import { AdvanceForm } from "@/components/finance/advance-form";
import { requirePermission } from "@/lib/erp/auth";
import { permitAdvanceOptions } from "@/lib/erp/permit-advance";
import { permitAdvanceAbilities } from "@/lib/erp/ar-advance-workflow";

export const dynamic = "force-dynamic";

/** A new Uang Muka Perizinan, drawn from an approved Pengajuan (P137). */
export default async function Page() {
  const actor = await requirePermission("PERMIT_ADVANCE_CREATE", "/finance/advance/permit/new");
  return (
    <AdvanceForm
      mode="new"
      advance={null}
      options={await permitAdvanceOptions()}
      can={permitAdvanceAbilities(actor.permissions)}
      variant="permit"
    />
  );
}
