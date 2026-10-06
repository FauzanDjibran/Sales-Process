import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber, taxSeriesPrefix } from "./document-number";
import { formatNumber } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "./currency";
import { checkTransactionDate } from "./fiscal";
import { PostingDryRun, describeJournalLines, journalNumbersByIds, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { checkAccountIsLeaf } from "./records";
import { lockPurchaseOrder, purchaseInvoiceSources, purchaseOrderNumbersByIds, type PurchaseInvoiceSource } from "./purchase-order";
import { apInvoiceSourceLines, postedReceiptLineIds, type ApInvoiceSourceLine } from "./receipt-note";
import { ApItemOverdrawn, apAdvanceItems, apItemBalances, createApItem, settleApItem, type ApAdvanceItem } from "./ap-item";
import { advancePpnUsed } from "./sales-tax";
import { advanceRatesByIds } from "./ap-advance";
import { postingAccounts, supplierInvoiceTolerance } from "./system-settings";
import {
  INVOICE_HOLDS,
  PURCHASE_INVOICE_TRANSITIONS,
  computePurchaseInvoice,
  invoiceIsEditable,
  purchaseInvoiceTransitionAllowed,
  type InvoiceAction,
  type InvoicePayState,
  type InvoiceStatus,
  type PurchaseInvoiceFigures,
} from "./ap-invoice-workflow";

/**
 * The Invoice Pembelian module (P128, Purchasing-Concept.md B28–B31): its
 * tables are `fin_ap_invoice`, `fin_ap_invoice_line` and
 * `fin_ap_invoice_advance_deduction`, and nothing else names them.
 *
 * The supplier's bill for **one Purchase Order**, recorded by us: its lines are
 * **whole lines of that PO's posted Receipt Notes**, each billed by at most one
 * live invoice, **always at the PO price** — a line's DPP is its receipt's value
 * (B29a), so there is no invoice without a receipt and no price adjustment. The
 * supplier's own number (unique per supplier among live invoices), date and
 * faktur pajak number are recorded; **Total Tagihan Supplier**, when typed, is
 * compared with ours and the difference is posted to *Selisih Tagihan Supplier*
 * only within the tolerance — beyond it the invoice refuses to post (B29b).
 * The PO's Uang Muka is deducted as on the sales side (P113, P117, P118); **the
 * company's PPh is booked here**, on the DPP after the advance (B31).
 *
 * Posting, under the PO's lock: Dr Barang Diterima Belum Ditagih (full DPP) ·
 * Dr PPN Masukan (full PPN) · Dr/Cr Selisih Tagihan Supplier / Cr Hutang Usaha
 * (face) · Cr Hutang PPh; per Uang Muka: Dr Hutang Usaha / Cr Uang Muka
 * Pembelian · Cr PPN Masukan. The Invoice AP item is born at its face and the
 * Uang Muka applied inside the posting.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type PurchaseInvoiceHeaderInput = {
  purchase_order_id: number | null;
  invoice_date: string;
  supplier_invoice_no: string;
  supplier_invoice_date: string;
  supplier_tax_invoice_no: string;
  /** Total Tagihan Supplier (DPP + PPN, before our PPh); empty = not compared. */
  supplier_total: number | string | null;
  note: string;
};

export type PurchaseInvoiceLineInput = { receipt_note_line_id: number | null };
export type PurchaseInvoiceDeductionInput = { ap_item_id: number | null; dpp_used: number | string };

export type PurchaseInvoiceResult = { ok: true; id: number; invoiceNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const text = (v: string | null | undefined) => String(v ?? "").trim() || null;
const money = (n: number) => `Rp ${formatNumber(n, 0)}`;
const dmy = (iso: string) => iso.split("-").reverse().join("/");

function addDays(iso: string, days: number): string {
  const d = asDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDay(d);
}

async function docTypeId(db: Db, table: string): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: table }, select: { id: true } });
  if (!row) throw new Error(`Jenis dokumen ${table} belum terdaftar. Jalankan db:seed.`);
  return row.id;
}

/** Receipt lines other live invoices bill — by line, the invoice that does. */
async function billedReceiptLines(db: Db, lineIds: number[], exceptId: number | null): Promise<Map<number, { id: number; no: string }>> {
  if (!lineIds.length) return new Map();
  const rows = await db.finApInvoiceLine.findMany({
    where: { receipt_note_line_id: { in: lineIds }, invoice: { status: { in: INVOICE_HOLDS }, ...(exceptId ? { id: { not: exceptId } } : {}) } },
    select: { receipt_note_line_id: true, invoice: { select: { id: true, invoice_no: true } } },
  });
  return new Map(rows.map((r) => [r.receipt_note_line_id, { id: r.invoice.id, no: r.invoice.invoice_no }]));
}

/** What other Draft invoices reserve of each Uang Muka item. */
async function reservedAdvances(db: Db, itemIds: number[], exceptId: number | null): Promise<Map<number, number>> {
  if (!itemIds.length) return new Map();
  const rows = await db.finApInvoiceAdvanceDeduction.groupBy({
    by: ["ap_item_id"],
    where: { ap_item_id: { in: itemIds }, invoice: { status: "Draft", ...(exceptId ? { id: { not: exceptId } } : {}) } },
    _sum: { dpp_used: true },
  });
  return new Map(rows.map((r) => [r.ap_item_id, r._sum?.dpp_used?.toNumber() ?? 0]));
}

