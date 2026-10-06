import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber, taxSeriesPrefix } from "./document-number";
import { SUPPLIER_CATEGORY } from "./entities";
import { PPN_SETTINGS_MISSING, ppnRates } from "./system-settings";
import { computeSalesTotals, lineProblem, type DiscountType, type PpnRates, type PriceMode, type SalesTotals } from "./sales-tax";
import { lockPurchaseRequestLines, purchaseOrderSourceLines, recordPurchaseRequestOrdered, type PoSourceLine } from "./purchase-request";
import {
  PURCHASE_ORDER_TRANSITIONS,
  purchaseOrderIsEditable,
  purchaseOrderTransitionAllowed,
  purchaseWithholdingRate,
  sharePurchaseOrderLine,
  type PurchaseOrderAction,
  type PurchaseOrderStatus,
} from "./purchase-order-workflow";

/**
 * The Purchase Order module (P124, Purchasing-Concept.md B9–B16): its tables are
 * `pur_order`, `pur_order_line` and `pur_order_line_request`, and nothing else
 * names them.
 *
 * One supplier, one kind, made only from Open Purchase Requests: every line
 * covers at least one request line. Request lines of one item and unit are
 * picked into one PO line (B9); its base quantity is shared over them earliest
 * need first, and what is beyond them belongs to no request (B15). The tax
 * arithmetic is the Customer Order's (`sales-tax.ts`, B11). Ajukan writes the
 * shares onto the request lines through the request module; Tolak and Tutup
 * give back what was never received. It posts nothing.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type PurchaseOrderHeaderInput = {
  item_type: "Barang" | "Jasa";
  order_date: string;
  supplier_id: number | null;
  term_id: number | null;
  delivery_date: string;
  warehouse_id: number | null;
  quotation_no: string;
  price_mode: string;
  is_taxable: boolean;
  note: string;
};

export type PurchaseOrderLineInput = {
  item_id: number | null;
  uom_id: number | null;
  qty: number;
  price: number;
  discount_type: string | null;
  discount_value: number | null;
  withholding_tax_id: number | null;
  note: string;
  /** The request lines this line covers (B9); at least one. */
  request_line_ids: number[];
};

