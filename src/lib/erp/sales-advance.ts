import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { BASE_CURRENCY_LABEL } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { advanceSourceOrders, lockCustomerOrder, type AdvanceSourceOrder } from "./customer-order";
import { closeArItem, createArItem, findArItem, lockArItems, openArItems } from "./ar-item";
import { PPN_SETTINGS_MISSING, ppnRates } from "./system-settings";
import {
  advanceAmountProblem,
  computeAdvance,
  orderAdvanceValue,
  type AdvanceAmountType,
  type AdvanceBasis,
  type AdvanceFigures,
  type PpnRates,
  type PriceMode,
} from "./sales-tax";
import {
  SALES_ADVANCE_TRANSITIONS,
  advanceIsEditable,
  advanceTransitionAllowed,
  type AdvanceAction,
  type AdvanceStatus,
} from "./sales-advance-workflow";

/**
 * Uang Muka Penjualan — the AR advance bill (Claude-ERP.md P54–P58). Its table
 * is `sal_advance`, and nothing else names it.
 *
 * A bill, not a transaction: it posts nothing to the books at any step. It is
 * drawn from one Open Customer Order, whose customer, address and Kena PPN it
 * follows, and asks for one value typed as a percent of the order or a flat
 * value — in **its own** price mode, which starts on the order's and may differ
 * from it (P90). The figures come from `sales-tax.ts`, which the form previews
 * from.
 *
 * The order's room — its DPP less the DPP of every live bill drawn from it
 * (P90) — is spent with the order's row locked, so two bills cannot both take
 * the last of it, and a bill and the order's cancellation cannot pass each
 * other. DPP, because bills in different modes compare only in one measure,
 * and the Faktur deducts advances in DPP.
 *
 * **Terbitkan hands the bill to the AR book** (P87–P88): it creates the bill's
 * Tagihan Uang Muka item — a noted item, no journal — carrying its DPP, PPN and
 * the PPh the customer is expected to withhold, per Jenis PPh. From then on a
 * Penerimaan reads that item, never this table, and what is paid is the item's
 * own record. Cancelling an issued bill closes the item, and is refused once a
 * receipt has paid any of it.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type SalesAdvanceInput = {
  order_id: number | null;
  advance_date: string;
  due_date: string;
  cash_bank_id: number | null;
  description: string;
  note: string;
  /** The bill's own price mode (P90); ignored when the order is not Kena PPN. */
  price_mode: string;
  amount_type: string;
  amount_value: number;
};

export type SalesAdvanceResult =
  | { ok: true; id: number; advanceNo: string }
  | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

// ------------------------------------------------------------------- room

