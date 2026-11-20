import { notFound } from "next/navigation";
import { TransferReceiptForm } from "@/components/inventory/transfer-receipt-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getTransferReceipt, receiptSource } from "@/lib/erp/stock-transfer-receipt";
import { stockTransferReceiptAbilities } from "@/lib/erp/stock-transfer-workflow";
import { requireWarehouse } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("STOCK_TRANSFER_RECEIPT_VIEW", "/inventory/stock-transfer-receipt");
  const receipt = await getTransferReceipt(Number(id));
  if (!receipt) notFound();
  const source = await receiptSource(Number(receipt.header.stock_transfer_id), receipt.id);
  if (!source) notFound();
  await requireWarehouse(actor, source.toId);
  return (
    <>
      <TransferReceiptForm mode="view" receipt={receipt} source={source} sources={[]} can={stockTransferReceiptAbilities(actor.permissions)} />
      <RecordHistoryCard entityKey="log_stock_transfer_receipt" rowId={receipt.id} />
    </>
  );
}
