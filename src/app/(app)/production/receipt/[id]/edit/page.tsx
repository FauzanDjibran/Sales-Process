import { notFound, redirect } from "next/navigation";
import { ReleaseForm } from "@/components/production/release-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getRelease, releaseCurrent, releaseOptions } from "@/lib/erp/production-release";
import { releaseAbilities, releaseIsEditable } from "@/lib/erp/production-release-workflow";

export const dynamic = "force-dynamic";

/** Only a Draft is edited; anything else goes back to its detail. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_RECEIPT_EDIT", `/production/receipt/${id}/edit`);
  const doc = await getRelease(Number(id));
  if (!doc) notFound();
  if (doc.header.purpose !== "finished_receipt" || !releaseIsEditable(doc.status)) redirect(`/production/receipt/${doc.id}`);
  return (
    <>
      <ReleaseForm purpose="finished_receipt" mode="edit" doc={doc} options={await releaseOptions(releaseCurrent(doc))} can={releaseAbilities("finished_receipt", actor.permissions)} />
      <RecordHistoryCard entityKey="prd_release" rowId={doc.id} />
    </>
  );
}
