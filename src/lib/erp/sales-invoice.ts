import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import { formatNumber } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "./currency";
import { checkTransactionDate } from "./fiscal";
import { journalNumbersByIds, postJournal } from "./journal";
import { checkAccountIsLeaf } from "./records";
import { formatAddress } from "./partner-shape";
import { invoiceSourceOrders, lockCustomerOrder, type InvoiceSourceOrder } from "./customer-order";
import { invoiceSourceLines, type InvoiceSourceLine } from "./delivery-note";
import {
  ArItemOverdrawn,
  advanceItemsForInvoice,
  createArItem,
  settleArItem,
  type AdvanceItemForInvoice,
} from "./ar-item";
import { computeInvoice, type InvoiceFigures, type InvoiceLineInput as TaxLine } from "./sales-tax";
import { postingAccounts } from "./system-settings";
import {
  INVOICE_HOLDS,
  INVOICE_TRANSITIONS,
  invoiceIsEditable,
  invoiceTransitionAllowed,
  type InvoiceAction,
  type InvoiceStatus,
} from "./sales-invoice-workflow";

/**
 * The Faktur Penjualan module (`Sales-Process-Concept.md` §9, U16–U22): its
 * tables are `sal_invoice`, `sal_invoice_line` and
 * `sal_invoice_advance_deduction`, and nothing else names them.
 *
 * A Faktur bills **one Customer Order** (U16) for goods already sent: its lines
 * are whole lines of that order's posted Delivery Notes (U17), each billed by
 * at most one live Faktur, priced from the order line in the order's price mode
 * and PPN snapshot (U18, U20). The user picks which of the order's Uang Muka
 * items it uses and types the DPP used from each (U8). The Faktur has its own
 * date; its faktur pajak's date and its due date follow from the latest
 * Tanggal Kirim of the notes it bills (U19).
 *
 * Posting, in one transaction under the order's lock, writes Dr Piutang Usaha
 * (net) · Dr Uang Muka Penjualan (DPP used) / Cr Penjualan (full DPP) · Cr PPN
 * Keluaran (on the net DPP), creates the Invoice AR item and lowers each Uang
 * Muka item used. It never reads a receipt (U7).
 *
 * The order is read through `invoiceSourceOrders`, the notes through
 * `invoiceSourceLines`, the Uang Muka through `advanceItemsForInvoice`.
 */

type Db = Prisma.TransactionClient | typeof prisma;

// ------------------------------------------------------------------ input

export type InvoiceHeaderInput = {
  customer_order_id: number | null;
  invoice_date: string;
  address_id: number | null;
  cash_bank_id: number | null;
  note: string;
};

export type InvoiceLineInput = { delivery_note_line_id: number | null };

export type InvoiceDeductionInput = { ar_item_id: number | null; dpp_used: number | string };

