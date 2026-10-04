import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import { formatNumber } from "@/lib/format";
import { customerOrderNumbersByIds, lockCustomerOrder } from "./customer-order";
import {
  deliveryOrderSources,
  recordSalesOrderDelivery,
  type DeliverySource,
  type DeliverySourceLine,
} from "./sales-order";
import {
  DELIVERY_ORDER_HOLDS_QTY,
  DELIVERY_ORDER_LIVE,
  DELIVERY_ORDER_TRANSITIONS,
  deliveryOrderIsEditable,
  deliveryOrderTransitionAllowed,
  type DeliveryOrderAction,
  type DeliveryOrderStatus,
} from "./delivery-order-workflow";

/**
 * The Delivery Order module (Claude-ERP.md P93): its tables are
 * `sal_delivery_order` and `sal_delivery_order_line`, and nothing else names
 * them.
 *
 * A Delivery Order is the instruction to one warehouse to send goods of one
 * Customer Order to one address on one date. Its header names the Customer
 * Order; each line takes a quantity of one line of that order's **Open** Sales
 * Orders, so one Delivery Order may ship from several Sales Orders. Quantity
 * only, and it posts nothing: the Delivery Note, which the goods actually
 * leave on, comes next (C28).
 *
 * The Sales Orders are read through `deliveryOrderSources`, in their own
 * module, and the Customer Order is locked through `lockCustomerOrder`. The
 * Delivery Orders on a Sales Order line never add up to more than the line:
 * checked at save and at Terbitkan with the Customer Order's row locked, so two
 * Delivery Orders cannot both take the last of it.
 */

type Db = Prisma.TransactionClient | typeof prisma;

// ------------------------------------------------------------------ input

export type DeliveryOrderHeaderInput = {
  customer_order_id: number | null;
  do_date: string;
  delivery_date: string;
  warehouse_id: number | null;
  address_id: number | null;
  note: string;
};

export type DeliveryOrderLineInput = {
  sales_order_line_id: number | null;
  qty: number | string;
  note: string;
};

export type DeliveryOrderResult =
  | { ok: true; id: number; doNo: string }
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

// ------------------------------------------------------------- quantities

/**
 * What the Delivery Orders already hold of each Sales Order line — every order
 * but a cancelled one, and but `exceptId`, the one being saved. A closed order
 * keeps its quantity until the Delivery Notes say what really left.
 */
async function heldByLines(db: Db, lineIds: number[], exceptId: number | null): Promise<Map<number, number>> {
  if (!lineIds.length) return new Map();
  const except = exceptId ? { id: { not: exceptId } } : {};
  // A running order holds its whole quantity; a closed one only what was
  // delivered of it (U14), so closing it releases the rest.
  const [running, closed] = await Promise.all([
    db.salDeliveryOrderLine.groupBy({
      by: ["sales_order_line_id"],
      where: {
        sales_order_line_id: { in: lineIds },
        delivery_order: { status: { in: DELIVERY_ORDER_HOLDS_QTY.filter((st) => st !== "Closed") }, ...except },
      },
      _sum: { qty: true },
    }),
    db.salDeliveryOrderLine.groupBy({
      by: ["sales_order_line_id"],
      where: { sales_order_line_id: { in: lineIds }, delivery_order: { status: "Closed", ...except } },
      _sum: { delivered_qty: true },
    }),
  ]);
  const out = new Map<number, number>();
  for (const r of running) out.set(r.sales_order_line_id, r._sum?.qty?.toNumber() ?? 0);
  for (const r of closed) {
    out.set(r.sales_order_line_id, (out.get(r.sales_order_line_id) ?? 0) + (r._sum?.delivered_qty?.toNumber() ?? 0));
  }
  return out;
}

// ---------------------------------------------------------------- options

export type DoSourceLine = DeliverySourceLine & {
  /** What other Delivery Orders hold of this Sales Order line. */
  held: number;
};