/** The DPP other live bills have drawn from an order (P90). */
async function drawnByOthers(db: Db, orderId: number, exceptId: number | null): Promise<number> {
  const r = await db.salAdvance.aggregate({
    where: { customer_order_id: orderId, status: { not: "Cancelled" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    _sum: { dpp_amount: true },
  });
  return r._sum.dpp_amount?.toNumber() ?? 0;
}

/** DPP drawn by live bills, per order. */
async function drawnByOrder(orderIds: number[]): Promise<Map<number, number>> {
  const rows = await prisma.salAdvance.groupBy({
    by: ["customer_order_id"],
    where: { customer_order_id: { in: orderIds }, status: { not: "Cancelled" } },
    _sum: { dpp_amount: true },
  });
  return new Map(rows.map((r) => [r.customer_order_id, r._sum.dpp_amount?.toNumber() ?? 0]));
}

/**
 * The bill's price mode (P90): its own choice when the order is Kena PPN,
 * starting on the order's; a bill on an order without PPN is stored Exclude.
 */
export function advanceModeOf(order: Pick<AdvanceSourceOrder, "basis">, typed: string | null | undefined): PriceMode {
  if (!order.basis.taxable) return "Exclude";
  return typed === "Include" || typed === "Exclude" ? typed : order.basis.mode;
}

/** The order seen in the bill's mode: a share of its total when Include, of its DPP when Exclude. */
function basisIn(order: AdvanceSourceOrder, mode: PriceMode): AdvanceBasis {
  return { ...order.basis, mode };
}

// ---------------------------------------------------------------- options

export type AdvanceOrderOption = AdvanceSourceOrder & {
  /** The order's DPP, the DPP other bills drew from it, and what is left (P90). */
  value: number;
  drawn: number;
  left: number;
};

export type AdvanceBankOption = { id: number; label: string; name: string; active: boolean };

export type SalesAdvanceOptions = {
  orders: AdvanceOrderOption[];
  banks: AdvanceBankOption[];
  /** The PPN rate and factor a Draft is computed with now (P60); null when unset. */
  ppnRates: PpnRates | null;
};

/**
 * What the form picks from: Open orders — with what each has left — and
 * the rupiah bank accounts a bill can print. `current` is the bill being
 * edited, whose own draw does not count against its order.
 */
export async function salesAdvanceOptions(current: { id: number; orderId: number } | null = null): Promise<SalesAdvanceOptions> {
  const [orders, banks, rates] = await Promise.all([
    advanceSourceOrders(current ? { ids: [current.orderId] } : { openOnly: true }),
    prisma.mCashBank.findMany({
      where: { cash_bank_type: "Bank", currency: { currency_label: BASE_CURRENCY_LABEL } },
      orderBy: { cash_bank_label: "asc" },
    }),
    ppnRates(),
  ]);
  const drawn = await drawnByOrder(orders.map((o) => o.id));
  const own = current
    ? (await prisma.salAdvance.findUnique({ where: { id: current.id }, select: { dpp_amount: true, status: true } })) ?? null
    : null;
  return {
    orders: orders.map((o) => {
      const value = o.basis.dpp;
      const all = drawn.get(o.id) ?? 0;
      const mine = own && own.status !== "Cancelled" ? own.dpp_amount.toNumber() : 0;
      const others = all - mine;
      return { ...o, value, drawn: others, left: value - others };
    }),
    banks: banks.map((b) => ({
      id: b.id,
      label: b.cash_bank_label,
      name: b.cash_bank_name,
      active: b.status === "Active",
    })),
    ppnRates: rates,
  };
}

// ------------------------------------------------------------- validation

type Checked = {
  data: {
    customer_order_id: number;
    customer_id: number;
    advance_date: Date;
    due_date: Date;
    cash_bank_id: number;
    description: string;
    note: string | null;
    price_mode: PriceMode;
    is_taxable: boolean;
    amount_type: AdvanceAmountType;
    amount_value: number;
  };
  figures: AdvanceFigures;
  order: AdvanceSourceOrder;
  /** The bill's own snapshot (P60); null when the order is not Kena PPN. */
  rates: PpnRates | null;
};

/**
 * Every rule a bill must satisfy to be saved — and, run again on what was
 * stored, to be issued. `db` is the transaction that holds the order's lock.
 */
export async function checkSalesAdvance(
  db: Db,
  input: SalesAdvanceInput,
  selfId: number | null
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};

  const orderId = Number(input.order_id) || null;
  const [order] = orderId ? await advanceSourceOrders({ ids: [orderId] }, db) : [];
  if (!orderId) errors.order_id = "Pilih Customer Order.";
  else if (!order) errors.order_id = "Customer Order tidak ditemukan.";
  else if (order.status !== "Open") errors.order_id = "Customer Order harus berstatus Open.";
  else if (!order.customerActive) errors.order_id = "Customer pada Customer Order ini sudah nonaktif.";

  const date = String(input.advance_date ?? "").trim();
  const due = String(input.due_date ?? "").trim();
  if (!DAY.test(date)) errors.advance_date = "Tanggal tagihan wajib diisi.";
  else if (order && date < order.orderDate) errors.advance_date = "Tidak boleh sebelum tanggal Customer Order.";
  if (!DAY.test(due)) errors.due_date = "Jatuh tempo wajib diisi.";
  else if (DAY.test(date) && due < date) errors.due_date = "Tidak boleh sebelum tanggal tagihan.";

  const bankId = Number(input.cash_bank_id) || null;
  if (!bankId) errors.cash_bank_id = "Pilih rekening pembayaran.";
  else {
    const b = await db.mCashBank.findUnique({ where: { id: bankId }, include: { currency: true } });
    if (!b) errors.cash_bank_id = "Rekening tidak ditemukan.";
    else if (b.cash_bank_type !== "Bank") errors.cash_bank_id = "Pilih rekening bank, bukan kas.";
    else if (b.currency.currency_label !== BASE_CURRENCY_LABEL) errors.cash_bank_id = "Rekening harus dalam Rupiah.";
    else if (b.status !== "Active") errors.cash_bank_id = "Rekening tersebut sudah nonaktif.";
  }

  const description = String(input.description ?? "").trim();
  if (!description) errors.description = "Uraian wajib diisi — tercetak pada tagihan.";

  const type = input.amount_type;
  const typed = Number(input.amount_value);
  let figures: AdvanceFigures | null = null;
  // The bill snapshots the PPN rate in force, not the order's (P60).
  const rates = order?.basis.taxable ? await ppnRates() : null;
  if (order?.basis.taxable && !rates) errors._form = PPN_SETTINGS_MISSING;
  const mode = order ? advanceModeOf(order, input.price_mode) : "Exclude";
  if (order?.basis.taxable && input.price_mode !== "Include" && input.price_mode !== "Exclude") {
    errors.price_mode = "Pilih mode harga uang muka.";
  }
  if (type !== "Percent" && type !== "Amount") errors.amount_value = "Pilih cara mengisi nilai uang muka.";
  else if (order && !errors.order_id) {
    const basis = basisIn(order, mode);
    // The value is checked on its own terms first; the room is checked in DPP (P90).
    const problem = advanceAmountProblem(type, typed, orderAdvanceValue(basis), Number.POSITIVE_INFINITY);
    if (problem) errors.amount_value = problem;
    else {
      const f = computeAdvance({ basis, type, typed, rates });
      const left = order.basis.dpp - (await drawnByOthers(db, order.id, selfId));
      if (f.dpp > left) {
        errors.amount_value = `DPP uang muka melebihi sisa DPP Customer Order yang dapat ditagih (${left.toLocaleString("id-ID")}).`;
      } else figures = f;
    }
  }

  if (Object.keys(errors).length || !order || !figures) return { ok: false, errors };
  return {
    ok: true,
    c: {
      data: {
        customer_order_id: order.id,
        customer_id: order.customerId,
        advance_date: asDate(date),
        due_date: asDate(due),
        cash_bank_id: bankId!,
        description,
        note: String(input.note ?? "").trim() || null,
        price_mode: mode,
        is_taxable: order.basis.taxable,
        amount_type: type as AdvanceAmountType,
        amount_value: typed,
      },
      figures,
      order,
      rates,
    },
  };
}

// ------------------------------------------------------------------ writes

async function nextAdvanceNo(db: Db, date: Date): Promise<string> {
  return nextDocumentNumber("ARA", date, async (series) => {
    const row = await db.salAdvance.findFirst({
      where: { advance_no: { startsWith: series } },
      orderBy: { id: "desc" },
      select: { advance_no: true },
    });
    return row?.advance_no ?? null;
  });
}

function rateData(r: PpnRates | null) {
  return {
    ppn_rate: r?.rate ?? null,
    ppn_dpp_other_numerator: r?.otherNum ?? null,
    ppn_dpp_other_denominator: r?.otherDen ?? null,
  };
}

function figureData(f: AdvanceFigures) {
  return {
    amount: f.amount,
    dpp_amount: f.dpp,
    dpp_other_amount: f.dppOther,
    ppn_amount: f.ppn,
    total_amount: f.total,
  };
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "sal_advance", row_id: id, action, event, by } });
}