export type InvoiceResult = { ok: true; id: number; invoiceNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const text = (v: string | null | undefined) => String(v ?? "").trim() || null;
const money = (n: number) => `Rp ${formatNumber(n, 0)}`;

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

// ------------------------------------------------------------- what is held

/** Delivery Note lines other live Fakturs bill — by line, the Faktur that does. */
async function billedNoteLines(db: Db, lineIds: number[], exceptId: number | null): Promise<Map<number, { id: number; no: string }>> {
  if (!lineIds.length) return new Map();
  const rows = await db.salInvoiceLine.findMany({
    where: {
      delivery_note_line_id: { in: lineIds },
      invoice: { status: { in: INVOICE_HOLDS }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    },
    select: { delivery_note_line_id: true, invoice: { select: { id: true, invoice_no: true } } },
  });
  return new Map(rows.map((r) => [r.delivery_note_line_id, { id: r.invoice.id, no: r.invoice.invoice_no }]));
}

/** What other live Fakturs bill of each Customer Order line: quantity and amount. */
async function billedOrderLines(db: Db, lineIds: number[], exceptId: number | null): Promise<Map<number, { qty: number; amount: number }>> {
  if (!lineIds.length) return new Map();
  const rows = await db.salInvoiceLine.groupBy({
    by: ["customer_order_line_id"],
    where: {
      customer_order_line_id: { in: lineIds },
      invoice: { status: { in: INVOICE_HOLDS }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    },
    _sum: { qty: true, amount: true },
  });
  return new Map(
    rows.map((r) => [r.customer_order_line_id, { qty: r._sum?.qty?.toNumber() ?? 0, amount: r._sum?.amount?.toNumber() ?? 0 }])
  );
}

/** What other Draft Fakturs reserve of each Uang Muka item; a posted one has already lowered its balance. */
async function reservedAdvances(db: Db, itemIds: number[], exceptId: number | null): Promise<Map<number, number>> {
  if (!itemIds.length) return new Map();
  const rows = await db.salInvoiceAdvanceDeduction.groupBy({
    by: ["ar_item_id"],
    where: { ar_item_id: { in: itemIds }, invoice: { status: "Draft", ...(exceptId ? { id: { not: exceptId } } : {}) } },
    _sum: { dpp_used: true },
  });
  return new Map(rows.map((r) => [r.ar_item_id, r._sum?.dpp_used?.toNumber() ?? 0]));
}

// ---------------------------------------------------------------- options

export type InvoiceNoteLine = InvoiceSourceLine & {
  /** The live Faktur that already bills it, if any. */
  billedBy: { id: number; no: string } | null;
};

export type InvoiceAdvance = AdvanceItemForInvoice & {
  /** What other Draft Fakturs reserve of it. */
  reserved: number;
};

export type InvoiceOrderOption = InvoiceSourceOrder & {
  addresses: { id: number; text: string; isBilling: boolean }[];
  noteLines: InvoiceNoteLine[];
  advances: InvoiceAdvance[];
  /** Per Customer Order line, what other live Fakturs bill — for the completing-bill rule. */
  billedBefore: Record<number, { qty: number; amount: number }>;
};

export type InvoiceBankOption = { id: number; label: string; name: string; active: boolean };

export type InvoiceOptions = { orders: InvoiceOrderOption[]; banks: InvoiceBankOption[] };

async function addressesOf(db: Db, partnerIds: number[]): Promise<Map<number, { id: number; text: string; isBilling: boolean }[]>> {
  const rows = await db.mPartnerAddress.findMany({
    where: { partner_id: { in: partnerIds } },
    orderBy: [{ sort_order: "asc" }, { id: "asc" }],
    include: { village: { include: { district: { include: { city: { include: { province: true } } } } } } },
  });
  const out = new Map<number, { id: number; text: string; isBilling: boolean }[]>();
  for (const a of rows) {
    const d = a.village.district;
    const list = out.get(a.partner_id) ?? [];
    list.push({
      id: a.id,
      isBilling: a.is_billing,
      text: formatAddress({
        provinceName: d.city.province.name,
        cityName: d.city.name,
        districtName: d.name,
        villageName: a.village.name,
        street: a.street,
        postalCode: a.village.postal_code ?? "",
      }),
    });
    out.set(a.partner_id, list);
  }
  return out;
}

async function orderOptions(
  db: Db,
  orders: InvoiceSourceOrder[],
  exceptId: number | null,
  keep: { lineIds: number[]; itemIds: number[] } = { lineIds: [], itemIds: [] }
): Promise<InvoiceOrderOption[]> {
  if (!orders.length) return [];
  const orderIds = orders.map((o) => o.id);
  const [posted, kept, open, keptItems, addresses] = await Promise.all([
    invoiceSourceLines({ customerOrderIds: orderIds }, db),
    keep.lineIds.length ? invoiceSourceLines({ lineIds: keep.lineIds }, db) : Promise.resolve([]),
    advanceItemsForInvoice({ orderIds }, db),
    keep.itemIds.length ? advanceItemsForInvoice({ ids: keep.itemIds }, db) : Promise.resolve([]),
    addressesOf(db, [...new Set(orders.map((o) => o.customerId))]),
  ]);
  const lines = [...posted, ...kept.filter((k) => !posted.some((p) => p.id === k.id))];
  const items = [...open, ...keptItems.filter((k) => !open.some((o) => o.id === k.id))];
  const [billed, before, reserved] = await Promise.all([
    billedNoteLines(db, lines.map((l) => l.id), exceptId),
    billedOrderLines(db, orders.flatMap((o) => o.lines.map((l) => l.id)), exceptId),
    reservedAdvances(db, items.map((i) => i.id), exceptId),
  ]);
  return orders.map((o) => ({
    ...o,
    addresses: addresses.get(o.customerId) ?? [],
    noteLines: lines.filter((l) => l.customerOrderId === o.id).map((l) => ({ ...l, billedBy: billed.get(l.id) ?? null })),
    advances: items.filter((i) => i.orderId === o.id).map((i) => ({ ...i, reserved: reserved.get(i.id) ?? 0 })),
    billedBefore: Object.fromEntries(o.lines.map((l) => [l.id, before.get(l.id) ?? { qty: 0, amount: 0 }])),
  }));
}

/**
 * What the form offers: every Open or Closed Customer Order with a posted,
 * unbilled Delivery Note line, and the rupiah banks to print. `current` is the
 * Faktur being edited or shown — its own order is always included, and its own
 * lines and Uang Muka never count against it.
 */
export async function invoiceOptions(
  current: { id: number; orderId: number; lineIds: number[]; itemIds: number[] } | null = null
): Promise<InvoiceOptions> {
  const [all, banks] = await Promise.all([
    invoiceSourceOrders({}),
    prisma.mCashBank.findMany({
      where: { cash_bank_type: "Bank", currency: { currency_label: BASE_CURRENCY_LABEL } },
      orderBy: { cash_bank_label: "asc" },
    }),
  ]);
  const others = await orderOptions(prisma, all.filter((o) => o.id !== current?.orderId), current?.id ?? null);
  const orders = others.filter((o) => o.noteLines.some((l) => !l.billedBy));
  if (current) {
    const mine = await invoiceSourceOrders({ ids: [current.orderId] });
    orders.unshift(...(await orderOptions(prisma, mine, current.id, { lineIds: current.lineIds, itemIds: current.itemIds })));
  }
  return {
    orders,
    banks: banks.map((b) => ({ id: b.id, label: b.cash_bank_label, name: b.cash_bank_name, active: b.status === "Active" })),
  };
}

// ------------------------------------------------------------- validation

type CheckedLine = {
  line_no: number;
  delivery_note_line_id: number;
  customer_order_line_id: number;
  qty: number;
  price: number;
  amount: number;
  dpp_amount: number;
  advance_dpp_amount: number;
  net_dpp_amount: number;
  dpp_other_amount: number;
  ppn_amount: number;
  withholding_tax_id: number | null;
  withholding_rate: number | null;
};

type CheckedDeduction = { ar_item_id: number; ar_item_no: string; dpp_used: number };

export type CheckedInvoice = {
  order: InvoiceOrderOption;
  figures: InvoiceFigures;
  data: {
    customer_order_id: number;
    customer_id: number;
    address_id: number;
    cash_bank_id: number;
    invoice_date: Date;
    tax_date: Date;
    due_date: Date;
    price_mode: "Exclude" | "Include";
    is_taxable: boolean;
    ppn_rate: number | null;
    ppn_dpp_other_numerator: number | null;
    ppn_dpp_other_denominator: number | null;
    amount: number;
    dpp_amount: number;
    advance_dpp_amount: number;
    net_dpp_amount: number;
    dpp_other_amount: number;
    ppn_amount: number;
    total_amount: number;
    note: string | null;
  };
  lines: CheckedLine[];
  deductions: CheckedDeduction[];
  /** Which note each line came from, for the journal's text. */
  noteNos: string[];
};

/**
 * Every rule a Faktur must satisfy to be saved — and, run again inside the
 * posting transaction with the order locked, to be posted.
 */
export async function checkInvoice(
  db: Db,
  header: InvoiceHeaderInput,
  lines: InvoiceLineInput[],
  deductions: InvoiceDeductionInput[],
  selfId: number | null,
  keep: { lineIds: number[]; itemIds: number[] } = { lineIds: [], itemIds: [] }
): Promise<{ ok: true; c: CheckedInvoice } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};

  const orderId = Number(header.customer_order_id) || null;
  const [source] = orderId ? await invoiceSourceOrders({ ids: [orderId] }, db) : [];
  const [order] = source ? await orderOptions(db, [source], selfId, keep) : [];
  if (!orderId) errors.customer_order_id = "Pilih Customer Order.";
  else if (!order) errors.customer_order_id = "Customer Order tidak ditemukan.";
  else if (order.status !== "Open" && order.status !== "Closed") errors.customer_order_id = "Customer Order harus berstatus Open atau Ditutup.";
  else if (!order.customerActive) errors.customer_order_id = "Customer pada Customer Order ini sudah nonaktif.";

  // ---- lines: whole Delivery Note lines of this order's posted notes (U17)
  const raw = Array.isArray(lines) ? lines : [];
  if (!raw.length) errors._lines = "Pilih minimal satu barang dari Delivery Note.";
  const noteById = new Map((order?.noteLines ?? []).map((l) => [l.id, l]));
  const orderLine = new Map((order?.lines ?? []).map((l) => [l.id, l]));
  const seen = new Set<number>();
  const picked: InvoiceNoteLine[] = [];
  for (const [i, l] of raw.entries()) {
    const id = Number(l.delivery_note_line_id) || null;
    const key = `lines.${i}.delivery_note_line_id`;
    const n = id ? noteById.get(id) : undefined;
    if (!id) errors[key] = "Pilih barang.";
    else if (!n) errors[key] = order ? "Barang bukan bagian Delivery Note Customer Order ini." : "Pilih Customer Order dulu…";
    else if (n.status !== "Posted") errors[key] = `${n.dnNo} belum diposting.`;
    else if (n.billedBy) errors[key] = `Sudah ditagih dengan ${n.billedBy.no}.`;
    else if (seen.has(id)) errors[key] = `${n.itemLabel} (${n.dnNo}) dipilih lebih dari sekali.`;
    else {
      seen.add(id);
      picked.push(n);
    }
  }

  // ---- dates (U19)
  const taxDate = picked.reduce((m, l) => (l.dnDate > m ? l.dnDate : m), "");
  const invoiceDate = String(header.invoice_date ?? "").trim();
  if (!DAY.test(invoiceDate)) errors.invoice_date = "Tanggal faktur wajib diisi.";
  else if (taxDate && invoiceDate < taxDate) errors.invoice_date = `Tidak boleh sebelum Tanggal Kirim terakhir (${isoDay(asDate(taxDate)).split("-").reverse().join("/")}).`;

  // ---- address and bank
  const addressId = Number(header.address_id) || null;
  if (!addressId) errors.address_id = "Pilih alamat penagihan.";
  else if (order && !order.addresses.some((a) => a.id === addressId)) errors.address_id = "Alamat bukan milik customer ini.";
  const bankId = Number(header.cash_bank_id) || null;
  if (!bankId) errors.cash_bank_id = "Pilih rekening pembayaran.";
  else {
    const b = await db.mCashBank.findUnique({ where: { id: bankId }, include: { currency: true } });
    if (!b) errors.cash_bank_id = "Rekening tidak ditemukan.";
    else if (b.cash_bank_type !== "Bank") errors.cash_bank_id = "Pilih rekening bank, bukan kas.";
    else if (b.currency.currency_label !== BASE_CURRENCY_LABEL) errors.cash_bank_id = "Rekening harus dalam Rupiah.";
    else if (b.status !== "Active") errors.cash_bank_id = "Rekening tersebut sudah nonaktif.";
  }

  // ---- figures: each line priced from its order line, a later line of the
  // same order line counting what an earlier one billed (§9.3)
  const running = new Map(Object.entries(order?.billedBefore ?? {}).map(([k, v]) => [Number(k), { ...v }]));
  const priced: TaxLine[] = [];
  const pricedLine = (n: InvoiceNoteLine): TaxLine => {
    const o = orderLine.get(n.customerOrderLineId)!;
    const b = running.get(o.id) ?? { qty: 0, amount: 0 };
    return {
      qty: n.qty,
      orderQty: o.qty,
      orderAmount: o.amount,
      price: o.price,
      discountType: o.discountType,
      discountValue: o.discountValue,
      billedQtyBefore: b.qty,
      billedAmountBefore: b.amount,
      withholdingRate: o.withholdingRate,
      withholdingKey: o.withholdingTaxId ? String(o.withholdingTaxId) : null,
    };
  };
  for (const n of picked) {
    const input = pricedLine(n);
    priced.push(input);
    const amount = computeInvoice({ lines: [input], mode: order!.mode, taxable: order!.taxable, rates: order!.rates, advanceUsed: 0 }).amount;
    const b = running.get(n.customerOrderLineId) ?? { qty: 0, amount: 0 };
    running.set(n.customerOrderLineId, { qty: b.qty + n.qty, amount: b.amount + amount });
  }
  const before = computeInvoice({ lines: priced, mode: order?.mode ?? "Exclude", taxable: order?.taxable ?? false, rates: order?.rates ?? null, advanceUsed: 0 });

  // ---- Uang Muka used (U8): the order's own items, each up to what is free of it
  const rawDeds = Array.isArray(deductions) ? deductions : [];
  const itemById = new Map((order?.advances ?? []).map((a) => [a.id, a]));
  const checkedDeds: CheckedDeduction[] = [];
  const seenItems = new Set<number>();
  for (const [i, d] of rawDeds.entries()) {
    const id = Number(d.ar_item_id) || null;
    const key = `deductions.${i}.dpp_used`;
    const item = id ? itemById.get(id) : undefined;
    if (!id || !item) {
      errors[`deductions.${i}.ar_item_id`] = "Uang muka bukan milik Customer Order ini.";
      continue;
    }
    if (seenItems.has(id)) {
      errors[`deductions.${i}.ar_item_id`] = `${item.arItemNo} dipilih lebih dari sekali.`;
      continue;
    }
    seenItems.add(id);
    const used = Number(String(d.dpp_used ?? "").replace(",", "."));
    const free = Math.max(0, item.balance - item.reserved);
    if (!Number.isFinite(used) || !(used > 0)) errors[key] = "Isi DPP yang dipakai lebih dari 0.";
    else if (used !== Math.round(used)) errors[key] = "DPP dipakai harus dalam rupiah penuh.";
    else if (used > free) errors[key] = `Melebihi sisa uang muka (${money(free)}${item.reserved ? `; ${money(item.reserved)} dicadangkan Faktur Draft lain` : ""}).`;
    else checkedDeds.push({ ar_item_id: id, ar_item_no: item.arItemNo, dpp_used: used });
  }
  const used = checkedDeds.reduce((a, d) => a + d.dpp_used, 0);
  if (used > before.dpp) errors._deductions = `Uang muka dipakai (${money(used)}) melebihi DPP faktur (${money(before.dpp)}).`;
  else if (!errors._deductions && Object.keys(errors).some((k) => k.startsWith("deductions."))) {
    errors._deductions = "Ada uang muka yang perlu diperbaiki.";
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";

  if (Object.keys(errors).length || !order) return { ok: false, errors };

  const figures = computeInvoice({ lines: priced, mode: order.mode, taxable: order.taxable, rates: order.rates, advanceUsed: used });
  return {
    ok: true,
    c: {
      order,
      figures,
      data: {
        customer_order_id: order.id,
        customer_id: order.customerId,
        address_id: addressId!,
        cash_bank_id: bankId!,
        invoice_date: asDate(invoiceDate),
        tax_date: asDate(taxDate),
        due_date: asDate(addDays(taxDate, order.termDays)),
        price_mode: order.mode,
        is_taxable: order.taxable,
        ppn_rate: order.rates?.rate ?? null,
        ppn_dpp_other_numerator: order.rates?.otherNum ?? null,
        ppn_dpp_other_denominator: order.rates?.otherDen ?? null,
        amount: figures.amount,
        dpp_amount: figures.dpp,
        advance_dpp_amount: figures.advanceUsed,
        net_dpp_amount: figures.netDpp,
        dpp_other_amount: figures.dppOther,
        ppn_amount: figures.ppn,
        total_amount: figures.total,
        note: text(header.note),
      },
      lines: picked.map((n, i) => {
        const o = orderLine.get(n.customerOrderLineId)!;
        const f = figures.lines[i];
        return {
          line_no: i + 1,
          delivery_note_line_id: n.id,
          customer_order_line_id: o.id,
          qty: n.qty,
          price: o.price,
          amount: f.amount,
          dpp_amount: f.dpp,
          advance_dpp_amount: f.advanceDpp,
          net_dpp_amount: f.netDpp,
          dpp_other_amount: f.dppOther,
          ppn_amount: f.ppn,
          withholding_tax_id: o.withholdingTaxId,
          withholding_rate: o.withholdingRate,
        };
      }),
      deductions: checkedDeds,
      noteNos: picked.map((n) => n.dnNo),
    },
  };
}

// ------------------------------------------------------------------ writes

async function nextInvoiceNo(db: Db, date: Date): Promise<string> {
  return nextDocumentNumber("INV", date, async (series) => {
    const row = await db.salInvoice.findFirst({
      where: { invoice_no: { startsWith: series } },
      orderBy: { id: "desc" },
      select: { invoice_no: true },
    });
    return row?.invoice_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "sal_invoice", row_id: id, action, event, by } });
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
    if (e instanceof ArItemOverdrawn) return { ok: false, errors: { _form: `Belum bisa diposting: ${e.message}` } };
    throw e;
  }
}

