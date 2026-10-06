import { PurchaseAdvanceList } from "@/components/finance/purchase-advance-list";
import { requirePermission } from "@/lib/erp/auth";
import { listPurchaseAdvances } from "@/lib/erp/ap-advance";
import { settledByDocuments } from "@/lib/erp/cash-bank-tx";
import { purchaseAdvanceAbilities } from "@/lib/erp/ap-advance-workflow";

export const dynamic = "force-dynamic";

/** The Uang Muka Pembelian register (P126). */
export default async function Page() {
  const actor = await requirePermission("PURCHASE_ADVANCE_VIEW", "/finance/advance/purchase");
  const rows = await listPurchaseAdvances();
  // What was paid is the receipt module's record (P66), read here beside the bills.
  const paid = Object.fromEntries(await settledByDocuments("fin_ap_advance", rows.map((r) => r.id)));
  return <PurchaseAdvanceList rows={rows} paid={paid} can={purchaseAdvanceAbilities(actor.permissions)} />;
}