// ---------------------------------------------------------------- options

export type PiReceiptLine = ApInvoiceSourceLine & {
  itemLabel: string;
  itemName: string;
  uomLabel: string;
  price: number;
  withholdingLabel: string | null;
  billedBy: { id: number; no: string } | null;
};
export type PiAdvance = ApAdvanceItem & { reserved: number };
export type PiOrderOption = PurchaseInvoiceSource & { receiptLines: PiReceiptLine[]; advances: PiAdvance[] };
export type PurchaseInvoiceOptions = { orders: PiOrderOption[]; tolerance: number };

async function orderOptions(
  db: Db,
  orders: PurchaseInvoiceSource[],
  exceptId: number | null,
  keep: { lineIds: number[]; itemIds: number[] } = { lineIds: [], itemIds: [] }
): Promise<PiOrderOption[]> {
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const [posted, kept, open, keptItems] = await Promise.all([
    apInvoiceSourceLines({ orderIds: ids }, db),
    keep.lineIds.length ? apInvoiceSourceLines({ lineIds: keep.lineIds }, db) : Promise.resolve([]),
    apAdvanceItems({ orderIds: ids }, db),
    keep.itemIds.length ? apAdvanceItems({ ids: keep.itemIds }, db) : Promise.resolve([]),
  ]);
  const lines = [...posted, ...kept.filter((k) => !posted.some((p) => p.id === k.id))];
  const items = [...open, ...keptItems.filter((k) => !open.some((o) => o.id === k.id))];
  const [billed, reserved] = await Promise.all([billedReceiptLines(db, lines.map((l) => l.id), exceptId), reservedAdvances(db, items.map((i) => i.id), exceptId)]);
  return orders.map((o) => {
    const poLine = new Map(o.lines.map((l) => [l.id, l]));
    return {
      ...o,
      receiptLines: lines
        .filter((l) => l.purchaseOrderId === o.id)
        .map((l) => {
          const p = poLine.get(l.purchaseOrderLineId);
          return {
            ...l,
            itemLabel: p?.itemLabel ?? "",
            itemName: p?.itemName ?? "",
            uomLabel: p?.uomLabel ?? "",
            price: p?.price ?? 0,
            withholdingLabel: p?.withholdingLabel ?? null,
            billedBy: billed.get(l.id) ?? null,
          };
        }),
      advances: items.filter((i) => i.orderId === o.id).map((i) => ({ ...i, reserved: reserved.get(i.id) ?? 0 })),
    };
  });
}

/** The POs with a posted receipt line no live invoice bills, from ids alone. */
async function ordersWithUnbilledLines(): Promise<number[]> {
  const posted = await postedReceiptLineIds();
  const billed = await billedReceiptLines(prisma, posted.map((l) => l.id), null);
  return [...new Set(posted.filter((l) => !billed.has(l.id)).map((l) => l.purchaseOrderId))];
}

/** What the form offers: POs (Open or Closed) with a posted, unbilled receipt line — or, for a saved invoice, its own PO. */
export async function purchaseInvoiceOptions(current: { id: number; orderId: number; lineIds: number[]; itemIds: number[] } | null = null): Promise<PurchaseInvoiceOptions> {
  const tolerance = await supplierInvoiceTolerance();
  if (current) {
    return { orders: await orderOptions(prisma, await purchaseInvoiceSources({ ids: [current.orderId] }), current.id, { lineIds: current.lineIds, itemIds: current.itemIds }), tolerance };
  }
  const sources = (await purchaseInvoiceSources({ ids: await ordersWithUnbilledLines() })).filter((o) => o.status === "Open" || o.status === "Closed");
  return { orders: (await orderOptions(prisma, sources, null)).filter((o) => o.receiptLines.some((l) => !l.billedBy)), tolerance };
}

// ------------------------------------------------------------- validation

type CheckedLine = {
  line_no: number;
  receipt_note_line_id: number;
  purchase_order_line_id: number;
  qty: number;
  price: number;
  dpp_amount: number;
  advance_dpp_amount: number;
  net_dpp_amount: number;
  dpp_other_amount: number;
  ppn_amount: number;
  withholding_tax_id: number | null;
  withholding_rate: number | null;
};
type CheckedDeduction = { ap_item_id: number; ap_item_no: string; dpp_used: number; ppn_used: number };

export type CheckedPurchaseInvoice = {
  order: PiOrderOption;
  figures: PurchaseInvoiceFigures;
  data: {
    purchase_order_id: number;
    supplier_id: number;
    invoice_date: Date;
    due_date: Date;
    supplier_invoice_no: string;
    supplier_invoice_date: Date;
    supplier_tax_invoice_no: string | null;
    price_mode: "Exclude" | "Include";
    is_taxable: boolean;
    ppn_rate: number | null;
    ppn_dpp_other_numerator: number | null;
    ppn_dpp_other_denominator: number | null;
    dpp_amount: number;
    advance_dpp_amount: number;
    advance_ppn_amount: number;
    net_dpp_amount: number;
    dpp_other_amount: number;
    ppn_amount: number;
    total_amount: number;
    pph_amount: number;
    supplier_total: number | null;
    difference_amount: number;
    payable_amount: number;
    note: string | null;
  };
  lines: CheckedLine[];
  deductions: CheckedDeduction[];
  rnNos: string[];
};

