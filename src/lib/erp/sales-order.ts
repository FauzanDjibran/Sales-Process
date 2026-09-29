import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import { formatAddress } from "./partner-shape";
import { CUSTOMER_CATEGORY } from "./entities";
import { PPN_SETTINGS_MISSING, ppnRates } from "./system-settings";
import {
  computeSalesTotals,
  lineProblem,
  type AdvanceBasis,
  type DiscountType,
  type PpnRates,
  type PriceMode,
  type SalesTotals,
} from "./sales-tax";
import {
  SALES_ORDER_TRANSITIONS,
  salesOrderIsEditable,
  salesOrderTransitionAllowed,
  type SalesOrderAction,
  type SalesOrderStatus,
} from "./sales-order-workflow";

/**
 * The Sales Order module (Claude-ERP.md P49–P53): its tables are `sal_order`
 * and `sal_order_line`, and nothing else names them.
 *
 * A Sales Order posts nothing. It is a record of what the customer ordered,
 * at what price, under which tax treatment — the source the Surat Jalan and
 * the Faktur will later draw from. Everything the form shows as a figure comes
 * from `sales-tax.ts`, the same module the save below stores from.
 *
 * The rules live here rather than in the Server Action so the test suite can
 * exercise them: an action resolves its caller from a session cookie, and a
 * test has none.
 */

type Db = Prisma.TransactionClient | typeof prisma;

// ------------------------------------------------------------------ input

export type SalesOrderHeaderInput = {
  order_date: string;
  customer_id: number | null;
  address_id: number | null;
  term_id: number | null;
  warehouse_id: number | null;
  price_mode: string;
  is_taxable: boolean;
  po_no: string;
  po_date: string;
  requested_date: string;
  salesperson: string;
  note: string;
};

export type SalesOrderLineInput = {
  item_id: number | null;
  uom_id: number | null;
  qty: number;
  price: number;
  discount_type: string | null;
  discount_value: number | null;
  withholding_tax_id: number | null;
  note: string;
};

export type SalesOrderResult =
  | { ok: true; id: number; orderNo: string }
  | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const lineKey = (i: number, field: string) => `lines.${i}.${field}`;

// ---------------------------------------------------------------- options

export type SoCustomerOption = {
  id: number;
  label: string;
  name: string;
  active: boolean;
  addresses: { id: number; text: string; isBilling: boolean; isShipping: boolean }[];
  defaultTermId: number | null;
  defaultPriceMode: PriceMode | null;
  collectsPph22: boolean;
  vatCollector: boolean;
  isPkp: boolean;
  taxIdType: string | null;
  taxId: string | null;
  /** What keeps this customer off a Sales Order, in words. Empty when usable. */
  problems: string[];
};

export type SoItemOption = {
  id: number;
  label: string;
  name: string;
  active: boolean;
  /** The base unit first (factor 1), then the item's conversions. */
  uoms: { id: number; label: string; name: string; factor: number }[];
};

export type SoRefOption = { id: number; label: string; name: string; active: boolean };
export type SoWhtOption = SoRefOption & { rate: number };

export type SalesOrderOptions = {
  customers: SoCustomerOption[];
  items: SoItemOption[];
  terms: SoRefOption[];
  warehouses: SoRefOption[];
  withholdingTaxes: SoWhtOption[];
  /** The PPN rate and factor a Draft is computed with now (P60); null when unset. */
  ppnRates: PpnRates | null;
};

/** Why a customer cannot be ordered for, or an empty list. */
function customerProblems(c: {
  status: string;
  taxpayer_type: string | null;
  tax_id_type: string | null;
  tax_id: string | null;
  tax_name: string | null;
  _count: { addresses: number };
}): string[] {
  const out: string[] = [];
  if (c.status !== "Active") out.push("Customer nonaktif.");
  if (!c.taxpayer_type || !c.tax_id_type || !c.tax_id || !c.tax_name) {
    out.push("Data Pajak customer belum lengkap — lengkapi tab Pajak pada Partner.");
  }
  if (c._count.addresses === 0) out.push("Customer belum memiliki alamat.");
  return out;
}

