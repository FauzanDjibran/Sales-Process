import { ProductionReceiptList } from "@/components/inventory/production-receipt-list";
import { requirePermission } from "@/lib/erp/auth";
import { listProductionReceipts } from "@/lib/erp/production-receipt";
import { warehouseIdsOf } from "@/lib/erp/warehouse-access";

export const dynamic = "force-dynamic";

/** The BSTB ke Finish Goods register (P303), narrowed to the user's warehouses (OD-9). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_RECEIPT_VIEW", "/inventory/production-receipt");
  return <ProductionReceiptList rows={await listProductionReceipts(await warehouseIdsOf(actor))} />;
}
