import { PurchaseAdvanceList } from "@/components/finance/purchase-advance-list";
import { requirePermission } from "@/lib/erp/auth";
import { listPurchaseAdvances } from "@/lib/erp/ap-advance";
import { purchaseAdvanceAbilities } from "@/lib/erp/ap-advance-workflow";

export const dynamic = "force-dynamic";

/** The Uang Muka Pembelian register (P126). */
export default async function Page() {
  const actor = await requirePermission("PURCHASE_ADVANCE_VIEW", "/finance/advance/purchase");
  const rows = await listPurchaseAdvances();
  // What was paid is kept on each bill (P132).
  const paid = Object.fromEntries(rows.map((r) => [r.id, r.paid]));
  return <PurchaseAdvanceList rows={rows} paid={paid} can={purchaseAdvanceAbilities(actor.permissions)} />;
}
