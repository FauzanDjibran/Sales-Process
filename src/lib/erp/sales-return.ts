import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber, taxSeriesPrefix } from "./document-number";
import { formatNumber } from "@/lib/format";
import { customerOrderNumbersByIds, lockCustomerOrder, salesOrderSources } from "./customer-order";
import type { CustomerOrderStatus } from "./customer-order-workflow";
import { addressesOf } from "./sales-order";
import { invoiceSourceLines, postedNoteLineIds, type InvoiceSourceLine } from "./delivery-note";
import {
  SALES_RETURN_HOLDS_QTY,
  SALES_RETURN_REASONS,
  SALES_RETURN_TRANSITIONS,
  salesReturnIsEditable,
  salesReturnTransitionAllowed,
  type SalesReturnAction,
  type SalesReturnStatus,
} from "./sales-return-workflow";

/**
 * The Sales Return module (Claude-ERP.md P287, `Sales-Return-Plan.md` §4): its
 * tables are `sal_return` and `sal_return_line`, and nothing else names them.
 *
 * A Sales Return is goods of one Customer Order the customer sends back. Its
 * header names the Customer Order; each line takes a base quantity of one line
 * of that order's **posted** Delivery Notes. Quantity only, and it posts
 * nothing: the Receipt Note `sales_return` brings the goods in at the value
 * they left at, and a Credit Note Penjualan reverses what was billed.
 *
 * The Delivery Notes are read through `invoiceSourceLines` in their own module,
 * and the Customer Order is locked through `lockCustomerOrder`. The returns on a
 * Delivery Note line never add up to more than what left on it: checked at save
 * and at Ajukan with the Customer Order's row locked.
 */

type Db = Prisma.TransactionClient | typeof prisma;

// ------------------------------------------------------------------ input

export type SalesReturnHeaderInput = {
  customer_order_id: number | null;
  return_date: string;
  address_id: number | null;
  reason: string;
  reason_note: string;
  customer_return_no: string;
  customer_return_date: string;
  note: string;
};

export type SalesReturnLineInput = {
  delivery_note_line_id: number | null;
  qty: number | string;
  note: string;
};

export type SalesReturnResult =
  | { ok: true; id: number; returnNo: string }
  | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const lineKey = (i: number, field: string) => `lines.${i}.${field}`;

/** Quantities are `Decimal(18, 4)`, compared in ten-thousandths. */
const QTY_SCALE = 10_000;
const units = (n: number) => Math.round(n * QTY_SCALE);
const fromUnits = (u: number) => u / QTY_SCALE;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

/** Customer Orders goods may come back on: approved ones, still running or closed. */
const RETURNABLE_ORDER: CustomerOrderStatus[] = ["Open", "Closed"];

// ------------------------------------------------------------- quantities

/**
 * What the Sales Returns already hold of each Delivery Note line — every return
 * but a cancelled or rejected one, and but `exceptId`, the one being saved. A
 * closed return holds only what was received of it.
 */
async function heldByLines(db: Db, lineIds: number[], exceptId: number | null): Promise<Map<number, number>> {
  if (!lineIds.length) return new Map();
  const except = exceptId ? { id: { not: exceptId } } : {};
  const [running, closed] = await Promise.all([
    db.salReturnLine.groupBy({
      by: ["delivery_note_line_id"],
      where: {
        delivery_note_line_id: { in: lineIds },
        sales_return: { status: { in: SALES_RETURN_HOLDS_QTY.filter((st) => st !== "Closed") }, ...except },
      },
      _sum: { base_qty: true },
    }),
    db.salReturnLine.groupBy({
      by: ["delivery_note_line_id"],
      where: { delivery_note_line_id: { in: lineIds }, sales_return: { status: "Closed", ...except } },
      _sum: { received_qty: true },
    }),
  ]);
  const out = new Map<number, number>();
  for (const r of running) out.set(r.delivery_note_line_id, r._sum?.base_qty?.toNumber() ?? 0);
  for (const r of closed) {
    out.set(r.delivery_note_line_id, (out.get(r.delivery_note_line_id) ?? 0) + (r._sum?.received_qty?.toNumber() ?? 0));
  }
  return out;
}

// ---------------------------------------------------------------- options

