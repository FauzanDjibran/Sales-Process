import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import { formatAddress } from "./partner-shape";
import { formatNumber } from "@/lib/format";
import { lockCustomerOrder, salesOrderSources, type SalesOrderSource } from "./customer-order";
import {
  SALES_ORDER_HOLDS_QTY,
  SALES_ORDER_LIVE,
  SALES_ORDER_TRANSITIONS,
  salesOrderIsEditable,
  salesOrderTransitionAllowed,
  type SalesOrderAction,
  type SalesOrderStatus,
} from "./sales-order-workflow";

/**
 * The Sales Order module (Claude-ERP.md P79): its tables are `sal_order` and
 * `sal_order_line`, and nothing else names them.
 *
 * A Sales Order is one dated part of an Open Customer Order, released to PPIC:
 * a Customer Order of 10.000 PCS delivered over five months becomes five Sales
 * Orders of 2.000, each with its own delivery date, so planning sees what is
 * due when rather than the whole agreement. It carries quantities and a date
 * only — the price, the tax and every financial document stay with the
 * Customer Order — and it posts nothing.
 *
 * The Customer Order is read through `salesOrderSources` and locked through
 * `lockCustomerOrder`, both in its own module. While a Sales Order holds part
 * of a Customer Order line, the Sales Orders on that line never add up to more
 * than the line: checked at save and at Ajukan with the Customer Order's row
 * locked, so two orders cannot both take the last of it.
 */

type Db = Prisma.TransactionClient | typeof prisma;

// ------------------------------------------------------------------ input

export type SalesOrderHeaderInput = {
  customer_order_id: number | null;
  order_date: string;
  delivery_date: string;
  address_id: number | null;
  note: string;
};

export type SalesOrderLineInput = {
  customer_order_line_id: number | null;
  qty: number | string;
  note: string;
};

export type SalesOrderResult =
  | { ok: true; id: number; orderNo: string }
  | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const lineKey = (i: number, field: string) => `lines.${i}.${field}`;

/**
 * Quantities are `Decimal(18, 4)`: compared in ten-thousandths, so 0,1 + 0,2
 * never fails to equal 0,3.
 */
const QTY_SCALE = 10_000;
const units = (n: number) => Math.round(n * QTY_SCALE);
const fromUnits = (u: number) => u / QTY_SCALE;
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

// ------------------------------------------------------------- quantities

/**
 * What the Sales Orders already hold of each Customer Order line — every order
 * but a cancelled or rejected one, and but `exceptOrderId`, the one being
 * saved. A closed order keeps its quantity until delivery says otherwise.
 */
async function heldByLines(db: Db, lineIds: number[], exceptOrderId: number | null): Promise<Map<number, number>> {
  if (!lineIds.length) return new Map();
  const rows = await db.salOrderLine.groupBy({
    by: ["customer_order_line_id"],
    where: {
      customer_order_line_id: { in: lineIds },
      order: {
        status: { in: SALES_ORDER_HOLDS_QTY },
        ...(exceptOrderId ? { id: { not: exceptOrderId } } : {}),
      },
    },
    _sum: { qty: true },
  });
  return new Map(rows.map((r) => [r.customer_order_line_id, r._sum?.qty?.toNumber() ?? 0]));
}

// ---------------------------------------------------------------- options

export type SoSourceLine = SalesOrderSource["lines"][number] & {
  /** What other Sales Orders hold of this line. */
  held: number;
};

export type SoSourceOption = Omit<SalesOrderSource, "lines"> & {
  lines: SoSourceLine[];
  /** Every address of the customer — a delivery may go to any of them. */
  addresses: { id: number; text: string }[];
};

export type SalesOrderOptions = { orders: SoSourceOption[] };

