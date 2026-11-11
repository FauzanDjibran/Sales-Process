import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { parseList } from "./partner-shape";
import { routingInUse, routingsInUse } from "./production-ledger";
import {
  RATES_KEY,
  STEPS_KEY,
  rateErrors,
  stepErrors,
  stepRuleErrors,
  type RateDraft,
  type RouteUnit,
  type StepDraft,
} from "./production-master-shape";

/**
 * The collections of the two production masters that own one — a Routing's
 * steps and a Standard Cost's rates (P225). Part of the record: edited on its
 * form's tab, saved with it in one transaction, as an Item's conversions are.
 *
 * A routing's steps are replaced as a whole on every save: nothing refers to a
 * step by id. A Standard Cost version is written once and never again (P226).
 */

// -------------------------------------------------------------------- reads

export async function routingCollections(routingId: number): Promise<{ steps: StepDraft[] }> {
  const rows = await prisma.prdRoutingStep.findMany({ where: { routing_id: routingId }, orderBy: { seq: "asc" } });
  return {
    steps: rows.map((r) => ({
      id: r.id,
      key: `s${r.id}`,
      unit_id: r.unit_id,
      is_checkpoint: r.is_checkpoint,
      is_skippable: r.is_skippable,
    })),
  };
}

export async function rateCollections(versionId: number): Promise<{ rates: RateDraft[] }> {
  const rows = await prisma.prdRateVersionLine.findMany({ where: { version_id: versionId }, orderBy: { id: "asc" } });
  return { rates: rows.map((r) => ({ id: r.id, key: `r${r.id}`, unit_id: r.unit_id, rate: r.rate.toString() })) };
}

// --------------------------------------------------------------- validation

type UnitInfo = RouteUnit & { unit_label: string; status: string };