async function writeRows(tx: Prisma.TransactionClient, id: number, c: CheckedInvoice) {
  await tx.salInvoiceLine.deleteMany({ where: { invoice_id: id } });
  await tx.salInvoiceAdvanceDeduction.deleteMany({ where: { invoice_id: id } });
  for (const l of c.lines) await tx.salInvoiceLine.create({ data: { ...l, invoice_id: id } });
  for (const d of c.deductions) await tx.salInvoiceAdvanceDeduction.create({ data: { ...d, invoice_id: id } });
}

export async function createInvoice(
  header: InvoiceHeaderInput,
  lines: InvoiceLineInput[],
  deductions: InvoiceDeductionInput[],
  actorId: number
): Promise<InvoiceResult> {
  const orderId = Number(header.customer_order_id) || null;
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      if (orderId) await lockCustomerOrder(tx, orderId);
      const r = await checkInvoice(tx, header, lines, deductions, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.salInvoice.create({
        data: { ...r.c.data, invoice_no: await nextInvoiceNo(tx, r.c.data.invoice_date), created_by: actorId },
      });
      await writeRows(tx, row.id, r.c);
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, invoiceNo: made.invoice_no };
  });
}

export async function updateInvoice(
  id: number,
  header: InvoiceHeaderInput,
  lines: InvoiceLineInput[],
  deductions: InvoiceDeductionInput[],
  actorId: number
): Promise<InvoiceResult> {
  const current = await prisma.salInvoice.findUnique({
    where: { id },
    select: { status: true, invoice_no: true, customer_order_id: true, lines: { select: { delivery_note_line_id: true } }, deductions: { select: { ar_item_id: true } } },
  });
  if (!current) return { ok: false, errors: { _form: "Faktur Penjualan tidak ditemukan." } };
  if (!invoiceIsEditable(current.status as InvoiceStatus)) {
    return { ok: false, errors: { _form: "Faktur yang sudah diposting atau dibatalkan tidak dapat diubah." } };
  }
  if (Number(header.customer_order_id) !== current.customer_order_id) {
    return { ok: false, errors: { customer_order_id: "Customer Order tidak dapat diganti. Buat Faktur baru untuk Customer Order lain." } };
  }
  const keep = { lineIds: current.lines.map((l) => l.delivery_note_line_id), itemIds: current.deductions.map((d) => d.ar_item_id) };
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await lockCustomerOrder(tx, current.customer_order_id);
      const r = await checkInvoice(tx, header, lines, deductions, id, keep);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.salInvoice.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Faktur berubah saat diproses. Muat ulang halaman." });
      await writeRows(tx, id, r.c);
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, invoiceNo: current.invoice_no };
  });
}

