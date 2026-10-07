import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { PeriodRange } from "./period";
import type { RefOption } from "./records";

/**
 * The inventory reports (P120): Kartu Stok, Saldo Stok, Kartu Nilai Persediaan
 * and Nilai Persediaan. Read-only, and read from the ledgers — never from the
 * balance tables — so a past date is reported as it stood. Each also says
 * whether the balance tables still equal their ledgers.
 *
 * The books are written only by `inventory.ts`; this module only reads them.
 */

const D = Prisma.Decimal;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | null | undefined) => (d ? d.toNumber() : 0);

// ----------------------------------------------------------------- options

/** Items with Kelola Stok — the only ones in the books. Inactive ones stay reportable, marked. */
export async function stockItemOptions(): Promise<RefOption[]> {
  const rows = await prisma.mItem.findMany({
    where: { item_type: "Barang", track_stock: true },
    orderBy: { item_label: "asc" },
    select: { id: true, item_label: true, item_name: true, status: true },
  });
  return rows.map((r) => ({ id: r.id, label: r.item_label, name: r.item_name + (r.status === "Active" ? "" : " · non-aktif"), active: true }));
}

export async function stockWarehouseOptions(): Promise<RefOption[]> {
  const rows = await prisma.refWarehouse.findMany({
    orderBy: { warehouse_label: "asc" },
    select: { id: true, warehouse_label: true, warehouse_name: true, status: true },
  });
  return rows.map((r) => ({ id: r.id, label: r.warehouse_label, name: r.warehouse_name + (r.status === "Active" ? "" : " · non-aktif"), active: true }));
}

type ItemHead = { id: number; label: string; name: string; uomLabel: string };

async function itemHead(itemId: number): Promise<ItemHead | null> {
  const i = await prisma.mItem.findUnique({ where: { id: itemId }, include: { base_uom: true } });
  return i ? { id: i.id, label: i.item_label, name: i.item_name, uomLabel: i.base_uom.uom_label } : null;
}

export type StockSourceRef = { table: string; id: number; no: string; docName: string };

// ------------------------------------------------- the item × warehouse card

/**
 * Both reports answer two questions — *where is this item?* and *what does
 * this warehouse hold?* — which are the same data grouped the other way round
 * (SAP's MMBE / MB52, Odoo's group-by). So the server answers in **cards**, one
 * item in one warehouse, and the page nests them per item or per warehouse.
 * Quantities of different items never add up, so nothing here totals across
 * items.
 */
export type StockGroupBy = "item" | "warehouse";

export type StockItemRef = ItemHead;
export type StockWarehouseRef = { id: number; label: string; name: string };

type Filter = { itemIds: number[]; warehouseIds: number[] };

const filterWhere = ({ itemIds, warehouseIds }: Filter) => ({
  ...(itemIds.length ? { item_id: { in: itemIds } } : {}),
  ...(warehouseIds.length ? { warehouse_id: { in: warehouseIds } } : {}),
});

const cardKey = (itemId: number, warehouseId: number) => `${itemId}:${warehouseId}`;

async function cardSubjects(itemIds: number[], warehouseIds: number[]) {
  const [items, warehouses] = await Promise.all([
    prisma.mItem.findMany({ where: { id: { in: itemIds } }, include: { base_uom: true } }),
    prisma.refWarehouse.findMany({ where: { id: { in: warehouseIds } } }),
  ]);
  return {
    item: new Map<number, StockItemRef>(items.map((i) => [i.id, { id: i.id, label: i.item_label, name: i.item_name, uomLabel: i.base_uom.uom_label }])),
    warehouse: new Map<number, StockWarehouseRef>(warehouses.map((w) => [w.id, { id: w.id, label: w.warehouse_label, name: w.warehouse_name }])),
  };
}

const byCard = <T extends { item: StockItemRef; warehouse: StockWarehouseRef }>(a: T, b: T) =>
  a.item.label.localeCompare(b.item.label) || a.warehouse.label.localeCompare(b.warehouse.label);

// ---------------------------------------------------------- Kartu Stok

export type StockLedgerEntry = {
  id: number;
  date: string;
  ledgerNo: string;
  lineNo: number;
  source: StockSourceRef;
  lotNo: string;
  expiry: string | null;
  statusName: string;
  qtyIn: number;
  qtyOut: number;
  /** The card's balance after this row, read by date then posting order. */
  balance: number;
};