export type ReturnSourceLine = InvoiceSourceLine & {
  /** What other Sales Returns hold of this Delivery Note line, in base units. */
  held: number;
};

export type ReturnSource = {
  id: number;
  orderNo: string;
  orderDate: string;
  status: CustomerOrderStatus;
  customerId: number;
  customerLabel: string;
  customerName: string;
  customerActive: boolean;
  isTaxable: boolean;
  addressId: number;
  poNo: string | null;
  addresses: { id: number; text: string }[];
  /** Lines of the order's posted Delivery Notes — loaded only for the order chosen. */
  lines: ReturnSourceLine[];
};

/**
 * One Customer Order with its posted Delivery Note lines and what is left of
 * each to return. `exceptId` is the return being edited or shown, whose own
 * lines never count against the room.
 */
async function sourceOf(db: Db, customerOrderId: number, exceptId: number | null): Promise<ReturnSource | undefined> {
  const [co] = await salesOrderSources({ ids: [customerOrderId] }, db);
  if (!co) return undefined;
  const [addresses, noteLines] = await Promise.all([
    addressesOf(db, [co.customerId]),
    invoiceSourceLines({ customerOrderIds: [customerOrderId] }, db),
  ]);
  const held = await heldByLines(db, noteLines.map((l) => l.id), exceptId);
  return {
    id: co.id,
    orderNo: co.orderNo,
    orderDate: co.orderDate,
    status: co.status,
    customerId: co.customerId,
    customerLabel: co.customerLabel,
    customerName: co.customerName,
    customerActive: co.customerActive,
    isTaxable: co.isTaxable,
    addressId: co.addressId,
    poNo: co.poNo,
    addresses: addresses.get(co.customerId) ?? [],
    lines: noteLines.map((l) => ({ ...l, held: held.get(l.id) ?? 0 })),
  };
}

export type ReturnOrderOption = { id: number; orderNo: string; customerName: string };

export type SalesReturnOptions = {
  /** Approved Customer Orders with a posted Delivery Note — the picker's list, headers only. */
  orders: ReturnOrderOption[];
  /** The order chosen, in full. */
  source: ReturnSource | null;
};

/**
 * What the form offers. A new return lists the orders it may start from and
 * loads only the one chosen (`?co=`), so the page never reads every delivery
 * ever posted; a saved return's order is locked and only that one is read.
 */
export async function salesReturnOptions(
  customerOrderId: number | null,
  currentId: number | null = null
): Promise<SalesReturnOptions> {
  const source = customerOrderId ? ((await sourceOf(prisma, customerOrderId, currentId)) ?? null) : null;
  if (currentId) return { orders: [], source };
  const ids = [...new Set((await postedNoteLineIds()).map((l) => l.customerOrderId))].filter(Boolean);
  const cos = ids.length ? await salesOrderSources({ ids }) : [];
  return {
    orders: cos
      .filter((c) => RETURNABLE_ORDER.includes(c.status))
      .map((c) => ({ id: c.id, orderNo: c.orderNo, customerName: c.customerName })),
    source,
  };
}

// ------------------------------------------------------------- validation

type CheckedLine = {
  line_no: number;
  delivery_note_id: number;
  delivery_note_line_id: number;
  item_id: number;
  uom_id: number;
  base_qty: number;
  note: string | null;
};

type Checked = {
  data: {
    customer_order_id: number;
    customer_id: number;
    return_date: Date;
    address_id: number;
    reason: string;
    reason_note: string | null;
    customer_return_no: string | null;
    customer_return_date: Date | null;
    note: string | null;
  };
  /** The Customer Order's Kena PPN: the number series (P109). */
  taxable: boolean;
  lines: CheckedLine[];
};

/**
 * Every rule a Sales Return must satisfy to be saved — and, run again inside
 * the transaction with the Customer Order locked, to be submitted.
 */