type StoredInvoice = Prisma.SalInvoiceGetPayload<{ include: { lines: true; deductions: true } }>;
const WITH_ROWS = { lines: { orderBy: { line_no: "asc" as const } }, deductions: { orderBy: { id: "asc" as const } } };

function asInput(n: StoredInvoice) {
  return {
    header: {
      customer_order_id: n.customer_order_id,
      invoice_date: isoDay(n.invoice_date),
      address_id: n.address_id,
      cash_bank_id: n.cash_bank_id,
      note: n.note ?? "",
    } satisfies InvoiceHeaderInput,
    lines: n.lines.map((l) => ({ delivery_note_line_id: l.delivery_note_line_id })) satisfies InvoiceLineInput[],
    deductions: n.deductions.map((d) => ({ ar_item_id: d.ar_item_id, dpp_used: d.dpp_used.toNumber() })) satisfies InvoiceDeductionInput[],
    keep: { lineIds: n.lines.map((l) => l.delivery_note_line_id), itemIds: n.deductions.map((d) => d.ar_item_id) },
  };
}

// --------------------------------------------------------------- posting

export type InvoicePostingLine = {
  accountId: number;
  accountNo: string;
  accountName: string;
  partnerId: number | null;
  debit: number;
  credit: number;
  description: string;
};

