import { AdvanceList } from "@/components/finance/advance-list";
import { requirePermission } from "@/lib/erp/auth";
import { listSalesAdvances } from "@/lib/erp/sales-advance";
import { salesAdvanceAbilities } from "@/lib/erp/sales-advance-workflow";

export const dynamic = "force-dynamic";

/** The Uang Muka Penjualan register (P54). */
export default async function Page() {
  const actor = await requirePermission("SALES_ADVANCE_VIEW", "/finance/advance/sales");
  return <AdvanceList rows={await listSalesAdvances()} can={salesAdvanceAbilities(actor.permissions)} />;
}
