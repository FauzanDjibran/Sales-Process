import { StockAdjustmentForm } from "@/components/inventory/stock-adjustment-form";
import { requirePermission } from "@/lib/erp/auth";
import { stockAdjustmentOptions } from "@/lib/erp/stock-adjustment";
import { stockAdjustmentAbilities } from "@/lib/erp/stock-adjustment-workflow";
import { warehouseIdsOf } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

export default async function Page() {
  const actor = await requirePermission("STOCK_ADJUSTMENT_CREATE", "/inventory/stock-adjustment/new");
  return <StockAdjustmentForm mode="new" doc={null} sheet={null} options={await stockAdjustmentOptions(await warehouseIdsOf(actor))} can={stockAdjustmentAbilities(actor.permissions)} />;
}
