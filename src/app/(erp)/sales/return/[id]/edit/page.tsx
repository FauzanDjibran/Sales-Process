import { notFound, redirect } from "next/navigation";
import { SalesReturnForm } from "@/components/sales/sales-return-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { deliveryNoteBilling } from "@/lib/erp/ar-invoice";
import { getSalesReturn, salesReturnOptions } from "@/lib/erp/sales-return";
import { salesReturnAbilities, salesReturnIsEditable } from "@/lib/erp/sales-return-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("SALES_RETURN_EDIT", `/sales/return/${id}/edit`);
  const ret = await getSalesReturn(Number(id));
  if (!ret) notFound();
  if (!salesReturnIsEditable(ret.status)) redirect(`/sales/return/${ret.id}`);
  const options = await salesReturnOptions(Number(ret.header.customer_order_id), ret.id);
  const billing = await deliveryNoteBilling(options.source?.lines.map((l) => l.id) ?? []);
  return (
    <>
      <SalesReturnForm mode="edit" ret={ret} options={options} billing={billing} can={salesReturnAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="sal_return" rowId={ret.id} />
    </>
  );
}
