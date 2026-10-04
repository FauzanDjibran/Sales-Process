import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { BASE_CURRENCY_LABEL } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { checkTransactionDate } from "./fiscal";
import { postJournal, type JournalLineInput } from "./journal";
import { recordCashBankEntry } from "./cash-bank";
import { ArItemOverdrawn, arItemBalances, createArItem, lockArItems, settleArItem } from "./ar-item";
import { checkAccountIsLeaf } from "./records";
import { lockSalesAdvances, settlementAdvances } from "./sales-advance";
import { settlementInvoices } from "./sales-invoice";
import {
  cashToClear,
  ppnChain,
  receivedProblem,
  settleBillFromCash,
  type PpnRates,
  type SettlementLine,
} from "./sales-tax";
import { postingAccounts } from "./system-settings";
import {
  CASH_BANK_PREFIX,
  cashBankPurpose,
  purposesFor,
  type CashBankDirection,
  type CashBankPurpose,
  billKey,
  type SettledDocKind,
} from "./cash-bank-purposes";
import {
  CASH_RECEIPT_TRANSITIONS,
  cashBankTxIsEditable,
  cashReceiptTransitionAllowed,
  type CashBankTxAction,
  type CashBankTxStatus,
} from "./cash-bank-tx-workflow";
import { formatMoney } from "@/lib/format";

/**
 * Penerimaan (and, later, Pengeluaran) Kas & Bank — the one document every
 * movement of money through a cash or bank resource is recorded on
 * (Claude-ERP.md P66–P70). Its tables are `fin_cash_bank_tx(_line, _line_wht)`
 * and nothing else names them.
 *
 * **Tujuan, then Partner, decide what one transaction may settle** (P67): the
 * purpose names the kind of document, the partner narrows it to what that one
 * partner owes. Every line is one such document, so a customer who pays three
 * bills with one transfer is one receipt matching one bank-statement line.
 *
 * Each line says what it clears of its bill — **Dilunasi** — and whether the
 * customer withheld PPh on it (P60). The PPN and PPh shares follow from
 * `sales-tax.ts`; the document balances when
 *
 *   Σ Dilunasi = dana diterima + biaya bank + Σ PPh.
 *
 * The bank charge is the company's (P68): it goes to Beban Bank and still
 * clears the bills. Leaving it out keeps the difference open on the bill.
 *
 * A Draft touches no book. Posting writes the journal and the Cash Bank Book
 * in one transaction, with every settled bill's row locked and its open amount
 * read again, so two receipts cannot both clear the last of one bill.
 *
 * One customer purpose settles advance bills and Invoices together (P83, §7.8):
 * an advance-bill line posts Cr Uang Muka Penjualan (its DPP part) and Cr PPN
 * Keluaran and creates an Uang Muka AR item; an Invoice line posts Cr Piutang
 * Usaha for all it settles and records *Pembayaran* on the Invoice's Invoice
 * AR item, whose balance is what the Invoice still asks for (U23).
 *
 * Dependencies point one way (§3.1): this module reads the advance through
 * `sales-advance.ts` and the Invoice through `sales-invoice.ts`; the advance
 * learns what was paid through `settledByDocuments` here, composed by the
 * action or page that needs both.
 */

type Db = Prisma.TransactionClient | typeof prisma;

// ------------------------------------------------------------------ input

export type CashReceiptLineInput = {
  /** What the line settles; an advance bill when left out (receipts saved before P83). */
  doc_type?: SettledDocKind;
  doc_id: number | null;
  /** What the customer actually paid for this bill (P76). */
  cash: number;
  withhold: boolean;
};

export type CashReceiptInput = {
  purpose: string;
  tx_date: string;
  partner_id: number | null;
  cash_bank_id: number | null;
  bank_ref: string;
  note: string;
  /** The company's bank charge on the transfer (P68). */
  bank_charge: number;
  lines: CashReceiptLineInput[];
};

export type CashReceiptResult =
  | { ok: true; id: number; txNo: string }
  | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const money = (n: number) => formatMoney(n, BASE_CURRENCY_LABEL);
const lineKey = (i: number, f: string) => `lines.${i}.${f}`;

// ------------------------------------------------------------ settlements

async function docTypeId(db: Db, table: string): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: table }, select: { id: true } });
  if (!row) throw new Error(`Jenis dokumen ${table} belum terdaftar. Jalankan db:seed.`);
  return row.id;
}

/**
 * What posted transactions have settled of each document, by id — the one
 * source of a bill's paid state until the open items arrive (C22). `exceptTx`
 * leaves one transaction out, so a Draft being edited does not count itself.
 */
export async function settledByDocuments(
  table: string,
  ids: number[],
  db: Db = prisma,
  exceptTx: number | null = null
): Promise<Map<number, number>> {
  if (!ids.length) return new Map();
  const typeId = await docTypeId(db, table);
  const rows = await db.finCashBankTxLine.groupBy({
    by: ["doc_id"],
    where: {
      doc_type_id: typeId,
      doc_id: { in: ids },
      tx: { status: "Posted", ...(exceptTx ? { id: { not: exceptTx } } : {}) },
    },
    _sum: { settled_amount: true },
  });
  return new Map(rows.map((r) => [r.doc_id, r._sum.settled_amount?.toNumber() ?? 0]));
}

