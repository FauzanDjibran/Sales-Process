import "server-only";

import { prisma } from "@/lib/prisma";
import { unitStageSummary } from "./production-ledger";

/**
 * Workspace Unit (`Production-Unit-Workspace-Plan.md`): one door to every Unit's
 * work. It reads only; the documents it opens are still made in their own menus,
 * one form for one action — one grading, one Pengerjaan, one QC Check.
 */

export type WorkspaceUnit = {
  id: number;
  label: string;
  name: string;
  workstation: string | null;
  process: "PassThrough" | "Grading" | "Assembly";
  hasQc: boolean;
};

export type UnitCounts = { rows: number; grams: number };

const toUnit = (u: { id: number; unit_label: string; unit_name: string; process: WorkspaceUnit["process"]; has_qc: boolean; workstation: { workstation_name: string } | null }): WorkspaceUnit => ({
  id: u.id,
  label: u.unit_label,
  name: u.unit_name,
  workstation: u.workstation?.workstation_name ?? null,
  process: u.process,
  hasQc: u.has_qc,
});

/** Active Units with what each holds per stage; Masuk is composed by the page from the BSTB module. */
export async function unitCards(): Promise<(WorkspaceUnit & { preparation: UnitCounts; qc: UnitCounts; standBy: UnitCounts })[]> {
  const [units, held] = await Promise.all([
    prisma.refUnit.findMany({ where: { status: "Active" }, orderBy: { unit_code: "asc" }, include: { workstation: true } }),
    unitStageSummary(),
  ]);
  const at = (id: number, stage: string) => held.get(`${id}:${stage}`) ?? { rows: 0, grams: 0 };
  return units.map((u) => ({ ...toUnit(u), preparation: at(u.id, "Preparation"), qc: at(u.id, "QcCheck"), standBy: at(u.id, "StandBy") }));
}

export async function unitByLabel(label: string): Promise<WorkspaceUnit | null> {
  const u = await prisma.refUnit.findFirst({ where: { unit_label: label }, include: { workstation: true } });
  return u ? toUnit(u) : null;
}