/** The customers' addresses, as one line each. */
async function addressesOf(db: Db, partnerIds: number[]): Promise<Map<number, { id: number; text: string }[]>> {
  const rows = await db.mPartnerAddress.findMany({
    where: { partner_id: { in: partnerIds } },
    orderBy: [{ sort_order: "asc" }, { id: "asc" }],
    include: { village: { include: { district: { include: { city: { include: { province: true } } } } } } },
  });
  const out = new Map<number, { id: number; text: string }[]>();
  for (const a of rows) {
    const d = a.village.district;
    const list = out.get(a.partner_id) ?? [];
    list.push({
      id: a.id,
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

/** The Customer Orders a Sales Order may be drawn from, with the room left on each line. */
async function sourceOptions(
  db: Db,
  filter: { ids?: number[]; openOnly?: boolean },
  exceptOrderId: number | null
): Promise<SoSourceOption[]> {
  const sources = await salesOrderSources(filter, db);
  const held = await heldByLines(db, sources.flatMap((s) => s.lines.map((l) => l.id)), exceptOrderId);
  const addresses = await addressesOf(db, [...new Set(sources.map((s) => s.customerId))]);
  return sources.map((s) => ({
    ...s,
    addresses: addresses.get(s.customerId) ?? [],
    lines: s.lines.map((l) => ({ ...l, held: held.get(l.id) ?? 0 })),
  }));
}

/**
 * What the form offers: every Open Customer Order. `current` is the Sales Order
 * being edited or shown — its own Customer Order is always included, whatever
 * its status, and its own lines never count against the room.
 */
export async function salesOrderOptions(
  current: { id: number; customerOrderId: number } | null = null
): Promise<SalesOrderOptions> {
  const open = await sourceOptions(prisma, { openOnly: true }, current?.id ?? null);
  if (current && !open.some((o) => o.id === current.customerOrderId)) {
    open.push(...(await sourceOptions(prisma, { ids: [current.customerOrderId] }, current.id)));
  }
  return { orders: open };
}

// ------------------------------------------------------------- validation

type CheckedLine = { line_no: number; customer_order_line_id: number; qty: number; note: string | null };

type Checked = {
  data: {
    customer_order_id: number;
    customer_id: number;
    order_date: Date;
    delivery_date: Date;
    address_id: number;
    note: string | null;
  };
  lines: CheckedLine[];
};

/**
 * Every rule a Sales Order must satisfy to be saved — and, run again inside
 * the transaction with the Customer Order locked, to be submitted.
 */
export async function checkSalesOrder(
  db: Db,
  header: SalesOrderHeaderInput,
  lines: SalesOrderLineInput[],
  selfId: number | null
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};

  const coId = Number(header.customer_order_id) || null;
  const source = coId ? (await sourceOptions(db, { ids: [coId] }, selfId))[0] : undefined;
  if (!coId) errors.customer_order_id = "Pilih Customer Order.";
  else if (!source) errors.customer_order_id = "Customer Order tidak ditemukan.";
  else if (source.status !== "Open") errors.customer_order_id = "Customer Order harus berstatus Open.";
  else if (!source.customerActive) errors.customer_order_id = "Customer pada Customer Order ini sudah nonaktif.";

  const orderDate = String(header.order_date ?? "").trim();
  const deliveryDate = String(header.delivery_date ?? "").trim();
  if (!DAY.test(orderDate)) errors.order_date = "Tanggal SO wajib diisi.";
  else if (source && orderDate < source.orderDate) errors.order_date = "Tidak boleh sebelum tanggal Customer Order.";
  if (!DAY.test(deliveryDate)) errors.delivery_date = "Tanggal kirim wajib diisi.";
  else if (DAY.test(orderDate) && deliveryDate < orderDate) errors.delivery_date = "Tidak boleh sebelum tanggal SO.";

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
    const lineId = Number(l.customer_order_line_id) || null;
    const coLine = lineId ? byId.get(lineId) : undefined;
    if (!lineId) {
      errors[lineKey(i, "customer_order_line_id")] = "Pilih barang.";
      continue;
    }
    if (!coLine) {
      if (source) errors[lineKey(i, "customer_order_line_id")] = "Barang bukan bagian Customer Order ini.";
      continue;
    }
    if (seen.has(lineId)) {
      errors[lineKey(i, "customer_order_line_id")] = `${coLine.itemLabel} dipilih lebih dari sekali.`;
      continue;
    }
    seen.add(lineId);
    const qty = Number(String(l.qty ?? "").replace(",", "."));
    const left = fromUnits(units(coLine.qty) - units(coLine.held));
    if (!Number.isFinite(qty) || !(qty > 0)) errors[lineKey(i, "qty")] = "Isi jumlah lebih dari 0.";
    else if (Math.abs(qty * QTY_SCALE - units(qty)) > 1e-6) {
      errors[lineKey(i, "qty")] = "Paling banyak 4 angka desimal.";
    } else if (units(qty) > units(left)) {
      errors[lineKey(i, "qty")] = `Melebihi sisa Customer Order (${qtyText(left)} ${coLine.uomLabel}).`;
    } else {
      out.push({
        line_no: out.length + 1,
        customer_order_line_id: lineId,
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
        order_date: asDate(orderDate),
        delivery_date: asDate(deliveryDate),
        address_id: addressId!,
        note: String(header.note ?? "").trim() || null,
      },
      lines: out,
    },
  };
}

// ------------------------------------------------------------------ writes

async function nextOrderNo(db: Db, date: Date): Promise<string> {
  return nextDocumentNumber("SO", date, async (series) => {
    const row = await db.salOrder.findFirst({
      where: { order_no: { startsWith: series } },
      orderBy: { id: "desc" },
      select: { order_no: true },
    });
    return row?.order_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "sal_order", row_id: id, action, event, by } });
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

export async function createSalesOrder(
  header: SalesOrderHeaderInput,
  lines: SalesOrderLineInput[],
  actorId: number
): Promise<SalesOrderResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const coId = Number(header.customer_order_id) || null;
      if (coId) await lockCustomerOrder(tx, coId);
      const r = await checkSalesOrder(tx, header, lines, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.salOrder.create({
        data: {
          ...r.c.data,
          order_no: await nextOrderNo(tx, r.c.data.order_date),
          created_by: actorId,
          lines: { create: r.c.lines },
        },
      });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, orderNo: made.order_no };
  });
}

