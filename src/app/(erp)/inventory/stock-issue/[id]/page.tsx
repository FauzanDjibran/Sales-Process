import { notFound } from "next/navigation";
import { StockIssueForm } from "@/components/inventory/stock-issue-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getStockIssue, stockIssueCurrent, stockIssueOptions } from "@/lib/erp/stock-issue";
import { stockIssueAbilities } from "@/lib/erp/stock-issue-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("STOCK_ISSUE_VIEW", "/inventory/stock-issue");
  const issue = await getStockIssue(Number(id));
  if (!issue) notFound();
  // The journal Posting would write is not read here: the Posting dialog asks
  // for it as a dry run when it opens (P103).
  const options = await stockIssueOptions(stockIssueCurrent(issue));
  return (
    <>
      <StockIssueForm mode="view" issue={issue} options={options} can={stockIssueAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="log_stock_issue" rowId={issue.id} />
    </>
  );
}
