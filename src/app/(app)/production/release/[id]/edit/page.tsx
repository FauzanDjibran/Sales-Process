import { notFound, redirect } from "next/navigation";
import { ReleaseForm } from "@/components/production/release-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { RELEASE_WORKFLOW, prodDocIsEditable } from "@/lib/erp/production-doc-workflow";
import { releaseCurrent, releaseOptions, getRelease } from "@/lib/erp/production-release";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_RELEASE_EDIT", `${RELEASE_WORKFLOW.path}/${id}/edit`);
  const release = await getRelease(Number(id));
  if (!release) notFound();
  if (!prodDocIsEditable(release.status)) redirect(`${RELEASE_WORKFLOW.path}/${release.id}`);
  return (
    <>
      <ReleaseForm mode="edit" release={release} options={await releaseOptions(releaseCurrent(release))} can={RELEASE_WORKFLOW.abilities(actor.permissions)} />
      <RecordHistoryCard entityKey="prd_release" rowId={release.id} />
    </>
  );
}