/** The transactions that name a document, newest first — for its page. */
export async function settlementsOfDocument(
  table: string,
  id: number
): Promise<{ id: number; txNo: string; date: string; status: CashBankTxStatus; settled: number; direction: CashBankDirection }[]> {
  const typeId = await docTypeId(prisma, table);
  const rows = await prisma.finCashBankTxLine.findMany({
    where: { doc_type_id: typeId, doc_id: id },
    include: { tx: true },
    orderBy: { tx: { tx_date: "desc" } },
  });
  return rows.map((r) => ({
    id: r.tx.id,
    txNo: r.tx.tx_no,
    date: isoDay(r.tx.tx_date),
    status: r.tx.status as CashBankTxStatus,
    settled: r.settled_amount.toNumber(),
    direction: r.tx.direction as CashBankDirection,
  }));
}

/**
 * Why a document may no longer be cancelled, or null: a posted transaction
 * has settled it, even in part (P66). Handed to the advance's cancellation by
 * the action layer; asked inside its transaction, with the bill locked.
 */
export async function settledDocumentRefusal(
  table: string,
  tx: Prisma.TransactionClient,
  id: number
): Promise<string | null> {
  const paid = (await settledByDocuments(table, [id], tx)).get(id) ?? 0;
  return paid > 0
    ? `Tagihan ini sudah dibayar ${money(paid)} melalui Penerimaan Kas & Bank. Sisa yang tidak terpakai dikembalikan, bukan dibatalkan.`
    : null;
}

/**
 * An open document as the form offers it — an advance bill or an Invoice — with
 * what is left of it. Both settle by the same rule (§7.3); they differ in what
 * is open and in how they post (§7.8).
 */
export type OpenBill = {
  kind: SettledDocKind;
  /** `kind:id`, unique across both kinds. */
  key: string;
  id: number;
  no: string;
  date: string;
  dueDate: string;
  /** The advance bill's or the Invoice's own status. */
  status: string;
  customerId: number;
  orderId: number;
  orderNo: string;
  /** What it asks for, PPN included. */
  total: number;
  dpp: number;
  ppn: number;
  /** The advance bill's PPN snapshot, for its Faktur Pajak Uang Muka; null for an Invoice. */
  rates: PpnRates | null;
  withholdings: { key: string; rate: number; base: number; amount: number }[];
  /** An Invoice's Invoice AR item. */
  arItemId: number | null;
  /** Settled before this receipt. */
  paid: number;
  open: number;
};


async function openBills(
  db: Db,
  filter: { advanceIds?: number[]; invoiceIds?: number[]; openOnly?: boolean },
  exceptTx: number | null
): Promise<OpenBill[]> {
  const wantAdvances = filter.openOnly || (filter.advanceIds?.length ?? 0) > 0;
  const wantInvoices = filter.openOnly || (filter.invoiceIds?.length ?? 0) > 0;
  const [advances, invoices] = await Promise.all([
    wantAdvances ? settlementAdvances(filter.openOnly ? { issuedOnly: true } : { ids: filter.advanceIds }, db) : Promise.resolve([]),
    wantInvoices ? settlementInvoices(filter.openOnly ? { postedOnly: true } : { ids: filter.invoiceIds }, db) : Promise.resolve([]),
  ]);
  const paid = await settledByDocuments("sal_advance", advances.map((b) => b.id), db, exceptTx);
  // An Invoice's open amount is its Invoice item's balance — the book (U23).
  const balances = await arItemBalances(invoices.flatMap((i) => (i.arItemId ? [i.arItemId] : [])), db);
  const out: OpenBill[] = [
    ...advances.map((b) => {
      const p = paid.get(b.id) ?? 0;
      return {
        kind: "sal_advance" as const,
        key: billKey("sal_advance", b.id),
        id: b.id,
        no: b.advanceNo,
        date: b.advanceDate,
        dueDate: b.dueDate,
        status: b.status,
        customerId: b.customerId,
        orderId: b.orderId,
        orderNo: b.orderNo,
        total: b.total,
        dpp: b.dpp,
        ppn: b.ppn,
        rates: b.rates,
        withholdings: b.withholdings,
        arItemId: null,
        paid: p,
        open: b.total - p,
      };
    }),
    ...invoices.map((i) => {
      const open = i.arItemId ? (balances.get(i.arItemId) ?? 0) : 0;
      return {
        kind: "sal_invoice" as const,
        key: billKey("sal_invoice", i.id),
        id: i.id,
        no: i.invoiceNo,
        date: i.invoiceDate,
        dueDate: i.dueDate,
        status: i.status,
        customerId: i.customerId,
        orderId: i.orderId,
        orderNo: i.orderNo,
        total: i.total,
        dpp: i.dpp,
        ppn: i.ppn,
        rates: null,
        withholdings: i.withholdings,
        arItemId: i.arItemId,
        paid: i.total - open,
        open,
      };
    }),
  ];
  // Oldest due first: the order the picker lists them and Bagikan Dana spends in.
  return out.sort((a, b) => (a.dueDate === b.dueDate ? (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1) : a.dueDate < b.dueDate ? -1 : 1));
}

// ---------------------------------------------------------------- options

export type ReceiptPartnerOption = { id: number; label: string; name: string; active: boolean; category: string };
export type ReceiptCashBankOption = { id: number; label: string; name: string; active: boolean; type: string };

export type CashReceiptOptions = {
  purposes: CashBankPurpose[];
  partners: ReceiptPartnerOption[];
  cashBanks: ReceiptCashBankOption[];
  /** Every issued bill still open — the form narrows them to the partner. */
  bills: OpenBill[];
  /** Jenis PPh labels by id, for the withholding columns. */
  withholdingLabels: Record<string, string>;
};