export type DoSourceOption = Omit<DeliverySource, "lines"> & { lines: DoSourceLine[] };

export type DeliveryOrderOptions = {
  orders: DoSourceOption[];
  warehouses: { id: number; label: string; name: string; active: boolean }[];
};

async function sourceOptions(
  db: Db,
  filter: { ids?: number[]; openOnly?: boolean; withLineIds?: number[]; withOrderIds?: number[] },
  exceptId: number | null
): Promise<DoSourceOption[]> {
  const sources = await deliveryOrderSources(filter, db);
  const held = await heldByLines(db, sources.flatMap((s) => s.lines.map((l) => l.id)), exceptId);
  return sources.map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l, held: held.get(l.id) ?? 0 })) }));
}

/**
 * What the form offers: every Open Customer Order with an Open Sales Order, and
 * the active warehouses. `current` is the Delivery Order being edited or shown —
 * its own Customer Order, the lines it names and its warehouse are always
 * included, and its own lines never count against the room.
 */
export async function deliveryOrderOptions(
  current: { id: number; customerOrderId: number; lineIds: number[]; warehouseId: number | null } | null = null
): Promise<DeliveryOrderOptions> {
  // A saved Delivery Order's Customer Order is locked: its page needs only that one.
  const orders = current
    ? await sourceOptions(prisma, { ids: [current.customerOrderId], withLineIds: current.lineIds }, current.id)
    : await sourceOptions(prisma, { openOnly: true }, null);
  const warehouses = await prisma.refWarehouse.findMany({
    where: { OR: [{ status: "Active" }, ...(current?.warehouseId ? [{ id: current.warehouseId }] : [])] },
    orderBy: { warehouse_label: "asc" },
  });
  return {
    orders,
    warehouses: warehouses.map((w) => ({
      id: w.id,
      label: w.warehouse_label,
      name: w.warehouse_name,
      active: w.status === "Active",
    })),
  };
}

// ------------------------------------------------------------- validation

type CheckedLine = { line_no: number; sales_order_line_id: number; qty: number; note: string | null };

type Checked = {
  data: {
    customer_order_id: number;
    customer_id: number;
    do_date: Date;
    delivery_date: Date;
    warehouse_id: number;
    address_id: number;
    note: string | null;
  };
  lines: CheckedLine[];
};

/**
 * Every rule a Delivery Order must satisfy to be saved — and, run again inside
 * the transaction with the Customer Order locked, to be issued.
 */