export async function checkSalesReturn(
  db: Db,
  header: SalesReturnHeaderInput,
  lines: SalesReturnLineInput[],
  selfId: number | null
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};

  const coId = Number(header.customer_order_id) || null;
  const source = coId ? await sourceOf(db, coId, selfId) : undefined;
  if (!coId) errors.customer_order_id = "Pilih Customer Order.";
  else if (!source) errors.customer_order_id = "Customer Order tidak ditemukan.";
  else if (!RETURNABLE_ORDER.includes(source.status)) errors.customer_order_id = "Customer Order harus berstatus Open atau Ditutup.";
  else if (!source.customerActive) errors.customer_order_id = "Customer pada Customer Order ini sudah nonaktif.";
  else if (!source.lines.length) errors.customer_order_id = "Customer Order ini belum punya Delivery Note yang diposting.";

  const returnDate = String(header.return_date ?? "").trim();
  if (!DAY.test(returnDate)) errors.return_date = "Tanggal retur wajib diisi.";
  else if (source && returnDate < source.orderDate) errors.return_date = "Tidak boleh sebelum tanggal Customer Order.";

  const addressId = Number(header.address_id) || null;
  if (!addressId) errors.address_id = "Pilih alamat.";
  else if (source && !source.addresses.some((a) => a.id === addressId)) {
    errors.address_id = "Alamat bukan milik customer Customer Order ini.";
  }

  const reason = String(header.reason ?? "").trim();
  const reasonNote = String(header.reason_note ?? "").trim();
  if (!SALES_RETURN_REASONS.some((r) => r.key === reason)) errors.reason = "Pilih alasan retur.";
  else if (reason === "other" && !reasonNote) errors.reason_note = "Jelaskan alasannya.";

  const customerReturnDate = String(header.customer_return_date ?? "").trim();
  if (customerReturnDate && !DAY.test(customerReturnDate)) errors.customer_return_date = "Tanggal tidak valid.";

  const raw = Array.isArray(lines) ? lines : [];
  const out: CheckedLine[] = [];
  if (!raw.length) errors._lines = "Tambahkan minimal satu barang.";
  const byId = new Map((source?.lines ?? []).map((l) => [l.id, l]));
  const baseUom = new Map(
    (
      await db.mItem.findMany({
        where: { id: { in: [...new Set((source?.lines ?? []).map((l) => l.itemId))] } },
        select: { id: true, base_uom_id: true },
      })
    ).map((i) => [i.id, i.base_uom_id])
  );
  const seen = new Set<number>();
  for (const [i, l] of raw.entries()) {
    const lineId = Number(l.delivery_note_line_id) || null;
    const dn = lineId ? byId.get(lineId) : undefined;
    if (!lineId) {
      errors[lineKey(i, "delivery_note_line_id")] = "Pilih barang.";
      continue;
    }
    if (!dn) {
      if (source) errors[lineKey(i, "delivery_note_line_id")] = "Barang bukan bagian Delivery Note posted dari Customer Order ini.";
      continue;
    }
    if (seen.has(lineId)) {
      errors[lineKey(i, "delivery_note_line_id")] = `${dn.itemLabel} dari ${dn.dnNo} dipilih lebih dari sekali.`;
      continue;
    }
    seen.add(lineId);
    if (DAY.test(returnDate) && returnDate < dn.dnDate) {
      errors[lineKey(i, "delivery_note_line_id")] = `Tanggal retur sebelum ${dn.dnNo} dikirim.`;
      continue;
    }
    const qty = Number(String(l.qty ?? "").replace(",", "."));
    const left = fromUnits(units(dn.baseQty) - units(dn.held));
    if (!Number.isFinite(qty) || !(qty > 0)) errors[lineKey(i, "qty")] = "Isi jumlah lebih dari 0.";
    else if (Math.abs(qty * QTY_SCALE - units(qty)) > 1e-6) errors[lineKey(i, "qty")] = "Paling banyak 4 angka desimal.";
    else if (units(qty) > units(left)) errors[lineKey(i, "qty")] = `Melebihi sisa ${dn.dnNo} (${qtyText(left)} ${dn.uomLabel}).`;
    else {
      out.push({
        line_no: out.length + 1,
        delivery_note_id: dn.deliveryNoteId,
        delivery_note_line_id: lineId,
        item_id: dn.itemId,
        uom_id: baseUom.get(dn.itemId)!,
        base_qty: fromUnits(units(qty)),
        note: String(l.note ?? "").trim() || null,
      });
    }
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) {
    errors._lines = "Ada baris yang perlu diperbaiki.";
  }

  if (Object.keys(errors).length || !source) return { ok: false, errors };
  return {
    ok: true,
    c: {
      data: {
        customer_order_id: source.id,
        customer_id: source.customerId,
        return_date: asDate(returnDate),
        address_id: addressId!,
        reason,
        reason_note: reasonNote || null,
        customer_return_no: String(header.customer_return_no ?? "").trim() || null,
        customer_return_date: customerReturnDate ? asDate(customerReturnDate) : null,
        note: String(header.note ?? "").trim() || null,
      },
      taxable: source.isTaxable,
      lines: out,
    },
  };
}