export async function salesOrderOptions(): Promise<SalesOrderOptions> {
  const [partners, items, terms, warehouses, taxes, rates] = await Promise.all([
    prisma.mPartner.findMany({
      where: { category: { category_label: CUSTOMER_CATEGORY } },
      orderBy: { partner_label: "asc" },
      include: {
        _count: { select: { addresses: true } },
        addresses: {
          orderBy: [{ sort_order: "asc" }, { id: "asc" }],
          include: { village: { include: { district: { include: { city: { include: { province: true } } } } } } },
        },
      },
    }),
    prisma.mItem.findMany({
      where: { item_type: "Barang", can_sell: true },
      orderBy: { item_label: "asc" },
      include: { base_uom: true, uoms: { include: { uom: true }, orderBy: [{ sort_order: "asc" }, { id: "asc" }] } },
    }),
    prisma.refPaymentTerm.findMany({ orderBy: { due_days: "asc" } }),
    prisma.refWarehouse.findMany({ orderBy: { warehouse_label: "asc" } }),
    prisma.refWithholdingTax.findMany({ orderBy: { wht_label: "asc" } }),
    ppnRates(),
  ]);

  return {
    customers: partners.map((p) => ({
      id: p.id,
      label: p.partner_label,
      name: p.partner_name,
      active: p.status === "Active",
      addresses: p.addresses.map((a) => {
        const d = a.village.district;
        return {
          id: a.id,
          text: formatAddress({
            provinceName: d.city.province.name,
            cityName: d.city.name,
            districtName: d.name,
            villageName: a.village.name,
            street: a.street,
            postalCode: a.village.postal_code ?? "",
          }),
          isBilling: a.is_billing,
          isShipping: a.is_shipping,
        };
      }),
      defaultTermId: p.default_term_id,
      defaultPriceMode: p.default_price_mode,
      collectsPph22: p.collects_pph22,
      vatCollector: p.vat_collector === "Government",
      isPkp: p.is_pkp,
      taxIdType: p.tax_id_type,
      taxId: p.tax_id,
      problems: customerProblems(p),
    })),
    items: items.map((i) => ({
      id: i.id,
      label: i.item_label,
      name: i.item_name,
      active: i.status === "Active",
      uoms: [
        { id: i.base_uom.id, label: i.base_uom.uom_label, name: i.base_uom.uom_name, factor: 1 },
        ...i.uoms.map((u) => ({ id: u.uom.id, label: u.uom.uom_label, name: u.uom.uom_name, factor: u.factor.toNumber() })),
      ],
    })),
    terms: terms.map((t) => ({ id: t.id, label: t.term_label, name: t.term_name, active: t.status === "Active" })),
    warehouses: warehouses.map((w) => ({
      id: w.id,
      label: w.warehouse_label,
      name: w.warehouse_name,
      active: w.status === "Active",
    })),
    withholdingTaxes: taxes.map((t) => ({
      id: t.id,
      label: t.wht_label,
      name: t.wht_name,
      active: t.status === "Active",
      rate: t.rate.toNumber(),
    })),
    ppnRates: rates,
  };
}

// ------------------------------------------------------------- validation

type CheckedLine = {
  line_no: number;
  item_id: number;
  uom_id: number;
  uom_factor: number;
  qty: number;
  price: number;
  discount_type: DiscountType | null;
  discount_value: number | null;
  withholding_tax_id: number | null;
  withholding_rate: number | null;
  note: string | null;
};

export type SalesOrderCheck =
  | {
      ok: true;
      header: {
        order_date: Date;
        customer_id: number;
        address_id: number;
        term_id: number;
        warehouse_id: number;
        price_mode: PriceMode;
        is_taxable: boolean;
        po_no: string | null;
        po_date: Date | null;
        requested_date: Date;
        salesperson: string | null;
        note: string | null;
      };
      lines: CheckedLine[];
      totals: SalesTotals;
      /** The snapshot the totals were computed with; null when not Kena PPN. */
      rates: PpnRates | null;
    }
  | { ok: false; errors: Record<string, string> };

