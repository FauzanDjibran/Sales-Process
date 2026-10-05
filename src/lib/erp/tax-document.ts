import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import { formatAddress } from "./partner-shape";
import { ppnChain } from "./sales-tax";
import { advanceItemsCreatedBy, setArItemTaxInvoiceNo } from "./ar-item";
import { postedReceiptIds, receiptTaxBasis } from "./cash-bank-tx";
import { invoiceSourceOrders } from "./customer-order";
import { invoiceTaxBasis, postedInvoiceIds, setInvoiceTaxInvoiceNo } from "./ar-invoice";
import {
  normalizeNsfp,
  slipExpected,
  uploadDeadline,
  type TaxFakturKind,
  type TaxDocRefs,
  type TaxSlipStatus,
} from "./tax-document-workflow";

/**
 * The tax module (P100, `tax_concept.md` §5, §6): Faktur Pajak Keluaran and
 * Bukti Potong PPh. Its tables are `tax_faktur(_line, _ref)` and
 * `tax_withholding_slip`, and nothing else names them.
 *
 * **Made by the transaction at its tax point, never by hand.** A posted
 * receipt makes a *faktur uang muka* for each advance bill it paid with PPN —
 * dated the receipt — and a *bukti potong* for each PPh row it withheld (one
 * per settled document, per payment, per Jenis PPh, P69). A posted Invoice
 * Penjualan makes a *faktur pelunasan* (when it deducted Uang Muka) or a
 * *faktur normal*, dated the latest Tanggal Kirim (U19), net of the advances,
 * naming the faktur uang muka it deducts. A non-taxable transaction makes no
 * faktur (Q10), nor does an Invoice its Uang Muka covered whole.
 *
 * The source modules never call this one: they take an `afterPost` hook, and
 * the action layer hands them these functions, so the documents are written in
 * the same transaction as the posting while the dependency stays one way
 * (§3.1: tax documents depend on the documents that raise them). Every figure
 * is copied from the source and never edited (Q16); the user only records what
 * happened outside — the NSFP and upload date, the customer's slip.
 */

type Db = Prisma.TransactionClient | typeof prisma;

const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function docTypeId(db: Db, table: string): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: table }, select: { id: true } });
  if (!row) throw new Error(`Jenis dokumen ${table} belum terdaftar. Jalankan db:seed.`);
  return row.id;
}

async function audit(db: Db, entity: "tax_faktur" | "tax_withholding_slip", id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: entity, row_id: id, action, event, by } });
}

async function nextNo(db: Db, prefix: "FPK" | "BPU", date: Date): Promise<string> {
  return nextDocumentNumber(prefix, date, async (series) => {
    const row =
      prefix === "FPK"
        ? await db.taxFaktur.findFirst({ where: { faktur_no: { startsWith: series } }, orderBy: { faktur_no: "desc" }, select: { faktur_no: true } })
        : await db.taxWithholdingSlip.findFirst({ where: { slip_no: { startsWith: series } }, orderBy: { slip_no: "desc" }, select: { slip_no: true } });
    return row ? ("faktur_no" in row ? row.faktur_no : row.slip_no) : null;
  });
}

/** The buyer as the faktur prints it, as it stands now: tax identity and the address. */
async function buyerOf(db: Db, partnerId: number, addressId: number | null) {
  const p = await db.mPartner.findUniqueOrThrow({ where: { id: partnerId } });
  let address = "";
  if (addressId) {
    const a = await db.mPartnerAddress.findUnique({
      where: { id: addressId },
      include: { village: { include: { district: { include: { city: { include: { province: true } } } } } } },
    });
    if (a) {
      const d = a.village.district;
      address = formatAddress({
        provinceName: d.city.province.name,
        cityName: d.city.name,
        districtName: d.name,
        villageName: a.village.name,
        street: a.street,
        postalCode: a.village.postal_code ?? "",
      });
    }
  }
  return {
    customer_id: p.id,
    buyer_tax_type: p.tax_id_type,
    buyer_tax_id: p.tax_id,
    buyer_name: p.tax_name || p.partner_name,
    buyer_address: address,
  };
}

// ------------------------------------------------------------------ making

/**
 * The tax documents of a posted receipt: a faktur uang muka per advance bill
 * paid with PPN, a bukti potong per PPh row. Idempotent — what exists is kept —
 * so it serves both the posting and the backfill of receipts posted before.
 */
