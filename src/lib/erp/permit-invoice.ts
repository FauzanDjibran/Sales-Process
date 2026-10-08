import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "./currency";
import { nextDocumentNumber, taxSeriesPrefix } from "./document-number";
import { checkTransactionDate } from "./fiscal";
import { PostingDryRun, describeJournalLines, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { checkAccountIsLeaf } from "./records";
import { ArItemOverdrawn, advanceItemsForInvoice, createArItem, settleArItem, type AdvanceItemForInvoice } from "./ar-item";
import { lockPermitRequest, markPermitRequestInvoiced, permitAdvanceSources, type PermitAdvanceSource } from "./permit-request";
import { permitAdvanceRatesByIds } from "./permit-advance";
import { advancePpnUsed, computeInvoice, withholdingsOf, type InvoiceFigures } from "./sales-tax";
import { postingAccounts } from "./system-settings";
import {
  PERMIT_INVOICE_TRANSITIONS,
  invoiceIsEditable,
  invoiceTransitionAllowed,
  type InvoiceAction,
  type InvoiceStatus,
} from "./ar-invoice-workflow";

/**
 * Invoice Perizinan (P137, Perizinan-Concept.md §9): its tables are
 * `fin_ar_permit_invoice` and `fin_ar_permit_invoice_advance_deduction`, and
 * nothing else names them.
 *
 * It bills one realised Pengajuan Perizinan, at most one live Invoice each,
 * **header-only**: the customer sees one line, its Uraian (Z1); the permits stay
 * on the Pengajuan. Its figures are `computeInvoice` over that one line held in
 * memory, so the goods Invoice's arithmetic — full PPN less the advances'
 * (P113), the advance's PPN recalculated (P118), PPh on the net DPP (P119) —
 * applies unchanged. Posting mirrors the goods Invoice (P117) with Pendapatan
 * Perizinan and Uang Muka Perizinan, and marks the Pengajuan Selesai.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type PermitInvoiceInput = {
  permit_request_id: number | null;
  invoice_date: string;
  address_id: number | null;
  cash_bank_id: number | null;
  description: string;
  note: string;
};

export type PermitInvoiceDeductionInput = { ar_item_id: number | null; dpp_used: number | string };

export type PermitInvoiceResult = { ok: true; id: number; invoiceNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const money = (n: number) => formatMoney(n, BASE_CURRENCY_LABEL);
const LIVE: InvoiceStatus[] = ["Draft", "Posted"];

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

export const permitInvoiceDescription = (s: { productName: string; realizationNo: string | null }) =>
  `Jasa pengurusan perizinan — ${s.productName}${s.realizationNo ? ` · realisasi ${s.realizationNo}` : ""}`;

// ---------------------------------------------------------------- options

export type PermitInvoiceAdvance = AdvanceItemForInvoice & {
  /** What other live Draft invoices reserve of it. */
  reserved: number;
};

export type PermitInvoiceSource = PermitAdvanceSource & {
  addresses: { id: number; text: string; isBilling: boolean }[];
  advances: PermitInvoiceAdvance[];
};

export type PermitInvoiceOptions = {
  sources: PermitInvoiceSource[];
  banks: { id: number; label: string; name: string; active: boolean }[];
};

/** Live invoices of each Pengajuan other than `selfId`. */
async function liveInvoices(db: Db, requestIds: number[], selfId: number | null) {
  return db.finArPermitInvoice.findMany({
    where: { permit_request_id: { in: requestIds }, status: { in: LIVE }, ...(selfId ? { id: { not: selfId } } : {}) },
    select: { id: true, invoice_no: true, permit_request_id: true },
  });
}

/** What Draft invoices other than `selfId` reserve of each Uang Muka item. */
async function reservedByDrafts(db: Db, itemIds: number[], selfId: number | null): Promise<Map<number, number>> {
  if (!itemIds.length) return new Map();
  const rows = await db.finArPermitInvoiceAdvanceDeduction.findMany({
    where: { ar_item_id: { in: itemIds }, invoice: { status: "Draft", ...(selfId ? { id: { not: selfId } } : {}) } },
    select: { ar_item_id: true, dpp_used: true },
  });
  const out = new Map<number, number>();
  for (const r of rows) out.set(r.ar_item_id, (out.get(r.ar_item_id) ?? 0) + r.dpp_used.toNumber());
  return out;
}