/**
 * Every rule a Sales Order must satisfy to be saved — and, run again against
 * what was stored, to be confirmed. The form narrows the same choices; this is
 * what enforces them.
 */
export async function checkSalesOrder(
  header: SalesOrderHeaderInput,
  lines: SalesOrderLineInput[]
): Promise<SalesOrderCheck> {
  const errors: Record<string, string> = {};

  // ---- dates
  const orderDate = String(header.order_date ?? "").trim();
  const reqDate = String(header.requested_date ?? "").trim();
  const poDate = String(header.po_date ?? "").trim();
  if (!DAY.test(orderDate)) errors.order_date = "Tanggal SO wajib diisi.";
  if (!DAY.test(reqDate)) errors.requested_date = "Tanggal kirim yang diminta wajib diisi.";
  else if (DAY.test(orderDate) && reqDate < orderDate) {
    errors.requested_date = "Tidak boleh sebelum tanggal SO.";
  }
  if (poDate && !DAY.test(poDate)) errors.po_date = "Tanggal PO tidak valid.";
  else if (poDate && DAY.test(orderDate) && poDate > orderDate) {
    errors.po_date = "Tidak boleh setelah tanggal SO.";
  }

  // ---- customer and what hangs off it
  const customerId = Number(header.customer_id) || null;
  let vatCollector = false;
  if (!customerId) errors.customer_id = "Pilih Customer.";
  else {
    const c = await prisma.mPartner.findUnique({
      where: { id: customerId },
      include: { category: true, _count: { select: { addresses: true } } },
    });
    if (!c || c.category.category_label !== CUSTOMER_CATEGORY) {
      errors.customer_id = "Partner ini bukan Customer.";
    } else {
      const problems = customerProblems(c);
      if (problems.length) errors.customer_id = problems.join(" ");
      vatCollector = c.vat_collector === "Government";
    }

    const addressId = Number(header.address_id) || null;
    if (!addressId) errors.address_id = "Pilih alamat.";
    else {
      const a = await prisma.mPartnerAddress.findUnique({ where: { id: addressId }, select: { partner_id: true } });
      if (!a || a.partner_id !== customerId) errors.address_id = "Alamat ini bukan milik customer yang dipilih.";
    }
  }

  const termId = Number(header.term_id) || null;
  if (!termId) errors.term_id = "Pilih Termin Pembayaran.";
  else {
    const t = await prisma.refPaymentTerm.findUnique({ where: { id: termId }, select: { status: true } });
    if (!t) errors.term_id = "Termin tidak ditemukan.";
    else if (t.status !== "Active") errors.term_id = "Termin tersebut sudah nonaktif.";
  }

  const warehouseId = Number(header.warehouse_id) || null;
  if (!warehouseId) errors.warehouse_id = "Pilih Gudang.";
  else {
    const w = await prisma.refWarehouse.findUnique({ where: { id: warehouseId }, select: { status: true } });
    if (!w) errors.warehouse_id = "Gudang tidak ditemukan.";
    else if (w.status !== "Active") errors.warehouse_id = "Gudang tersebut sudah nonaktif.";
  }

  const mode = header.price_mode;
  if (mode !== "Exclude" && mode !== "Include") errors.price_mode = "Pilih mode harga.";

  // ---- lines
  const checked: CheckedLine[] = [];
  if (!lines.length) errors._lines = "Tambahkan minimal satu barang.";

  const itemIds = [...new Set(lines.map((l) => Number(l.item_id)).filter(Boolean))];
  const items = new Map(
    (
      await prisma.mItem.findMany({
        where: { id: { in: itemIds } },
        include: { uoms: true },
      })
    ).map((i) => [i.id, i])
  );
  const whtIds = [...new Set(lines.map((l) => Number(l.withholding_tax_id)).filter(Boolean))];
  const taxes = new Map(
    (await prisma.refWithholdingTax.findMany({ where: { id: { in: whtIds } } })).map((t) => [t.id, t])
  );

  for (const [i, l] of lines.entries()) {
    const item = items.get(Number(l.item_id));
    if (!item) {
      errors[lineKey(i, "item_id")] = "Barang tidak ditemukan.";
      continue;
    }
    if (item.item_type !== "Barang" || !item.can_sell) {
      errors[lineKey(i, "item_id")] = `${item.item_label} bukan barang yang dapat dijual.`;
      continue;
    }
    if (item.status !== "Active") {
      errors[lineKey(i, "item_id")] = `${item.item_label} sudah nonaktif.`;
      continue;
    }

    const uomId = Number(l.uom_id);
    const factor =
      uomId === item.base_uom_id ? 1 : item.uoms.find((u) => u.uom_id === uomId)?.factor.toNumber();
    if (!factor) {
      errors[lineKey(i, "uom_id")] = "Satuan ini tidak berlaku untuk barang tersebut.";
      continue;
    }

    const discountType =
      l.discount_type === "Percent" || l.discount_type === "Amount" ? (l.discount_type as DiscountType) : null;
    const discountValue = discountType ? Number(l.discount_value) || 0 : null;
    const problem = lineProblem({ qty: Number(l.qty), price: Number(l.price), discountType, discountValue });
    if (problem) {
      errors[lineKey(i, "amount")] = problem;
      continue;
    }

    let whtId: number | null = Number(l.withholding_tax_id) || null;
    let whtRate: number | null = null;
    if (whtId) {
      const t = taxes.get(whtId);
      if (!t || t.status !== "Active") {
        errors[lineKey(i, "withholding_tax_id")] = "Jenis PPh tidak ditemukan atau nonaktif.";
        continue;
      }
      whtRate = t.rate.toNumber();
    } else whtId = null;

    checked.push({
      line_no: i + 1,
      item_id: item.id,
      uom_id: uomId,
      uom_factor: factor,
      qty: Number(l.qty),
      price: Number(l.price),
      discount_type: discountType,
      discount_value: discountValue,
      withholding_tax_id: whtId,
      withholding_rate: whtRate,
      note: String(l.note ?? "").trim() || null,
    });
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) {
    errors._lines = "Ada baris yang perlu diperbaiki.";
  }

  // A taxable order snapshots the PPN rate and factor in force (P60); without
  // them there is nothing to compute its PPN with, so it is refused by name.
  const taxable = header.is_taxable !== false;
  const rates = taxable ? await ppnRates() : null;
  if (taxable && !rates) errors._form = PPN_SETTINGS_MISSING;

  if (Object.keys(errors).length) return { ok: false, errors };

  const totals = computeSalesTotals({
    lines: checked.map((l) => ({
      qty: l.qty,
      price: l.price,
      discountType: l.discount_type,
      discountValue: l.discount_value,
      withholdingRate: l.withholding_rate,
      withholdingKey: l.withholding_tax_id ? String(l.withholding_tax_id) : null,
    })),
    mode: mode as PriceMode,
    taxable,
    vatCollector,
    rates,
  });

  return {
    ok: true,
    header: {
      order_date: asDate(orderDate),
      customer_id: customerId!,
      address_id: Number(header.address_id),
      term_id: termId!,
      warehouse_id: warehouseId!,
      price_mode: mode as PriceMode,
      is_taxable: header.is_taxable !== false,
      po_no: String(header.po_no ?? "").trim() || null,
      po_date: poDate ? asDate(poDate) : null,
      requested_date: asDate(reqDate),
      salesperson: String(header.salesperson ?? "").trim() || null,
      note: String(header.note ?? "").trim() || null,
    },
    lines: checked,
    totals,
    rates,
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

function rateData(r: PpnRates | null) {
  return {
    ppn_rate: r?.rate ?? null,
    ppn_dpp_other_numerator: r?.otherNum ?? null,
    ppn_dpp_other_denominator: r?.otherDen ?? null,
  };
}

function totalsData(t: SalesTotals) {
  return {
    gross_amount: t.gross,
    discount_amount: t.discount,
    dpp_amount: t.dpp,
    dpp_other_amount: t.dppOther,
    ppn_amount: t.ppn,
    total_amount: t.total,
  };
}

function lineData(l: CheckedLine, t: SalesTotals, i: number) {
  const r = t.lines[i];
  return {
    line_no: l.line_no,
    item_id: l.item_id,
    uom_id: l.uom_id,
    uom_factor: l.uom_factor,
    qty: l.qty,
    price: l.price,
    discount_type: l.discount_type,
    discount_value: l.discount_value,
    discount_amount: r.discount,
    amount: r.amount,
    dpp_amount: r.dpp,
    dpp_other_amount: r.dppOther,
    ppn_amount: r.ppn,
    withholding_tax_id: l.withholding_tax_id,
    withholding_rate: l.withholding_rate,
    note: l.note,
  };
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "sal_order", row_id: id, action, event, by } });
}

