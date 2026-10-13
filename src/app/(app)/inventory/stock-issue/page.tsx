import { StockIssueList } from "@/components/inventory/stock-issue-list";
import { requirePermission } from "@/lib/erp/auth";
import { listStockIssues } from "@/lib/erp/stock-issue";
import { stockIssueAbilities } from "@/lib/erp/stock-issue-workflow";

export const dynamic = "force-dynamic";

/** The Stock Issue register (P158). */
export default async function Page() {
  const actor = await requirePermission("STOCK_ISSUE_VIEW", "/inventory/stock-issue");
  return <StockIssueList issues={await listStockIssues()} can={stockIssueAbilities(actor.permissions)} />;
}
