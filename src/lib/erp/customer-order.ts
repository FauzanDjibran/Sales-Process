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
  CUSTOMER_ORDER_TRANSITIONS,
  customerOrderIsEditable,
  customerOrderTransitionAllowed,
  type CustomerOrderAction,
  type CustomerOrderStatus,
} from "./customer-order-workflow";

/**
 * The Customer Order module (Claude-ERP.md P49–P53): its tables are `sal_customer_order`
 * and `sal_customer_order_line`, and nothing else names them.
 *
 * A Customer Order posts nothing. It is a record of what the customer ordered,
 * at what price, under which tax treatment (P78) — the basis the advance bill
 * and, later, the Invoice draw from, and the order the Sales Orders release to
 * PPIC in dated parts (P79). Everything the form shows as a figure comes
 * from `sales-tax.ts`, the same module the save below stores from.
 *
 * The rules live here rather than in the Server Action so the test suite can
 * exercise them: an action resolves its caller from a session cookie, and a
 * test has none.
 */

type Db = Prisma.TransactionClient | typeof prisma;

// ------------------------------------------------------------------ input

export type CustomerOrderHeaderInput = {
  order_date: string;
  customer_id: number | null;
  address_id: number | null;
  term_id: number | null;
  price_mode: string;
  is_taxable: boolean;
  po_no: string;
  po_date: string;
  salesperson: string;
  note: string;
};

export type CustomerOrderLineInput = {
  item_id: number | null;
  uom_id: number | null;
  qty: number;
  price: number;
  discount_type: string | null;
  discount_value: number | null;
  withholding_tax_id: number | null;
  note: string;
};

export type CustomerOrderResult =
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
  /** What keeps this customer off a Customer Order, in words. Empty when usable. */
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