export type PurchaseOrderResult = { ok: true; id: number; orderNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const lineKey = (i: number, field: string) => `lines.${i}.${field}`;
const text = (v: unknown) => String(v ?? "").trim() || null;
const units = (n: number) => Math.round(n * 10_000);

// ---------------------------------------------------------------- options

export type PoSupplierOption = {
  id: number;
  label: string;
  name: string;
  active: boolean;
  defaultTermId: number | null;
  defaultPriceMode: PriceMode | null;
  isPkp: boolean;
  taxIdType: string | null;
  taxId: string | null;
};

export type PoItemOption = {
  id: number;
  label: string;
  name: string;
  /** The base unit first (factor 1), then the item's conversions (B14). */
  uoms: { id: number; label: string; name: string; factor: number }[];
};

export type PoRefOption = { id: number; label: string; name: string; active: boolean };

export type PurchaseOrderOptions = {
  suppliers: PoSupplierOption[];
  items: PoItemOption[];
  terms: PoRefOption[];
  warehouses: PoRefOption[];
  withholdingTaxes: (PoRefOption & { rate: number })[];
  /** Open request lines with something left, plus those the order names. */
  sources: PoSourceLine[];
  ppnRates: PpnRates | null;
};

export async function purchaseOrderOptions(itemType: "Barang" | "Jasa", withRequestLineIds: number[] = []): Promise<PurchaseOrderOptions> {
  const [suppliers, terms, warehouses, taxes, sources, rates] = await Promise.all([
    prisma.mPartner.findMany({ where: { category: { category_label: SUPPLIER_CATEGORY } }, orderBy: { partner_label: "asc" } }),
    prisma.refPaymentTerm.findMany({ orderBy: { due_days: "asc" } }),
    prisma.refWarehouse.findMany({ orderBy: { warehouse_label: "asc" } }),
    prisma.refWithholdingTax.findMany({ where: { usage: "Purchase" }, orderBy: { wht_label: "asc" } }),
    purchaseOrderSourceLines({ itemType, ids: withRequestLineIds }),
    ppnRates(),
  ]);
  const items = await prisma.mItem.findMany({
    where: { id: { in: [...new Set(sources.map((s) => s.itemId))] } },
    include: { base_uom: true, uoms: { include: { uom: true }, orderBy: [{ sort_order: "asc" }, { id: "asc" }] } },
  });
  return {
    suppliers: suppliers.map((p) => ({
      id: p.id,
      label: p.partner_label,
      name: p.partner_name,
      active: p.status === "Active",
      defaultTermId: p.purchase_term_id,
      defaultPriceMode: p.purchase_price_mode,
      isPkp: p.is_pkp,
      taxIdType: p.tax_id_type,
      taxId: p.tax_id,
    })),
    items: items.map((i) => ({
      id: i.id,
      label: i.item_label,
      name: i.item_name,
      uoms: [
        { id: i.base_uom.id, label: i.base_uom.uom_label, name: i.base_uom.uom_name, factor: 1 },
        ...i.uoms.map((u) => ({ id: u.uom.id, label: u.uom.uom_label, name: u.uom.uom_name, factor: u.factor.toNumber() })),
      ],
    })),
    terms: terms.map((t) => ({ id: t.id, label: t.term_label, name: t.term_name, active: t.status === "Active" })),
    warehouses: warehouses.map((w) => ({ id: w.id, label: w.warehouse_label, name: w.warehouse_name, active: w.status === "Active" })),
    withholdingTaxes: taxes.map((t) => ({ id: t.id, label: t.wht_label, name: t.wht_name, active: t.status === "Active", rate: t.rate.toNumber() })),
    sources,
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
  /** Request line id → base quantity this line covers of it. */
  shares: Map<number, number>;
};

export type PurchaseOrderCheck =
  | {
      ok: true;
      header: {
        item_type: "Barang" | "Jasa";
        order_date: Date;
        supplier_id: number;
        term_id: number;
        delivery_date: Date;
        warehouse_id: number | null;
        quotation_no: string | null;
        price_mode: PriceMode;
        is_taxable: boolean;
        note: string | null;
      };
      lines: CheckedLine[];
      totals: SalesTotals;
      rates: PpnRates | null;
    }
  | { ok: false; errors: Record<string, string> };

/** Every rule a Purchase Order must satisfy to be saved — and, run again under the requests' lock, to be submitted. */
export async function checkPurchaseOrder(
  header: PurchaseOrderHeaderInput,
  lines: PurchaseOrderLineInput[],
  db: Db = prisma
): Promise<PurchaseOrderCheck> {
  const errors: Record<string, string> = {};
  const itemType = header.item_type === "Jasa" ? "Jasa" : "Barang";

  const orderDate = String(header.order_date ?? "").trim();
  const deliveryDate = String(header.delivery_date ?? "").trim();
  if (!DAY.test(orderDate)) errors.order_date = "Tanggal PO wajib diisi.";
  if (!DAY.test(deliveryDate)) errors.delivery_date = "Tanggal kirim wajib diisi.";
  else if (DAY.test(orderDate) && deliveryDate < orderDate) errors.delivery_date = "Tidak boleh sebelum tanggal PO.";

  const taxable = header.is_taxable !== false;
  const supplierId = Number(header.supplier_id) || null;
  let hasTaxId = true;
  if (!supplierId) errors.supplier_id = "Pilih Supplier.";
  else {
    const s = await db.mPartner.findUnique({ where: { id: supplierId }, include: { category: true } });
    if (!s || s.category.category_label !== SUPPLIER_CATEGORY) errors.supplier_id = "Partner ini bukan Supplier.";
    else {
      if (s.status !== "Active") errors.supplier_id = "Supplier nonaktif.";
      // Only a PKP may issue a faktur pajak, so only its sale carries PPN (B10).
      if (taxable && !s.is_pkp) errors.is_taxable = "Supplier bukan PKP: Purchase Order tidak dapat Kena PPN.";
      hasTaxId = Boolean(s.tax_id);
    }
  }

  const termId = Number(header.term_id) || null;
  if (!termId) errors.term_id = "Pilih Termin Pembayaran.";
  else {
    const t = await db.refPaymentTerm.findUnique({ where: { id: termId }, select: { status: true } });
    if (!t || t.status !== "Active") errors.term_id = "Termin tidak ditemukan atau nonaktif.";
  }

  let warehouseId = itemType === "Barang" ? Number(header.warehouse_id) || null : null;
  if (warehouseId) {
    const w = await db.refWarehouse.findUnique({ where: { id: warehouseId }, select: { status: true } });
    if (!w || w.status !== "Active") errors.warehouse_id = "Gudang tidak ditemukan atau nonaktif.";
  } else warehouseId = null;

  const mode = taxable ? header.price_mode : "Exclude";
  if (mode !== "Exclude" && mode !== "Include") errors.price_mode = "Pilih mode harga.";

  // ---- lines
  if (!lines.length) errors._lines = "Tambahkan minimal satu barang dari Purchase Request.";
  const items = new Map(
    (
      await db.mItem.findMany({
        where: { id: { in: [...new Set(lines.map((l) => Number(l.item_id)).filter(Boolean))] } },
        include: { uoms: true },
      })
    ).map((i) => [i.id, i])
  );
  const taxes = new Map(
    (await db.refWithholdingTax.findMany({ where: { id: { in: lines.map((l) => Number(l.withholding_tax_id)).filter(Boolean) } } })).map((t) => [t.id, t])
  );
  const allReq = [...new Set(lines.flatMap((l) => (l.request_line_ids ?? []).map(Number)))];
  const sources = new Map((await purchaseOrderSourceLines({ ids: allReq }, db)).map((s) => [s.id, s]));
  const usedReq = new Set<number>();

  const checked: CheckedLine[] = [];
  for (const [i, l] of lines.entries()) {
    const item = items.get(Number(l.item_id));
    if (!item) {
      errors[lineKey(i, "item_id")] = "Pilih barang.";
      continue;
    }
    if (item.item_type !== itemType || !item.can_buy || item.status !== "Active") {
      errors[lineKey(i, "item_id")] = `${item.item_label} bukan ${itemType === "Barang" ? "barang" : "jasa"} aktif yang dapat dibeli.`;
      continue;
    }
    const uomId = Number(l.uom_id) || item.base_uom_id;
    const factor = uomId === item.base_uom_id ? 1 : (item.uoms.find((u) => u.uom_id === uomId)?.factor.toNumber() ?? null);
    if (!factor) {
      errors[lineKey(i, "uom_id")] = "Satuan ini bukan satuan barang tersebut.";
      continue;
    }
    const discountType = l.discount_type === "Percent" || l.discount_type === "Amount" ? (l.discount_type as DiscountType) : null;
    const discountValue = discountType ? Number(l.discount_value) || 0 : null;
    const problem = lineProblem({ qty: Number(l.qty), price: Number(l.price), discountType, discountValue });
    if (problem) {
      errors[lineKey(i, "amount")] = problem;
      continue;
    }
    if (Math.abs(Number(l.qty) * 10_000 - units(Number(l.qty))) > 1e-6) {
      errors[lineKey(i, "amount")] = "Qty paling banyak empat desimal.";
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
      if (t.usage !== "Purchase") {
        errors[lineKey(i, "withholding_tax_id")] = `${t.wht_label} adalah Jenis PPh penjualan.`;
        continue;
      }
      whtRate = purchaseWithholdingRate(t.rate.toNumber(), hasTaxId);
    } else whtId = null;

    // ---- the request lines it covers (B13, B9)
    const reqIds = [...new Set((l.request_line_ids ?? []).map(Number).filter(Boolean))];
    if (!reqIds.length) {
      errors[lineKey(i, "item_id")] = "Baris Purchase Order harus berasal dari Purchase Request.";
      continue;
    }
    let bad: string | null = null;
    for (const id of reqIds) {
      const s = sources.get(id);
      if (!s) bad = "Baris Purchase Request tidak ditemukan.";
      else if (!s.requestOpen) bad = `${s.requestNo} sudah tidak Open.`;
      else if (s.itemId !== item.id) bad = `${s.requestNo} meminta barang lain.`;
      else if (usedReq.has(id)) bad = `${s.requestNo} · ${s.itemLabel} sudah dipakai di baris lain.`;
      if (bad) break;
      usedReq.add(id);
    }
    if (bad) {
      errors[lineKey(i, "item_id")] = bad;
      continue;
    }
    const { shares } = sharePurchaseOrderLine(
      Number(l.qty) * factor,
      reqIds.map((id) => {
        const s = sources.get(id)!;
        return { id, neededDate: s.neededDate, left: Math.max(0, s.qty - s.ordered) };
      })
    );

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
      note: text(l.note),
      shares,
    });
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";

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
    vatCollector: false,
    rates,
  });

  return {
    ok: true,
    header: {
      item_type: itemType,
      order_date: asDate(orderDate),
      supplier_id: supplierId!,
      term_id: termId!,
      delivery_date: asDate(deliveryDate),
      warehouse_id: warehouseId,
      quotation_no: text(header.quotation_no),
      price_mode: mode as PriceMode,
      is_taxable: taxable,
      note: text(header.note),
    },
    lines: checked,
    totals,
    rates,
  };
}