export async function createSalesOrder(
  header: SalesOrderHeaderInput,
  lines: SalesOrderLineInput[],
  actorId: number,
  copiedFromId: number | null = null
): Promise<SalesOrderResult> {
  const c = await checkSalesOrder(header, lines);
  if (!c.ok) return c;

  const made = await prisma.$transaction(async (tx) => {
    const order = await tx.salOrder.create({
      data: {
        ...c.header,
        ...totalsData(c.totals),
        ...rateData(c.rates),
        order_no: await nextOrderNo(tx, c.header.order_date),
        copied_from_id: copiedFromId,
        created_by: actorId,
        lines: { create: c.lines.map((l, i) => lineData(l, c.totals, i)) },
      },
    });
    await audit(tx, order.id, "TAMBAH", "create", actorId);
    return order;
  });
  return { ok: true, id: made.id, orderNo: made.order_no };
}

export async function updateSalesOrder(
  id: number,
  header: SalesOrderHeaderInput,
  lines: SalesOrderLineInput[],
  actorId: number
): Promise<SalesOrderResult> {
  const current = await prisma.salOrder.findUnique({ where: { id }, select: { status: true, order_no: true } });
  if (!current) return { ok: false, errors: { _form: "Sales Order tidak ditemukan." } };
  if (!salesOrderIsEditable(current.status as SalesOrderStatus)) {
    return { ok: false, errors: { _form: "Sales Order yang sudah dikonfirmasi atau dibatalkan tidak dapat diubah." } };
  }

  const c = await checkSalesOrder(header, lines);
  if (!c.ok) return c;

  await prisma.$transaction(async (tx) => {
    // A Draft's lines are nobody's reference yet, so they are replaced whole.
    await tx.salOrderLine.deleteMany({ where: { order_id: id } });
    await tx.salOrder.update({
      where: { id },
      data: {
        ...c.header,
        ...totalsData(c.totals),
        ...rateData(c.rates),
        updated_by: actorId,
        lines: { create: c.lines.map((l, i) => lineData(l, c.totals, i)) },
      },
    });
    await audit(tx, id, "UPDATE", "update", actorId);
  });
  return { ok: true, id, orderNo: current.order_no };
}