export async function createTaxDocsForReceipt(db: Db, receiptId: number, actorId: number): Promise<void> {
  const r = await receiptTaxBasis(db, receiptId);
  if (!r || r.status !== "Posted") return;
  const receiptType = await docTypeId(db, "fin_cash_bank_tx");
  const date = asDate(r.date);

  // ---- faktur uang muka, one per advance bill paid with PPN
  const advanceLines = r.lines.filter((l) => l.kind === "fin_ar_advance" && l.ppnPart > 0 && l.rates);
  if (advanceLines.length) {
    const items = await advanceItemsCreatedBy(db, { docTypeId: receiptType, docId: r.id });
    const orders = new Map((await invoiceSourceOrders({ ids: [...new Set(advanceLines.map((l) => l.orderId))] }, db)).map((o) => [o.id, o]));
    for (const l of advanceLines) {
      const exists = await db.taxFaktur.findFirst({
        where: { source_doc_type_id: receiptType, source_doc_id: r.id, ref_doc_type_id: l.docTypeId, ref_doc_id: l.docId },
        select: { id: true },
      });
      if (exists) continue;
      const order = orders.get(l.orderId);
      const rates = l.rates!;
      const { dppOther } = ppnChain(l.dppPart, rates);
      const description = l.description || `Uang muka atas pesanan ${order?.orderNo ?? ""}`;
      const row = await db.taxFaktur.create({
        data: {
          faktur_no: await nextNo(db, "FPK", date),
          kind: "Advance",
          tax_date: date,
          deadline: asDate(uploadDeadline(r.date)),
          ...(await buyerOf(db, r.partnerId, order?.addressId ?? null)),
          source_doc_type_id: receiptType,
          source_doc_id: r.id,
          source_no: r.txNo,
          ref_doc_type_id: l.docTypeId,
          ref_doc_id: l.docId,
          ref_no: l.docNo,
          ar_item_id: items.find((i) => i.sourceDocId === l.docId)?.id ?? null,
          customer_order_id: l.orderId,
          description,
          ppn_rate: rates.rate,
          ppn_dpp_other_numerator: rates.otherNum,
          ppn_dpp_other_denominator: rates.otherDen,
          gross_dpp: l.dppPart,
          dpp: l.dppPart,
          dpp_other: dppOther,
          ppn: l.ppnPart,
          created_by: actorId,
          lines: {
            create: [{ line_no: 1, description, gross_dpp: l.dppPart, dpp: l.dppPart, dpp_other: dppOther, ppn: l.ppnPart }],
          },
        },
      });
      await audit(db, "tax_faktur", row.id, "TAMBAH", "create", actorId);
    }
  }

  // ---- bukti potong, one per PPh row: per document, per payment, per Jenis PPh
  const whtRows = r.lines.flatMap((l) => l.whts.filter((w) => w.amount > 0).map((w) => ({ l, w })));
  if (whtRows.length) {
    const p = await db.mPartner.findUniqueOrThrow({ where: { id: r.partnerId } });
    for (const { l, w } of whtRows) {
      if (await db.taxWithholdingSlip.findUnique({ where: { receipt_line_wht_id: w.id }, select: { id: true } })) continue;
      const row = await db.taxWithholdingSlip.create({
        data: {
          slip_no: await nextNo(db, "BPU", date),
          withheld_date: date,
          tax_period: r.date.slice(0, 7),
          expected_date: asDate(slipExpected(r.date)),
          customer_id: p.id,
          withholder_tax_type: p.tax_id_type,
          withholder_tax_id: p.tax_id,
          withholder_name: p.tax_name || p.partner_name,
          receipt_line_wht_id: w.id,
          receipt_id: r.id,
          receipt_no: r.txNo,
          doc_type_id: l.docTypeId,
          doc_id: l.docId,
          doc_no: l.docNo,
          withholding_tax_id: w.withholdingTaxId,
          rate: w.rate,
          base_amount: w.base,
          amount: w.amount,
          created_by: actorId,
        },
      });
      await audit(db, "tax_withholding_slip", row.id, "TAMBAH", "create", actorId);
    }
  }
}

/**
 * The faktur of a posted Invoice Penjualan: pelunasan when it deducted Uang
 * Muka, normal otherwise; dated the latest Tanggal Kirim; net of the advances,
 * naming the faktur uang muka it deducts. None when it is not taxable or its
 * Uang Muka covered it whole. Idempotent.
 */