export async function updateSalesOrder(
  id: number,
  header: SalesOrderHeaderInput,
  lines: SalesOrderLineInput[],
  actorId: number
): Promise<SalesOrderResult> {
  const current = await prisma.salOrder.findUnique({
    where: { id },
    select: { status: true, order_no: true, customer_order_id: true },
  });
  if (!current) return { ok: false, errors: { _form: "Sales Order tidak ditemukan." } };
  if (!salesOrderIsEditable(current.status as SalesOrderStatus)) {
    return { ok: false, errors: { _form: "Sales Order yang sudah diajukan tidak dapat diubah." } };
  }
  if (Number(header.customer_order_id) !== current.customer_order_id) {
    return {
      ok: false,
      errors: { customer_order_id: "Customer Order tidak dapat diganti. Buat Sales Order baru untuk Customer Order lain." },
    };
  }

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await lockCustomerOrder(tx, current.customer_order_id);
      const r = await checkSalesOrder(tx, header, lines, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.salOrder.updateMany({
        where: { id, status: "Draft" },
        data: { ...r.c.data, updated_by: actorId },
      });
      if (done.count !== 1) throw new Refused({ _form: "Sales Order berubah saat diproses. Muat ulang halaman." });
      // A Draft's lines are rewritten whole: nothing names a Sales Order line yet.
      await tx.salOrderLine.deleteMany({ where: { order_id: id } });
      await tx.salOrderLine.createMany({ data: r.c.lines.map((l) => ({ ...l, order_id: id })) });
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, orderNo: current.order_no };
  });
}

function asInput(o: Prisma.SalOrderGetPayload<{ include: { lines: true } }>): {
  header: SalesOrderHeaderInput;
  lines: SalesOrderLineInput[];
} {
  return {
    header: {
      customer_order_id: o.customer_order_id,
      order_date: isoDay(o.order_date),
      delivery_date: isoDay(o.delivery_date),
      address_id: o.address_id,
      note: o.note ?? "",
    },
    lines: [...o.lines]
      .sort((a, b) => a.line_no - b.line_no)
      .map((l) => ({ customer_order_line_id: l.customer_order_line_id, qty: l.qty.toNumber(), note: l.note ?? "" })),
  };
}

// --------------------------------------------------------------- lifecycle

export type SalesOrderTransitionResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle step (P79).
 *
 * **Ajukan** checks the stored order again with the Customer Order locked —
 * still Open, and the quantities still within what is left — because another
 * Sales Order may have taken some since this Draft was saved. Setujui and
 * Konfirmasi change only the status. Tolak, Batalkan and Tutup ask for a
 * reason, stored in `status_reason`. Every step is conditional on the status
 * just read, so two people acting at once cannot both succeed.
 */