export async function checkDeliveryOrder(
  db: Db,
  header: DeliveryOrderHeaderInput,
  lines: DeliveryOrderLineInput[],
  selfId: number | null
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};

  const coId = Number(header.customer_order_id) || null;
  const source = coId ? (await sourceOptions(db, { ids: [coId] }, selfId))[0] : undefined;
  if (!coId) errors.customer_order_id = "Pilih Customer Order.";
  else if (!source) errors.customer_order_id = "Customer Order tidak ditemukan.";
  else if (source.status !== "Open") errors.customer_order_id = "Customer Order harus berstatus Open.";
  else if (!source.customerActive) errors.customer_order_id = "Customer pada Customer Order ini sudah nonaktif.";
  else if (!source.salesOrders.some((o) => o.status === "Open")) {
    errors.customer_order_id = "Customer Order ini belum punya Sales Order berstatus Open.";
  }

  const doDate = String(header.do_date ?? "").trim();
  const deliveryDate = String(header.delivery_date ?? "").trim();
  if (!DAY.test(doDate)) errors.do_date = "Tanggal DO wajib diisi.";
  else if (source && doDate < source.orderDate) errors.do_date = "Tidak boleh sebelum tanggal Customer Order.";
  if (!DAY.test(deliveryDate)) errors.delivery_date = "Tanggal kirim wajib diisi.";
  else if (DAY.test(doDate) && deliveryDate < doDate) errors.delivery_date = "Tidak boleh sebelum tanggal DO.";

  const warehouseId = Number(header.warehouse_id) || null;
  if (!warehouseId) errors.warehouse_id = "Pilih gudang.";
  else {
    const w = await db.refWarehouse.findUnique({ where: { id: warehouseId }, select: { status: true } });
    if (!w) errors.warehouse_id = "Gudang tidak ditemukan.";
    else if (w.status !== "Active") errors.warehouse_id = "Gudang sudah nonaktif.";
  }

  const addressId = Number(header.address_id) || null;
  if (!addressId) errors.address_id = "Pilih alamat kirim.";
  else if (source && !source.addresses.some((a) => a.id === addressId)) {
    errors.address_id = "Alamat bukan milik customer Customer Order ini.";
  }

  const raw = Array.isArray(lines) ? lines : [];
  const out: CheckedLine[] = [];
  if (!raw.length) errors._lines = "Tambahkan minimal satu barang.";
  const byId = new Map((source?.lines ?? []).map((l) => [l.id, l]));
  const seen = new Set<number>();
  for (const [i, l] of raw.entries()) {
    const lineId = Number(l.sales_order_line_id) || null;
    const so = lineId ? byId.get(lineId) : undefined;
    if (!lineId) {
      errors[lineKey(i, "sales_order_line_id")] = "Pilih barang.";
      continue;
    }
    if (!so) {
      if (source) errors[lineKey(i, "sales_order_line_id")] = "Barang bukan bagian Sales Order dari Customer Order ini.";
      continue;
    }
    if (so.salesOrderStatus !== "Open") {
      errors[lineKey(i, "sales_order_line_id")] = `${so.salesOrderNo} tidak lagi berstatus Open.`;
      continue;
    }
    if (seen.has(lineId)) {
      errors[lineKey(i, "sales_order_line_id")] = `${so.itemLabel} dari ${so.salesOrderNo} dipilih lebih dari sekali.`;
      continue;
    }
    seen.add(lineId);
    const qty = Number(String(l.qty ?? "").replace(",", "."));
    const left = fromUnits(units(so.qty) - units(so.held));
    if (!Number.isFinite(qty) || !(qty > 0)) errors[lineKey(i, "qty")] = "Isi jumlah lebih dari 0.";
    else if (Math.abs(qty * QTY_SCALE - units(qty)) > 1e-6) {
      errors[lineKey(i, "qty")] = "Paling banyak 4 angka desimal.";
    } else if (units(qty) > units(left)) {
      errors[lineKey(i, "qty")] = `Melebihi sisa ${so.salesOrderNo} (${qtyText(left)} ${so.uomLabel}).`;
    } else {
      out.push({
        line_no: out.length + 1,
        sales_order_line_id: lineId,
        qty: fromUnits(units(qty)),
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
        do_date: asDate(doDate),
        delivery_date: asDate(deliveryDate),
        warehouse_id: warehouseId!,
        address_id: addressId!,
        note: String(header.note ?? "").trim() || null,
      },
      lines: out,
    },
  };
}

// ------------------------------------------------------------------ writes

async function nextDoNo(db: Db, date: Date): Promise<string> {
  return nextDocumentNumber("DO", date, async (series) => {
    const row = await db.salDeliveryOrder.findFirst({
      where: { do_no: { startsWith: series } },
      orderBy: { id: "desc" },
      select: { do_no: true },
    });
    return row?.do_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "sal_delivery_order", row_id: id, action, event, by } });
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

export async function createDeliveryOrder(
  header: DeliveryOrderHeaderInput,
  lines: DeliveryOrderLineInput[],
  actorId: number
): Promise<DeliveryOrderResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const coId = Number(header.customer_order_id) || null;
      if (coId) await lockCustomerOrder(tx, coId);
      const r = await checkDeliveryOrder(tx, header, lines, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.salDeliveryOrder.create({
        data: {
          ...r.c.data,
          do_no: await nextDoNo(tx, r.c.data.do_date),
          created_by: actorId,
          lines: { create: r.c.lines },
        },
      });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, doNo: made.do_no };
  });
}