/** Rules failing inside a transaction roll it back and come out as errors. */
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
    throw e;
  }
}

export async function createSalesAdvance(input: SalesAdvanceInput, actorId: number): Promise<SalesAdvanceResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const orderId = Number(input.order_id) || null;
      if (orderId) await lockCustomerOrder(tx, orderId);
      const r = await checkSalesAdvance(tx, input, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.salAdvance.create({
        data: {
          ...r.c.data,
          ...figureData(r.c.figures),
          ...rateData(r.c.rates),
          advance_no: await nextAdvanceNo(tx, r.c.data.advance_date),
          created_by: actorId,
        },
      });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, advanceNo: made.advance_no };
  });
}

export async function updateSalesAdvance(
  id: number,
  input: SalesAdvanceInput,
  actorId: number
): Promise<SalesAdvanceResult> {
  const current = await prisma.salAdvance.findUnique({
    where: { id },
    select: { status: true, advance_no: true, customer_order_id: true },
  });
  if (!current) return { ok: false, errors: { _form: "Tagihan uang muka tidak ditemukan." } };
  if (!advanceIsEditable(current.status as AdvanceStatus)) {
    return { ok: false, errors: { _form: "Tagihan yang sudah diterbitkan atau dibatalkan tidak dapat diubah." } };
  }
  if (Number(input.order_id) !== current.customer_order_id) {
    return { ok: false, errors: { order_id: "Customer Order tidak dapat diganti. Buat tagihan baru untuk Customer Order lain." } };
  }

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await lockCustomerOrder(tx, current.customer_order_id);
      const r = await checkSalesAdvance(tx, input, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.salAdvance.updateMany({
        where: { id, status: "Draft" },
        data: { ...r.c.data, ...figureData(r.c.figures),
          ...rateData(r.c.rates), updated_by: actorId },
      });
      if (done.count !== 1) throw new Refused({ _form: "Tagihan berubah saat diproses. Muat ulang halaman." });
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, advanceNo: current.advance_no };
  });
}