// ------------------------------------------------------------------ writes

async function nextReturnNo(db: Db, date: Date, isTaxable: boolean): Promise<string> {
  return nextDocumentNumber(taxSeriesPrefix("SR", isTaxable), date, async (series) => {
    const row = await db.salReturn.findFirst({
      where: { return_no: { startsWith: series } },
      orderBy: { id: "desc" },
      select: { return_no: true },
    });
    return row?.return_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "sal_return", row_id: id, action, event, by } });
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

export async function createSalesReturn(
  header: SalesReturnHeaderInput,
  lines: SalesReturnLineInput[],
  actorId: number
): Promise<SalesReturnResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const coId = Number(header.customer_order_id) || null;
      if (coId) await lockCustomerOrder(tx, coId);
      const r = await checkSalesReturn(tx, header, lines, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.salReturn.create({
        data: {
          ...r.c.data,
          return_no: await nextReturnNo(tx, r.c.data.return_date, r.c.taxable),
          created_by: actorId,
          lines: { create: r.c.lines },
        },
      });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, returnNo: made.return_no };
  });
}

export async function updateSalesReturn(
  id: number,
  header: SalesReturnHeaderInput,
  lines: SalesReturnLineInput[],
  actorId: number
): Promise<SalesReturnResult> {
  const current = await prisma.salReturn.findUnique({
    where: { id },
    select: { status: true, return_no: true, customer_order_id: true },
  });
  if (!current) return { ok: false, errors: { _form: "Sales Return tidak ditemukan." } };
  if (!salesReturnIsEditable(current.status as SalesReturnStatus)) {
    return { ok: false, errors: { _form: "Sales Return yang sudah diajukan tidak dapat diubah." } };
  }
  if (Number(header.customer_order_id) !== current.customer_order_id) {
    return {
      ok: false,
      errors: { customer_order_id: "Customer Order tidak dapat diganti. Buat Sales Return baru untuk Customer Order lain." },
    };
  }

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await lockCustomerOrder(tx, current.customer_order_id);
      const r = await checkSalesReturn(tx, header, lines, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.salReturn.updateMany({
        where: { id, status: "Draft" },
        data: { ...r.c.data, updated_by: actorId },
      });
      if (done.count !== 1) throw new Refused({ _form: "Sales Return berubah saat diproses. Muat ulang halaman." });
      // A Draft's lines are rewritten whole: nothing names a Sales Return line yet.
      await tx.salReturnLine.deleteMany({ where: { return_id: id } });
      await tx.salReturnLine.createMany({ data: r.c.lines.map((l) => ({ ...l, return_id: id })) });
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, returnNo: current.return_no };
  });
}

function asInput(o: Prisma.SalReturnGetPayload<{ include: { lines: true } }>): {
  header: SalesReturnHeaderInput;
  lines: SalesReturnLineInput[];
} {
  return {
    header: {
      customer_order_id: o.customer_order_id,
      return_date: isoDay(o.return_date),
      address_id: o.address_id,
      reason: o.reason,
      reason_note: o.reason_note ?? "",
      customer_return_no: o.customer_return_no ?? "",
      customer_return_date: isoDay(o.customer_return_date),
      note: o.note ?? "",
    },
    lines: [...o.lines]
      .sort((a, b) => a.line_no - b.line_no)
      .map((l) => ({ delivery_note_line_id: l.delivery_note_line_id, qty: l.base_qty.toNumber(), note: l.note ?? "" })),
  };
}

// --------------------------------------------------------------- lifecycle

export type SalesReturnTransitionResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle step (P287). **Ajukan** checks the stored return again
 * with the Customer Order locked, because another return may have taken some
 * of the same Delivery Note line since this Draft was saved. Batalkan, Tolak
 * and Tutup ask for a reason, stored in `status_reason`. Every step is
 * conditional on the status just read, so two people acting at once cannot
 * both succeed.
 */
