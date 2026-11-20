import { notFound } from "next/navigation";
import { TransferReceiptForm } from "@/components/inventory/transfer-receipt-form";
import { requirePermission } from "@/lib/erp/auth";
import { receiptSource, receiptSourcePicker } from "@/lib/erp/stock-transfer-receipt";
import { stockTransferReceiptAbilities } from "@/lib/erp/stock-transfer-workflow";
import { requireWarehouse, warehouseIdsOf } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

/**
 * A new Transfer Terima (P300). Without `?from=` it offers the Transfer Kirim
 * in transit to the user's warehouses; with it, it reads only that one.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const actor = await requirePermission("STOCK_TRANSFER_RECEIPT_CREATE", "/inventory/stock-transfer-receipt/new");
  const can = stockTransferReceiptAbilities(actor.permissions);
  const transferId = Number(from) || null;
  if (!transferId) {
    const sources = await receiptSourcePicker(await warehouseIdsOf(actor));
    return <TransferReceiptForm key="pick" mode="new" receipt={null} source={null} sources={sources} can={can} />;
  }
  const source = await receiptSource(transferId);
  if (!source || source.status !== "InTransit") notFound();
  await requireWarehouse(actor, source.toId);
  return <TransferReceiptForm key={source.id} mode="new" receipt={null} source={source} sources={[]} can={can} />;
}