export async function createTaxDocsForInvoice(db: Db, invoiceId: number, actorId: number): Promise<void> {
  const v = await invoiceTaxBasis(db, invoiceId);
  if (!v || v.status !== "Posted" || !v.taxable || !v.rates || !(v.netDpp > 0)) return;
  const invoiceType = await docTypeId(db, "fin_ar_invoice");
  if (await db.taxFaktur.findFirst({ where: { source_doc_type_id: invoiceType, source_doc_id: v.id }, select: { id: true } })) return;

  const refs = v.deductions.length
    ? await db.taxFaktur.findMany({ where: { kind: "Advance", ar_item_id: { in: v.deductions.map((d) => d.arItemId) } }, select: { id: true, ar_item_id: true } })
    : [];
  const date = asDate(v.taxDate);
  const kind: TaxFakturKind = v.advanceUsed > 0 ? "Settlement" : "Normal";
  const row = await db.taxFaktur.create({
    data: {
      faktur_no: await nextNo(db, "FPK", date),
      kind,
      tax_date: date,
      deadline: asDate(uploadDeadline(v.taxDate)),
      ...(await buyerOf(db, v.customerId, v.addressId)),
      source_doc_type_id: invoiceType,
      source_doc_id: v.id,
      source_no: v.invoiceNo,
      customer_order_id: v.orderId,
      description: `Penjualan barang ${v.orderNo}${v.poNo ? ` (PO ${v.poNo})` : ""}`,
      ppn_rate: v.rates.rate,
      ppn_dpp_other_numerator: v.rates.otherNum,
      ppn_dpp_other_denominator: v.rates.otherDen,
      gross_dpp: v.dpp,
      advance_dpp: v.advanceUsed,
      dpp: v.netDpp,
      dpp_other: v.dppOther,
      ppn: v.ppn,
      created_by: actorId,
      lines: {
        create: v.lines.map((l, i) => ({
          line_no: i + 1,
          description: l.itemName,
          item_label: l.itemLabel,
          qty: l.qty,
          uom_label: l.uomLabel,
          price: l.price,
          gross_dpp: l.dpp,
          advance_dpp: l.advanceDpp,
          dpp: l.netDpp,
          dpp_other: l.dppOther,
          ppn: l.ppn,
        })),
      },
      refs: {
        create: v.deductions.flatMap((d) => {
          const ref = refs.find((x) => x.ar_item_id === d.arItemId);
          return ref ? [{ ref_faktur_id: ref.id, dpp_deducted: d.dppUsed }] : [];
        }),
      },
    },
  });
  await audit(db, "tax_faktur", row.id, "TAMBAH", "create", actorId);
}

/**
 * Makes the tax documents of everything posted before the tax module existed.
 * Idempotent; run once per database (`npm run db:tax-backfill`).
 */
export async function backfillTaxDocuments(actorId: number): Promise<{ receipts: number; invoices: number }> {
  const receipts = await postedReceiptIds();
  const invoices = await postedInvoiceIds();
  // Receipts first: an Invoice's faktur pelunasan names the faktur uang muka.
  for (const id of receipts) await prisma.$transaction((tx) => createTaxDocsForReceipt(tx, id, actorId));
  for (const id of invoices) await prisma.$transaction((tx) => createTaxDocsForInvoice(tx, id, actorId));
  return { receipts: receipts.length, invoices: invoices.length };
}

// --------------------------------------------------------------- recording

export type TaxResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * Fills in, corrects or clears a faktur's NSFP — the number Coretax gave it —
 * and, optionally, the day it was uploaded (P101). The faktur is an internal
 * record, complete without it; the NSFP is the reference that ties it to
 * Coretax, so a mistyped one is corrected here and the change is in its
 * history. Its figures never change. The NSFP is also written where the sales
 * process reads it — the Uang Muka item a faktur pelunasan deducts, the
 * Invoice (U9, U10). An empty NSFP clears it.
 */
