import { StockReceiptList } from "@/components/inventory/stock-receipt-list";
import { requirePermission } from "@/lib/erp/auth";
import { listStockReceipts, pendingSources } from "@/lib/erp/stock-receipt";
import { STOCK_RECEIPT_PATH } from "@/lib/erp/stock-receipt-purposes";
import { stockReceiptAbilities } from "@/lib/erp/stock-receipt-workflow";
import { warehouseIdsOf } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

/** The Stock Receipt register (P317, P339), narrowed to the user's warehouses (OD-9), with what still waits. */
export default async function Page() {
  const actor = await requirePermission("STOCK_RECEIPT_VIEW", STOCK_RECEIPT_PATH);
  const mine = await warehouseIdsOf(actor);
  const [rows, pending] = await Promise.all([listStockReceipts(mine), pendingSources(mine)]);
  const waiting = pending.map((s) => ({ purpose: s.purpose, id: s.id, no: s.no, date: s.date, from: s.fromName || s.fromLabel }));
  return <StockReceiptList rows={rows} waiting={waiting} can={stockReceiptAbilities(actor.permissions)} />;
}