/**
 * What the form offers. `current` is the transaction being edited: its own
 * bills are always included, open or not, so the form still shows what it
 * holds, and its own lines never count against the bills.
 */
export async function cashReceiptOptions(
  current: { id: number; docs: { kind: SettledDocKind; id: number }[] } | null = null
): Promise<CashReceiptOptions> {
  const purposes = [...purposesFor("In")];
  const [partners, cashBanks, taxes] = await Promise.all([
    prisma.mPartner.findMany({
      where: { category: { category_label: { in: [...new Set(purposes.map((p) => p.partnerCategory))] } } },
      include: { category: true },
      orderBy: { partner_label: "asc" },
    }),
    prisma.mCashBank.findMany({
      where: { currency: { currency_label: BASE_CURRENCY_LABEL } },
      orderBy: { cash_bank_label: "asc" },
    }),
    prisma.refWithholdingTax.findMany({ select: { id: true, wht_label: true } }),
  ]);
  const issued = await openBills(prisma, { openOnly: true }, current?.id ?? null);
  const mine = new Set((current?.docs ?? []).map((d) => billKey(d.kind, d.id)));
  const missing = (current?.docs ?? []).filter((d) => !issued.some((b) => b.key === billKey(d.kind, d.id)));
  const own = missing.length
    ? await openBills(
        prisma,
        {
          advanceIds: missing.filter((d) => d.kind === "sal_advance").map((d) => d.id),
          invoiceIds: missing.filter((d) => d.kind === "sal_invoice").map((d) => d.id),
        },
        current!.id
      )
    : [];
  return {
    purposes,
    partners: partners.map((p) => ({
      id: p.id,
      label: p.partner_label,
      name: p.partner_name,
      active: p.status === "Active",
      category: p.category.category_label,
    })),
    cashBanks: cashBanks.map((c) => ({
      id: c.id,
      label: c.cash_bank_label,
      name: c.cash_bank_name,
      active: c.status === "Active",
      type: c.cash_bank_type,
    })),
    bills: [...issued.filter((b) => b.open > 0 || mine.has(b.key)), ...own],
    withholdingLabels: Object.fromEntries(taxes.map((t) => [String(t.id), t.wht_label])),
  };
}

// ------------------------------------------------------------- validation

/**
 * The document's figures, all following from its lines (P76): what the lines
 * received, less the bank charge, is what reached the bank; what they cleared
 * is that money plus the charge plus the PPh withheld.
 */
export type ReceiptTotals = { received: number; bankCharge: number; cash: number; settled: number; pph: number };

type CheckedLine = SettlementLine & { kind: SettledDocKind; docId: number; withhold: boolean; bill: OpenBill };

type Checked = {
  data: {
    direction: CashBankDirection;
    purpose: string;
    tx_date: Date;
    partner_id: number;
    cash_bank_id: number;
    bank_ref: string | null;
    note: string | null;
    cash_amount: number;
    bank_charge: number;
    settled_amount: number;
    pph_amount: number;
  };
  lines: CheckedLine[];
  balance: ReceiptTotals;
  cashBankAccountId: number;
};

/**
 * Every rule a receipt must satisfy to be saved — and, run again inside the
 * posting transaction with the bills locked, to be posted.
 */
