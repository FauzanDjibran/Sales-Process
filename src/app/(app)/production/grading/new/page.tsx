import { GradingForm } from "@/components/production/grading-form";
import { requirePermission } from "@/lib/erp/auth";
import { gradingOptions } from "@/lib/erp/production-grading";
import { resultNotesOfJobs } from "@/lib/erp/production-work";
import { GRADING_PATH, GRADING_WORKFLOW } from "@/lib/erp/production-execution-workflow";

export const dynamic = "force-dynamic";

/** The grading module may not read the work's tables, so the page composes the notes (§3.1, W42). */
async function jobNotes(options: Awaited<ReturnType<typeof gradingOptions>>) {
  const notes = await resultNotesOfJobs(options.inputs.flatMap((b) => (b.jobId ? [b.jobId] : [])));
  return Object.fromEntries(notes);
}

export default async function Page() {
  const actor = await requirePermission("PRODUCTION_GRADING_CREATE", `${GRADING_PATH}/new`);
  const options = await gradingOptions();
  return <GradingForm mode="new" grading={null} options={options} notes={await jobNotes(options)} can={GRADING_WORKFLOW.abilities(actor.permissions)} />;
}
