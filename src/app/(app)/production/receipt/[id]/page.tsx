import { notFound, redirect } from "next/navigation";
import { ReleaseForm } from "@/components/production/release-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getRelease, releaseCurrent, releaseOptions } from "@/lib/erp/production-release";
import { releaseAbilities } from "@/lib/erp/production-release-workflow";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_RECEIPT_VIEW", "/production/receipt");
  const doc = await getRelease(Number(id));
  if (!doc) notFound();
  // One table, two menus: a document of the other purpose belongs to the other menu.
  if (doc.header.purpose !== "finished_receipt") redirect(`/production/scrap/${doc.id}`);
  // The journal Posting would write is not read here: the Posting dialog asks for it as a dry run (P103).
  const options = await releaseOptions(releaseCurrent(doc));
  return (
    <>
      <ReleaseForm purpose="finished_receipt" mode="view" doc={doc} options={options} can={releaseAbilities("finished_receipt", actor.permissions)} />
      <RecordHistoryCard entityKey="prd_release" rowId={doc.id} />
    </>
  );
}