export async function checkCashReceipt(
  db: Db,
  input: CashReceiptInput,
  selfId: number | null
): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};

  const purpose = cashBankPurpose(String(input.purpose ?? ""));
  if (!purpose || purpose.direction !== "In") errors.purpose = "Pilih tujuan penerimaan.";

  const date = String(input.tx_date ?? "").trim();
  if (!DAY.test(date)) errors.tx_date = "Tanggal terima wajib diisi.";

  const partnerId = Number(input.partner_id) || null;
  if (!partnerId) errors.partner_id = "Pilih partner.";
  else if (purpose) {
    const p = await db.mPartner.findUnique({ where: { id: partnerId }, include: { category: true } });
    if (!p) errors.partner_id = "Partner tidak ditemukan.";
    else if (p.category.category_label !== purpose.partnerCategory) {
      errors.partner_id = `Tujuan ini hanya untuk ${purpose.partnerCategory}.`;
    } else if (p.status !== "Active") errors.partner_id = "Partner tersebut sudah nonaktif.";
  }

  const cashBankId = Number(input.cash_bank_id) || null;
  let cashBankAccountId = 0;
  if (!cashBankId) errors.cash_bank_id = "Pilih kas atau bank penerima.";
  else {
    const cb = await db.mCashBank.findUnique({ where: { id: cashBankId }, include: { currency: true } });
    if (!cb) errors.cash_bank_id = "Kas & Bank tidak ditemukan.";
    else if (cb.currency.currency_label !== BASE_CURRENCY_LABEL) errors.cash_bank_id = "Hanya kas & bank Rupiah untuk saat ini.";
    else if (cb.status !== "Active") errors.cash_bank_id = "Kas & Bank tersebut sudah nonaktif.";
    else cashBankAccountId = cb.account_id;
  }

  const charge = Number(input.bank_charge) || 0;
  if (!Number.isFinite(charge) || charge < 0 || charge !== Math.round(charge)) {
    errors.bank_charge = "Biaya bank harus rupiah penuh, nol atau lebih.";
  }

  // ---- lines: documents of the purpose's kind, owed by the partner (P67)
  const raw = Array.isArray(input.lines) ? input.lines : [];
  const lines: CheckedLine[] = [];
  if (!raw.length) errors._lines = "Pilih minimal satu tagihan yang dibayar.";
  const kindOf = (l: CashReceiptLineInput): SettledDocKind => (l.doc_type === "sal_invoice" ? "sal_invoice" : "sal_advance");
  const idsOf = (kind: SettledDocKind) => raw.filter((l) => kindOf(l) === kind).map((l) => Number(l.doc_id)).filter(Boolean);
  const bills = new Map(
    (await openBills(db, { advanceIds: idsOf("sal_advance"), invoiceIds: idsOf("sal_invoice") }, selfId)).map((b) => [b.key, b])
  );
  const seen = new Set<string>();
  for (const [i, l] of raw.entries()) {
    const kind = kindOf(l);
    const id = Number(l.doc_id);
    const bill = bills.get(billKey(kind, id));
    if (!bill) {
      errors[lineKey(i, "doc_id")] = "Tagihan tidak ditemukan.";
      continue;
    }
    if (purpose && !purpose.settles.includes(kind)) {
      errors[lineKey(i, "doc_id")] = `${bill.no} tidak dapat dilunasi dengan tujuan ini.`;
      continue;
    }
    if (seen.has(bill.key)) {
      errors[lineKey(i, "doc_id")] = `${bill.no} dipilih lebih dari sekali.`;
      continue;
    }
    seen.add(bill.key);
    if (partnerId && bill.customerId !== partnerId) {
      errors[lineKey(i, "doc_id")] = `${bill.no} bukan tagihan partner ini.`;
      continue;
    }
    if (kind === "sal_advance" && bill.status !== "Issued") {
      errors[lineKey(i, "doc_id")] = `${bill.no} tidak berstatus Diterbitkan.`;
      continue;
    }
    if (kind === "sal_invoice" && (bill.status !== "Posted" || !bill.arItemId)) {
      errors[lineKey(i, "doc_id")] = `${bill.no} belum diposting atau tidak menyisakan piutang.`;
      continue;
    }
    if (DAY.test(date) && date < bill.date) {
      errors[lineKey(i, "doc_id")] = `Tanggal terima sebelum tanggal ${bill.no}.`;
      continue;
    }
    const received = Number(l.cash);
    const withhold = purpose?.withholding ? l.withhold !== false : false;
    const max = cashToClear(bill, bill.paid, withhold);
    const problem = receivedProblem(received, max);
    if (problem) {
      errors[lineKey(i, "cash")] = problem === "Melebihi sisa tagihan." ? `Melebihi yang melunasi ${bill.no} (${money(max)}).` : problem;
      continue;
    }
    const settled = settleBillFromCash({ bill, before: bill.paid, cash: received, withhold });
    if (settled.cash !== received) {
      // Two PPh shares moving on the same rupiah can skip a figure; one rupiah
      // either way always lands.
      errors[lineKey(i, "cash")] = `Nilai ini tidak dapat dibagi tepat dengan PPh-nya; ubah Rp1 (mis. ${money(settled.cash)}).`;
      continue;
    }
    lines.push({ ...settled, kind, docId: id, withhold, bill });
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) {
    errors._lines = "Ada tagihan yang perlu diperbaiki.";
  }

  const received = lines.reduce((a, l) => a + l.cash, 0);
  const balance: ReceiptTotals = {
    received,
    bankCharge: charge,
    cash: received - charge,
    settled: lines.reduce((a, l) => a + l.settled, 0),
    pph: lines.reduce((a, l) => a + l.pph, 0),
  };
  if (!errors.bank_charge && !errors._lines && lines.length && charge >= received) {
    errors.bank_charge = "Biaya bank harus lebih kecil dari total diterima.";
  }

  if (Object.keys(errors).length || !purpose) return { ok: false, errors };
  return {
    ok: true,
    c: {
      data: {
        direction: purpose.direction,
        purpose: purpose.key,
        tx_date: asDate(date),
        partner_id: partnerId!,
        cash_bank_id: cashBankId!,
        bank_ref: String(input.bank_ref ?? "").trim() || null,
        note: String(input.note ?? "").trim() || null,
        cash_amount: balance.cash,
        bank_charge: charge,
        settled_amount: balance.settled,
        pph_amount: balance.pph,
      },
      lines,
      balance,
      cashBankAccountId,
    },
  };
}

// ------------------------------------------------------------------ writes

async function nextTxNo(db: Db, direction: CashBankDirection, date: Date): Promise<string> {
  return nextDocumentNumber(CASH_BANK_PREFIX[direction], date, async (series) => {
    const row = await db.finCashBankTx.findFirst({
      where: { tx_no: { startsWith: series } },
      orderBy: { id: "desc" },
      select: { tx_no: true },
    });
    return row?.tx_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "fin_cash_bank_tx", row_id: id, action, event, by } });
}

/** The doc type ids lines are stored with, by kind. */
async function kindTypeIds(db: Db): Promise<Record<SettledDocKind, number>> {
  return { sal_advance: await docTypeId(db, "sal_advance"), sal_invoice: await docTypeId(db, "sal_invoice") };
}