// ------------------------------------------------------------------ writes

async function nextOrderNo(db: Db, date: Date, isTaxable: boolean): Promise<string> {
  return nextDocumentNumber(taxSeriesPrefix("PO", isTaxable), date, async (series) => {
    const row = await db.purOrder.findFirst({ where: { order_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { order_no: true } });
    return row?.order_no ?? null;
  });
}

const rateData = (r: PpnRates | null) => ({
  ppn_rate: r?.rate ?? null,
  ppn_dpp_other_numerator: r?.otherNum ?? null,
  ppn_dpp_other_denominator: r?.otherDen ?? null,
});

const totalsData = (t: SalesTotals) => ({
  gross_amount: t.gross,
  discount_amount: t.discount,
  dpp_amount: t.dpp,
  dpp_other_amount: t.dppOther,
  ppn_amount: t.ppn,
  total_amount: t.total,
});

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
    requests: { create: [...l.shares].map(([request_line_id, base_qty]) => ({ request_line_id, base_qty })) },
  };
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "pur_order", row_id: id, action, event, by } });
}

export async function createPurchaseOrder(header: PurchaseOrderHeaderInput, lines: PurchaseOrderLineInput[], actorId: number): Promise<PurchaseOrderResult> {
  const c = await checkPurchaseOrder(header, lines);
  if (!c.ok) return c;
  const made = await prisma.$transaction(async (tx) => {
    const order = await tx.purOrder.create({
      data: {
        ...c.header,
        ...totalsData(c.totals),
        ...rateData(c.rates),
        order_no: await nextOrderNo(tx, c.header.order_date, c.header.is_taxable),
        created_by: actorId,
        lines: { create: c.lines.map((l, i) => lineData(l, c.totals, i)) },
      },
    });
    await audit(tx, order.id, "TAMBAH", "create", actorId);
    return order;
  });
  return { ok: true, id: made.id, orderNo: made.order_no };
}

