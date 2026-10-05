import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";

/**
 * The inventory module — today a **stand-in** (Sales-Process-Concept.md U11).
 *
 * A document that sends goods out asks this module to `issueStock`, exactly as
 * it will once real stock exists, and gets back what the goods cost. It never
 * learns that the answer comes from a stand-in: there is no stock check (stock
 * is always sufficient, P5), and every item is valued at the one Harga Pokok
 * the user keeps for it in *Harga Pokok (Sementara)*.
 *
 * Its tables are temporary and its own — `tmp_item_cost` (the Harga Pokok),
 * `tmp_stock_lot` (the lots a picker chooses from, U15) and `tmp_stock_movement`
 * (one row per issue, as a stock card would show it) — and nothing else names
 * them. An item with Kelola Stok is **lot-tracked**: it leaves from a named lot. When inventory is built, `issueStock`
 * keeps its contract, the temporary tables are dropped, and the documents that
 * call it do not change.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** An issue refused by the inventory — today only an item without a Harga Pokok. */
export class InventoryRefusal extends Error {}

export type StockIssue = {
  itemId: number;
  warehouseId: number;
  /** The lot it leaves from — required for a lot-tracked item, refused for any other. */
  lotId?: number | null;
  /** In the item's base unit. */
  baseQty: number;
  date: Date;
  source: { docTypeId: number; docId: number; no: string };
  actorId: number;
};

/**
 * The unit cost each item would be issued at now, or null for an item that
 * cannot be issued. Lets a document show the journal it will write before it
 * posts; `issueStock` decides again inside the posting.
 */
export async function issueValuation(itemIds: number[], db: Db = prisma): Promise<Map<number, number | null>> {
  const rows = itemIds.length
    ? await db.tmpItemCost.findMany({ where: { item_id: { in: itemIds } }, select: { item_id: true, unit_cost: true } })
    : [];
  const byItem = new Map(rows.map((r) => [r.item_id, r.unit_cost.toNumber()]));
  return new Map(itemIds.map((id) => [id, byItem.has(id) ? byItem.get(id)! : null]));
}

/**
 * Takes goods out of a warehouse and says what they cost. Called inside the
 * issuing document's posting transaction, so a refusal rolls the posting back.
 */
export async function issueStock(tx: Prisma.TransactionClient, issue: StockIssue): Promise<{ unitCost: number; cost: number }> {
  if (!(issue.baseQty > 0)) throw new InventoryRefusal("Jumlah yang dikeluarkan harus lebih dari 0.");
  const row = await tx.tmpItemCost.findUnique({
    where: { item_id: issue.itemId },
    select: { unit_cost: true, item: { select: { item_label: true } } },
  });
  if (!row) {
    const item = await tx.mItem.findUnique({ where: { id: issue.itemId }, select: { item_label: true } });
    throw new InventoryRefusal(`${item?.item_label ?? "Barang"} belum punya Harga Pokok. Isi di Master › Harga Pokok (Sementara).`);
  }
  const tracked = (await lotTrackedItems([issue.itemId], tx)).has(issue.itemId);
  let lot: { id: number; lot_no: string } | null = null;
  if (tracked) {
    if (!issue.lotId) throw new InventoryRefusal(`${row.item.item_label} dikelola per lot: pilih lotnya.`);
    lot = await tx.tmpStockLot.findFirst({
      where: { id: issue.lotId, item_id: issue.itemId, warehouse_id: issue.warehouseId, status: "Active" },
      select: { id: true, lot_no: true },
    });
    if (!lot) throw new InventoryRefusal(`Lot ${row.item.item_label} tidak ada atau nonaktif di gudang ini.`);
  } else if (issue.lotId) {
    throw new InventoryRefusal(`${row.item.item_label} tidak dikelola per lot.`);
  }
  // In exact decimals, rounded once to whole rupiah (P114): a Harga Pokok per
  // gram times thousands of grams must not pick up binary-float error.
  const unitCost = row.unit_cost.toNumber();
  const cost = new Prisma.Decimal(issue.baseQty).mul(row.unit_cost).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  await tx.tmpStockMovement.create({
    data: {
      ...(await ledgerPosition(tx, issue.date, issue.source.docTypeId, issue.source.docId)),
      item_id: issue.itemId,
      warehouse_id: issue.warehouseId,
      movement_date: issue.date,
      base_qty_out: issue.baseQty,
      unit_cost: unitCost,
      cost_amount: cost,
      source_doc_type_id: issue.source.docTypeId,
      source_doc_id: issue.source.docId,
      source_no: issue.source.no,
      lot_id: lot?.id ?? null,
      lot_no: lot?.lot_no ?? null,
      created_by: issue.actorId,
    },
  });
  return { unitCost, cost };
}

/**
 * The ledger number and line a movement takes (P110): `MS/2026/10/0001`, one
 * per posting — the lots and lines one document issues share it, a line each;
 * the first takes the next number in the series of its month, read from
 * line-1 rows, whose id order is their number order.
 */