async function sourcesFor(db: Db, list: PermitAdvanceSource[], selfId: number | null, keepItemIds: number[] = []): Promise<PermitInvoiceSource[]> {
  if (!list.length) return [];
  const [addresses, items] = await Promise.all([
    db.mPartnerAddress.findMany({
      where: { partner_id: { in: [...new Set(list.map((s) => s.customerId))] } },
      orderBy: [{ sort_order: "asc" }, { id: "asc" }],
      include: { village: { include: { district: { include: { city: { include: { province: true } } } } } } },
    }),
    advanceItemsForInvoice({ scope: { table: "sal_permit_request", ids: list.map((s) => s.id) } }, db),
  ]);
  const kept = keepItemIds.length ? await advanceItemsForInvoice({ ids: keepItemIds }, db) : [];
  const allItems = [...items, ...kept.filter((k) => !items.some((i) => i.id === k.id))];
  const reserved = await reservedByDrafts(db, allItems.map((i) => i.id), selfId);
  const text = (a: (typeof addresses)[number]) => {
    const d = a.village.district;
    return [d.city.province.name, d.city.name, d.name, a.village.name, a.street, a.village.postal_code].filter(Boolean).join(", ");
  };
  return list.map((s) => ({
    ...s,
    addresses: addresses.filter((a) => a.partner_id === s.customerId).map((a) => ({ id: a.id, text: text(a), isBilling: a.is_billing })),
    advances: allItems.filter((i) => i.scopeTable === "sal_permit_request" && i.scopeId === s.id).map((i) => ({ ...i, reserved: reserved.get(i.id) ?? 0 })),
  }));
}

/** Realised Pengajuan not yet billed by a live invoice — or, when editing, the invoice's own. */
export async function permitInvoiceOptions(current: { id: number; requestId: number; itemIds: number[] } | null = null): Promise<PermitInvoiceOptions> {
  const [list, banks] = await Promise.all([
    permitAdvanceSources(current ? { ids: [current.requestId] } : { realizedOnly: true }),
    prisma.mCashBank.findMany({ where: { cash_bank_type: "Bank", currency: { currency_label: BASE_CURRENCY_LABEL } }, orderBy: { cash_bank_label: "asc" } }),
  ]);
  const billed = new Set((await liveInvoices(prisma, list.map((s) => s.id), current?.id ?? null)).map((v) => v.permit_request_id));
  const open = current ? list : list.filter((s) => !billed.has(s.id));
  return {
    sources: await sourcesFor(prisma, open, current?.id ?? null, current?.itemIds ?? []),
    banks: banks.map((b) => ({ id: b.id, label: b.cash_bank_label, name: b.cash_bank_name, active: b.status === "Active" })),
  };
}

// ------------------------------------------------------------- validation

type CheckedDeduction = { ar_item_id: number; ar_item_no: string; dpp_used: number; ppn_used: number };

export type CheckedPermitInvoice = {
  source: PermitInvoiceSource;
  figures: InvoiceFigures;
  data: {
    permit_request_id: number;
    customer_id: number;
    address_id: number;
    cash_bank_id: number;
    description: string;
    invoice_date: Date;
    tax_date: Date;
    due_date: Date;
    price_mode: "Exclude" | "Include";
    is_taxable: boolean;
    ppn_rate: number | null;
    ppn_dpp_other_numerator: number | null;
    ppn_dpp_other_denominator: number | null;
    withholding_tax_id: number | null;
    withholding_rate: number | null;
    amount: number;
    dpp_amount: number;
    advance_dpp_amount: number;
    advance_ppn_amount: number;
    net_dpp_amount: number;
    dpp_other_amount: number;
    full_ppn_amount: number;
    ppn_amount: number;
    total_amount: number;
    note: string | null;
  };
  deductions: CheckedDeduction[];
};

/** The invoice's one line, as `computeInvoice` reads a line: the realised amount, once. */
function oneLine(s: PermitAdvanceSource) {
  const amount = s.realized.amount;
  return {
    qty: 1,
    orderQty: 1,
    orderGross: amount,
    orderDiscount: 0,
    price: amount,
    discountType: null,
    discountValue: null,
    billedQtyBefore: 0,
    withholdingRate: s.withholdingRate,
    withholdingKey: s.withholdingTaxId ? String(s.withholdingTaxId) : null,
  };
}

/**
 * Every rule an Invoice Perizinan must satisfy to be saved — and, run again in
 * the posting transaction with the Pengajuan locked, to be posted.
 */
