import "server-only";

import { prisma } from "@/lib/prisma";
import { locationStockUse, warehouseHoldsStock } from "./inventory";
import { receiptNoteLocationUse } from "./receipt-note";
import { deliveryNoteLocationUse } from "./delivery-note";
import { stockIssueLocationUse } from "./stock-issue";
import { locationDisplayLabel } from "./warehouse-location";

/**
 * Lokasi Gudang (`ref_warehouse_location`), its own master (P267): a place
 * inside one warehouse, one level deep. A warehouse uses locations when it has
 * any — there is no switch — so the rules here keep a warehouse's stock from
 * ever being mixed with and without a location. What stock and documents hold
 * is asked of the modules that own them (§3.1).
 */

const LABEL_MAX = 40;

// --------------------------------------------------------------- validation

/**
 * The location master's own rules, beyond what the registry checks (required,
 * unique label within its warehouse, the warehouse locked once saved):
 *
 * - The label has no spaces, so `<gudang>-<lokasi>` reads as one code.
 * - The first location of a warehouse is added only while the warehouse holds
 *   no stock and no Draft Receipt Note, Delivery Note or BSTB Issue names it:
 *   rows already there have no location and would be mixed with new ones.
 * - A location holding stock is not deactivated.
 */
export async function checkWarehouseLocation(values: Record<string, unknown>, currentId: number | null): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  const label = String(values.location_label ?? "").trim();
  if (label.length > LABEL_MAX) errors.location_label = `Label paling panjang ${LABEL_MAX} karakter.`;
  else if (/\s/.test(label)) errors.location_label = "Label tanpa spasi, mis. A-01-03.";

  const warehouseId = Number(values.warehouse_id) || null;
  if (!currentId && warehouseId) {
    const warehouse = await prisma.refWarehouse.findUnique({
      where: { id: warehouseId },
      select: { status: true, _count: { select: { locations: true } } },
    });
    if (!warehouse || warehouse.status !== "Active") errors.warehouse_id = "Pilih gudang yang aktif.";
    else if (!warehouse._count.locations) {
      const drafts = await draftsInWarehouse(warehouseId);
      if (await warehouseHoldsStock(warehouseId)) {
        errors.warehouse_id = "Gudang ini masih menyimpan stok tanpa lokasi: lokasi pertama hanya bisa ditambahkan saat gudang kosong.";
      } else if (drafts > 0) {
        errors.warehouse_id = `Masih ada ${drafts} Receipt Note, Delivery Note atau BSTB Issue Draft di gudang ini: selesaikan atau batalkan dulu.`;
      }
    }
  }
  if (currentId && values.status === "Inactive") {
    const refusal = await locationDeactivateRefusal(currentId);
    if (refusal) errors.status = refusal;
  }
  return errors;
}

/** Why a location cannot be deactivated now, or null. */
export async function locationDeactivateRefusal(id: number): Promise<string | null> {
  const { holding } = await locationStockUse([id]);
  return holding.has(id) ? "Lokasi ini masih menyimpan stok: kosongkan dulu sebelum dinonaktifkan." : null;
}

async function draftsInWarehouse(warehouseId: number): Promise<number> {
  const [receipts, deliveries, issues] = await Promise.all([
    receiptNoteLocationUse(warehouseId, []),
    deliveryNoteLocationUse(warehouseId, []),
    stockIssueLocationUse(warehouseId, []),
  ]);
  return receipts.drafts + deliveries.drafts + issues.drafts;
}

// -------------------------------------------------------------------- reads

/** A Gudang's locations, for the related-records card on its page. */
export async function locationsOfWarehouse(warehouseId: number) {
  const rows = await prisma.refWarehouseLocation.findMany({
    where: { warehouse_id: warehouseId },
    orderBy: [{ location_label: "asc" }, { id: "asc" }],
    include: { warehouse: { select: { warehouse_label: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    label: locationDisplayLabel(r.warehouse.warehouse_label, r.location_label),
    name: r.status === "Active" ? r.location_name : `${r.location_name} (Non Aktif)`,
  }));
}

export type LocationTreeWarehouse = {
  id: number;
  label: string;
  name: string;
  active: boolean;
  locations: { id: number; code: string; label: string; path: string; name: string; active: boolean }[];
};

/** Every warehouse with its locations, for the Lokasi Gudang tree (one level). */
export async function locationTree(): Promise<LocationTreeWarehouse[]> {
  const rows = await prisma.refWarehouse.findMany({
    orderBy: { warehouse_label: "asc" },
    include: { locations: { orderBy: [{ location_label: "asc" }, { id: "asc" }] } },
  });
  return rows.map((w) => ({
    id: w.id,
    label: w.warehouse_label,
    name: w.warehouse_name,
    active: w.status === "Active",
    locations: w.locations.map((l) => ({
      id: l.id,
      code: l.location_code,
      label: l.location_label,
      path: locationDisplayLabel(w.warehouse_label, l.location_label),
      name: l.location_name,
      active: l.status === "Active",
    })),
  }));
}