export async function updateDeliveryOrder(
  id: number,
  header: DeliveryOrderHeaderInput,
  lines: DeliveryOrderLineInput[],
  actorId: number
): Promise<DeliveryOrderResult> {
  const current = await prisma.salDeliveryOrder.findUnique({
    where: { id },
    select: { status: true, do_no: true, customer_order_id: true },
  });
  if (!current) return { ok: false, errors: { _form: "Delivery Order tidak ditemukan." } };
  if (!deliveryOrderIsEditable(current.status as DeliveryOrderStatus)) {
    return { ok: false, errors: { _form: "Delivery Order yang sudah diterbitkan tidak dapat diubah." } };
  }
  if (Number(header.customer_order_id) !== current.customer_order_id) {
    return {
      ok: false,
      errors: { customer_order_id: "Customer Order tidak dapat diganti. Buat Delivery Order baru untuk Customer Order lain." },
    };
  }

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await lockCustomerOrder(tx, current.customer_order_id);
      const r = await checkDeliveryOrder(tx, header, lines, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.salDeliveryOrder.updateMany({
        where: { id, status: "Draft" },
        data: { ...r.c.data, updated_by: actorId },
      });
      if (done.count !== 1) throw new Refused({ _form: "Delivery Order berubah saat diproses. Muat ulang halaman." });
      // A Draft's lines are rewritten whole: nothing names a Delivery Order line yet.
      await tx.salDeliveryOrderLine.deleteMany({ where: { delivery_order_id: id } });
      await tx.salDeliveryOrderLine.createMany({ data: r.c.lines.map((l) => ({ ...l, delivery_order_id: id })) });
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, doNo: current.do_no };
  });
}

function asInput(o: Prisma.SalDeliveryOrderGetPayload<{ include: { lines: true } }>): {
  header: DeliveryOrderHeaderInput;
  lines: DeliveryOrderLineInput[];
} {
  return {
    header: {
      customer_order_id: o.customer_order_id,
      do_date: isoDay(o.do_date),
      delivery_date: isoDay(o.delivery_date),
      warehouse_id: o.warehouse_id,
      address_id: o.address_id,
      note: o.note ?? "",
    },
    lines: [...o.lines]
      .sort((a, b) => a.line_no - b.line_no)
      .map((l) => ({ sales_order_line_id: l.sales_order_line_id, qty: l.qty.toNumber(), note: l.note ?? "" })),
  };
}

// --------------------------------------------------------------- lifecycle

export type DeliveryOrderTransitionResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle step (P93).
 *
 * **Terbitkan** checks the stored order again with the Customer Order locked —
 * the Customer Order and every Sales Order still Open, the warehouse still
 * active, and the quantities still within what is left — because another
 * Delivery Order may have taken some since this Draft was saved. Batalkan and
 * Tutup ask for a reason, stored in `status_reason`. Every step is conditional
 * on the status just read, so two people acting at once cannot both succeed.
 */
