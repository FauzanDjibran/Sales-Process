import { SalesReturnList } from "@/components/sales/sales-return-list";
import { requirePermission } from "@/lib/erp/auth";
import { listSalesReturns } from "@/lib/erp/sales-return";
import { salesReturnAbilities } from "@/lib/erp/sales-return-workflow";

export const dynamic = "force-dynamic";

/** The Sales Return register (P287). */
export default async function Page() {
  const actor = await requirePermission("SALES_RETURN_VIEW", "/sales/return");
  return <SalesReturnList rows={await listSalesReturns()} can={salesReturnAbilities(actor.permissions)} />;
}
