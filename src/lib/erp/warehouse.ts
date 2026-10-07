import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { parseList } from "./partner-shape";
import { LOCATIONS_KEY, locationErrors, type LocationDraft } from "./warehouse-shape";
import { locationStockUse, warehouseHoldsStock } from "./inventory";
import { receiptNoteLocationUse } from "./receipt-note";
import { deliveryNoteLocationUse } from "./delivery-note";

/**
 * A Gudang's own collection — its locations (`ref_warehouse_location`) — and
 * the rule on its Gunakan Lokasi switch.
 *
 * The locations are part of the Gudang: edited on its form's Lokasi tab, saved
 * with it in one transaction, and a change to them is the Gudang's own audit
 * entry, as an Item's unit conversions are (P38, P46). The generic master
 * action calls in here for the one entity that has them. What stock and
 * documents hold is asked of the modules that own them (§3.1).
 */

// -------------------------------------------------------------------- reads

/** A Gudang's locations in the shape the form edits them, with whether each is in use. */
export async function warehouseCollections(warehouseId: number): Promise<{ locations: LocationDraft[] }> {
  const rows = await prisma.refWarehouseLocation.findMany({
    where: { warehouse_id: warehouseId },
    orderBy: [{ location_label: "asc" }, { id: "asc" }],
  });
  const used = await usedLocations(warehouseId, rows.map((r) => r.id));
  return {
    locations: rows.map((r) => ({
      id: r.id,
      key: `l${r.id}`,
      code: r.location_code,
      label: r.location_label,
      name: r.location_name,
      status: r.status,
      used: used.moved.has(r.id),
    })),
  };
}

/**
 * Which locations stock has moved through or a note names (`moved`), which
 * hold stock now (`holding`), and how many Draft notes the warehouse has.
 */
async function usedLocations(warehouseId: number, ids: number[]) {
  const [stock, receipts, deliveries] = await Promise.all([
    locationStockUse(ids),
    receiptNoteLocationUse(warehouseId, ids),
    deliveryNoteLocationUse(warehouseId, ids),
  ]);
  return {
    moved: new Set([...stock.moved, ...receipts.named, ...deliveries.named]),
    holding: stock.holding,
    drafts: receipts.drafts + deliveries.drafts,
  };
}

// --------------------------------------------------------------- validation

export type WarehouseCollections = {
  locations: { id: number | null; label: string; name: string; status: "Active" | "Inactive" }[];
};

/**
 * Reads and checks a Gudang form's locations and its Gunakan Lokasi switch.
 *
 * - The switch changes only while the warehouse holds no stock and no Draft
 *   Receipt or Delivery Note names it: rows already in the books would
 *   otherwise break the rule one way or the other.
 * - Switched on, it needs at least one active location.
 * - A location stock has moved through, or a note names, is never removed —
 *   only deactivated — and one holding stock is not deactivated.
 * - Labels are unique within the warehouse; every dialog rule is applied again.
 */