async function unitsById(ids: number[]): Promise<Map<number, UnitInfo>> {
  const rows = await prisma.refUnit.findMany({
    where: { id: { in: ids } },
    select: { id: true, unit_label: true, status: true, process: true, workstation_id: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

export type RoutingCollections = { steps: (Omit<StepDraft, "key" | "id" | "unit_id"> & { unit_id: number })[] };

/** A step may keep an inactive Unit it already had; it may not pick one. */
async function stillOffered(routingId: number | null, unit: UnitInfo): Promise<boolean> {
  if (unit.status === "Active") return true;
  if (!routingId) return false;
  return (await prisma.prdRoutingStep.count({ where: { routing_id: routingId, unit_id: unit.id } })) > 0;
}

/** A line may have several routings; the segment before the partai is one (P227). */
async function segmentClash(lineId: number | null, routingId: number | null): Promise<string | null> {
  if (lineId) return null;
  const other = await prisma.prdRouting.findFirst({
    where: { line_id: null, ...(routingId ? { id: { not: routingId } } : {}) },
    select: { routing_label: true },
  });
  return other ? `Segmen sebelum partai sudah ada: ${other.routing_label}.` : null;
}

/** The last Unit of the segment before the partai, where every line's routing takes over. */
export async function segmentEnd(): Promise<RouteUnit | null> {
  const step = await prisma.prdRoutingStep.findFirst({
    where: { routing: { line_id: null } },
    orderBy: { seq: "desc" },
    select: { unit: { select: { id: true, process: true, workstation_id: true } } },
  });
  return step?.unit ?? null;
}

/** A routing goods follow keeps its steps: a different order is a new routing (P227). */
async function changesUsedRouting(routingId: number | null, steps: RoutingCollections["steps"]): Promise<boolean> {
  if (!routingId || !(await routingInUse(routingId))) return false;
  const stored = await prisma.prdRoutingStep.findMany({ where: { routing_id: routingId }, orderBy: { seq: "asc" } });
  const shape = (s: RoutingCollections["steps"][number]) => [s.unit_id, s.is_checkpoint, s.is_skippable].join("|");
  return stored.map(shape).join(",") !== steps.map(shape).join(",");
}

export async function checkRoutingCollections(
  values: Record<string, unknown>,
  routingId: number | null
): Promise<{ errors: Record<string, string>; clean: RoutingCollections }> {
  const clean: RoutingCollections = { steps: [] };
  const list = parseList<Partial<StepDraft>>(values[STEPS_KEY]);
  if (list === null) return { errors: { [STEPS_KEY]: "Data langkah tidak terbaca." }, clean };

  const units = await unitsById(list.map((s) => Number(s.unit_id)).filter(Boolean));
  const problems: string[] = [];
  const taken: number[] = [];
  for (const [i, s] of list.entries()) {
    const found = stepErrors({ ...s, unit_id: Number(s.unit_id) || null }, taken);
    if (Object.keys(found).length) {
      problems.push(`Langkah ${i + 1}: ${Object.values(found)[0]}`);
      continue;
    }
    const unit = units.get(Number(s.unit_id));
    if (!unit) {
      problems.push(`Langkah ${i + 1}: unit tidak ditemukan.`);
      continue;
    }
    if (!(await stillOffered(routingId, unit))) {
      problems.push(`Langkah ${i + 1}: unit ${unit.unit_label} nonaktif.`);
      continue;
    }
    taken.push(unit.id);
    clean.steps.push({
      unit_id: unit.id,
      is_checkpoint: Boolean(s.is_checkpoint),
      is_skippable: Boolean(s.is_skippable),
    });
  }
  if (!problems.length) {
    const hasLine = Number(values.line_id) > 0;
    // shortcut: a segment saved after its lines is not rechecked against them; a used one is locked anyway.
    problems.push(...stepRuleErrors(clean.steps, hasLine, (id) => units.get(id), hasLine ? await segmentEnd() : null));
  }
  const errors: Record<string, string> = problems.length ? { [STEPS_KEY]: problems.join(" ") } : {};
  const clash = await segmentClash(Number(values.line_id) || null, routingId);
  if (clash) errors.line_id = clash;
  if (!problems.length && (await changesUsedRouting(routingId, clean.steps))) {
    errors[STEPS_KEY] = "Routing ini sudah dipakai: langkahnya tidak dapat diubah. Buat routing baru untuk line ini.";
  }
  return { errors, clean };
}

export type RateCollections = { rates: { unit_id: number; rate: string }[] };

export async function checkRateCollections(
  values: Record<string, unknown>
): Promise<{ errors: Record<string, string>; clean: RateCollections }> {
  const clean: RateCollections = { rates: [] };
  const list = parseList<Partial<RateDraft>>(values[RATES_KEY]);
  if (list === null) return { errors: { [RATES_KEY]: "Data rate tidak terbaca." }, clean };

  const units = await unitsById(list.map((r) => Number(r.unit_id)).filter(Boolean));
  const problems: string[] = [];
  const taken: number[] = [];
  for (const [i, r] of list.entries()) {
    const found = rateErrors({ ...r, unit_id: Number(r.unit_id) || null }, taken);
    if (Object.keys(found).length) {
      problems.push(`Rate ${i + 1}: ${Object.values(found)[0]}`);
      continue;
    }
    const unit = units.get(Number(r.unit_id));
    if (!unit) {
      problems.push(`Rate ${i + 1}: unit tidak ditemukan.`);
      continue;
    }
    if (unit.status !== "Active") {
      problems.push(`Rate ${i + 1}: unit ${unit.unit_label} nonaktif.`);
      continue;
    }
    taken.push(unit.id);
    clean.rates.push({ unit_id: unit.id, rate: String(r.rate).trim() });
  }
  return { errors: problems.length ? { [RATES_KEY]: problems.join(" ") } : {}, clean };
}

// --------------------------------------------------------------- page facts

/** Step counts and which routings are locked by the goods following them (P227). */
export async function routingFacts(): Promise<Map<number, { steps: number; locked: boolean }>> {
  const [steps, used] = await Promise.all([prisma.prdRoutingStep.groupBy({ by: ["routing_id"], _count: { _all: true } }), routingsInUse()]);
  const out = new Map<number, { steps: number; locked: boolean }>();
  for (const s of steps) out.set(s.routing_id, { steps: s._count._all, locked: used.has(s.routing_id) });
  return out;
}

/** The rows a Workstation or a Line lists on its page: its Units, its Routings. */
export async function unitsOfWorkstation(id: number) {
  const rows = await prisma.refUnit.findMany({ where: { workstation_id: id }, orderBy: { unit_label: "asc" } });
  return rows.map((r) => ({ id: r.id, label: r.unit_label, name: r.unit_name }));
}

export async function routingsOfLine(id: number) {
  const rows = await prisma.prdRouting.findMany({ where: { line_id: id }, orderBy: { routing_label: "asc" } });
  return rows.map((r) => ({ id: r.id, label: r.routing_label, name: r.routing_name }));
}

export async function unitCountsByWorkstation(): Promise<Map<number, number>> {
  const groups = await prisma.refUnit.groupBy({ by: ["workstation_id"], _count: { _all: true } });
  return new Map(groups.flatMap((g) => (g.workstation_id == null ? [] : [[g.workstation_id, g._count._all]])));
}

/** Units in the order goods meet them: the segment, then each line's routing, the rest after. */
export async function unitRoutingOrder(): Promise<Map<number, number>> {
  const steps = await prisma.prdRoutingStep.findMany({
    orderBy: [{ routing: { line_id: { sort: "asc", nulls: "first" } } }, { routing_id: "asc" }, { seq: "asc" }],
    select: { unit_id: true },
  });
  const order = new Map<number, number>();
  for (const s of steps) if (!order.has(s.unit_id)) order.set(s.unit_id, order.size);
  return order;
}

/** A copy of a routing's steps for a new routing; the source stays locked, the copy does not. */
export async function routingCopy(id: number) {
  const routing = await prisma.prdRouting.findUnique({ where: { id }, select: { line_id: true } });
  if (!routing) return null;
  const { steps } = await routingCollections(id);
  return { lineId: routing.line_id, steps: steps.map((s, i) => ({ ...s, id: undefined, key: `c${i}` })) };
}

/** The label of the version saving a new one would close. */
export async function activeRateVersion(): Promise<string | null> {
  const row = await prisma.prdRateVersion.findFirst({ where: { status: "Active" }, select: { rate_label: true } });
  return row?.rate_label ?? null;
}

/** Whether the Unit sits on any routing, so moving it changes that routing's moves. */
export async function unitOnRouting(id: number): Promise<boolean> {
  return (await prisma.prdRoutingStep.count({ where: { unit_id: id } })) > 0;
}

// ------------------------------------------------------------------- writes

export async function writeRoutingCollections(
  tx: Prisma.TransactionClient,
  routingId: number,
  clean: RoutingCollections
): Promise<void> {
  await tx.prdRoutingStep.deleteMany({ where: { routing_id: routingId } });
  if (clean.steps.length) {
    await tx.prdRoutingStep.createMany({ data: clean.steps.map((s, i) => ({ ...s, routing_id: routingId, seq: i + 1 })) });
  }
}

/** Writes a new version's rates, closes the active version and makes this one active. */
export async function writeRateCollections(
  tx: Prisma.TransactionClient,
  versionId: number,
  clean: RateCollections,
  actorId: number
): Promise<void> {
  if (clean.rates.length) {
    await tx.prdRateVersionLine.createMany({ data: clean.rates.map((r) => ({ ...r, version_id: versionId })) });
  }
  const active = await tx.prdRateVersion.findMany({ where: { status: "Active" }, select: { id: true } });
  await tx.prdRateVersion.updateMany({ where: { status: "Active" }, data: { status: "Inactive", updated_by: actorId } });
  await tx.prdRateVersion.update({ where: { id: versionId }, data: { status: "Active" } });
  if (active.length) {
    await tx.auditLog.createMany({
      data: active.map((v) => ({ entity_key: "prd_rate_version", row_id: v.id, action: "UPDATE" as const, event: "deactivate", by: actorId })),
    });
  }
}

export type RouteMap = {
  /** Active lines, for the Workspace's Line tabs. */
  lines: { id: number; label: string; name: string }[];
  routings: { id: number; lineId: number | null; steps: { unitId: number; workstationId: number | null; checkpoint: boolean }[] }[];
};

/**
 * Every active routing in order, with the Workstation of each step: which lines
 * a Unit serves, and where goods go next (P263). The routing and its Units are
 * the ERP's masters; the Workspace only reads them.
 */
export async function routeMap(): Promise<RouteMap> {
  const [lines, routings] = await Promise.all([
    prisma.prdLine.findMany({ where: { status: "Active" }, orderBy: { line_code: "asc" }, select: { id: true, line_label: true, line_name: true } }),
    prisma.prdRouting.findMany({
      where: { status: "Active" },
      orderBy: { id: "asc" },
      select: { id: true, line_id: true, steps: { orderBy: { seq: "asc" }, select: { unit_id: true, is_checkpoint: true, unit: { select: { workstation_id: true } } } } },
    }),
  ]);
  return {
    lines: lines.map((l) => ({ id: l.id, label: l.line_label, name: l.line_name })),
    routings: routings.map((r) => ({
      id: r.id,
      lineId: r.line_id,
      steps: r.steps.map((s) => ({ unitId: s.unit_id, workstationId: s.unit.workstation_id, checkpoint: s.is_checkpoint })),
    })),
  };
}
