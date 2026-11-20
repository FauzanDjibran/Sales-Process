import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { actorCan, type Actor } from "./access";
import { AccessDeniedError } from "./auth-errors";

/**
 * Which warehouses a user may work in (P300 OD-9, `Stock-Transfer-Plan.md`),
 * on the pattern of `production-access.ts` (P260). A permission says *what*
 * someone may do; this says *where*. `INVENTORY_WAREHOUSE_ALL` (supervisor,
 * administrator) needs no assignment; anyone else works only in the warehouses
 * assigned on the User form.
 *
 * Applied to the transfer documents first: Kirim needs the origin, Terima the
 * destination, and their registers show what leaves or reaches the user's
 * warehouses, filtered in the database. The other warehouse documents take the
 * same rule in a later step.
 */

/** The warehouses the actor may work in, or `null` for every warehouse. */
export const warehouseIdsOf = cache(async (actor: Actor): Promise<number[] | null> => {
  if (actorCan(actor, "INVENTORY_WAREHOUSE_ALL")) return null;
  const rows = await prisma.logUserWarehouse.findMany({
    where: { user_id: actor.user.id },
    select: { warehouse_id: true },
  });
  return rows.map((r) => r.warehouse_id);
});

/** True when the ids allow the warehouse — `null` allows every one. */
export const warehouseAllowed = (ids: number[] | null, warehouseId: number | null | undefined) =>
  ids === null || (warehouseId != null && ids.includes(warehouseId));

/** For a page: no warehouse of the actor's among those given answers 403. */
export async function requireWarehouse(actor: Actor, ...warehouseIds: (number | null | undefined)[]): Promise<void> {
  const ids = await warehouseIdsOf(actor);
  if (warehouseIds.some((w) => warehouseAllowed(ids, w))) return;
  // Loaded here, not at the top: next/navigation does not load outside Next (the tests import this module).
  const { forbidden } = await import("next/navigation");
  forbidden();
}

/** For a Server Action: refused like any other missing permission. */
export async function assertWarehouse(actor: Actor, warehouseId: number | null | undefined): Promise<void> {
  if (!warehouseAllowed(await warehouseIdsOf(actor), warehouseId)) throw new AccessDeniedError("UNAUTHORIZED");
}

// ---------------------------------------------------------------- assignment

export type AssignableWarehouse = { id: number; label: string; name: string; active: boolean };

/** Every warehouse, for the User form's Gudang tab: active first, by label. */
export async function assignableWarehouses(): Promise<AssignableWarehouse[]> {
  const rows = await prisma.refWarehouse.findMany({ orderBy: [{ status: "asc" }, { warehouse_label: "asc" }] });
  return rows.map((w) => ({ id: w.id, label: w.warehouse_label, name: w.warehouse_name, active: w.status === "Active" }));
}

export async function warehouseIdsOfUser(userId: number): Promise<number[]> {
  const rows = await prisma.logUserWarehouse.findMany({ where: { user_id: userId }, select: { warehouse_id: true }, orderBy: { warehouse_id: "asc" } });
  return rows.map((r) => r.warehouse_id);
}

export type WarehouseAssignResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * Sets the warehouses a user may work in. Granting a warehouse is granting
 * access, so it takes the same permission as granting a role, and nobody
 * changes their own.
 */
export async function setUserWarehouses(actor: Actor, userId: number, warehouseIds: number[]): Promise<WarehouseAssignResult> {
  if (!actorCan(actor, "USER_ROLE_ASSIGN")) throw new AccessDeniedError("UNAUTHORIZED");
  if (userId === actor.user.id) {
    return { ok: false, errors: { _form: "Anda tidak dapat mengubah Gudang akun Anda sendiri. Minta administrator lain melakukannya." } };
  }
  const user = await prisma.sysUser.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return { ok: false, errors: { _form: "User tidak ditemukan." } };

  const wanted = [...new Set(warehouseIds.filter((n) => Number.isInteger(n) && n > 0))];
  const known = await prisma.refWarehouse.count({ where: { id: { in: wanted } } });
  if (known !== wanted.length) return { ok: false, errors: { warehouseIds: "Gudang tidak dikenal." } };

  const current = await warehouseIdsOfUser(userId);
  const add = wanted.filter((w) => !current.includes(w));
  const remove = current.filter((w) => !wanted.includes(w));
  if (!add.length && !remove.length) return { ok: true };

  await prisma.$transaction([
    prisma.logUserWarehouse.deleteMany({ where: { user_id: userId, warehouse_id: { in: remove } } }),
    prisma.logUserWarehouse.createMany({ data: add.map((warehouse_id) => ({ user_id: userId, warehouse_id, created_by: actor.user.id })) }),
    prisma.auditLog.create({ data: { entity_key: "sys_user", row_id: userId, action: "UPDATE", event: "warehouses", by: actor.user.id } }),
  ]);
  return { ok: true };
}
