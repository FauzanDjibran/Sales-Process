import { AdvanceForm } from "@/components/finance/advance-form";
import { requirePermission } from "@/lib/erp/auth";
import { salesAdvanceOptions } from "@/lib/erp/sales-advance";
import { salesAdvanceAbilities } from "@/lib/erp/sales-advance-workflow";

export const dynamic = "force-dynamic";

/** A new advance bill, drawn from a confirmed Customer Order (P54). */
export default async function Page() {
  const actor = await requirePermission("SALES_ADVANCE_CREATE", "/finance/advance/sales/new");
  return (
    <AdvanceForm
      mode="new"
      advance={null}
      options={await salesAdvanceOptions()}
      can={salesAdvanceAbilities(actor.permissions)}
    />
  );
}
