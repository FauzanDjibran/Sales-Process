import { AdvanceList } from "@/components/finance/advance-list";
import { requirePermission } from "@/lib/erp/auth";
import { listSalesAdvances } from "@/lib/erp/ar-advance";
import { settledByDocuments } from "@/lib/erp/cash-bank-tx";
import { salesAdvanceAbilities } from "@/lib/erp/ar-advance-workflow";

export const dynamic = "force-dynamic";

/** The Uang Muka Penjualan register (P54). */
export default async function Page() {
  const actor = await requirePermission("SALES_ADVANCE_VIEW", "/finance/advance/sales");
  const rows = await listSalesAdvances();
  // What was paid is the receipt module's record (P66), read here beside the bills.
  const paid = Object.fromEntries(await settledByDocuments("fin_ar_advance", rows.map((r) => r.id)));
  return <AdvanceList rows={rows} paid={paid} can={salesAdvanceAbilities(actor.permissions)} />;
}
