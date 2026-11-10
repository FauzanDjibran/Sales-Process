import { notFound } from "next/navigation";
import { UnitBoard } from "@/components/production/unit-board";
import { requirePermission } from "@/lib/erp/auth";
import { GRADING_WORKFLOW, QC_CHECK_WORKFLOW, WORK_WORKFLOW } from "@/lib/erp/production-execution-workflow";
import { availableBuckets } from "@/lib/erp/production-ledger";
import { unitByLabel } from "@/lib/erp/production-workspace";
import { incomingStockIssues } from "@/lib/erp/stock-issue";

export const dynamic = "force-dynamic";

const TABS = ["masuk", "persiapan", "qc", "standby"] as const;

/** The page composes the BSTB module's waiting issues beside the ledger's rows (§3.1). */
export default async function Page({ params, searchParams }: { params: Promise<{ label: string }>; searchParams: Promise<{ tab?: string }> }) {
  const label = decodeURIComponent((await params).label);
  const { tab } = await searchParams;
  const actor = await requirePermission("PRODUCTION_UNIT_VIEW", `/production/workspace/${encodeURIComponent(label)}`);
  const unit = await unitByLabel(label);
  if (!unit) notFound();

  const [buckets, issues] = await Promise.all([availableBuckets({ unitIds: [unit.id] }), incomingStockIssues()]);
  const rows = buckets
    .filter((b) => !b.auxiliary)
    .map((b) => ({
      id: b.id,
      lotNo: b.lotNo,
      itemLabel: b.itemLabel,
      itemName: b.itemName,
      uomLabel: b.uomLabel,
      stage: b.stage,
      partaiId: b.partaiId,
      partaiNo: b.partaiNo,
      jobId: b.jobId,
      jobNo: b.jobNo,
      grams: b.grams,
      isBjl: b.isBjl,
      qcCheckId: b.qcCheckId,
    }));
  const incoming = issues
    .filter((i) => i.unitId === unit.id)
    .map((i) => ({ id: i.id, issueNo: i.issueNo, issueDate: i.issueDate, warehouseLabel: i.warehouseLabel, lines: i.lines.map((l) => ({ lotNo: l.lotNo, qty: l.qty, uomLabel: l.uomLabel })) }));

  return (
    <UnitBoard
      unit={{ label: unit.label, name: unit.name, process: unit.process, hasQc: unit.hasQc }}
      rows={rows}
      incoming={incoming}
      can={{
        grading: GRADING_WORKFLOW.abilities(actor.permissions).create,
        work: WORK_WORKFLOW.abilities(actor.permissions).create,
        qc: QC_CHECK_WORKFLOW.abilities(actor.permissions).create,
      }}
      initialTab={(TABS as readonly string[]).includes(tab ?? "") && !(tab === "qc" && !unit.hasQc) ? (tab as (typeof TABS)[number]) : "persiapan"}
    />
  );
}