/**
 * Every rule an Invoice Pembelian must satisfy to be saved — and, run again
 * inside the posting transaction with the PO locked and `forPosting`, to be
 * posted (the tolerance refuses only posting: a Draft may hold a gap while it
 * is being sorted out with the supplier).
 */
export async function checkPurchaseInvoice(
  db: Db,
  header: PurchaseInvoiceHeaderInput,
  lines: PurchaseInvoiceLineInput[],
  deductions: PurchaseInvoiceDeductionInput[],
  selfId: number | null,
  keep: { lineIds: number[]; itemIds: number[] } = { lineIds: [], itemIds: [] },
  forPosting = false
): Promise<{ ok: true; c: CheckedPurchaseInvoice } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const orderId = Number(header.purchase_order_id) || null;
  const [source] = orderId ? await purchaseInvoiceSources({ ids: [orderId] }, db) : [];
  const [order] = source ? await orderOptions(db, [source], selfId, keep) : [];
  if (!orderId) errors.purchase_order_id = "Pilih Purchase Order.";
  else if (!order) errors.purchase_order_id = "Purchase Order tidak ditemukan.";
  else if (order.status !== "Open" && order.status !== "Closed") errors.purchase_order_id = "Purchase Order harus berstatus Open atau Ditutup.";
  else if (!order.supplierActive) errors.purchase_order_id = "Supplier pada Purchase Order ini sudah nonaktif.";

  // ---- lines: whole lines of this PO's posted Receipt Notes (B28)
  const raw = Array.isArray(lines) ? lines : [];
  if (!raw.length) errors._lines = "Pilih minimal satu baris dari Receipt Note.";
  const byId = new Map((order?.receiptLines ?? []).map((l) => [l.id, l]));
  const seen = new Set<number>();
  const picked: PiReceiptLine[] = [];
  for (const [i, l] of raw.entries()) {
    const id = Number(l.receipt_note_line_id) || null;
    const key = `lines.${i}.receipt_note_line_id`;
    const n = id ? byId.get(id) : undefined;
    if (!n) errors[key] = order ? "Baris bukan bagian Receipt Note Purchase Order ini." : "Pilih Purchase Order dulu…";
    else if (n.status !== "Posted") errors[key] = `${n.rnNo} belum diposting.`;
    else if (n.billedBy) errors[key] = `Sudah ditagih dengan ${n.billedBy.no}.`;
    else if (seen.has(n.id)) errors[key] = `${n.itemLabel} (${n.rnNo}) dipilih lebih dari sekali.`;
    else {
      seen.add(n.id);
      picked.push(n);
    }
  }

  // ---- the supplier's document and our dates (B29)
  const latest = picked.reduce((m, l) => (l.rnDate > m ? l.rnDate : m), "");
  const invoiceDate = String(header.invoice_date ?? "").trim();
  if (!DAY.test(invoiceDate)) errors.invoice_date = "Tanggal invoice wajib diisi.";
  else if (latest && invoiceDate < latest) errors.invoice_date = `Tidak boleh sebelum Tanggal Terima terakhir (${dmy(latest)}).`;
  const supplierDate = String(header.supplier_invoice_date ?? "").trim();
  if (!DAY.test(supplierDate)) errors.supplier_invoice_date = "Tanggal invoice supplier wajib diisi.";
  const supplierNo = String(header.supplier_invoice_no ?? "").trim();
  if (!supplierNo) errors.supplier_invoice_no = "No. invoice supplier wajib diisi.";
  else if (order) {
    // The duplicate-invoice guard: one supplier number, one live invoice.
    const dup = await db.finApInvoice.findFirst({
      where: { supplier_id: order.supplierId, supplier_invoice_no: { equals: supplierNo, mode: "insensitive" }, status: { in: INVOICE_HOLDS }, ...(selfId ? { id: { not: selfId } } : {}) },
      select: { invoice_no: true },
    });
    if (dup) errors.supplier_invoice_no = `Sudah dicatat pada ${dup.invoice_no}.`;
  }
  const rawTotal = header.supplier_total;
  const supplierTotal = rawTotal === null || rawTotal === undefined || String(rawTotal).trim() === "" ? null : Number(String(rawTotal).replace(",", "."));
  if (supplierTotal !== null && (!Number.isFinite(supplierTotal) || supplierTotal < 0 || supplierTotal !== Math.round(supplierTotal))) {
    errors.supplier_total = "Total tagihan supplier harus rupiah penuh.";
  }

  // ---- Uang Muka used: the PO's own items, each up to what is free of it (B30)
  const rawDeds = Array.isArray(deductions) ? deductions : [];
  const itemById = new Map((order?.advances ?? []).map((a) => [a.id, a]));
  const checkedDeds: CheckedDeduction[] = [];
  const dedIndex: number[] = [];
  const seenItems = new Set<number>();
  for (const [i, d] of rawDeds.entries()) {
    const id = Number(d.ap_item_id) || null;
    const item = id ? itemById.get(id) : undefined;
    if (!item) {
      errors[`deductions.${i}.ap_item_id`] = "Uang muka bukan milik Purchase Order ini.";
      continue;
    }
    if (seenItems.has(item.id)) {
      errors[`deductions.${i}.ap_item_id`] = `${item.apItemNo} dipilih lebih dari sekali.`;
      continue;
    }
    seenItems.add(item.id);
    const used = Number(String(d.dpp_used ?? "").replace(",", "."));
    const free = Math.max(0, item.balance - item.reserved);
    const key = `deductions.${i}.dpp_used`;
    if (!Number.isFinite(used) || !(used > 0)) errors[key] = "Isi DPP yang dipakai lebih dari 0.";
    else if (used !== Math.round(used)) errors[key] = "DPP dipakai harus dalam rupiah penuh.";
    else if (used > free) errors[key] = `Melebihi sisa uang muka (${money(free)}${item.reserved ? `; ${money(item.reserved)} dicadangkan Invoice Draft lain` : ""}).`;
    else {
      const ppnUsed = order?.taxable ? advancePpnUsed({ rates: order.rates, usedBefore: item.original - item.balance, used }) : 0;
      checkedDeds.push({ ap_item_id: item.id, ap_item_no: item.apItemNo, dpp_used: used, ppn_used: ppnUsed });
      dedIndex.push(i);
    }
  }
  // Full PPN less the advance's PPN holds only at the advance's own rates (P113).
  if (order?.taxable && order.rates && checkedDeds.length) {
    const billOf = new Map((order.advances ?? []).map((a) => [a.id, a.sourceId]));
    const rates = await advanceRatesByIds([...new Set(checkedDeds.map((d) => billOf.get(d.ap_item_id) ?? 0))], db);
    const r = order.rates;
    checkedDeds.forEach((d, k) => {
      const b = rates.get(billOf.get(d.ap_item_id) ?? 0);
      if (b && (b.rate !== r.rate || b.otherNum !== r.otherNum || b.otherDen !== r.otherDen)) {
        errors[`deductions.${dedIndex[k]}.ap_item_id`] = `Tarif PPN ${d.ap_item_no} berbeda dengan Purchase Order: PPN penuh dikurangi PPN uang muka hanya berlaku bila tarifnya sama.`;
      }
    });
  }

  const poLine = new Map((order?.lines ?? []).map((l) => [l.id, l]));
  const tolerance = await supplierInvoiceTolerance();
  const used = checkedDeds.reduce((a, d) => a + d.dpp_used, 0);
  const figures = computePurchaseInvoice({
    lines: picked.map((n) => {
      const p = poLine.get(n.purchaseOrderLineId);
      return { dpp: n.value, withholdingRate: p?.withholdingRate ?? null, withholdingKey: p?.withholdingTaxId ? String(p.withholdingTaxId) : null };
    }),
    taxable: order?.taxable ?? false,
    rates: order?.rates ?? null,
    advanceUsed: used,
    advancePpn: checkedDeds.reduce((a, d) => a + d.ppn_used, 0),
    supplierTotal: errors.supplier_total ? null : supplierTotal,
    tolerance,
  });
  if (used > figures.dpp) errors._deductions = `Uang muka dipakai (${money(used)}) melebihi DPP invoice (${money(figures.dpp)}).`;
  else if (Object.keys(errors).some((k) => k.startsWith("deductions."))) errors._deductions = "Ada uang muka yang perlu diperbaiki.";
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";
  if (forPosting && supplierTotal !== null && !figures.withinTolerance) {
    errors.supplier_total = `Tagihan supplier ${money(supplierTotal)} berbeda ${money(Math.abs(figures.difference))} dari invoice ${money(figures.total)} — melebihi toleransi ${money(tolerance)}. Selesaikan dengan supplier atau pada Purchase Order.`;
  }
  if (Object.keys(errors).length || !order) return { ok: false, errors };

  return {
    ok: true,
    c: {
      order,
      figures,
      data: {
        purchase_order_id: order.id,
        supplier_id: order.supplierId,
        invoice_date: asDate(invoiceDate),
        due_date: asDate(addDays(supplierDate, order.termDays)),
        supplier_invoice_no: supplierNo,
        supplier_invoice_date: asDate(supplierDate),
        supplier_tax_invoice_no: text(header.supplier_tax_invoice_no),
        price_mode: order.mode,
        is_taxable: order.taxable,
        ppn_rate: order.rates?.rate ?? null,
        ppn_dpp_other_numerator: order.rates?.otherNum ?? null,
        ppn_dpp_other_denominator: order.rates?.otherDen ?? null,
        dpp_amount: figures.dpp,
        advance_dpp_amount: figures.advanceUsed,
        advance_ppn_amount: figures.advancePpn,
        net_dpp_amount: figures.netDpp,
        dpp_other_amount: figures.dppOther,
        ppn_amount: figures.ppn,
        total_amount: figures.total,
        pph_amount: figures.pph,
        supplier_total: supplierTotal,
        difference_amount: figures.difference,
        payable_amount: figures.payable,
        note: text(header.note),
      },
      lines: picked.map((n, i) => {
        const p = poLine.get(n.purchaseOrderLineId);
        const f = figures.lines[i];
        return {
          line_no: i + 1,
          receipt_note_line_id: n.id,
          purchase_order_line_id: n.purchaseOrderLineId,
          qty: n.qty,
          price: n.price,
          dpp_amount: f.dpp,
          advance_dpp_amount: f.advanceDpp,
          net_dpp_amount: f.netDpp,
          dpp_other_amount: f.dppOther,
          ppn_amount: f.ppn,
          withholding_tax_id: p?.withholdingTaxId ?? null,
          withholding_rate: p?.withholdingRate ?? null,
        };
      }),
      deductions: checkedDeds,
      rnNos: picked.map((n) => n.rnNo),
    },
  };
}

