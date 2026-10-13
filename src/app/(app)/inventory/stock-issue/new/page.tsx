import { StockIssueForm } from "@/components/inventory/stock-issue-form";
import { requirePermission } from "@/lib/erp/auth";
import { stockIssueOptions } from "@/lib/erp/stock-issue";
import { stockIssueAbilities } from "@/lib/erp/stock-issue-workflow";

export const dynamic = "force-dynamic";

/** A new Stock Issue (P158). */
export default async function Page() {
  const actor = await requirePermission("STOCK_ISSUE_CREATE", "/inventory/stock-issue/new");
  return <StockIssueForm mode="new" issue={null} options={await stockIssueOptions()} can={stockIssueAbilities(actor.permissions)} />;
}
