import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { actorCan, type Actor } from "./access";
import { AccessDeniedError } from "./auth-errors";

/**
 * Which Units a user may open in the Produksi application (P260,
 * `production_app_plan.md` §6.1). A permission says *what* someone may do; this
 * says *where*. One role, Admin Unit, serves every Unit, and the Units are
 * assigned per user on the User form. `PRODUCTION_UNIT_ALL` (supervisor, PPIC,
 * administrator) needs no assignment.
 *
 * Read only by production code, not loaded with every session: an ERP page never
 * pays for it. Every page and action that names a Unit asks here, so changing a
 * URL or a document id does not reach another Unit's goods.
 */

/** The Units the actor may open, or `null` for every Unit. */
export const unitIdsOf = cache(async (actor: Actor): Promise<number[] | null> => {
  if (actorCan(actor, "PRODUCTION_UNIT_ALL")) return null;
  const rows = await prisma.prdUserUnit.findMany({
    where: { user_id: actor.user.id },
    select: { unit_id: true },
  });
  return rows.map((r) => r.unit_id);
});

const allowed = (ids: number[] | null, unitId: number | null | undefined) =>
  ids === null || (unitId != null && ids.includes(unitId));

/** For a page: anything but the actor's own Units answers 403. */
export async function requireUnit(actor: Actor, unitId: number | null | undefined): Promise<void> {
  if (allowed(await unitIdsOf(actor), unitId)) return;
  // Loaded here, not at the top: next/navigation does not load outside Next (the tests import this module).
  const { forbidden } = await import("next/navigation");
  forbidden();
}

/** For a Server Action: refused like any other missing permission. */
export async function assertUnit(actor: Actor, unitId: number | null | undefined): Promise<void> {
  if (!allowed(await unitIdsOf(actor), unitId)) throw new AccessDeniedError("UNAUTHORIZED");
}

/**
 * A form's options narrowed to the actor's Units: its `units` list, and every
 * list whose rows carry a `unitId` (the goods held there). The server refuses
 * the rest anyway; this keeps them off the screen.
 */
export async function narrowToUnits<T extends { units: { id: number }[] }>(actor: Actor, options: T): Promise<T> {
  const ids = await unitIdsOf(actor);
  if (ids === null) return options;
  const out: Record<string, unknown> = { ...options };
  for (const [key, value] of Object.entries(options) as [string, unknown][]) {
    if (!Array.isArray(value)) continue;
    const rows = value as Record<string, unknown>[];
    if (key === "units") out[key] = rows.filter((u) => ids.includes(Number(u.id)));
    else if (rows.some((r) => r && typeof r === "object" && "unitId" in r)) out[key] = rows.filter((r) => ids.includes(Number(r.unitId)));
  }
  return out as T;
}

// ---------------------------------------------------------------- assignment

export type AssignableUnit = { id: number; label: string; name: string; workstation: string | null; active: boolean };

/** Every Unit, for the User form's Unit tab: active first, by code. */
export async function assignableUnits(): Promise<AssignableUnit[]> {
  const units = await prisma.refUnit.findMany({
    orderBy: [{ status: "asc" }, { unit_code: "asc" }],
    include: { workstation: true },
  });
  return units.map((u) => ({
    id: u.id,
    label: u.unit_label,
    name: u.unit_name,
    workstation: u.workstation?.workstation_name ?? null,
    active: u.status === "Active",
  }));
}

export async function unitIdsOfUser(userId: number): Promise<number[]> {
  const rows = await prisma.prdUserUnit.findMany({ where: { user_id: userId }, select: { unit_id: true }, orderBy: { unit_id: "asc" } });
  return rows.map((r) => r.unit_id);
}

export type UnitAssignResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * Sets the Units a user may open. Granting a Unit is granting access, so it
 * takes the same permission as granting a role, and nobody changes their own.
 */
export async function setUserUnits(actor: Actor, userId: number, unitIds: number[]): Promise<UnitAssignResult> {
  if (!actorCan(actor, "USER_ROLE_ASSIGN")) throw new AccessDeniedError("UNAUTHORIZED");
  if (userId === actor.user.id) {
    return { ok: false, errors: { _form: "Anda tidak dapat mengubah Unit akun Anda sendiri. Minta administrator lain melakukannya." } };
  }
  const user = await prisma.sysUser.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { ok: false, errors: { _form: "User tidak ditemukan." } };

  const wanted = [...new Set(unitIds.filter((n) => Number.isInteger(n) && n > 0))];
  const known = await prisma.refUnit.count({ where: { id: { in: wanted } } });
  if (known !== wanted.length) return { ok: false, errors: { unitIds: "Unit tidak dikenal." } };

  const current = await unitIdsOfUser(userId);
  const add = wanted.filter((u) => !current.includes(u));
  const remove = current.filter((u) => !wanted.includes(u));
  if (!add.length && !remove.length) return { ok: true };

  await prisma.$transaction([
    prisma.prdUserUnit.deleteMany({ where: { user_id: userId, unit_id: { in: remove } } }),
    prisma.prdUserUnit.createMany({ data: add.map((unit_id) => ({ user_id: userId, unit_id, created_by: actor.user.id })) }),
    prisma.auditLog.create({ data: { entity_key: "sys_user", row_id: userId, action: "UPDATE", event: "units", by: actor.user.id } }),
  ]);
  return { ok: true };
}
