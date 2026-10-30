import { notFound, redirect } from "next/navigation";
import { StockIssueForm } from "@/components/inventory/stock-issue-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getStockIssue, stockIssueCurrent, stockIssueOptions } from "@/lib/erp/stock-issue";
import { stockIssueAbilities, stockIssueIsEditable } from "@/lib/erp/stock-issue-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("STOCK_ISSUE_EDIT", `/inventory/stock-issue/${id}/edit`);
  const issue = await getStockIssue(Number(id));
  if (!issue) notFound();
  if (!stockIssueIsEditable(issue.status)) redirect(`/inventory/stock-issue/${issue.id}`);
  const options = await stockIssueOptions(stockIssueCurrent(issue));
  return (
    <>
      <StockIssueForm mode="edit" issue={issue} options={options} can={stockIssueAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="log_stock_issue" rowId={issue.id} />
    </>
  );
}