function lineRows(typeIds: Record<SettledDocKind, number>, lines: CheckedLine[], actorId: number) {
  return lines.map((l, i) => ({
    line_no: i + 1,
    doc_type_id: typeIds[l.kind],
    doc_id: l.docId,
    settled_amount: l.settled,
    withhold: l.withhold,
    dpp_part: l.dppPart,
    ppn_part: l.ppnPart,
    pph_amount: l.pph,
    created_by: actorId,
    whts: {
      create: l.withholdings.map((w) => ({
        withholding_tax_id: Number(w.key),
        rate: w.rate,
        base_amount: w.base,
        amount: w.amount,
      })),
    },
  }));
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
    if (e instanceof ArItemOverdrawn) return { ok: false, errors: { _form: `Belum bisa diposting: ${e.message}` } };
    throw e;
  }
}

export async function createCashReceipt(input: CashReceiptInput, actorId: number): Promise<CashReceiptResult> {
  const r = await checkCashReceipt(prisma, input, null);
  if (!r.ok) return r;
  const made = await prisma.$transaction(async (tx) => {
    const typeIds = await kindTypeIds(tx);
    const row = await tx.finCashBankTx.create({
      data: {
        ...r.c.data,
        tx_no: await nextTxNo(tx, r.c.data.direction, r.c.data.tx_date),
        created_by: actorId,
        lines: { create: lineRows(typeIds, r.c.lines, actorId) },
      },
    });
    await audit(tx, row.id, "TAMBAH", "create", actorId);
    return row;
  });
  return { ok: true, id: made.id, txNo: made.tx_no };
}

export async function updateCashReceipt(id: number, input: CashReceiptInput, actorId: number): Promise<CashReceiptResult> {
  const current = await prisma.finCashBankTx.findUnique({ where: { id }, select: { status: true, tx_no: true, purpose: true } });
  if (!current) return { ok: false, errors: { _form: "Penerimaan tidak ditemukan." } };
  if (!cashBankTxIsEditable(current.status as CashBankTxStatus)) {
    return { ok: false, errors: { _form: "Hanya penerimaan berstatus Draft yang dapat diubah." } };
  }
  if (input.purpose !== current.purpose) {
    return { ok: false, errors: { purpose: "Tujuan tidak dapat diganti. Buat penerimaan baru untuk tujuan lain." } };
  }
  const r = await checkCashReceipt(prisma, input, id);
  if (!r.ok) return r;
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      const typeIds = await kindTypeIds(tx);
      const done = await tx.finCashBankTx.updateMany({
        where: { id, status: "Draft" },
        data: { ...r.c.data, updated_by: actorId },
      });
      if (done.count !== 1) throw new Refused({ _form: "Penerimaan berubah saat diproses. Muat ulang halaman." });
      // A Draft's lines are nobody's reference yet, so they are replaced whole.
      await tx.finCashBankTxLine.deleteMany({ where: { tx_id: id } });
      for (const line of lineRows(typeIds, r.c.lines, actorId)) {
        await tx.finCashBankTxLine.create({ data: { ...line, tx_id: id } });
      }
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, txNo: current.tx_no };
  });
}

/** A stored receipt, back in the shape `checkCashReceipt` reads. */
type StoredReceipt = Prisma.FinCashBankTxGetPayload<{ include: { lines: { include: { doc_type: { select: { doc_table: true } } } } } }>;
const WITH_LINES = { lines: { include: { doc_type: { select: { doc_table: true } } } } } as const;

function asInput(t: StoredReceipt): CashReceiptInput {
  return {
    purpose: t.purpose,
    tx_date: isoDay(t.tx_date),
    partner_id: t.partner_id,
    cash_bank_id: t.cash_bank_id,
    bank_ref: t.bank_ref ?? "",
    note: t.note ?? "",
    bank_charge: t.bank_charge.toNumber(),
    lines: [...t.lines]
      .sort((a, b) => a.line_no - b.line_no)
      .map((l) => ({
        doc_type: l.doc_type.doc_table as SettledDocKind,
        doc_id: l.doc_id,
        cash: l.settled_amount.minus(l.pph_amount).toNumber(),
        withhold: l.withhold,
      })),
  };
}

// ----------------------------------------------------------------- posting

/** A journal line as the posting dialog shows it and the posting writes it. */
export type PostingLine = {
  accountId: number;
  accountNo: string;
  accountName: string;
  partnerId: number | null;
  debit: number;
  credit: number;
  description: string;
};

type Posting = { ok: true; description: string; lines: PostingLine[] } | { ok: false; message: string };

/**
 * The journal a checked receipt writes (P66, `tax_concept.md` §9, §7.8):
 *
 *   Dr Kas & Bank           dana diterima
 *   Dr Beban Bank           biaya bank
 *   Dr PPh Dibayar Dimuka   per Jenis PPh
 *      Cr Uang Muka Penjualan   per advance bill, its DPP part, naming the customer
 *      Cr PPN Keluaran          the advance bills' PPN parts
 *      Cr Piutang Usaha         per Invoice, all it settles, naming the customer
 *
 * Every account is resolved against the master; a missing or unusable one
 * refuses the posting by name, never falls back.
 */
