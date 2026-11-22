import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { dailySeries, nextDailyNumber } from "./document-number";
import { BASE_CURRENCY_LABEL } from "./currency";
import { holdPostingPeriod, PeriodShut } from "./fiscal";
import { PostingDryRun, describeJournalLines, journalNumbersByIds, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { InventoryRefusal, receiveStock } from "./inventory";
import { ProductionRefusal, availableBuckets, bucketsByIds, sendInTransit, takeFromBucket, trackingsByIds, type BucketView } from "./production-ledger";
import { endsLine, routeMap } from "./production-master";
import { fallbackAccounts, isTransitWarehouse } from "./system-settings";
import { accountsForItems } from "./item-account";
import type { ProductionReceiptStatus } from "./production-receipt-shape";

/**
 * BSTB ke Finish Goods (P303, Simulasi-Gudang-Produksi-Plan.md 7.5): its tables
 * are `log_production_receipt` and `log_production_receipt_line`, and nothing
 * else names them.
 *
 * **Kirim** (the Produksi application): goods in Stand By of the Unit that ends
 * a line's routing — Packing 95's kotak — are sent whole to a warehouse without
 * locations. They stay at the Unit as Dalam Perjalanan (`sendInTransit`), a
 * status rather than a reservation, as a BSTB between Units does (T4). No
 * Draft, no journal, no QC (plan §5.1).
 *
 * **Terima** (the warehouse, in the ERP): each line leaves the production book
 * at the value it carries (`takeFromBucket`) and enters stock under **the same
 * No. Stok** at that value (`receiveStock`). One journal, **Dr Persediaan / Cr
 * WIP** per item: WIP the Kategori Item's with no fallback (R16), Persediaan the
 * category's, else Account Mapping's — the BSTB Issue reversed. Dated the day
 * of Terima; the confirmation shows it by dry run (P103).
 */

type Db = Prisma.TransactionClient | typeof prisma;

export { PRODUCTION_RECEIPT_PATH, PRODUCTION_RECEIPT_STATUS_TEXT, type ProductionReceiptStatus } from "./production-receipt-shape";

export type FinishGoodsInput = { from_unit_id: number | null; warehouse_id: number | null; receipt_date: string; note: string; bucket_ids: number[] };
export type FinishGoodsResult = { ok: true; id: number; no: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const series = (unitLabel: string, date: Date) => dailySeries(`BFG_${unitLabel}`, date);

class Refused extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("refused");
  }
}

async function refusable<T>(run: () => Promise<T>): Promise<T | { ok: false; errors: Record<string, string> }> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof Refused) return { ok: false, errors: e.errors };
    if (e instanceof PeriodShut) return { ok: false, errors: { _form: e.message } };
    if (e instanceof InventoryRefusal || e instanceof ProductionRefusal) return { ok: false, errors: { _form: `Belum bisa diproses: ${e.message}` } };
    if (e instanceof PostingDryRun) return { ok: true, journal: e.lines } as T;
    throw e;
  }
}

async function docTypeId(db: Db): Promise<number> {
  const t = await db.sysDocType.findFirst({ where: { doc_table: "log_production_receipt" }, select: { id: true } });
  if (!t) throw new Refused({ _form: "Tipe dokumen BSTB ke Finish Goods belum ada. Jalankan npm run db:seed." });
  return t.id;
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "log_production_receipt", row_id: id, action, event, by } });
}

/** Warehouses that take finished goods: active, no locations, not the Gudang Transit (plan §5.3). */
async function receivingWarehouses(db: Db) {
  const rows = await db.refWarehouse.findMany({ where: { status: "Active", locations: { none: {} } }, orderBy: { warehouse_code: "asc" }, select: { id: true, warehouse_label: true, warehouse_name: true } });
  const out = [];
  for (const w of rows) if (!(await isTransitWarehouse(w.id, db))) out.push({ id: w.id, label: w.warehouse_label, name: w.warehouse_name });
  return out;
}

// -------------------------------------------------------------------- Kirim

