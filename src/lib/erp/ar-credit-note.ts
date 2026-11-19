import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber, taxSeriesPrefix } from "./document-number";
import { formatMoney, formatNumber } from "@/lib/format";
import { BASE_CURRENCY_LABEL } from "./currency";
import { checkTransactionDate, holdPostingPeriod, PeriodShut } from "./fiscal";
import { PostingDryRun, describeJournalLines, journalNumbersByIds, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { lockCustomerOrder } from "./customer-order";
import { creditSourceInvoices, type CreditSourceInvoice } from "./ar-invoice";
import { ArItemOverdrawn, arItemHeld, createArItem, settleArItem } from "./ar-item";
import { postingAccounts } from "./system-settings";
import { taxScale } from "./sales-tax";
import {
  CREDIT_NOTE_HOLDS,
  CREDIT_NOTE_TRANSITIONS,
  creditLine,
  creditNoteIsEditable,
  creditNoteTransitionAllowed,
  type CreditNoteAction,
  type CreditNoteStatus,
} from "./ar-credit-note-workflow";

/**
 * The Credit Note Penjualan module (Claude-ERP.md P292, `Sales-Return-Plan.md`
 * §6): its tables are `fin_ar_credit_note` and `fin_ar_credit_note_line`, and
 * nothing else names them.
 *
 * One Credit Note credits one posted Invoice Penjualan for goods that came back
 * after it was billed: each line a quantity of an Invoice line, never more than
 * came back of it beyond what the Invoice was already billed net of (P291),
 * less what other live Credit Notes credit. It reverses the Invoice's own
 * figures by cumulative share, so revenue and PPN Keluaran fall by exactly what
 * the Invoice reported for those goods (P113, `tax_concept.md` §5.3).
 *
 * Posting, under the Customer Order's lock, writes Dr Retur Penjualan · Dr PPN
 * Keluaran / Cr Piutang Usaha and a **Retur** AR item (P287 SR2): born at the
 * credit's total, applied to the Invoice's item as far as its balance goes
 * (`ReturnApplied` / `ReturnUsed`), the rest an open customer credit. The
 * Invoice is read through `creditSourceInvoices`.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type CreditNoteHeaderInput = {
  invoice_id: number | null;
  credit_date: string;
  customer_return_no: string;
  note: string;
};
export type CreditNoteLineInput = { invoice_line_id: number | null; qty: number | string };
export type CreditNoteResult = { ok: true; id: number; creditNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const lineKey = (i: number, f: string) => `lines.${i}.${f}`;
const text = (v: string | null | undefined) => String(v ?? "").trim() || null;
const units = (n: number) => Math.round(n * 10_000);
const fromUnits = (u: number) => u / 10_000;
const cents = (n: number) => Math.round(n * 100);
const qtyText = (n: number) => formatNumber(n, n % 1 ? 2 : 0);

async function docTypeId(db: Db, table: string): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: table }, select: { id: true } });
  if (!row) throw new Error(`Jenis dokumen ${table} belum terdaftar. Jalankan db:seed.`);
  return row.id;
}

/** What Credit Notes credit of each Invoice line: live ones (room), or posted ones (the share's `before`). */
async function creditedByLines(db: Db, lineIds: number[], exceptId: number | null, postedOnly: boolean): Promise<Map<number, number>> {
  if (!lineIds.length) return new Map();
  const rows = await db.finArCreditNoteLine.groupBy({
    by: ["invoice_line_id"],
    where: {
      invoice_line_id: { in: lineIds },
      credit_note: { status: postedOnly ? "Posted" : { in: CREDIT_NOTE_HOLDS }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    },
    _sum: { qty: true },
  });
  return new Map(rows.map((r) => [r.invoice_line_id, r._sum?.qty?.toNumber() ?? 0]));
}

// ---------------------------------------------------------------- options

export type CnSourceLine = CreditSourceInvoice["lines"][number] & {
  /** What other live Credit Notes credit of the line. */
  held: number;
  /** What posted ones credited — where this one's share starts. */
  before: number;
};
export type CnSource = Omit<CreditSourceInvoice, "lines"> & { lines: CnSourceLine[] };

async function sourceOptions(db: Db, filter: { ids?: number[]; withReturns?: boolean }, exceptId: number | null): Promise<CnSource[]> {
  const invoices = await creditSourceInvoices(filter, db);
  const ids = invoices.flatMap((i) => i.lines.map((l) => l.id));
  const [held, before] = await Promise.all([creditedByLines(db, ids, exceptId, false), creditedByLines(db, ids, exceptId, true)]);
  return invoices.map((i) => ({ ...i, lines: i.lines.map((l) => ({ ...l, held: held.get(l.id) ?? 0, before: before.get(l.id) ?? 0 })) }));
}

const roomOf = (l: CnSourceLine) => fromUnits(units(l.returnedAfter) - units(l.held));

/** Posted Invoices with something left to credit, or the one a stored Credit Note names. */
export async function creditNoteOptions(current: { id: number; invoiceId: number } | null = null): Promise<{ invoices: CnSource[] }> {
  if (current) return { invoices: await sourceOptions(prisma, { ids: [current.invoiceId] }, current.id) };
  const all = await sourceOptions(prisma, { withReturns: true }, null);
  return { invoices: all.filter((i) => i.lines.some((l) => roomOf(l) > 0)) };
}

// ------------------------------------------------------------- validation

type CheckedLine = {
  line_no: number;
  invoice_line_id: number;
  item_id: number;
  qty: number;
  gross_amount: number;
  discount_amount: number;
  dpp_amount: number;
  dpp_other_amount: number;
  ppn_amount: number;
  base_dpp_amount: number;
  base_ppn_amount: number;
};
type Checked = {
  source: CnSource;
  data: {
    invoice_id: number;
    customer_order_id: number;
    customer_id: number;
    currency_id: number;
    exchange_rate: number;
    is_taxable: boolean;
    credit_date: Date;
    customer_return_no: string | null;
    note: string | null;
    gross_amount: number;
    discount_amount: number;
    dpp_amount: number;
    dpp_other_amount: number;
    ppn_amount: number;
    total_amount: number;
    base_dpp_amount: number;
    base_ppn_amount: number;
    base_total_amount: number;
  };
  lines: CheckedLine[];
};

/** Every rule a Credit Note must satisfy to be saved, and — run again under the lock — to be posted. */
export async function checkCreditNote(
  db: Db,
  header: CreditNoteHeaderInput,
  lines: CreditNoteLineInput[],
  selfId: number | null
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const invoiceId = Number(header.invoice_id) || null;
  const source = invoiceId ? (await sourceOptions(db, { ids: [invoiceId] }, selfId))[0] : undefined;
  if (!invoiceId) errors.invoice_id = "Pilih Invoice Penjualan.";
  else if (!source) errors.invoice_id = "Invoice Penjualan tidak ditemukan.";
  else if (source.status !== "Posted") errors.invoice_id = "Invoice Penjualan harus sudah diposting.";

  const date = String(header.credit_date ?? "").trim();
  if (!DAY.test(date)) errors.credit_date = "Tanggal wajib diisi.";
  else if (source && date < source.invoiceDate) errors.credit_date = "Tidak boleh sebelum tanggal Invoice.";

  const raw = Array.isArray(lines) ? lines : [];
  if (!raw.length) errors._lines = "Tambahkan minimal satu baris.";
  const byId = new Map((source?.lines ?? []).map((l) => [l.id, l]));
  const scale = taxScale(source?.currency);
  const seen = new Set<number>();
  const out: CheckedLine[] = [];
  for (const [i, l] of raw.entries()) {
    const inv = byId.get(Number(l.invoice_line_id) || 0);
    if (!inv) {
      if (source) errors[lineKey(i, "invoice_line_id")] = "Baris bukan bagian Invoice ini.";
      continue;
    }
    if (seen.has(inv.id)) {
      errors[lineKey(i, "invoice_line_id")] = `${inv.itemLabel} dipilih lebih dari sekali.`;
      continue;
    }
    seen.add(inv.id);
    const qty = Number(String(l.qty ?? "").replace(",", "."));
    const room = roomOf(inv);
    if (!Number.isFinite(qty) || !(qty > 0)) errors[lineKey(i, "qty")] = "Isi jumlah lebih dari 0.";
    else if (Math.abs(qty * 10_000 - units(qty)) > 1e-6) errors[lineKey(i, "qty")] = "Paling banyak 4 angka desimal.";
    else if (units(qty) > units(room)) errors[lineKey(i, "qty")] = `Melebihi barang yang kembali dan belum dikredit (${qtyText(room)} ${inv.uomLabel}).`;
    else {
      const f = creditLine(inv, inv.before, fromUnits(units(qty)), scale);
      out.push({
        line_no: out.length + 1,
        invoice_line_id: inv.id,
        item_id: inv.itemId,
        qty: fromUnits(units(qty)),
        gross_amount: f.gross,
        discount_amount: f.discount,
        dpp_amount: f.dpp,
        dpp_other_amount: f.dppOther,
        ppn_amount: f.ppn,
        base_dpp_amount: f.baseDpp,
        base_ppn_amount: f.basePpn,
      });
    }
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada baris yang perlu diperbaiki.";
  if (Object.keys(errors).length || !source) return { ok: false, errors };
  const sum = (k: keyof CheckedLine) => out.reduce((a, l) => a + cents(l[k] as number), 0) / 100;
  const dpp = sum("dpp_amount");
  const ppn = sum("ppn_amount");
  const baseDpp = sum("base_dpp_amount");
  const basePpn = sum("base_ppn_amount");
  return {
    ok: true,
    c: {
      source,
      data: {
        invoice_id: source.id,
        customer_order_id: source.customerOrderId,
        customer_id: source.customerId,
        currency_id: source.currencyId,
        exchange_rate: source.exchangeRate,
        is_taxable: source.isTaxable,
        credit_date: asDate(date),
        customer_return_no: text(header.customer_return_no),
        note: text(header.note),
        gross_amount: sum("gross_amount"),
        discount_amount: sum("discount_amount"),
        dpp_amount: dpp,
        dpp_other_amount: sum("dpp_other_amount"),
        ppn_amount: ppn,
        total_amount: (cents(dpp) + cents(ppn)) / 100,
        base_dpp_amount: baseDpp,
        base_ppn_amount: basePpn,
        base_total_amount: (cents(baseDpp) + cents(basePpn)) / 100,
      },
      lines: out,
    },
  };
}

// ------------------------------------------------------------------ writes

async function nextCreditNo(db: Db, date: Date, isTaxable: boolean): Promise<string> {
  return nextDocumentNumber(taxSeriesPrefix("CNS", isTaxable), date, async (series) => {
    const row = await db.finArCreditNote.findFirst({ where: { credit_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { credit_no: true } });
    return row?.credit_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "fin_ar_credit_note", row_id: id, action, event, by } });
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
    if (e instanceof PeriodShut) return { ok: false, errors: { _form: e.message } };
    if (e instanceof ArItemOverdrawn) return { ok: false, errors: { _form: e.message } };
    if (e instanceof PostingDryRun) return { ok: true, journal: e.lines } as T;
    throw e;
  }
}

/** The Customer Order an Invoice was drawn on — the lock every document on it takes. */
async function lockOf(db: Db, invoiceId: number | null): Promise<number | null> {
  if (!invoiceId) return null;
  const [i] = await creditSourceInvoices({ ids: [invoiceId] }, db);
  return i?.customerOrderId ?? null;
}

export async function createCreditNote(header: CreditNoteHeaderInput, lines: CreditNoteLineInput[], actorId: number): Promise<CreditNoteResult> {
  return refusable(async () => {
    const made = await prisma.$transaction(async (tx) => {
      const co = await lockOf(tx, Number(header.invoice_id) || null);
      if (co) await lockCustomerOrder(tx, co);
      const r = await checkCreditNote(tx, header, lines, null);
      if (!r.ok) throw new Refused(r.errors);
      const row = await tx.finArCreditNote.create({
        data: {
          ...r.c.data,
          credit_no: await nextCreditNo(tx, r.c.data.credit_date, r.c.data.is_taxable),
          created_by: actorId,
          lines: { create: r.c.lines },
        },
      });
      await audit(tx, row.id, "TAMBAH", "create", actorId);
      return row;
    });
    return { ok: true as const, id: made.id, creditNo: made.credit_no };
  });
}

export async function updateCreditNote(id: number, header: CreditNoteHeaderInput, lines: CreditNoteLineInput[], actorId: number): Promise<CreditNoteResult> {
  const current = await prisma.finArCreditNote.findUnique({ where: { id }, select: { status: true, credit_no: true, invoice_id: true, customer_order_id: true } });
  if (!current) return { ok: false, errors: { _form: "Credit Note tidak ditemukan." } };
  if (!creditNoteIsEditable(current.status as CreditNoteStatus)) return { ok: false, errors: { _form: "Credit Note yang sudah diposting atau dibatalkan tidak dapat diubah." } };
  if (Number(header.invoice_id) !== current.invoice_id) {
    return { ok: false, errors: { invoice_id: "Invoice tidak dapat diganti. Buat Credit Note baru untuk Invoice lain." } };
  }
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await lockCustomerOrder(tx, current.customer_order_id);
      const r = await checkCreditNote(tx, header, lines, id);
      if (!r.ok) throw new Refused(r.errors);
      const done = await tx.finArCreditNote.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Credit Note berubah saat diproses. Muat ulang halaman." });
      await tx.finArCreditNoteLine.deleteMany({ where: { credit_note_id: id } });
      await tx.finArCreditNoteLine.createMany({ data: r.c.lines.map((l) => ({ ...l, credit_note_id: id })) });
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, creditNo: current.credit_no };
  });
}

