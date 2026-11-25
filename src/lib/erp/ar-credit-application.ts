import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/format";
import { ArItemOverdrawn, applyReturnCredit, lockArItems } from "./ar-item";
import { refundableCreditNotes } from "./ar-credit-note";
import { lockSalesInvoices, settlementInvoices, unpaidSalesInvoiceIds } from "./ar-invoice";
import {
  CREDIT_APPLICATION_TRANSITIONS,
  creditApplicationIsEditable,
  creditApplicationTransitionAllowed,
  type CreditApplicationAction,
  type CreditApplicationStatus,
} from "./ar-credit-application-workflow";
import { BASE_CURRENCY_LABEL } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { checkTransactionDate, holdPostingPeriod, PeriodShut } from "./fiscal";
import { PostingDryRun, describeJournalLines, journalNumbersByIds, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { taxScale } from "./sales-tax";
import { postingAccounts } from "./system-settings";

/**
 * The Penerapan Kredit module (Claude-ERP.md P332, `Sales-Return-Plan.md` §12):
 * its tables are `fin_ar_credit_application` and `_line`, and nothing else
 * names them.
 *
 * The only way customer credit lowers an Invoice. One customer, one currency;
 * each line applies part of a Credit Note's open Retur item to an open Invoice
 * Penjualan, whatever Customer Order either is of (SR14). A Draft holds its
 * amounts against other applications and refunds. Posting moves both items and
 * writes no journal in rupiah: both sides are Piutang Usaha of one customer. In
 * a foreign currency both legs are booked at their own base, with selisih kurs.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type CreditApplicationHeaderInput = { customer_id: number | null; currency_id: number | null; application_date: string; note: string };
export type CreditApplicationLineInput = { credit_note_id: number | null; invoice_id: number | null; amount: number | string };
export type CreditApplicationResult = { ok: true; id: number; applicationNo: string } | { ok: false; errors: Record<string, string> };

/**
 * What Draft refunds take of each Credit Note. The payment module owns those
 * and depends on this one, so the caller hands the reader in (§3.1).
 */
export type RefundHolds = (db: Db, creditNoteIds: number[]) => Promise<Map<number, number>>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const cents = (n: number) => Math.round(n * 100);

async function docTypeId(db: Db, table: string): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: table }, select: { id: true } });
  if (!row) throw new Error(`Jenis dokumen ${table} belum terdaftar. Jalankan db:seed.`);
  return row.id;
}

// ---------------------------------------------------------------- options

/** What Draft applications hold, by Credit Note and by Invoice. */
async function draftHolds(db: Db, exceptId: number | null) {
  const rows = await db.finArCreditApplicationLine.findMany({
    where: { application: { status: "Draft", ...(exceptId ? { id: { not: exceptId } } : {}) } },
    select: { credit_note_id: true, invoice_id: true, amount: true },
  });
  const credit = new Map<number, number>();
  const invoice = new Map<number, number>();
  for (const r of rows) {
    const c = cents(r.amount.toNumber());
    credit.set(r.credit_note_id, (credit.get(r.credit_note_id) ?? 0) + c);
    invoice.set(r.invoice_id, (invoice.get(r.invoice_id) ?? 0) + c);
  }
  return { credit, invoice };
}

/** What Draft applications hold of each Credit Note — a refund may not pay it out. */
export async function creditHeldByDraftApplications(db: Db): Promise<Map<number, number>> {
  const { credit } = await draftHolds(db, null);
  return new Map([...credit].map(([id, c]) => [id, c / 100]));
}

export type ApplicableCredit = {
  id: number;
  no: string;
  date: string;
  itemId: number;
  customerId: number;
  customerLabel: string;
  customerName: string;
  currencyId: number;
  currency: string;
  invoiceNo: string;
  /** Open, less what Drafts hold. */
  free: number;
};
export type ApplicableInvoice = { id: number; no: string; date: string; dueDate: string; itemId: number; customerId: number; currency: string; free: number };
export type CreditApplicationOptions = { credits: ApplicableCredit[]; invoices: ApplicableInvoice[] };