async function buildPosting(db: Db, c: Checked, partnerName: string): Promise<Posting> {
  const needCharge = c.data.bank_charge > 0;
  const advances = c.lines.filter((l) => l.kind === "sal_advance");
  const invoices = c.lines.filter((l) => l.kind === "sal_invoice");
  // An account is asked for only where it is used: a setting blocks only there.
  type Key = "sales_advance_account" | "output_vat_account" | "bank_charge_account" | "receivable_account";
  const keys: Key[] = [
    ...(advances.length ? (["sales_advance_account", "output_vat_account"] as const) : []),
    ...(invoices.length ? (["receivable_account"] as const) : []),
    ...(needCharge ? (["bank_charge_account"] as const) : []),
  ];
  const mapped = await postingAccounts<Key>(keys);
  const missing: string[] = mapped.ok ? [] : [...mapped.missing];

  // PPh accounts sit on each Jenis PPh (P44).
  const whtIds = [...new Set(c.lines.flatMap((l) => l.withholdings.map((w) => Number(w.key))))];
  const taxes = new Map(
    (await db.refWithholdingTax.findMany({ where: { id: { in: whtIds } } })).map((t) => [t.id, t])
  );
  for (const id of whtIds) {
    const t = taxes.get(id);
    const acc = t?.prepaid_account_id;
    if (!acc || (await accountProblem(db, acc))) missing.push(`Account PPh Dibayar Dimuka pada Jenis PPh ${t?.wht_label ?? id}`);
  }
  if (await accountProblem(db, c.cashBankAccountId)) missing.push("Account pada Kas & Bank yang dipilih");
  if (missing.length || !mapped.ok) {
    return {
      ok: false,
      message: `Belum bisa diposting — account belum diatur atau tidak dapat dipakai: ${missing.join("; ")}. Atur di Accounting › Pengaturan › Account Mapping atau pada master terkait.`,
    };
  }
  const ids = mapped.ids as Partial<Record<Key, number>>;
  const advanceAcc = ids.sales_advance_account ?? 0;
  const vatAcc = ids.output_vat_account ?? 0;
  const arAcc = ids.receivable_account ?? 0;

  const accounts = new Map(
    (
      await db.accAccount.findMany({
        where: {
          id: {
            in: [c.cashBankAccountId, advanceAcc, vatAcc, arAcc, ids.bank_charge_account, ...[...taxes.values()].map((t) => t.prepaid_account_id)].filter(
              (x): x is number => Boolean(x)
            ),
          },
        },
        select: { id: true, account_label: true, account_name: true, require_partner: true, partner_category: { select: { category_label: true } } },
      })
    ).map((a) => [a.id, a])
  );
  for (const accId of [advanceAcc, arAcc]) {
    const a = accounts.get(accId);
    if (a?.partner_category && a.partner_category.category_label !== "Customer") {
      return { ok: false, message: `Account ${a.account_label} mewajibkan partner ${a.partner_category.category_label}, bukan Customer.` };
    }
  }
  const line = (accountId: number, debit: number, credit: number, description: string, partnerId: number | null = null): PostingLine => {
    const a = accounts.get(accountId)!;
    return {
      accountId,
      accountNo: a.account_label,
      accountName: a.account_name,
      // A line names the partner where its account keeps positions per partner.
      partnerId: a.require_partner ? partnerId : null,
      debit,
      credit,
      description,
    };
  };

  const ref = c.data.bank_ref ? ` · ref ${c.data.bank_ref}` : "";
  const out: PostingLine[] = [line(c.cashBankAccountId, c.data.cash_amount, 0, `Dana diterima dari ${partnerName}${ref}`)];
  if (needCharge) {
    out.push(line(ids.bank_charge_account!, c.data.bank_charge, 0, "Biaya transfer dipotong bank"));
  }
  const pphByType = new Map<number, { amount: number; rate: number }>();
  for (const l of c.lines) {
    for (const w of l.withholdings) {
      const k = Number(w.key);
      const g = pphByType.get(k) ?? { amount: 0, rate: w.rate };
      g.amount += w.amount;
      pphByType.set(k, g);
    }
  }
  for (const [k, g] of pphByType) {
    const t = taxes.get(k)!;
    out.push(line(t.prepaid_account_id!, g.amount, 0, `${t.wht_label} dipotong ${partnerName} — bukti potong menunggu`, c.data.partner_id));
  }
  for (const l of advances) {
    if (l.dppPart > 0) out.push(line(advanceAcc, 0, l.dppPart, `Uang muka ${l.bill.no} (${l.bill.orderNo})`, c.data.partner_id));
  }
  const ppn = advances.reduce((a, l) => a + l.ppnPart, 0);
  if (ppn > 0) out.push(line(vatAcc, 0, ppn, `PPN uang muka terutang saat diterima — ${advances.filter((l) => l.ppnPart > 0).map((l) => l.bill.no).join(", ")}`));
  // An Invoice's PPN was booked at the Invoice: all it settles clears Piutang (U25).
  for (const l of invoices) {
    out.push(line(arAcc, 0, l.settled, `Pelunasan ${l.bill.no}${l.settled < l.bill.open ? " (sebagian)" : ""} (${l.bill.orderNo})`, c.data.partner_id));
  }

  return {
    ok: true,
    description: `Penerimaan ${c.lines.map((l) => l.bill.no).join(", ")} — ${partnerName}`,
    lines: out,
  };
}

/** Why an account may not be posted to, or null. */
async function accountProblem(db: Db, id: number): Promise<string | null> {
  const a = await db.accAccount.findUnique({ where: { id }, select: { is_postable: true, is_active: true } });
  if (!a) return "tidak ditemukan";
  if (!a.is_postable) return "bukan account postable";
  if (!a.is_active) return "non-aktif";
  return checkAccountIsLeaf(id);
}

/**
 * The journal lines posting would write now — what the Posting dialog shows
 * before anything is committed (design convention: consequences first).
 */