async function check(db: Db, input: FinishGoodsInput) {
  const errors: Record<string, string> = {};
  const unitId = Number(input.from_unit_id) || null;
  const unit = unitId ? await db.refUnit.findUnique({ where: { id: unitId } }) : null;
  if (!unit) errors.from_unit_id = "Pilih Unit asal.";
  else if (unit.status !== "Active") errors.from_unit_id = `Unit ${unit.unit_label} nonaktif.`;
  else if (!endsLine(await routeMap(), unit.id)) errors.from_unit_id = `${unit.unit_label} bukan Unit terakhir routing: kirim lewat Push atau BSTB.`;
  const warehouseId = Number(input.warehouse_id) || null;
  if (!warehouseId || !(await receivingWarehouses(db)).some((w) => w.id === warehouseId)) errors.warehouse_id = "Pilih Gudang aktif tanpa Lokasi.";
  if (!DAY.test(input.receipt_date)) errors.receipt_date = "Isi tanggal.";
  const ids = [...new Set((input.bucket_ids ?? []).map(Number).filter(Boolean))];
  if (!ids.length) errors._lines = "Pilih barang yang dikirim.";
  const buckets = await bucketsByIds(ids, db);
  const rows: BucketView[] = [];
  for (const id of ids) {
    const b = buckets.get(id);
    if (!b || b.unitId !== unit?.id || b.stage !== "StandBy" || b.auxiliary || !(b.qty > 0)) errors._lines = "Ada barang yang tidak lagi di Stand By unit ini. Muat ulang.";
    else rows.push(b);
  }
  // A Job leaves whole (W96): every No. Stok of it in this Stand By.
  const jobIds = [...new Set(rows.flatMap((r) => (r.jobId ? [r.jobId] : [])))];
  if (!errors._lines && jobIds.length) {
    const held = (await availableBuckets({ unitIds: [unit!.id], stage: "StandBy" }, db)).filter((b) => b.jobId && jobIds.includes(b.jobId) && !b.auxiliary && b.qty > 0);
    const short = held.find((b) => !ids.includes(b.id));
    if (short) errors._lines = `No. Job ${short.jobNo} dikirim utuh: ${short.lotNo} belum ikut.`;
  }
  if (Object.keys(errors).length) return { ok: false as const, errors };
  return { ok: true as const, unit: unit!, warehouseId: warehouseId!, rows, date: asDate(input.receipt_date), note: String(input.note ?? "").trim() || null };
}

