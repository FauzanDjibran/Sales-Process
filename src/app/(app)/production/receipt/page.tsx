import { ReleaseList } from "@/components/production/release-list";
import { requirePermission } from "@/lib/erp/auth";
import { listReleases } from "@/lib/erp/production-release";
import { releaseAbilities } from "@/lib/erp/production-release-workflow";

export const dynamic = "force-dynamic";

/** The Penerimaan Hasil Produksi register (P170). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_RECEIPT_VIEW", "/production/receipt");
  return <ReleaseList purpose="finished_receipt" rows={await listReleases("finished_receipt")} can={releaseAbilities("finished_receipt", actor.permissions)} />;
}
