import "server-only";

import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/format";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber, taxSeriesPrefix } from "./document-number";
import { purchaseAdvanceSources, purchaseOrderNumbersByIds, lockPurchaseOrder, type PurchaseAdvanceSource } from "./purchase-order";
import { PPN_SETTINGS_MISSING, ppnRates } from "./system-settings";
import {
  advanceAmountProblem,
  computeAdvance,
  orderAdvanceValue,
  type AdvanceAmountType,
  type AdvanceFigures,
  type PpnRates,
} from "./sales-tax";
import {
  PURCHASE_ADVANCE_TRANSITIONS,
  advanceIsEditable,
  advanceTransitionAllowed,
  type AdvanceAction,
  type AdvanceStatus,
} from "./ap-advance-workflow";

/**
 * Uang Muka Pembelian — the AP advance bill (P126, Purchasing-Concept.md B23):
 * the AR bill (`ar-advance.ts`) mirrored, as P58 says. Its table is
 * `fin_ap_advance`, and nothing else names it.
 *
 * A bill, not a transaction: it posts nothing at any step. It records the
 * supplier's request for a down payment, drawn from one Open Purchase Order
 * whose supplier, price mode and Kena PPN it follows, as one value typed as a
 * percent of the order or a flat value. The figures come from `sales-tax.ts`.
 * The order's room — its value less every live bill on it — is spent with the
 * order's row locked. What is paid is kept here, as `paid_amount`: a posted
 * Pengeluaran adds what it settled through `recordPurchaseAdvancePaid` (P132).
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type PurchaseAdvanceInput = {
  order_id: number | null;
  advance_date: string;
  due_date: string;
  supplier_ref_no: string;
  description: string;
  note: string;
  amount_type: string;
  amount_value: number;
};

export type PurchaseAdvanceResult =
  | { ok: true; id: number; advanceNo: string }
  | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

// ------------------------------------------------------------------- room

/** What other live bills have drawn from an order, in its price mode. */
async function drawnByOthers(db: Db, orderId: number, exceptId: number | null): Promise<number> {
  const r = await db.finApAdvance.aggregate({
    where: { purchase_order_id: orderId, status: { not: "Cancelled" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    _sum: { amount: true },
  });
  return r._sum.amount?.toNumber() ?? 0;
}

/** Drawn by live bills, per order. */
async function drawnByOrder(orderIds: number[]): Promise<Map<number, number>> {
  const rows = await prisma.finApAdvance.groupBy({
    by: ["purchase_order_id"],
    where: { purchase_order_id: { in: orderIds }, status: { not: "Cancelled" } },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.purchase_order_id, r._sum.amount?.toNumber() ?? 0]));
}

// ---------------------------------------------------------------- options

export type AdvanceOrderOption = PurchaseAdvanceSource & {
  /** The order's value in its price mode, what drawn by other bills, and what is left. */
  value: number;
  drawn: number;
  left: number;
};


export type PurchaseAdvanceOptions = {
  orders: AdvanceOrderOption[];
  /** The PPN rate and factor a Draft is computed with now (P60); null when unset. */
  ppnRates: PpnRates | null;
};

/**
 * What the form picks from: Open orders — with what each has left — and
 * `current` is the bill being
 * edited, whose own draw does not count against its order.
 */
export async function purchaseAdvanceOptions(current: { id: number; orderId: number } | null = null): Promise<PurchaseAdvanceOptions> {
  const [orders, rates] = await Promise.all([
    purchaseAdvanceSources(current ? { ids: [current.orderId] } : { openOnly: true }),
    ppnRates(),
  ]);
  const drawn = await drawnByOrder(orders.map((o) => o.id));
  const own = current
    ? (await prisma.finApAdvance.findUnique({ where: { id: current.id }, select: { amount: true, status: true } })) ?? null
    : null;
  return {
    orders: orders.map((o) => {
      const value = orderAdvanceValue(o.basis);
      const all = drawn.get(o.id) ?? 0;
      const mine = own && own.status !== "Cancelled" ? own.amount.toNumber() : 0;
      const others = all - mine;
      return { ...o, value, drawn: others, left: value - others };
    }),
    ppnRates: rates,
  };
}

// ------------------------------------------------------------- validation

type Checked = {
  data: {
    purchase_order_id: number;
    supplier_id: number;
    advance_date: Date;
    due_date: Date;
    supplier_ref_no: string | null;
    description: string;
    note: string | null;
    price_mode: "Exclude" | "Include";
    is_taxable: boolean;
    amount_type: AdvanceAmountType;
    amount_value: number;
  };
  figures: AdvanceFigures;
  /** The bill's own snapshot (P60); null when the order is not Kena PPN. */
  rates: PpnRates | null;
};

/**
 * Every rule a bill must satisfy to be saved — and, run again on what was
 * stored, to be issued. `db` is the transaction that holds the order's lock.
 */
export async function checkPurchaseAdvance(
  db: Db,
  input: PurchaseAdvanceInput,
  selfId: number | null
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};

  const orderId = Number(input.order_id) || null;
  const [order] = orderId ? await purchaseAdvanceSources({ ids: [orderId] }, db) : [];
  if (!orderId) errors.order_id = "Pilih Purchase Order.";
  else if (!order) errors.order_id = "Purchase Order tidak ditemukan.";
  else if (order.status !== "Open") errors.order_id = "Purchase Order harus berstatus Open.";
  else if (!order.supplierActive) errors.order_id = "Supplier pada Purchase Order ini sudah nonaktif.";

  const date = String(input.advance_date ?? "").trim();
  const due = String(input.due_date ?? "").trim();
  if (!DAY.test(date)) errors.advance_date = "Tanggal tagihan wajib diisi.";
  else if (order && date < order.orderDate) errors.advance_date = "Tidak boleh sebelum tanggal Purchase Order.";
  if (!DAY.test(due)) errors.due_date = "Jatuh tempo wajib diisi.";
  else if (DAY.test(date) && due < date) errors.due_date = "Tidak boleh sebelum tanggal tagihan.";

  const description = String(input.description ?? "").trim();
  if (!description) errors.description = "Uraian wajib diisi — tercetak pada tagihan.";

  const type = input.amount_type;
  const typed = Number(input.amount_value);
  let figures: AdvanceFigures | null = null;
  // The bill snapshots the PPN rate in force, not the order's (P60).
  const rates = order?.basis.taxable ? await ppnRates() : null;
  if (order?.basis.taxable && !rates) errors._form = PPN_SETTINGS_MISSING;
  if (type !== "Percent" && type !== "Amount") errors.amount_value = "Pilih cara mengisi nilai uang muka.";
  else if (order && !errors.order_id) {
    const value = orderAdvanceValue(order.basis);
    const drawn = await drawnByOthers(db, order.id, selfId);
    const problem = advanceAmountProblem(type, typed, value, value - drawn);
    if (problem) errors.amount_value = problem;
    else figures = computeAdvance({ basis: order.basis, type, typed, rates });
  }

  if (Object.keys(errors).length || !order || !figures) return { ok: false, errors };
  return {
    ok: true,
    c: {
      data: {
        purchase_order_id: order.id,
        supplier_id: order.supplierId,
        advance_date: asDate(date),
        due_date: asDate(due),
        supplier_ref_no: String(input.supplier_ref_no ?? "").trim() || null,
        description,
        note: String(input.note ?? "").trim() || null,
        price_mode: order.basis.mode,
        is_taxable: order.basis.taxable,
        amount_type: type as AdvanceAmountType,
        amount_value: typed,
      },
      figures,
      rates,
    },
  };
}

