import { notFound } from "next/navigation";
import { AdvanceForm } from "@/components/finance/advance-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getSalesAdvance, salesAdvanceOptions } from "@/lib/erp/sales-advance";
import { salesAdvanceAbilities } from "@/lib/erp/sales-advance-workflow";
import { settlementsOfDocument } from "@/lib/erp/cash-bank-tx";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("SALES_ADVANCE_VIEW", "/finance/advance/sales");
  const advance = await getSalesAdvance(Number(id));
  if (!advance) notFound();
  const options = await salesAdvanceOptions({ id: advance.id, orderId: Number(advance.input.order_id) });
  return (
    <>
      <AdvanceForm
        mode="view"
        advance={advance}
        options={options}
        can={salesAdvanceAbilities(actor.permissions)}
        payments={await settlementsOfDocument("sal_advance", advance.id)}
      />
      <RecordHistoryCard entityKey="sal_advance" rowId={advance.id} />
    </>
  );
}