/** Kirim ke Finish Goods: the goods wait as Dalam Perjalanan at the Unit until the warehouse presses Terima. */
export async function sendFinishGoods(input: FinishGoodsInput, actorId: number): Promise<FinishGoodsResult> {
  const first = await check(prisma, input);
  if (!first.ok) return first;
  return refusable(() =>
    prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, input.receipt_date);
      const c = await check(tx, input);
      if (!c.ok) throw new Refused(c.errors);
      const s = series(c.unit.unit_label, c.date);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${s}))`;
      const last = await tx.logProductionReceipt.findFirst({ where: { receipt_no: { startsWith: s } }, orderBy: { receipt_no: "desc" }, select: { receipt_no: true } });
      const no = nextDailyNumber(s, last?.receipt_no ?? null);
      const header = await tx.logProductionReceipt.create({
        data: { receipt_no: no, purpose: "finish_goods", receipt_date: c.date, status: "Submitted", from_unit_id: c.unit.id, warehouse_id: c.warehouseId, note: c.note, created_by: actorId },
      });
      const source = { docTypeId: await docTypeId(tx), docId: header.id, no };
      let lineNo = 0;
      for (const b of c.rows) {
        const moved = await sendInTransit(tx, { bucketId: b.id, baseQty: b.qty, date: c.date, source, actorId, doc: source });
        await tx.logProductionReceiptLine.create({
          data: { receipt_id: header.id, line_no: ++lineNo, item_id: b.itemId, tracking_id: b.lotId, job_id: b.jobId, qty: b.qty, grams: b.grams, from_bucket_id: b.id, transit_bucket_id: moved.toBucketId },
        });
      }
      await audit(tx, header.id, "TAMBAH", "send", actorId);
      return { ok: true as const, id: header.id, no };
    })
  );
}

// ------------------------------------------------------------------- Terima

/** Terima: out of production, into the warehouse under the same No. Stok, Dr Persediaan / Cr WIP. `dryRun` returns the journal and writes nothing (P103). */
export async function receiveFinishGoods(id: number, actorId: number, options: { dryRun?: boolean } = {}): Promise<{ ok: true; no: string; journal?: JournalLineInput[] } | { ok: false; errors: Record<string, string> }> {
  const r = await prisma.logProductionReceipt.findUnique({ where: { id }, include: { warehouse: true, from_unit: true, lines: { orderBy: { line_no: "asc" }, include: { item: true } } } });
  if (!r) return { ok: false, errors: { _form: "BSTB ke Finish Goods tidak ditemukan." } };
  if (r.status !== "Submitted") return { ok: false, errors: { _form: "BSTB ini sudah diterima. Muat ulang." } };
  const today = isoDay(new Date());
  if (today < isoDay(r.receipt_date)) return { ok: false, errors: { _form: "Tanggal kirim di masa depan: Terima pada hari itu atau sesudahnya." } };

  const fallback = await fallbackAccounts(["inventory_account"] as const);
  const byCategory = await accountsForItems([...new Set(r.lines.map((l) => l.item_id))]);
  const accounts = new Map<number, { wip: number; inventory: number }>();
  for (const l of r.lines) {
    const c = byCategory.get(l.item_id);
    const inventory = c?.inventory ?? fallback.inventory_account;
    if (!c?.wip || !inventory) {
      const missing = [!c?.wip && "WIP", !inventory && "Persediaan"].filter(Boolean).join(" dan ");
      return { ok: false, errors: { _form: `Lengkapi Account Kategori Item dulu: Account ${missing} untuk ${l.item.item_label}.` } };
    }
    accounts.set(l.item_id, { wip: c.wip, inventory });
  }
  const base = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!base) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };

  return refusable(() =>
    prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, today);
      const done = await tx.logProductionReceipt.updateMany({ where: { id, status: "Submitted" }, data: { status: "Posted", received_at: asDate(today), received_by: actorId, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "BSTB ini berubah saat diproses. Muat ulang." });
      const date = asDate(today);
      const source = { docTypeId: await docTypeId(tx), docId: id, no: r.receipt_no };
      const perItem = new Map<number, number>();
      let total = 0;
      for (const l of r.lines) {
        // Production first, then stock: the value released is what comes in.
        const out = await takeFromBucket(tx, { bucketId: l.transit_bucket_id, baseQty: l.qty, date, source, actorId });
        await receiveStock(tx, { itemId: l.item_id, warehouseId: r.warehouse_id, lotNo: out.lotNo, expiry: out.expiry, baseQty: l.qty, value: out.value, date, source, actorId });
        await tx.logProductionReceiptLine.update({ where: { id: l.id }, data: { value: out.value } });
        perItem.set(l.item_id, (perItem.get(l.item_id) ?? 0) + out.value);
        total += out.value;
      }
      const lines: JournalLineInput[] = [];
      for (const [itemId, value] of perItem) {
        if (!(value > 0)) continue;
        const item = r.lines.find((l) => l.item_id === itemId)!.item;
        const acc = accounts.get(itemId)!;
        const what = `${item.item_label} · ${r.from_unit.unit_label} → ${r.warehouse.warehouse_label}`;
        lines.push(
          { accountId: acc.inventory, currencyId: base.id, rate: 1, debit: value, credit: 0, description: `Masuk ${what}` },
          { accountId: acc.wip, currencyId: base.id, rate: 1, debit: 0, credit: value, description: `Keluar WIP ${what}` }
        );
      }
      // Goods carried at no value come in with no journal.
      const journal = lines.length
        ? await postJournal(tx, { description: `${r.receipt_no} · BSTB ke Finish Goods ${r.from_unit.unit_label} → ${r.warehouse.warehouse_label}`, sourceDocTypeId: source.docTypeId, sourceDocId: id, postingDate: date, actorId, lines })
        : null;
      await tx.logProductionReceipt.update({ where: { id }, data: { cost_amount: total, journal_id: journal?.id ?? null } });
      await audit(tx, id, "UPDATE", "receive", actorId);
      if (options.dryRun) throw new PostingDryRun(lines);
      return { ok: true as const, no: r.receipt_no };
    })
  );
}

export async function productionReceiptPreview(id: number, actorId: number): Promise<JournalPreviewResult> {
  const r = await receiveFinishGoods(id, actorId, { dryRun: true });
  return r.ok ? { ok: true, lines: await describeJournalLines(r.journal ?? []) } : r;
}

// -------------------------------------------------------------------- reads

export type FinishGoodsOptions = { unit: { id: number; label: string; name: string }; endsLine: boolean; buckets: BucketView[]; warehouses: { id: number; label: string; name: string }[] };

/** The Kirim form: the Unit's Stand By and the warehouses that take finished goods. */
export async function finishGoodsOptions(unitId: number): Promise<FinishGoodsOptions | null> {
  const unit = await prisma.refUnit.findUnique({ where: { id: unitId }, select: { id: true, unit_label: true, unit_name: true } });
  if (!unit) return null;
  const [buckets, map, warehouses] = await Promise.all([availableBuckets({ unitIds: [unitId], stage: "StandBy" }), routeMap(), receivingWarehouses(prisma)]);
  return { unit: { id: unit.id, label: unit.unit_label, name: unit.unit_name }, endsLine: endsLine(map, unitId), buckets: buckets.filter((b) => !b.auxiliary && b.qty > 0), warehouses };
}

export type ProductionReceiptRow = { id: number; no: string; date: string; status: ProductionReceiptStatus; unitLabel: string; unitName: string; warehouseLabel: string; warehouseName: string; lines: number; qty: number };

/** `warehouses`: the actor's, or null for all (OD-9). */
export async function listProductionReceipts(warehouses: number[] | null = null): Promise<ProductionReceiptRow[]> {
  const rows = await prisma.logProductionReceipt.findMany({
    where: warehouses ? { warehouse_id: { in: warehouses } } : undefined,
    orderBy: [{ receipt_date: "desc" }, { id: "desc" }],
    include: { from_unit: true, warehouse: true, lines: { select: { qty: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    no: r.receipt_no,
    date: isoDay(r.receipt_date),
    status: r.status,
    unitLabel: r.from_unit.unit_label,
    unitName: r.from_unit.unit_name,
    warehouseLabel: r.warehouse.warehouse_label,
    warehouseName: r.warehouse.warehouse_name,
    lines: r.lines.length,
    qty: r.lines.reduce((a, l) => a + l.qty.toNumber(), 0),
  }));
}

export type ProductionReceiptView = ProductionReceiptRow & {
  warehouseId: number;
  receivedAt: string | null;
  note: string | null;
  cost: number;
  journalId: number | null;
  journalNo: string | null;
  items: { lineNo: number; lotNo: string; itemLabel: string; itemName: string; uomLabel: string; qty: number; grams: number | null; value: number }[];
};

export async function getProductionReceipt(id: number): Promise<ProductionReceiptView | null> {
  const r = await prisma.logProductionReceipt.findUnique({ where: { id }, include: { from_unit: true, warehouse: true, lines: { orderBy: { line_no: "asc" } } } });
  if (!r) return null;
  const [trackings, journals] = await Promise.all([trackingsByIds(r.lines.map((l) => l.tracking_id)), r.journal_id ? journalNumbersByIds([r.journal_id]) : new Map<number, string>()]);
  return {
    id: r.id,
    no: r.receipt_no,
    date: isoDay(r.receipt_date),
    status: r.status,
    unitLabel: r.from_unit.unit_label,
    unitName: r.from_unit.unit_name,
    warehouseLabel: r.warehouse.warehouse_label,
    warehouseName: r.warehouse.warehouse_name,
    warehouseId: r.warehouse_id,
    lines: r.lines.length,
    qty: r.lines.reduce((a, l) => a + l.qty.toNumber(), 0),
    receivedAt: r.received_at ? isoDay(r.received_at) : null,
    note: r.note,
    cost: r.cost_amount.toNumber(),
    journalId: r.journal_id,
    journalNo: r.journal_id ? (journals.get(r.journal_id) ?? null) : null,
    items: r.lines.map((l) => {
      const t = trackings.get(l.tracking_id);
      return { lineNo: l.line_no, lotNo: t?.no ?? "", itemLabel: t?.itemLabel ?? "", itemName: t?.itemName ?? "", uomLabel: t?.uomLabel ?? "", qty: l.qty.toNumber(), grams: l.grams?.toNumber() ?? null, value: l.value.toNumber() };
    }),
  };
}

export async function productionReceiptWarehouse(id: number): Promise<number | null> {
  return (await prisma.logProductionReceipt.findUnique({ where: { id }, select: { warehouse_id: true } }))?.warehouse_id ?? null;
}

export async function productionReceiptNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.logProductionReceipt.findMany({ where: { id: { in: ids } }, select: { id: true, receipt_no: true } });
  return new Map(rows.map((r) => [r.id, r.receipt_no]));
}