export async function updatePurchaseOrder(id: number, header: PurchaseOrderHeaderInput, lines: PurchaseOrderLineInput[], actorId: number): Promise<PurchaseOrderResult> {
  const current = await prisma.purOrder.findUnique({ where: { id }, select: { status: true, order_no: true, is_taxable: true, item_type: true } });
  if (!current) return { ok: false, errors: { _form: "Purchase Order tidak ditemukan." } };
  if (!purchaseOrderIsEditable(current.status as PurchaseOrderStatus)) return { ok: false, errors: { _form: "Hanya Purchase Order berstatus Draft yang dapat diubah." } };
  if (header.item_type !== current.item_type) return { ok: false, errors: { _form: "Jenis Purchase Order tidak dapat diubah." } };
  const c = await checkPurchaseOrder(header, lines);
  if (!c.ok) return c;
  const orderNo = await prisma.$transaction(async (tx) => {
    const renumbered = c.header.is_taxable !== current.is_taxable ? await nextOrderNo(tx, c.header.order_date, c.header.is_taxable) : null;
    await tx.purOrderLine.deleteMany({ where: { order_id: id } });
    await tx.purOrder.update({
      where: { id },
      data: {
        ...c.header,
        ...totalsData(c.totals),
        ...rateData(c.rates),
        ...(renumbered ? { order_no: renumbered } : {}),
        updated_by: actorId,
        lines: { create: c.lines.map((l, i) => lineData(l, c.totals, i)) },
      },
    });
    await audit(tx, id, "UPDATE", "update", actorId);
    return renumbered ?? current.order_no;
  });
  return { ok: true, id, orderNo };
}

