import { notFound } from "next/navigation";
import { StockReceiptForm } from "@/components/inventory/stock-receipt-form";
import { requirePermission } from "@/lib/erp/auth";
import { sourceOf, stockReceiptFormOptions } from "@/lib/erp/stock-receipt";
import { STOCK_RECEIPT_PATH, STOCK_RECEIPT_PURPOSES, isStockReceiptPurpose } from "@/lib/erp/stock-receipt-purposes";
import { stockReceiptAbilities } from "@/lib/erp/stock-receipt-workflow";
import { requireWarehouse, warehouseIdsOf } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

/**
 * Buat Stock Receipt (P339): `?purpose=` chooses what it is, `&source=` the
 * shipment or Receipt Note it takes, read alone once chosen.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ purpose?: string; source?: string }> }) {
  const q = await searchParams;
  const actor = await requirePermission("STOCK_RECEIPT_CREATE", `${STOCK_RECEIPT_PATH}/new`);
  const purpose = isStockReceiptPurpose(q.purpose) ? q.purpose : null;
  const sourceId = Number(q.source) || null;
  const source = purpose && sourceId && STOCK_RECEIPT_PURPOSES[purpose].source ? await sourceOf(purpose, sourceId) : null;
  if (sourceId && !source) notFound();
  if (source) await requireWarehouse(actor, source.warehouseId);
  const options = await stockReceiptFormOptions(await warehouseIdsOf(actor));
  return <StockReceiptForm key={`${purpose}:${sourceId}`} mode="new" receipt={null} purpose={purpose} source={source} options={options} can={stockReceiptAbilities(actor.permissions)} />;
}
