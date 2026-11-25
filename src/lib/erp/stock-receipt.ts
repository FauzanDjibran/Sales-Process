import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { BASE_CURRENCY_LABEL } from "./currency";
import { holdPostingPeriod, PeriodShut } from "./fiscal";
import { HandoverRefusal, deliver, type HandoverMessage } from "./handover";
import { PostingDryRun, describeJournalLines, journalNumbersByIds, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { nextDocumentNumber } from "./document-number";
import { InventoryRefusal, assertNewTrackingNo, locationLabelsByIds, receiveStock, warehouseLocationOptions } from "./inventory";
import { fallbackAccounts } from "./system-settings";
import { accountsForItems } from "./item-account";
import { STOCK_RECEIPT_PURPOSES, stockReceiptPurposeOf, type ProductionValueMode, type StockReceiptPurposeKey, type StockReceiptStatus } from "./stock-receipt-purposes";

/**
 * The Stock Receipt (P317): goods coming into a warehouse without a partner, by
 * purpose (`stock-receipt-purposes.ts`). Its tables are `log_stock_receipt`,
 * `_line` and `_tracking`, and nothing else names them. A line is an item; a
 * tracking row is a No. Stok, whole, with the value its sender froze.
 *
 * A **Bonus Pembelian** (P321) is made and received by a weighed Receipt Note's
 * posting (`createBonusReceipt`): new No. Stok at value 0, no journal.
 *
 * The other purposes come from production: `ReceiptSent` makes the
 * receipt under the Production Issue's number. **Terima**, by the warehouse: each
 * No. Stok enters stock **under its own number**, into the location and status
 * the warehouse chose (Tersedia unless said otherwise), at its frozen value or —
 * a BSTB Pengeluaran taken *Tanpa nilai* — at 0. One journal per item, **Cr WIP**
 * (the Kategori Item's, no fallback, R16), **Dr Persediaan** (category, else
 * Account Mapping) or **Dr Beban Pemusnahan Produksi**. Dated the day of Terima;
 * the confirmation shows it by dry run (P103). `ReceiptReceived` then tells
 * Produksi. It writes no production book and reads none.
 */

type Tx = Prisma.TransactionClient;

const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

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
    if (e instanceof InventoryRefusal || e instanceof HandoverRefusal) return { ok: false, errors: { _form: `Belum bisa diproses: ${e.message}` } };
    if (e instanceof PostingDryRun) return { ok: true, journal: e.lines } as T;
    throw e;
  }
}

async function docTypeId(db: Tx): Promise<number> {
  const t = await db.sysDocType.findFirst({ where: { doc_table: "log_stock_receipt" }, select: { id: true } });
  if (!t) throw new Refused({ _form: "Tipe dokumen Stock Receipt belum ada. Jalankan npm run db:seed." });
  return t.id;
}

async function audit(tx: Tx, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await tx.auditLog.create({ data: { entity_key: "log_stock_receipt", row_id: id, action, event, by } });
}