type InvoicePosting =
  | { ok: true; description: string; lines: InvoicePostingLine[] }
  | { ok: false; missing: string[] };

/** The journal a checked Faktur writes — shown by the Posting dialog and written by Posting. */
async function buildPosting(db: Db, invoiceNo: string, c: CheckedInvoice): Promise<InvoicePosting> {
  const f = c.figures;
  const keys = [
    "receivable_account",
    "sales_revenue_account",
    ...(f.advanceUsed > 0 ? (["sales_advance_account"] as const) : []),
    ...(f.ppn > 0 ? (["output_vat_account"] as const) : []),
  ] as const;
  const mapped = await postingAccounts([...keys]);
  if (!mapped.ok) return { ok: false, missing: mapped.missing };
  const ids = mapped.ids as Record<string, number>;
  const accounts = new Map(
    (await db.accAccount.findMany({ where: { id: { in: Object.values(ids) } }, select: { id: true, account_label: true, account_name: true } })).map(
      (a) => [a.id, a]
    )
  );
  const problems: string[] = [];
  for (const [k, accId] of Object.entries(ids)) {
    const p = await accountProblem(db, accId);
    if (p) problems.push(`${k}: ${p}`);
  }
  if (problems.length) return { ok: false, missing: problems };
  const line = (accountId: number, debit: number, credit: number, description: string, partnerId: number | null = null): InvoicePostingLine => {
    const a = accounts.get(accountId)!;
    return { accountId, accountNo: a.account_label, accountName: a.account_name, partnerId, debit, credit, description };
  };
  const customer = c.order.customerId;
  const notes = [...new Set(c.noteNos)].join(", ");
  const out: InvoicePostingLine[] = [];
  if (f.total > 0) out.push(line(ids.receivable_account, f.total, 0, `Piutang ${invoiceNo} — jatuh tempo ${isoDay(c.data.due_date).split("-").reverse().join("/")}`, customer));
  for (const d of c.deductions) {
    out.push(line(ids.sales_advance_account, d.dpp_used, 0, `Uang muka ${d.ar_item_no} dipakai ${invoiceNo}`, customer));
  }
  out.push(line(ids.sales_revenue_account, 0, f.dpp, `Penjualan barang ${notes} (${c.order.orderNo})`));
  if (f.ppn > 0) {
    out.push(
      line(ids.output_vat_account, 0, f.ppn, f.advanceUsed > 0 ? `PPN atas DPP setelah uang muka — ${invoiceNo}` : `PPN atas penyerahan — ${invoiceNo}`)
    );
  }
  return { ok: true, description: `${invoiceNo} · Faktur Penjualan ${c.order.orderNo} — ${c.order.customerName}`, lines: out };
}