type Stored = Prisma.FinArCreditNoteGetPayload<{ include: { lines: true } }>;

function asInput(n: Stored): { header: CreditNoteHeaderInput; lines: CreditNoteLineInput[] } {
  return {
    header: { invoice_id: n.invoice_id, credit_date: isoDay(n.credit_date), customer_return_no: n.customer_return_no ?? "", note: n.note ?? "" },
    lines: [...n.lines].sort((a, b) => a.line_no - b.line_no).map((l) => ({ invoice_line_id: l.invoice_line_id, qty: l.qty.toNumber() })),
  };
}

// --------------------------------------------------------------- lifecycle

export type CreditNoteTransitionResult = { ok: true; journal?: JournalLineInput[] } | { ok: false; errors: Record<string, string> };

/** The journal Posting would write now — Posting run as a dry run and rolled back (P103). */
export async function creditNotePreview(id: number, actorId: number): Promise<JournalPreviewResult> {
  const r = await transitionCreditNote(id, "post", actorId, undefined, { dryRun: true });
  if (!r.ok) return r;
  return { ok: true, lines: await describeJournalLines(r.journal ?? []) };
}

/**
 * Runs one lifecycle step. **Posting**, under the Customer Order's lock: checks
 * the stored note again — its figures worked out anew after what other posted
 * Credit Notes took (P112) — creates the Retur item at its total and base,
 * applies it to the Invoice item as far as that item's balance goes, then posts
 * the journal at what the books moved: Cr Piutang at the Retur item's base
 * less what of it was used plus what the Invoice item gave up, the difference
 * of the two reliefs being selisih kurs (MC13; nil in rupiah).
 */
