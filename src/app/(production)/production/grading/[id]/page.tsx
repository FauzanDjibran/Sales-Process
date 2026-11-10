import { notFound } from "next/navigation";
import { GradingForm } from "@/components/production/grading-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { getGrading, gradingOptions } from "@/lib/erp/production-grading";
import { resultNotesOfJobs } from "@/lib/erp/production-work";
import { GRADING_PATH, GRADING_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

/** The grading module may not read the work's tables, so the page composes the notes (§3.1, W42). */
async function jobNotes(options: Awaited<ReturnType<typeof gradingOptions>>) {
  const notes = await resultNotesOfJobs(options.inputs.flatMap((b) => (b.jobId ? [b.jobId] : [])));
  return Object.fromEntries(notes);
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("PRODUCTION_GRADING_VIEW", GRADING_PATH);
  const doc = await getGrading(Number(id));
  if (!doc) notFound();
  const options = await gradingOptions([doc.bucketId, ...doc.aux.map((a) => a.bucketId)]);
  return (
    <>
      <GradingForm mode="view" grading={doc} options={options} notes={await jobNotes(options)} can={GRADING_WORKFLOW.abilities(actor.permissions)} />
      <RecordHistoryCard entityKey="prd_grading" rowId={doc.id} />
    </>
  );
}
