import { ReleaseForm } from "@/components/production/release-form";
import { requirePermission } from "@/lib/erp/auth";
import { releaseOptions } from "@/lib/erp/production-release";
import { releaseAbilities } from "@/lib/erp/production-release-workflow";

export const dynamic = "force-dynamic";

/** A new Penerimaan Hasil Produksi (P170). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_RECEIPT_CREATE", "/production/receipt/new");
  return <ReleaseForm purpose="finished_receipt" mode="new" doc={null} options={await releaseOptions()} can={releaseAbilities("finished_receipt", actor.permissions)} />;
}