export async function checkPermitInvoice(
  db: Db,
  input: PermitInvoiceInput,
  deductions: PermitInvoiceDeductionInput[],
  selfId: number | null,
  keepItemIds: number[] = []
): Promise<{ ok: true; c: CheckedPermitInvoice } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const requestId = Number(input.permit_request_id) || null;
  const [found] = requestId ? await permitAdvanceSources({ ids: [requestId] }, db) : [];
  const [source] = found ? await sourcesFor(db, [found], selfId, keepItemIds) : [];
  if (!requestId) errors.permit_request_id = "Pilih Pengajuan Perizinan.";
  else if (!source) errors.permit_request_id = "Pengajuan Perizinan tidak ditemukan.";
  else if (source.status !== "Realized") errors.permit_request_id = "Pengajuan Perizinan harus berstatus Terealisasi dan belum ditagih.";
  else if (!source.customerActive) errors.permit_request_id = "Customer pada Pengajuan ini sudah nonaktif.";
  else {
    const other = await liveInvoices(db, [source.id], selfId);
    if (other.length) errors.permit_request_id = `Pengajuan ini sudah ditagih dengan ${other[0].invoice_no}.`;
  }

  const date = String(input.invoice_date ?? "").trim();
  if (!DAY.test(date)) errors.invoice_date = "Tanggal invoice wajib diisi.";
  else if (source?.realizationDate && date < source.realizationDate) errors.invoice_date = "Tidak boleh sebelum tanggal realisasi.";

  const addressId = Number(input.address_id) || null;
  if (!addressId) errors.address_id = "Pilih alamat penagihan.";
  else if (source && !source.addresses.some((a) => a.id === addressId)) errors.address_id = "Alamat bukan milik customer ini.";
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
  if (!description) errors.description = "Uraian wajib diisi — satu baris yang tercetak pada invoice.";

  // ---- Uang Muka used: the Pengajuan's own items, each up to what is free of it
  const line = source ? [oneLine(source)] : [];
  const before = source ? computeInvoice({ lines: line, mode: source.basis.mode, taxable: source.basis.taxable, rates: source.rates, advanceUsed: 0 }) : null;
  const itemById = new Map((source?.advances ?? []).map((a) => [a.id, a]));
  const checked: CheckedDeduction[] = [];
  const index: number[] = [];
  const seen = new Set<number>();
  for (const [i, d] of (Array.isArray(deductions) ? deductions : []).entries()) {
    const id = Number(d.ar_item_id) || null;
    const item = id ? itemById.get(id) : undefined;
    if (!id || !item) {
      errors[`deductions.${i}.ar_item_id`] = "Uang muka bukan milik Pengajuan ini.";
      continue;
    }
    if (seen.has(id)) {
      errors[`deductions.${i}.ar_item_id`] = `${item.arItemNo} dipilih lebih dari sekali.`;
      continue;
    }
    seen.add(id);
    const used = Number(String(d.dpp_used ?? "").replace(",", "."));
    const free = Math.max(0, item.balance - item.reserved);
    const key = `deductions.${i}.dpp_used`;
    if (!Number.isFinite(used) || !(used > 0)) errors[key] = "Isi DPP yang dipakai lebih dari 0.";
    else if (used !== Math.round(used)) errors[key] = "DPP dipakai harus dalam rupiah penuh.";
    else if (used > free) errors[key] = `Melebihi sisa uang muka (${money(free)}${item.reserved ? `; ${money(item.reserved)} dicadangkan invoice Draft lain` : ""}).`;
    else {
      const ppnUsed = source?.basis.taxable ? advancePpnUsed({ rates: source.rates, usedBefore: item.original - item.balance, used }) : 0;
      checked.push({ ar_item_id: id, ar_item_no: item.arItemNo, dpp_used: used, ppn_used: ppnUsed });
      index.push(i);
    }
  }
  // Full PPN less the advance's PPN holds only while the rates are the advance's (P113).
  if (source?.basis.taxable && source.rates && checked.length) {
    const billOf = new Map(source.advances.map((a) => [a.id, a.sourceId]));
    const rates = await permitAdvanceRatesByIds([...new Set(checked.map((d) => billOf.get(d.ar_item_id) ?? 0))], db);
    const r = source.rates;
    checked.forEach((d, k) => {
      const b = rates.get(billOf.get(d.ar_item_id) ?? 0);
      if (b && (b.rate !== r.rate || b.otherNum !== r.otherNum || b.otherDen !== r.otherDen)) {
        errors[`deductions.${index[k]}.ar_item_id`] = `Tarif PPN ${d.ar_item_no} berbeda dengan invoice: PPN penuh dikurangi PPN uang muka hanya berlaku bila tarifnya sama.`;
      }
    });
  }
  const used = checked.reduce((a, d) => a + d.dpp_used, 0);
  if (before && used > before.dpp) errors._deductions = `Uang muka dipakai (${money(used)}) melebihi DPP invoice (${money(before.dpp)}).`;
  else if (Object.keys(errors).some((k) => k.startsWith("deductions."))) errors._deductions = "Ada uang muka yang perlu diperbaiki.";

  if (Object.keys(errors).length || !source) return { ok: false, errors };

  const figures = computeInvoice({
    lines: line,
    mode: source.basis.mode,
    taxable: source.basis.taxable,
    rates: source.rates,
    advanceUsed: used,
    advancePpn: checked.reduce((a, d) => a + d.ppn_used, 0),
  });
  return {
    ok: true,
    c: {
      source,
      figures,
      data: {
        permit_request_id: source.id,
        customer_id: source.customerId,
        address_id: addressId!,
        cash_bank_id: bankId!,
        description,
        invoice_date: asDate(date),
        // A service's PPN is due when its completion is billed (Z15).
        tax_date: asDate(date),
        due_date: asDate(addDays(date, source.termDays)),
        price_mode: source.basis.mode,
        is_taxable: source.basis.taxable,
        ppn_rate: source.rates?.rate ?? null,
        ppn_dpp_other_numerator: source.rates?.otherNum ?? null,
        ppn_dpp_other_denominator: source.rates?.otherDen ?? null,
        withholding_tax_id: source.withholdingTaxId,
        withholding_rate: source.withholdingRate,
        amount: figures.amount,
        dpp_amount: figures.dpp,
        advance_dpp_amount: figures.advanceUsed,
        advance_ppn_amount: figures.advancePpn,
        net_dpp_amount: figures.netDpp,
        dpp_other_amount: figures.dppOther,
        full_ppn_amount: figures.fullPpn,
        ppn_amount: figures.ppn,
        total_amount: figures.total,
        note: String(input.note ?? "").trim() || null,
      },
      deductions: checked,
    },
  };
}