export type CustomerOrderOptions = {
  customers: SoCustomerOption[];
  items: SoItemOption[];
  terms: SoRefOption[];
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

export async function customerOrderOptions(): Promise<CustomerOrderOptions> {
  const [partners, items, terms, taxes, rates] = await Promise.all([
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

export type CustomerOrderCheck =
  | {
      ok: true;
      header: {
        order_date: Date;
        customer_id: number;
        address_id: number;
        term_id: number;
        price_mode: PriceMode;
        is_taxable: boolean;
        po_no: string | null;
        po_date: Date | null;
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
 * Every rule a Customer Order must satisfy to be saved — and, run again against
 * what was stored, to be submitted. The form narrows the same choices; this is
 * what enforces them.
 */
export async function checkCustomerOrder(
  header: CustomerOrderHeaderInput,
  lines: CustomerOrderLineInput[]
): Promise<CustomerOrderCheck> {
  const errors: Record<string, string> = {};

  // ---- dates
  const orderDate = String(header.order_date ?? "").trim();
  const poDate = String(header.po_date ?? "").trim();
  if (!DAY.test(orderDate)) errors.order_date = "Tanggal CO wajib diisi.";
  if (poDate && !DAY.test(poDate)) errors.po_date = "Tanggal PO tidak valid.";
  else if (poDate && DAY.test(orderDate) && poDate > orderDate) {
    errors.po_date = "Tidak boleh setelah tanggal CO.";
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

  // Include / Exclude is a question only a taxable order asks (P63): an order
  // without PPN has nothing to include, so it is stored as Exclude.
  const taxable = header.is_taxable !== false;
  const mode = taxable ? header.price_mode : "Exclude";
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
      errors[lineKey(i, "item_id")] = l.item_id ? "Barang tidak ditemukan." : "Pilih barang.";
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
      price_mode: mode as PriceMode,
      is_taxable: taxable,
      po_no: String(header.po_no ?? "").trim() || null,
      po_date: poDate ? asDate(poDate) : null,
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
  return nextDocumentNumber("CO", date, async (series) => {
    const row = await db.salCustomerOrder.findFirst({
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
  await db.auditLog.create({ data: { entity_key: "sal_customer_order", row_id: id, action, event, by } });
}

export async function createCustomerOrder(
  header: CustomerOrderHeaderInput,
  lines: CustomerOrderLineInput[],
  actorId: number,
  copiedFromId: number | null = null
): Promise<CustomerOrderResult> {
  const c = await checkCustomerOrder(header, lines);
  if (!c.ok) return c;

  const made = await prisma.$transaction(async (tx) => {
    const order = await tx.salCustomerOrder.create({
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

export async function updateCustomerOrder(
  id: number,
  header: CustomerOrderHeaderInput,
  lines: CustomerOrderLineInput[],
  actorId: number
): Promise<CustomerOrderResult> {
  const current = await prisma.salCustomerOrder.findUnique({ where: { id }, select: { status: true, order_no: true } });
  if (!current) return { ok: false, errors: { _form: "Customer Order tidak ditemukan." } };
  if (!customerOrderIsEditable(current.status as CustomerOrderStatus)) {
    return { ok: false, errors: { _form: "Hanya Customer Order berstatus Draft yang dapat diubah." } };
  }

  const c = await checkCustomerOrder(header, lines);
  if (!c.ok) return c;

  await prisma.$transaction(async (tx) => {
    // A Draft's lines are nobody's reference yet, so they are replaced whole.
    await tx.salCustomerOrderLine.deleteMany({ where: { order_id: id } });
    await tx.salCustomerOrder.update({
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

/** A stored order, back in the shape `checkCustomerOrder` reads. */
function asInput(o: Prisma.SalCustomerOrderGetPayload<{ include: { lines: true } }>) {
  const header: CustomerOrderHeaderInput = {
    order_date: isoDay(o.order_date),
    customer_id: o.customer_id,
    address_id: o.address_id,
    term_id: o.term_id,
    price_mode: o.price_mode,
    is_taxable: o.is_taxable,
    po_no: o.po_no ?? "",
    po_date: isoDay(o.po_date),
    salesperson: o.salesperson ?? "",
    note: o.note ?? "",
  };
  const lines: CustomerOrderLineInput[] = [...o.lines]
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

export type CustomerOrderTransitionResult =
  | { ok: true }
  | { ok: false; errors: Record<string, string> };

/** The event name each step writes to the audit log. */
const STEP_EVENT: Record<CustomerOrderAction, string> = {
  submit: "submit",
  approve: "approve",
  reject: "reject",
  cancel: "cancel",
  close: "close",
};

/**
 * Runs one lifecycle step (P63).
 *
 * **Ajukan** re-checks the stored order against today's masters — a customer,
 * item or Jenis PPh deactivated since the draft was saved stops it, by name —
 * and stores the totals that check produced, with the PPN rate in force, so the
 * submitted figures are frozen as they were submitted (P60). Setujui changes
 * only the status: nothing the order carries moves after Ajukan.
 *
 * Tolak, Batalkan and Tutup Pesanan ask for a reason, stored in
 * `status_reason`. Every step is conditional on the status just read, so two
 * people acting on the same order at once cannot both succeed.
 */
export async function transitionCustomerOrder(
  id: number,
  action: CustomerOrderAction,
  actorId: number,
  reason?: string,
  /**
   * Run inside the step's transaction with the order's row locked, before it
   * moves; a message refuses the step. Tutup Pesanan is handed the Sales Order
   * module's check by the caller (P79), so this module never reads its tables.
   */
  guard?: (tx: Prisma.TransactionClient, id: number) => Promise<string | null>
): Promise<CustomerOrderTransitionResult> {
  const order = await prisma.salCustomerOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!order) return { ok: false, errors: { _form: "Customer Order tidak ditemukan." } };
  const t = CUSTOMER_ORDER_TRANSITIONS[action];
  if (!customerOrderTransitionAllowed(action, order.status as CustomerOrderStatus)) {
    return { ok: false, errors: { _form: `Customer Order berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  const from = order.status;
  const moved = "Customer Order berubah saat diproses. Muat ulang halaman.";

  if (t.reason) {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
    let refused: string | null = null;
    await prisma.$transaction(async (tx) => {
      if (guard) {
        await lockCustomerOrder(tx, id);
        refused = await guard(tx, id);
        if (refused) return;
      }
      const done = await tx.salCustomerOrder.updateMany({
        where: { id, status: from },
        data: { status: t.to, status_reason: why, updated_by: actorId },
      });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", STEP_EVENT[action], actorId);
    });
    return refused ? { ok: false, errors: { _form: refused } } : { ok: true };
  }

  if (action === "approve") {
    await prisma.$transaction(async (tx) => {
      const done = await tx.salCustomerOrder.updateMany({
        where: { id, status: from },
        data: { status: t.to, updated_by: actorId },
      });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", STEP_EVENT[action], actorId);
    });
    return { ok: true };
  }

  const input = asInput(order);
  const c = await checkCustomerOrder(input.header, input.lines);
  if (!c.ok) {
    const first = Object.entries(c.errors).find(([k]) => k !== "_lines")?.[1] ?? c.errors._lines;
    return { ok: false, errors: { _form: `Belum bisa diajukan: ${first}` } };
  }
  await prisma.$transaction(async (tx) => {
    const done = await tx.salCustomerOrder.updateMany({
      where: { id, status: from },
      data: { status: t.to, ...totalsData(c.totals), ...rateData(c.rates), updated_by: actorId },
    });
    if (done.count !== 1) throw new Error(moved);
    // Ajukan freezes the snapshot (P60): the lines are restated with the rate
    // in force now, in case the setting changed since the Draft was saved.
    for (const [i, l] of c.lines.entries()) {
      const r = c.totals.lines[i];
      await tx.salCustomerOrderLine.updateMany({
        where: { order_id: id, line_no: l.line_no },
        data: { dpp_amount: r.dpp, dpp_other_amount: r.dppOther, ppn_amount: r.ppn, withholding_rate: l.withholding_rate },
      });
    }
    await audit(tx, id, "UPDATE", STEP_EVENT[action], actorId);
  });
  return { ok: true };
}

// ------------------------------------------------------------------- reads

export type CustomerOrderListRow = {
  id: number;
  orderNo: string;
  orderDate: string;
  customerLabel: string;
  customerName: string;
  total: number;
  status: CustomerOrderStatus;
  lines: number;
};

export async function listCustomerOrders(): Promise<CustomerOrderListRow[]> {
  const rows = await prisma.salCustomerOrder.findMany({
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
    status: r.status as CustomerOrderStatus,
    lines: r._count.lines,
  }));
}

export type CustomerOrderLineView = CustomerOrderLineInput & {
  itemLabel: string;
  itemName: string;
  uomLabel: string;
  uomFactor: number;
  withholdingLabel: string | null;
  withholdingRate: number | null;
  amount: number;
  discountAmount: number;
};

export type CustomerOrderView = {
  id: number;
  orderNo: string;
  status: CustomerOrderStatus;
  header: CustomerOrderHeaderInput;
  lines: CustomerOrderLineView[];
  customerLabel: string;
  customerName: string;
  addressText: string;
  termLabel: string;
  termName: string;
  /** Why it was cancelled, rejected or closed by hand (P63). */
  statusReason: string | null;
  copiedFrom: { id: number; orderNo: string } | null;
  totals: { gross: number; discount: number; dpp: number; dppOther: number; ppn: number; total: number };
  /** The PPN rate and factor the order carries (P60); null when not Kena PPN. */
  rates: PpnRates | null;
};

export async function getCustomerOrder(id: number): Promise<CustomerOrderView | null> {
  const o = await prisma.salCustomerOrder.findUnique({
    where: { id },
    include: {
      customer: true,
      term: true,
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
    status: o.status as CustomerOrderStatus,
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
    statusReason: o.status_reason,
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
export async function customerOrderNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.salCustomerOrder.findMany({
    where: { id: { in: ids } },
    select: { id: true, order_no: true },
  });
  return new Map(rows.map((r) => [r.id, r.order_no]));
}

// ------------------------------------------------------ for the advance bill

/**
 * A Customer Order as an advance bill reads it (P54): who it is for, where it is
 * billed, and the basis the advance is drawn from — the order's DPP, total,
 * mode and, per Jenis PPh on its lines, the DPP that Jenis PPh covers. The
 * advance module takes this rather than reading `sal_customer_order` itself.
 */
export type AdvanceSourceOrder = {
  id: number;
  orderNo: string;
  orderDate: string;
  status: CustomerOrderStatus;
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
  poDate: string;
  termLabel: string;
  termName: string;
  salesperson: string | null;
  /** How many lines the order has, for the bill's one-line summary of it. */
  lineCount: number;
  basis: AdvanceBasis;
  /** Jenis PPh label by the basis's withholding key. */
  withholdingLabels: Record<string, string>;
};

/** Open orders, or the ones named — any status — for a stored bill. */
export async function advanceSourceOrders(
  filter: { ids?: number[]; openOnly?: boolean },
  db: Db = prisma
): Promise<AdvanceSourceOrder[]> {
  const rows = await db.salCustomerOrder.findMany({
    where: {
      ...(filter.ids ? { id: { in: filter.ids } } : {}),
      ...(filter.openOnly ? { status: "Open" } : {}),
    },
    orderBy: [{ order_date: "desc" }, { id: "desc" }],
    include: {
      customer: true,
      term: true,
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
      status: o.status as CustomerOrderStatus,
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
      poDate: isoDay(o.po_date),
      termLabel: o.term.term_label,
      termName: o.term.term_name,
      salesperson: o.salesperson,
      lineCount: o.lines.length,
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

// ------------------------------------------------------------- for the Invoice

/**
 * A Customer Order as an Invoice Penjualan reads it (U16, U18, U20): whose it
 * is, its Termin, its price mode, Kena PPN and PPN snapshot, and per line the
 * price and discount an Invoice bills at, with the line's Jenis PPh. The Invoice
 * module takes this rather than reading `sal_customer_order` itself; a
 * submitted order's lines are frozen, so what an Invoice prices from does not move.
 */
export type InvoiceSourceOrder = {
  id: number;
  orderNo: string;
  orderDate: string;
  status: CustomerOrderStatus;
  customerId: number;
  customerLabel: string;
  customerName: string;
  customerActive: boolean;
  addressId: number;
  poNo: string | null;
  termLabel: string;
  termDays: number;
  mode: PriceMode;
  taxable: boolean;
  rates: PpnRates | null;
  lines: {
    id: number;
    lineNo: number;
    itemLabel: string;
    itemName: string;
    uomLabel: string;
    qty: number;
    price: number;
    discountType: "Percent" | "Amount" | null;
    discountValue: number | null;
    amount: number;
    withholdingTaxId: number | null;
    withholdingRate: number | null;
    withholdingLabel: string | null;
  }[];
};

export async function invoiceSourceOrders(filter: { ids?: number[] }, db: Db = prisma): Promise<InvoiceSourceOrder[]> {
  const rows = await db.salCustomerOrder.findMany({
    where: filter.ids ? { id: { in: filter.ids } } : { status: { in: ["Open", "Closed"] } },
    orderBy: [{ order_date: "desc" }, { id: "desc" }],
    include: {
      customer: true,
      term: true,
      lines: { include: { item: true, uom: true, withholding_tax: true }, orderBy: { line_no: "asc" } },
    },
  });
  return rows.map((o) => ({
    id: o.id,
    orderNo: o.order_no,
    orderDate: isoDay(o.order_date),
    status: o.status as CustomerOrderStatus,
    customerId: o.customer_id,
    customerLabel: o.customer.partner_label,
    customerName: o.customer.partner_name,
    customerActive: o.customer.status === "Active",
    addressId: o.address_id,
    poNo: o.po_no,
    termLabel: o.term.term_label,
    termDays: o.term.due_days,
    mode: o.price_mode as PriceMode,
    taxable: o.is_taxable,
    rates:
      o.is_taxable && o.ppn_rate && o.ppn_dpp_other_numerator && o.ppn_dpp_other_denominator
        ? { rate: o.ppn_rate.toNumber(), otherNum: o.ppn_dpp_other_numerator, otherDen: o.ppn_dpp_other_denominator }
        : null,
    lines: o.lines.map((l) => ({
      id: l.id,
      lineNo: l.line_no,
      itemLabel: l.item.item_label,
      itemName: l.item.item_name,
      uomLabel: l.uom.uom_label,
      qty: l.qty.toNumber(),
      price: l.price.toNumber(),
      discountType: (l.discount_type as "Percent" | "Amount" | null) ?? null,
      discountValue: l.discount_value?.toNumber() ?? null,
      amount: l.amount.toNumber(),
      withholdingTaxId: l.withholding_tax_id,
      withholdingRate: l.withholding_rate?.toNumber() ?? null,
      withholdingLabel: l.withholding_tax?.wht_label ?? null,
    })),
  }));
}

/**
 * Records what posted Delivery Notes sent of each order line (U21), called by
 * the Sales Order module inside the posting transaction, and closes every Open
 * order whose lines are now fully delivered — the order is finished when its
 * delivery is; billing follows. Returns the numbers of the orders it closed.
 */
export async function recordCustomerOrderDelivery(
  tx: Prisma.TransactionClient,
  sent: Map<number, number>,
  actorId: number
): Promise<string[]> {
  if (!sent.size) return [];
  for (const [lineId, qty] of sent) {
    await tx.salCustomerOrderLine.update({ where: { id: lineId }, data: { delivered_qty: { increment: qty } } });
  }
  const orders = await tx.salCustomerOrder.findMany({
    where: { status: "Open", lines: { some: { id: { in: [...sent.keys()] } } } },
    include: { lines: true },
  });
  const units = (n: number) => Math.round(n * 10_000);
  const closed: string[] = [];
  for (const o of orders) {
    if (!o.lines.every((l) => units(l.delivered_qty.toNumber()) >= units(l.qty.toNumber()))) continue;
    const done = await tx.salCustomerOrder.updateMany({
      where: { id: o.id, status: "Open" },
      data: { status: "Closed", status_reason: null, updated_by: actorId },
    });
    if (done.count === 1) {
      await audit(tx, o.id, "UPDATE", "fulfil", actorId);
      closed.push(o.order_no);
    }
  }
  return closed;
}

/**
 * Locks an order's row for the rest of the transaction, so an advance drawn
 * from it and the order's closing cannot pass each other, and two bills
 * cannot both spend the same room (P57).
 */
export async function lockCustomerOrder(tx: Prisma.TransactionClient, id: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM sal_customer_order WHERE id = ${id} FOR UPDATE`;
}

// -------------------------------------------------------- for the Sales Order

/**
 * A Customer Order as a Sales Order reads it (P79): whose it is, where it
 * delivers by default, and its lines — the item, the unit and the quantity a
 * Sales Order may take a part of. The Sales Order module takes this rather
 * than reading `sal_customer_order` itself; a Customer Order's lines are
 * frozen once it is submitted, so what a Sales Order names does not move.
 */
export type SalesOrderSource = {
  id: number;
  orderNo: string;
  orderDate: string;
  status: CustomerOrderStatus;
  customerId: number;
  customerLabel: string;
  customerName: string;
  customerActive: boolean;
  /** The Customer Order's own address — where a Sales Order delivers unless told otherwise. */
  addressId: number;
  poNo: string | null;
  lines: {
    id: number;
    lineNo: number;
    itemId: number;
    itemLabel: string;
    itemName: string;
    uomId: number;
    uomLabel: string;
    /** Base units in one of the line's unit — what a delivery issues stock in. */
    uomFactor: number;
    qty: number;
  }[];
};

/** Open orders, or the ones named — any status — for a stored Sales Order. */
export async function salesOrderSources(
  filter: { ids?: number[]; openOnly?: boolean },
  db: Db = prisma
): Promise<SalesOrderSource[]> {
  const rows = await db.salCustomerOrder.findMany({
    where: {
      ...(filter.ids ? { id: { in: filter.ids } } : {}),
      ...(filter.openOnly ? { status: "Open" } : {}),
    },
    orderBy: [{ order_date: "desc" }, { id: "desc" }],
    include: {
      customer: true,
      lines: { include: { item: true, uom: true }, orderBy: { line_no: "asc" } },
    },
  });
  return rows.map((o) => ({
    id: o.id,
    orderNo: o.order_no,
    orderDate: isoDay(o.order_date),
    status: o.status as CustomerOrderStatus,
    customerId: o.customer_id,
    customerLabel: o.customer.partner_label,
    customerName: o.customer.partner_name,
    customerActive: o.customer.status === "Active",
    addressId: o.address_id,
    poNo: o.po_no,
    lines: o.lines.map((l) => ({
      id: l.id,
      lineNo: l.line_no,
      itemId: l.item_id,
      itemLabel: l.item.item_label,
      itemName: l.item.item_name,
      uomId: l.uom_id,
      uomLabel: l.uom.uom_label,
      uomFactor: l.uom_factor.toNumber(),
      qty: l.qty.toNumber(),
    })),
  }));
}
