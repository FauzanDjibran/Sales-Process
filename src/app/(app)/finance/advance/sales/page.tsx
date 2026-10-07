import { AdvanceList } from "@/components/finance/advance-list";
import { requirePermission } from "@/lib/erp/auth";
import { listSalesAdvances } from "@/lib/erp/ar-advance";
import { salesAdvanceAbilities } from "@/lib/erp/ar-advance-workflow";

export const dynamic = "force-dynamic";

/** The Uang Muka Penjualan register (P54). */
export default async function Page() {
  const actor = await requirePermission("SALES_ADVANCE_VIEW", "/finance/advance/sales");
  const rows = await listSalesAdvances();
  // What was paid is kept on each bill (P132).
  const paid = Object.fromEntries(rows.map((r) => [r.id, r.paid]));
  return <AdvanceList rows={rows} paid={paid} can={salesAdvanceAbilities(actor.permissions)} />;
}