/** A stored order, back in the shape `checkSalesOrder` reads. */
function asInput(o: Prisma.SalOrderGetPayload<{ include: { lines: true } }>) {
  const header: SalesOrderHeaderInput = {
    order_date: isoDay(o.order_date),
    customer_id: o.customer_id,
    address_id: o.address_id,
    term_id: o.term_id,
    warehouse_id: o.warehouse_id,
    price_mode: o.price_mode,
    is_taxable: o.is_taxable,
    po_no: o.po_no ?? "",
    po_date: isoDay(o.po_date),
    requested_date: isoDay(o.requested_date),
    salesperson: o.salesperson ?? "",
    note: o.note ?? "",
  };
  const lines: SalesOrderLineInput[] = [...o.lines]
    .sort((a, b) => a.line_no - b.line_no)
    .map((l) => ({
      item_id: l.item_id,
      uom_id: l.uom_id,
      qty: l.qty.toNumber(),
      price: l.price.toNumber(),
      discount_type: l.discount_type,
      discount_value: l.discount_value?.toNumber() ?? null,
      withholding_tax_id: l.withholding_tax_id,
      note: l.note ?? "",
    }));
  return { header, lines };
}

/**
 * Why an order cannot be cancelled because of its advance bills, or null.
 * Counted through the order's own relation, so this module never names the
 * advance's table (the way `partner.ts` protects a used address).
 */
