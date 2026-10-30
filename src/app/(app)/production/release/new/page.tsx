import { ReleaseForm } from "@/components/production/release-form";
import { requirePermission } from "@/lib/erp/auth";
import { RELEASE_WORKFLOW } from "@/lib/erp/production-doc-workflow";
import { releaseOptions } from "@/lib/erp/production-release";

export const dynamic = "force-dynamic";

/** A new Production Release (R8). */
export default async function Page() {
  const actor = await requirePermission("PRODUCTION_RELEASE_CREATE", `${RELEASE_WORKFLOW.path}/new`);
  return <ReleaseForm mode="new" release={null} options={await releaseOptions()} can={RELEASE_WORKFLOW.abilities(actor.permissions)} />;
}
