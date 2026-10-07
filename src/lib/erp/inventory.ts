import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import { locationDisplayLabel, lotKey } from "./warehouse-location";

/**
 * The inventory module — the stock books (P120), built on the moving-average
 * design agreed in P114.
 *
 * Two books, each a ledger with its balance, written side by side in the
 * posting transaction of the document that moves the goods:
 *
 * - **Quantity** — `log_stock_ledger` / `log_stock_balance`: how much of which
 *   lot is in which warehouse — and where in it — in which status. One bucket
 *   per warehouse, location, lot and status; never negative. A warehouse with
 *   Gunakan Lokasi names a location on every row; any other names none (null).
 * - **Value** — `log_stock_valuation_ledger` / `log_stock_valuation_balance`:
 *   one moving-average pool per item (one company, one valuation area), kept
 *   as quantity Q and value V in whole rupiah. A receipt adds its own value;
 *   an issue of q releases round(V × q ÷ Q), and the issue that empties the
 *   pool releases V whole, so a pool always ends at 0 / 0. The average V ÷ Q is
 *   cached for reading and never multiplied by anything.
 *
 * Every quantity row has exactly one valuation row with the same value change,
 * so Σ value over either ledger is the same figure.
 *
 * **Only an item with Kelola Stok enters the books**, and it is always held by
 * lot (`log_stock_tracking`, unique per item). An item without Kelola Stok is
 * an expense when acquired and is never received or issued here; the user
 * confirmed such a Barang is not sold, so `issueStock` refuses one as a guard.
 *
 * A book: it imports only the shared kernel and is called by the documents,
 * never the reverse (§3.1). Its tables are named only here and by
 * `stock-report.ts`, which reads them.
 */

type Db = Prisma.TransactionClient | typeof prisma;
type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

/** A movement the inventory refuses — short stock, an unknown lot, an item not kept in stock. */
export class InventoryRefusal extends Error {}

export type StockSource = { docTypeId: number; docId: number; no: string };

/** The status goods are received into and issued from today. */
export const AVAILABLE_STATUS = "TERSEDIA";

const qtyText = (d: Dec) => d.toDecimalPlaces(4).toString().replace(".", ",");

// ------------------------------------------------------------------ reads

