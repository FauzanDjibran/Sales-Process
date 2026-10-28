import { CostCloseList } from "@/components/production/cost-close-list";
import { requirePermission } from "@/lib/erp/auth";
import { closePeriods } from "@/lib/erp/production-close";

export const dynamic = "force-dynamic";

/** Penutupan Biaya Produksi: the fiscal periods and whether their cost is closed (P172). */
export default async function Page() {
  await requirePermission("PRODUCTION_COST_CLOSE_VIEW", "/production/cost-close");
  return <CostCloseList rows={await closePeriods()} />;
}