export async function previewCashReceiptPosting(id: number): Promise<Posting> {
  const t = await prisma.finCashBankTx.findUnique({ where: { id }, include: { ...WITH_LINES, partner: true } });
  if (!t) return { ok: false, message: "Penerimaan tidak ditemukan." };
  const r = await checkCashReceipt(prisma, asInput(t), id);
  if (!r.ok) return { ok: false, message: Object.values(r.errors)[0] };
  return buildPosting(prisma, r.c, t.partner.partner_name);
}

export type CashReceiptTransitionResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle step. **Posting** re-checks the stored receipt with every
 * bill locked — still issued, still open by at least what this receipt
 * settles, the date still in an open period — then writes the journal, the
 * Cash Bank Book entry and the settled figures in one transaction. Nothing is
 * written unless all of it is.
 */
export async function transitionCashReceipt(
  id: number,
  action: CashBankTxAction,
  actorId: number,
  reason?: string
): Promise<CashReceiptTransitionResult> {
  const t = await prisma.finCashBankTx.findUnique({ where: { id }, include: { ...WITH_LINES, partner: true } });
  if (!t || t.direction !== "In") return { ok: false, errors: { _form: "Penerimaan tidak ditemukan." } };
  const step = CASH_RECEIPT_TRANSITIONS[action];
  if (!cashReceiptTransitionAllowed(action, t.status as CashBankTxStatus)) {
    return { ok: false, errors: { _form: `Penerimaan berstatus ini tidak dapat di-${step.label.toLowerCase()}.` } };
  }

  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan pembatalan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      const done = await tx.finCashBankTx.updateMany({
        where: { id, status: "Draft" },
        data: { status: "Cancelled", cancel_reason: why, updated_by: actorId },
      });
      if (done.count !== 1) throw new Error("Penerimaan berubah saat diproses. Muat ulang halaman.");
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const period = await checkTransactionDate(isoDay(t.tx_date));
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  const baseCurrency = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!baseCurrency) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      // Every document the receipt settles is locked before it is read again:
      // the advance bills, and the Invoices' Invoice items (U28).
      const stored = asInput(t);
      await lockSalesAdvances(tx, stored.lines.filter((l) => l.doc_type !== "sal_invoice").map((l) => Number(l.doc_id)));
      const invoiceIds = stored.lines.filter((l) => l.doc_type === "sal_invoice").map((l) => Number(l.doc_id));
      if (invoiceIds.length) {
        await lockArItems(tx, (await settlementInvoices({ ids: invoiceIds }, tx)).flatMap((i) => (i.arItemId ? [i.arItemId] : [])));
      }
      const r = await checkCashReceipt(tx, stored, id);
      if (!r.ok) throw new Refused({ _form: `Belum bisa diposting: ${Object.values(r.errors)[0]}` });
      const posting = await buildPosting(tx, r.c, t.partner.partner_name);
      if (!posting.ok) throw new Refused({ _form: posting.message });

      const done = await tx.finCashBankTx.updateMany({
        where: { id, status: "Draft" },
        data: {
          status: "Posted",
          cash_amount: r.c.data.cash_amount,
          settled_amount: r.c.balance.settled,
          pph_amount: r.c.balance.pph,
          updated_by: actorId,
        },
      });
      if (done.count !== 1) throw new Refused({ _form: "Penerimaan berubah saat diproses. Muat ulang halaman." });

      const typeId = await docTypeId(tx, "fin_cash_bank_tx");
      const journal = await postJournal(tx, {
        description: `${t.tx_no} · ${posting.description}`,
        sourceDocTypeId: typeId,
        sourceDocId: id,
        postingDate: t.tx_date,
        actorId,
        lines: posting.lines.map(
          (l): JournalLineInput => ({
            accountId: l.accountId,
            partnerId: l.partnerId,
            currencyId: baseCurrency.id,
            rate: 1,
            debit: l.debit,
            credit: l.credit,
            description: l.description,
          })
        ),
      });
      await recordCashBankEntry(tx, {
        cashBankId: t.cash_bank_id,
        date: isoDay(t.tx_date),
        type: "Transaction",
        direction: "In",
        rate: 1,
        amount: r.c.data.cash_amount,
        sourceDocTypeId: typeId,
        sourceDocId: id,
        note: `${t.tx_no} · ${posting.description}`,
        actorId,
      });
      await tx.finCashBankTx.update({ where: { id }, data: { journal_id: journal.id } });

      // The settled figures are restated as posted: another receipt may have
      // settled part of a bill since this Draft was saved.
      const typeIds = await kindTypeIds(tx);
      await tx.finCashBankTxLine.deleteMany({ where: { tx_id: id } });
      for (const line of lineRows(typeIds, r.c.lines, actorId)) {
        await tx.finCashBankTxLine.create({ data: { ...line, tx_id: id } });
      }
      // Each bill paid is an Uang Muka the customer now holds (P73): one AR
      // item per bill, at the DPP part the Uang Muka account was credited
      // with, so the items reconcile with that account. The item is about the
      // bill and carries its Faktur Pajak Uang Muka (U1, U9); the receipt is
      // named by its Create entry.
      for (const l of r.c.lines) {
        if (l.kind !== "sal_advance" || !(l.dppPart > 0)) continue;
        await createArItem(tx, {
          type: "Advance",
          partnerId: t.partner_id,
          currencyId: baseCurrency.id,
          date: isoDay(t.tx_date),
          source: { docTypeId: typeIds.sal_advance, docId: l.docId, no: l.bill.no },
          createdBy: { docTypeId: typeId, docId: id, no: t.tx_no },
          orderId: l.bill.orderId,
          amount: l.dppPart,
          tax: l.bill.rates ? { dpp: l.dppPart, dppOther: ppnChain(l.dppPart, l.bill.rates).dppOther, ppn: l.ppnPart } : null,
          note: `Uang muka ${l.bill.no} diterima`,
          actorId,
        });
      }
      // Each Invoice paid lowers its Invoice item by all it settles (P72).
      for (const l of r.c.lines) {
        if (l.kind !== "sal_invoice" || !l.bill.arItemId) continue;
        await settleArItem(tx, {
          itemId: l.bill.arItemId,
          event: "Payment",
          amount: l.settled,
          date: isoDay(t.tx_date),
          doc: { docTypeId: typeId, docId: id, no: t.tx_no },
          note: l.pph ? `Diterima ${money(l.cash)} + PPh ${money(l.pph)}` : `Diterima ${money(l.cash)}`,
          actorId,
        });
      }
      await audit(tx, id, "UPDATE", "post", actorId);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

