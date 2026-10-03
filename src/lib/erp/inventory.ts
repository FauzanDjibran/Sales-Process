import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * The inventory module — today a **stand-in** (Sales-Process-Concept.md U11).
 *
 * A document that sends goods out asks this module to `issueStock`, exactly as
 * it will once real stock exists, and gets back what the goods cost. It never
 * learns that the answer comes from a stand-in: there is no stock check (stock
 * is always sufficient, P5), and every item is valued at the one Harga Pokok
 * the user keeps for it in *Harga Pokok (Sementara)*.
 *
 * Its tables are temporary and its own — `tmp_item_cost` (the Harga Pokok) and
 * `tmp_stock_movement` (one row per item per issue, as a stock card would show
 * it) — and nothing else names them. When inventory is built, `issueStock`
 * keeps its contract, the temporary tables are dropped, and the documents that
 * call it do not change.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** An issue refused by the inventory — today only an item without a Harga Pokok. */
export class InventoryRefusal extends Error {}

export type StockIssue = {
  itemId: number;
  warehouseId: number;
  /** In the item's base unit. */
  baseQty: number;
  date: Date;
  source: { docTypeId: number; docId: number; no: string };
  actorId: number;
};

/** Whole rupiah, half up — what a cost is booked at. */
const rupiah = (n: number) => Math.round(n);

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
  const unitCost = row.unit_cost.toNumber();
  const cost = rupiah(issue.baseQty * unitCost);
  await tx.tmpStockMovement.create({
    data: {
      item_id: issue.itemId,
      warehouse_id: issue.warehouseId,
      movement_date: issue.date,
      base_qty_out: issue.baseQty,
      unit_cost: unitCost,
      cost_amount: cost,
      source_doc_type_id: issue.source.docTypeId,
      source_doc_id: issue.source.docId,
      source_no: issue.source.no,
      created_by: issue.actorId,
    },
  });
  return { unitCost, cost };
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
  if (Math.round(value * 100) !== value * 100) return { ok: false, errors: { unit_cost: "Paling banyak 2 angka desimal." } };
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