export async function setFakturNsfp(id: number, input: { nsfp: string; date: string }, actorId: number): Promise<TaxResult> {
  const f = await prisma.taxFaktur.findUnique({ where: { id } });
  if (!f) return { ok: false, errors: { _form: "Faktur pajak tidak ditemukan." } };
  const errors: Record<string, string> = {};
  const nsfp = normalizeNsfp(input.nsfp) || null;
  const date = String(input.date ?? "").trim();
  if (nsfp) {
    if (nsfp.length !== 17) errors.nsfp = "NSFP Coretax terdiri dari 17 digit.";
    else if (await prisma.taxFaktur.findFirst({ where: { nsfp, id: { not: id } }, select: { id: true } })) {
      errors.nsfp = "NSFP ini sudah dipakai faktur lain.";
    }
    if (date && !DAY.test(date)) errors.date = "Tanggal tidak valid.";
    else if (date && date < isoDay(f.tax_date)) errors.date = "Tidak boleh sebelum tanggal faktur.";
  } else if (!f.nsfp) {
    errors.nsfp = "NSFP wajib diisi.";
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const nextDate = nsfp && date ? date : null;
  if (nsfp === f.nsfp && nextDate === (f.nsfp_date ? isoDay(f.nsfp_date) : null)) return { ok: true };

  const invoiceType = await docTypeId(prisma, "fin_ar_invoice");
  await prisma.$transaction(async (tx) => {
    await tx.taxFaktur.update({
      where: { id },
      data: { nsfp, nsfp_date: nextDate ? asDate(nextDate) : null, nsfp_by: nsfp ? actorId : null },
    });
    if (nsfp !== f.nsfp) {
      if (f.ar_item_id) await setArItemTaxInvoiceNo(tx, f.ar_item_id, nsfp);
      if (f.source_doc_type_id === invoiceType) await setInvoiceTaxInvoiceNo(tx, f.source_doc_id, nsfp);
    }
    await audit(tx, "tax_faktur", id, "UPDATE", !nsfp ? "nsfp_clear" : f.nsfp ? "nsfp_change" : "nsfp", actorId);
  });
  return { ok: true };
}

/**
 * Records the customer's bukti potong (BPPU) as received (`tax_concept.md`
 * §6.2): its number and date. The PPh can then be credited. It is assumed to
 * show the amount recorded (Q21). A slip already received may have its number
 * and date corrected; it stays received (P101).
 */
export async function recordSlipReceived(id: number, input: { number: string; date: string }, actorId: number): Promise<TaxResult> {
  const s = await prisma.taxWithholdingSlip.findUnique({ where: { id } });
  if (!s) return { ok: false, errors: { _form: "Bukti potong tidak ditemukan." } };
  const errors: Record<string, string> = {};
  const number = String(input.number ?? "").trim().toUpperCase();
  if (!number) errors.number = "Nomor bukti potong wajib diisi.";
  const date = String(input.date ?? "").trim();
  if (!DAY.test(date)) errors.date = "Tanggal bukti potong wajib diisi.";
  else if (date < isoDay(s.withheld_date)) errors.date = "Tidak boleh sebelum tanggal pembayaran.";
  if (Object.keys(errors).length) return { ok: false, errors };
  const correcting = s.status === "Received";
  if (correcting && number === s.slip_number && date === isoDay(s.slip_date)) return { ok: true };
  await prisma.$transaction(async (tx) => {
    const done = await tx.taxWithholdingSlip.updateMany({
      where: { id, status: s.status },
      data: { status: "Received", slip_number: number, slip_date: asDate(date), ...(correcting ? {} : { received_by: actorId }) },
    });
    if (done.count !== 1) throw new Error("Bukti potong berubah saat diproses. Muat ulang halaman.");
    await audit(tx, "tax_withholding_slip", id, "UPDATE", correcting ? "correct" : "receive", actorId);
  });
  return { ok: true };
}

// ------------------------------------------------------------------- reads

export type FakturListRow = {
  id: number;
  fakturNo: string;
  kind: TaxFakturKind;
  taxDate: string;
  deadline: string;
  customerLabel: string;
  customerName: string;
  sourceNo: string;
  sourceTable: string;
  sourceId: number;
  dpp: number;
  ppn: number;
  nsfp: string | null;
};

async function tablesById(db: Db, ids: number[]): Promise<Map<number, string>> {
  const rows = await db.sysDocType.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, doc_table: true } });
  return new Map(rows.map((r) => [r.id, r.doc_table]));
}

