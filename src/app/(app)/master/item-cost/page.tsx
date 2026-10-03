import { ItemCostList } from "@/components/inventory/item-cost-list";
import { requirePermission } from "@/lib/erp/auth";
import { listItemCosts } from "@/lib/erp/inventory";

export const dynamic = "force-dynamic";

/** Harga Pokok (Sementara) — the stand-in inventory's valuation (U11). */
export default async function Page() {
  const actor = await requirePermission("ITEM_COST_VIEW", "/master/item-cost");
  return <ItemCostList rows={await listItemCosts()} canEdit={actor.permissions.has("ITEM_COST_EDIT")} />;
}
