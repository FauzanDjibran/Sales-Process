import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber, taxSeriesPrefix } from "./document-number";
import { formatAddress } from "./partner-shape";
import { CUSTOMER_CATEGORY } from "./entities";
import { PPN_SETTINGS_MISSING, ppnRates } from "./system-settings";
import { computePermitTotals, type AdvanceBasis, type PermitTotals, type PpnRates, type PriceMode } from "./sales-tax";
import {
  PERMIT_REQUEST_TRANSITIONS,
  permitRequestIsEditable,
  permitRequestTransitionAllowed,
  type PermitRequestAction,
  type PermitRequestStatus,
} from "./permit-request-workflow";

/**
 * The Pengajuan Perizinan module (P137, Perizinan-Concept.md §5–§6): its tables
 * are `sal_permit_request` and `sal_permit_request_line`, and nothing else
 * names them.
 *
 * A Pengajuan posts nothing. It is the internal list of permits the company
 * arranges for a makloon customer's product, each at its estimate and — once
 * realised on the same document — at its real price. The customer's documents
 * (Uang Muka and Invoice Perizinan) read it through the functions at the end
 * and carry one description line; the permits never leave this module.
 */

type Db = Prisma.TransactionClient | typeof prisma;

// ------------------------------------------------------------------ input

export type PermitRequestHeaderInput = {
  request_date: string;
  customer_id: number | null;
  address_id: number | null;
  term_id: number | null;
  price_mode: string;
  is_taxable: boolean;
  withholding_tax_id: number | null;
  po_no: string;
  po_date: string;
  salesperson: string;
  product_name: string;
  note: string;
};

export type PermitRequestLineInput = {
  permit_type_id: number | null;
  description: string;
  estimate_price: number;
};

export type PermitRealizationInput = {
  realization_date: string;
  realization_note: string;
  lines: { permit_type_id: number | null; description: string; realized_price: number | null; is_added: boolean }[];
};

export type PermitRequestResult =
  | { ok: true; id: number; requestNo: string }
  | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const lineKey = (i: number, field: string) => `lines.${i}.${field}`;

// ---------------------------------------------------------------- options

export type PermitCustomerOption = {
  id: number;
  label: string;
  name: string;
  active: boolean;
  addresses: { id: number; text: string; isBilling: boolean; isShipping: boolean }[];
  defaultTermId: number | null;
  defaultPriceMode: PriceMode | null;
  isPkp: boolean;
  taxIdType: string | null;
  taxId: string | null;
  problems: string[];
};

export type PermitRefOption = { id: number; label: string; name: string; active: boolean };

export type PermitTypeOption = PermitRefOption & {
  category: string;
  description: string;
  standardEstimate: number | null;
};

export type PermitRequestOptions = {
  customers: PermitCustomerOption[];
  terms: PermitRefOption[];
  withholdingTaxes: (PermitRefOption & { rate: number })[];
  permitTypes: PermitTypeOption[];
  ppnRates: PpnRates | null;
};

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

const ADDRESS_INCLUDE = { village: { include: { district: { include: { city: { include: { province: true } } } } } } } as const;

function addressText(a: Prisma.MPartnerAddressGetPayload<{ include: typeof ADDRESS_INCLUDE }>): string {
  const d = a.village.district;
  return formatAddress({
    provinceName: d.city.province.name,
    cityName: d.city.name,
    districtName: d.name,
    villageName: a.village.name,
    street: a.street,
    postalCode: a.village.postal_code ?? "",
  });
}

export async function permitRequestOptions(): Promise<PermitRequestOptions> {
  const [partners, terms, taxes, types, rates] = await Promise.all([
    prisma.mPartner.findMany({
      where: { category: { category_label: CUSTOMER_CATEGORY } },
      orderBy: { partner_label: "asc" },
      include: {
        _count: { select: { addresses: true } },
        addresses: { orderBy: [{ sort_order: "asc" }, { id: "asc" }], include: ADDRESS_INCLUDE },
      },
    }),
    prisma.refPaymentTerm.findMany({ orderBy: { due_days: "asc" } }),
    prisma.refWithholdingTax.findMany({ where: { usage: "Sales" }, orderBy: { wht_label: "asc" } }),
    prisma.refPermitType.findMany({ orderBy: { permit_label: "asc" } }),
    ppnRates(),
  ]);
  return {
    customers: partners.map((p) => ({
      id: p.id,
      label: p.partner_label,
      name: p.partner_name,
      active: p.status === "Active",
      addresses: p.addresses.map((a) => ({ id: a.id, text: addressText(a), isBilling: a.is_billing, isShipping: a.is_shipping })),
      defaultTermId: p.default_term_id,
      defaultPriceMode: p.default_price_mode,
      isPkp: p.is_pkp,
      taxIdType: p.tax_id_type,
      taxId: p.tax_id,
      problems: customerProblems(p),
    })),
    terms: terms.map((t) => ({ id: t.id, label: t.term_label, name: t.term_name, active: t.status === "Active" })),
    withholdingTaxes: taxes.map((t) => ({
      id: t.id,
      label: t.wht_label,
      name: t.wht_name,
      active: t.status === "Active",
      rate: t.rate.toNumber(),
    })),
    permitTypes: types.map((t) => ({
      id: t.id,
      label: t.permit_label,
      name: t.permit_name,
      active: t.status === "Active",
      category: t.category,
      description: t.default_description ?? "",
      standardEstimate: t.standard_estimate?.toNumber() ?? null,
    })),
    ppnRates: rates,
  };
}

