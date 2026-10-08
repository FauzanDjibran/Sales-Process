import { notFound, redirect } from "next/navigation";
import { CostBillForm } from "@/components/production/cost-bill-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { costBillOptions, getCostBill } from "@/lib/erp/production-cost-bill";
import { COST_BILL_PATH, costBillAbilities, costBillIsEditable } from "@/lib/erp/production-cost-bill-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_COST_BILL_EDIT", `${COST_BILL_PATH}/${id}/edit`);
  const bill = await getCostBill(Number(id));
  if (!bill) notFound();
  if (!costBillIsEditable(bill.status)) redirect(`${COST_BILL_PATH}/${bill.id}`);
  return (
    <>
      <CostBillForm mode="edit" bill={bill} options={await costBillOptions()} can={costBillAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="prd_cost_bill" rowId={bill.id} />
    </>
  );
}
