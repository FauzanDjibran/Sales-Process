import { notFound } from "next/navigation";
import { SalesReturnForm } from "@/components/sales/sales-return-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { deliveryNoteBilling } from "@/lib/erp/ar-invoice";
import { getSalesReturn, salesReturnOptions } from "@/lib/erp/sales-return";
import { salesReturnAbilities } from "@/lib/erp/sales-return-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("SALES_RETURN_VIEW", "/sales/return");
  const ret = await getSalesReturn(Number(id));
  if (!ret) notFound();
  const options = await salesReturnOptions(Number(ret.header.customer_order_id), ret.id);
  const billing = await deliveryNoteBilling(ret.lines.map((l) => Number(l.delivery_note_line_id)));
  return (
    <>
      <SalesReturnForm mode="view" ret={ret} options={options} billing={billing} can={salesReturnAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="sal_return" rowId={ret.id} />
    </>
  );
}