export async function transitionDeliveryOrder(
  id: number,
  action: DeliveryOrderAction,
  actorId: number,
  reason?: string,
  /**
   * Run inside the step's transaction, with the Customer Order's row locked,
   * before the order moves; a message refuses the step. Tutup is handed the
   * Delivery Note module's check by the caller, so this module never reads its
   * tables.
   */
  guard?: (tx: Prisma.TransactionClient, id: number) => Promise<string | null>
): Promise<DeliveryOrderTransitionResult> {
  const order = await prisma.salDeliveryOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!order) return { ok: false, errors: { _form: "Delivery Order tidak ditemukan." } };
  const t = DELIVERY_ORDER_TRANSITIONS[action];
  if (!deliveryOrderTransitionAllowed(action, order.status as DeliveryOrderStatus)) {
    return { ok: false, errors: { _form: `Delivery Order berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  const from = order.status;

  let why: string | null = null;
  if (t.reason) {
    why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
  }

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      if (action === "issue") {
        await lockCustomerOrder(tx, order.customer_order_id);
        const input = asInput(order);
        const r = await checkDeliveryOrder(tx, input.header, input.lines, id);
        if (!r.ok) {
          const first = Object.entries(r.errors).find(([k]) => k !== "_lines")?.[1] ?? r.errors._lines;
          throw new Refused({ _form: `Belum bisa diterbitkan: ${first}` });
        }
      }
      if (guard) {
        await lockCustomerOrder(tx, order.customer_order_id);
        const refused = await guard(tx, id);
        if (refused) throw new Refused({ _form: refused });
      }
      const done = await tx.salDeliveryOrder.updateMany({
        where: { id, status: from },
        data: { status: t.to, ...(why ? { status_reason: why } : {}), updated_by: actorId },
      });
      if (done.count !== 1) throw new Refused({ _form: "Delivery Order berubah saat diproses. Muat ulang halaman." });
      await audit(tx, id, "UPDATE", action, actorId);
    });
    return { ok: true as const };
  });
}

/**
 * Why a Sales Order may not be closed yet, or null: a Delivery Order drawing on
 * it is still Draft or Diterbitkan (P93). Handed to the Sales Order's Tutup by
 * the action that composes the two, so neither module reads the other's tables.
 */
export async function liveDeliveryOrderRefusal(tx: Prisma.TransactionClient, salesOrderId: number): Promise<string | null> {
  const live = await tx.salDeliveryOrder.findMany({
    where: {
      status: { in: DELIVERY_ORDER_LIVE },
      lines: { some: { sales_order_line: { order_id: salesOrderId } } },
    },
    orderBy: { id: "asc" },
    select: { do_no: true },
  });
  if (!live.length) return null;
  const names = live.map((o) => o.do_no);
  return `Masih ada Delivery Order yang berjalan: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` dan ${names.length - 3} lainnya` : ""}. Tutup atau batalkan dulu.`;
}

// ------------------------------------------------------------------- reads

export type DeliveryOrderListRow = {
  id: number;
  doNo: string;
  doDate: string;
  deliveryDate: string;
  status: DeliveryOrderStatus;
  customerOrderId: number;
  customerOrderNo: string;
  customerLabel: string;
  customerName: string;
  warehouseLabel: string;
  lines: number;
};

export async function listDeliveryOrders(): Promise<DeliveryOrderListRow[]> {
  const rows = await prisma.salDeliveryOrder.findMany({
    orderBy: [{ do_date: "desc" }, { id: "desc" }],
    include: { customer: true, warehouse: true, _count: { select: { lines: true } } },
  });
  // Numbers only: a list shows which Customer Order, not the order itself.
  const orderNos = await customerOrderNumbersByIds([...new Set(rows.map((r) => r.customer_order_id))]);
  return rows.map((r) => ({
    id: r.id,
    doNo: r.do_no,
    doDate: isoDay(r.do_date),
    deliveryDate: isoDay(r.delivery_date),
    status: r.status as DeliveryOrderStatus,
    customerOrderId: r.customer_order_id,
    customerOrderNo: orderNos.get(r.customer_order_id) ?? "",
    customerLabel: r.customer.partner_label,
    customerName: r.customer.partner_name,
    warehouseLabel: r.warehouse.warehouse_label,
    lines: r._count.lines,
  }));
}

export type DeliveryOrderView = {
  id: number;
  doNo: string;
  status: DeliveryOrderStatus;
  header: DeliveryOrderHeaderInput;
  lines: DeliveryOrderLineInput[];
  statusReason: string | null;
};

export async function getDeliveryOrder(id: number): Promise<DeliveryOrderView | null> {
  const o = await prisma.salDeliveryOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!o) return null;
  const input = asInput(o);
  return {
    id: o.id,
    doNo: o.do_no,
    status: o.status as DeliveryOrderStatus,
    header: input.header,
    lines: input.lines,
    statusReason: o.status_reason,
  };
}

/** Delivery Order numbers by id, for the audit panel. */
export async function deliveryOrderNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.salDeliveryOrder.findMany({ where: { id: { in: ids } }, select: { id: true, do_no: true } });
  return new Map(rows.map((r) => [r.id, r.do_no]));
}

/**
 * A Sales Order's shipping state, for its own page (P93): the Delivery Orders
 * drawing on it, and how much of each of its lines they hold. The Sales Order's
 * page composes this with its own record; the Sales Order module never reads it.
 */
export type SalesOrderDeliveries = {
  orders: { id: number; doNo: string; doDate: string; deliveryDate: string; status: DeliveryOrderStatus }[];
  /** Each Sales Order line, with what every Delivery Order but a cancelled one holds of it. */
  lines: DoSourceLine[];
};

export async function salesOrderDeliveries(salesOrderId: number, customerOrderId: number): Promise<SalesOrderDeliveries> {
  const [rows, [source]] = await Promise.all([
    prisma.salDeliveryOrder.findMany({
      where: { lines: { some: { sales_order_line: { order_id: salesOrderId } } } },
      orderBy: [{ delivery_date: "asc" }, { id: "asc" }],
    }),
    sourceOptions(prisma, { ids: [customerOrderId], withOrderIds: [salesOrderId] }, null),
  ]);
  return {
    orders: rows.map((r) => ({
      id: r.id,
      doNo: r.do_no,
      doDate: isoDay(r.do_date),
      deliveryDate: isoDay(r.delivery_date),
      status: r.status as DeliveryOrderStatus,
    })),
    lines: source?.lines.filter((l) => l.salesOrderId === salesOrderId) ?? [],
  };
}

// ------------------------------------------------- for the Delivery Note

/**
 * An issued Delivery Order as a Delivery Note reads it (C28): its header —
 * Customer Order, customer, warehouse, address — and its lines with the item,
 * the unit and its factor, the quantity ordered and what has been delivered.
 * An issued order's lines are frozen, so what a note names does not move.
 */
export type DeliveryNoteSourceLine = {
  id: number;
  lineNo: number;
  salesOrderId: number;
  salesOrderNo: string;
  customerOrderLineId: number;
  itemId: number;
  itemLabel: string;
  itemName: string;
  uomLabel: string;
  uomFactor: number;
  qty: number;
  delivered: number;
};

export type DeliveryNoteSource = {
  id: number;
  doNo: string;
  doDate: string;
  deliveryDate: string;
  status: DeliveryOrderStatus;
  customerOrderId: number;
  customerOrderNo: string;
  poNo: string | null;
  customerId: number;
  customerLabel: string;
  customerName: string;
  customerActive: boolean;
  warehouseId: number;
  warehouseLabel: string;
  warehouseName: string;
  addressId: number;
  addressText: string;
  lines: DeliveryNoteSourceLine[];
};

/** Issued Delivery Orders (with `issuedOnly`), or the ones named — any status — for a stored note. */
export async function deliveryNoteSources(
  filter: { ids?: number[]; issuedOnly?: boolean },
  db: Db = prisma
): Promise<DeliveryNoteSource[]> {
  const rows = await db.salDeliveryOrder.findMany({
    where: {
      ...(filter.ids ? { id: { in: filter.ids } } : {}),
      ...(filter.issuedOnly ? { status: "Issued" } : {}),
    },
    orderBy: [{ delivery_date: "asc" }, { id: "asc" }],
    include: { customer: true, warehouse: true, lines: { orderBy: { line_no: "asc" } } },
  });
  if (!rows.length) return [];
  const sources = await deliveryOrderSources({
    ids: [...new Set(rows.map((r) => r.customer_order_id))],
    withLineIds: rows.flatMap((r) => r.lines.map((l) => l.sales_order_line_id)),
  }, db);
  const soLine = new Map(sources.flatMap((s) => s.lines.map((l) => [l.id, l] as const)));
  const coById = new Map(sources.map((s) => [s.id, s]));
  return rows.map((r) => {
    const co = coById.get(r.customer_order_id);
    return {
      id: r.id,
      doNo: r.do_no,
      doDate: isoDay(r.do_date),
      deliveryDate: isoDay(r.delivery_date),
      status: r.status as DeliveryOrderStatus,
      customerOrderId: r.customer_order_id,
      customerOrderNo: co?.orderNo ?? "",
      poNo: co?.poNo ?? null,
      customerId: r.customer_id,
      customerLabel: r.customer.partner_label,
      customerName: r.customer.partner_name,
      customerActive: r.customer.status === "Active",
      warehouseId: r.warehouse_id,
      warehouseLabel: r.warehouse.warehouse_label,
      warehouseName: r.warehouse.warehouse_name,
      addressId: r.address_id,
      addressText: co?.addresses.find((a) => a.id === r.address_id)?.text ?? "",
      lines: r.lines.map((l) => {
        const so = soLine.get(l.sales_order_line_id);
        return {
          id: l.id,
          lineNo: l.line_no,
          salesOrderId: so?.salesOrderId ?? 0,
          salesOrderNo: so?.salesOrderNo ?? "",
          customerOrderLineId: so?.customerOrderLineId ?? 0,
          itemId: so?.itemId ?? 0,
          itemLabel: so?.itemLabel ?? "",
          itemName: so?.itemName ?? "",
          uomLabel: so?.uomLabel ?? "",
          uomFactor: so?.uomFactor ?? 1,
          qty: l.qty.toNumber(),
          delivered: l.delivered_qty.toNumber(),
        };
      }),
    };
  });
}

/**
 * Records what a posted Delivery Note sent of this Delivery Order's lines
 * (U14): the Delivery Order closes itself once every line is delivered, and
 * the same quantities are recorded on the Sales Order lines, which close their
 * orders when complete. Called inside the note's posting transaction, under the
 * Customer Order's lock. Returns the numbers of the orders it closed.
 */
export async function recordDeliveryOrderDelivery(
  tx: Prisma.TransactionClient,
  deliveryOrderId: number,
  sent: Map<number, number>,
  actorId: number
): Promise<string[]> {
  if (!sent.size) return [];
  const bySoLine = new Map<number, number>();
  for (const [lineId, qty] of sent) {
    const line = await tx.salDeliveryOrderLine.update({
      where: { id: lineId },
      data: { delivered_qty: { increment: qty } },
      select: { sales_order_line_id: true },
    });
    bySoLine.set(line.sales_order_line_id, (bySoLine.get(line.sales_order_line_id) ?? 0) + qty);
  }
  const closed: string[] = [];
  const order = await tx.salDeliveryOrder.findUnique({ where: { id: deliveryOrderId }, include: { lines: true } });
  if (
    order?.status === "Issued" &&
    order.lines.every((l) => units(l.delivered_qty.toNumber()) >= units(l.qty.toNumber()))
  ) {
    const done = await tx.salDeliveryOrder.updateMany({
      where: { id: deliveryOrderId, status: "Issued" },
      data: { status: "Closed", status_reason: null, updated_by: actorId },
    });
    if (done.count === 1) {
      await audit(tx, deliveryOrderId, "UPDATE", "fulfil", actorId);
      closed.push(order.do_no);
    }
  }
  return [...closed, ...(await recordSalesOrderDelivery(tx, bySoLine, actorId))];
}
