import { PurchaseAdvanceForm } from "@/components/finance/purchase-advance-form";
import { requirePermission } from "@/lib/erp/auth";
import { purchaseAdvanceOptions } from "@/lib/erp/ap-advance";
import { purchaseAdvanceAbilities } from "@/lib/erp/ap-advance-workflow";

export const dynamic = "force-dynamic";

/** A new advance bill, drawn from a confirmed Customer Order (P126). */
export default async function Page() {
  const actor = await requirePermission("PURCHASE_ADVANCE_CREATE", "/finance/advance/purchase/new");
  return (
    <PurchaseAdvanceForm
      mode="new"
      advance={null}
      options={await purchaseAdvanceOptions()}
      can={purchaseAdvanceAbilities(actor.permissions)}
    />
  );
}
