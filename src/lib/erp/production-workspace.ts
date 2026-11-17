import "server-only";

import { prisma } from "@/lib/prisma";
import { availableBuckets, unitStageTotals, type UnitStageTotal, type UnitStep } from "./production-ledger";
import { nextStep, routeMap, type RouteMap } from "./production-master";
import { gradingDraftBucketIds } from "./production-grading";
import { resultNotesOfJobs, workDraftBucketIds } from "./production-work";
import { qcDraftBucketIds } from "./production-qc";

/**
 * Workspace Unit (`Workspace-Unit-Diff.md`, P261–P263): one door to every Unit's
 * work. It reads only; the documents it opens are made in their own menus.
 */

/** The ordered steps of a Unit (T1): the tabs of its page. */
export type WorkspaceStep = { id: number; process: UnitStep["process"] };

export type WorkspaceUnit = {
  id: number;
  label: string;
  name: string;
  workstation: string | null;
  steps: WorkspaceStep[];
  allowReproses: boolean;
};

type UnitRow = {
  id: number;
  unit_label: string;
  unit_name: string;
  allow_reproses: boolean;
  workstation: { workstation_name: string } | null;
  steps: { id: number; seq: number; process: UnitStep["process"] }[];
};

const toUnit = (u: UnitRow): WorkspaceUnit => ({
  id: u.id,
  label: u.unit_label,
  name: u.unit_name,
  workstation: u.workstation?.workstation_name ?? null,
  steps: u.steps.slice().sort((a, b) => a.seq - b.seq).map((s) => ({ id: s.id, process: s.process })),
  allowReproses: u.allow_reproses,
});

/** Where a Unit sits on the routings: the lines it serves, or the segment before the partai. */
function placesOf(map: RouteMap, unitId: number) {
  const on = map.routings.filter((r) => r.steps.some((s) => s.unitId === unitId));
  return {
    pre: on.some((r) => r.lineId === null),
    lineIds: [...new Set(on.flatMap((r) => (r.lineId ? [r.lineId] : [])))],
    checkpoint: on.some((r) => r.steps.some((s) => s.unitId === unitId && s.checkpoint)),
    // Past the checkpoint a Job may hold several partai (W103).
    afterCheckpoint: on.some((r) => {
      const cp = r.steps.map((s) => s.checkpoint).lastIndexOf(true);
      return cp >= 0 && r.steps.findIndex((s) => s.unitId === unitId) > cp;
    }),
  };
}

export type CardUnit = WorkspaceUnit & { pre: boolean; lineIds: number[] };
export type WorkspaceCards = { units: CardUnit[]; lines: RouteMap["lines"]; totals: UnitStageTotal[] };

/** Active Units, where each sits, and what each holds per stage and line. `only`: the actor's Units, or null for all (P260). */
export async function unitCards(only: number[] | null = null): Promise<WorkspaceCards> {
  const [units, totals, map] = await Promise.all([
    prisma.refUnit.findMany({ where: { status: "Active", ...(only ? { id: { in: only } } : {}) }, orderBy: { unit_code: "asc" }, include: { workstation: true, steps: true } }),
    unitStageTotals(),
    routeMap(),
  ]);
  const order = new Map<number, number>();
  for (const r of map.routings.slice().sort((a, b) => (a.lineId === null ? -1 : b.lineId === null ? 1 : 0))) for (const s of r.steps) if (!order.has(s.unitId)) order.set(s.unitId, order.size);
  return {
    units: units
      .map((u) => ({ ...toUnit(u), ...placesOf(map, u.id) }))
      .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999)),
    lines: map.lines,
    totals,
  };
}

export async function unitByLabel(label: string): Promise<(WorkspaceUnit & ReturnType<typeof placesOf> & { lines: RouteMap["lines"] }) | null> {
  const u = await prisma.refUnit.findFirst({ where: { unit_label: label }, include: { workstation: true, steps: true } });
  if (!u) return null;
  const map = await routeMap();
  const places = placesOf(map, u.id);
  return { ...toUnit(u), ...places, lines: map.lines.filter((l) => places.lineIds.includes(l.id)) };
}

export type BoardRow = {
  id: number;
  lotNo: string;
  itemLabel: string;
  itemName: string;
  stage: "Preparation" | "Working" | "StandBy" | "InTransit";
  /** The step goods wait at, for the Persiapan and Sedang Dikerjakan tabs. */
  stepId: number | null;
  partaiId: number | null;
  partaiNo: string | null;
  lineId: number | null;
  lineName: string | null;
  jobId: number | null;
  jobNo: string | null;
  grams: number | null;
  value: number;
  isBjl: boolean;
  since: string | null;
  /** Turned back by a QC Check (W66). */
  balikQc: boolean;
  /** Named by a Draft document. */
  inDraft: boolean;
  notes: string[];
  next: { label: string; exit: "Push" | "BSTB" } | null;
};

/** One Unit's goods by stage, with where each goes next: the Unit page's tables (W111). */
export async function unitBoard(unitId: number): Promise<BoardRow[]> {
  // shortcut: loads every held bucket of one Unit and groups them in memory; move the grouping and paging to SQL (prd_balance_held_idx) once a Unit holds thousands of rows.
  const [buckets, map, drafts] = await Promise.all([
    availableBuckets({ unitIds: [unitId] }),
    routeMap(),
    Promise.all([gradingDraftBucketIds(), workDraftBucketIds(), qcDraftBucketIds()]).then((l) => new Set(l.flat())),
  ]);
  const goods = buckets.filter((b) => !b.auxiliary && b.qty > 0);
  const notes = await resultNotesOfJobs([...new Set(goods.flatMap((b) => (b.jobId ? [b.jobId] : [])))]);
  const nextIds = new Set<number>();
  const steps = new Map<number, ReturnType<typeof nextStep>>();
  for (const b of goods) {
    const key = b.partaiRoutingId ?? 0;
    if (!steps.has(key)) steps.set(key, nextStep(map, unitId, b.partaiRoutingId));
    const s = steps.get(key);
    if (s) nextIds.add(s.unitId);
  }
  const labels = new Map((await prisma.refUnit.findMany({ where: { id: { in: [...nextIds] } }, select: { id: true, unit_label: true } })).map((u) => [u.id, u.unit_label]));
  return goods.map((b) => {
    const s = steps.get(b.partaiRoutingId ?? 0);
    return {
      id: b.id,
      lotNo: b.lotNo,
      itemLabel: b.itemLabel,
      itemName: b.itemName,
      stage: b.stage,
      stepId: b.stepId,
      partaiId: b.partaiId,
      partaiNo: b.partaiNo,
      lineId: b.partaiLineId,
      lineName: b.partaiLineName,
      jobId: b.jobId,
      jobNo: b.jobNo,
      grams: b.grams,
      value: b.value,
      isBjl: b.isBjl,
      since: b.since,
      balikQc: b.qcCheckId != null,
      inDraft: drafts.has(b.id),
      notes: b.jobId ? (notes.get(b.jobId) ?? []) : [],
      next: s ? { label: labels.get(s.unitId) ?? "", exit: s.exit } : null,
    };
  });
}