// ------------------------------------------------------------------ writes

async function nextInvoiceNo(db: Db, date: Date, isTaxable: boolean): Promise<string> {
  return nextDocumentNumber(taxSeriesPrefix("PI", isTaxable), date, async (series) => {
    const row = await db.finApInvoice.findFirst({ where: { invoice_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { invoice_no: true } });
    return row?.invoice_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "fin_ap_invoice", row_id: id, action, event, by } });
}

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
    if (e instanceof ApItemOverdrawn) return { ok: false, errors: { _form: `Belum bisa diposting: ${e.message}` } };
    if (e instanceof PostingDryRun) return { ok: true, journal: e.lines } as T;
    throw e;
  }
}

async function writeRows(tx: Prisma.TransactionClient, id: number, c: CheckedPurchaseInvoice) {
  await tx.finApInvoiceLine.deleteMany({ where: { invoice_id: id } });
  await tx.finApInvoiceAdvanceDeduction.deleteMany({ where: { invoice_id: id } });
  for (const l of c.lines) await tx.finApInvoiceLine.create({ data: { ...l, invoice_id: id } });
  for (const d of c.deductions) await tx.finApInvoiceAdvanceDeduction.create({ data: { ...d, invoice_id: id } });
}

export async function createPurchaseInvoice(
  header: PurchaseInvoiceHeaderInput,
  lines: PurchaseInvoiceLineInput[],
  deductions: PurchaseInvoiceDeductionInput[],
  actorId: number
): Promise<PurchaseInvoiceResult> {
  const orderId = Number(header.purchase_order_id) || null;
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      if (orderId) await lockPurchaseOrder(tx, orderId);
      const r = await checkPurchaseInvoice(tx, header, lines, deductions, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.finApInvoice.create({ data: { ...r.c.data, invoice_no: await nextInvoiceNo(tx, r.c.data.invoice_date, r.c.data.is_taxable), created_by: actorId } });
      await writeRows(tx, row.id, r.c);
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, invoiceNo: made.invoice_no };
  });
}