// ------------------------------------------------------------- validation

type CheckedLine = { line_no: number; permit_type_id: number; description: string; estimate_price: number };

export type PermitRequestCheck =
  | {
      ok: true;
      header: {
        request_date: Date;
        customer_id: number;
        address_id: number;
        term_id: number;
        price_mode: PriceMode;
        is_taxable: boolean;
        withholding_tax_id: number | null;
        withholding_rate: number | null;
        po_no: string | null;
        po_date: Date | null;
        salesperson: string | null;
        product_name: string;
        note: string | null;
      };
      lines: CheckedLine[];
      totals: PermitTotals;
      rates: PpnRates | null;
    }
  | { ok: false; errors: Record<string, string> };

/** Every rule a Pengajuan must satisfy to be saved, and — run again on what was stored — to be submitted. */
export async function checkPermitRequest(
  header: PermitRequestHeaderInput,
  lines: PermitRequestLineInput[]
): Promise<PermitRequestCheck> {
  const errors: Record<string, string> = {};

  const requestDate = String(header.request_date ?? "").trim();
  const poDate = String(header.po_date ?? "").trim();
  if (!DAY.test(requestDate)) errors.request_date = "Tanggal Pengajuan wajib diisi.";
  if (poDate && !DAY.test(poDate)) errors.po_date = "Tanggal PO tidak valid.";
  else if (poDate && DAY.test(requestDate) && poDate > requestDate) errors.po_date = "Tidak boleh setelah tanggal Pengajuan.";

  const customerId = Number(header.customer_id) || null;
  if (!customerId) errors.customer_id = "Pilih Customer.";
  else {
    const c = await prisma.mPartner.findUnique({
      where: { id: customerId },
      include: { category: true, _count: { select: { addresses: true } } },
    });
    if (!c || c.category.category_label !== CUSTOMER_CATEGORY) errors.customer_id = "Partner ini bukan Customer.";
    else {
      const problems = customerProblems(c);
      if (problems.length) errors.customer_id = problems.join(" ");
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

  const taxable = header.is_taxable !== false;
  const mode = taxable ? header.price_mode : "Exclude";
  if (mode !== "Exclude" && mode !== "Include") errors.price_mode = "Pilih mode harga.";

  // One Jenis PPh for the whole Pengajuan, picked by the user (QZ7).
  let whtId: number | null = Number(header.withholding_tax_id) || null;
  let whtRate: number | null = null;
  if (whtId) {
    const t = await prisma.refWithholdingTax.findUnique({ where: { id: whtId } });
    if (!t || t.status !== "Active") errors.withholding_tax_id = "Jenis PPh tidak ditemukan atau nonaktif.";
    else if (t.usage !== "Sales") errors.withholding_tax_id = `${t.wht_label} adalah Jenis PPh pembelian.`;
    else whtRate = t.rate.toNumber();
  } else whtId = null;

  const product = String(header.product_name ?? "").trim();
  if (!product) errors.product_name = "Isi produk yang didaftarkan.";

  const checked: CheckedLine[] = [];
  if (!lines.length) errors._lines = "Tambahkan minimal satu perizinan.";
  const typeIds = [...new Set(lines.map((l) => Number(l.permit_type_id)).filter(Boolean))];
  const types = new Map((await prisma.refPermitType.findMany({ where: { id: { in: typeIds } } })).map((t) => [t.id, t]));
  const seen = new Set<number>();
  for (const [i, l] of lines.entries()) {
    const t = types.get(Number(l.permit_type_id));
    if (!t) {
      errors[lineKey(i, "permit_type_id")] = l.permit_type_id ? "Jenis Perizinan tidak ditemukan." : "Pilih perizinan.";
      continue;
    }
    if (t.status !== "Active") {
      errors[lineKey(i, "permit_type_id")] = `${t.permit_label} sudah nonaktif.`;
      continue;
    }
    if (seen.has(t.id)) {
      errors[lineKey(i, "permit_type_id")] = `${t.permit_label} sudah ada di pengajuan ini.`;
      continue;
    }
    seen.add(t.id);
    const price = Number(l.estimate_price);
    if (!(price > 0)) {
      errors[lineKey(i, "estimate_price")] = "Harga estimasi harus lebih dari nol.";
      continue;
    }
    if (!Number.isInteger(price)) {
      errors[lineKey(i, "estimate_price")] = "Harga estimasi dalam rupiah penuh.";
      continue;
    }
    checked.push({
      line_no: i + 1,
      permit_type_id: t.id,
      description: String(l.description ?? "").trim() || t.permit_name,
      estimate_price: price,
    });
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) {
    errors._lines = "Ada baris yang perlu diperbaiki.";
  }

  const rates = taxable ? await ppnRates() : null;
  if (taxable && !rates) errors._form = PPN_SETTINGS_MISSING;

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    header: {
      request_date: asDate(requestDate),
      customer_id: customerId!,
      address_id: Number(header.address_id),
      term_id: termId!,
      price_mode: mode as PriceMode,
      is_taxable: taxable,
      withholding_tax_id: whtId,
      withholding_rate: whtRate,
      po_no: String(header.po_no ?? "").trim() || null,
      po_date: poDate ? asDate(poDate) : null,
      salesperson: String(header.salesperson ?? "").trim() || null,
      product_name: product,
      note: String(header.note ?? "").trim() || null,
    },
    lines: checked,
    totals: computePermitTotals({
      prices: checked.map((l) => l.estimate_price),
      mode: mode as PriceMode,
      taxable,
      rates,
      withholdingRate: whtRate,
    }),
    rates,
  };
}

// ------------------------------------------------------------------ writes

async function nextRequestNo(db: Db, date: Date, isTaxable: boolean): Promise<string> {
  return nextDocumentNumber(taxSeriesPrefix("PRZ", isTaxable), date, async (series) => {
    const row = await db.salPermitRequest.findFirst({
      where: { request_no: { startsWith: series } },
      orderBy: { id: "desc" },
      select: { request_no: true },
    });
    return row?.request_no ?? null;
  });
}

async function nextRealizationNo(db: Db, date: Date): Promise<string> {
  return nextDocumentNumber("RLZ", date, async (series) => {
    const row = await db.salPermitRequest.findFirst({
      where: { realization_no: { startsWith: series } },
      orderBy: { realization_no: "desc" },
      select: { realization_no: true },
    });
    return row?.realization_no ?? null;
  });
}

const rateData = (r: PpnRates | null) => ({
  ppn_rate: r?.rate ?? null,
  ppn_dpp_other_numerator: r?.otherNum ?? null,
  ppn_dpp_other_denominator: r?.otherDen ?? null,
});

const estimateData = (t: PermitTotals) => ({
  estimate_amount: t.amount,
  estimate_dpp: t.dpp,
  estimate_dpp_other: t.dppOther,
  estimate_ppn: t.ppn,
  estimate_total: t.total,
});

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "sal_permit_request", row_id: id, action, event, by } });
}

