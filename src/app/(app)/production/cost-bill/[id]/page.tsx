import { notFound } from "next/navigation";
import { CostBillForm } from "@/components/production/cost-bill-form";
import { CostBillPaymentsCard } from "@/components/production/cost-bill-payments";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { costBillPayments } from "@/lib/erp/cash-payment";
import { costBillOptions, getCostBill } from "@/lib/erp/production-cost-bill";
import { COST_BILL_PATH, costBillAbilities } from "@/lib/erp/production-cost-bill-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_COST_BILL_VIEW", COST_BILL_PATH);
  const bill = await getCostBill(Number(id));
  if (!bill) notFound();
  return (
    <>
      <CostBillForm mode="view" bill={bill} options={await costBillOptions()} can={costBillAbilities(actor.permissions)} />
      {bill.isPayable && <CostBillPaymentsCard payments={await costBillPayments(bill.id)} />}
      <RecordHistoryCard entityKey="prd_cost_bill" rowId={bill.id} />
    </>
  );
}
