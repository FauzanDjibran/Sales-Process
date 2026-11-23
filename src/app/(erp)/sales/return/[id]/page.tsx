import { notFound } from "next/navigation";
import { SalesReturnForm } from "@/components/sales/sales-return-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { deliveryNoteBilling } from "@/lib/erp/ar-invoice";
import { salesReturnReceipts } from "@/lib/erp/receipt-note";
import { getSalesReturn, salesReturnOptions } from "@/lib/erp/sales-return";
import { SalesReturnReceiptsCard } from "@/components/sales/sales-return-receipts";
import { salesReturnAbilities } from "@/lib/erp/sales-return-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("SALES_RETURN_VIEW", "/sales/return");
  const ret = await getSalesReturn(Number(id));
  if (!ret) notFound();
  const options = await salesReturnOptions(Number(ret.header.customer_order_id), ret.id);
  const billing = await deliveryNoteBilling(ret.lines.map((l) => Number(l.delivery_note_line_id)));
  // What came back is the Receipt Note module's to list; this page composes the two.
  const showReceipts = (ret.status === "Open" || ret.status === "Closed") && actor.permissions.has("RECEIPT_NOTE_VIEW");
  const receipts = showReceipts ? await salesReturnReceipts(ret.id) : [];
  return (
    <>
      <SalesReturnForm
        mode="view"
        ret={ret}
        options={options}
        billing={billing}
        can={salesReturnAbilities(actor.permissions)}
        extraTabs={
          showReceipts
            ? [{ key: "receipts", label: "Penerimaan Gudang", icon: "box", count: receipts.length, content: <SalesReturnReceiptsCard receipts={receipts} /> }]
            : []
        }
      />
      <RecordHistoryCard entityKey="sal_return" rowId={ret.id} />
    </>
  );
}