/** Produksi sent goods to a warehouse. Said twice, it makes nothing new. */
export async function takeReceiptSent(tx: Tx, m: Extract<HandoverMessage, { type: "ReceiptSent" }>, actorId: number): Promise<void> {
  if (await tx.logStockReceipt.findUnique({ where: { receipt_no: m.no }, select: { id: true } })) return;
  const warehouse = await tx.refWarehouse.findUnique({ where: { warehouse_code: m.warehouseCode }, select: { id: true } });
  if (!warehouse) throw new HandoverRefusal(`Gudang ${m.warehouseCode} tidak dikenal di ERP.`);
  const unit = await tx.refUnit.findFirst({ where: { unit_label: m.unitLabel }, select: { id: true } });
  const items = new Map((await tx.mItem.findMany({ where: { item_code: { in: m.lines.map((l) => l.itemCode) } }, select: { id: true, item_code: true } })).map((i) => [i.item_code, i.id]));
  const byItem = new Map<number, (typeof m.lines)[number][]>();
  for (const l of m.lines) {
    const itemId = items.get(l.itemCode);
    if (!itemId) throw new HandoverRefusal(`Item ${l.itemCode} tidak dikenal di ERP.`);
    byItem.set(itemId, [...(byItem.get(itemId) ?? []), l]);
  }
  const sum = (ls: (typeof m.lines)[number][], k: "qty" | "value") => ls.reduce((a, l) => a + Number(l[k]), 0);
  const row = await tx.logStockReceipt.create({
    data: {
      receipt_no: m.no,
      purpose: m.purpose,
      receipt_date: asDate(m.date),
      from_unit_id: unit?.id ?? null,
      warehouse_id: warehouse.id,
      note: m.note,
      base_cost_amount: sum(m.lines, "value"),
      created_by: actorId,
      lines: {
        create: [...byItem].map(([item_id, ls], i) => ({
          line_no: i + 1,
          item_id,
          // Quantities carry at most six decimals.
          base_qty: sum(ls, "qty").toFixed(6),
          base_cost_amount: sum(ls, "value"),
          trackings: {
            create: ls.map((l, n) => ({
              seq: n + 1,
              tracking_no: l.trackingNo,
              expiry_date: l.expiry ? asDate(l.expiry) : null,
              job_no: l.jobNo,
              base_qty: l.qty,
              grams: l.grams == null ? null : Number(l.grams).toFixed(6),
              base_cost_amount: l.value,
            })),
          },
        })),
      },
    },
  });
  await audit(tx, row.id, "TAMBAH", "send", actorId);
}

// ------------------------------------------------------------------- bonus

/**
 * What a weighed Receipt Note took in beyond its tolerance (P321), inside that
 * note's posting: one receipt, received the same day, each lot a new No. Stok
 * under Tersedia at **value 0** — the supplier does not bill it, so it lowers
 * the item's average and writes no journal.
 */
