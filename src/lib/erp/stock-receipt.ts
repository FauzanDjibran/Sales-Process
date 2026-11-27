import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { BASE_CURRENCY_LABEL } from "./currency";
import { holdPostingPeriod, PeriodShut } from "./fiscal";
import { HandoverRefusal, deliver, type HandoverMessage } from "./handover";
import { PostingDryRun, describeJournalLines, journalNumbersByIds, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { nextDocumentNumber } from "./document-number";
import { InventoryRefusal, assertNewTrackingNo, locationLabelsByIds, receiveStock, trackingsByNo, warehouseLocationOptions } from "./inventory";
import { fallbackAccounts, isTransitWarehouse, notTransitWarehouse, TRANSIT_WAREHOUSE_REFUSED } from "./system-settings";
import { accountsForItems } from "./item-account";
import { postedBonuses } from "./receipt-note";
import { STOCK_RECEIPT_PURPOSES, isStockReceiptPurpose, stockReceiptPurposeOf, type ProductionValueMode, type StockReceiptPurposeKey } from "./stock-receipt-purposes";
import { stockReceiptTransitions, type StockReceiptStatus } from "./stock-receipt-workflow";

/**
 * The Stock Receipt (P317, P339): goods coming into a warehouse without a
 * partner, by purpose (`stock-receipt-purposes.ts`). Its tables are
 * `log_stock_receipt`, `_line`, `_tracking` and the inbox, and nothing else
 * names them. A line is an item; a tracking row is a No. Stok.
 *
 * **The warehouse makes every one** with Buat (P339): it picks a purpose, then
 * the source when the purpose has one, and takes that source whole (W57).
 *
 * - From production: `ReceiptSent` puts what a Unit sent in the **inbox**
 *   (`log_stock_receipt_inbox`), the copy a receipt is made from (P319). Its
 *   value, and whether the goods keep it, are the sender's.
 * - Bonus Pembelian: what a weighed Receipt Note took in beyond its tolerance
 *   (P321), at 0, under a new No. Stok.
 * - Penerimaan Lain-lain: lines typed, value typed, a reason required.
 *
 * A Draft holds its source — one live receipt per shipment and per Receipt
 * Note, by partial unique indexes. **Terima / Posting** puts each No. Stok in
 * stock, in the location and status the Draft chose, at the value the purpose
 * says (SR-7), and writes one journal: from production Cr WIP against Dr
 * Persediaan or, for goods sent without value, Dr Beban Pemusnahan Produksi;
 * for a typed receipt Dr Persediaan / Cr Penerimaan Persediaan Lain-lain; a
 * bonus none. The confirmation shows it by dry run (P103). From production,
 * `ReceiptReceived` then tells Produksi.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const todayIso = () => isoDay(new Date());
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown) => Number(String(v ?? "").replace(",", "."));

class Refused extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("refused");
  }
}

const TAKEN = "Sumber ini sudah dipakai Stock Receipt lain. Muat ulang.";

async function refusable<T>(run: () => Promise<T>): Promise<T | { ok: false; errors: Record<string, string> }> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof Refused) return { ok: false, errors: e.errors };
    if (e instanceof PeriodShut) return { ok: false, errors: { _form: e.message } };
    if (e instanceof InventoryRefusal || e instanceof HandoverRefusal) return { ok: false, errors: { _form: `Belum bisa diproses: ${e.message}` } };
    if (e instanceof PostingDryRun) return { ok: true, journal: e.lines } as T;
    // The partial unique indexes: a source another live receipt took meanwhile.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, errors: { _form: TAKEN } };
    throw e;
  }
}

async function docTypeId(db: Db, table = "log_stock_receipt"): Promise<number> {
  const t = await db.sysDocType.findFirst({ where: { doc_table: table }, select: { id: true } });
  if (!t) throw new Refused({ _form: "Tipe dokumen belum ada. Jalankan npm run db:seed." });
  return t.id;
}

async function audit(tx: Tx, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await tx.auditLog.create({ data: { entity_key: "log_stock_receipt", row_id: id, action, event, by } });
}

// ----------------------------------------------------------------- handover

/** Produksi sent goods to a warehouse: its copy waits in the inbox. Said twice, it makes nothing new. */
export async function takeReceiptSent(tx: Tx, m: Extract<HandoverMessage, { type: "ReceiptSent" }>, actorId: number): Promise<void> {
  if (await tx.logStockReceiptInbox.findUnique({ where: { sent_no: m.no }, select: { id: true } })) return;
  const warehouse = await tx.refWarehouse.findUnique({ where: { warehouse_code: m.warehouseCode }, select: { id: true } });
  if (!warehouse) throw new HandoverRefusal(`Gudang ${m.warehouseCode} tidak dikenal di ERP.`);
  const unit = await tx.refUnit.findFirst({ where: { unit_label: m.unitLabel }, select: { id: true } });
  const items = new Map((await tx.mItem.findMany({ where: { item_code: { in: m.lines.map((l) => l.itemCode) } }, select: { id: true, item_code: true } })).map((i) => [i.item_code, i.id]));
  for (const l of m.lines) if (!items.has(l.itemCode)) throw new HandoverRefusal(`Item ${l.itemCode} tidak dikenal di ERP.`);
  // A copy, not a record of its own: the Production Issue that sent it is audited in this transaction.
  await tx.logStockReceiptInbox.create({
    data: {
      sent_no: m.no,
      purpose: m.purpose,
      sent_date: asDate(m.date),
      from_unit_id: unit?.id ?? null,
      unit_label: m.unitLabel,
      warehouse_id: warehouse.id,
      value_mode: m.valueMode === "none" ? "none" : "carried",
      note: m.note,
      base_cost_amount: m.lines.reduce((a, l) => a + l.value, 0),
      created_by: actorId,
      lines: {
        create: m.lines.map((l, n) => ({
          seq: n + 1,
          item_id: items.get(l.itemCode)!,
          tracking_no: l.trackingNo,
          expiry_date: l.expiry ? asDate(l.expiry) : null,
          job_no: l.jobNo,
          base_qty: l.qty,
          grams: l.grams == null ? null : Number(l.grams).toFixed(6),
          base_cost_amount: l.value,
        })),
      },
    },
  });
}

// ------------------------------------------------------------------ sources

/** One row a source brings: production's No. Stok as sent, or a bonus line. `key`: the inbox seq or the Receipt Note line id. */
export type SourceRow = {
  key: number;
  itemId: number;
  itemLabel: string;
  itemName: string;
  uomLabel: string;
  hasExpiry: boolean;
  lotNo: string;
  expiry: string | null;
  jobNo: string | null;
  qty: number;
  grams: number | null;
  value: number;
  locationId: number | null;
};

/** A source a Stock Receipt is made from. */
export type SourceView = {
  purpose: StockReceiptPurposeKey;
  id: number;
  no: string;
  date: string;
  warehouseId: number;
  /** The sending Unit, or the supplier of a bonus. */
  fromLabel: string;
  fromName: string;
  valueMode: ProductionValueMode | null;
  partnerId: number | null;
  note: string | null;
  rows: SourceRow[];
};

async function itemFacts(ids: number[], db: Db) {
  const rows = await db.mItem.findMany({ where: { id: { in: ids } }, select: { id: true, item_label: true, item_name: true, has_expiry: true, base_uom: { select: { uom_label: true } } } });
  return new Map(rows.map((i) => [i.id, i]));
}

async function inboxViews(where: Prisma.LogStockReceiptInboxWhereInput, db: Db): Promise<SourceView[]> {
  const rows = await db.logStockReceiptInbox.findMany({ where, orderBy: [{ sent_date: "asc" }, { id: "asc" }], include: { from_unit: true, lines: { orderBy: { seq: "asc" } } } });
  const items = await itemFacts([...new Set(rows.flatMap((r) => r.lines.map((l) => l.item_id)))], db);
  return rows.map((r) => ({
    purpose: stockReceiptPurposeOf(r.purpose),
    id: r.id,
    no: r.sent_no,
    date: isoDay(r.sent_date),
    warehouseId: r.warehouse_id,
    fromLabel: r.unit_label,
    fromName: r.from_unit?.unit_name ?? "",
    valueMode: r.value_mode === "none" ? "none" : "carried",
    partnerId: null,
    note: r.note,
    rows: r.lines.map((l) => {
      const i = items.get(l.item_id)!;
      return {
        key: l.seq,
        itemId: l.item_id,
        itemLabel: i.item_label,
        itemName: i.item_name,
        uomLabel: i.base_uom.uom_label,
        hasExpiry: i.has_expiry,
        lotNo: l.tracking_no,
        expiry: l.expiry_date ? isoDay(l.expiry_date) : null,
        jobNo: l.job_no,
        qty: l.base_qty.toNumber(),
        grams: l.grams?.toNumber() ?? null,
        value: l.base_cost_amount.toNumber(),
        locationId: null,
      };
    }),
  }));
}

async function bonusViews(filter: { warehouseIds?: number[] | null; ids?: number[] }, db: Db): Promise<SourceView[]> {
  const notes = await postedBonuses(filter);
  const items = await itemFacts([...new Set(notes.flatMap((n) => n.lines.map((l) => l.itemId)))], db);
  return notes.map((n) => ({
    purpose: "purchase_bonus" as const,
    id: n.id,
    no: n.no,
    date: n.date,
    warehouseId: n.warehouseId,
    fromLabel: n.no,
    fromName: n.partnerName,
    valueMode: null,
    partnerId: n.partnerId,
    note: null,
    rows: n.lines.map((l) => {
      const i = items.get(l.itemId)!;
      return { key: l.key, itemId: l.itemId, itemLabel: i.item_label, itemName: i.item_name, uomLabel: i.base_uom.uom_label, hasExpiry: i.has_expiry, lotNo: l.lotNo, expiry: l.expiry, jobNo: null, qty: l.baseQty, grams: null, value: 0, locationId: l.locationId };
    }),
  }));
}

/** The source of this purpose and id, whoever holds it. */
export async function sourceOf(purpose: StockReceiptPurposeKey, id: number, db: Db = prisma): Promise<SourceView | null> {
  const from = STOCK_RECEIPT_PURPOSES[purpose].source;
  if (from === "production") return (await inboxViews({ id, purpose }, db))[0] ?? null;
  if (from === "receipt_note") return (await bonusViews({ ids: [id] }, db))[0] ?? null;
  return null;
}

/** The live receipts holding sources, as `<purpose>:<id>` → receipt id. */
async function heldSources(db: Db, exceptId: number | null = null): Promise<Map<string, number>> {
  const rows = await db.logStockReceipt.findMany({
    where: { status: { not: "Cancelled" }, OR: [{ inbox_id: { not: null } }, { purpose: "purchase_bonus" }], ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, purpose: true, inbox_id: true, source_doc_id: true },
  });
  return new Map(rows.map((r) => [`${r.purpose === "purchase_bonus" ? "bonus" : "inbox"}:${r.purpose === "purchase_bonus" ? r.source_doc_id : r.inbox_id}`, r.id]));
}
const holdKey = (s: SourceView) => `${s.purpose === "purchase_bonus" ? "bonus" : "inbox"}:${s.id}`;

/** What waits for a Stock Receipt in these warehouses (null for all): shipments from production and bonuses. */
export async function pendingSources(warehouses: number[] | null): Promise<SourceView[]> {
  const where = warehouses ? { warehouse_id: { in: warehouses } } : {};
  const [held, inbox, bonus] = await Promise.all([heldSources(prisma), inboxViews(where, prisma), bonusViews({ warehouseIds: warehouses }, prisma)]);
  return [...inbox, ...bonus].filter((s) => !held.has(holdKey(s)));
}

// ------------------------------------------------------------------- options

export type StatusOption = { id: number; label: string; name: string };
/** Tersedia first: the status goods come in under unless the warehouse says otherwise. */
async function stockStatuses(db: Db = prisma): Promise<StatusOption[]> {
  return (await db.sysStockStatus.findMany({ orderBy: { sort_order: "asc" } })).map((s) => ({ id: s.id, label: s.status_label, name: s.status_name }));
}

export type StockReceiptFormOptions = {
  /** The user's warehouses, with their active locations; empty locations: none kept. */
  warehouses: { id: number; label: string; name: string; locations: { id: number; label: string; name: string }[] }[];
  statuses: StatusOption[];
  /** Barang with Kelola Stok, for Penerimaan Lain-lain. */
  items: { id: number; label: string; name: string; uomLabel: string; hasExpiry: boolean }[];
  /** What waits for a receipt in the user's warehouses. */
  sources: SourceView[];
};

export async function stockReceiptFormOptions(mine: number[] | null, current: { warehouseId: number; itemIds: number[] } | null = null): Promise<StockReceiptFormOptions> {
  const [warehouses, statuses, items, sources] = await Promise.all([
    prisma.refWarehouse.findMany({
      where: { AND: [await notTransitWarehouse(), mine ? { id: { in: mine } } : {}, { OR: [{ status: "Active" }, ...(current ? [{ id: current.warehouseId }] : [])] }] },
      orderBy: { warehouse_label: "asc" },
      select: { id: true, warehouse_label: true, warehouse_name: true },
    }),
    stockStatuses(),
    prisma.mItem.findMany({
      where: { item_type: "Barang", track_stock: true, OR: [{ status: "Active" }, ...(current?.itemIds.length ? [{ id: { in: current.itemIds } }] : [])] },
      orderBy: { item_label: "asc" },
      select: { id: true, item_label: true, item_name: true, has_expiry: true, base_uom: { select: { uom_label: true } } },
    }),
    pendingSources(mine),
  ]);
  const locations = await warehouseLocationOptions(warehouses.map((w) => w.id));
  return {
    warehouses: warehouses.map((w) => ({ id: w.id, label: w.warehouse_label, name: w.warehouse_name, locations: (locations.get(w.id) ?? []).filter((l) => l.active).map((l) => ({ id: l.id, label: l.label, name: l.name })) })),
    statuses,
    items: items.map((i) => ({ id: i.id, label: i.item_label, name: i.item_name, uomLabel: i.base_uom.uom_label, hasExpiry: i.has_expiry })),
    sources,
  };
}

// ---------------------------------------------------------------- validation

export type StockReceiptRowInput = {
  /** A source row: the inbox seq or the Receipt Note line id. */
  key?: number | null;
  item_id?: number | null;
  tracking_no?: string | null;
  expiry_date?: string | null;
  location_id?: number | null;
  stock_status_id?: number | null;
  base_qty?: string | number | null;
  value?: string | number | null;
};
export type StockReceiptInput = {
  purpose: string;
  warehouse_id: number | null;
  source_id: number | null;
  receipt_date: string;
  note: string;
  rows: StockReceiptRowInput[];
};
export type StockReceiptResult = { ok: true; id: number; no: string } | { ok: false; errors: Record<string, string> };

type Row = { itemId: number; trackingNo: string; expiry: Date | null; jobNo: string | null; grams: string | null; baseQty: string; value: number; locationId: number | null; statusId: number };

async function check(db: Db, input: StockReceiptInput, exceptId: number | null) {
  const errors: Record<string, string> = {};
  if (!isStockReceiptPurpose(input.purpose)) return { ok: false as const, errors: { purpose: "Pilih tujuan." } };
  const purpose = input.purpose;
  const p = STOCK_RECEIPT_PURPOSES[purpose];
  const today = todayIso();
  if (!DAY.test(input.receipt_date ?? "")) errors.receipt_date = "Isi Tanggal Terima.";
  else if (input.receipt_date > today) errors.receipt_date = "Tanggal Terima tidak boleh di masa depan.";
  const note = text(input.note);
  if (p.noteLabel && !note) errors.note = `Isi ${p.noteLabel}.`;

  let source: SourceView | null = null;
  if (p.source) {
    source = Number(input.source_id) ? await sourceOf(purpose, Number(input.source_id), db) : null;
    if (!source) errors.source_id = "Pilih sumber yang akan diterima.";
    else {
      if ((await heldSources(db, exceptId)).has(holdKey(source))) errors.source_id = TAKEN;
      if (DAY.test(input.receipt_date ?? "") && input.receipt_date < source.date) errors.receipt_date = `Tidak sebelum ${source.no} (${source.date}).`;
    }
  }
  const warehouseId = source ? source.warehouseId : Number(input.warehouse_id) || null;
  const warehouse = warehouseId ? await db.refWarehouse.findUnique({ where: { id: warehouseId }, select: { id: true, status: true, warehouse_label: true } }) : null;
  if (!warehouse) errors.warehouse_id = "Pilih Gudang.";
  else if (warehouse.status !== "Active") errors.warehouse_id = `Gudang ${warehouse.warehouse_label} nonaktif.`;
  else if (await isTransitWarehouse(warehouse.id, db)) errors.warehouse_id = TRANSIT_WAREHOUSE_REFUSED;
  const locations = warehouse ? ((await warehouseLocationOptions([warehouse.id], db)).get(warehouse.id) ?? []).filter((l) => l.active).map((l) => l.id) : [];
  const statuses = await stockStatuses(db);

  const given = Array.isArray(input.rows) ? input.rows : [];
  const rows: Row[] = [];
  const place = (g: StockReceiptRowInput | undefined, i: number) => {
    const locationId = Number(g?.location_id) || null;
    if (locations.length ? !locationId || !locations.includes(locationId) : locationId) errors[`rows.${i}.location_id`] = locations.length ? "Pilih lokasi." : "Gudang ini tanpa lokasi.";
    const statusId = Number(g?.stock_status_id) || statuses[0]?.id;
    if (!statuses.some((s) => s.id === statusId)) errors[`rows.${i}.stock_status_id`] = "Pilih status stok.";
    return { locationId, statusId };
  };

  if (source) {
    // Taken whole (W57): quantity, value and production's numbers are the source's.
    source.rows.forEach((r, i) => {
      const g = given.find((x) => Number(x.key) === r.key);
      const bonus = purpose === "purchase_bonus";
      const trackingNo = bonus ? (text(g?.tracking_no) ?? r.lotNo).toUpperCase() : r.lotNo;
      const expiry = bonus ? (g?.expiry_date === undefined ? r.expiry : text(g.expiry_date)) : r.expiry;
      if (expiry && !DAY.test(expiry)) errors[`rows.${i}.expiry_date`] = "Tanggal kadaluarsa tidak valid.";
      else if (bonus && r.hasExpiry && !expiry) errors[`rows.${i}.expiry_date`] = `${r.itemLabel} memiliki kadaluarsa: isi tanggalnya.`;
      rows.push({
        itemId: r.itemId,
        trackingNo,
        expiry: expiry && DAY.test(expiry) ? asDate(expiry) : null,
        jobNo: r.jobNo,
        grams: r.grams == null ? null : r.grams.toFixed(6),
        baseQty: r.qty.toFixed(6),
        value: p.valueRule === "zero" ? 0 : r.value,
        ...place(g, i),
      });
    });
  } else {
    if (!given.length) errors._rows = "Isi barang yang diterima.";
    const items = await db.mItem.findMany({ where: { id: { in: given.map((g) => Number(g.item_id) || 0) } }, select: { id: true, item_label: true, item_type: true, track_stock: true, has_expiry: true, status: true } });
    given.forEach((g, i) => {
      const item = items.find((x) => x.id === Number(g.item_id));
      if (!item) errors[`rows.${i}.item_id`] = "Pilih barang.";
      else if (item.item_type !== "Barang" || !item.track_stock) errors[`rows.${i}.item_id`] = `${item.item_label} tidak dikelola stoknya.`;
      const trackingNo = (text(g.tracking_no) ?? "").toUpperCase();
      if (!trackingNo) errors[`rows.${i}.tracking_no`] = "Isi No. Stok.";
      const expiry = text(g.expiry_date);
      if (expiry && !DAY.test(expiry)) errors[`rows.${i}.expiry_date`] = "Tanggal kadaluarsa tidak valid.";
      else if (item?.has_expiry && !expiry) errors[`rows.${i}.expiry_date`] = `${item.item_label} memiliki kadaluarsa: isi tanggalnya.`;
      const qty = num(g.base_qty);
      if (!(qty > 0)) errors[`rows.${i}.base_qty`] = "Isi jumlah lebih dari 0.";
      else if (!/^\d+(\.\d{1,6})?$/.test(String(qty))) errors[`rows.${i}.base_qty`] = "Paling banyak 6 angka desimal.";
      const value = num(g.value);
      if (!(value >= 0) || !Number.isInteger(value)) errors[`rows.${i}.value`] = "Isi nilai dalam rupiah utuh, tidak negatif.";
      rows.push({ itemId: item?.id ?? 0, trackingNo, expiry: expiry && DAY.test(expiry) ? asDate(expiry) : null, jobNo: null, grams: null, baseQty: qty > 0 ? qty.toFixed(6) : "0", value: value >= 0 ? value : 0, ...place(g, i) });
    });
  }
  // A bonus and a typed receipt bring new No. Stok (W10), each once.
  if (purpose === "purchase_bonus" || purpose === "other_receipt") {
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      if (r.trackingNo && seen.has(r.trackingNo)) errors[`rows.${i}.tracking_no`] = `No. Stok ${r.trackingNo} dipakai dua kali.`;
      seen.add(r.trackingNo);
    });
    const known = await trackingsByNo(db, [...seen].filter(Boolean));
    rows.forEach((r, i) => {
      if (known.has(r.trackingNo)) errors[`rows.${i}.tracking_no`] = `No. Stok ${r.trackingNo} sudah ada: penerimaan memakai nomor baru.`;
    });
  }
  if (Object.keys(errors).length) return { ok: false as const, errors };
  return { ok: true as const, purpose, source, warehouseId: warehouse!.id, date: asDate(input.receipt_date), note, rows };
}

