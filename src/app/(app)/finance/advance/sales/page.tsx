import { AdvanceList } from "@/components/finance/advance-list";
import { requirePermission } from "@/lib/erp/auth";
import { listSalesAdvances } from "@/lib/erp/sales-advance";
import { arDocumentPositions } from "@/lib/erp/ar-item";
import { salesAdvanceAbilities } from "@/lib/erp/sales-advance-workflow";

export const dynamic = "force-dynamic";

/** The Uang Muka Penjualan register (P54). */
export default async function Page() {
  const actor = await requirePermission("SALES_ADVANCE_VIEW", "/finance/advance/sales");
  const rows = await listSalesAdvances();
  // What was paid is the bill's Tagihan item in the AR book (P87–P88), read
  // here beside the bills.
  const positions = await arDocumentPositions("AdvanceRequest", "sal_advance", rows.map((r) => r.id));
  const paid = Object.fromEntries([...positions].map(([id, p]) => [id, p.paid]));
  return <AdvanceList rows={rows} paid={paid} can={salesAdvanceAbilities(actor.permissions)} />;
}