async function sources(
  db: Db,
  filter: { open: true } | { creditIds: number[]; invoiceIds: number[] },
  exceptId: number | null,
  refundHolds?: RefundHolds
): Promise<CreditApplicationOptions> {
  const notes = await refundableCreditNotes("open" in filter ? { openOnly: true } : { ids: filter.creditIds }, db);
  const customers = new Set(notes.map((n) => n.customerId));
  const invoiceIds = "open" in filter ? (customers.size ? await unpaidSalesInvoiceIds(db) : []) : filter.invoiceIds;
  const bills = invoiceIds.length ? await settlementInvoices({ ids: invoiceIds }, db) : [];
  const holds = await draftHolds(db, exceptId);
  const refunds = (await refundHolds?.(db, notes.map((n) => n.id))) ?? new Map<number, number>();
  return {
    credits: notes.map((n) => ({
      id: n.id,
      no: n.creditNo,
      date: n.creditDate,
      itemId: n.arItemId,
      customerId: n.customerId,
      customerLabel: n.customerLabel,
      customerName: n.customerName,
      currencyId: n.currencyId,
      currency: n.currency,
      invoiceNo: n.invoiceNo,
      free: Math.max(0, cents(n.total) - cents(n.paid) - (holds.credit.get(n.id) ?? 0) - cents(refunds.get(n.id) ?? 0)) / 100,
    })),
    invoices: bills
      .filter((b) => b.status === "Posted" && b.arItemId && (!("open" in filter) || customers.has(b.customerId)))
      .map((b) => ({
        id: b.id,
        no: b.invoiceNo,
        date: b.invoiceDate,
        dueDate: b.dueDate,
        itemId: b.arItemId!,
        customerId: b.customerId,
        currency: b.currency,
        free: Math.max(0, cents(b.total) - cents(b.paid) - (holds.invoice.get(b.id) ?? 0)) / 100,
      })),
  };
}

/** Open credit and open Invoices, with the ones a stored application names. */
export async function creditApplicationOptions(current: CreditApplicationView | null = null, refundHolds?: RefundHolds): Promise<CreditApplicationOptions> {
  const own = current
    ? await sources(
        prisma,
        { creditIds: current.lines.map((l) => Number(l.credit_note_id)), invoiceIds: current.lines.map((l) => Number(l.invoice_id)) },
        current.id,
        refundHolds
      )
    : { credits: [], invoices: [] };
  if (current && current.status !== "Draft") return own;
  const open = await sources(prisma, { open: true }, current?.id ?? null, refundHolds);
  const join = <T extends { id: number }>(a: T[], b: T[]) => [...a, ...b.filter((x) => !a.some((y) => y.id === x.id))];
  return {
    credits: join(own.credits, open.credits.filter((c) => c.free > 0)),
    invoices: join(own.invoices, open.invoices.filter((i) => i.free > 0)),
  };
}

// ------------------------------------------------------------- validation

type CheckedLine = { line_no: number; amount: number; credit: ApplicableCredit; invoice: ApplicableInvoice };
type Checked = {
  data: { customer_id: number; currency_id: number; application_date: Date; note: string | null; total_amount: number };
  currency: string;
  customerName: string;
  lines: CheckedLine[];
};

/** Reads the lines' documents with their Invoices and AR items locked, so two applications cannot spend one balance. */
async function lockedSources(tx: Prisma.TransactionClient, lines: CreditApplicationLineInput[], exceptId: number | null, refundHolds?: RefundHolds) {
  const filter = {
    creditIds: [...new Set(lines.map((l) => Number(l.credit_note_id)).filter(Boolean))],
    invoiceIds: [...new Set(lines.map((l) => Number(l.invoice_id)).filter(Boolean))],
  };
  await lockSalesInvoices(tx, filter.invoiceIds);
  const found = await sources(tx, filter, exceptId);
  await lockArItems(tx, [...found.credits, ...found.invoices].map((x) => x.itemId));
  return sources(tx, filter, exceptId, refundHolds);
}

