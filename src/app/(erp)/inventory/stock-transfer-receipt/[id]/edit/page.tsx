import { notFound, redirect } from "next/navigation";
import { TransferReceiptForm } from "@/components/inventory/transfer-receipt-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getTransferReceipt, receiptSource } from "@/lib/erp/stock-transfer-receipt";
import { stockTransferReceiptAbilities, stockTransferReceiptIsEditable } from "@/lib/erp/stock-transfer-workflow";
import { requireWarehouse } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("STOCK_TRANSFER_RECEIPT_EDIT", `/inventory/stock-transfer-receipt/${id}/edit`);
  const receipt = await getTransferReceipt(Number(id));
  if (!receipt) notFound();
  if (!stockTransferReceiptIsEditable(receipt.status)) redirect(`/inventory/stock-transfer-receipt/${receipt.id}`);
  const source = await receiptSource(Number(receipt.header.stock_transfer_id), receipt.id);
  if (!source) notFound();
  await requireWarehouse(actor, source.toId);
  return (
    <>
      <TransferReceiptForm mode="edit" receipt={receipt} source={source} sources={[]} can={stockTransferReceiptAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="log_stock_transfer_receipt" rowId={receipt.id} />
    </>
  );
}