export async function createPermitRequest(
  header: PermitRequestHeaderInput,
  lines: PermitRequestLineInput[],
  actorId: number
): Promise<PermitRequestResult> {
  const c = await checkPermitRequest(header, lines);
  if (!c.ok) return c;
  const made = await prisma.$transaction(async (tx) => {
    const row = await tx.salPermitRequest.create({
      data: {
        ...c.header,
        ...estimateData(c.totals),
        ...rateData(c.rates),
        request_no: await nextRequestNo(tx, c.header.request_date, c.header.is_taxable),
        created_by: actorId,
        lines: { create: c.lines },
      },
    });
    await audit(tx, row.id, "TAMBAH", "create", actorId);
    return row;
  });
  return { ok: true, id: made.id, requestNo: made.request_no };
}

export async function updatePermitRequest(
  id: number,
  header: PermitRequestHeaderInput,
  lines: PermitRequestLineInput[],
  actorId: number
): Promise<PermitRequestResult> {
  const current = await prisma.salPermitRequest.findUnique({
    where: { id },
    select: { status: true, request_no: true, is_taxable: true },
  });
  if (!current) return { ok: false, errors: { _form: "Pengajuan Perizinan tidak ditemukan." } };
  if (!permitRequestIsEditable(current.status as PermitRequestStatus)) {
    return { ok: false, errors: { _form: "Hanya Pengajuan berstatus Draft yang dapat diubah." } };
  }
  const c = await checkPermitRequest(header, lines);
  if (!c.ok) return c;
  const requestNo = await prisma.$transaction(async (tx) => {
    const renumbered =
      c.header.is_taxable !== current.is_taxable ? await nextRequestNo(tx, c.header.request_date, c.header.is_taxable) : null;
    await tx.salPermitRequestLine.deleteMany({ where: { request_id: id } });
    await tx.salPermitRequest.update({
      where: { id },
      data: {
        ...c.header,
        ...estimateData(c.totals),
        ...rateData(c.rates),
        ...(renumbered ? { request_no: renumbered } : {}),
        updated_by: actorId,
        lines: { create: c.lines },
      },
    });
    await audit(tx, id, "UPDATE", "update", actorId);
    return renumbered ?? current.request_no;
  });
  return { ok: true, id, requestNo };
}