/** Why an account may not be posted to, or null. */
async function accountProblem(db: Db, id: number): Promise<string | null> {
  const a = await db.accAccount.findUnique({ where: { id }, select: { is_postable: true, is_active: true } });
  if (!a) return "tidak ditemukan";
  if (!a.is_postable) return "bukan account postable";
  if (!a.is_active) return "non-aktif";
  return checkAccountIsLeaf(id);
}

export type InvoicePreview = {
  lines: InvoicePostingLine[];
  /** Why posting would be refused now, each said once. */
  blocked: string[];
};

/** What Posting would write, read before it runs (consequences before commitment). */
export async function invoicePreview(id: number): Promise<InvoicePreview | null> {
  const n = await prisma.salInvoice.findUnique({ where: { id }, include: WITH_ROWS });
  if (!n) return null;
  const input = asInput(n);
  const r = await checkInvoice(prisma, input.header, input.lines, input.deductions, id, input.keep);
  if (!r.ok) return { lines: [], blocked: [...new Set(Object.entries(r.errors).filter(([k]) => !k.startsWith("_") || k === "_form").map(([, v]) => v))] };
  const p = await buildPosting(prisma, n.invoice_no, r.c);
  if (!p.ok) return { lines: [], blocked: [`Account Mapping belum lengkap: ${p.missing.join(", ")}.`] };
  const period = await checkTransactionDate(isoDay(n.invoice_date));
  return { lines: p.lines, blocked: period.ok ? [] : [period.message] };
}