export async function checkWarehouseCollections(
  values: Record<string, unknown>,
  warehouseId: number | null
): Promise<{ errors: Record<string, string>; clean: WarehouseCollections }> {
  const errors: Record<string, string> = {};
  const clean: WarehouseCollections = { locations: [] };
  const useLocation = values.use_location === true || values.use_location === "true";

  const list = parseList<Partial<LocationDraft>>(values[LOCATIONS_KEY]);
  if (list === null) {
    errors[LOCATIONS_KEY] = "Data lokasi tidak terbaca.";
    return { errors, clean };
  }

  const own = warehouseId
    ? await prisma.refWarehouseLocation.findMany({ where: { warehouse_id: warehouseId }, select: { id: true, location_label: true, status: true } })
    : [];
  const ownById = new Map(own.map((o) => [o.id, o]));
  const used = warehouseId ? await usedLocations(warehouseId, own.map((o) => o.id)) : { moved: new Set<number>(), holding: new Set<number>(), drafts: 0 };

  if (warehouseId) {
    const current = await prisma.refWarehouse.findUnique({ where: { id: warehouseId }, select: { use_location: true } });
    if (current && current.use_location !== useLocation) {
      if (await warehouseHoldsStock(warehouseId)) {
        errors.use_location = "Gudang ini masih menyimpan stok: Gunakan Lokasi hanya bisa diubah saat gudang kosong.";
      } else if (used.drafts > 0) {
        errors.use_location = `Masih ada ${used.drafts} Receipt / Delivery Note Draft di gudang ini: selesaikan atau batalkan dulu.`;
      }
    }
  }

  const problems: string[] = [];
  const labels: string[] = [];
  const kept = new Set<number>();
  for (const [i, l] of list.entries()) {
    const n = i + 1;
    const rowErrors = locationErrors(l, labels);
    if (Object.keys(rowErrors).length) {
      problems.push(`Lokasi ${n}: ${Object.values(rowErrors)[0]}`);
      continue;
    }
    const label = String(l.label).trim();
    labels.push(label);
    const status = l.status === "Inactive" ? "Inactive" : "Active";
    let id: number | null = null;
    if (l.id != null && l.id !== ("" as unknown)) {
      const asNumber = Number(l.id);
      const mine = ownById.get(asNumber);
      if (!mine) {
        problems.push(`Lokasi ${n}: bukan lokasi milik gudang ini.`);
        continue;
      }
      if (status === "Inactive" && mine.status === "Active" && used.holding.has(asNumber)) {
        problems.push(`Lokasi ${label} masih menyimpan stok: kosongkan dulu sebelum dinonaktifkan.`);
        continue;
      }
      id = asNumber;
      kept.add(asNumber);
    }
    clean.locations.push({ id, label, name: String(l.name).trim(), status });
  }
  for (const o of own) {
    if (!kept.has(o.id) && used.moved.has(o.id)) {
      problems.push(`Lokasi ${o.location_label} sudah dipakai stok atau dokumen: nonaktifkan, jangan dihapus.`);
    }
  }
  if (useLocation && !clean.locations.some((l) => l.status === "Active")) {
    problems.push("Gudang dengan Gunakan Lokasi butuh minimal satu lokasi aktif.");
  }
  if (problems.length) errors[LOCATIONS_KEY] = problems.join(" ");

  return { errors, clean };
}

// ------------------------------------------------------------------- writes

/**
 * Makes the Gudang's locations exactly what was submitted: updates the rows
 * it kept, adds the new ones with the next `loc.NNNN` code, removes the ones
 * taken out (only an unused one reaches here).
 */
export async function writeWarehouseCollections(
  tx: Prisma.TransactionClient,
  warehouseId: number,
  clean: WarehouseCollections,
  actorId: number
): Promise<void> {
  const keep = clean.locations.flatMap((l) => (l.id ? [l.id] : []));
  await tx.refWarehouseLocation.deleteMany({ where: { warehouse_id: warehouseId, id: { notIn: keep } } });

  // Labels may swap between kept rows; park them first so the unique key never collides half-way.
  for (const id of keep) {
    await tx.refWarehouseLocation.update({ where: { id }, data: { location_label: `~${id}` } });
  }
  let next = await nextLocationNumber(tx);
  for (const l of clean.locations) {
    const data = { location_label: l.label, location_name: l.name, status: l.status };
    if (l.id) {
      await tx.refWarehouseLocation.update({ where: { id: l.id }, data: { ...data, updated_by: actorId } });
    } else {
      const location_code = `loc.${String(next++).padStart(4, "0")}`;
      await tx.refWarehouseLocation.create({ data: { ...data, location_code, warehouse_id: warehouseId, created_by: actorId } });
    }
  }
}

/** The next `loc.NNNN` number, over every warehouse — codes are unique system-wide. */
async function nextLocationNumber(tx: Prisma.TransactionClient): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ref_warehouse_location'))`;
  const rows = await tx.refWarehouseLocation.findMany({ select: { location_code: true } });
  const max = rows.reduce((m, r) => Math.max(m, Number(/^loc\.(\d+)$/.exec(r.location_code)?.[1] ?? 0)), 0);
  return max + 1;
}