async function checkApplication(
  tx: Prisma.TransactionClient,
  header: CreditApplicationHeaderInput,
  lines: CreditApplicationLineInput[],
  exceptId: number | null,
  refundHolds?: RefundHolds
): Promise<Checked> {
  const errors: Record<string, string> = {};
  const date = String(header.application_date ?? "");
  if (!DAY.test(date)) errors.application_date = "Tanggal wajib diisi.";
  const src = await lockedSources(tx, lines, exceptId, refundHolds);
  const credits = new Map(src.credits.map((c) => [c.id, c]));
  const invoices = new Map(src.invoices.map((i) => [i.id, i]));
  const customer = Number(header.customer_id) || 0;
  const currencyId = Number(header.currency_id) || 0;
  if (!customer || !currencyId) errors.customer_id = "Pilih customer.";
  if (!lines.length) errors._lines = "Isi minimal satu baris kredit.";

  const out: CheckedLine[] = [];
  const seen = new Set<string>();
  const usedCredit = new Map<number, number>();
  const usedInvoice = new Map<number, number>();
  lines.forEach((l, i) => {
    const at = (field: string, message: string) => void (errors[`lines.${i}.${field}`] = message);
    const credit = credits.get(Number(l.credit_note_id));
    const invoice = invoices.get(Number(l.invoice_id));
    if (!credit) return at("credit_note_id", "Pilih Credit Note yang sudah diposting.");
    if (!invoice) return at("invoice_id", "Pilih Invoice Penjualan yang sudah diposting.");
    if (credit.customerId !== customer || credit.currencyId !== currencyId) return at("credit_note_id", `${credit.no} bukan kredit customer dan currency ini.`);
    if (invoice.customerId !== customer || invoice.currency !== credit.currency) return at("invoice_id", `${invoice.no} bukan Invoice customer dan currency ini.`);
    if (DAY.test(date) && date < credit.date) return at("credit_note_id", `Tanggal sebelum tanggal ${credit.no}.`);
    if (DAY.test(date) && date < invoice.date) return at("invoice_id", `Tanggal sebelum tanggal ${invoice.no}.`);
    const pair = `${credit.id}:${invoice.id}`;
    if (seen.has(pair)) return at("invoice_id", "Credit Note dan Invoice ini sudah ada di baris lain.");
    seen.add(pair);
    const amount = Number(l.amount);
    const scale = taxScale(credit.currency);
    if (!(amount > 0)) return at("amount", "Isi nilai yang dipotong.");
    if (Math.abs(Math.round(amount * scale) - amount * scale) > 1e-6) return at("amount", scale === 1 ? "Nilai harus dalam rupiah penuh." : "Nilai paling banyak dua desimal.");
    const c = (usedCredit.get(credit.id) ?? 0) + cents(amount);
    const v = (usedInvoice.get(invoice.id) ?? 0) + cents(amount);
    usedCredit.set(credit.id, c);
    usedInvoice.set(invoice.id, v);
    if (c > cents(credit.free)) return at("amount", `Melebihi sisa kredit ${credit.no} (${formatMoney(credit.free, credit.currency)}).`);
    if (v > cents(invoice.free)) return at("amount", `Melebihi sisa ${invoice.no} (${formatMoney(invoice.free, credit.currency)}).`);
    out.push({ line_no: i + 1, amount, credit, invoice });
  });
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";
  if (Object.keys(errors).length) throw new Refused(errors);
  return {
    data: {
      customer_id: customer,
      currency_id: currencyId,
      application_date: asDate(date),
      note: String(header.note ?? "").trim() || null,
      total_amount: out.reduce((a, l) => a + cents(l.amount), 0) / 100,
    },
    currency: out[0].credit.currency,
    customerName: out[0].credit.customerName,
    lines: out,
  };
}

const lineData = (l: CheckedLine) => ({
  line_no: l.line_no,
  credit_note_id: l.credit.id,
  return_item_id: l.credit.itemId,
  invoice_id: l.invoice.id,
  invoice_item_id: l.invoice.itemId,
  amount: l.amount,
});

// ------------------------------------------------------------------ writes

async function nextNo(db: Db, date: Date): Promise<string> {
  return nextDocumentNumber("PKR", date, async (series) => {
    const row = await db.finArCreditApplication.findFirst({
      where: { application_no: { startsWith: series } },
      orderBy: { id: "desc" },
      select: { application_no: true },
    });
    return row?.application_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "fin_ar_credit_application", row_id: id, action, event, by } });
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
    if (e instanceof PeriodShut || e instanceof ArItemOverdrawn) return { ok: false, errors: { _form: e.message } };
    if (e instanceof PostingDryRun) return { ok: true, journal: e.lines } as T;
    throw e;
  }
}

export async function createCreditApplication(
  header: CreditApplicationHeaderInput,
  lines: CreditApplicationLineInput[],
  actorId: number,
  refundHolds?: RefundHolds
): Promise<CreditApplicationResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const c = await checkApplication(tx, header, lines, null, refundHolds);
      const row = await tx.finArCreditApplication.create({
        data: { ...c.data, application_no: await nextNo(tx, c.data.application_date), created_by: actorId, lines: { create: c.lines.map(lineData) } },
      });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, applicationNo: made.application_no };
  });
}