function asInput(a: {
  customer_order_id: number;
  advance_date: Date;
  due_date: Date;
  cash_bank_id: number;
  description: string;
  note: string | null;
  price_mode: string;
  amount_type: string;
  amount_value: Prisma.Decimal;
}): SalesAdvanceInput {
  return {
    order_id: a.customer_order_id,
    advance_date: isoDay(a.advance_date),
    due_date: isoDay(a.due_date),
    cash_bank_id: a.cash_bank_id,
    description: a.description,
    note: a.note ?? "",
    price_mode: a.price_mode,
    amount_type: a.amount_type,
    amount_value: a.amount_value.toNumber(),
  };
}

export type SalesAdvanceTransitionResult = { ok: true } | { ok: false; errors: Record<string, string> };

/** The bill's own document type, for the AR item that is about it. */
async function advanceDocTypeId(db: Db): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: "sal_advance" }, select: { id: true } });
  if (!row) throw new Error("Jenis dokumen sal_advance belum terdaftar. Jalankan db:seed.");
  return row.id;
}

/**
 * Hands an issued bill to the AR book (P87–P88): its Tagihan Uang Muka item,
 * carrying what the bill asks for — DPP, PPN and the PPh the customer is
 * expected to withhold, per Jenis PPh — dated and due as the bill is, in the
 * order's currency and rate (P92). Called inside the transaction that issues
 * it; also used to rebuild items for bills issued before the AR book held them.
 */
export async function handAdvanceToAr(
  tx: Prisma.TransactionClient,
  bill: { id: number; advance_no: string; advance_date: Date; due_date: Date; customer_id: number },
  order: AdvanceSourceOrder,
  figures: AdvanceFigures,
  actorId: number
): Promise<number> {
  const doc = { docTypeId: await advanceDocTypeId(tx), docId: bill.id, no: bill.advance_no };
  const { itemId } = await createArItem(tx, {
    type: "AdvanceRequest",
    partnerId: bill.customer_id,
    currencyId: order.currencyId,
    date: isoDay(bill.advance_date),
    dueDate: isoDay(bill.due_date),
    source: doc,
    order: { id: order.id, no: order.orderNo },
    amounts: { gross: figures.total, dpp: figures.dpp, ppn: figures.ppn, pph: figures.withholdingTotal },
    withholdings: figures.withholdings.map((w) => ({ taxId: Number(w.key), rate: w.rate, base: w.base, amount: w.amount })),
    rate: order.exchangeRate,
    by: doc,
    note: `Tagihan uang muka ${bill.advance_no} diterbitkan`,
    actorId,
  });
  return itemId;
}