// ------------------------------------------------------------------ writes

async function nextInvoiceNo(db: Db, date: Date, isTaxable: boolean): Promise<string> {
  return nextDocumentNumber(taxSeriesPrefix("INP", isTaxable), date, async (series) => {
    const row = await db.finArPermitInvoice.findFirst({ where: { invoice_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { invoice_no: true } });
    return row?.invoice_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "fin_ar_permit_invoice", row_id: id, action, event, by } });
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
    if (e instanceof PostingDryRun) return { ok: true, journal: e.lines } as T;
    throw e;
  }
}

async function writeDeductions(tx: Prisma.TransactionClient, id: number, c: CheckedPermitInvoice) {
  await tx.finArPermitInvoiceAdvanceDeduction.deleteMany({ where: { invoice_id: id } });
  for (const d of c.deductions) await tx.finArPermitInvoiceAdvanceDeduction.create({ data: { ...d, invoice_id: id } });
}

export async function createPermitInvoice(
  input: PermitInvoiceInput,
  deductions: PermitInvoiceDeductionInput[],
  actorId: number
): Promise<PermitInvoiceResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const requestId = Number(input.permit_request_id) || null;
      if (requestId) await lockPermitRequest(tx, requestId);
      const r = await checkPermitInvoice(tx, input, deductions, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.finArPermitInvoice.create({
        data: { ...r.c.data, invoice_no: await nextInvoiceNo(tx, r.c.data.invoice_date, r.c.data.is_taxable), created_by: actorId },
      });
      await writeDeductions(tx, row.id, r.c);
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, invoiceNo: made.invoice_no };
  });
}

export async function updatePermitInvoice(
  id: number,
  input: PermitInvoiceInput,
  deductions: PermitInvoiceDeductionInput[],
  actorId: number
): Promise<PermitInvoiceResult> {
  const current = await prisma.finArPermitInvoice.findUnique({ where: { id }, select: { status: true, invoice_no: true, permit_request_id: true } });
  if (!current) return { ok: false, errors: { _form: "Invoice Perizinan tidak ditemukan." } };
  if (!invoiceIsEditable(current.status as InvoiceStatus)) return { ok: false, errors: { _form: "Hanya Invoice berstatus Draft yang dapat diubah." } };
  if (Number(input.permit_request_id) !== current.permit_request_id) {
    return { ok: false, errors: { permit_request_id: "Pengajuan tidak dapat diganti. Buat invoice baru untuk Pengajuan lain." } };
  }
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await lockPermitRequest(tx, current.permit_request_id);
      const r = await checkPermitInvoice(tx, input, deductions, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.finArPermitInvoice.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Invoice berubah saat diproses. Muat ulang halaman." });
      await writeDeductions(tx, id, r.c);
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, invoiceNo: current.invoice_no };
  });
}

type Stored = Prisma.FinArPermitInvoiceGetPayload<{ include: { deductions: true } }>;