export async function transitionSalesOrder(
  id: number,
  action: SalesOrderAction,
  actorId: number,
  reason?: string,
  /**
   * Run inside the step's transaction, with the Customer Order's row locked,
   * before the order moves; a message refuses the step. Tutup is handed the
   * Delivery Order module's check by the caller (P93), so this module never
   * reads its tables.
   */
  guard?: (tx: Prisma.TransactionClient, id: number) => Promise<string | null>
): Promise<SalesOrderTransitionResult> {
  const order = await prisma.salOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!order) return { ok: false, errors: { _form: "Sales Order tidak ditemukan." } };
  const t = SALES_ORDER_TRANSITIONS[action];
  if (!salesOrderTransitionAllowed(action, order.status as SalesOrderStatus)) {
    return { ok: false, errors: { _form: `Sales Order berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  const from = order.status;
  const moved = "Sales Order berubah saat diproses. Muat ulang halaman.";

  let why: string | null = null;
  if (t.reason) {
    why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
  }

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      if (action === "submit") {
        await lockCustomerOrder(tx, order.customer_order_id);
        const input = asInput(order);
        const r = await checkSalesOrder(tx, input.header, input.lines, id);
        if (!r.ok) {
          const first = Object.entries(r.errors).find(([k]) => k !== "_lines")?.[1] ?? r.errors._lines;
          throw new Refused({ _form: `Belum bisa diajukan: ${first}` });
        }
      }
      if (guard) {
        // The same lock a Delivery Order takes to draw on this order's lines,
        // so the check and a new Delivery Order cannot pass each other.
        await lockCustomerOrder(tx, order.customer_order_id);
        const refused = await guard(tx, id);
        if (refused) throw new Refused({ _form: refused });
      }
      const done = await tx.salOrder.updateMany({
        where: { id, status: from },
        data: { status: t.to, ...(why ? { status_reason: why } : {}), updated_by: actorId },
      });
      if (done.count !== 1) throw new Refused({ _form: moved });
      await audit(tx, id, "UPDATE", action, actorId);
    });
    return { ok: true as const };
  });
}

/**
 * Why a Customer Order may not be closed yet, or null: a Sales Order drawn
 * from it is still running (P79). Handed to the Customer Order's Tutup Pesanan
 * by the action that composes the two, so neither module reads the other's
 * tables.
 */
export async function liveSalesOrderRefusal(tx: Prisma.TransactionClient, customerOrderId: number): Promise<string | null> {
  const live = await tx.salOrder.findMany({
    where: { customer_order_id: customerOrderId, status: { in: SALES_ORDER_LIVE } },
    orderBy: { id: "asc" },
    select: { order_no: true },
  });
  if (!live.length) return null;
  const names = live.map((o) => o.order_no);
  return `Masih ada Sales Order yang berjalan: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` dan ${names.length - 3} lainnya` : ""}. Tutup, tolak atau batalkan dulu.`;
}

// ------------------------------------------------------------------- reads

export type SalesOrderListRow = {
  id: number;
  orderNo: string;
  orderDate: string;
  deliveryDate: string;
  status: SalesOrderStatus;
  customerOrderId: number;
  customerOrderNo: string;
  customerLabel: string;
  customerName: string;
  lines: number;
};

export async function listSalesOrders(): Promise<SalesOrderListRow[]> {
  const rows = await prisma.salOrder.findMany({
    orderBy: [{ order_date: "desc" }, { id: "desc" }],
    include: { customer: true, _count: { select: { lines: true } } },
  });
  const sources = new Map(
    (await salesOrderSources({ ids: [...new Set(rows.map((r) => r.customer_order_id))] })).map((s) => [s.id, s])
  );
  return rows.map((r) => ({
    id: r.id,
    orderNo: r.order_no,
    orderDate: isoDay(r.order_date),
    deliveryDate: isoDay(r.delivery_date),
    status: r.status as SalesOrderStatus,
    customerOrderId: r.customer_order_id,
    customerOrderNo: sources.get(r.customer_order_id)?.orderNo ?? "",
    customerLabel: r.customer.partner_label,
    customerName: r.customer.partner_name,
    lines: r._count.lines,
  }));
}

export type SalesOrderView = {
  id: number;
  orderNo: string;
  status: SalesOrderStatus;
  header: SalesOrderHeaderInput;
  lines: SalesOrderLineInput[];
  statusReason: string | null;
};

export async function getSalesOrder(id: number): Promise<SalesOrderView | null> {
  const o = await prisma.salOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!o) return null;
  const input = asInput(o);
  return {
    id: o.id,
    orderNo: o.order_no,
    status: o.status as SalesOrderStatus,
    header: input.header,
    lines: input.lines,
    statusReason: o.status_reason,
  };
}

/** Order numbers by id, for the audit panel. */
export async function salesOrderNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.salOrder.findMany({ where: { id: { in: ids } }, select: { id: true, order_no: true } });
  return new Map(rows.map((r) => [r.id, r.order_no]));
}

/**
 * A Customer Order's schedule, for its own page (P79): the Sales Orders drawn
 * from it, and how much of each of its lines they hold. The Customer Order's
 * page composes this with its own record; the Customer Order module never
 * reads it.
 */
export type CustomerOrderSchedule = {
  orders: { id: number; orderNo: string; orderDate: string; deliveryDate: string; status: SalesOrderStatus }[];
  /** Each Customer Order line, with what every order but a cancelled or rejected one holds of it. */
  lines: SoSourceLine[];
};

export async function customerOrderSchedule(customerOrderId: number): Promise<CustomerOrderSchedule> {
  const [rows, [source]] = await Promise.all([
    prisma.salOrder.findMany({
      where: { customer_order_id: customerOrderId },
      orderBy: [{ delivery_date: "asc" }, { id: "asc" }],
    }),
    sourceOptions(prisma, { ids: [customerOrderId] }, null),
  ]);
  return {
    orders: rows.map((r) => ({
      id: r.id,
      orderNo: r.order_no,
      orderDate: isoDay(r.order_date),
      deliveryDate: isoDay(r.delivery_date),
      status: r.status as SalesOrderStatus,
    })),
    lines: source?.lines ?? [],
  };
}

// ------------------------------------------------- for the Delivery Order

/**
 * One line of a Sales Order as a Delivery Order reads it (P93): which Sales
 * Order, when it is due, the Customer Order line's item and unit, and the
 * quantity a Delivery Order may send a part of. A Sales Order's lines are
 * frozen once it is submitted, and only an Open one is shipped from, so what a
 * Delivery Order names does not move.
 */
export type DeliverySourceLine = {
  id: number;
  salesOrderId: number;
  salesOrderNo: string;
  salesOrderStatus: SalesOrderStatus;
  deliveryDate: string;
  itemLabel: string;
  itemName: string;
  uomLabel: string;
  qty: number;
};

export type DeliverySource = Omit<SalesOrderSource, "lines"> & {
  addresses: { id: number; text: string }[];
  salesOrders: { id: number; orderNo: string; deliveryDate: string; addressId: number; status: SalesOrderStatus }[];
  lines: DeliverySourceLine[];
};

/**
 * The Customer Orders a Delivery Order may ship from, each with its **Open**
 * Sales Orders and their lines. With `openOnly`, only Open Customer Orders that
 * have at least one Open Sales Order. `withLineIds` also brings in the Sales
 * Orders owning those lines, and `withOrderIds` those Sales Orders, whatever
 * their status — a stored Delivery Order keeps reading the lines it named after
 * their Sales Order is closed.
 */
export async function deliveryOrderSources(
  filter: { ids?: number[]; openOnly?: boolean; withLineIds?: number[]; withOrderIds?: number[] },
  db: Db = prisma
): Promise<DeliverySource[]> {
  const cos = await salesOrderSources({ ids: filter.ids, openOnly: filter.openOnly }, db);
  if (!cos.length) return [];
  const withLines = filter.withLineIds?.length ? filter.withLineIds : null;
  const orders = await db.salOrder.findMany({
    where: {
      customer_order_id: { in: cos.map((c) => c.id) },
      OR: [
        { status: "Open" },
        ...(withLines ? [{ lines: { some: { id: { in: withLines } } } }] : []),
        ...(filter.withOrderIds?.length ? [{ id: { in: filter.withOrderIds } }] : []),
      ],
    },
    orderBy: [{ delivery_date: "asc" }, { id: "asc" }],
    include: { lines: { orderBy: { line_no: "asc" } } },
  });
  const addresses = await addressesOf(db, [...new Set(cos.map((c) => c.customerId))]);
  const out: DeliverySource[] = [];
  for (const { lines: coLines, ...co } of cos) {
    const coLine = new Map(coLines.map((l) => [l.id, l]));
    const mine = orders.filter((o) => o.customer_order_id === co.id);
    if (filter.openOnly && !mine.some((o) => o.status === "Open")) continue;
    out.push({
      ...co,
      addresses: addresses.get(co.customerId) ?? [],
      salesOrders: mine.map((o) => ({
        id: o.id,
        orderNo: o.order_no,
        deliveryDate: isoDay(o.delivery_date),
        addressId: o.address_id,
        status: o.status as SalesOrderStatus,
      })),
      lines: mine.flatMap((o) =>
        o.lines.map((l) => {
          const c = coLine.get(l.customer_order_line_id);
          return {
            id: l.id,
            salesOrderId: o.id,
            salesOrderNo: o.order_no,
            salesOrderStatus: o.status as SalesOrderStatus,
            deliveryDate: isoDay(o.delivery_date),
            itemLabel: c?.itemLabel ?? "",
            itemName: c?.itemName ?? "",
            uomLabel: c?.uomLabel ?? "",
            qty: l.qty.toNumber(),
          };
        })
      ),
    });
  }
  return out;
}