export async function transitionSalesReturn(
  id: number,
  action: SalesReturnAction,
  actorId: number,
  reason?: string,
  /**
   * Run inside the step's transaction, with the Customer Order locked, before
   * the return moves; a message refuses the step. Tutup will be handed the
   * Receipt Note module's check by the caller (step 2).
   */
  guard?: (tx: Prisma.TransactionClient, id: number) => Promise<string | null>
): Promise<SalesReturnTransitionResult> {
  const ret = await prisma.salReturn.findUnique({ where: { id }, include: { lines: true } });
  if (!ret) return { ok: false, errors: { _form: "Sales Return tidak ditemukan." } };
  const t = SALES_RETURN_TRANSITIONS[action];
  if (!salesReturnTransitionAllowed(action, ret.status as SalesReturnStatus)) {
    return { ok: false, errors: { _form: `Sales Return berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  const from = ret.status;

  let why: string | null = null;
  if (t.reason) {
    why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
  }

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await lockCustomerOrder(tx, ret.customer_order_id);
      if (action === "submit") {
        const input = asInput(ret);
        const r = await checkSalesReturn(tx, input.header, input.lines, id);
        if (!r.ok) {
          const first = Object.entries(r.errors).find(([k]) => k !== "_lines")?.[1] ?? r.errors._lines;
          throw new Refused({ _form: `Belum bisa diajukan: ${first}` });
        }
      }
      if (guard) {
        const refused = await guard(tx, id);
        if (refused) throw new Refused({ _form: refused });
      }
      const done = await tx.salReturn.updateMany({
        where: { id, status: from },
        data: { status: t.to, ...(why ? { status_reason: why } : {}), updated_by: actorId },
      });
      if (done.count !== 1) throw new Refused({ _form: "Sales Return berubah saat diproses. Muat ulang halaman." });
      await audit(tx, id, "UPDATE", action, actorId);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

export type SalesReturnListRow = {
  id: number;
  returnNo: string;
  returnDate: string;
  status: SalesReturnStatus;
  customerOrderId: number;
  customerOrderNo: string;
  customerLabel: string;
  customerName: string;
  reason: string;
  lines: number;
};

export async function listSalesReturns(): Promise<SalesReturnListRow[]> {
  const rows = await prisma.salReturn.findMany({
    orderBy: [{ return_date: "desc" }, { id: "desc" }],
    include: { customer: true, _count: { select: { lines: true } } },
  });
  const orderNos = await customerOrderNumbersByIds([...new Set(rows.map((r) => r.customer_order_id))]);
  return rows.map((r) => ({
    id: r.id,
    returnNo: r.return_no,
    returnDate: isoDay(r.return_date),
    status: r.status as SalesReturnStatus,
    customerOrderId: r.customer_order_id,
    customerOrderNo: orderNos.get(r.customer_order_id) ?? "",
    customerLabel: r.customer.partner_label,
    customerName: r.customer.partner_name,
    reason: r.reason,
    lines: r._count.lines,
  }));
}

export type SalesReturnView = {
  id: number;
  returnNo: string;
  status: SalesReturnStatus;
  header: SalesReturnHeaderInput;
  lines: (SalesReturnLineInput & { received: number })[];
  statusReason: string | null;
};

export async function getSalesReturn(id: number): Promise<SalesReturnView | null> {
  const o = await prisma.salReturn.findUnique({ where: { id }, include: { lines: true } });
  if (!o) return null;
  const input = asInput(o);
  const received = new Map(o.lines.map((l) => [l.delivery_note_line_id, l.received_qty.toNumber()]));
  return {
    id: o.id,
    returnNo: o.return_no,
    status: o.status as SalesReturnStatus,
    header: input.header,
    lines: input.lines.map((l) => ({ ...l, received: received.get(Number(l.delivery_note_line_id)) ?? 0 })),
    statusReason: o.status_reason,
  };
}

/** Sales Return numbers by id, for the audit panel. */
export async function salesReturnNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.salReturn.findMany({ where: { id: { in: ids } }, select: { id: true, return_no: true } });
  return new Map(rows.map((r) => [r.id, r.return_no]));
}
