import { ReleaseForm } from "@/components/production/release-form";
import { requirePermission } from "@/lib/erp/auth";
import { releaseOptions } from "@/lib/erp/production-release";
import { releaseAbilities } from "@/lib/erp/production-release-workflow";

export const dynamic = "force-dynamic";

/** A new Pemusnahan Produksi (P170). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_SCRAP_CREATE", "/production/scrap/new");
  return <ReleaseForm purpose="scrap" mode="new" doc={null} options={await releaseOptions()} can={releaseAbilities("scrap", actor.permissions)} />;
}
