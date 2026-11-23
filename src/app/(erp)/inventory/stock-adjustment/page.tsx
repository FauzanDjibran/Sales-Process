import { StockAdjustmentList } from "@/components/inventory/stock-adjustment-list";
import { requirePermission } from "@/lib/erp/auth";
import { listStockAdjustments } from "@/lib/erp/stock-adjustment";
import { stockAdjustmentAbilities } from "@/lib/erp/stock-adjustment-workflow";
import { warehouseIdsOf } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

/** The Stock Adjustment register (P318), narrowed to the user's warehouses (OD-9). */
export default async function Page() {
  const actor = await requirePermission("STOCK_ADJUSTMENT_VIEW", "/inventory/stock-adjustment");
  return <StockAdjustmentList rows={await listStockAdjustments(await warehouseIdsOf(actor))} can={stockAdjustmentAbilities(actor.permissions)} />;
}