type StoredRequest = Prisma.SalPermitRequestGetPayload<{ include: { lines: true } }>;

function asInput(o: StoredRequest) {
  const header: PermitRequestHeaderInput = {
    request_date: isoDay(o.request_date),
    customer_id: o.customer_id,
    address_id: o.address_id,
    term_id: o.term_id,
    price_mode: o.price_mode,
    is_taxable: o.is_taxable,
    withholding_tax_id: o.withholding_tax_id,
    po_no: o.po_no ?? "",
    po_date: isoDay(o.po_date),
    salesperson: o.salesperson ?? "",
    product_name: o.product_name,
    note: o.note ?? "",
  };
  const lines: PermitRequestLineInput[] = [...o.lines]
    .filter((l) => !l.is_added)
    .sort((a, b) => a.line_no - b.line_no)
    .map((l) => ({ permit_type_id: l.permit_type_id, description: l.description, estimate_price: l.estimate_price.toNumber() }));
  return { header, lines };
}

export type PermitRequestTransitionResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle step. **Ajukan** re-checks the stored Draft against
 * today's masters and freezes its figures with the PPN rate in force (P60).
 * Setujui changes only the status. Tolak and Batalkan ask for a reason;
 * Batalkan of an approved Pengajuan is handed the advance module's check by
 * the caller, so this module never reads its table. **Realisasikan** needs the
 * realisation entered (`saveRealization`) and gives it its `RLZ/…` number.
 * Every step is conditional on the status just read.
 */