export type CashReceiptListRow = {
  id: number;
  txNo: string;
  date: string;
  status: CashBankTxStatus;
  purpose: string;
  partnerLabel: string;
  partnerName: string;
  cashBankLabel: string;
  bankRef: string | null;
  cash: number;
  settled: number;
  pph: number;
  lines: number;
  docs: string[];
};

export async function listCashReceipts(): Promise<CashReceiptListRow[]> {
  const rows = await prisma.finCashBankTx.findMany({
    where: { direction: "In" },
    orderBy: [{ tx_date: "desc" }, { id: "desc" }],
    include: { partner: true, cash_bank: true, lines: { select: { doc_id: true, doc_type: { select: { doc_table: true } } } } },
  });
  const idsOf = (kind: SettledDocKind) => [
    ...new Set(rows.flatMap((r) => r.lines.filter((l) => l.doc_type.doc_table === kind).map((l) => l.doc_id))),
  ];
  const bills = new Map(
    (await openBills(prisma, { advanceIds: idsOf("sal_advance"), invoiceIds: idsOf("sal_invoice") }, null)).map((b) => [b.key, b.no])
  );
  return rows.map((r) => ({
    id: r.id,
    txNo: r.tx_no,
    date: isoDay(r.tx_date),
    status: r.status as CashBankTxStatus,
    purpose: r.purpose,
    partnerLabel: r.partner.partner_label,
    partnerName: r.partner.partner_name,
    cashBankLabel: r.cash_bank.cash_bank_label,
    bankRef: r.bank_ref,
    cash: r.cash_amount.toNumber(),
    settled: r.settled_amount.toNumber(),
    pph: r.pph_amount.toNumber(),
    lines: r.lines.length,
    docs: r.lines.map((l) => bills.get(billKey(l.doc_type.doc_table as SettledDocKind, l.doc_id)) ?? "?"),
  }));
}

export type CashReceiptLineView = {
  kind: SettledDocKind;
  docId: number;
  settled: number;
  withhold: boolean;
  dppPart: number;
  ppnPart: number;
  pph: number;
  withholdings: { key: string; rate: number; base: number; amount: number }[];
};

export type CashReceiptView = {
  id: number;
  txNo: string;
  status: CashBankTxStatus;
  input: CashReceiptInput;
  partnerLabel: string;
  partnerName: string;
  cashBankLabel: string;
  cashBankName: string;
  cancelReason: string | null;
  journal: { id: number; journalNo: string } | null;
  /** As stored — what the receipt was saved or posted with. */
  lines: CashReceiptLineView[];
};

export async function getCashReceipt(id: number): Promise<CashReceiptView | null> {
  const t = await prisma.finCashBankTx.findUnique({
    where: { id },
    include: {
      partner: true,
      cash_bank: true,
      journal: { select: { id: true, journal_no: true } },
      lines: { include: { whts: true, doc_type: { select: { doc_table: true } } }, orderBy: { line_no: "asc" } },
    },
  });
  if (!t || t.direction !== "In") return null;
  return {
    id: t.id,
    txNo: t.tx_no,
    status: t.status as CashBankTxStatus,
    input: asInput(t),
    partnerLabel: t.partner.partner_label,
    partnerName: t.partner.partner_name,
    cashBankLabel: t.cash_bank.cash_bank_label,
    cashBankName: t.cash_bank.cash_bank_name,
    cancelReason: t.cancel_reason,
    journal: t.journal ? { id: t.journal.id, journalNo: t.journal.journal_no } : null,
    lines: t.lines.map((l) => ({
      kind: l.doc_type.doc_table as SettledDocKind,
      docId: l.doc_id,
      settled: l.settled_amount.toNumber(),
      withhold: l.withhold,
      dppPart: l.dpp_part.toNumber(),
      ppnPart: l.ppn_part.toNumber(),
      pph: l.pph_amount.toNumber(),
      withholdings: l.whts.map((w) => ({
        key: String(w.withholding_tax_id),
        rate: w.rate.toNumber(),
        base: w.base_amount.toNumber(),
        amount: w.amount.toNumber(),
      })),
    })),
  };
}

/** Transaction numbers by id, for the audit panel. */
export async function cashBankTxNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  const rows = await prisma.finCashBankTx.findMany({ where: { id: { in: ids } }, select: { id: true, tx_no: true } });
  return new Map(rows.map((r) => [r.id, r.tx_no]));
}