export async function createBonusReceipt(
  tx: Tx,
  input: {
    source: { docTypeId: number; docId: number; no: string };
    warehouseId: number;
    date: Date;
    partnerId: number;
    lots: { itemId: number; lotNo: string; expiry: Date | null; locationId: number | null; baseQty: number }[];
  },
  actorId: number
): Promise<string> {
  const no = await nextDocumentNumber("SRC", input.date, async (series) => {
    const row = await tx.logStockReceipt.findFirst({ where: { receipt_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { receipt_no: true } });
    return row?.receipt_no ?? null;
  });
  const status = (await stockStatuses())[0].id;
  const byItem = new Map<number, (typeof input.lots)[number][]>();
  for (const l of input.lots) byItem.set(l.itemId, [...(byItem.get(l.itemId) ?? []), l]);
  const row = await tx.logStockReceipt.create({
    data: {
      receipt_no: no,
      purpose: "purchase_bonus",
      receipt_date: input.date,
      status: "Received",
      received_at: input.date,
      received_by: actorId,
      warehouse_id: input.warehouseId,
      source_doc_type_id: input.source.docTypeId,
      source_doc_id: input.source.docId,
      source_no: input.source.no,
      created_by: actorId,
      lines: {
        create: [...byItem].map(([item_id, lots], i) => ({
          line_no: i + 1,
          item_id,
          base_qty: lots.reduce((a, l) => a + l.baseQty, 0).toFixed(6),
          trackings: {
            create: lots.map((l, n) => ({ seq: n + 1, tracking_no: l.lotNo, expiry_date: l.expiry, base_qty: l.baseQty, location_id: l.locationId, stock_status_id: status })),
          },
        })),
      },
    },
  });
  const source = { docTypeId: await docTypeId(tx), docId: row.id, no };
  for (const l of input.lots) {
    await assertNewTrackingNo(tx, l.lotNo);
    await receiveStock(tx, {
      itemId: l.itemId,
      warehouseId: input.warehouseId,
      locationId: l.locationId,
      lotNo: l.lotNo,
      expiry: l.expiry,
      baseQty: l.baseQty,
      value: 0,
      date: input.date,
      source,
      partnerId: input.partnerId,
      statusId: status,
      actorId,
    });
  }
  await audit(tx, row.id, "TAMBAH", "bonus", actorId);
  return no;
}

/** The Bonus Pembelian a Receipt Note's posting made, for its own page. */
export async function bonusReceiptOf(receiptNoteId: number): Promise<{ id: number; no: string } | null> {
  const row = await prisma.logStockReceipt.findFirst({ where: { purpose: "purchase_bonus", source_doc_id: receiptNoteId }, select: { id: true, receipt_no: true } });
  return row ? { id: row.id, no: row.receipt_no } : null;
}

// ------------------------------------------------------------------- Terima

/** Where a No. Stok goes: its tracking row's id, the location, the status. */
export type ReceiptPlace = { id: number; location_id: number | null; stock_status_id: number | null };
export type ReceiveInput = { valueMode?: ProductionValueMode | null; places?: ReceiptPlace[] };

const WITH_LINES = { warehouse: true, from_unit: true, lines: { orderBy: { line_no: "asc" as const }, include: { item: { include: { base_uom: true } }, trackings: { orderBy: { seq: "asc" as const } } } } };

export async function receiveStockReceipt(
  id: number,
  actorId: number,
  input: ReceiveInput = {},
  options: { dryRun?: boolean } = {}
): Promise<{ ok: true; no: string; journal?: JournalLineInput[] } | { ok: false; errors: Record<string, string> }> {
  const r = await prisma.logStockReceipt.findUnique({ where: { id }, include: WITH_LINES });
  if (!r) return { ok: false, errors: { _form: "Dokumen tidak ditemukan." } };
  if (r.status !== "InTransit") return { ok: false, errors: { _form: "Dokumen ini sudah diterima. Muat ulang." } };
  const purpose = STOCK_RECEIPT_PURPOSES[stockReceiptPurposeOf(r.purpose)];
  const mode = purpose.asksValue ? (input.valueMode ?? null) : "carried";
  if (mode !== "carried" && mode !== "none") return { ok: false, errors: { value_mode: "Pilih nilai barang yang diterima." } };
  const today = isoDay(new Date());
  if (today < isoDay(r.receipt_date)) return { ok: false, errors: { _form: "Tanggal kirim di masa depan: Terima pada hari itu atau sesudahnya." } };

  const fallback = await fallbackAccounts(["inventory_account", "production_scrap_account"] as const);
  if (mode === "none" && !fallback.production_scrap_account) return { ok: false, errors: { _form: "Lengkapi Account Mapping dulu: Account Beban Pemusnahan Produksi." } };
  const byCategory = await accountsForItems(r.lines.map((l) => l.item_id));
  const accounts = new Map<number, { wip: number; debit: number }>();
  for (const l of r.lines) {
    const c = byCategory.get(l.item_id);
    const debit = mode === "none" ? fallback.production_scrap_account : (c?.inventory ?? fallback.inventory_account);
    if (!c?.wip || !debit) {
      const missing = [!c?.wip && "WIP", !debit && "Persediaan"].filter(Boolean).join(" dan ");
      return { ok: false, errors: { _form: `Lengkapi Account Kategori Item dulu: Account ${missing} untuk ${l.item.item_label}.` } };
    }
    accounts.set(l.item_id, { wip: c.wip, debit });
  }
  const base = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!base) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };
  const statuses = await stockStatuses();
  const places = new Map((Array.isArray(input.places) ? input.places : []).map((p) => [Number(p.id), p]));

  return refusable(() =>
    prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, today);
      const date = asDate(today);
      const done = await tx.logStockReceipt.updateMany({ where: { id, status: "InTransit" }, data: { status: "Received", received_at: date, received_by: actorId, value_mode: mode, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Dokumen ini berubah saat diproses. Muat ulang." });
      const source = { docTypeId: await docTypeId(tx), docId: id, no: r.receipt_no };
      const journalLines: JournalLineInput[] = [];
      const from = r.from_unit?.unit_label ?? "Produksi";
      for (const l of r.lines) {
        for (const t of l.trackings) {
          const place = places.get(t.id);
          const statusId = Number(place?.stock_status_id) || statuses[0].id;
          if (!statuses.some((s) => s.id === statusId)) throw new Refused({ _form: "Status stok tidak dikenal." });
          const locationId = Number(place?.location_id) || null;
          await receiveStock(tx, {
            itemId: l.item_id,
            warehouseId: r.warehouse_id,
            locationId,
            lotNo: t.tracking_no,
            expiry: t.expiry_date,
            baseQty: t.base_qty,
            value: mode === "carried" ? t.base_cost_amount : 0,
            date,
            source,
            statusId,
            actorId,
          });
          await tx.logStockReceiptTracking.update({ where: { id: t.id }, data: { location_id: locationId, stock_status_id: statusId } });
        }
        const value = l.base_cost_amount.toNumber();
        if (!(value > 0)) continue;
        const what = `${l.item.item_label} · ${from} → ${r.warehouse.warehouse_label}`;
        const acc = accounts.get(l.item_id)!;
        journalLines.push(
          { accountId: acc.debit, currencyId: base.id, rate: 1, debit: value, credit: 0, description: mode === "none" ? `Tanpa nilai ${what}` : `Masuk ${what}` },
          { accountId: acc.wip, currencyId: base.id, rate: 1, debit: 0, credit: value, description: `Keluar WIP ${what}` }
        );
      }
      // Goods carried at no value come in with no journal.
      const journal = journalLines.length
        ? await postJournal(tx, { description: `${r.receipt_no} · ${purpose.name} ${from} → ${r.warehouse.warehouse_label}`, sourceDocTypeId: source.docTypeId, sourceDocId: id, postingDate: date, actorId, lines: journalLines })
        : null;
      await tx.logStockReceipt.update({ where: { id }, data: { base_written_off_amount: mode === "none" ? r.base_cost_amount : 0, journal_id: journal?.id ?? null } });
      await deliver(tx, { type: "ReceiptReceived", no: r.receipt_no, date: today }, actorId);
      await audit(tx, id, "UPDATE", "receive", actorId);
      if (options.dryRun) throw new PostingDryRun(journalLines);
      return { ok: true as const, no: r.receipt_no };
    })
  );
}

