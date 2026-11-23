import { StockReceiptList } from "@/components/inventory/stock-receipt-list";
import { requirePermission } from "@/lib/erp/auth";
import { listStockReceipts } from "@/lib/erp/stock-receipt";
import { STOCK_RECEIPT_PATH } from "@/lib/erp/stock-receipt-purposes";
import { warehouseIdsOf } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

/** The Stock Receipt register (P317), narrowed to the user's warehouses (OD-9). */
export default async function Page() {
  const actor = await requirePermission("STOCK_RECEIPT_VIEW", STOCK_RECEIPT_PATH);
  return <StockReceiptList rows={await listStockReceipts(await warehouseIdsOf(actor))} />;
}