async function liveAdvanceRefusal(db: Db, id: number): Promise<string | null> {
  const row = await db.salOrder.findUnique({
    where: { id },
    select: { _count: { select: { advances: { where: { status: { not: "Cancelled" } } } } } },
  });
  const n = row?._count.advances ?? 0;
  return n
    ? `Sales Order ini masih memiliki ${n} tagihan uang muka yang belum dibatalkan. Batalkan tagihan uang muka tersebut dulu.`
    : null;
}

export type SalesOrderTransitionResult =
  | { ok: true }
  | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle step. Confirming re-checks the stored order against
 * today's masters — a customer, item or Jenis PPh deactivated since the draft
 * was saved stops the confirmation, by name — and stores the totals that
 * check produced, so the confirmed figures are the ones it was confirmed on.
 */
export async function transitionSalesOrder(
  id: number,
  action: SalesOrderAction,
  actorId: number,
  reason?: string
): Promise<SalesOrderTransitionResult> {
  const order = await prisma.salOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!order) return { ok: false, errors: { _form: "Sales Order tidak ditemukan." } };
  const t = SALES_ORDER_TRANSITIONS[action];
  if (!salesOrderTransitionAllowed(action, order.status as SalesOrderStatus)) {
    return { ok: false, errors: { _form: `Sales Order berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }

  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan pembatalan wajib diisi." } };
    // An order with a live advance bill is not cancelled: the bill is
    // cancelled first (P57). Asked again inside the transaction, after the
    // row is locked by the update, so a bill issued meanwhile is seen.
    const blocked = await liveAdvanceRefusal(prisma, id);
    if (blocked) return { ok: false, errors: { _form: blocked } };
    await prisma.$transaction(async (tx) => {
      // Conditional on the status just read, so two people cancelling or
      // confirming at once cannot both succeed.
      const done = await tx.salOrder.updateMany({
        where: { id, status: order.status },
        data: { status: "Cancelled", cancel_reason: why, updated_by: actorId },
      });
      if (done.count !== 1) throw new Error("Sales Order berubah saat diproses. Muat ulang halaman.");
      const late = await liveAdvanceRefusal(tx, id);
      if (late) throw new Error(late);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const input = asInput(order);
  const c = await checkSalesOrder(input.header, input.lines);
  if (!c.ok) {
    const first = Object.entries(c.errors).find(([k]) => k !== "_lines")?.[1] ?? c.errors._lines;
    return { ok: false, errors: { _form: `Belum bisa dikonfirmasi: ${first}` } };
  }
  await prisma.$transaction(async (tx) => {
    const done = await tx.salOrder.updateMany({
      where: { id, status: "Draft" },
      data: { status: "Confirmed", ...totalsData(c.totals), ...rateData(c.rates), updated_by: actorId },
    });
    if (done.count !== 1) throw new Error("Sales Order berubah saat diproses. Muat ulang halaman.");
    // Konfirmasi freezes the snapshot (P60): the lines are restated with the
    // rate in force now, in case the setting changed since the Draft was saved.
    for (const [i, l] of c.lines.entries()) {
      const r = c.totals.lines[i];
      await tx.salOrderLine.updateMany({
        where: { order_id: id, line_no: l.line_no },
        data: { dpp_amount: r.dpp, dpp_other_amount: r.dppOther, ppn_amount: r.ppn, withholding_rate: l.withholding_rate },
      });
    }
    await audit(tx, id, "UPDATE", "confirm", actorId);
  });
  return { ok: true };
}

// ------------------------------------------------------------------- reads

export type SalesOrderListRow = {
  id: number;
  orderNo: string;
  orderDate: string;
  customerLabel: string;
  customerName: string;
  total: number;
  status: SalesOrderStatus;
  lines: number;
};

export async function listSalesOrders(): Promise<SalesOrderListRow[]> {
  const rows = await prisma.salOrder.findMany({
    orderBy: [{ order_date: "desc" }, { id: "desc" }],
    include: { customer: true, _count: { select: { lines: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    orderNo: r.order_no,
    orderDate: isoDay(r.order_date),
    customerLabel: r.customer.partner_label,
    customerName: r.customer.partner_name,
    total: r.total_amount.toNumber(),
    status: r.status as SalesOrderStatus,
    lines: r._count.lines,
  }));
}

export type SalesOrderLineView = SalesOrderLineInput & {
  itemLabel: string;
  itemName: string;
  uomLabel: string;
  uomFactor: number;
  withholdingLabel: string | null;
  withholdingRate: number | null;
  amount: number;
  discountAmount: number;
};

export type SalesOrderView = {
  id: number;
  orderNo: string;
  status: SalesOrderStatus;
  header: SalesOrderHeaderInput;
  lines: SalesOrderLineView[];
  customerLabel: string;
  customerName: string;
  addressText: string;
  termLabel: string;
  termName: string;
  warehouseLabel: string;
  warehouseName: string;
  cancelReason: string | null;
  copiedFrom: { id: number; orderNo: string } | null;
  totals: { gross: number; discount: number; dpp: number; dppOther: number; ppn: number; total: number };
  /** The PPN rate and factor the order carries (P60); null when not Kena PPN. */
  rates: PpnRates | null;
};

export async function getSalesOrder(id: number): Promise<SalesOrderView | null> {
  const o = await prisma.salOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      term: true,
      warehouse: true,
      copied_from: { select: { id: true, order_no: true } },
      address: { include: { village: { include: { district: { include: { city: { include: { province: true } } } } } } } },
      lines: { include: { item: true, uom: true, withholding_tax: true }, orderBy: { line_no: "asc" } },
    },
  });
  if (!o) return null;
  const input = asInput(o);
  const d = o.address.village.district;
  return {
    id: o.id,
    orderNo: o.order_no,
    status: o.status as SalesOrderStatus,
    header: input.header,
    lines: o.lines.map((l, i) => ({
      ...input.lines[i],
      itemLabel: l.item.item_label,
      itemName: l.item.item_name,
      uomLabel: l.uom.uom_label,
      uomFactor: l.uom_factor.toNumber(),
      withholdingLabel: l.withholding_tax?.wht_label ?? null,
      withholdingRate: l.withholding_rate?.toNumber() ?? null,
      amount: l.amount.toNumber(),
      discountAmount: l.discount_amount.toNumber(),
    })),
    customerLabel: o.customer.partner_label,
    customerName: o.customer.partner_name,
    addressText: formatAddress({
      provinceName: d.city.province.name,
      cityName: d.city.name,
      districtName: d.name,
      villageName: o.address.village.name,
      street: o.address.street,
      postalCode: o.address.village.postal_code ?? "",
    }),
    termLabel: o.term.term_label,
    termName: o.term.term_name,
    warehouseLabel: o.warehouse.warehouse_label,
    warehouseName: o.warehouse.warehouse_name,
    cancelReason: o.cancel_reason,
    copiedFrom: o.copied_from ? { id: o.copied_from.id, orderNo: o.copied_from.order_no } : null,
    totals: {
      gross: o.gross_amount.toNumber(),
      discount: o.discount_amount.toNumber(),
      dpp: o.dpp_amount.toNumber(),
      dppOther: o.dpp_other_amount.toNumber(),
      ppn: o.ppn_amount.toNumber(),
      total: o.total_amount.toNumber(),
    },
    rates: ratesOf(o),
  };
}

/** A stored snapshot back as rates, or null when the document has none. */
function ratesOf(o: {
  ppn_rate: Prisma.Decimal | null;
  ppn_dpp_other_numerator: number | null;
  ppn_dpp_other_denominator: number | null;
}): PpnRates | null {
  return o.ppn_rate && o.ppn_dpp_other_numerator && o.ppn_dpp_other_denominator
    ? { rate: o.ppn_rate.toNumber(), otherNum: o.ppn_dpp_other_numerator, otherDen: o.ppn_dpp_other_denominator }
    : null;
}

/** Order numbers by id, for the audit panel. */
export async function salesOrderNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.salOrder.findMany({
    where: { id: { in: ids } },
    select: { id: true, order_no: true },
  });
  return new Map(rows.map((r) => [r.id, r.order_no]));
}

// ------------------------------------------------------ for the advance bill

/**
 * A Sales Order as an advance bill reads it (P54): who it is for, where it is
 * billed, and the basis the advance is drawn from — the order's DPP, total,
 * mode and, per Jenis PPh on its lines, the DPP that Jenis PPh covers. The
 * advance module takes this rather than reading `sal_order` itself.
 */
export type AdvanceSourceOrder = {
  id: number;
  orderNo: string;
  orderDate: string;
  status: SalesOrderStatus;
  customerId: number;
  customerLabel: string;
  customerName: string;
  customerActive: boolean;
  taxIdType: string | null;
  taxId: string | null;
  isPkp: boolean;
  collectsPph22: boolean;
  addressText: string;
  poNo: string | null;
  basis: AdvanceBasis;
  /** Jenis PPh label by the basis's withholding key. */
  withholdingLabels: Record<string, string>;
};

/** Confirmed orders, or the ones named — any status — for a stored bill. */
export async function advanceSourceOrders(
  filter: { ids?: number[]; confirmedOnly?: boolean },
  db: Db = prisma
): Promise<AdvanceSourceOrder[]> {
  const rows = await db.salOrder.findMany({
    where: {
      ...(filter.ids ? { id: { in: filter.ids } } : {}),
      ...(filter.confirmedOnly ? { status: "Confirmed" } : {}),
    },
    orderBy: [{ order_date: "desc" }, { id: "desc" }],
    include: {
      customer: true,
      address: { include: { village: { include: { district: { include: { city: { include: { province: true } } } } } } } },
      lines: { include: { withholding_tax: true } },
    },
  });
  return rows.map((o) => {
    const groups = new Map<string, { key: string; rate: number; base: number }>();
    const labels: Record<string, string> = {};
    for (const l of o.lines) {
      if (!l.withholding_tax_id || !l.withholding_rate) continue;
      const key = String(l.withholding_tax_id);
      const g = groups.get(key) ?? { key, rate: l.withholding_rate.toNumber(), base: 0 };
      g.base += l.dpp_amount.toNumber();
      groups.set(key, g);
      labels[key] = l.withholding_tax?.wht_label ?? "PPh";
    }
    const d = o.address.village.district;
    return {
      id: o.id,
      orderNo: o.order_no,
      orderDate: isoDay(o.order_date),
      status: o.status as SalesOrderStatus,
      customerId: o.customer_id,
      customerLabel: o.customer.partner_label,
      customerName: o.customer.partner_name,
      customerActive: o.customer.status === "Active",
      taxIdType: o.customer.tax_id_type,
      taxId: o.customer.tax_id,
      isPkp: o.customer.is_pkp,
      collectsPph22: o.customer.collects_pph22,
      addressText: formatAddress({
        provinceName: d.city.province.name,
        cityName: d.city.name,
        districtName: d.name,
        villageName: o.address.village.name,
        street: o.address.street,
        postalCode: o.address.village.postal_code ?? "",
      }),
      poNo: o.po_no,
      basis: {
        mode: o.price_mode as PriceMode,
        taxable: o.is_taxable,
        vatCollector: o.customer.vat_collector === "Government",
        dpp: o.dpp_amount.toNumber(),
        total: o.total_amount.toNumber(),
        withholdings: [...groups.values()],
      },
      withholdingLabels: labels,
    };
  });
}

/**
 * Locks an order's row for the rest of the transaction, so an advance drawn
 * from it and a cancellation of it cannot pass each other (P57), and two bills
 * cannot both spend the same room.
 */
export async function lockSalesOrder(tx: Prisma.TransactionClient, id: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM sal_order WHERE id = ${id} FOR UPDATE`;
}