export async function updatePurchaseInvoice(
  id: number,
  header: PurchaseInvoiceHeaderInput,
  lines: PurchaseInvoiceLineInput[],
  deductions: PurchaseInvoiceDeductionInput[],
  actorId: number
): Promise<PurchaseInvoiceResult> {
  const current = await prisma.finApInvoice.findUnique({
    where: { id },
    select: { status: true, invoice_no: true, purchase_order_id: true, lines: { select: { receipt_note_line_id: true } }, deductions: { select: { ap_item_id: true } } },
  });
  if (!current) return { ok: false, errors: { _form: "Invoice Pembelian tidak ditemukan." } };
  if (!invoiceIsEditable(current.status as InvoiceStatus)) return { ok: false, errors: { _form: "Invoice yang sudah diposting atau dibatalkan tidak dapat diubah." } };
  if (Number(header.purchase_order_id) !== current.purchase_order_id) {
    return { ok: false, errors: { purchase_order_id: "Purchase Order tidak dapat diganti. Buat Invoice baru untuk Purchase Order lain." } };
  }
  const keep = { lineIds: current.lines.map((l) => l.receipt_note_line_id), itemIds: current.deductions.map((d) => d.ap_item_id) };
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await lockPurchaseOrder(tx, current.purchase_order_id);
      const r = await checkPurchaseInvoice(tx, header, lines, deductions, id, keep);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.finApInvoice.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Invoice berubah saat diproses. Muat ulang halaman." });
      await writeRows(tx, id, r.c);
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, invoiceNo: current.invoice_no };
  });
}

type StoredInvoice = Prisma.FinApInvoiceGetPayload<{ include: { lines: true; deductions: true } }>;
const WITH_ROWS = { lines: { orderBy: { line_no: "asc" as const } }, deductions: { orderBy: { id: "asc" as const } } };

function asInput(n: StoredInvoice) {
  return {
    header: {
      purchase_order_id: n.purchase_order_id,
      invoice_date: isoDay(n.invoice_date),
      supplier_invoice_no: n.supplier_invoice_no,
      supplier_invoice_date: isoDay(n.supplier_invoice_date),
      supplier_tax_invoice_no: n.supplier_tax_invoice_no ?? "",
      supplier_total: n.supplier_total?.toNumber() ?? null,
      note: n.note ?? "",
    } satisfies PurchaseInvoiceHeaderInput,
    lines: n.lines.map((l) => ({ receipt_note_line_id: l.receipt_note_line_id })) satisfies PurchaseInvoiceLineInput[],
    deductions: n.deductions.map((d) => ({ ap_item_id: d.ap_item_id, dpp_used: d.dpp_used.toNumber() })) satisfies PurchaseInvoiceDeductionInput[],
    keep: { lineIds: n.lines.map((l) => l.receipt_note_line_id), itemIds: n.deductions.map((d) => d.ap_item_id) },
  };
}

// --------------------------------------------------------------- posting

async function accountProblem(db: Db, id: number): Promise<string | null> {
  const a = await db.accAccount.findUnique({ where: { id }, select: { is_postable: true, is_active: true } });
  if (!a) return "tidak ditemukan";
  if (!a.is_postable) return "bukan account postable";
  if (!a.is_active) return "non-aktif";
  return checkAccountIsLeaf(id);
}