export async function stockReceiptPreview(id: number, actorId: number, input: ReceiveInput = {}): Promise<JournalPreviewResult> {
  const r = await receiveStockReceipt(id, actorId, input, { dryRun: true });
  return r.ok ? { ok: true, lines: await describeJournalLines(r.journal ?? []) } : r;
}

// -------------------------------------------------------------------- reads

export type StatusOption = { id: number; label: string; name: string };
/** Tersedia first: the status goods come in under unless the warehouse says otherwise. */
async function stockStatuses(): Promise<StatusOption[]> {
  return (await prisma.sysStockStatus.findMany({ orderBy: { sort_order: "asc" } })).map((s) => ({ id: s.id, label: s.status_label, name: s.status_name }));
}

export type StockReceiptRow = {
  id: number;
  no: string;
  purpose: StockReceiptPurposeKey;
  date: string;
  status: StockReceiptStatus;
  unitLabel: string;
  unitName: string;
  /** The Receipt Note a Bonus Pembelian came with. */
  sourceId: number | null;
  sourceNo: string | null;
  warehouseLabel: string;
  warehouseName: string;
  lots: number;
  cost: number;
};

const rowOf = (r: Prisma.LogStockReceiptGetPayload<{ include: { from_unit: true; warehouse: true } }>, lots: number): StockReceiptRow => ({
  id: r.id,
  no: r.receipt_no,
  purpose: stockReceiptPurposeOf(r.purpose),
  date: isoDay(r.receipt_date),
  status: r.status,
  unitLabel: r.from_unit?.unit_label ?? "",
  unitName: r.from_unit?.unit_name ?? "",
  sourceId: r.source_doc_id,
  sourceNo: r.source_no,
  warehouseLabel: r.warehouse.warehouse_label,
  warehouseName: r.warehouse.warehouse_name,
  lots,
  cost: r.base_cost_amount.toNumber(),
});

