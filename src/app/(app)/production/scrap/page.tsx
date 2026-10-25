import { ReleaseList } from "@/components/production/release-list";
import { requirePermission } from "@/lib/erp/auth";
import { listReleases } from "@/lib/erp/production-release";
import { releaseAbilities } from "@/lib/erp/production-release-workflow";

export const dynamic = "force-dynamic";

/** The Pemusnahan Produksi register (P170). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_SCRAP_VIEW", "/production/scrap");
  return <ReleaseList purpose="scrap" rows={await listReleases("scrap")} can={releaseAbilities("scrap", actor.permissions)} />;
}