function asInput(n: Stored) {
  return {
    input: {
      permit_request_id: n.permit_request_id,
      invoice_date: isoDay(n.invoice_date),
      address_id: n.address_id,
      cash_bank_id: n.cash_bank_id,
      description: n.description,
      note: n.note ?? "",
    } satisfies PermitInvoiceInput,
    deductions: n.deductions.map((d) => ({ ar_item_id: d.ar_item_id, dpp_used: d.dpp_used.toNumber() })),
    keep: n.deductions.map((d) => d.ar_item_id),
  };
}

// ----------------------------------------------------------------- posting

export type PermitInvoicePostingLine = {
  accountId: number;
  partnerId: number | null;
  debit: number;
  credit: number;
  description: string;
};

/** What an Invoice Perizinan is born at in Piutang (P117): its full DPP and full PPN. */
const face = (f: InvoiceFigures) => f.dpp + f.fullPpn;

async function accountProblem(db: Db, id: number): Promise<string | null> {
  const a = await db.accAccount.findUnique({ where: { id }, select: { is_postable: true, is_active: true } });
  if (!a) return "tidak ditemukan";
  if (!a.is_postable) return "bukan account postable";
  if (!a.is_active) return "non-aktif";
  return checkAccountIsLeaf(id);
}

/**
 * The journal (Z18): Dr Piutang (face) / Cr Pendapatan Perizinan · Cr PPN
 * Keluaran (full); per Uang Muka used: Dr Uang Muka Perizinan (DPP) · Dr PPN
 * Keluaran (its PPN) / Cr Piutang (both) — the goods Invoice's shape (P117).
 */
async function buildPosting(db: Db, invoiceNo: string, c: CheckedPermitInvoice): Promise<{ ok: true; lines: PermitInvoicePostingLine[] } | { ok: false; missing: string[] }> {
  const f = c.figures;
  const keys = [
    "receivable_account",
    "permit_revenue_account",
    ...(f.advanceUsed > 0 ? (["permit_advance_account"] as const) : []),
    ...(f.fullPpn > 0 ? (["output_vat_account"] as const) : []),
  ] as const;
  const mapped = await postingAccounts([...keys]);
  if (!mapped.ok) return { ok: false, missing: mapped.missing };
  const ids = mapped.ids as Record<string, number>;
  const problems: string[] = [];
  for (const [k, accId] of Object.entries(ids)) {
    const p = await accountProblem(db, accId);
    if (p) problems.push(`${k}: ${p}`);
  }
  if (problems.length) return { ok: false, missing: problems };
  const customer = c.source.customerId;
  const out: PermitInvoicePostingLine[] = [];
  const line = (accountId: number, debit: number, credit: number, description: string, partnerId: number | null = null) =>
    out.push({ accountId, partnerId, debit, credit, description });
  line(ids.receivable_account, face(f), 0, `Piutang ${invoiceNo} — jatuh tempo ${isoDay(c.data.due_date).split("-").reverse().join("/")}`, customer);
  line(ids.permit_revenue_account, 0, f.dpp, `Pendapatan jasa pengurusan perizinan ${c.source.realizationNo ?? c.source.orderNo} (${c.source.orderNo})`);
  if (f.fullPpn > 0) line(ids.output_vat_account, 0, f.fullPpn, `PPN atas jasa perizinan — ${invoiceNo}`);
  for (const d of c.deductions) {
    line(ids.permit_advance_account, d.dpp_used, 0, `Uang muka ${d.ar_item_no} dipakai ${invoiceNo}`, customer);
    if (d.ppn_used > 0) line(ids.output_vat_account, d.ppn_used, 0, `PPN uang muka ${d.ar_item_no} sudah dilaporkan — ${invoiceNo}`);
    line(ids.receivable_account, 0, d.dpp_used + d.ppn_used, `Uang muka ${d.ar_item_no} diterapkan ke ${invoiceNo}`, customer);
  }
  return { ok: true, lines: out };
}

export async function permitInvoicePreview(id: number, actorId: number, afterPost?: (tx: Prisma.TransactionClient) => Promise<void>): Promise<JournalPreviewResult> {
  try {
    const r = await transitionPermitInvoice(id, "post", actorId, undefined, afterPost, { dryRun: true });
    if (!r.ok) return r;
    return { ok: true, lines: await describeJournalLines(r.journal ?? []) };
  } catch (e) {
    if (e instanceof Error) return { ok: false, errors: { _form: e.message } };
    throw e;
  }
}

export type PermitInvoiceTransitionResult = { ok: true; journal?: JournalLineInput[] } | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle step. **Posting**, in one transaction with the Pengajuan
 * locked: rechecks, writes the journal dated Tanggal Invoice, creates the
 * Invoice AR item at its face scoped to the Pengajuan, applies each Uang Muka
 * (P117), marks the Pengajuan Selesai and runs the tax hook (the one-line
 * faktur). **Batalkan** (Draft) asks for a reason.
 */