// ------------------------------------------------------------------ writes

async function nextAdvanceNo(db: Db, date: Date, isTaxable: boolean): Promise<string> {
  return nextDocumentNumber(taxSeriesPrefix("APA", isTaxable), date, async (series) => {
    const row = await db.finApAdvance.findFirst({
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
  await db.auditLog.create({ data: { entity_key: "fin_ap_advance", row_id: id, action, event, by } });
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

export async function createPurchaseAdvance(input: PurchaseAdvanceInput, actorId: number): Promise<PurchaseAdvanceResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const orderId = Number(input.order_id) || null;
      if (orderId) await lockPurchaseOrder(tx, orderId);
      const r = await checkPurchaseAdvance(tx, input, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.finApAdvance.create({
        data: {
          ...r.c.data,
          ...figureData(r.c.figures),
          ...rateData(r.c.rates),
          advance_no: await nextAdvanceNo(tx, r.c.data.advance_date, r.c.data.is_taxable),
          created_by: actorId,
        },
      });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, advanceNo: made.advance_no };
  });
}

export async function updatePurchaseAdvance(
  id: number,
  input: PurchaseAdvanceInput,
  actorId: number
): Promise<PurchaseAdvanceResult> {
  const current = await prisma.finApAdvance.findUnique({
    where: { id },
    select: { status: true, advance_no: true, purchase_order_id: true },
  });
  if (!current) return { ok: false, errors: { _form: "Tagihan uang muka tidak ditemukan." } };
  if (!advanceIsEditable(current.status as AdvanceStatus)) {
    return { ok: false, errors: { _form: "Tagihan yang sudah diterbitkan atau dibatalkan tidak dapat diubah." } };
  }
  if (Number(input.order_id) !== current.purchase_order_id) {
    return { ok: false, errors: { order_id: "Purchase Order tidak dapat diganti. Buat tagihan baru untuk Purchase Order lain." } };
  }

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await lockPurchaseOrder(tx, current.purchase_order_id);
      const r = await checkPurchaseAdvance(tx, input, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.finApAdvance.updateMany({
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
  purchase_order_id: number;
  advance_date: Date;
  due_date: Date;
  supplier_ref_no: string | null;
  description: string;
  note: string | null;
  amount_type: string;
  amount_value: Prisma.Decimal;
}): PurchaseAdvanceInput {
  return {
    order_id: a.purchase_order_id,
    advance_date: isoDay(a.advance_date),
    due_date: isoDay(a.due_date),
    supplier_ref_no: a.supplier_ref_no ?? "",
    description: a.description,
    note: a.note ?? "",
    amount_type: a.amount_type,
    amount_value: a.amount_value.toNumber(),
  };
}

export type PurchaseAdvanceTransitionResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle step. Issuing re-checks the stored bill with the order
 * locked — the order still Open, its room still there — and stores the figures that check produced.
 */
export async function transitionPurchaseAdvance(
  id: number,
  action: AdvanceAction,
  actorId: number,
  reason?: string
): Promise<PurchaseAdvanceTransitionResult> {
  const bill = await prisma.finApAdvance.findUnique({ where: { id } });
  if (!bill) return { ok: false, errors: { _form: "Tagihan uang muka tidak ditemukan." } };
  const t = PURCHASE_ADVANCE_TRANSITIONS[action];
  if (!advanceTransitionAllowed(action, bill.status as AdvanceStatus)) {
    return { ok: false, errors: { _form: `Tagihan berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }

  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan pembatalan wajib diisi." } };
    return refusable(async () => {
      await prisma.$transaction(async (tx) => {
        await lockPurchaseAdvances(tx, [id]);
        // A bill a posted payment has settled, even in part, is not cancelled
        // (P66); what was paid is the bill's own record (P132).
        const held = await tx.finApAdvance.findUnique({ where: { id }, select: { paid_amount: true } });
        const paid = held?.paid_amount.toNumber() ?? 0;
        if (paid > 0) {
          throw new Refused({
            _form: `Tagihan ini sudah dibayar ${formatMoney(paid)} melalui Kas & Bank. Sisa yang tidak terpakai dikembalikan, bukan dibatalkan.`,
          });
        }
        const done = await tx.finApAdvance.updateMany({
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
      await lockPurchaseOrder(tx, bill.purchase_order_id);
      const r = await checkPurchaseAdvance(tx, asInput(bill), id);
      if (!r.ok) {
        const first = Object.values(r.errors)[0];
        throw new Refused({ _form: `Belum bisa diterbitkan: ${first}` });
      }
      const done = await tx.finApAdvance.updateMany({
        where: { id, status: "Draft" },
        data: { status: "Issued", ...figureData(r.c.figures),
          ...rateData(r.c.rates), updated_by: actorId },
      });
      if (done.count !== 1) throw new Refused({ _form: "Tagihan berubah saat diproses. Muat ulang halaman." });
      await audit(tx, id, "UPDATE", "issue", actorId);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

export type PurchaseAdvanceListRow = {
  id: number;
  advanceNo: string;
  advanceDate: string;
  dueDate: string;
  status: AdvanceStatus;
  supplierLabel: string;
  supplierName: string;
  orderNo: string;
  priceMode: "Exclude" | "Include";
  isTaxable: boolean;
  dpp: number;
  ppn: number;
  total: number;
  /** What posted payments settled of it (P132). */
  paid: number;
};

export async function listPurchaseAdvances(): Promise<PurchaseAdvanceListRow[]> {
  const rows = await prisma.finApAdvance.findMany({
    orderBy: [{ advance_date: "desc" }, { id: "desc" }],
    include: { supplier: true },
  });
  // The Purchase Order is another module's document (P107): its number is asked for.
  const orderNos = await purchaseOrderNumbersByIds([...new Set(rows.map((r) => r.purchase_order_id))]);
  return rows.map((r) => ({
    id: r.id,
    advanceNo: r.advance_no,
    advanceDate: isoDay(r.advance_date),
    dueDate: isoDay(r.due_date),
    status: r.status as AdvanceStatus,
    supplierLabel: r.supplier.partner_label,
    supplierName: r.supplier.partner_name,
    orderNo: orderNos.get(r.purchase_order_id) ?? "",
    priceMode: r.price_mode,
    isTaxable: r.is_taxable,
    dpp: r.dpp_amount.toNumber(),
    ppn: r.ppn_amount.toNumber(),
    total: r.total_amount.toNumber(),
    paid: r.paid_amount.toNumber(),
  }));
}

export type PurchaseAdvanceView = {
  id: number;
  advanceNo: string;
  status: AdvanceStatus;
  input: PurchaseAdvanceInput;
  cancelReason: string | null;
  /** As stored — the figures the bill was saved or issued with. */
  figures: { amount: number; dpp: number; dppOther: number; ppn: number; total: number };
  /** The rate and factor it carries (P60); null when not Kena PPN. */
  rates: PpnRates | null;
  /** What posted payments settled of it (P132). */
  paid: number;
};

export async function getPurchaseAdvance(id: number): Promise<PurchaseAdvanceView | null> {
  const a = await prisma.finApAdvance.findUnique({ where: { id } });
  if (!a) return null;
  return {
    id: a.id,
    advanceNo: a.advance_no,
    status: a.status as AdvanceStatus,
    input: asInput(a),
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
    paid: a.paid_amount.toNumber(),
  };
}

/**
 * The PPN snapshot each bill was issued with — what its faktur pajak uang muka
 * carries. The Invoice compares it with its own (P113): full PPN less the
 * advance's PPN only holds while the rate and the factor are the same.
 */
export async function advanceRatesByIds(
  ids: number[],
  db: Db = prisma
): Promise<Map<number, { rate: number; otherNum: number; otherDen: number } | null>> {
  if (!ids.length) return new Map();
  const rows = await db.finApAdvance.findMany({
    where: { id: { in: ids } },
    select: { id: true, is_taxable: true, ppn_rate: true, ppn_dpp_other_numerator: true, ppn_dpp_other_denominator: true },
  });
  return new Map(
    rows.map((a) => [
      a.id,
      a.is_taxable && a.ppn_rate && a.ppn_dpp_other_numerator && a.ppn_dpp_other_denominator
        ? { rate: a.ppn_rate.toNumber(), otherNum: a.ppn_dpp_other_numerator, otherDen: a.ppn_dpp_other_denominator }
        : null,
    ])
  );
}

/** Bill numbers by id, for the audit panel. */
export async function purchaseAdvanceNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.finApAdvance.findMany({
    where: { id: { in: ids } },
    select: { id: true, advance_no: true },
  });
  return new Map(rows.map((r) => [r.id, r.advance_no]));
}

// ------------------------------------------------------- for the payment

/**
 * An advance bill as a Penerimaan settles it (P66): who owes it, what it asks
 * for, and — per Jenis PPh — what the customer is expected to withhold, as
 * `computeAdvance` works it out from the order the bill is drawn from and the
 * rate the bill carries. The payment module takes this rather than reading
 * `fin_ap_advance` itself; what has been *paid* is kept on the bill (`paid_amount`, P132), which the
 * payment reads as its `before` and adds to when it posts.
 */
export type SettlementAdvance = {
  id: number;
  advanceNo: string;
  advanceDate: string;
  dueDate: string;
  status: AdvanceStatus;
  supplierId: number;
  orderId: number;
  orderNo: string;
  description: string;
  total: number;
  dpp: number;
  ppn: number;
  /** The PPN rate and DPP Nilai Lain factor the bill was issued with; null without PPN. */
  rates: PpnRates | null;
  withholdings: { key: string; rate: number; base: number; amount: number }[];
  /** What posted payments settled of it before — a payment's `before` (P132). */
  paid: number;
};

/** Issued bills not yet paid in full, ids only — so a payment can offer them before reading any in full. */
export async function unpaidAdvanceIds(db: Db = prisma): Promise<number[]> {
  const rows = await db.finApAdvance.findMany({
    where: { status: "Issued" },
    select: { id: true, total_amount: true, paid_amount: true },
  });
  return rows.filter((r) => r.paid_amount.lt(r.total_amount)).map((r) => r.id);
}

/**
 * Adds what one posted payment line settled to the bill (P132), inside that
 * posting with the bill locked (`lockPurchaseAdvances`). The bill is the one record of
 * what was paid: the next payment reads it as its `before`, never the
 * payments before it. Refused beyond the bill's total or on a bill no longer
 * issued.
 */
export async function recordPurchaseAdvancePaid(tx: Prisma.TransactionClient, id: number, settled: number): Promise<void> {
  const bill = await tx.finApAdvance.findUnique({ where: { id }, select: { advance_no: true, status: true, total_amount: true, paid_amount: true } });
  if (!bill || bill.status !== "Issued") throw new Error("Tagihan uang muka tidak berstatus Diterbitkan.");
  const paid = bill.paid_amount.toNumber() + settled;
  if (settled <= 0 || paid > bill.total_amount.toNumber()) {
    throw new Error(`Pembayaran melebihi sisa ${bill.advance_no}.`);
  }
  await tx.finApAdvance.update({ where: { id }, data: { paid_amount: paid } });
}

export async function settlementAdvances(
  filter: { ids?: number[]; issuedOnly?: boolean },
  db: Db = prisma
): Promise<SettlementAdvance[]> {
  const rows = await db.finApAdvance.findMany({
    where: {
      ...(filter.ids ? { id: { in: filter.ids } } : {}),
      ...(filter.issuedOnly ? { status: "Issued" } : {}),
    },
    orderBy: [{ advance_date: "asc" }, { id: "asc" }],
  });
  const orders = new Map(
    (await purchaseAdvanceSources({ ids: [...new Set(rows.map((r) => r.purchase_order_id))] }, db)).map((o) => [o.id, o])
  );
  return rows.map((a) => {
    const order = orders.get(a.purchase_order_id)!;
    const rates =
      a.ppn_rate && a.ppn_dpp_other_numerator && a.ppn_dpp_other_denominator
        ? { rate: a.ppn_rate.toNumber(), otherNum: a.ppn_dpp_other_numerator, otherDen: a.ppn_dpp_other_denominator }
        : null;
    const f = computeAdvance({
      basis: order.basis,
      type: a.amount_type as AdvanceAmountType,
      typed: a.amount_value.toNumber(),
      rates,
    });
    return {
      id: a.id,
      advanceNo: a.advance_no,
      advanceDate: isoDay(a.advance_date),
      dueDate: isoDay(a.due_date),
      status: a.status as AdvanceStatus,
      supplierId: a.supplier_id,
      orderId: a.purchase_order_id,
      orderNo: order.orderNo,
      description: a.description,
      // As stored: the figures the bill was issued with.
      total: a.total_amount.toNumber(),
      dpp: a.dpp_amount.toNumber(),
      ppn: a.ppn_amount.toNumber(),
      rates: a.ppn_amount.toNumber() > 0 ? rates : null,
      withholdings: f.withholdings,
      paid: a.paid_amount.toNumber(),
    };
  });
}

/**
 * Locks bills' rows for the rest of the transaction, in id order, so a payment
 * posting against them and their cancellation cannot pass each other, and two
 * payments cannot both clear the last of one.
 */
export async function lockPurchaseAdvances(tx: Prisma.TransactionClient, ids: number[]): Promise<void> {
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    await tx.$queryRaw`SELECT id FROM fin_ap_advance WHERE id = ${id} FOR UPDATE`;
  }
}