type Checked = Extract<Awaited<ReturnType<typeof check>>, { ok: true }>;

/** One line per item, its No. Stok in the order given. */
function linesOf(c: Checked) {
  const byItem = new Map<number, Row[]>();
  for (const r of c.rows) byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), r]);
  return [...byItem].map(([item_id, rs], i) => ({
    line_no: i + 1,
    item_id,
    base_qty: rs.reduce((a, r) => a.add(r.baseQty), new Prisma.Decimal(0)).toFixed(6),
    base_cost_amount: rs.reduce((a, r) => a + r.value, 0),
    trackings: {
      create: rs.map((r, n) => ({ seq: n + 1, tracking_no: r.trackingNo, expiry_date: r.expiry, job_no: r.jobNo, base_qty: r.baseQty, grams: r.grams, base_cost_amount: r.value, location_id: r.locationId, stock_status_id: r.statusId })),
    },
  }));
}

async function headerOf(db: Db, c: Checked) {
  const s = c.source;
  return {
    purpose: c.purpose,
    receipt_date: c.date,
    warehouse_id: c.warehouseId,
    note: c.note,
    from_unit_id: s && s.purpose !== "purchase_bonus" ? ((await db.logStockReceiptInbox.findUnique({ where: { id: s.id }, select: { from_unit_id: true } }))?.from_unit_id ?? null) : null,
    inbox_id: s && s.purpose !== "purchase_bonus" ? s.id : null,
    source_doc_type_id: s?.purpose === "purchase_bonus" ? await docTypeId(db, "log_receipt_note") : null,
    source_doc_id: s?.purpose === "purchase_bonus" ? s.id : null,
    source_no: s?.no ?? null,
    value_mode: s?.valueMode ?? null,
    base_cost_amount: c.rows.reduce((a, r) => a + r.value, 0),
  };
}