/** `warehouses`: the actor's (OD-9), or null for all. What still waits comes first. */
export async function listStockReceipts(warehouses: number[] | null = null): Promise<StockReceiptRow[]> {
  const rows = await prisma.logStockReceipt.findMany({
    where: warehouses ? { warehouse_id: { in: warehouses } } : undefined,
    orderBy: [{ status: "asc" }, { receipt_date: "desc" }, { id: "desc" }],
    include: { from_unit: true, warehouse: true, lines: { select: { _count: { select: { trackings: true } } } } },
  });
  return rows.map((r) => rowOf(r, r.lines.reduce((a, l) => a + l._count.trackings, 0)));
}

export type StockReceiptView = StockReceiptRow & {
  warehouseId: number;
  receivedAt: string | null;
  note: string | null;
  valueMode: ProductionValueMode | null;
  writtenOff: number;
  journalId: number | null;
  journalNo: string | null;
  /** The warehouse's locations; empty when it has none. */
  locations: { id: number; label: string; name: string }[];
  statuses: StatusOption[];
  items: {
    id: number;
    lotNo: string;
    itemLabel: string;
    itemName: string;
    uomLabel: string;
    jobNo: string | null;
    qty: number;
    grams: number | null;
    value: number;
    locationLabel: string | null;
    statusName: string | null;
  }[];
};

export async function getStockReceipt(id: number): Promise<StockReceiptView | null> {
  const r = await prisma.logStockReceipt.findUnique({ where: { id }, include: WITH_LINES });
  if (!r) return null;
  const rows = r.lines.flatMap((l) => l.trackings.map((t) => ({ l, t })));
  const [journals, locations, labels, statuses] = await Promise.all([
    r.journal_id ? journalNumbersByIds([r.journal_id]) : new Map<number, string>(),
    warehouseLocationOptions([r.warehouse_id]),
    locationLabelsByIds(rows.flatMap(({ t }) => (t.location_id ? [t.location_id] : []))),
    stockStatuses(),
  ]);
  return {
    ...rowOf(r, rows.length),
    warehouseId: r.warehouse_id,
    receivedAt: r.received_at ? isoDay(r.received_at) : null,
    note: r.note,
    valueMode: r.status === "Received" ? ((r.value_mode as ProductionValueMode | null) ?? "carried") : null,
    writtenOff: r.base_written_off_amount.toNumber(),
    journalId: r.journal_id,
    journalNo: r.journal_id ? (journals.get(r.journal_id) ?? null) : null,
    locations: (locations.get(r.warehouse_id) ?? []).filter((x) => x.active).map((x) => ({ id: x.id, label: x.label, name: x.name })),
    statuses,
    items: rows.map(({ l, t }) => ({
      id: t.id,
      lotNo: t.tracking_no,
      itemLabel: l.item.item_label,
      itemName: l.item.item_name,
      uomLabel: l.item.base_uom.uom_label,
      jobNo: t.job_no,
      qty: t.base_qty.toNumber(),
      grams: t.grams?.toNumber() ?? null,
      value: t.base_cost_amount.toNumber(),
      locationLabel: t.location_id ? (labels.get(t.location_id) ?? null) : null,
      statusName: statuses.find((s) => s.id === t.stock_status_id)?.name ?? null,
    })),
  };
}

/** The warehouse a receipt goes to, checked per user (OD-9). */
export async function stockReceiptWarehouse(id: number): Promise<number | null> {
  return (await prisma.logStockReceipt.findUnique({ where: { id }, select: { warehouse_id: true } }))?.warehouse_id ?? null;
}

export async function stockReceiptNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.logStockReceipt.findMany({ where: { id: { in: ids } }, select: { id: true, receipt_no: true } });
  return new Map(rows.map((r) => [r.id, r.receipt_no]));
}
