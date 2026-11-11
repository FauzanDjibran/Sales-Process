import { notFound } from "next/navigation";
import { GradingForm } from "@/components/production/grading-form";
import { RecordHistoryCard } from "@/components/ui/record-history-card";
import { requirePermission } from "@/lib/erp/auth";
import { narrowToUnits, requireUnit } from "@/lib/erp/production-access";
import { getGrading, gradingOptions } from "@/lib/erp/production-grading";
import { resultNotesOfJobs } from "@/lib/erp/production-work";
import { GRADING_PATH, GRADING_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

/** The grading module may not read the work's tables, so the page composes the notes (§3.1, W42). */
async function jobNotes(options: Awaited<ReturnType<typeof gradingOptions>>) {
  const notes = await resultNotesOfJobs(options.inputs.flatMap((b) => (b.jobId ? [b.jobId] : [])));
  return Object.fromEntries(notes);
}

/** `?post=1`: the form's *Posting* just saved this Draft, so its confirmation opens (D2). */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ post?: string }> }) {
  const { id } = await params;
  const { post } = await searchParams;
  const actor = await requirePermission("PRODUCTION_GRADING_VIEW", GRADING_PATH);
  const doc = await getGrading(Number(id));
  if (!doc) notFound();
  await requireUnit(actor, doc.unitId);
  const options = await narrowToUnits(actor, await gradingOptions([...doc.inputs.map((i) => i.bucketId), ...doc.aux.map((a) => a.bucketId)]));
  return (
    <>
      <GradingForm mode="view" grading={doc} options={options} notes={await jobNotes(options)} can={GRADING_WORKFLOW.abilities(actor.permissions)} autoPost={post === "1"} />
      <RecordHistoryCard entityKey="prd_grading" rowId={doc.id} />
    </>
  );
}