/**
 * The figures a stored bill was issued with, as `checkSalesAdvance` would work
 * them out again — the per-Jenis PPh expectation is not a column of the bill.
 */
export async function storedAdvanceFigures(
  db: Db,
  billId: number
): Promise<{ bill: Prisma.SalAdvanceGetPayload<object>; order: AdvanceSourceOrder; figures: AdvanceFigures } | null> {
  const bill = await db.salAdvance.findUnique({ where: { id: billId } });
  if (!bill) return null;
  const [order] = await advanceSourceOrders({ ids: [bill.customer_order_id] }, db);
  if (!order) return null;
  const rates =
    bill.ppn_rate && bill.ppn_dpp_other_numerator && bill.ppn_dpp_other_denominator
      ? { rate: bill.ppn_rate.toNumber(), otherNum: bill.ppn_dpp_other_numerator, otherDen: bill.ppn_dpp_other_denominator }
      : null;
  const figures = computeAdvance({
    basis: basisIn(order, advanceModeOf(order, bill.price_mode)),
    type: bill.amount_type as AdvanceAmountType,
    typed: bill.amount_value.toNumber(),
    rates,
  });
  return { bill, order, figures };
}

/**
 * Runs one lifecycle step. Issuing re-checks the stored bill with the order
 * locked — the order still Open, its room still there, the bank still
 * active — stores the figures that check produced, and creates the bill's
 * Tagihan Uang Muka item in the same transaction. Cancelling closes that item,
 * and is refused once any receipt has paid the bill (P66): a paid bill's
 * leftover is refunded, not cancelled.
 */