// ------------------------------------------------------------- save / cancel

export async function createStockReceipt(input: StockReceiptInput, actorId: number): Promise<StockReceiptResult> {
  const first = await check(prisma, input, null);
  if (!first.ok) return first;
  return refusable(() =>
    prisma.$transaction(async (tx) => {
      const c = await check(tx, input, null);
      if (!c.ok) throw new Refused(c.errors);
      const no = await nextDocumentNumber("SRC", c.date, async (series) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${series}))`;
        const row = await tx.logStockReceipt.findFirst({ where: { receipt_no: { startsWith: series } }, orderBy: { receipt_no: "desc" }, select: { receipt_no: true } });
        return row?.receipt_no ?? null;
      });
      const row = await tx.logStockReceipt.create({ data: { receipt_no: no, ...(await headerOf(tx, c)), created_by: actorId, lines: { create: linesOf(c) } } });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return { ok: true as const, id: row.id, no };
    })
  );
}

export async function updateStockReceipt(id: number, input: StockReceiptInput, actorId: number): Promise<StockReceiptResult> {
  const current = await prisma.logStockReceipt.findUnique({ where: { id }, select: { status: true, purpose: true, inbox_id: true, source_doc_id: true, receipt_no: true } });
  if (!current) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (current.status !== "Draft") return { ok: false, errors: { _form: "Hanya Draft yang dapat diubah." } };
  // Purpose and source are chosen once.
  const fixed = { ...input, purpose: current.purpose, source_id: current.inbox_id ?? current.source_doc_id };
  const first = await check(prisma, fixed, id);
  if (!first.ok) return first;
  return refusable(() =>
    prisma.$transaction(async (tx) => {
      const locked = await tx.logStockReceipt.updateMany({ where: { id, status: "Draft" }, data: { updated_by: actorId } });
      if (locked.count !== 1) throw new Refused({ _form: "Dokumen ini berubah. Muat ulang." });
      const c = await check(tx, fixed, id);
      if (!c.ok) throw new Refused(c.errors);
      await tx.logStockReceiptTracking.deleteMany({ where: { line: { stock_receipt_id: id } } });
      await tx.logStockReceiptLine.deleteMany({ where: { stock_receipt_id: id } });
      await tx.logStockReceipt.update({ where: { id }, data: { ...(await headerOf(tx, c)), updated_by: actorId, lines: { create: linesOf(c) } } });
      await audit(tx, id, "UPDATE", "update", actorId);
      return { ok: true as const, id, no: current.receipt_no };
    })
  );
}

export async function cancelStockReceipt(id: number, reason: string, actorId: number): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  const why = text(reason);
  if (!why) return { ok: false, errors: { reason: "Isi alasan pembatalan." } };
  const done = await prisma.$transaction(async (tx) => {
    const r = await tx.logStockReceipt.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", status_reason: why, updated_by: actorId } });
    if (r.count === 1) await audit(tx, id, "UPDATE", "cancel", actorId);
    return r.count === 1;
  });
  return done ? { ok: true } : { ok: false, errors: { _form: "Hanya Draft yang dapat dibatalkan. Muat ulang." } };
}

// ---------------------------------------------------------- Terima / Posting

const WITH_LINES = { warehouse: true, from_unit: true, inbox: true, lines: { orderBy: { line_no: "asc" as const }, include: { item: { include: { base_uom: true } }, trackings: { orderBy: { seq: "asc" as const } } } } };

export async function receiveStockReceipt(
  id: number,
  actorId: number,
  options: { dryRun?: boolean } = {}
): Promise<{ ok: true; no: string; journal?: JournalLineInput[] } | { ok: false; errors: Record<string, string> }> {
  const r = await prisma.logStockReceipt.findUnique({ where: { id }, include: WITH_LINES });
  if (!r) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (r.status !== "Draft") return { ok: false, errors: { _form: "Dokumen ini sudah diproses. Muat ulang." } };
  const purpose = stockReceiptPurposeOf(r.purpose);
  const p = STOCK_RECEIPT_PURPOSES[purpose];
  const date = isoDay(r.receipt_date);
  if (date > todayIso()) return { ok: false, errors: { _form: "Tanggal Terima di masa depan: terima pada hari itu atau sesudahnya." } };
  const fromProduction = p.source === "production";
  if (fromProduction && !r.inbox) return { ok: false, errors: { _form: "Kiriman produksinya tidak ditemukan." } };
  const mode: ProductionValueMode | null = fromProduction ? (r.value_mode === "none" ? "none" : "carried") : null;
  const bonus = purpose === "purchase_bonus" ? (await postedBonuses({ ids: r.source_doc_id ? [r.source_doc_id] : [] }))[0] : null;
  if (purpose === "purchase_bonus" && !bonus) return { ok: false, errors: { _form: "Bonus Receipt Note-nya tidak ditemukan." } };

  // What each line debits and credits; a bonus writes no journal.
  const accounts = new Map<number, { debit: number; credit: number }>();
  if (p.valueRule !== "zero") {
    const fallback = await fallbackAccounts(["inventory_account", "production_scrap_account", "stock_other_receipt_account"] as const);
    if (mode === "none" && !fallback.production_scrap_account) return { ok: false, errors: { _form: "Lengkapi Account Mapping dulu: Account Beban Pemusnahan Produksi." } };
    if (p.valueRule === "typed" && !fallback.stock_other_receipt_account) return { ok: false, errors: { _form: "Lengkapi Account Mapping dulu: Account Penerimaan Persediaan Lain-lain." } };
    const byCategory = await accountsForItems(r.lines.map((l) => l.item_id));
    for (const l of r.lines) {
      const c = byCategory.get(l.item_id);
      const inventory = c?.inventory ?? fallback.inventory_account;
      const debit = mode === "none" ? fallback.production_scrap_account : inventory;
      const credit = fromProduction ? c?.wip : fallback.stock_other_receipt_account;
      if (!debit || !credit) {
        const missing = [!debit && "Persediaan", !credit && (fromProduction ? "WIP" : "Penerimaan Persediaan Lain-lain")].filter(Boolean).join(" dan ");
        return { ok: false, errors: { _form: `Lengkapi Account Kategori Item dulu: Account ${missing} untuk ${l.item.item_label}.` } };
      }
      accounts.set(l.item_id, { debit, credit });
    }
  }
  const base = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!base) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };
  const to = stockReceiptTransitions(purpose).receive.to;

  return refusable(() =>
    prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, date);
      const posted = asDate(date);
      const done = await tx.logStockReceipt.updateMany({ where: { id, status: "Draft" }, data: { status: to, received_at: asDate(todayIso()), received_by: actorId, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Dokumen ini berubah saat diproses. Muat ulang." });
      const source = { docTypeId: await docTypeId(tx), docId: id, no: r.receipt_no };
      const journalLines: JournalLineInput[] = [];
      const from = fromProduction ? (r.from_unit?.unit_label ?? r.inbox!.unit_label) : (r.source_no ?? p.name);
      const made = new Set<string>();
      for (const l of r.lines) {
        let value = 0;
        for (const t of l.trackings) {
          const v = p.valueRule === "zero" || mode === "none" ? 0 : t.base_cost_amount.toNumber();
          // Production's own No. Stok come back; a bonus and a typed receipt bring new ones (W10).
          if (!fromProduction && !made.has(t.tracking_no)) await assertNewTrackingNo(tx, t.tracking_no);
          made.add(t.tracking_no);
          await receiveStock(tx, {
            itemId: l.item_id,
            warehouseId: r.warehouse_id,
            locationId: t.location_id,
            lotNo: t.tracking_no,
            expiry: t.expiry_date,
            baseQty: t.base_qty,
            value: v,
            date: posted,
            source,
            partnerId: bonus?.partnerId,
            statusId: t.stock_status_id ?? undefined,
            actorId,
          });
          value += t.base_cost_amount.toNumber();
        }
        const acc = accounts.get(l.item_id);
        if (!(value > 0) || !acc) continue;
        const what = `${l.item.item_label} · ${from} → ${r.warehouse.warehouse_label}`;
        journalLines.push(
          { accountId: acc.debit, currencyId: base.id, rate: 1, debit: value, credit: 0, description: mode === "none" ? `Tanpa nilai ${what}` : `Masuk ${what}` },
          { accountId: acc.credit, currencyId: base.id, rate: 1, debit: 0, credit: value, description: fromProduction ? `Keluar WIP ${what}` : `${p.name} ${what}` }
        );
      }
      const journal = journalLines.length
        ? await postJournal(tx, { description: `${r.receipt_no} · ${p.name} ${from} → ${r.warehouse.warehouse_label}`, sourceDocTypeId: source.docTypeId, sourceDocId: id, postingDate: posted, actorId, lines: journalLines })
        : null;
      await tx.logStockReceipt.update({ where: { id }, data: { base_written_off_amount: mode === "none" ? r.base_cost_amount : 0, journal_id: journal?.id ?? null } });
      if (fromProduction) await deliver(tx, { type: "ReceiptReceived", no: r.inbox!.sent_no, date }, actorId);
      await audit(tx, id, "UPDATE", "receive", actorId);
      if (options.dryRun) throw new PostingDryRun(journalLines);
      return { ok: true as const, no: r.receipt_no };
    })
  );
}

export async function stockReceiptPreview(id: number, actorId: number): Promise<JournalPreviewResult> {
  const r = await receiveStockReceipt(id, actorId, { dryRun: true });
  return r.ok ? { ok: true, lines: await describeJournalLines(r.journal ?? []) } : r;
}

// --------------------------------------------------------------------- reads

export type StockReceiptRow = {
  id: number;
  no: string;
  purpose: StockReceiptPurposeKey;
  date: string;
  status: StockReceiptStatus;
  /** The sending Unit; empty otherwise. */
  unitLabel: string;
  unitName: string;
  /** The Receipt Note of a bonus, or the Production Issue's number. */
  sourceId: number | null;
  sourceNo: string | null;
  warehouseLabel: string;
  warehouseName: string;
  lots: number;
  cost: number;
};

type ListRow = Prisma.LogStockReceiptGetPayload<{ include: { from_unit: true; warehouse: true } }>;
const rowOf = (r: ListRow, lots: number): StockReceiptRow => ({
  id: r.id,
  no: r.receipt_no,
  purpose: stockReceiptPurposeOf(r.purpose),
  date: isoDay(r.receipt_date),
  status: r.status,
  unitLabel: r.from_unit?.unit_label ?? "",
  unitName: r.from_unit?.unit_name ?? "",
  sourceId: r.purpose === "purchase_bonus" ? r.source_doc_id : null,
  sourceNo: r.source_no,
  warehouseLabel: r.warehouse.warehouse_label,
  warehouseName: r.warehouse.warehouse_name,
  lots,
  cost: r.base_cost_amount.toNumber(),
});

/** `warehouses`: the actor's (OD-9), or null for all. */
export async function listStockReceipts(warehouses: number[] | null = null): Promise<StockReceiptRow[]> {
  const rows = await prisma.logStockReceipt.findMany({
    where: warehouses ? { warehouse_id: { in: warehouses } } : undefined,
    orderBy: [{ receipt_date: "desc" }, { id: "desc" }],
    include: { from_unit: true, warehouse: true, lines: { select: { _count: { select: { trackings: true } } } } },
  });
  return rows.map((r) => rowOf(r, r.lines.reduce((a, l) => a + l._count.trackings, 0)));
}

export type StockReceiptView = StockReceiptRow & {
  warehouseId: number;
  sourceKey: number | null;
  valueMode: ProductionValueMode | null;
  receivedAt: string | null;
  note: string | null;
  statusReason: string | null;
  writtenOff: number;
  journalId: number | null;
  journalNo: string | null;
  rows: {
    key: number | null;
    itemId: number;
    itemLabel: string;
    itemName: string;
    uomLabel: string;
    hasExpiry: boolean;
    trackingNo: string;
    expiry: string | null;
    jobNo: string | null;
    qty: number;
    grams: number | null;
    value: number;
    locationId: number | null;
    locationLabel: string | null;
    statusId: number | null;
    statusName: string | null;
  }[];
};

export async function getStockReceipt(id: number): Promise<StockReceiptView | null> {
  const r = await prisma.logStockReceipt.findUnique({ where: { id }, include: WITH_LINES });
  if (!r) return null;
  const stored = r.lines.flatMap((l) => l.trackings.map((t) => ({ l, t })));
  const purpose = stockReceiptPurposeOf(r.purpose);
  const sourceKey = r.inbox_id ?? (purpose === "purchase_bonus" ? r.source_doc_id : null);
  const [journals, labels, statuses, source] = await Promise.all([
    r.journal_id ? journalNumbersByIds([r.journal_id]) : new Map<number, string>(),
    locationLabelsByIds(stored.flatMap(({ t }) => (t.location_id ? [t.location_id] : []))),
    stockStatuses(),
    r.status === "Draft" && sourceKey ? sourceOf(purpose, sourceKey) : null,
  ]);
  // A stored row finds its source row again: production by No. Stok, a bonus by item in order.
  const keys = (source?.rows ?? []).slice();
  const keyOf = (itemId: number, trackingNo: string) => {
    const i = keys.findIndex((k) => (purpose === "purchase_bonus" ? k.itemId === itemId : k.lotNo === trackingNo));
    return i < 0 ? null : keys.splice(i, 1)[0].key;
  };
  return {
    ...rowOf(r, stored.length),
    warehouseId: r.warehouse_id,
    sourceKey,
    valueMode: r.value_mode === "none" ? "none" : r.value_mode === "carried" ? "carried" : null,
    receivedAt: r.received_at ? isoDay(r.received_at) : null,
    note: r.note,
    statusReason: r.status_reason,
    writtenOff: r.base_written_off_amount.toNumber(),
    journalId: r.journal_id,
    journalNo: r.journal_id ? (journals.get(r.journal_id) ?? null) : null,
    rows: stored.map(({ l, t }) => ({
      key: keyOf(l.item_id, t.tracking_no),
      itemId: l.item_id,
      itemLabel: l.item.item_label,
      itemName: l.item.item_name,
      uomLabel: l.item.base_uom.uom_label,
      hasExpiry: l.item.has_expiry,
      trackingNo: t.tracking_no,
      expiry: t.expiry_date ? isoDay(t.expiry_date) : null,
      jobNo: t.job_no,
      qty: t.base_qty.toNumber(),
      grams: t.grams?.toNumber() ?? null,
      value: t.base_cost_amount.toNumber(),
      locationId: t.location_id,
      locationLabel: t.location_id ? (labels.get(t.location_id) ?? null) : null,
      statusId: t.stock_status_id,
      statusName: statuses.find((s) => s.id === t.stock_status_id)?.name ?? null,
    })),
  };
}

/** The Bonus Pembelian a Receipt Note's bonus was received by, for its own page. */
export async function bonusReceiptOf(receiptNoteId: number): Promise<{ id: number; no: string } | null> {
  const row = await prisma.logStockReceipt.findFirst({ where: { purpose: "purchase_bonus", source_doc_id: receiptNoteId, status: { not: "Cancelled" } }, select: { id: true, receipt_no: true } });
  return row ? { id: row.id, no: row.receipt_no } : null;
}

/** The warehouse a receipt goes to, checked per user (OD-9). */
export async function stockReceiptWarehouse(id: number): Promise<number | null> {
  return (await prisma.logStockReceipt.findUnique({ where: { id }, select: { warehouse_id: true } }))?.warehouse_id ?? null;
}

export async function stockReceiptNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.logStockReceipt.findMany({ where: { id: { in: ids } }, select: { id: true, receipt_no: true } });
  return new Map(rows.map((r) => [r.id, r.receipt_no]));
}