export async function listFakturs(): Promise<FakturListRow[]> {
  const rows = await prisma.taxFaktur.findMany({ orderBy: [{ tax_date: "desc" }, { id: "desc" }], include: { customer: true } });
  const tables = await tablesById(prisma, rows.map((r) => r.source_doc_type_id));
  return rows.map((r) => ({
    id: r.id,
    fakturNo: r.faktur_no,
    kind: r.kind as TaxFakturKind,
    taxDate: isoDay(r.tax_date),
    deadline: isoDay(r.deadline),
    customerLabel: r.customer.partner_label,
    customerName: r.customer.partner_name,
    sourceNo: r.source_no,
    sourceTable: tables.get(r.source_doc_type_id) ?? "",
    sourceId: r.source_doc_id,
    dpp: r.dpp.toNumber(),
    ppn: r.ppn.toNumber(),
    nsfp: r.nsfp,
  }));
}

export type FakturView = FakturListRow & {
  buyer: { taxType: string | null; taxId: string | null; name: string; address: string; label: string };
  ref: { no: string; table: string; id: number } | null;
  customerOrderId: number;
  description: string | null;
  rates: { rate: number; otherNum: number; otherDen: number };
  grossDpp: number;
  advanceDpp: number;
  dppOther: number;
  nsfpDate: string | null;
  lines: {
    lineNo: number;
    description: string;
    itemLabel: string | null;
    qty: number | null;
    uomLabel: string | null;
    price: number | null;
    grossDpp: number;
    advanceDpp: number;
    dpp: number;
    dppOther: number;
    ppn: number;
  }[];
  /** The faktur uang muka it deducts (pelunasan). */
  deducts: { id: number; fakturNo: string; nsfp: string | null; dpp: number }[];
  /** The faktur pelunasan that deduct it (uang muka). */
  deductedBy: { id: number; fakturNo: string; nsfp: string | null; dpp: number }[];
};

export async function getFaktur(id: number): Promise<FakturView | null> {
  const r = await prisma.taxFaktur.findUnique({
    where: { id },
    include: {
      customer: true,
      lines: { orderBy: { line_no: "asc" } },
      refs: { include: { ref_faktur: true } },
      used_by: { include: { faktur: true } },
    },
  });
  if (!r) return null;
  const tables = await tablesById(prisma, [r.source_doc_type_id, ...(r.ref_doc_type_id ? [r.ref_doc_type_id] : [])]);
  return {
    id: r.id,
    fakturNo: r.faktur_no,
    kind: r.kind as TaxFakturKind,
    taxDate: isoDay(r.tax_date),
    deadline: isoDay(r.deadline),
    customerLabel: r.customer.partner_label,
    customerName: r.customer.partner_name,
    sourceNo: r.source_no,
    sourceTable: tables.get(r.source_doc_type_id) ?? "",
    sourceId: r.source_doc_id,
    dpp: r.dpp.toNumber(),
    ppn: r.ppn.toNumber(),
    nsfp: r.nsfp,
    buyer: { taxType: r.buyer_tax_type, taxId: r.buyer_tax_id, name: r.buyer_name, address: r.buyer_address, label: r.customer.partner_label },
    ref: r.ref_doc_type_id && r.ref_doc_id ? { no: r.ref_no ?? "", table: tables.get(r.ref_doc_type_id) ?? "", id: r.ref_doc_id } : null,
    customerOrderId: r.customer_order_id,
    description: r.description,
    rates: { rate: r.ppn_rate.toNumber(), otherNum: r.ppn_dpp_other_numerator, otherDen: r.ppn_dpp_other_denominator },
    grossDpp: r.gross_dpp.toNumber(),
    advanceDpp: r.advance_dpp.toNumber(),
    dppOther: r.dpp_other.toNumber(),
    nsfpDate: r.nsfp_date ? isoDay(r.nsfp_date) : null,
    lines: r.lines.map((l) => ({
      lineNo: l.line_no,
      description: l.description,
      itemLabel: l.item_label,
      qty: l.qty?.toNumber() ?? null,
      uomLabel: l.uom_label,
      price: l.price?.toNumber() ?? null,
      grossDpp: l.gross_dpp.toNumber(),
      advanceDpp: l.advance_dpp.toNumber(),
      dpp: l.dpp.toNumber(),
      dppOther: l.dpp_other.toNumber(),
      ppn: l.ppn.toNumber(),
    })),
    deducts: r.refs.map((x) => ({ id: x.ref_faktur.id, fakturNo: x.ref_faktur.faktur_no, nsfp: x.ref_faktur.nsfp, dpp: x.dpp_deducted.toNumber() })),
    deductedBy: r.used_by.map((x) => ({ id: x.faktur.id, fakturNo: x.faktur.faktur_no, nsfp: x.faktur.nsfp, dpp: x.dpp_deducted.toNumber() })),
  };
}