/** The items that enter the stock books: Barang with Kelola Stok. Each is held by lot. */
export async function lotTrackedItems(itemIds: number[], db: Db = prisma): Promise<Set<number>> {
  if (!itemIds.length) return new Set();
  const rows = await db.mItem.findMany({
    where: { id: { in: itemIds }, item_type: "Barang", track_stock: true },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/**
 * One place a lot may be picked from: the lot in a location (`locationId`
 * null in a warehouse without locations). A picker keys it by `key`.
 */
export type LotOption = {
  /** `<lot id>:<location id or 0>` — the bucket, unique within a warehouse. */
  key: string;
  id: number;
  lotNo: string;
  expiry: string | null;
  locationId: number | null;
  /** `<warehouse>-<location>` (`locationDisplayLabel`), null without a location. */
  locationLabel: string | null;
  locationName: string | null;
  /** Quantity available (Tersedia) in the warehouse, in the item's base unit. */
  available: number;
  /** Offered to a picker: something is available. */
  active: boolean;
};

export { lotKey };

/**
 * The lots a picker may choose for each item, per warehouse — each lot in each
 * location that holds it available — earliest expiry first (FEFO), a lot
 * without expiry last, then by location. `withIds` also brings in the buckets
 * of lots a stored document already names, whatever they hold now, so it
 * keeps reading.
 */
export async function lotOptions(
  itemIds: number[],
  warehouseIds: number[],
  db: Db = prisma,
  withIds: number[] = []
): Promise<Map<number, Map<number, LotOption[]>>> {
  const out = new Map<number, Map<number, LotOption[]>>();
  if (!itemIds.length || !warehouseIds.length) return out;
  const status = await statusId(db);
  const balances = await db.logStockBalance.findMany({
    where: { item_id: { in: itemIds }, warehouse_id: { in: warehouseIds }, stock_status_id: status },
    select: {
      warehouse_id: true,
      location_id: true,
      tracking_id: true,
      qty_balance: true,
      warehouse: { select: { warehouse_label: true } },
      location: { select: { location_label: true, location_name: true } },
    },
  });
  const live = balances.filter((b) => b.qty_balance.gt(0) || withIds.includes(b.tracking_id));
  if (!live.length) return out;
  const lots = await db.logStockTracking.findMany({
    where: { id: { in: [...new Set(live.map((b) => b.tracking_id))] }, item_id: { in: itemIds } },
  });
  const lotBy = new Map(lots.map((t) => [t.id, t]));
  for (const b of live) {
    const t = lotBy.get(b.tracking_id);
    if (!t) continue;
    const available = b.qty_balance.toNumber();
    const byItem = out.get(b.warehouse_id) ?? new Map<number, LotOption[]>();
    const list = byItem.get(t.item_id) ?? [];
    list.push({
      key: lotKey(t.id, b.location_id),
      id: t.id,
      lotNo: t.tracking_no,
      expiry: t.expiry_date ? t.expiry_date.toISOString().slice(0, 10) : null,
      locationId: b.location_id,
      locationLabel: b.location ? locationDisplayLabel(b.warehouse.warehouse_label, b.location.location_label) : null,
      locationName: b.location?.location_name ?? null,
      available,
      active: available > 0,
    });
    byItem.set(t.item_id, list);
    out.set(b.warehouse_id, byItem);
  }
  // FEFO: earliest expiry first, a lot without one last; then lot, then location.
  for (const byItem of out.values()) {
    for (const list of byItem.values()) {
      list.sort(
        (a, b) =>
          (a.expiry ?? "9999").localeCompare(b.expiry ?? "9999") ||
          a.lotNo.localeCompare(b.lotNo) ||
          (a.locationLabel ?? "").localeCompare(b.locationLabel ?? "")
      );
    }
  }
  return out;
}

export type WarehouseLocationOption = { id: number; label: string; name: string; active: boolean };

/**
 * Each warehouse's locations for a picker, by warehouse id, in label order —
 * inactive ones included, marked, so a stored document still reads its own.
 * A warehouse without Gunakan Lokasi has none.
 */
export async function warehouseLocationOptions(warehouseIds: number[], db: Db = prisma): Promise<Map<number, WarehouseLocationOption[]>> {
  const out = new Map<number, WarehouseLocationOption[]>();
  if (!warehouseIds.length) return out;
  const rows = await db.refWarehouseLocation.findMany({
    where: { warehouse_id: { in: warehouseIds }, warehouse: { use_location: true } },
    orderBy: { location_label: "asc" },
    include: { warehouse: { select: { warehouse_label: true } } },
  });
  for (const r of rows) {
    const list = out.get(r.warehouse_id) ?? [];
    list.push({ id: r.id, label: locationDisplayLabel(r.warehouse.warehouse_label, r.location_label), name: r.location_name, active: r.status === "Active" });
    out.set(r.warehouse_id, list);
  }
  return out;
}

/** Whether a warehouse holds any stock now — Gunakan Lokasi may not change while it does. */
export async function warehouseHoldsStock(warehouseId: number, db: Db = prisma): Promise<boolean> {
  return (await db.logStockBalance.count({ where: { warehouse_id: warehouseId, qty_balance: { not: 0 } } })) > 0;
}

/**
 * Of the locations named, those stock has ever moved through (`moved`) — never
 * removed, only deactivated — and those holding stock now (`holding`) — not
 * deactivated either.
 */
export async function locationStockUse(ids: number[], db: Db = prisma): Promise<{ moved: Set<number>; holding: Set<number> }> {
  if (!ids.length) return { moved: new Set(), holding: new Set() };
  const [moved, holding] = await Promise.all([
    db.logStockLedger.findMany({ where: { location_id: { in: ids } }, distinct: ["location_id"], select: { location_id: true } }),
    db.logStockBalance.findMany({ where: { location_id: { in: ids }, qty_balance: { not: 0 } }, distinct: ["location_id"], select: { location_id: true } }),
  ]);
  return {
    moved: new Set(moved.flatMap((r) => (r.location_id ? [r.location_id] : []))),
    holding: new Set(holding.flatMap((r) => (r.location_id ? [r.location_id] : []))),
  };
}

/** `<warehouse>-<location>` per location id, for a stored document that names them. */
export async function locationLabelsByIds(ids: number[], db: Db = prisma): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await db.refWarehouseLocation.findMany({
    where: { id: { in: [...new Set(ids)] } },
    include: { warehouse: { select: { warehouse_label: true } } },
  });
  return new Map(rows.map((r) => [r.id, locationDisplayLabel(r.warehouse.warehouse_label, r.location_label)]));
}

/**
 * The warehouse and location a movement names, checked (Gunakan Lokasi): a
 * warehouse with locations needs one of its own — active, for goods coming in
 * — and one without takes none.
 */
async function stockPlace(tx: Tx, warehouseId: number, locationId: number | null | undefined, receiving: boolean) {
  const warehouse = await tx.refWarehouse.findUnique({ where: { id: warehouseId }, select: { warehouse_label: true, use_location: true } });
  if (!warehouse) throw new InventoryRefusal("Gudang tidak ditemukan.");
  if (!warehouse.use_location) {
    if (locationId) throw new InventoryRefusal(`Gudang ${warehouse.warehouse_label} tidak memakai lokasi: kosongkan lokasinya.`);
    return { locationId: null, where: `gudang ${warehouse.warehouse_label}` };
  }
  if (!locationId) throw new InventoryRefusal(`Gudang ${warehouse.warehouse_label} memakai lokasi: pilih lokasinya.`);
  const location = await tx.refWarehouseLocation.findFirst({ where: { id: locationId, warehouse_id: warehouseId } });
  if (!location) throw new InventoryRefusal(`Lokasi tidak ada di gudang ${warehouse.warehouse_label}. Pilih ulang lokasinya.`);
  const label = locationDisplayLabel(warehouse.warehouse_label, location.location_label);
  if (receiving && location.status !== "Active") throw new InventoryRefusal(`Lokasi ${label} nonaktif.`);
  return { locationId: location.id, where: `lokasi ${label}` };
}

async function statusId(db: Db, label = AVAILABLE_STATUS): Promise<number> {
  const row = await db.sysStockStatus.findUnique({ where: { status_label: label }, select: { id: true } });
  if (!row) throw new InventoryRefusal(`Status stok ${label} belum ada. Jalankan seed.`);
  return row.id;
}

async function stockItem(tx: Tx, itemId: number) {
  const item = await tx.mItem.findUnique({
    where: { id: itemId },
    select: { item_label: true, item_type: true, track_stock: true, has_expiry: true, base_uom_id: true },
  });
  if (!item) throw new InventoryRefusal("Barang tidak ditemukan.");
  if (item.item_type !== "Barang" || !item.track_stock) {
    throw new InventoryRefusal(`${item.item_label} tidak dikelola stok (Kelola Stok tidak aktif), jadi tidak bisa masuk atau keluar dari persediaan.`);
  }
  return item;
}

// ------------------------------------------------------------ locking

type Pool = { id: number; qty: Dec; value: Dec };
type Bucket = { id: number; qty: Dec };

/** The item's pool, created empty if it has none, and locked for this posting. */
async function lockPool(tx: Tx, itemId: number, uomId: number, actorId: number): Promise<Pool> {
  await tx.$executeRaw`
    INSERT INTO "log_stock_valuation_balance" ("item_id", "uom_id", "qty_balance", "value_balance", "avg_unit_cost", "created_by")
    VALUES (${itemId}, ${uomId}, 0, 0, 0, ${actorId})
    ON CONFLICT ("item_id") DO NOTHING`;
  const [row] = await tx.$queryRaw<{ id: number; qty_balance: Dec; value_balance: Dec }[]>`
    SELECT "id", "qty_balance", "value_balance" FROM "log_stock_valuation_balance" WHERE "item_id" = ${itemId} FOR UPDATE`;
  return { id: row.id, qty: new D(row.qty_balance), value: new D(row.value_balance) };
}

/**
 * One warehouse / location / lot / status bucket, created empty if missing when
 * `create`, and locked. The key is unique NULLS NOT DISTINCT, so a warehouse
 * without locations still has one bucket per lot and status.
 */
async function lockBucket(
  tx: Tx,
  k: { warehouseId: number; locationId: number | null; trackingId: number; statusId: number; itemId: number; uomId: number },
  actorId: number,
  create: boolean
): Promise<Bucket | null> {
  if (create) {
    await tx.$executeRaw`
      INSERT INTO "log_stock_balance" ("warehouse_id", "location_id", "tracking_id", "item_id", "uom_id", "stock_status_id", "qty_balance", "created_by")
      VALUES (${k.warehouseId}, ${k.locationId}::int, ${k.trackingId}, ${k.itemId}, ${k.uomId}, ${k.statusId}, 0, ${actorId})
      ON CONFLICT ("warehouse_id", "location_id", "tracking_id", "stock_status_id") DO NOTHING`;
  }
  const [row] = await tx.$queryRaw<{ id: number; qty_balance: Dec }[]>`
    SELECT "id", "qty_balance" FROM "log_stock_balance"
    WHERE "warehouse_id" = ${k.warehouseId} AND "location_id" IS NOT DISTINCT FROM ${k.locationId}::int
      AND "tracking_id" = ${k.trackingId} AND "stock_status_id" = ${k.statusId}
    FOR UPDATE`;
  return row ? { id: row.id, qty: new D(row.qty_balance) } : null;
}

// ------------------------------------------------------------ positions

/**
 * The ledger number and line a row takes (P110): one number per posting per
 * book — the rows one document writes share it, a line each; the first takes
 * the next number in its month's series, read from line-1 rows.
 */
async function stockPosition(tx: Tx, date: Date, s: StockSource) {
  const last = await tx.logStockLedger.findFirst({
    where: { source_doc_type_id: s.docTypeId, source_doc_id: s.docId },
    orderBy: { line_no: "desc" },
    select: { ledger_no: true, line_no: true },
  });
  if (last) return { ledger_no: last.ledger_no, line_no: last.line_no + 1 };
  const ledger_no = await nextDocumentNumber("MS", date, async (series) => {
    const row = await tx.logStockLedger.findFirst({
      where: { ledger_no: { startsWith: series }, line_no: 1 },
      orderBy: { id: "desc" },
      select: { ledger_no: true },
    });
    return row?.ledger_no ?? null;
  });
  return { ledger_no, line_no: 1 };
}

async function valuationPosition(tx: Tx, date: Date, s: StockSource) {
  const last = await tx.logStockValuationLedger.findFirst({
    where: { source_doc_type_id: s.docTypeId, source_doc_id: s.docId },
    orderBy: { line_no: "desc" },
    select: { ledger_no: true, line_no: true },
  });
  if (last) return { ledger_no: last.ledger_no, line_no: last.line_no + 1 };
  const ledger_no = await nextDocumentNumber("MN", date, async (series) => {
    const row = await tx.logStockValuationLedger.findFirst({
      where: { ledger_no: { startsWith: series }, line_no: 1 },
      orderBy: { id: "desc" },
      select: { ledger_no: true },
    });
    return row?.ledger_no ?? null;
  });
  return { ledger_no, line_no: 1 };
}

// ------------------------------------------------------------- writing

/** |value ÷ qty| at six decimals — a description of a movement, never read back (P114). */
const describe = (value: Dec, qty: Dec) => (qty.isZero() ? new D(0) : value.abs().div(qty.abs()).toDecimalPlaces(6, D.ROUND_HALF_UP));
const average = (value: Dec, qty: Dec) => (qty.gt(0) ? value.div(qty).toDecimalPlaces(6, D.ROUND_HALF_UP) : new D(0));

/** Writes one movement to both books: the bucket and its row, the pool and its row. */
async function move(
  tx: Tx,
  m: {
    pool: Pool;
    bucket: Bucket;
    qty: Dec;
    value: Dec;
    itemId: number;
    uomId: number;
    warehouseId: number;
    locationId: number | null;
    trackingId: number;
    statusId: number;
    date: Date;
    source: StockSource;
    actorId: number;
  }
) {
  const bucketAfter = m.bucket.qty.add(m.qty);
  const poolQty = m.pool.qty.add(m.qty);
  const poolValue = m.pool.value.add(m.value);
  if (bucketAfter.lt(0) || poolQty.lt(0) || poolValue.lt(0)) throw new InventoryRefusal("Stok tidak boleh negatif.");
  const unitCost = describe(m.value, m.qty);
  const src = { source_doc_type_id: m.source.docTypeId, source_doc_id: m.source.docId, source_no: m.source.no };

  await tx.logStockBalance.update({ where: { id: m.bucket.id }, data: { qty_balance: bucketAfter, updated_by: m.actorId } });
  await tx.logStockLedger.create({
    data: {
      ...(await stockPosition(tx, m.date, m.source)),
      posting_date: m.date,
      ...src,
      warehouse_id: m.warehouseId,
      location_id: m.locationId,
      tracking_id: m.trackingId,
      item_id: m.itemId,
      uom_id: m.uomId,
      stock_status_id: m.statusId,
      qty_change: m.qty,
      qty_balance: bucketAfter,
      unit_cost: unitCost,
      value_change: m.value,
      created_by: m.actorId,
    },
  });

  const avg = average(poolValue, poolQty);
  await tx.logStockValuationBalance.update({
    where: { id: m.pool.id },
    data: { qty_balance: poolQty, value_balance: poolValue, avg_unit_cost: avg, updated_by: m.actorId },
  });
  await tx.logStockValuationLedger.create({
    data: {
      ...(await valuationPosition(tx, m.date, m.source)),
      posting_date: m.date,
      ...src,
      item_id: m.itemId,
      uom_id: m.uomId,
      qty_change: m.qty,
      qty_balance: poolQty,
      unit_cost: unitCost,
      value_change: m.value,
      value_balance: poolValue,
      avg_unit_cost: avg,
      created_by: m.actorId,
    },
  });
  m.pool.qty = poolQty;
  m.pool.value = poolValue;
  m.bucket.qty = bucketAfter;
  return unitCost;
}

export type StockReceipt = {
  itemId: number;
  warehouseId: number;
  /** Required in a warehouse with Gunakan Lokasi, null in any other. */
  locationId?: number | null;
  /** The lot it comes in as; a lot the item already has is added to. */
  lotNo: string;
  /** Required for an item with Memiliki Kadaluarsa; must match a lot already known. */
  expiry: Date | null;
  /** In the item's base unit. */
  baseQty: number | string | Dec;
  /** What it is worth, whole rupiah — its own value from its source (P114). */
  value: number | string | Dec;
  date: Date;
  source: StockSource;
  /** The supplier, when the receipt names one. */
  partnerId?: number | null;
  actorId: number;
};

/**
 * Brings goods into a warehouse at their own value. Called inside the
 * receiving document's posting transaction, so a refusal rolls it back.
 */
export async function receiveStock(tx: Tx, r: StockReceipt): Promise<{ trackingId: number; trackingNo: string; unitCost: number }> {
  const qty = new D(r.baseQty);
  const value = new D(r.value);
  if (!qty.gt(0)) throw new InventoryRefusal("Jumlah yang diterima harus lebih dari 0.");
  if (value.lt(0) || !value.isInteger()) throw new InventoryRefusal("Nilai persediaan harus rupiah utuh, tidak negatif.");
  if (qty.decimalPlaces() > 6) throw new InventoryRefusal("Jumlah paling banyak 6 angka desimal.");
  const item = await stockItem(tx, r.itemId);
  const lotNo = String(r.lotNo ?? "").trim().toUpperCase();
  if (!lotNo) throw new InventoryRefusal(`${item.item_label} dikelola per lot: isi No. Lot.`);
  const expiryIso = r.expiry ? r.expiry.toISOString().slice(0, 10) : null;
  if (item.has_expiry && !expiryIso) throw new InventoryRefusal(`${item.item_label} memiliki kadaluarsa: isi tanggal kadaluarsa lot ${lotNo}.`);
  const place = await stockPlace(tx, r.warehouseId, r.locationId, true);

  let tracking = await tx.logStockTracking.findUnique({ where: { item_id_tracking_no: { item_id: r.itemId, tracking_no: lotNo } } });
  if (tracking) {
    const known = tracking.expiry_date ? tracking.expiry_date.toISOString().slice(0, 10) : null;
    if (expiryIso && known !== expiryIso) {
      throw new InventoryRefusal(`Lot ${lotNo} ${item.item_label} sudah tercatat dengan kadaluarsa ${known ?? "kosong"}.`);
    }
  } else {
    tracking = await tx.logStockTracking.create({
      data: {
        tracking_no: lotNo,
        tracking_date: r.date,
        item_id: r.itemId,
        source_doc_type_id: r.source.docTypeId,
        source_doc_id: r.source.docId,
        source_no: r.source.no,
        source_partner_id: r.partnerId ?? null,
        expiry_date: r.expiry,
        created_by: r.actorId,
      },
    });
  }

  const status = await statusId(tx);
  const pool = await lockPool(tx, r.itemId, item.base_uom_id, r.actorId);
  const bucket = (await lockBucket(
    tx,
    { warehouseId: r.warehouseId, locationId: place.locationId, trackingId: tracking.id, statusId: status, itemId: r.itemId, uomId: item.base_uom_id },
    r.actorId,
    true
  ))!;
  const unitCost = await move(tx, {
    pool,
    bucket,
    qty,
    value,
    itemId: r.itemId,
    uomId: item.base_uom_id,
    warehouseId: r.warehouseId,
    locationId: place.locationId,
    trackingId: tracking.id,
    statusId: status,
    date: r.date,
    source: r.source,
    actorId: r.actorId,
  });
  return { trackingId: tracking.id, trackingNo: tracking.tracking_no, unitCost: unitCost.toNumber() };
}

export type StockIssue = {
  itemId: number;
  warehouseId: number;
  /** The location it leaves from: required in a warehouse with Gunakan Lokasi, null in any other. */
  locationId?: number | null;
  /** The lot it leaves from. */
  lotId: number | null | undefined;
  /** In the item's base unit. */
  baseQty: number;
  date: Date;
  source: StockSource;
  actorId: number;
};

/**
 * Takes goods out of a warehouse and says what they cost: the pool releases
 * round(V × q ÷ Q), or V whole when q empties it. Refuses short stock — no
 * negative stock (P114). Called inside the issuing document's posting
 * transaction, so a refusal rolls the posting back.
 */
export async function issueStock(tx: Tx, issue: StockIssue): Promise<{ unitCost: number; cost: number }> {
  const qty = new D(issue.baseQty);
  if (!qty.gt(0)) throw new InventoryRefusal("Jumlah yang dikeluarkan harus lebih dari 0.");
  const item = await stockItem(tx, issue.itemId);
  if (!issue.lotId) throw new InventoryRefusal(`${item.item_label} dikelola per lot: pilih lotnya.`);
  const tracking = await tx.logStockTracking.findFirst({ where: { id: issue.lotId, item_id: issue.itemId } });
  if (!tracking) throw new InventoryRefusal(`Lot ${item.item_label} tidak ditemukan. Pilih ulang lotnya.`);
  const place = await stockPlace(tx, issue.warehouseId, issue.locationId, false);

  const status = await statusId(tx);
  // Pool before bucket, as receiveStock does, so two postings never lock in opposite orders.
  const pool = await lockPool(tx, issue.itemId, item.base_uom_id, issue.actorId);
  const bucket = await lockBucket(
    tx,
    { warehouseId: issue.warehouseId, locationId: place.locationId, trackingId: tracking.id, statusId: status, itemId: issue.itemId, uomId: item.base_uom_id },
    issue.actorId,
    false
  );
  const available = bucket?.qty ?? new D(0);
  if (!bucket || available.lt(qty)) {
    throw new InventoryRefusal(
      `Stok ${item.item_label} lot ${tracking.tracking_no} di ${place.where} tidak cukup: tersedia ${qtyText(available)}, diminta ${qtyText(qty)}.`
    );
  }
  // The pool counts every warehouse and status, so it holds at least the bucket.
  const release = qty.eq(pool.qty) ? pool.value : pool.value.mul(qty).div(pool.qty).toDecimalPlaces(0, D.ROUND_HALF_UP);
  const unitCost = await move(tx, {
    pool,
    bucket,
    qty: qty.neg(),
    value: release.neg(),
    itemId: issue.itemId,
    uomId: item.base_uom_id,
    warehouseId: issue.warehouseId,
    locationId: place.locationId,
    trackingId: tracking.id,
    statusId: status,
    date: issue.date,
    source: issue.source,
    actorId: issue.actorId,
  });
  return { unitCost: unitCost.toNumber(), cost: release.toNumber() };
}

// ------------------------------------------------------------ injection

export type InjectionRow = {
  itemId: number;
  warehouseId: number;
  /** Required in a warehouse with Gunakan Lokasi. */
  locationId?: number | null;
  lotNo: string;
  expiry: Date | null;
  /** Base unit. */
  qty: string;
  /** Whole rupiah. */
  value: string;
  /** The movement's posting date. */
  date: Date;
};

/**
 * Brings stock in without a document (P120), for `db:stock-inject`: each run
 * is one source — document type *Injeksi Stok*, numbered `INJ/YYYY/MM/NNNN` by
 * the day it runs — and every row goes through `receiveStock`, so both books
 * stay consistent. All or nothing. **It writes no journal**: injected stock
 * is not in the General Ledger until an opening journal is made for it.
 */
export async function injectStock(rows: InjectionRow[], actorId: number, runDate = new Date()): Promise<{ no: string; docId: number; count: number }> {
  if (!rows.length) throw new InventoryRefusal("Tidak ada baris untuk diinjeksi.");
  return prisma.$transaction(
    async (tx) => {
      // One run at a time, so two never take the same number.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('log_stock_injection'))`;
      const type = await tx.sysDocType.findFirst({ where: { doc_table: "log_stock_injection" }, select: { id: true } });
      if (!type) throw new InventoryRefusal("Jenis dokumen Injeksi Stok belum ada. Jalankan seed.");
      const last = await tx.logStockLedger.findFirst({
        where: { source_doc_type_id: type.id },
        orderBy: { source_doc_id: "desc" },
        select: { source_doc_id: true },
      });
      const docId = (last?.source_doc_id ?? 0) + 1;
      const no = await nextDocumentNumber("INJ", runDate, async (series) => {
        const row = await tx.logStockLedger.findFirst({
          where: { source_doc_type_id: type.id, source_no: { startsWith: series } },
          orderBy: { source_doc_id: "desc" },
          select: { source_no: true },
        });
        return row?.source_no ?? null;
      });
      const source = { docTypeId: type.id, docId, no };
      for (const [i, r] of rows.entries()) {
        try {
          await receiveStock(tx, { ...r, baseQty: r.qty, source, actorId });
        } catch (e) {
          if (e instanceof InventoryRefusal) throw new InventoryRefusal(`Baris ${i + 1}: ${e.message}`);
          throw e;
        }
      }
      return { no, docId, count: rows.length };
    },
    { timeout: 120_000 }
  );
}
