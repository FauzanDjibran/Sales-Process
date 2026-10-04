import { StockLotList } from "@/components/inventory/stock-lot-list";
import { requirePermission } from "@/lib/erp/auth";
import { listStockLots, stockLotFormOptions } from "@/lib/erp/inventory";

export const dynamic = "force-dynamic";

/** Lot (Sementara) — the stand-in inventory's lots, picked by the Delivery Note (U15). */
export default async function Page() {
  const actor = await requirePermission("STOCK_LOT_VIEW", "/master/stock-lot");
  const [rows, options] = await Promise.all([listStockLots(), stockLotFormOptions()]);
  return <StockLotList rows={rows} options={options} canEdit={actor.permissions.has("STOCK_LOT_EDIT")} />;
}