export async function updateCreditApplication(
  id: number,
  header: CreditApplicationHeaderInput,
  lines: CreditApplicationLineInput[],
  actorId: number,
  refundHolds?: RefundHolds
): Promise<CreditApplicationResult> {
  const current = await prisma.finArCreditApplication.findUnique({ where: { id } });
  if (!current) return { ok: false, errors: { _form: "Penerapan Kredit tidak ditemukan." } };
  if (!creditApplicationIsEditable(current.status)) return { ok: false, errors: { _form: "Penerapan Kredit yang sudah diposting atau dibatalkan tidak dapat diubah." } };
  if (Number(header.customer_id) !== current.customer_id || Number(header.currency_id) !== current.currency_id) {
    return { ok: false, errors: { customer_id: "Customer tidak dapat diganti. Buat Penerapan Kredit baru." } };
  }
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      const c = await checkApplication(tx, header, lines, id, refundHolds);
      const done = await tx.finArCreditApplication.updateMany({ where: { id, status: "Draft" }, data: { ...c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Penerapan Kredit berubah saat diproses. Muat ulang halaman." });
      await tx.finArCreditApplicationLine.deleteMany({ where: { application_id: id } });
      await tx.finArCreditApplicationLine.createMany({ data: c.lines.map((l) => ({ ...lineData(l), application_id: id })) });
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, applicationNo: current.application_no };
  });
}

// --------------------------------------------------------------- lifecycle

export type CreditApplicationTransitionResult = { ok: true; journal?: JournalLineInput[] } | { ok: false; errors: Record<string, string> };

/** The journal Posting would write now — none in rupiah — by a dry run that is rolled back (P103). */
export async function creditApplicationPreview(id: number, actorId: number, refundHolds?: RefundHolds): Promise<JournalPreviewResult> {
  const r = await transitionCreditApplication(id, "post", actorId, undefined, { dryRun: true, refundHolds });
  if (!r.ok) return r;
  return { ok: true, lines: await describeJournalLines(r.journal ?? []) };
}