export async function transitionPermitInvoice(
  id: number,
  action: InvoiceAction,
  actorId: number,
  reason?: string,
  afterPost?: (tx: Prisma.TransactionClient) => Promise<void>,
  options: { dryRun?: boolean } = {}
): Promise<PermitInvoiceTransitionResult> {
  const n = await prisma.finArPermitInvoice.findUnique({ where: { id }, include: { deductions: true } });
  if (!n) return { ok: false, errors: { _form: "Invoice Perizinan tidak ditemukan." } };
  const t = PERMIT_INVOICE_TRANSITIONS[action];
  if (!invoiceTransitionAllowed(action, n.status as InvoiceStatus)) {
    return { ok: false, errors: { _form: `Invoice berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  const moved = "Invoice berubah saat diproses. Muat ulang halaman.";
  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      const done = await tx.finArPermitInvoice.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const period = await checkTransactionDate(isoDay(n.invoice_date));
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  const currency = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!currency) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await lockPermitRequest(tx, n.permit_request_id);
      const s = asInput(n);
      const r = await checkPermitInvoice(tx, s.input, s.deductions, id, s.keep);
      if (!r.ok) {
        const first = Object.entries(r.errors).find(([k]) => !k.startsWith("_"))?.[1] ?? Object.values(r.errors)[0];
        throw new Refused({ _form: `Belum bisa diposting: ${first}` });
      }
      const p = await buildPosting(tx, n.invoice_no, r.c);
      if (!p.ok) throw new Refused({ _form: `Lengkapi Account Mapping dulu: ${p.missing.join(", ")}.` });
      const done = await tx.finArPermitInvoice.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });
      await writeDeductions(tx, id, r.c);

      const typeId = await docTypeId(tx, "fin_ar_permit_invoice");
      const journalLines = p.lines.map((l): JournalLineInput => ({ ...l, currencyId: currency.id, rate: 1 }));
      const journal = await postJournal(tx, {
        description: `${n.invoice_no} · Invoice Perizinan ${r.c.source.orderNo} — ${r.c.source.customerName}`,
        sourceDocTypeId: typeId,
        sourceDocId: id,
        postingDate: r.c.data.invoice_date,
        actorId,
        lines: journalLines,
      });
      const doc = { docTypeId: typeId, docId: id, no: n.invoice_no };
      const date = isoDay(r.c.data.invoice_date);
      const itemId = await createArItem(tx, {
        type: "Invoice",
        partnerId: r.c.source.customerId,
        currencyId: currency.id,
        date,
        dueDate: isoDay(r.c.data.due_date),
        source: doc,
        createdBy: doc,
        scope: { docTypeId: await docTypeId(tx, "sal_permit_request"), docId: r.c.source.id },
        amount: face(r.c.figures),
        note: `Invoice ${n.invoice_no} diposting`,
        actorId,
      });
      for (const d of r.c.deductions) {
        await settleArItem(tx, { itemId: d.ar_item_id, event: "AdvanceUsed", amount: d.dpp_used, date, doc, counterItemId: itemId, note: `Dipakai ${n.invoice_no}`, actorId });
        await settleArItem(tx, {
          itemId,
          event: "AdvanceApplied",
          amount: d.dpp_used + d.ppn_used,
          date,
          doc,
          counterItemId: d.ar_item_id,
          note: `Uang muka ${d.ar_item_no} — DPP ${money(d.dpp_used)}${d.ppn_used ? ` + PPN ${money(d.ppn_used)}` : ""}`,
          actorId,
        });
      }
      await tx.finArPermitInvoice.update({ where: { id }, data: { journal_id: journal.id, ar_item_id: itemId } });
      await markPermitRequestInvoiced(tx, r.c.source.id, actorId);
      await audit(tx, id, "UPDATE", "post", actorId);
      if (afterPost) await afterPost(tx);
      if (options.dryRun) throw new PostingDryRun(journalLines);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

export type PermitInvoiceListRow = {
  id: number;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  status: InvoiceStatus;
  requestNo: string;
  customerLabel: string;
  customerName: string;
  description: string;
  total: number;
  paid: number;
};

export async function listPermitInvoices(): Promise<PermitInvoiceListRow[]> {
  const rows = await prisma.finArPermitInvoice.findMany({ orderBy: [{ invoice_date: "desc" }, { id: "desc" }], include: { customer: true } });
  const sources = new Map((await permitAdvanceSources({ ids: [...new Set(rows.map((r) => r.permit_request_id))] })).map((s) => [s.id, s.orderNo]));
  return rows.map((r) => ({
    id: r.id,
    invoiceNo: r.invoice_no,
    invoiceDate: isoDay(r.invoice_date),
    dueDate: isoDay(r.due_date),
    status: r.status as InvoiceStatus,
    requestNo: sources.get(r.permit_request_id) ?? "",
    customerLabel: r.customer.partner_label,
    customerName: r.customer.partner_name,
    description: r.description,
    total: r.total_amount.toNumber(),
    paid: r.paid_amount.toNumber(),
  }));
}

export type PermitInvoiceView = {
  id: number;
  invoiceNo: string;
  status: InvoiceStatus;
  input: PermitInvoiceInput;
  deductions: { ar_item_id: number; ar_item_no: string; dpp_used: number; ppn_used: number }[];
  dueDate: string;
  taxDate: string;
  bankLabel: string;
  bankName: string;
  cancelReason: string | null;
  journal: { id: number } | null;
  arItemId: number | null;
  figures: { amount: number; dpp: number; advanceDpp: number; advancePpn: number; netDpp: number; dppOther: number; fullPpn: number; ppn: number; total: number };
  paid: number;
};

export async function getPermitInvoice(id: number): Promise<PermitInvoiceView | null> {
  const n = await prisma.finArPermitInvoice.findUnique({ where: { id }, include: { deductions: { orderBy: { id: "asc" } }, cash_bank: true } });
  if (!n) return null;
  return {
    id: n.id,
    invoiceNo: n.invoice_no,
    status: n.status as InvoiceStatus,
    input: asInput(n).input,
    deductions: n.deductions.map((d) => ({ ar_item_id: d.ar_item_id, ar_item_no: d.ar_item_no, dpp_used: d.dpp_used.toNumber(), ppn_used: d.ppn_used.toNumber() })),
    dueDate: isoDay(n.due_date),
    taxDate: isoDay(n.tax_date),
    bankLabel: n.cash_bank.cash_bank_label,
    bankName: n.cash_bank.cash_bank_name,
    cancelReason: n.cancel_reason,
    journal: n.journal_id ? { id: n.journal_id } : null,
    arItemId: n.ar_item_id,
    figures: {
      amount: n.amount.toNumber(),
      dpp: n.dpp_amount.toNumber(),
      advanceDpp: n.advance_dpp_amount.toNumber(),
      advancePpn: n.advance_ppn_amount.toNumber(),
      netDpp: n.net_dpp_amount.toNumber(),
      dppOther: n.dpp_other_amount.toNumber(),
      fullPpn: n.full_ppn_amount.toNumber(),
      ppn: n.ppn_amount.toNumber(),
      total: n.total_amount.toNumber(),
    },
    paid: n.paid_amount.toNumber(),
  };
}

export async function permitInvoiceNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.finArPermitInvoice.findMany({ where: { id: { in: ids } }, select: { id: true, invoice_no: true } });
  return new Map(rows.map((r) => [r.id, r.invoice_no]));
}

/** The live invoice of one Pengajuan, for its page and its realisation lock (Z8). */
export async function permitInvoiceOfRequest(
  requestId: number,
  db: Db = prisma
): Promise<{ id: number; invoiceNo: string; date: string; status: InvoiceStatus; total: number; paid: number } | null> {
  const r = await db.finArPermitInvoice.findFirst({ where: { permit_request_id: requestId, status: { in: LIVE } }, orderBy: { id: "desc" } });
  return r
    ? { id: r.id, invoiceNo: r.invoice_no, date: isoDay(r.invoice_date), status: r.status as InvoiceStatus, total: r.total_amount.toNumber(), paid: r.paid_amount.toNumber() }
    : null;
}

// ------------------------------------------------------- for the receipt

/** Shaped like the goods Invoice's `SettlementInvoice`, so the receipt reads both alike. */
export type SettlementPermitInvoice = {
  id: number;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  status: InvoiceStatus;
  customerId: number;
  orderId: number;
  orderNo: string;
  total: number;
  dpp: number;
  ppn: number;
  withholdings: { key: string; rate: number; base: number; amount: number }[];
  arItemId: number | null;
  paid: number;
};

export async function settlementPermitInvoices(filter: { ids?: number[] }, db: Db = prisma): Promise<SettlementPermitInvoice[]> {
  const rows = await db.finArPermitInvoice.findMany({ where: filter.ids ? { id: { in: filter.ids } } : {}, orderBy: [{ due_date: "asc" }, { id: "asc" }] });
  const sources = new Map((await permitAdvanceSources({ ids: [...new Set(rows.map((r) => r.permit_request_id))] }, db)).map((s) => [s.id, s.orderNo]));
  return rows.map((r) => {
    const rate = r.withholding_rate?.toNumber() ?? null;
    const base = r.net_dpp_amount.toNumber();
    // PPh on the net DPP after the Uang Muka (P119), whose own PPh was withheld at its payment.
    const withholdings = withholdingsOf([{ key: r.withholding_tax_id ? String(r.withholding_tax_id) : null, rate, dpp: base }]);
    return {
      id: r.id,
      invoiceNo: r.invoice_no,
      invoiceDate: isoDay(r.invoice_date),
      dueDate: isoDay(r.due_date),
      status: r.status as InvoiceStatus,
      customerId: r.customer_id,
      orderId: r.permit_request_id,
      orderNo: sources.get(r.permit_request_id) ?? "",
      total: r.total_amount.toNumber(),
      dpp: base,
      ppn: r.ppn_amount.toNumber(),
      withholdings,
      arItemId: r.ar_item_id,
      paid: r.paid_amount.toNumber(),
    };
  });
}

export async function unpaidPermitInvoiceIds(db: Db = prisma): Promise<number[]> {
  const rows = await db.finArPermitInvoice.findMany({ where: { status: "Posted", ar_item_id: { not: null } }, select: { id: true, total_amount: true, paid_amount: true } });
  return rows.filter((r) => r.paid_amount.lt(r.total_amount)).map((r) => r.id);
}

export async function lockPermitInvoices(tx: Prisma.TransactionClient, ids: number[]): Promise<void> {
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) await tx.$queryRaw`SELECT id FROM fin_ar_permit_invoice WHERE id = ${id} FOR UPDATE`;
}

export async function recordPermitInvoicePaid(tx: Prisma.TransactionClient, id: number, settled: number): Promise<void> {
  const v = await tx.finArPermitInvoice.findUnique({ where: { id }, select: { invoice_no: true, status: true, total_amount: true, paid_amount: true } });
  if (!v || v.status !== "Posted") throw new Error("Invoice Perizinan tidak berstatus Posted.");
  const cents = (x: number) => Math.round(x * 100);
  const paid = (cents(v.paid_amount.toNumber()) + cents(settled)) / 100;
  if (!(settled > 0) || cents(paid) > cents(v.total_amount.toNumber())) throw new Error(`Pembayaran melebihi sisa ${v.invoice_no}.`);
  await tx.finArPermitInvoice.update({ where: { id }, data: { paid_amount: paid } });
}

// ------------------------------------------------------- for the tax module

/** A posted Invoice Perizinan as its one-line faktur pajak reads it (Z21). */
export type PermitInvoiceTaxBasis = {
  id: number;
  invoiceNo: string;
  status: InvoiceStatus;
  taxDate: string;
  customerId: number;
  addressId: number;
  requestId: number;
  description: string;
  taxable: boolean;
  rates: { rate: number; otherNum: number; otherDen: number } | null;
  amount: number;
  dpp: number;
  advanceUsed: number;
  advancePpn: number;
  netDpp: number;
  dppOther: number;
  fullPpn: number;
  ppn: number;
  deductions: { arItemId: number; arItemNo: string; dppUsed: number; ppnUsed: number }[];
};

export async function permitInvoiceTaxBasis(db: Db, id: number): Promise<PermitInvoiceTaxBasis | null> {
  const n = await db.finArPermitInvoice.findUnique({ where: { id }, include: { deductions: true } });
  if (!n) return null;
  return {
    id: n.id,
    invoiceNo: n.invoice_no,
    status: n.status as InvoiceStatus,
    taxDate: isoDay(n.tax_date),
    customerId: n.customer_id,
    addressId: n.address_id,
    requestId: n.permit_request_id,
    description: n.description,
    taxable: n.is_taxable,
    rates:
      n.is_taxable && n.ppn_rate && n.ppn_dpp_other_numerator && n.ppn_dpp_other_denominator
        ? { rate: n.ppn_rate.toNumber(), otherNum: n.ppn_dpp_other_numerator, otherDen: n.ppn_dpp_other_denominator }
        : null,
    amount: n.amount.toNumber(),
    dpp: n.dpp_amount.toNumber(),
    advanceUsed: n.advance_dpp_amount.toNumber(),
    advancePpn: n.advance_ppn_amount.toNumber(),
    netDpp: n.net_dpp_amount.toNumber(),
    dppOther: n.dpp_other_amount.toNumber(),
    fullPpn: n.full_ppn_amount.toNumber(),
    ppn: n.ppn_amount.toNumber(),
    deductions: n.deductions.map((d) => ({ arItemId: d.ar_item_id, arItemNo: d.ar_item_no, dppUsed: d.dpp_used.toNumber(), ppnUsed: d.ppn_used.toNumber() })),
  };
}