export type InvoiceTransitionResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle step. **Posting**, in one transaction with the order
 * locked: checks the stored Faktur again, writes the journal dated Tanggal
 * Faktur, creates the Invoice AR item at net Piutang with its due date, lowers
 * each Uang Muka item used (*Dipakai Invoice*, naming the Invoice item), and
 * restates the Faktur's figures as posted. **Batalkan** (Draft only) asks for a
 * reason and writes nothing else.
 */
export async function transitionInvoice(
  id: number,
  action: InvoiceAction,
  actorId: number,
  reason?: string
): Promise<InvoiceTransitionResult> {
  const n = await prisma.salInvoice.findUnique({ where: { id }, include: WITH_ROWS });
  if (!n) return { ok: false, errors: { _form: "Faktur Penjualan tidak ditemukan." } };
  const t = INVOICE_TRANSITIONS[action];
  if (!invoiceTransitionAllowed(action, n.status as InvoiceStatus)) {
    return { ok: false, errors: { _form: `Faktur berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  const moved = "Faktur berubah saat diproses. Muat ulang halaman.";

  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      const done = await tx.salInvoice.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const period = await checkTransactionDate(isoDay(n.invoice_date));
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  const baseCurrency = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!baseCurrency) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await lockCustomerOrder(tx, n.customer_order_id);
      const input = asInput(n);
      const r = await checkInvoice(tx, input.header, input.lines, input.deductions, id, input.keep);
      if (!r.ok) {
        const first = Object.entries(r.errors).find(([k]) => !k.startsWith("_"))?.[1] ?? Object.values(r.errors)[0];
        throw new Refused({ _form: `Belum bisa diposting: ${first}` });
      }
      const p = await buildPosting(tx, n.invoice_no, r.c);
      if (!p.ok) throw new Refused({ _form: `Lengkapi Account Mapping dulu: ${p.missing.join(", ")}.` });

      const done = await tx.salInvoice.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });
      await writeRows(tx, id, r.c);

      const typeId = await docTypeId(tx, "sal_invoice");
      const journal = await postJournal(tx, {
        description: p.description,
        sourceDocTypeId: typeId,
        sourceDocId: id,
        postingDate: r.c.data.invoice_date,
        actorId,
        lines: p.lines.map((l) => ({
          accountId: l.accountId,
          partnerId: l.partnerId,
          currencyId: baseCurrency.id,
          rate: 1,
          debit: l.debit,
          credit: l.credit,
          description: l.description,
        })),
      });

      // The Invoice item at net Piutang, about this Faktur (U1), then each Uang
      // Muka used, naming it (P72).
      const doc = { docTypeId: typeId, docId: id, no: n.invoice_no };
      const date = isoDay(r.c.data.invoice_date);
      const itemId =
        r.c.figures.total > 0
          ? await createArItem(tx, {
              type: "Invoice",
              partnerId: r.c.order.customerId,
              currencyId: baseCurrency.id,
              date,
              dueDate: isoDay(r.c.data.due_date),
              source: doc,
              createdBy: doc,
              orderId: r.c.order.id,
              amount: r.c.figures.total,
              note: `Faktur ${n.invoice_no} diposting`,
              actorId,
            })
          : null;
      for (const d of r.c.deductions) {
        await settleArItem(tx, {
          itemId: d.ar_item_id,
          event: "AdvanceUsed",
          amount: d.dpp_used,
          date,
          doc,
          counterItemId: itemId,
          note: `Dipakai ${n.invoice_no}`,
          actorId,
        });
      }
      await tx.salInvoice.update({ where: { id }, data: { journal_id: journal.id, ar_item_id: itemId } });
      await audit(tx, id, "UPDATE", "post", actorId);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

export type InvoiceListRow = {
  id: number;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  status: InvoiceStatus;
  customerOrderId: number;
  customerOrderNo: string;
  customerLabel: string;
  customerName: string;
  lines: number;
  total: number;
};

export async function listInvoices(): Promise<InvoiceListRow[]> {
  const rows = await prisma.salInvoice.findMany({
    orderBy: [{ invoice_date: "desc" }, { id: "desc" }],
    include: { customer: true, _count: { select: { lines: true } } },
  });
  const orders = new Map(
    (await invoiceSourceOrders({ ids: [...new Set(rows.map((r) => r.customer_order_id))] })).map((o) => [o.id, o.orderNo])
  );
  return rows.map((r) => ({
    id: r.id,
    invoiceNo: r.invoice_no,
    invoiceDate: isoDay(r.invoice_date),
    dueDate: isoDay(r.due_date),
    status: r.status as InvoiceStatus,
    customerOrderId: r.customer_order_id,
    customerOrderNo: orders.get(r.customer_order_id) ?? "",
    customerLabel: r.customer.partner_label,
    customerName: r.customer.partner_name,
    lines: r._count.lines,
    total: r.total_amount.toNumber(),
  }));
}

export type InvoiceView = {
  id: number;
  invoiceNo: string;
  status: InvoiceStatus;
  header: InvoiceHeaderInput;
  lines: InvoiceLineInput[];
  deductions: { ar_item_id: number; dpp_used: number }[];
  taxDate: string;
  dueDate: string;
  /** As stored: what was computed at the last save, or at Posting. */
  stored: {
    lines: { delivery_note_line_id: number; amount: number; dpp: number; advanceDpp: number; netDpp: number; ppn: number }[];
    amount: number;
    dpp: number;
    advanceUsed: number;
    netDpp: number;
    dppOther: number;
    ppn: number;
    total: number;
  };
  taxInvoiceNo: string | null;
  journalId: number | null;
  journalNo: string | null;
  arItemId: number | null;
  cancelReason: string | null;
};

export async function getInvoice(id: number): Promise<InvoiceView | null> {
  const n = await prisma.salInvoice.findUnique({ where: { id }, include: WITH_ROWS });
  if (!n) return null;
  const input = asInput(n);
  const journalNo = n.journal_id ? ((await journalNumbersByIds([n.journal_id])).get(n.journal_id) ?? null) : null;
  return {
    id: n.id,
    invoiceNo: n.invoice_no,
    status: n.status as InvoiceStatus,
    header: input.header,
    lines: input.lines,
    deductions: input.deductions.map((d) => ({ ar_item_id: d.ar_item_id, dpp_used: Number(d.dpp_used) })),
    taxDate: isoDay(n.tax_date),
    dueDate: isoDay(n.due_date),
    stored: {
      lines: n.lines.map((l) => ({
        delivery_note_line_id: l.delivery_note_line_id,
        amount: l.amount.toNumber(),
        dpp: l.dpp_amount.toNumber(),
        advanceDpp: l.advance_dpp_amount.toNumber(),
        netDpp: l.net_dpp_amount.toNumber(),
        ppn: l.ppn_amount.toNumber(),
      })),
      amount: n.amount.toNumber(),
      dpp: n.dpp_amount.toNumber(),
      advanceUsed: n.advance_dpp_amount.toNumber(),
      netDpp: n.net_dpp_amount.toNumber(),
      dppOther: n.dpp_other_amount.toNumber(),
      ppn: n.ppn_amount.toNumber(),
      total: n.total_amount.toNumber(),
    },
    taxInvoiceNo: n.tax_invoice_no,
    journalId: n.journal_id,
    journalNo,
    arItemId: n.ar_item_id,
    cancelReason: n.cancel_reason,
  };
}

/** Faktur numbers by id, for the audit panel. */
export async function invoiceNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.salInvoice.findMany({ where: { id: { in: ids } }, select: { id: true, invoice_no: true } });
  return new Map(rows.map((r) => [r.id, r.invoice_no]));
}

/**
 * Which live Faktur bills each line of a Delivery Note — for the note's page,
 * which composes it with its own record (*Ditagih*, shown, never stored there).
 */
export async function deliveryNoteBilling(lineIds: number[]): Promise<Record<number, { id: number; no: string; status: InvoiceStatus }>> {
  if (!lineIds.length) return {};
  const rows = await prisma.salInvoiceLine.findMany({
    where: { delivery_note_line_id: { in: lineIds }, invoice: { status: { in: INVOICE_HOLDS } } },
    select: { delivery_note_line_id: true, invoice: { select: { id: true, invoice_no: true, status: true } } },
  });
  return Object.fromEntries(
    rows.map((r) => [r.delivery_note_line_id, { id: r.invoice.id, no: r.invoice.invoice_no, status: r.invoice.status as InvoiceStatus }])
  );
}

/** A Customer Order's Fakturs, for its page. */
export async function customerOrderInvoices(
  customerOrderId: number
): Promise<{ id: number; invoiceNo: string; invoiceDate: string; status: InvoiceStatus; total: number }[]> {
  const rows = await prisma.salInvoice.findMany({
    where: { customer_order_id: customerOrderId },
    orderBy: [{ invoice_date: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    invoiceNo: r.invoice_no,
    invoiceDate: isoDay(r.invoice_date),
    status: r.status as InvoiceStatus,
    total: r.total_amount.toNumber(),
  }));
}