export type SlipListRow = {
  id: number;
  slipNo: string;
  status: TaxSlipStatus;
  withheldDate: string;
  taxPeriod: string;
  expected: string;
  customerLabel: string;
  customerName: string;
  receiptNo: string;
  receiptId: number;
  docNo: string;
  docTable: string;
  docId: number;
  whtLabel: string;
  rate: number;
  base: number;
  amount: number;
  slipNumber: string | null;
};

const SLIP_INCLUDE = { customer: true, withholding_tax: true } as const;

function slipRow(r: Prisma.TaxWithholdingSlipGetPayload<{ include: typeof SLIP_INCLUDE }>, tables: Map<number, string>): SlipListRow {
  return {
    id: r.id,
    slipNo: r.slip_no,
    status: r.status as TaxSlipStatus,
    withheldDate: isoDay(r.withheld_date),
    taxPeriod: r.tax_period,
    expected: isoDay(r.expected_date),
    customerLabel: r.customer.partner_label,
    customerName: r.customer.partner_name,
    receiptNo: r.receipt_no,
    receiptId: r.receipt_id,
    docNo: r.doc_no,
    docTable: tables.get(r.doc_type_id) ?? "",
    docId: r.doc_id,
    whtLabel: r.withholding_tax.wht_label,
    rate: r.rate.toNumber(),
    base: r.base_amount.toNumber(),
    amount: r.amount.toNumber(),
    slipNumber: r.slip_number,
  };
}

export async function listSlips(): Promise<SlipListRow[]> {
  const rows = await prisma.taxWithholdingSlip.findMany({ orderBy: [{ withheld_date: "desc" }, { id: "desc" }], include: SLIP_INCLUDE });
  const tables = await tablesById(prisma, rows.map((r) => r.doc_type_id));
  return rows.map((r) => slipRow(r, tables));
}

export type SlipView = SlipListRow & {
  withholder: { taxType: string | null; taxId: string | null; name: string };
  whtName: string;
  slipDate: string | null;
};

export async function getSlip(id: number): Promise<SlipView | null> {
  const r = await prisma.taxWithholdingSlip.findUnique({ where: { id }, include: SLIP_INCLUDE });
  if (!r) return null;
  const tables = await tablesById(prisma, [r.doc_type_id]);
  return {
    ...slipRow(r, tables),
    withholder: { taxType: r.withholder_tax_type, taxId: r.withholder_tax_id, name: r.withholder_name },
    whtName: r.withholding_tax.wht_name,
    slipDate: r.slip_date ? isoDay(r.slip_date) : null,
  };
}

/** Faktur and slip numbers by id, for the audit panel. */
export async function fakturNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.taxFaktur.findMany({ where: { id: { in: ids } }, select: { id: true, faktur_no: true } });
  return new Map(rows.map((r) => [r.id, r.faktur_no]));
}

export async function slipNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.taxWithholdingSlip.findMany({ where: { id: { in: ids } }, select: { id: true, slip_no: true } });
  return new Map(rows.map((r) => [r.id, r.slip_no]));
}

/**
 * The tax documents a source document gave rise to, for its page's Referensi:
 * the fakturs it made, and the slips of a receipt or of a settled document.
 */
export async function taxDocsOf(
  table: "fin_cash_bank_tx" | "fin_ar_invoice" | "fin_ar_advance",
  id: number
): Promise<TaxDocRefs> {
  const typeId = await docTypeId(prisma, table);
  const [fakturs, slips] = await Promise.all([
    prisma.taxFaktur.findMany({
      where: table === "fin_ar_advance" ? { ref_doc_type_id: typeId, ref_doc_id: id } : { source_doc_type_id: typeId, source_doc_id: id },
      select: { id: true, faktur_no: true, nsfp: true },
      orderBy: { id: "asc" },
    }),
    prisma.taxWithholdingSlip.findMany({
      where: table === "fin_cash_bank_tx" ? { receipt_id: id } : { doc_type_id: typeId, doc_id: id },
      select: { id: true, slip_no: true },
      orderBy: { id: "asc" },
    }),
  ]);
  return {
    fakturs: fakturs.map((f) => ({ id: f.id, fakturNo: f.faktur_no, nsfp: f.nsfp })),
    slips: slips.map((s) => ({ id: s.id, slipNo: s.slip_no })),
  };
}