/**
 * One item in one warehouse over a period. Its running balance is the card's
 * own — what a warehouse keeper can count — worked out here: the ledger stores
 * a balance only per bucket (warehouse, lot, status).
 */
export type StockCard = {
  item: StockItemRef;
  warehouse: StockWarehouseRef;
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  entries: StockLedgerEntry[];
};

/**
 * Every quantity movement of the chosen items in the chosen warehouses (none
 * chosen = all) over a period, as cards with their openings carried in. The
 * running balance is accumulated by date and then by posting order, so a
 * backdated movement lands on its date. A card with neither an opening nor a
 * movement is left out.
 */
export async function stockLedgerReport(itemIds: number[], warehouseIds: number[], range: PeriodRange): Promise<StockCard[]> {
  const where = filterWhere({ itemIds, warehouseIds });
  const [before, rows] = await Promise.all([
    prisma.logStockLedger.groupBy({
      by: ["item_id", "warehouse_id"],
      where: { ...where, posting_date: { lt: day(range.from) } },
      _sum: { qty_change: true },
    }),
    prisma.logStockLedger.findMany({
      where: { ...where, posting_date: { gte: day(range.from), lte: day(range.to) } },
      orderBy: [{ posting_date: "asc" }, { id: "asc" }],
      include: { tracking: true, stock_status: true, source_doc_type: true },
    }),
  ]);
  type Acc = {
    itemId: number;
    warehouseId: number;
    opening: Prisma.Decimal;
    running: Prisma.Decimal;
    tin: Prisma.Decimal;
    tout: Prisma.Decimal;
    entries: StockLedgerEntry[];
  };
  const acc = new Map<string, Acc>();
  const card = (itemId: number, warehouseId: number, opening = new D(0)) => {
    const k = cardKey(itemId, warehouseId);
    let a = acc.get(k);
    if (!a) acc.set(k, (a = { itemId, warehouseId, opening, running: opening, tin: new D(0), tout: new D(0), entries: [] }));
    return a;
  };
  for (const g of before) {
    const q = new D(g._sum.qty_change ?? 0);
    if (!q.isZero()) card(g.item_id, g.warehouse_id, q);
  }
  for (const r of rows) {
    const a = card(r.item_id, r.warehouse_id);
    a.running = a.running.add(r.qty_change);
    if (r.qty_change.gt(0)) a.tin = a.tin.add(r.qty_change);
    else a.tout = a.tout.sub(r.qty_change);
    a.entries.push({
      id: r.id,
      date: iso(r.posting_date),
      ledgerNo: r.ledger_no,
      lineNo: r.line_no,
      source: { table: r.source_doc_type.doc_table, id: r.source_doc_id, no: r.source_no, docName: r.source_doc_type.doc_name },
      lotNo: r.tracking.tracking_no,
      expiry: r.tracking.expiry_date ? iso(r.tracking.expiry_date) : null,
      statusName: r.stock_status.status_name,
      qtyIn: r.qty_change.gt(0) ? r.qty_change.toNumber() : 0,
      qtyOut: r.qty_change.lt(0) ? r.qty_change.neg().toNumber() : 0,
      balance: a.running.toNumber(),
    });
  }
  const list = [...acc.values()];
  if (!list.length) return [];
  const subj = await cardSubjects([...new Set(list.map((a) => a.itemId))], [...new Set(list.map((a) => a.warehouseId))]);
  return list
    .map((a) => ({
      item: subj.item.get(a.itemId)!,
      warehouse: subj.warehouse.get(a.warehouseId)!,
      opening: a.opening.toNumber(),
      totalIn: a.tin.toNumber(),
      totalOut: a.tout.toNumber(),
      closing: a.running.toNumber(),
      entries: a.entries,
    }))
    .sort(byCard);
}

// ----------------------------------------------------------- Saldo Stok

export type StockLotBalance = { lotNo: string; expiry: string | null; statusName: string; qty: number };

/** What one warehouse holds of one item as of a date, with the lots behind it, earliest expiry first. */
export type StockPosition = {
  item: StockItemRef;
  warehouse: StockWarehouseRef;
  qty: number;
  lots: StockLotBalance[];
};

