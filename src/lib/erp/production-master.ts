import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { parseList } from "./partner-shape";
import {
  RATES_KEY,
  STEPS_KEY,
  rateErrors,
  stepErrors,
  stepRuleErrors,
  type RateDraft,
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
      exit_mode: r.exit_mode,
      job_policy: r.job_policy,
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

type UnitInfo = { id: number; unit_label: string; status: string; processes: string[] };

async function unitsById(ids: number[]): Promise<Map<number, UnitInfo>> {
  const rows = await prisma.refUnit.findMany({
    where: { id: { in: ids } },
    select: { id: true, unit_label: true, status: true, processes: true },
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

/** A line has one routing, and there is one segment before the partai (P226). */
async function routingClash(lineId: number | null, routingId: number | null): Promise<string | null> {
  const other = await prisma.prdRouting.findFirst({
    where: { line_id: lineId, ...(routingId ? { id: { not: routingId } } : {}) },
    select: { routing_label: true },
  });
  if (!other) return null;
  return lineId ? `Line ini sudah punya routing ${other.routing_label}.` : `Segmen sebelum partai sudah ada: ${other.routing_label}.`;
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
      exit_mode: s.exit_mode!,
      job_policy: s.job_policy!,
      is_checkpoint: Boolean(s.is_checkpoint),
      is_skippable: Boolean(s.is_skippable),
    });
  }
  if (!problems.length) {
    const hasLine = Number(values.line_id) > 0;
    problems.push(...stepRuleErrors(clean.steps, hasLine, (id) => units.get(id)?.processes ?? []));
  }
  const errors: Record<string, string> = problems.length ? { [STEPS_KEY]: problems.join(" ") } : {};
  const clash = await routingClash(Number(values.line_id) || null, routingId);
  if (clash) errors.line_id = clash;
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