async function ledgerPosition(
  tx: Prisma.TransactionClient,
  date: Date,
  docTypeId: number,
  docId: number
): Promise<{ ledger_no: string; line_no: number }> {
  const last = await tx.tmpStockMovement.findFirst({
    where: { source_doc_type_id: docTypeId, source_doc_id: docId },
    orderBy: { line_no: "desc" },
    select: { ledger_no: true, line_no: true },
  });
  if (last) return { ledger_no: last.ledger_no, line_no: last.line_no + 1 };
  const ledger_no = await nextDocumentNumber("MS", date, async (series) => {
    const row = await tx.tmpStockMovement.findFirst({
      where: { ledger_no: { startsWith: series }, line_no: 1 },
      orderBy: { id: "desc" },
      select: { ledger_no: true },
    });
    return row?.ledger_no ?? null;
  });
  return { ledger_no, line_no: 1 };
}

// ------------------------------------------------------------------- lots

/** The items that leave by lot: Barang with Kelola Stok (U15). */
export async function lotTrackedItems(itemIds: number[], db: Db = prisma): Promise<Set<number>> {
  if (!itemIds.length) return new Set();
  const rows = await db.mItem.findMany({
    where: { id: { in: itemIds }, item_type: "Barang", track_stock: true },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

export type LotOption = { id: number; lotNo: string; expiry: string | null; active: boolean };

/**
 * The lots a picker may choose for each item, per warehouse, earliest expiry
 * first (FEFO), a lot without expiry last. `withIds` also brings in lots a
 * stored document already names, whatever their status, so it keeps reading.
 */
export async function lotOptions(
  itemIds: number[],
  warehouseIds: number[],
  db: Db = prisma,
  withIds: number[] = []
): Promise<Map<number, Map<number, LotOption[]>>> {
  const out = new Map<number, Map<number, LotOption[]>>();
  if (!itemIds.length || !warehouseIds.length) return out;
  const rows = await db.tmpStockLot.findMany({
    where: {
      item_id: { in: itemIds },
      warehouse_id: { in: warehouseIds },
      OR: [{ status: "Active" }, ...(withIds.length ? [{ id: { in: withIds } }] : [])],
    },
    orderBy: [{ expiry_date: { sort: "asc", nulls: "last" } }, { lot_no: "asc" }],
  });
  for (const r of rows) {
    const byItem = out.get(r.warehouse_id) ?? new Map<number, LotOption[]>();
    const list = byItem.get(r.item_id) ?? [];
    list.push({ id: r.id, lotNo: r.lot_no, expiry: r.expiry_date ? r.expiry_date.toISOString().slice(0, 10) : null, active: r.status === "Active" });
    byItem.set(r.item_id, list);
    out.set(r.warehouse_id, byItem);
  }
  return out;
}

// --------------------------------------------------------- Lot (Sementara)

export type StockLotRow = {
  id: number;
  itemId: number;
  itemLabel: string;
  itemName: string;
  hasExpiry: boolean;
  warehouseId: number;
  warehouseLabel: string;
  warehouseName: string;
  lotNo: string;
  expiry: string | null;
  active: boolean;
};

export async function listStockLots(): Promise<StockLotRow[]> {
  const rows = await prisma.tmpStockLot.findMany({
    include: { item: true, warehouse: true },
    orderBy: [{ item: { item_label: "asc" } }, { expiry_date: { sort: "asc", nulls: "last" } }, { lot_no: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    itemLabel: r.item.item_label,
    itemName: r.item.item_name,
    hasExpiry: r.item.has_expiry,
    warehouseId: r.warehouse_id,
    warehouseLabel: r.warehouse.warehouse_label,
    warehouseName: r.warehouse.warehouse_name,
    lotNo: r.lot_no,
    expiry: r.expiry_date ? r.expiry_date.toISOString().slice(0, 10) : null,
    active: r.status === "Active",
  }));
}

/** What the lot form offers: lot-tracked items and active warehouses. */
export async function stockLotFormOptions(): Promise<{
  items: { id: number; label: string; name: string; hasExpiry: boolean }[];
  warehouses: { id: number; label: string; name: string }[];
}> {
  const [items, warehouses] = await Promise.all([
    prisma.mItem.findMany({ where: { item_type: "Barang", track_stock: true, status: "Active" }, orderBy: { item_label: "asc" } }),
    prisma.refWarehouse.findMany({ where: { status: "Active" }, orderBy: { warehouse_label: "asc" } }),
  ]);
  return {
    items: items.map((i) => ({ id: i.id, label: i.item_label, name: i.item_name, hasExpiry: i.has_expiry })),
    warehouses: warehouses.map((w) => ({ id: w.id, label: w.warehouse_label, name: w.warehouse_name })),
  };
}

export type StockLotInput = { item_id: number | null; warehouse_id: number | null; lot_no: string; expiry_date: string };

/** Registers one lot of a lot-tracked item in a warehouse; an item with Memiliki Kadaluarsa needs its expiry. */
export async function createStockLot(input: StockLotInput, actorId: number): Promise<ItemCostResult> {
  const errors: Record<string, string> = {};
  const itemId = Number(input.item_id) || null;
  const warehouseId = Number(input.warehouse_id) || null;
  const lotNo = String(input.lot_no ?? "").trim().toUpperCase();
  const expiry = String(input.expiry_date ?? "").trim();
  const item = itemId ? await prisma.mItem.findUnique({ where: { id: itemId } }) : null;
  if (!itemId) errors.item_id = "Pilih barang.";
  else if (!item || item.item_type !== "Barang" || !item.track_stock) errors.item_id = "Hanya barang dengan Kelola Stok yang punya lot.";
  if (!warehouseId) errors.warehouse_id = "Pilih gudang.";
  if (!lotNo) errors.lot_no = "No. Lot wajib diisi.";
  if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) errors.expiry_date = "Tanggal tidak valid.";
  else if (!expiry && item?.has_expiry) errors.expiry_date = "Barang ini memiliki kadaluarsa: isi tanggalnya.";
  if (!errors.lot_no && itemId && warehouseId) {
    const dup = await prisma.tmpStockLot.findFirst({ where: { item_id: itemId, warehouse_id: warehouseId, lot_no: lotNo } });
    if (dup) errors.lot_no = "Lot ini sudah ada untuk barang dan gudang tersebut.";
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  await prisma.$transaction(async (tx) => {
    const row = await tx.tmpStockLot.create({
      data: {
        item_id: itemId!,
        warehouse_id: warehouseId!,
        lot_no: lotNo,
        expiry_date: expiry ? new Date(`${expiry}T00:00:00Z`) : null,
        created_by: actorId,
      },
    });
    await tx.auditLog.create({ data: { entity_key: "tmp_stock_lot", row_id: row.id, action: "TAMBAH", event: "create", by: actorId } });
  });
  return { ok: true };
}

/** Deactivates or reactivates a lot; an inactive lot is no longer offered to a picker. */
export async function setStockLotActive(id: number, active: boolean, actorId: number): Promise<ItemCostResult> {
  const done = await prisma.tmpStockLot.updateMany({ where: { id }, data: { status: active ? "Active" : "Inactive", updated_by: actorId } });
  if (done.count !== 1) return { ok: false, errors: { _form: "Lot tidak ditemukan." } };
  await prisma.auditLog.create({ data: { entity_key: "tmp_stock_lot", row_id: id, action: "UPDATE", event: active ? "activate" : "deactivate", by: actorId } });
  return { ok: true };
}

// ------------------------------------------------- Harga Pokok (Sementara)

export type ItemCostRow = {
  itemId: number;
  itemLabel: string;
  itemName: string;
  categoryName: string;
  baseUomLabel: string;
  active: boolean;
  unitCost: number | null;
  updatedAt: string | null;
};

/** Every Barang, with its Harga Pokok or none. */
export async function listItemCosts(): Promise<ItemCostRow[]> {
  const items = await prisma.mItem.findMany({
    where: { item_type: "Barang" },
    orderBy: { item_label: "asc" },
    include: { base_uom: true, category: true, tmp_cost: true },
  });
  return items.map((i) => ({
    itemId: i.id,
    itemLabel: i.item_label,
    itemName: i.item_name,
    categoryName: i.category.category_name,
    baseUomLabel: i.base_uom.uom_label,
    active: i.status === "Active",
    unitCost: i.tmp_cost ? i.tmp_cost.unit_cost.toNumber() : null,
    updatedAt: i.tmp_cost ? i.tmp_cost.updated_at.toISOString() : null,
  }));
}

export type ItemCostResult = { ok: true } | { ok: false; errors: Record<string, string> };

/** Sets one item's Harga Pokok. Only later issues use it; what was issued keeps its cost. */
export async function setItemCost(itemId: number, raw: number | string, actorId: number): Promise<ItemCostResult> {
  const value = Number(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(value) || !(value > 0)) return { ok: false, errors: { unit_cost: "Isi Harga Pokok lebih dari 0." } };
  if (!/^\d+(\.\d{1,6})?$/.test(String(raw).trim().replace(",", "."))) return { ok: false, errors: { unit_cost: "Paling banyak 6 angka desimal." } };
  const item = await prisma.mItem.findUnique({ where: { id: itemId }, select: { item_type: true } });
  if (!item) return { ok: false, errors: { _form: "Barang tidak ditemukan." } };
  if (item.item_type !== "Barang") return { ok: false, errors: { _form: "Harga Pokok hanya untuk barang." } };
  await prisma.$transaction(async (tx) => {
    const existing = await tx.tmpItemCost.findUnique({ where: { item_id: itemId }, select: { id: true } });
    const row = existing
      ? await tx.tmpItemCost.update({ where: { item_id: itemId }, data: { unit_cost: value, updated_by: actorId } })
      : await tx.tmpItemCost.create({ data: { item_id: itemId, unit_cost: value, created_by: actorId } });
    await tx.auditLog.create({
      data: { entity_key: "tmp_item_cost", row_id: row.id, action: existing ? "UPDATE" : "TAMBAH", event: existing ? "update" : "create", by: actorId },
    });
  });
  return { ok: true };
}