export async function transitionSalesAdvance(
  id: number,
  action: AdvanceAction,
  actorId: number,
  reason?: string
): Promise<SalesAdvanceTransitionResult> {
  const bill = await prisma.salAdvance.findUnique({ where: { id } });
  if (!bill) return { ok: false, errors: { _form: "Tagihan uang muka tidak ditemukan." } };
  const t = SALES_ADVANCE_TRANSITIONS[action];
  if (!advanceTransitionAllowed(action, bill.status as AdvanceStatus)) {
    return { ok: false, errors: { _form: `Tagihan berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }

  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan pembatalan wajib diisi." } };
    return refusable(async () => {
      await prisma.$transaction(async (tx) => {
        await lockSalesAdvances(tx, [id]);
        const typeId = await advanceDocTypeId(tx);
        const itemId = await findArItem(tx, "AdvanceRequest", typeId, id);
        if (itemId) {
          await lockArItems(tx, [itemId]);
          const [item] = await openArItems(tx, { type: "AdvanceRequest", sourceTable: "sal_advance", sourceIds: [id] });
          if (item && item.paid > 0) {
            throw new Refused({
              _form: `Tagihan ini sudah dibayar ${item.paid.toLocaleString("id-ID")} melalui Penerimaan Kas & Bank. Sisa yang tidak terpakai dikembalikan, bukan dibatalkan.`,
            });
          }
          await closeArItem(tx, {
            itemId,
            date: new Date().toISOString().slice(0, 10) < isoDay(bill.advance_date) ? isoDay(bill.advance_date) : new Date().toISOString().slice(0, 10),
            doc: { docTypeId: typeId, docId: id, no: bill.advance_no },
            note: `Dibatalkan: ${why}`,
            actorId,
          });
        }
        const done = await tx.salAdvance.updateMany({
          where: { id, status: bill.status },
          data: { status: "Cancelled", cancel_reason: why, updated_by: actorId },
        });
        if (done.count !== 1) throw new Error("Tagihan berubah saat diproses. Muat ulang halaman.");
        await audit(tx, id, "UPDATE", "cancel", actorId);
      });
      return { ok: true as const };
    });
  }

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await lockCustomerOrder(tx, bill.customer_order_id);
      const r = await checkSalesAdvance(tx, asInput(bill), id);
      if (!r.ok) {
        const first = Object.values(r.errors)[0];
        throw new Refused({ _form: `Belum bisa diterbitkan: ${first}` });
      }
      const done = await tx.salAdvance.updateMany({
        where: { id, status: "Draft" },
        data: { status: "Issued", ...figureData(r.c.figures),
          ...rateData(r.c.rates), updated_by: actorId },
      });
      if (done.count !== 1) throw new Refused({ _form: "Tagihan berubah saat diproses. Muat ulang halaman." });
      await handAdvanceToAr(tx, bill, r.c.order, r.c.figures, actorId);
      await audit(tx, id, "UPDATE", "issue", actorId);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

export type SalesAdvanceListRow = {
  id: number;
  advanceNo: string;
  advanceDate: string;
  dueDate: string;
  status: AdvanceStatus;
  customerLabel: string;
  customerName: string;
  orderNo: string;
  priceMode: "Exclude" | "Include";
  isTaxable: boolean;
  dpp: number;
  ppn: number;
  total: number;
};

export async function listSalesAdvances(): Promise<SalesAdvanceListRow[]> {
  const rows = await prisma.salAdvance.findMany({
    orderBy: [{ advance_date: "desc" }, { id: "desc" }],
    include: { customer: true, customer_order: { select: { order_no: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    advanceNo: r.advance_no,
    advanceDate: isoDay(r.advance_date),
    dueDate: isoDay(r.due_date),
    status: r.status as AdvanceStatus,
    customerLabel: r.customer.partner_label,
    customerName: r.customer.partner_name,
    orderNo: r.customer_order.order_no,
    priceMode: r.price_mode,
    isTaxable: r.is_taxable,
    dpp: r.dpp_amount.toNumber(),
    ppn: r.ppn_amount.toNumber(),
    total: r.total_amount.toNumber(),
  }));
}

export type SalesAdvanceView = {
  id: number;
  advanceNo: string;
  status: AdvanceStatus;
  input: SalesAdvanceInput;
  bankLabel: string;
  bankName: string;
  cancelReason: string | null;
  /** As stored — the figures the bill was saved or issued with. */
  figures: { amount: number; dpp: number; dppOther: number; ppn: number; total: number };
  /** The rate and factor it carries (P60); null when not Kena PPN. */
  rates: PpnRates | null;
};

export async function getSalesAdvance(id: number): Promise<SalesAdvanceView | null> {
  const a = await prisma.salAdvance.findUnique({ where: { id }, include: { cash_bank: true } });
  if (!a) return null;
  return {
    id: a.id,
    advanceNo: a.advance_no,
    status: a.status as AdvanceStatus,
    input: asInput(a),
    bankLabel: a.cash_bank.cash_bank_label,
    bankName: a.cash_bank.cash_bank_name,
    cancelReason: a.cancel_reason,
    figures: {
      amount: a.amount.toNumber(),
      dpp: a.dpp_amount.toNumber(),
      dppOther: a.dpp_other_amount.toNumber(),
      ppn: a.ppn_amount.toNumber(),
      total: a.total_amount.toNumber(),
    },
    rates:
      a.ppn_rate && a.ppn_dpp_other_numerator && a.ppn_dpp_other_denominator
        ? { rate: a.ppn_rate.toNumber(), otherNum: a.ppn_dpp_other_numerator, otherDen: a.ppn_dpp_other_denominator }
        : null,
  };
}

/** Bill numbers by id, for the audit panel. */
export async function salesAdvanceNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.salAdvance.findMany({
    where: { id: { in: ids } },
    select: { id: true, advance_no: true },
  });
  return new Map(rows.map((r) => [r.id, r.advance_no]));
}

// ------------------------------------------------------------------- locks

/**
 * Locks bills' rows for the rest of the transaction, in id order, so a bill's
 * cancellation and anything else changing it cannot pass each other.
 */
async function lockSalesAdvances(tx: Prisma.TransactionClient, ids: number[]): Promise<void> {
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    await tx.$queryRaw`SELECT id FROM sal_advance WHERE id = ${id} FOR UPDATE`;
  }
}
