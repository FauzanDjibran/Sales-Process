import { notFound } from "next/navigation";
import { UnitBoard } from "@/components/production/unit-board";
import { requirePermission } from "@/lib/erp/auth";
import { requireUnit } from "@/lib/erp/production-access";
import { GRADING_WORKFLOW, QC_CHECK_WORKFLOW, WORK_WORKFLOW } from "@/lib/erp/production-execution-workflow";
import { unitBoard, unitByLabel } from "@/lib/erp/production-workspace";
import { incomingStockIssues } from "@/lib/erp/stock-issue";
import { stockIssueAbilities } from "@/lib/erp/stock-issue-workflow";

export const dynamic = "force-dynamic";

const TABS = ["masuk", "persiapan", "qc", "standby", "transit"] as const;

/** The page composes the BSTB module's waiting issues beside the ledger's rows (§3.1). */
export default async function Page({ params, searchParams }: { params: Promise<{ label: string }>; searchParams: Promise<{ tab?: string }> }) {
  const label = decodeURIComponent((await params).label);
  const { tab } = await searchParams;
  const actor = await requirePermission("PRODUCTION_UNIT_VIEW", `/production/workspace/${encodeURIComponent(label)}`);
  const unit = await unitByLabel(label);
  if (!unit) notFound();
  await requireUnit(actor, unit.id);

  const [rows, issues] = await Promise.all([unitBoard(unit.id), incomingStockIssues()]);
  const incoming = issues
    .filter((i) => i.unitId === unit.id)
    .map((i) => ({ id: i.id, issueNo: i.issueNo, issueDate: i.issueDate, warehouseLabel: i.warehouseLabel, auxiliary: i.auxiliary, lines: i.lines.map((l) => ({ lotNo: l.lotNo, qty: l.qty, uomLabel: l.uomLabel })) }));
  const initial = (TABS as readonly string[]).includes(tab ?? "") && !(tab === "qc" && !unit.hasQc) ? (tab as (typeof TABS)[number]) : "persiapan";

  return (
    <UnitBoard
      unit={{
        label: unit.label,
        name: unit.name,
        process: unit.process,
        hasQc: unit.hasQc,
        workstation: unit.workstation,
        pre: unit.pre,
        checkpoint: unit.checkpoint,
        releasesJob: unit.releasesJob,
        afterCheckpoint: unit.afterCheckpoint,
        lines: unit.lines.map((l) => ({ id: l.id, name: l.name })),
      }}
      rows={rows}
      incoming={incoming}
      can={{
        grading: GRADING_WORKFLOW.abilities(actor.permissions).create,
        work: WORK_WORKFLOW.abilities(actor.permissions).create,
        qc: QC_CHECK_WORKFLOW.abilities(actor.permissions).create,
      }}
      issueCan={stockIssueAbilities(actor.permissions)}
      initialTab={initial}
    />
  );
}