export async function transitionCreditApplication(
  id: number,
  action: CreditApplicationAction,
  actorId: number,
  reason?: string,
  options: { dryRun?: boolean; refundHolds?: RefundHolds } = {}
): Promise<CreditApplicationTransitionResult> {
  const a = await prisma.finArCreditApplication.findUnique({ where: { id }, include: { lines: { orderBy: { line_no: "asc" } } } });
  if (!a) return { ok: false, errors: { _form: "Penerapan Kredit tidak ditemukan." } };
  if (!creditApplicationTransitionAllowed(action, a.status)) {
    return { ok: false, errors: { _form: `Penerapan Kredit berstatus ini tidak dapat di-${CREDIT_APPLICATION_TRANSITIONS[action].label.toLowerCase()}.` } };
  }
  const moved = { _form: "Penerapan Kredit berubah saat diproses. Muat ulang halaman." };
  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
    return refusable(async () => {
      await prisma.$transaction(async (tx) => {
        const done = await tx.finArCreditApplication.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
        if (done.count !== 1) throw new Refused(moved);
        await audit(tx, id, "UPDATE", "cancel", actorId);
      });
      return { ok: true as const };
    });
  }

  const date = isoDay(a.application_date);
  const period = await checkTransactionDate(date);
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, date);
      // The stored lines checked again under the locks: their balances may have moved since.
      const input = asInput(a);
      let c: Checked;
      try {
        c = await checkApplication(tx, input.header, input.lines, id, options.refundHolds);
      } catch (e) {
        if (!(e instanceof Refused)) throw e;
        const first = Object.entries(e.errors).find(([k]) => !k.startsWith("_"))?.[1] ?? Object.values(e.errors)[0];
        throw new Refused({ _form: `Belum bisa diposting: ${first}` });
      }
      const done = await tx.finArCreditApplication.updateMany({ where: { id, status: "Draft" }, data: { status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused(moved);

      const typeId = await docTypeId(tx, "fin_ar_credit_application");
      const doc = { docTypeId: typeId, docId: id, no: a.application_no };
      const journal: JournalLineInput[] = [];
      const foreign = c.currency !== BASE_CURRENCY_LABEL;
      let accounts = {} as { receivable_account: number; fx_account: number };
      if (foreign) {
        const mapped = await postingAccounts(["receivable_account", "fx_account"] as const);
        if (!mapped.ok) throw new Refused({ _form: `Lengkapi Account Mapping dulu: ${mapped.missing.join(", ")}.` });
        accounts = mapped.ids;
      }
      const baseId = foreign ? (await tx.refCurrency.findFirstOrThrow({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } })).id : 0;
      for (const l of c.lines) {
        const m = await applyReturnCredit(tx, {
          returnItemId: l.credit.itemId,
          invoiceItemId: l.invoice.itemId,
          amount: l.amount,
          date,
          doc,
          notes: { invoice: `Kredit ${l.credit.no}`, ret: `Dipotong ke ${l.invoice.no}` },
          actorId,
        });
        await tx.finArCreditApplicationLine.updateMany({
          where: { application_id: id, line_no: l.line_no },
          data: { base_return_amount: m.returnBase, base_invoice_amount: m.invoiceBase, fx_difference: m.fx },
        });
        if (!foreign) continue;
        const leg = (debit: number, credit: number, base: number, description: string): JournalLineInput => ({
          accountId: accounts.receivable_account,
          partnerId: c.data.customer_id,
          currencyId: c.data.currency_id,
          rate: Math.round((base / l.amount) * 1_000_000) / 1_000_000,
          debit,
          credit,
          baseAmount: base,
          description,
        });
        journal.push(
          leg(l.amount, 0, m.returnBase, `Kredit ${l.credit.no} dipakai — ${a.application_no}`),
          leg(0, l.amount, m.invoiceBase, `Piutang ${l.invoice.no} dipotong kredit — ${a.application_no}`)
        );
        if (m.fx !== 0) {
          journal.push({
            accountId: accounts.fx_account,
            partnerId: null,
            currencyId: baseId,
            rate: 1,
            debit: Math.max(0, m.fx),
            credit: Math.max(0, -m.fx),
            description: `Selisih kurs ${l.credit.no} → ${l.invoice.no} — ${a.application_no}`,
          });
        }
      }
      if (journal.length) {
        const j = await postJournal(tx, {
          description: `${a.application_no} · Penerapan Kredit — ${c.customerName} (${formatMoney(c.data.total_amount, c.currency)})`,
          sourceDocTypeId: typeId,
          sourceDocId: id,
          postingDate: a.application_date,
          actorId,
          lines: journal,
        });
        await tx.finArCreditApplication.update({ where: { id }, data: { journal_id: j.id } });
      }
      await audit(tx, id, "UPDATE", "post", actorId);
      if (options.dryRun) throw new PostingDryRun(journal);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

type Stored = Prisma.FinArCreditApplicationGetPayload<{ include: { lines: true } }>;

function asInput(a: Stored): { header: CreditApplicationHeaderInput; lines: CreditApplicationLineInput[] } {
  return {
    header: { customer_id: a.customer_id, currency_id: a.currency_id, application_date: isoDay(a.application_date), note: a.note ?? "" },
    lines: [...a.lines]
      .sort((x, y) => x.line_no - y.line_no)
      .map((l) => ({ credit_note_id: l.credit_note_id, invoice_id: l.invoice_id, amount: l.amount.toNumber() })),
  };
}

export type CreditApplicationListRow = {
  id: number;
  applicationNo: string;
  date: string;
  status: CreditApplicationStatus;
  customerLabel: string;
  customerName: string;
  currency: string;
  total: number;
  lines: number;
};

export async function listCreditApplications(): Promise<CreditApplicationListRow[]> {
  const rows = await prisma.finArCreditApplication.findMany({
    orderBy: [{ application_date: "desc" }, { id: "desc" }],
    include: { customer: true, currency: true, _count: { select: { lines: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    applicationNo: r.application_no,
    date: isoDay(r.application_date),
    status: r.status,
    customerLabel: r.customer.partner_label,
    customerName: r.customer.partner_name,
    currency: r.currency.currency_label,
    total: r.total_amount.toNumber(),
    lines: r._count.lines,
  }));
}

export type CreditApplicationView = {
  id: number;
  applicationNo: string;
  status: CreditApplicationStatus;
  header: CreditApplicationHeaderInput;
  lines: CreditApplicationLineInput[];
  customerLabel: string;
  customerName: string;
  currency: string;
  total: number;
  journalId: number | null;
  journalNo: string | null;
  cancelReason: string | null;
};

export async function getCreditApplication(id: number): Promise<CreditApplicationView | null> {
  const a = await prisma.finArCreditApplication.findUnique({ where: { id }, include: { lines: true, customer: true, currency: true } });
  if (!a) return null;
  return {
    id: a.id,
    applicationNo: a.application_no,
    status: a.status,
    ...asInput(a),
    customerLabel: a.customer.partner_label,
    customerName: a.customer.partner_name,
    currency: a.currency.currency_label,
    total: a.total_amount.toNumber(),
    journalId: a.journal_id,
    journalNo: a.journal_id ? ((await journalNumbersByIds([a.journal_id])).get(a.journal_id) ?? null) : null,
    cancelReason: a.cancel_reason,
  };
}

/** Numbers by id, for the audit panel. */
export async function creditApplicationNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.finArCreditApplication.findMany({ where: { id: { in: ids } }, select: { id: true, application_no: true } });
  return new Map(rows.map((r) => [r.id, r.application_no]));
}