export async function transitionPermitRequest(
  id: number,
  action: PermitRequestAction,
  actorId: number,
  reason?: string,
  guard?: (tx: Prisma.TransactionClient, id: number) => Promise<string | null>
): Promise<PermitRequestTransitionResult> {
  const row = await prisma.salPermitRequest.findUnique({ where: { id }, include: { lines: true } });
  if (!row) return { ok: false, errors: { _form: "Pengajuan Perizinan tidak ditemukan." } };
  const t = PERMIT_REQUEST_TRANSITIONS[action];
  if (!permitRequestTransitionAllowed(action, row.status as PermitRequestStatus)) {
    return { ok: false, errors: { _form: `Pengajuan berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  const from = row.status;
  const moved = "Pengajuan Perizinan berubah saat diproses. Muat ulang halaman.";

  if (t.reason) {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
    let refused: string | null = null;
    await prisma.$transaction(async (tx) => {
      if (guard) {
        await lockPermitRequest(tx, id);
        refused = await guard(tx, id);
        if (refused) return;
      }
      const done = await tx.salPermitRequest.updateMany({
        where: { id, status: from },
        data: { status: t.to, status_reason: why, updated_by: actorId },
      });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", action, actorId);
    });
    return refused ? { ok: false, errors: { _form: refused } } : { ok: true };
  }

  if (action === "approve") {
    await prisma.$transaction(async (tx) => {
      const done = await tx.salPermitRequest.updateMany({ where: { id, status: from }, data: { status: t.to, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", action, actorId);
    });
    return { ok: true };
  }

  if (action === "realize") {
    const problem = realizationProblem(row);
    if (problem) return { ok: false, errors: { _form: `Belum bisa direalisasi: ${problem}` } };
    await prisma.$transaction(async (tx) => {
      const done = await tx.salPermitRequest.updateMany({
        where: { id, status: from },
        data: { status: t.to, realization_no: await nextRealizationNo(tx, row.realization_date!), updated_by: actorId },
      });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", action, actorId);
    });
    return { ok: true };
  }

  // submit
  const input = asInput(row);
  const c = await checkPermitRequest(input.header, input.lines);
  if (!c.ok) {
    const first = Object.entries(c.errors).find(([k]) => k !== "_lines")?.[1] ?? c.errors._lines;
    return { ok: false, errors: { _form: `Belum bisa diajukan: ${first}` } };
  }
  await prisma.$transaction(async (tx) => {
    const done = await tx.salPermitRequest.updateMany({
      where: { id, status: from },
      data: {
        status: t.to,
        ...estimateData(c.totals),
        ...rateData(c.rates),
        withholding_rate: c.header.withholding_rate,
        updated_by: actorId,
      },
    });
    if (done.count !== 1) throw new Error(moved);
    await audit(tx, id, "UPDATE", action, actorId);
  });
  return { ok: true };
}

// ------------------------------------------------------------- realisation

const ratesOf = (o: { ppn_rate: Prisma.Decimal | null; ppn_dpp_other_numerator: number | null; ppn_dpp_other_denominator: number | null }) =>
  o.ppn_rate && o.ppn_dpp_other_numerator && o.ppn_dpp_other_denominator
    ? { rate: o.ppn_rate.toNumber(), otherNum: o.ppn_dpp_other_numerator, otherDen: o.ppn_dpp_other_denominator }
    : null;

/** Why a stored realisation cannot be locked yet, or null. */
function realizationProblem(o: StoredRequest): string | null {
  if (!o.realization_date) return "Tanggal Realisasi belum diisi — Input Realisasi dulu.";
  if (o.lines.some((l) => l.realized_price == null)) return "isi harga realisasi setiap perizinan — 0 bila tidak jadi diurus.";
  if (!(o.realized_amount.toNumber() > 0)) return "total realisasi harus lebih dari nol.";
  return null;
}

/**
 * Records the real price of each permit (Z7): estimated permits keep their
 * estimate, locked, and take a realised price (0 = not done); permits not
 * estimated are added at estimate 0 and must have a price. Allowed on an
 * approved Pengajuan and, until an Invoice or a cost payment names it, on a
 * realised one — the `guard` is the action's composition of those two
 * modules' answers (Z8). Posts nothing.
 */
export async function saveRealization(
  id: number,
  input: PermitRealizationInput,
  actorId: number,
  guard?: (tx: Prisma.TransactionClient, id: number) => Promise<string | null>
): Promise<PermitRequestResult> {
  const row = await prisma.salPermitRequest.findUnique({ where: { id }, include: { lines: true } });
  if (!row) return { ok: false, errors: { _form: "Pengajuan Perizinan tidak ditemukan." } };
  if (row.status !== "Open" && row.status !== "Realized") {
    return { ok: false, errors: { _form: "Realisasi dicatat pada Pengajuan yang sudah disetujui." } };
  }

  const errors: Record<string, string> = {};
  const date = String(input.realization_date ?? "").trim();
  if (!DAY.test(date)) errors.realization_date = "Tanggal Realisasi wajib diisi.";
  else if (date < isoDay(row.request_date)) errors.realization_date = `Tidak boleh sebelum tanggal Pengajuan.`;

  const estimated = new Map(row.lines.filter((l) => !l.is_added).map((l) => [l.permit_type_id, l]));
  const addedIds = [...new Set(input.lines.filter((l) => l.is_added).map((l) => Number(l.permit_type_id)).filter(Boolean))];
  const types = new Map((await prisma.refPermitType.findMany({ where: { id: { in: addedIds } } })).map((t) => [t.id, t]));
  const prices = new Map<number, number>();
  const added: { permit_type_id: number; description: string; realized_price: number }[] = [];
  const seen = new Set<number>();
  for (const [i, l] of input.lines.entries()) {
    const typeId = Number(l.permit_type_id);
    const price = Number(l.realized_price);
    if (seen.has(typeId)) {
      errors[lineKey(i, "permit_type_id")] = "Perizinan ini sudah ada di pengajuan.";
      continue;
    }
    seen.add(typeId);
    if (l.realized_price == null || String(l.realized_price) === "" || !Number.isFinite(price) || price < 0) {
      errors[lineKey(i, "realized_price")] = "Isi harga realisasi — 0 bila tidak jadi diurus.";
      continue;
    }
    if (!Number.isInteger(price)) {
      errors[lineKey(i, "realized_price")] = "Harga realisasi dalam rupiah penuh.";
      continue;
    }
    if (!l.is_added) {
      if (!estimated.has(typeId)) errors[lineKey(i, "permit_type_id")] = "Perizinan ini tidak ada di estimasi.";
      else prices.set(typeId, price);
      continue;
    }
    const t = types.get(typeId);
    if (!t || t.status !== "Active") {
      errors[lineKey(i, "permit_type_id")] = t ? `${t.permit_label} sudah nonaktif.` : "Pilih perizinan.";
      continue;
    }
    if (estimated.has(typeId)) {
      errors[lineKey(i, "permit_type_id")] = `${t.permit_label} sudah ada di estimasi.`;
      continue;
    }
    if (!(price > 0)) {
      errors[lineKey(i, "realized_price")] = "Perizinan tambahan harus memiliki harga realisasi.";
      continue;
    }
    added.push({ permit_type_id: t.id, description: String(l.description ?? "").trim() || t.permit_name, realized_price: price });
  }
  for (const typeId of estimated.keys()) {
    if (!prices.has(typeId) && !Object.keys(errors).some((k) => k.startsWith("lines."))) {
      errors._lines = "Setiap perizinan yang diestimasi harus memiliki harga realisasi.";
    }
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";

  const all = [...prices.values(), ...added.map((a) => a.realized_price)];
  const totals = computePermitTotals({
    prices: all,
    mode: row.price_mode as PriceMode,
    taxable: row.is_taxable,
    rates: ratesOf(row),
    withholdingRate: row.withholding_rate?.toNumber() ?? null,
  });
  if (!errors._lines && !(totals.amount > 0)) errors._lines = "Total realisasi harus lebih dari nol.";
  if (Object.keys(errors).length) return { ok: false, errors };

  let refused: string | null = null;
  await prisma.$transaction(async (tx) => {
    await lockPermitRequest(tx, id);
    if (guard) {
      refused = await guard(tx, id);
      if (refused) return;
    }
    const fresh = await tx.salPermitRequest.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (fresh.status !== "Open" && fresh.status !== "Realized") {
      refused = "Pengajuan Perizinan berubah saat diproses. Muat ulang halaman.";
      return;
    }
    for (const [typeId, price] of prices) {
      await tx.salPermitRequestLine.updateMany({
        where: { request_id: id, permit_type_id: typeId, is_added: false },
        data: { realized_price: price },
      });
    }
    await tx.salPermitRequestLine.deleteMany({ where: { request_id: id, is_added: true } });
    const base = row.lines.filter((l) => !l.is_added).length;
    for (const [i, a] of added.entries()) {
      await tx.salPermitRequestLine.create({
        data: { request_id: id, line_no: base + i + 1, ...a, estimate_price: 0, is_added: true },
      });
    }
    await tx.salPermitRequest.update({
      where: { id },
      data: {
        realization_date: asDate(date),
        realization_note: String(input.realization_note ?? "").trim() || null,
        realized_amount: totals.amount,
        realized_dpp: totals.dpp,
        realized_dpp_other: totals.dppOther,
        realized_ppn: totals.ppn,
        realized_total: totals.total,
        updated_by: actorId,
      },
    });
    await audit(tx, id, "UPDATE", "realization", actorId);
  });
  if (refused) return { ok: false, errors: { _form: refused } };
  return { ok: true, id, requestNo: row.request_no };
}

// ------------------------------------------------------------------- reads

export type PermitRequestListRow = {
  id: number;
  requestNo: string;
  requestDate: string;
  customerLabel: string;
  customerName: string;
  productName: string;
  realizationNo: string | null;
  /** The realised total once realised, the estimate before. */
  total: number;
  status: PermitRequestStatus;
};

export async function listPermitRequests(): Promise<PermitRequestListRow[]> {
  const rows = await prisma.salPermitRequest.findMany({
    orderBy: [{ request_date: "desc" }, { id: "desc" }],
    include: { customer: true },
  });
  return rows.map((r) => ({
    id: r.id,
    requestNo: r.request_no,
    requestDate: isoDay(r.request_date),
    customerLabel: r.customer.partner_label,
    customerName: r.customer.partner_name,
    productName: r.product_name,
    realizationNo: r.realization_no,
    total: (r.realization_no ? r.realized_total : r.estimate_total).toNumber(),
    status: r.status as PermitRequestStatus,
  }));
}

export type PermitRequestLineView = {
  id: number;
  permitTypeId: number;
  permitLabel: string;
  permitName: string;
  description: string;
  estimatePrice: number;
  realizedPrice: number | null;
  isAdded: boolean;
};

export type PermitFigures = { amount: number; dpp: number; dppOther: number; ppn: number; total: number };

export type PermitRequestView = {
  id: number;
  requestNo: string;
  status: PermitRequestStatus;
  header: PermitRequestHeaderInput;
  lines: PermitRequestLineView[];
  customerLabel: string;
  customerName: string;
  addressText: string;
  termLabel: string;
  termName: string;
  withholdingLabel: string | null;
  withholdingRate: number | null;
  statusReason: string | null;
  rates: PpnRates | null;
  estimate: PermitFigures;
  realization: {
    no: string | null;
    date: string;
    note: string;
    /** Entered at least once (Input Realisasi saved). */
    entered: boolean;
    figures: PermitFigures;
  };
  costPaid: number;
};

export async function getPermitRequest(id: number): Promise<PermitRequestView | null> {
  const o = await prisma.salPermitRequest.findUnique({
    where: { id },
    include: {
      customer: true,
      term: true,
      withholding_tax: true,
      address: { include: ADDRESS_INCLUDE },
      lines: { include: { permit_type: true }, orderBy: { line_no: "asc" } },
    },
  });
  if (!o) return null;
  const input = asInput(o);
  return {
    id: o.id,
    requestNo: o.request_no,
    status: o.status as PermitRequestStatus,
    header: input.header,
    lines: o.lines.map((l) => ({
      id: l.id,
      permitTypeId: l.permit_type_id,
      permitLabel: l.permit_type.permit_label,
      permitName: l.permit_type.permit_name,
      description: l.description,
      estimatePrice: l.estimate_price.toNumber(),
      realizedPrice: l.realized_price?.toNumber() ?? null,
      isAdded: l.is_added,
    })),
    customerLabel: o.customer.partner_label,
    customerName: o.customer.partner_name,
    addressText: addressText(o.address),
    termLabel: o.term.term_label,
    termName: o.term.term_name,
    withholdingLabel: o.withholding_tax?.wht_label ?? null,
    withholdingRate: o.withholding_rate?.toNumber() ?? null,
    statusReason: o.status_reason,
    rates: ratesOf(o),
    estimate: {
      amount: o.estimate_amount.toNumber(),
      dpp: o.estimate_dpp.toNumber(),
      dppOther: o.estimate_dpp_other.toNumber(),
      ppn: o.estimate_ppn.toNumber(),
      total: o.estimate_total.toNumber(),
    },
    realization: {
      no: o.realization_no,
      date: isoDay(o.realization_date),
      note: o.realization_note ?? "",
      entered: Boolean(o.realization_date),
      figures: {
        amount: o.realized_amount.toNumber(),
        dpp: o.realized_dpp.toNumber(),
        dppOther: o.realized_dpp_other.toNumber(),
        ppn: o.realized_ppn.toNumber(),
        total: o.realized_total.toNumber(),
      },
    },
    costPaid: o.cost_paid_amount.toNumber(),
  };
}

/** Pengajuan numbers by id, for the audit panel and the documents that name one. */
export async function permitRequestNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.salPermitRequest.findMany({ where: { id: { in: ids } }, select: { id: true, request_no: true } });
  return new Map(rows.map((r) => [r.id, r.request_no]));
}

/** Locks a Pengajuan's row for the rest of the transaction. */
export async function lockPermitRequest(tx: Prisma.TransactionClient, id: number): Promise<void> {
  await tx.$queryRaw`SELECT id FROM sal_permit_request WHERE id = ${id} FOR UPDATE`;
}

// ------------------------------------------------------ for the advance bill

/**
 * A Pengajuan as its Uang Muka Perizinan reads it (Z10, Z11): who it is for,
 * where it is billed, and the basis the advance is drawn from — the
 * **estimate**, its price mode and its one Jenis PPh. Shaped like the Customer
 * Order's `AdvanceSourceOrder` so the advance form reads both alike. The
 * advance module takes this rather than reading `sal_permit_request` itself.
 */
export type PermitAdvanceSource = {
  id: number;
  orderNo: string;
  orderDate: string;
  status: PermitRequestStatus;
  customerId: number;
  customerLabel: string;
  customerName: string;
  customerActive: boolean;
  taxIdType: string | null;
  taxId: string | null;
  isPkp: boolean;
  collectsPph22: boolean;
  addressId: number;
  addressText: string;
  poNo: string | null;
  poDate: string;
  termLabel: string;
  termName: string;
  termDays: number;
  salesperson: string | null;
  productName: string;
  /** How many permits the Pengajuan lists, for the bill's one-line summary. */
  lineCount: number;
  realizationNo: string | null;
  basis: AdvanceBasis;
  withholdingTaxId: number | null;
  withholdingRate: number | null;
  withholdingLabels: Record<string, string>;
  rates: PpnRates | null;
  /** The realisation, once realised: what the Invoice bills and the cost paid. */
  realized: PermitFigures;
  costPaid: number;
};

/** Pengajuan an advance may be drawn from (approved or realised, not yet invoiced), or the ones named. */
export async function permitAdvanceSources(
  filter: { ids?: number[]; openOnly?: boolean; realizedOnly?: boolean },
  db: Db = prisma
): Promise<PermitAdvanceSource[]> {
  const rows = await db.salPermitRequest.findMany({
    where: {
      ...(filter.ids ? { id: { in: filter.ids } } : {}),
      ...(filter.openOnly ? { status: { in: ["Open", "Realized"] } } : {}),
      ...(filter.realizedOnly ? { status: "Realized" } : {}),
    },
    orderBy: [{ request_date: "desc" }, { id: "desc" }],
    include: { customer: true, term: true, withholding_tax: true, address: { include: ADDRESS_INCLUDE }, _count: { select: { lines: true } } },
  });
  return rows.map((o) => {
    const whtKey = o.withholding_tax_id ? String(o.withholding_tax_id) : null;
    const whtRate = o.withholding_rate?.toNumber() ?? null;
    return {
      id: o.id,
      orderNo: o.request_no,
      orderDate: isoDay(o.request_date),
      status: o.status as PermitRequestStatus,
      customerId: o.customer_id,
      customerLabel: o.customer.partner_label,
      customerName: o.customer.partner_name,
      customerActive: o.customer.status === "Active",
      taxIdType: o.customer.tax_id_type,
      taxId: o.customer.tax_id,
      isPkp: o.customer.is_pkp,
      collectsPph22: false,
      addressId: o.address_id,
      addressText: addressText(o.address),
      poNo: o.po_no,
      poDate: isoDay(o.po_date),
      termLabel: o.term.term_label,
      termName: o.term.term_name,
      termDays: o.term.due_days,
      salesperson: o.salesperson,
      productName: o.product_name,
      lineCount: o._count.lines,
      realizationNo: o.realization_no,
      basis: {
        mode: o.price_mode as PriceMode,
        taxable: o.is_taxable,
        vatCollector: o.customer.vat_collector === "Government",
        dpp: o.estimate_dpp.toNumber(),
        total: o.estimate_total.toNumber(),
        withholdings: whtKey && whtRate ? [{ key: whtKey, rate: whtRate, base: o.estimate_dpp.toNumber() }] : [],
      },
      withholdingTaxId: o.withholding_tax_id,
      withholdingRate: whtRate,
      withholdingLabels: whtKey ? { [whtKey]: o.withholding_tax?.wht_label ?? "PPh" } : {},
      rates: ratesOf(o),
      realized: {
        amount: o.realized_amount.toNumber(),
        dpp: o.realized_dpp.toNumber(),
        dppOther: o.realized_dpp_other.toNumber(),
        ppn: o.realized_ppn.toNumber(),
        total: o.realized_total.toNumber(),
      },
      costPaid: o.cost_paid_amount.toNumber(),
    };
  });
}

// ------------------------------------------------------- for the cost payment

/**
 * A realised Pengajuan as *Biaya Perizinan* pays it (Z12–Z14): its realised
 * DPP is the cost, paid as one lump — possibly in parts — with no tax; what
 * posted payments paid is kept here as `cost_paid_amount` (P132). The payment
 * module takes this rather than reading `sal_permit_request` itself.
 */
export type PermitCostDoc = {
  id: number;
  requestNo: string;
  realizationNo: string;
  realizationDate: string;
  status: PermitRequestStatus;
  customerId: number;
  productName: string;
  /** The realised DPP. */
  cost: number;
  paid: number;
};

export async function permitCostDocs(filter: { ids?: number[]; openOnly?: boolean }, db: Db = prisma): Promise<PermitCostDoc[]> {
  const rows = await db.salPermitRequest.findMany({
    where: {
      ...(filter.ids ? { id: { in: filter.ids } } : {}),
      ...(filter.openOnly ? { status: { in: ["Realized", "Done"] } } : {}),
    },
    orderBy: [{ realization_date: "asc" }, { id: "asc" }],
  });
  return rows
    .map((o) => ({
      id: o.id,
      requestNo: o.request_no,
      realizationNo: o.realization_no ?? o.request_no,
      realizationDate: isoDay(o.realization_date ?? o.request_date),
      status: o.status as PermitRequestStatus,
      customerId: o.customer_id,
      productName: o.product_name,
      cost: o.realized_dpp.toNumber(),
      paid: o.cost_paid_amount.toNumber(),
    }))
    .filter((d) => !filter.openOnly || d.paid < d.cost);
}

/** Locks Pengajuan rows in id order, so two cost payments cannot both pay the last of one. */
export async function lockPermitRequests(tx: Prisma.TransactionClient, ids: number[]): Promise<void> {
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) await lockPermitRequest(tx, id);
}

/** Adds what one posted cost payment paid (P132), refused beyond the realised DPP. */
export async function recordPermitCostPaid(tx: Prisma.TransactionClient, id: number, amount: number): Promise<void> {
  const o = await tx.salPermitRequest.findUnique({ where: { id }, select: { request_no: true, status: true, realized_dpp: true, cost_paid_amount: true } });
  if (!o || (o.status !== "Realized" && o.status !== "Done")) throw new Error("Pengajuan Perizinan belum direalisasi.");
  const paid = o.cost_paid_amount.toNumber() + amount;
  if (amount <= 0 || paid > o.realized_dpp.toNumber()) throw new Error(`Pembayaran melebihi sisa biaya ${o.request_no}.`);
  await tx.salPermitRequest.update({ where: { id }, data: { cost_paid_amount: paid } });
}