/** The journal a checked invoice writes (B31). */
async function buildPosting(db: Db, invoiceNo: string, c: CheckedPurchaseInvoice, currencyId: number): Promise<{ ok: true; description: string; lines: JournalLineInput[] } | { ok: false; message: string }> {
  const f = c.figures;
  type Key = "goods_received_account" | "payable_account" | "input_vat_account" | "purchase_advance_account" | "supplier_invoice_diff_account";
  const keys: Key[] = [
    "goods_received_account",
    "payable_account",
    ...(f.fullPpn > 0 ? (["input_vat_account"] as const) : []),
    ...(f.advanceUsed > 0 ? (["purchase_advance_account"] as const) : []),
    ...(f.difference !== 0 ? (["supplier_invoice_diff_account"] as const) : []),
  ];
  const mapped = await postingAccounts<Key>(keys);
  const missing: string[] = mapped.ok ? [] : [...mapped.missing];
  const whtIds = [...new Set(c.lines.flatMap((l) => (l.withholding_tax_id ? [l.withholding_tax_id] : [])))];
  const taxes = new Map((await db.refWithholdingTax.findMany({ where: { id: { in: whtIds } } })).map((t) => [t.id, t]));
  const pph = f.withholdings.filter((w) => w.amount > 0);
  for (const w of pph) {
    const t = taxes.get(Number(w.key));
    if (!t?.account_id || (await accountProblem(db, t.account_id))) missing.push(`Account Hutang PPh pada Jenis PPh ${t?.wht_label ?? w.key}`);
  }
  if (mapped.ok) for (const [k, accId] of Object.entries(mapped.ids)) if (await accountProblem(db, accId as number)) missing.push(k);
  if (missing.length || !mapped.ok) return { ok: false, message: `Lengkapi Account Mapping dulu: ${missing.join(", ")}.` };
  const ids = mapped.ids as Partial<Record<Key, number>>;
  const req = new Map((await db.accAccount.findMany({ where: { id: { in: Object.values(ids).filter(Boolean) as number[] } }, select: { id: true, require_partner: true } })).map((a) => [a.id, a.require_partner]));
  const supplier = c.order.supplierId;
  const line = (accountId: number, debit: number, credit: number, description: string, partnerId: number | null = null): JournalLineInput => ({
    accountId,
    partnerId: req.get(accountId) || partnerId ? partnerId : null,
    currencyId,
    rate: 1,
    debit,
    credit,
    description,
  });
  const rn = [...new Set(c.rnNos)].join(", ");
  const out: JournalLineInput[] = [];
  out.push(line(ids.goods_received_account!, f.dpp, 0, `Ditagih ${rn} (${c.order.orderNo})`, supplier));
  if (f.fullPpn > 0) out.push(line(ids.input_vat_account!, f.fullPpn, 0, `PPN Masukan ${invoiceNo} · faktur ${c.data.supplier_tax_invoice_no ?? "—"}`));
  if (f.difference > 0) out.push(line(ids.supplier_invoice_diff_account!, f.difference, 0, `Selisih tagihan supplier ${c.data.supplier_invoice_no}`));
  if (f.difference < 0) out.push(line(ids.supplier_invoice_diff_account!, 0, -f.difference, `Selisih tagihan supplier ${c.data.supplier_invoice_no}`));
  out.push(line(ids.payable_account!, 0, f.payable, `Hutang ${invoiceNo} · invoice supplier ${c.data.supplier_invoice_no} — jatuh tempo ${dmy(isoDay(c.data.due_date))}`, supplier));
  for (const w of pph) {
    const t = taxes.get(Number(w.key))!;
    out.push(line(t.account_id!, 0, w.amount, `${t.wht_label} dipotong atas ${invoiceNo}`, supplier));
  }
  for (const d of c.deductions) {
    out.push(line(ids.payable_account!, d.dpp_used + d.ppn_used, 0, `Uang muka ${d.ap_item_no} diterapkan ke ${invoiceNo}`, supplier));
    out.push(line(ids.purchase_advance_account!, 0, d.dpp_used, `Uang muka ${d.ap_item_no} dipakai ${invoiceNo}`, supplier));
    if (d.ppn_used > 0) out.push(line(ids.input_vat_account!, 0, d.ppn_used, `PPN uang muka ${d.ap_item_no} sudah dikreditkan — ${invoiceNo}`));
  }
  return { ok: true, description: `${invoiceNo} · Invoice Pembelian ${c.order.orderNo} — ${c.order.supplierName}`, lines: out };
}

export async function purchaseInvoicePreview(id: number, actorId: number): Promise<JournalPreviewResult> {
  try {
    const r = await transitionPurchaseInvoice(id, "post", actorId, undefined, { dryRun: true });
    if (!r.ok) return r;
    return { ok: true, lines: await describeJournalLines(r.journal ?? []) };
  } catch (e) {
    if (e instanceof Error) return { ok: false, errors: { _form: e.message } };
    throw e;
  }
}

export type PurchaseInvoiceTransitionResult = { ok: true; journal?: JournalLineInput[] } | { ok: false; errors: Record<string, string> };

/**
 * **Posting**, in one transaction with the PO locked: checks the stored invoice
 * again (the tolerance included), writes the journal dated Tanggal Invoice,
 * creates the Invoice AP item at its face with its due date and applies each
 * Uang Muka used (*Dipakai Invoice* / *Uang Muka Diterapkan*, P117 mirrored).
 * **Batalkan** (Draft only) asks for a reason.
 */