type StoredOrder = Prisma.PurOrderGetPayload<{ include: { lines: { include: { requests: true } } } }>;

function asInput(o: StoredOrder) {
  const header: PurchaseOrderHeaderInput = {
    item_type: o.item_type,
    order_date: isoDay(o.order_date),
    supplier_id: o.supplier_id,
    term_id: o.term_id,
    delivery_date: isoDay(o.delivery_date),
    warehouse_id: o.warehouse_id,
    quotation_no: o.quotation_no ?? "",
    price_mode: o.price_mode,
    is_taxable: o.is_taxable,
    note: o.note ?? "",
  };
  const lines: PurchaseOrderLineInput[] = [...o.lines]
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
      request_line_ids: l.requests.map((r) => r.request_line_id),
    }));
  return { header, lines };
}

export type PurchaseOrderTransitionResult = { ok: true } | { ok: false; errors: Record<string, string> };

const sumInto = (m: Map<number, number>, id: number, q: number) => m.set(id, (m.get(id) ?? 0) + q);

/**
 * Runs one lifecycle step (B16). **Ajukan** locks the request lines, checks the
 * stored order again against today's masters, shares each line over its
 * requests as they stand now, freezes the figures and the PPN snapshot, and
 * writes the shares onto the request lines. **Tolak** gives every share back;
 * **Tutup** gives back what was never received, from the latest need first.
 * Each step is conditional on the status just read.
 */