export async function transitionCreditNote(
  id: number,
  action: CreditNoteAction,
  actorId: number,
  reason?: string,
  options: { dryRun?: boolean } = {}
): Promise<CreditNoteTransitionResult> {
  const n = await prisma.finArCreditNote.findUnique({ where: { id }, include: { lines: true } });
  if (!n) return { ok: false, errors: { _form: "Credit Note tidak ditemukan." } };
  const t = CREDIT_NOTE_TRANSITIONS[action];
  if (!creditNoteTransitionAllowed(action, n.status as CreditNoteStatus)) {
    return { ok: false, errors: { _form: `Credit Note berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  const moved = "Credit Note berubah saat diproses. Muat ulang halaman.";
  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      const done = await tx.finArCreditNote.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const period = await checkTransactionDate(isoDay(n.credit_date));
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  const baseCurrency = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!baseCurrency) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, isoDay(n.credit_date));
      await lockCustomerOrder(tx, n.customer_order_id);
      const input = asInput(n);
      const r = await checkCreditNote(tx, input.header, input.lines, id);
      if (!r.ok) {
        const first = Object.entries(r.errors).find(([k]) => !k.startsWith("_"))?.[1] ?? Object.values(r.errors)[0];
        throw new Refused({ _form: `Belum bisa diposting: ${first}` });
      }
      const f = r.c.data;
      const keys = ["receivable_account", "sales_return_account", ...(f.ppn_amount > 0 ? (["output_vat_account"] as const) : [])] as const;
      const mapped = await postingAccounts([...keys, "fx_account"] as const);
      const need = mapped.ok ? null : mapped.missing.filter((m) => !/Selisih Kurs/i.test(m));
      if (!mapped.ok && need?.length) throw new Refused({ _form: `Lengkapi Account Mapping dulu: ${need.join(", ")}.` });
      const ids = (mapped.ok ? mapped.ids : {}) as Record<string, number>;
      if (!ids.receivable_account || !ids.sales_return_account || (f.ppn_amount > 0 && !ids.output_vat_account)) {
        throw new Refused({ _form: "Lengkapi Account Mapping dulu: Account Piutang Usaha, Account Retur Penjualan, Account PPN Keluaran." });
      }

      const done = await tx.finArCreditNote.updateMany({ where: { id, status: "Draft" }, data: { ...f, status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });
      await tx.finArCreditNoteLine.deleteMany({ where: { credit_note_id: id } });
      await tx.finArCreditNoteLine.createMany({ data: r.c.lines.map((l) => ({ ...l, credit_note_id: id })) });

      // The Retur item at the credit's total, then applied to the Invoice's
      // item as far as its balance goes (SR2); the books move first so the
      // journal carries what they relieved.
      const typeId = await docTypeId(tx, "fin_ar_credit_note");
      const doc = { docTypeId: typeId, docId: id, no: n.credit_no };
      const date = isoDay(f.credit_date);
      const returnItem = await createArItem(tx, {
        type: "Return",
        partnerId: f.customer_id,
        currencyId: f.currency_id,
        date,
        source: doc,
        createdBy: doc,
        scope: { docTypeId: await docTypeId(tx, "sal_customer_order"), docId: f.customer_order_id },
        amount: f.total_amount,
        base: f.base_total_amount,
        note: `Credit Note ${n.credit_no} atas ${r.c.source.invoiceNo}`,
        actorId,
      });
      const invItem = r.c.source.arItemId;
      const open = invItem ? (await arItemHeld(tx, invItem)).foreign : 0;
      const applied = Math.min(cents(f.total_amount), cents(open)) / 100;
      let fx = 0;
      if (invItem && applied > 0) {
        const fromInvoice = await settleArItem(tx, { itemId: invItem, event: "ReturnApplied", amount: applied, date, doc, counterItemId: returnItem, note: `Retur ${n.credit_no}`, actorId });
        const fromReturn = await settleArItem(tx, { itemId: returnItem, event: "ReturnUsed", amount: applied, date, doc, counterItemId: invItem, note: `Diterapkan ke ${r.c.source.invoiceNo}`, actorId });
        fx = (cents(fromInvoice) - cents(fromReturn)) / 100;
      }

      const cur = r.c.source.currency;
      const fmtQty = r.c.lines.map((l) => {
        const s = r.c.source.lines.find((x) => x.id === l.invoice_line_id)!;
        return `${s.itemLabel} ${qtyText(l.qty)} ${s.uomLabel}`;
      });
      const line = (accountId: number, debit: number, credit: number, base: number, description: string, partnerId: number | null = null): JournalLineInput => ({
        accountId,
        partnerId,
        currencyId: f.currency_id,
        rate: f.exchange_rate,
        debit,
        credit,
        baseAmount: base,
        description,
      });
      const journalLines: JournalLineInput[] = [
        line(ids.sales_return_account, f.dpp_amount, 0, f.base_dpp_amount, `Retur penjualan ${fmtQty.join(", ")} (${r.c.source.invoiceNo})`),
        ...(f.ppn_amount > 0 ? [line(ids.output_vat_account, f.ppn_amount, 0, f.base_ppn_amount, `PPN atas retur — ${n.credit_no}`)] : []),
        line(ids.receivable_account, 0, f.total_amount, (cents(f.base_total_amount) + cents(fx)) / 100, `Piutang turun — ${n.credit_no} atas ${r.c.source.invoiceNo}`, f.customer_id),
      ];
      if (fx !== 0) {
        if (!ids.fx_account) throw new Refused({ _form: "Lengkapi Account Mapping dulu: Account Selisih Kurs." });
        journalLines.push({
          accountId: ids.fx_account,
          partnerId: null,
          currencyId: baseCurrency.id,
          rate: 1,
          debit: fx > 0 ? fx : 0,
          credit: fx < 0 ? -fx : 0,
          description: `Selisih kurs retur ${n.credit_no}`,
        });
      }
      const journal = await postJournal(tx, {
        description: `${n.credit_no} · Credit Note ${r.c.source.invoiceNo} — ${r.c.source.customerName} (${formatMoney(f.total_amount, cur)})`,
        sourceDocTypeId: typeId,
        sourceDocId: id,
        postingDate: f.credit_date,
        actorId,
        lines: journalLines,
      });
      await tx.finArCreditNote.update({ where: { id }, data: { journal_id: journal.id, ar_item_id: returnItem, applied_amount: applied, fx_difference: fx } });
      await audit(tx, id, "UPDATE", "post", actorId);
      if (options.dryRun) throw new PostingDryRun(journalLines);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

export type CreditNoteListRow = {
  id: number;
  creditNo: string;
  creditDate: string;
  status: CreditNoteStatus;
  invoiceId: number;
  invoiceNo: string;
  customerLabel: string;
  customerName: string;
  currency: string;
  total: number;
  lines: number;
};

export async function listCreditNotes(): Promise<CreditNoteListRow[]> {
  const rows = await prisma.finArCreditNote.findMany({
    orderBy: [{ credit_date: "desc" }, { id: "desc" }],
    include: { customer: true, currency: true, invoice: { select: { invoice_no: true } }, _count: { select: { lines: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    creditNo: r.credit_no,
    creditDate: isoDay(r.credit_date),
    status: r.status as CreditNoteStatus,
    invoiceId: r.invoice_id,
    invoiceNo: r.invoice.invoice_no,
    customerLabel: r.customer.partner_label,
    customerName: r.customer.partner_name,
    currency: r.currency.currency_label,
    total: r.total_amount.toNumber(),
    lines: r._count.lines,
  }));
}

export type CreditNoteView = {
  id: number;
  creditNo: string;
  status: CreditNoteStatus;
  header: CreditNoteHeaderInput;
  lines: CreditNoteLineInput[];
  /** Stored figures — final once posted; per line in the order of `lines`. */
  lineAmounts: { dpp: number; ppn: number }[];
  dpp: number;
  ppn: number;
  total: number;
  applied: number;
  journalId: number | null;
  journalNo: string | null;
  cancelReason: string | null;
};

export async function getCreditNote(id: number): Promise<CreditNoteView | null> {
  const n = await prisma.finArCreditNote.findUnique({ where: { id }, include: { lines: true } });
  if (!n) return null;
  const input = asInput(n);
  return {
    id: n.id,
    creditNo: n.credit_no,
    status: n.status as CreditNoteStatus,
    header: input.header,
    lines: input.lines,
    lineAmounts: [...n.lines].sort((a, b) => a.line_no - b.line_no).map((l) => ({ dpp: l.dpp_amount.toNumber(), ppn: l.ppn_amount.toNumber() })),
    dpp: n.dpp_amount.toNumber(),
    ppn: n.ppn_amount.toNumber(),
    total: n.total_amount.toNumber(),
    applied: n.applied_amount.toNumber(),
    journalId: n.journal_id,
    journalNo: n.journal_id ? ((await journalNumbersByIds([n.journal_id])).get(n.journal_id) ?? null) : null,
    cancelReason: n.cancel_reason,
  };
}

/**
 * What posted Credit Notes credited of each Invoice — DPP, PPN and DPP per
 * Invoice line — for the receipt, which settles the Invoice net of them (P293).
 */
export async function postedCreditsByInvoices(db: Db, invoiceIds: number[]): Promise<Map<number, { dpp: number; ppn: number; lineDpp: Map<number, number> }>> {
  const out = new Map<number, { dpp: number; ppn: number; lineDpp: Map<number, number> }>();
  if (!invoiceIds.length) return out;
  const notes = await db.finArCreditNote.findMany({ where: { invoice_id: { in: invoiceIds }, status: "Posted" }, include: { lines: true } });
  for (const n of notes) {
    const c = out.get(n.invoice_id) ?? { dpp: 0, ppn: 0, lineDpp: new Map<number, number>() };
    c.dpp += n.dpp_amount.toNumber();
    c.ppn += n.ppn_amount.toNumber();
    for (const l of n.lines) c.lineDpp.set(l.invoice_line_id, (c.lineDpp.get(l.invoice_line_id) ?? 0) + l.dpp_amount.toNumber());
    out.set(n.invoice_id, c);
  }
  return out;
}

/** Credit Note numbers by id, for the audit panel. */
export async function creditNoteNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.finArCreditNote.findMany({ where: { id: { in: ids } }, select: { id: true, credit_no: true } });
  return new Map(rows.map((r) => [r.id, r.credit_no]));
}