/**
 * The chosen items in the chosen warehouses (none chosen = all) as of a date:
 * the stock ledger summed up to and including it per bucket, then gathered
 * into item × warehouse positions. Buckets at zero are left out.
 */
export async function stockBalanceReport(asOf: string, itemIds: number[], warehouseIds: number[]): Promise<StockPosition[]> {
  const groups = await prisma.logStockLedger.groupBy({
    by: ["item_id", "warehouse_id", "tracking_id", "stock_status_id"],
    where: { ...filterWhere({ itemIds, warehouseIds }), posting_date: { lte: day(asOf) } },
    _sum: { qty_change: true },
  });
  const live = groups.filter((g) => g._sum.qty_change && !g._sum.qty_change.isZero());
  if (!live.length) return [];
  const [subj, lots, statuses] = await Promise.all([
    cardSubjects([...new Set(live.map((g) => g.item_id))], [...new Set(live.map((g) => g.warehouse_id))]),
    prisma.logStockTracking.findMany({ where: { id: { in: [...new Set(live.map((g) => g.tracking_id))] } } }),
    prisma.sysStockStatus.findMany(),
  ]);
  const lotBy = new Map(lots.map((l) => [l.id, l]));
  const stBy = new Map(statuses.map((s) => [s.id, s]));
  const positions = new Map<string, { item: StockItemRef; warehouse: StockWarehouseRef; qty: Prisma.Decimal; lots: StockLotBalance[] }>();
  for (const g of live) {
    const k = cardKey(g.item_id, g.warehouse_id);
    let p = positions.get(k);
    if (!p) positions.set(k, (p = { item: subj.item.get(g.item_id)!, warehouse: subj.warehouse.get(g.warehouse_id)!, qty: new D(0), lots: [] }));
    const l = lotBy.get(g.tracking_id)!;
    p.qty = p.qty.add(g._sum.qty_change!);
    p.lots.push({
      lotNo: l.tracking_no,
      expiry: l.expiry_date ? iso(l.expiry_date) : null,
      statusName: stBy.get(g.stock_status_id)?.status_name ?? "",
      qty: num(g._sum.qty_change),
    });
  }
  return [...positions.values()]
    .map((p) => ({
      ...p,
      qty: p.qty.toNumber(),
      lots: p.lots.sort((a, b) => (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999") || a.lotNo.localeCompare(b.lotNo)),
    }))
    .sort(byCard);
}

// --------------------------------------------- Kartu Nilai Persediaan

export type ValuationLedgerEntry = {
  id: number;
  date: string;
  ledgerNo: string;
  lineNo: number;
  source: StockSourceRef;
  qtyChange: number;
  valueChange: number;
  /** |value ÷ qty| of the row. */
  unitCost: number;
  qtyBalance: number;
  valueBalance: number;
  /** valueBalance ÷ qtyBalance — derived for reading. */
  average: number;
};

export type ValuationLedgerReport = {
  item: ItemHead;
  range: PeriodRange;
  openingQty: number;
  openingValue: number;
  valueIn: number;
  valueOut: number;
  closingQty: number;
  closingValue: number;
  entries: ValuationLedgerEntry[];
  reconciles: boolean;
};

const avgOf = (v: Prisma.Decimal, q: Prisma.Decimal) => (q.gt(0) ? v.div(q).toDecimalPlaces(6, D.ROUND_HALF_UP).toNumber() : 0);

/** Every movement of one item's moving-average pool over a period, quantity and value, with the pool after each. */
export async function valuationLedgerReport(itemId: number, range: PeriodRange): Promise<ValuationLedgerReport | null> {
  const item = await itemHead(itemId);
  if (!item) return null;
  const [before, rows] = await Promise.all([
    prisma.logStockValuationLedger.aggregate({
      where: { item_id: itemId, posting_date: { lt: day(range.from) } },
      _sum: { qty_change: true, value_change: true },
    }),
    prisma.logStockValuationLedger.findMany({
      where: { item_id: itemId, posting_date: { gte: day(range.from), lte: day(range.to) } },
      orderBy: [{ posting_date: "asc" }, { id: "asc" }],
      include: { source_doc_type: true },
    }),
  ]);
  let q = new D(before._sum.qty_change ?? 0);
  let v = new D(before._sum.value_change ?? 0);
  const openingQty = q.toNumber();
  const openingValue = v.toNumber();
  let valueIn = new D(0);
  let valueOut = new D(0);
  const entries = rows.map((r) => {
    q = q.add(r.qty_change);
    v = v.add(r.value_change);
    if (r.qty_change.gt(0)) valueIn = valueIn.add(r.value_change);
    else valueOut = valueOut.sub(r.value_change);
    return {
      id: r.id,
      date: iso(r.posting_date),
      ledgerNo: r.ledger_no,
      lineNo: r.line_no,
      source: { table: r.source_doc_type.doc_table, id: r.source_doc_id, no: r.source_no, docName: r.source_doc_type.doc_name },
      qtyChange: r.qty_change.toNumber(),
      valueChange: r.value_change.toNumber(),
      unitCost: num(r.unit_cost),
      qtyBalance: q.toNumber(),
      valueBalance: v.toNumber(),
      average: avgOf(v, q),
    };
  });
  return {
    item,
    range,
    openingQty,
    openingValue,
    valueIn: valueIn.toNumber(),
    valueOut: valueOut.toNumber(),
    closingQty: q.toNumber(),
    closingValue: v.toNumber(),
    entries,
    reconciles: await stockBooksReconcile(itemId),
  };
}

// ------------------------------------------------------ Nilai Persediaan

export type ValuationRow = {
  itemId: number;
  itemLabel: string;
  itemName: string;
  uomLabel: string;
  qty: number;
  value: number;
  average: number;
};

/** Each item's pool as of a date — quantity, value, and the average they give. Items with nothing left are left out. */
export async function valuationReport(asOf: string, itemId: number | null): Promise<ValuationRow[]> {
  const groups = await prisma.logStockValuationLedger.groupBy({
    by: ["item_id"],
    where: { posting_date: { lte: day(asOf) }, ...(itemId ? { item_id: itemId } : {}) },
    _sum: { qty_change: true, value_change: true },
  });
  const live = groups.filter((g) => !(g._sum.qty_change ?? new D(0)).isZero() || !(g._sum.value_change ?? new D(0)).isZero());
  if (!live.length) return [];
  const items = await prisma.mItem.findMany({ where: { id: { in: live.map((g) => g.item_id) } }, include: { base_uom: true } });
  const by = new Map(items.map((i) => [i.id, i]));
  return live
    .map((g) => {
      const i = by.get(g.item_id)!;
      const q = new D(g._sum.qty_change ?? 0);
      const v = new D(g._sum.value_change ?? 0);
      return { itemId: i.id, itemLabel: i.item_label, itemName: i.item_name, uomLabel: i.base_uom.uom_label, qty: q.toNumber(), value: v.toNumber(), average: avgOf(v, q) };
    })
    .sort((a, b) => a.itemLabel.localeCompare(b.itemLabel));
}

// ------------------------------------------------------------ reconcile

/**
 * Whether the balance tables equal their ledgers — for some items or all: each
 * bucket's quantity is the sum of its stock ledger rows, and each pool's Q and
 * V the sums of its valuation rows. A report shows its figures from the
 * ledgers either way and warns when this is false.
 */
export async function stockBooksReconcile(itemIds: number | number[] | null = null): Promise<boolean> {
  const ids = itemIds == null ? [] : Array.isArray(itemIds) ? itemIds : [itemIds];
  const item = ids.length ? Prisma.sql`AND b."item_id" IN (${Prisma.join(ids)})` : Prisma.empty;
  const [buckets, pools] = await Promise.all([
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM "log_stock_balance" b
      WHERE b."qty_balance" <> COALESCE((SELECT SUM(l."qty_change") FROM "log_stock_ledger" l
        WHERE l."warehouse_id" = b."warehouse_id" AND l."tracking_id" = b."tracking_id" AND l."stock_status_id" = b."stock_status_id"), 0) ${item}`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM "log_stock_valuation_balance" b
      LEFT JOIN (SELECT "item_id", SUM("qty_change") AS q, SUM("value_change") AS v FROM "log_stock_valuation_ledger" GROUP BY "item_id") l
        ON l."item_id" = b."item_id"
      WHERE (b."qty_balance" <> COALESCE(l.q, 0) OR b."value_balance" <> COALESCE(l.v, 0)) ${item}`,
  ]);
  return Number(buckets[0].n) === 0 && Number(pools[0].n) === 0;
}