export async function transitionPurchaseInvoice(
  id: number,
  action: InvoiceAction,
  actorId: number,
  reason?: string,
  options: { dryRun?: boolean } = {}
): Promise<PurchaseInvoiceTransitionResult> {
  const n = await prisma.finApInvoice.findUnique({ where: { id }, include: WITH_ROWS });
  if (!n) return { ok: false, errors: { _form: "Invoice Pembelian tidak ditemukan." } };
  const t = PURCHASE_INVOICE_TRANSITIONS[action];
  if (!purchaseInvoiceTransitionAllowed(action, n.status as InvoiceStatus)) return { ok: false, errors: { _form: `Invoice berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  const moved = "Invoice berubah saat diproses. Muat ulang halaman.";

  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      const done = await tx.finApInvoice.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const period = await checkTransactionDate(isoDay(n.invoice_date));
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  const currency = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!currency) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await lockPurchaseOrder(tx, n.purchase_order_id);
      const input = asInput(n);
      const r = await checkPurchaseInvoice(tx, input.header, input.lines, input.deductions, id, input.keep, true);
      if (!r.ok) {
        const first = Object.entries(r.errors).find(([k]) => !k.startsWith("_"))?.[1] ?? Object.values(r.errors)[0];
        throw new Refused({ _form: `Belum bisa diposting: ${first}` });
      }
      const p = await buildPosting(tx, n.invoice_no, r.c, currency.id);
      if (!p.ok) throw new Refused({ _form: p.message });
      const done = await tx.finApInvoice.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });
      await writeRows(tx, id, r.c);

      const typeId = await docTypeId(tx, "fin_ap_invoice");
      const journal = await postJournal(tx, { description: p.description, sourceDocTypeId: typeId, sourceDocId: id, postingDate: r.c.data.invoice_date, actorId, lines: p.lines });
      const doc = { docTypeId: typeId, docId: id, no: n.invoice_no };
      const date = isoDay(r.c.data.invoice_date);
      const itemId = await createApItem(tx, {
        type: "Invoice",
        partnerId: r.c.order.supplierId,
        currencyId: currency.id,
        date,
        dueDate: isoDay(r.c.data.due_date),
        source: doc,
        createdBy: doc,
        orderId: r.c.order.id,
        amount: r.c.figures.payable,
        note: `Invoice ${n.invoice_no} (supplier ${r.c.data.supplier_invoice_no}) diposting`,
        actorId,
      });
      for (const d of r.c.deductions) {
        await settleApItem(tx, { itemId: d.ap_item_id, event: "AdvanceUsed", amount: d.dpp_used, date, doc, counterItemId: itemId, note: `Dipakai ${n.invoice_no}`, actorId });
        await settleApItem(tx, {
          itemId,
          event: "AdvanceApplied",
          amount: d.dpp_used + d.ppn_used,
          date,
          doc,
          counterItemId: d.ap_item_id,
          note: `Uang muka ${d.ap_item_no} — DPP ${money(d.dpp_used)}${d.ppn_used ? ` + PPN ${money(d.ppn_used)}` : ""}`,
          actorId,
        });
      }
      await tx.finApInvoice.update({ where: { id }, data: { journal_id: journal.id, ap_item_id: itemId } });
      await audit(tx, id, "UPDATE", "post", actorId);
      if (options.dryRun) throw new PostingDryRun(p.lines);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

export type PurchaseInvoiceListRow = {
  id: number;
  pay: { state: InvoicePayState; open: number; overdue: boolean } | null;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  status: InvoiceStatus;
  supplierInvoiceNo: string;
  orderNo: string;
  supplierLabel: string;
  supplierName: string;
  total: number;
};

export async function listPurchaseInvoices(): Promise<PurchaseInvoiceListRow[]> {
  const rows = await prisma.finApInvoice.findMany({ orderBy: [{ invoice_date: "desc" }, { id: "desc" }], include: { supplier: true } });
  const [orders, pay] = await Promise.all([
    purchaseOrderNumbersByIds([...new Set(rows.map((r) => r.purchase_order_id))]),
    purchaseInvoicePayStates(rows.filter((r) => r.status === "Posted").map((r) => r.id)),
  ]);
  return rows.map((r) => ({
    id: r.id,
    pay: pay[r.id] ?? null,
    invoiceNo: r.invoice_no,
    invoiceDate: isoDay(r.invoice_date),
    dueDate: isoDay(r.due_date),
    status: r.status as InvoiceStatus,
    supplierInvoiceNo: r.supplier_invoice_no,
    orderNo: orders.get(r.purchase_order_id) ?? "",
    supplierLabel: r.supplier.partner_label,
    supplierName: r.supplier.partner_name,
    total: r.total_amount.toNumber(),
  }));
}

export type PurchaseInvoiceView = {
  id: number;
  invoiceNo: string;
  status: InvoiceStatus;
  header: PurchaseInvoiceHeaderInput;
  lines: PurchaseInvoiceLineInput[];
  deductions: { ap_item_id: number; dpp_used: number; ppn_used: number }[];
  dueDate: string;
  stored: { dpp: number; advanceUsed: number; advancePpn: number; netDpp: number; dppOther: number; ppn: number; total: number; pph: number; difference: number; payable: number };
  journalId: number | null;
  journalNo: string | null;
  apItemId: number | null;
  cancelReason: string | null;
};

export async function getPurchaseInvoice(id: number): Promise<PurchaseInvoiceView | null> {
  const n = await prisma.finApInvoice.findUnique({ where: { id }, include: WITH_ROWS });
  if (!n) return null;
  const input = asInput(n);
  const journalNo = n.journal_id ? ((await journalNumbersByIds([n.journal_id])).get(n.journal_id) ?? null) : null;
  return {
    id: n.id,
    invoiceNo: n.invoice_no,
    status: n.status as InvoiceStatus,
    header: input.header,
    lines: input.lines,
    deductions: n.deductions.map((d) => ({ ap_item_id: d.ap_item_id, dpp_used: d.dpp_used.toNumber(), ppn_used: d.ppn_used.toNumber() })),
    dueDate: isoDay(n.due_date),
    stored: {
      dpp: n.dpp_amount.toNumber(),
      advanceUsed: n.advance_dpp_amount.toNumber(),
      advancePpn: n.advance_ppn_amount.toNumber(),
      netDpp: n.net_dpp_amount.toNumber(),
      dppOther: n.dpp_other_amount.toNumber(),
      ppn: n.ppn_amount.toNumber(),
      total: n.total_amount.toNumber(),
      pph: n.pph_amount.toNumber(),
      difference: n.difference_amount.toNumber(),
      payable: n.payable_amount.toNumber(),
    },
    journalId: n.journal_id,
    journalNo,
    apItemId: n.ap_item_id,
    cancelReason: n.cancel_reason,
  };
}

export async function purchaseInvoiceNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.finApInvoice.findMany({ where: { id: { in: ids } }, select: { id: true, invoice_no: true } });
  return new Map(rows.map((r) => [r.id, r.invoice_no]));
}

/** Where each posted invoice stands, from its AP item (U26 mirrored). */
export async function purchaseInvoicePayStates(ids: number[]): Promise<Record<number, { state: InvoicePayState; open: number; overdue: boolean }>> {
  if (!ids.length) return {};
  const rows = await prisma.finApInvoice.findMany({ where: { id: { in: ids }, status: "Posted" }, select: { id: true, ap_item_id: true, due_date: true, payable_amount: true, advance_dpp_amount: true, advance_ppn_amount: true } });
  const balances = await apItemBalances(rows.flatMap((r) => (r.ap_item_id ? [r.ap_item_id] : [])));
  const today = new Date().toISOString().slice(0, 10);
  return Object.fromEntries(
    rows.map((r) => {
      const open = r.ap_item_id ? (balances.get(r.ap_item_id) ?? 0) : 0;
      const owed = r.payable_amount.toNumber() - r.advance_dpp_amount.toNumber() - r.advance_ppn_amount.toNumber();
      const state: InvoicePayState = open <= 0 ? "Paid" : open >= owed ? "Unpaid" : "Partial";
      return [r.id, { state, open, overdue: open > 0 && isoDay(r.due_date) < today }];
    })
  );
}

// ------------------------------------------------------- for the payment

/**
 * A posted invoice as a Pengeluaran pays it (B27): what is owed after the Uang
 * Muka — the AP item's balance is what is still open — with no PPh, which was
 * booked at the invoice. The payment module takes this rather than reading
 * `fin_ap_invoice` itself.
 */
export type SettlementPurchaseInvoice = {
  id: number;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  status: InvoiceStatus;
  supplierId: number;
  orderId: number;
  orderNo: string;
  /** What the invoice asks to be paid: its face less the Uang Muka applied. */
  owed: number;
  apItemId: number | null;
};

export async function settlementPurchaseInvoices(filter: { ids?: number[]; apItemIds?: number[] }, db: Db = prisma): Promise<SettlementPurchaseInvoice[]> {
  const rows = await db.finApInvoice.findMany({
    where: { ...(filter.ids ? { id: { in: filter.ids } } : {}), ...(filter.apItemIds ? { status: "Posted", ap_item_id: { in: filter.apItemIds } } : {}) },
    orderBy: [{ due_date: "asc" }, { id: "asc" }],
  });
  const orders = await purchaseOrderNumbersByIds([...new Set(rows.map((r) => r.purchase_order_id))]);
  return rows.map((r) => ({
    id: r.id,
    invoiceNo: r.invoice_no,
    invoiceDate: isoDay(r.invoice_date),
    dueDate: isoDay(r.due_date),
    status: r.status as InvoiceStatus,
    supplierId: r.supplier_id,
    orderId: r.purchase_order_id,
    orderNo: orders.get(r.purchase_order_id) ?? "",
    owed: r.payable_amount.toNumber() - r.advance_dpp_amount.toNumber() - r.advance_ppn_amount.toNumber(),
    apItemId: r.ap_item_id,
  }));
}

/** A PO's invoices, for its page. */
export async function purchaseOrderInvoices(purchaseOrderId: number): Promise<{ id: number; invoiceNo: string; invoiceDate: string; status: InvoiceStatus; total: number }[]> {
  const rows = await prisma.finApInvoice.findMany({ where: { purchase_order_id: purchaseOrderId }, orderBy: [{ invoice_date: "asc" }, { id: "asc" }] });
  return rows.map((r) => ({ id: r.id, invoiceNo: r.invoice_no, invoiceDate: isoDay(r.invoice_date), status: r.status as InvoiceStatus, total: r.total_amount.toNumber() }));
}

