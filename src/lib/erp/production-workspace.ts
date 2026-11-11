import "server-only";

import { prisma } from "@/lib/prisma";
import { availableBuckets, unitStageTotals, type UnitStageTotal } from "./production-ledger";
import { routeMap, type RouteMap } from "./production-master";
import { gradingDraftBucketIds } from "./production-grading";
import { resultNotesOfJobs, workDraftBucketIds } from "./production-work";
import { qcDraftBucketIds } from "./production-qc";

/**
 * Workspace Unit (`Workspace-Unit-Diff.md`, P261–P263): one door to every Unit's
 * work. It reads only; the documents it opens are made in their own menus.
 */

export type WorkspaceUnit = {
  id: number;
  label: string;
  name: string;
  workstation: string | null;
  process: "PassThrough" | "Grading" | "Assembly";
  hasQc: boolean;
  releasesJob: boolean;
};

type UnitRow = {
  id: number;
  unit_label: string;
  unit_name: string;
  process: WorkspaceUnit["process"];
  has_qc: boolean;
  releases_job: boolean;
  workstation: { workstation_name: string } | null;
};

const toUnit = (u: UnitRow): WorkspaceUnit => ({
  id: u.id,
  label: u.unit_label,
  name: u.unit_name,
  workstation: u.workstation?.workstation_name ?? null,
  process: u.process,
  hasQc: u.has_qc,
  releasesJob: u.releases_job,
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
      const cp = r.steps.findIndex((s) => s.checkpoint);
      return cp >= 0 && r.steps.findIndex((s) => s.unitId === unitId) > cp;
    }),
  };
}

export type CardUnit = WorkspaceUnit & { pre: boolean; lineIds: number[] };
export type WorkspaceCards = { units: CardUnit[]; lines: RouteMap["lines"]; totals: UnitStageTotal[] };

/** Active Units, where each sits, and what each holds per stage and line. `only`: the actor's Units, or null for all (P260). */
export async function unitCards(only: number[] | null = null): Promise<WorkspaceCards> {
  const [units, totals, map] = await Promise.all([
    prisma.refUnit.findMany({ where: { status: "Active", ...(only ? { id: { in: only } } : {}) }, orderBy: { unit_code: "asc" }, include: { workstation: true } }),
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
  const u = await prisma.refUnit.findFirst({ where: { unit_label: label }, include: { workstation: true } });
  if (!u) return null;
  const map = await routeMap();
  const places = placesOf(map, u.id);
  return { ...toUnit(u), ...places, lines: map.lines.filter((l) => places.lineIds.includes(l.id)) };
}

/**
 * Where goods at a Unit go next, by the routing they follow: their partai's, or
 * the segment before the partai. The last Unit of the segment hands over to a
 * line's first Unit by the BSTB that forms the partai; with several lines that
 * line is chosen on the BSTB, so no single next Unit is named (W83).
 */
function nextStep(map: RouteMap, unitId: number, routingId: number | null): { unitId: number; exit: "Push" | "BSTB" } | null {
  const routing = routingId ? map.routings.find((r) => r.id === routingId) : map.routings.find((r) => r.lineId === null);
  if (!routing) return null;
  const i = routing.steps.findIndex((s) => s.unitId === unitId);
  if (i < 0) return null;
  const here = routing.steps[i];
  const next = routing.steps[i + 1];
  if (next) return { unitId: next.unitId, exit: here.workstationId != null && here.workstationId === next.workstationId ? "Push" : "BSTB" };
  if (routing.lineId !== null) return null;
  const lines = map.routings.filter((r) => r.lineId !== null && r.steps.length);
  return lines.length === 1 ? { unitId: lines[0].steps[0].unitId, exit: "BSTB" } : null;
}

export type BoardRow = {
  id: number;
  lotNo: string;
  itemLabel: string;
  itemName: string;
  stage: "Preparation" | "QcCheck" | "StandBy";
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