export async function transitionPurchaseOrder(id: number, action: PurchaseOrderAction, actorId: number, reason?: string): Promise<PurchaseOrderTransitionResult> {
  const order = await prisma.purOrder.findUnique({ where: { id }, include: { lines: { include: { requests: true } } } });
  if (!order) return { ok: false, errors: { _form: "Purchase Order tidak ditemukan." } };
  const t = PURCHASE_ORDER_TRANSITIONS[action];
  if (!purchaseOrderTransitionAllowed(action, order.status as PurchaseOrderStatus)) {
    return { ok: false, errors: { _form: `Purchase Order berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  const from = order.status;
  const moved = "Purchase Order berubah saat diproses. Muat ulang halaman.";
  const why = String(reason ?? "").trim();
  if (t.reason && !why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };

  if (action === "submit") {
    const input = asInput(order);
    let refused: string | null = null;
    await prisma.$transaction(async (tx) => {
      await lockPurchaseRequestLines(tx, input.lines.flatMap((l) => l.request_line_ids));
      const c = await checkPurchaseOrder(input.header, input.lines, tx);
      if (!c.ok) {
        refused = `Belum bisa diajukan: ${Object.entries(c.errors).find(([k]) => k !== "_lines")?.[1] ?? c.errors._lines}`;
        return;
      }
      const done = await tx.purOrder.updateMany({
        where: { id, status: from },
        data: { status: t.to, ...totalsData(c.totals), ...rateData(c.rates), updated_by: actorId },
      });
      if (done.count !== 1) throw new Error(moved);
      const ordered = new Map<number, number>();
      const sorted = [...order.lines].sort((a, b) => a.line_no - b.line_no);
      for (const [i, l] of c.lines.entries()) {
        const r = c.totals.lines[i];
        await tx.purOrderLine.update({
          where: { id: sorted[i].id },
          data: { dpp_amount: r.dpp, dpp_other_amount: r.dppOther, ppn_amount: r.ppn, withholding_rate: l.withholding_rate },
        });
        for (const [reqId, q] of l.shares) {
          await tx.purOrderLineRequest.updateMany({ where: { order_line_id: sorted[i].id, request_line_id: reqId }, data: { base_qty: q } });
          if (q) sumInto(ordered, reqId, q);
        }
      }
      await recordPurchaseRequestOrdered(tx, ordered, actorId);
      await audit(tx, id, "UPDATE", "submit", actorId);
    });
    return refused ? { ok: false, errors: { _form: refused } } : { ok: true };
  }

  await prisma.$transaction(async (tx) => {
    const done = await tx.purOrder.updateMany({
      where: { id, status: from },
      data: { status: t.to, ...(t.reason ? { status_reason: why } : {}), updated_by: actorId },
    });
    if (done.count !== 1) throw new Error(moved);
    if (action === "reject" || action === "close") {
      await lockPurchaseRequestLines(tx, order.lines.flatMap((l) => l.requests.map((r) => r.request_line_id)));
      const back = new Map<number, number>();
      for (const l of order.lines) {
        // What never came in is released, latest need first, so the earliest
        // needs keep what was received (B15, as U14 for delivery).
        const kept = action === "reject" ? 0 : l.received_qty.toNumber() * l.uom_factor.toNumber();
        const links = await tx.purOrderLineRequest.findMany({
          where: { order_line_id: l.id },
          include: { request_line: { select: { needed_date: true } } },
        });
        links.sort((a, b) => a.request_line.needed_date.getTime() - b.request_line.needed_date.getTime() || a.request_line_id - b.request_line_id);
        let keep = units(kept);
        for (const k of links) {
          const share = units(k.base_qty.toNumber());
          const stays = Math.min(share, keep);
          keep -= stays;
          if (share - stays > 0) {
            sumInto(back, k.request_line_id, -(share - stays) / 10_000);
            await tx.purOrderLineRequest.update({ where: { id: k.id }, data: { base_qty: stays / 10_000 } });
          }
        }
      }
      await recordPurchaseRequestOrdered(tx, back, actorId);
    }
    await audit(tx, id, "UPDATE", action, actorId);
  });
  return { ok: true };
}

// ------------------------------------------------------------------- reads

export type PurchaseOrderListRow = {
  id: number;
  orderNo: string;
  orderDate: string;
  deliveryDate: string;
  supplierLabel: string;
  supplierName: string;
  total: number;
  status: PurchaseOrderStatus;
  lines: number;
};

export async function listPurchaseOrders(itemType: "Barang" | "Jasa"): Promise<PurchaseOrderListRow[]> {
  const rows = await prisma.purOrder.findMany({
    where: { item_type: itemType },
    orderBy: [{ order_date: "desc" }, { id: "desc" }],
    include: { supplier: true, _count: { select: { lines: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    orderNo: r.order_no,
    orderDate: isoDay(r.order_date),
    deliveryDate: isoDay(r.delivery_date),
    supplierLabel: r.supplier.partner_label,
    supplierName: r.supplier.partner_name,
    total: r.total_amount.toNumber(),
    status: r.status as PurchaseOrderStatus,
    lines: r._count.lines,
  }));
}

export type PurchaseOrderLineView = PurchaseOrderLineInput & {
  itemLabel: string;
  itemName: string;
  uomLabel: string;
  uomFactor: number;
  withholdingLabel: string | null;
  withholdingRate: number | null;
  received: number;
  /** Each request line covered and its share (base units), as stored. */
  shares: { requestLineId: number; requestId: number; requestNo: string; neededDate: string; baseQty: number }[];
};

export type PurchaseOrderView = {
  id: number;
  orderNo: string;
  status: PurchaseOrderStatus;
  header: PurchaseOrderHeaderInput;
  lines: PurchaseOrderLineView[];
  supplierLabel: string;
  supplierName: string;
  termLabel: string;
  termName: string;
  warehouseLabel: string | null;
  statusReason: string | null;
  totals: { gross: number; discount: number; dpp: number; dppOther: number; ppn: number; total: number };
  rates: PpnRates | null;
};

export async function getPurchaseOrder(id: number): Promise<PurchaseOrderView | null> {
  const o = await prisma.purOrder.findUnique({
    where: { id },
    include: {
      supplier: true,
      term: true,
      warehouse: true,
      lines: {
        include: { item: true, uom: true, withholding_tax: true, requests: true },
        orderBy: { line_no: "asc" },
      },
    },
  });
  if (!o) return null;
  const input = asInput(o);
  const src = new Map((await purchaseOrderSourceLines({ ids: o.lines.flatMap((l) => l.requests.map((r) => r.request_line_id)) })).map((s) => [s.id, s]));
  return {
    id: o.id,
    orderNo: o.order_no,
    status: o.status as PurchaseOrderStatus,
    header: input.header,
    lines: o.lines.map((l, i) => ({
      ...input.lines[i],
      itemLabel: l.item.item_label,
      itemName: l.item.item_name,
      uomLabel: l.uom.uom_label,
      uomFactor: l.uom_factor.toNumber(),
      withholdingLabel: l.withholding_tax?.wht_label ?? null,
      withholdingRate: l.withholding_rate?.toNumber() ?? null,
      received: l.received_qty.toNumber(),
      shares: l.requests.map((r) => {
        const s = src.get(r.request_line_id);
        return {
          requestLineId: r.request_line_id,
          requestId: s?.requestId ?? 0,
          requestNo: s?.requestNo ?? "",
          neededDate: s?.neededDate ?? "",
          baseQty: r.base_qty.toNumber(),
        };
      }),
    })),
    supplierLabel: o.supplier.partner_label,
    supplierName: o.supplier.partner_name,
    termLabel: o.term.term_label,
    termName: o.term.term_name,
    warehouseLabel: o.warehouse?.warehouse_label ?? null,
    statusReason: o.status_reason,
    totals: {
      gross: o.gross_amount.toNumber(),
      discount: o.discount_amount.toNumber(),
      dpp: o.dpp_amount.toNumber(),
      dppOther: o.dpp_other_amount.toNumber(),
      ppn: o.ppn_amount.toNumber(),
      total: o.total_amount.toNumber(),
    },
    rates:
      o.ppn_rate && o.ppn_dpp_other_numerator && o.ppn_dpp_other_denominator
        ? { rate: o.ppn_rate.toNumber(), otherNum: o.ppn_dpp_other_numerator, otherDen: o.ppn_dpp_other_denominator }
        : null,
  };
}

/** Order numbers by id, for the audit panel. */
export async function purchaseOrderNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.purOrder.findMany({ where: { id: { in: ids } }, select: { id: true, order_no: true } });
  return new Map(rows.map((r) => [r.id, r.order_no]));
}

export async function lockPurchaseOrder(tx: Prisma.TransactionClient, id: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM pur_order WHERE id = ${id} FOR UPDATE`;
}
