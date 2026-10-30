import { notFound } from "next/navigation";
import { ReleaseForm } from "@/components/production/release-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { RELEASE_WORKFLOW } from "@/lib/erp/production-doc-workflow";
import { releaseCurrent, releaseOptions, getRelease } from "@/lib/erp/production-release";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_RELEASE_VIEW", RELEASE_WORKFLOW.path);
  const release = await getRelease(Number(id));
  if (!release) notFound();
  // The journal Posting would write is asked for by the dialog as a dry run (P103).
  const options = await releaseOptions(releaseCurrent(release));
  return (
    <>
      <ReleaseForm mode="view" release={release} options={options} can={RELEASE_WORKFLOW.abilities(actor.permissions)} />
      <RecordHistoryCard entityKey="prd_release" rowId={release.id} />
    </>
  );
}
