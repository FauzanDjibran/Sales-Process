import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { BASE_CURRENCY_LABEL } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { checkTransactionDate } from "./fiscal";
import { PostingDryRun, describeJournalLines, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { InsufficientFunds, recordCashBankEntry } from "./cash-bank";
import { ApItemOverdrawn, lockApItems, payAdvance, settleApItem } from "./ap-item";
import { lockPurchaseInvoices, purchaseInvoiceNumbersByIds, recordPurchaseInvoicePaid, settlementPurchaseInvoices, unpaidPurchaseInvoiceIds } from "./ap-invoice";
import { checkAccountIsLeaf } from "./records";
import { lockPurchaseAdvances, purchaseAdvanceNumbersByIds, recordPurchaseAdvancePaid, settlementAdvances, unpaidAdvanceIds } from "./ap-advance";
import { cashToClear, receivedProblem, settleBillFromCash, type SettlementLine } from "./sales-tax";
import { postingAccounts } from "./system-settings";
import { CASH_BANK_PREFIX, cashBankPurpose, paidKey, purposesFor, type CashBankPurpose, type PaidDocKind } from "./cash-bank-purposes";
import {
  CASH_PAYMENT_TRANSITIONS,
  cashBankTxIsEditable,
  type CashBankTxAction,
  type CashBankTxStatus,
} from "./cash-bank-tx-workflow";
import { formatMoney } from "@/lib/format";

/**
 * Pengeluaran Kas & Bank (P127, Purchasing-Concept.md B24–B27): the Out half of
 * the one cash & bank document (P66), in the same tables as the Penerimaan —
 * `fin_cash_bank_tx(_line, _line_wht)`, which this file and `cash-bank-tx.ts`
 * share as one module. The receipt mirrored: purpose, then supplier, decide
 * what one payment may settle; each line takes **the cash paid** for one
 * document and the PPh the company withholds explains the gap (P76 mirrored,
 * `tax_concept.md` §4.5); the bank charge is the company's (P68).
 *
 * Its first purpose is **Pembayaran ke Supplier**. An **advance-bill line**
 * posts Dr Uang Muka Pembelian (its DPP part, naming the supplier) · Dr PPN
 * Masukan / Cr Kas & Bank · Cr Hutang PPh per Jenis PPh, and creates an **AP
 * item Uang Muka** at the DPP paid (B26). An **Invoice line** posts Dr Hutang
 * Usaha / Cr Kas & Bank and records *Pembayaran* on the Invoice AP item; its
 * PPh was booked at the invoice, so the item's balance is what is paid (B27).
 * Money leaving a resource it does not hold is refused: *Saldo Cash & Bank
 * tidak mencukupi* (P104).
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type CashPaymentLineInput = { doc_type: PaidDocKind; doc_id: number | null; cash: number; withhold: boolean };

export type CashPaymentInput = {
  purpose: string;
  tx_date: string;
  partner_id: number | null;
  cash_bank_id: number | null;
  bank_ref: string;
  note: string;
  bank_charge: number;
  lines: CashPaymentLineInput[];
};

export type CashPaymentResult = { ok: true; id: number; txNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const money = (n: number) => formatMoney(n, BASE_CURRENCY_LABEL);
const lineKey = (i: number, f: string) => `lines.${i}.${f}`;

async function docTypeId(db: Db, table: string): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: table }, select: { id: true } });
  if (!row) throw new Error(`Jenis dokumen ${table} belum terdaftar. Jalankan db:seed.`);
  return row.id;
}

/** A supplier document open to pay, as the form offers it. */
export type OpenPayable = {
  kind: PaidDocKind;
  key: string;
  id: number;
  no: string;
  date: string;
  dueDate: string;
  status: string;
  supplierId: number;
  orderId: number;
  orderNo: string;
  total: number;
  dpp: number;
  ppn: number;
  withholdings: { key: string; rate: number; base: number; amount: number }[];
  /** An Invoice's AP item (step 7). */
  apItemId: number | null;
  paid: number;
  open: number;
};

async function openPayables(
  db: Db,
  filter: { advanceIds?: number[]; invoiceIds?: number[]; openOnly?: boolean }
): Promise<OpenPayable[]> {
  const [advances, invoices] = await Promise.all([
    filter.openOnly
      ? unpaidAdvanceIds(db).then((ids) => settlementAdvances({ ids }, db))
      : filter.advanceIds?.length
        ? settlementAdvances({ ids: filter.advanceIds }, db)
        : Promise.resolve([]),
    // Only Invoices not paid in full: a paid one is never offered.
    filter.openOnly
      ? unpaidPurchaseInvoiceIds(db).then((ids) => settlementPurchaseInvoices({ ids }, db))
      : filter.invoiceIds?.length
        ? settlementPurchaseInvoices({ ids: filter.invoiceIds }, db)
        : Promise.resolve([]),
  ]);
  // A document's open amount is what it asks less what it records as paid
  // (P132, P133) — never read from other payments.
  const out: OpenPayable[] = [
    ...advances.map((b) => {
      const p = b.paid;
      return {
        kind: "fin_ap_advance" as const,
        key: paidKey("fin_ap_advance", b.id),
        id: b.id,
        no: b.advanceNo,
        date: b.advanceDate,
        dueDate: b.dueDate,
        status: b.status,
        supplierId: b.supplierId,
        orderId: b.orderId,
        orderNo: b.orderNo,
        total: b.total,
        dpp: b.dpp,
        ppn: b.ppn,
        withholdings: b.withholdings,
        apItemId: null,
        paid: p,
        open: b.total - p,
      };
    }),
    // An Invoice's PPh and PPN were booked at the invoice, so it is paid in cash only (B27).
    ...invoices.map((i) => {
      const open = i.owed - i.paid;
      return {
        kind: "fin_ap_invoice" as const,
        key: paidKey("fin_ap_invoice", i.id),
        id: i.id,
        no: i.invoiceNo,
        date: i.invoiceDate,
        dueDate: i.dueDate,
        status: i.status,
        supplierId: i.supplierId,
        orderId: i.orderId,
        orderNo: i.orderNo,
        total: i.owed,
        dpp: i.owed,
        ppn: 0,
        withholdings: [],
        apItemId: i.apItemId,
        paid: i.paid,
        open,
      };
    }),
  ];
  return out.sort((a, b) => (a.dueDate === b.dueDate ? a.id - b.id : a.dueDate < b.dueDate ? -1 : 1));
}

// ---------------------------------------------------------------- options

export type CashPaymentOptions = {
  purposes: CashBankPurpose[];
  partners: { id: number; label: string; name: string; active: boolean; category: string }[];
  cashBanks: { id: number; label: string; name: string; active: boolean; type: string; balance: number }[];
  bills: OpenPayable[];
  withholdingLabels: Record<string, string>;
};

export async function cashPaymentOptions(current: { id: number; docs: { kind: PaidDocKind; id: number }[] } | null = null): Promise<CashPaymentOptions> {
  const purposes = [...purposesFor("Out")];
  const [partners, cashBanks, taxes] = await Promise.all([
    prisma.mPartner.findMany({
      where: { category: { category_label: { in: [...new Set(purposes.map((p) => p.partnerCategory))] } } },
      include: { category: true },
      orderBy: { partner_label: "asc" },
    }),
    prisma.mCashBank.findMany({ where: { currency: { currency_label: BASE_CURRENCY_LABEL } }, include: { book_balance: true }, orderBy: { cash_bank_label: "asc" } }),
    prisma.refWithholdingTax.findMany({ select: { id: true, wht_label: true } }),
  ]);
  const open = await openPayables(prisma, { openOnly: true });
  const mine = new Set((current?.docs ?? []).map((d) => paidKey(d.kind, d.id)));
  const missing = (current?.docs ?? []).filter((d) => !open.some((b) => b.key === paidKey(d.kind, d.id)));
  const own = missing.length
    ? await openPayables(prisma, { advanceIds: missing.filter((d) => d.kind === "fin_ap_advance").map((d) => d.id), invoiceIds: missing.filter((d) => d.kind === "fin_ap_invoice").map((d) => d.id) })
    : [];
  return {
    purposes,
    partners: partners.map((p) => ({ id: p.id, label: p.partner_label, name: p.partner_name, active: p.status === "Active", category: p.category.category_label })),
    cashBanks: cashBanks.map((c) => ({
      id: c.id,
      label: c.cash_bank_label,
      name: c.cash_bank_name,
      active: c.status === "Active",
      type: c.cash_bank_type,
      balance: c.book_balance?.balance.toNumber() ?? 0,
    })),
    bills: [...open.filter((b) => b.open > 0 || mine.has(b.key)), ...own],
    withholdingLabels: Object.fromEntries(taxes.map((t) => [String(t.id), t.wht_label])),
  };
}

// ------------------------------------------------------------- validation

export type PaymentTotals = { paid: number; bankCharge: number; cash: number; settled: number; pph: number };

type CheckedLine = SettlementLine & { kind: PaidDocKind; docId: number; withhold: boolean; bill: OpenPayable };

type Checked = {
  data: {
    direction: "Out";
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
  balance: PaymentTotals;
  cashBankAccountId: number;
};

/** Every rule a payment must satisfy to be saved — and, run again with the bills locked, to be posted. */
export async function checkCashPayment(db: Db, input: CashPaymentInput): Promise<{ ok: true; c: Checked } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const purpose = cashBankPurpose(String(input.purpose ?? ""));
  if (!purpose || purpose.direction !== "Out") errors.purpose = "Pilih tujuan pengeluaran.";
  const date = String(input.tx_date ?? "").trim();
  if (!DAY.test(date)) errors.tx_date = "Tanggal bayar wajib diisi.";

  const partnerId = Number(input.partner_id) || null;
  if (!partnerId) errors.partner_id = "Pilih partner.";
  else if (purpose) {
    const p = await db.mPartner.findUnique({ where: { id: partnerId }, include: { category: true } });
    if (!p) errors.partner_id = "Partner tidak ditemukan.";
    else if (p.category.category_label !== purpose.partnerCategory) errors.partner_id = `Tujuan ini hanya untuk ${purpose.partnerCategory}.`;
    else if (p.status !== "Active") errors.partner_id = "Partner tersebut sudah nonaktif.";
  }

  const cashBankId = Number(input.cash_bank_id) || null;
  let cashBankAccountId = 0;
  if (!cashBankId) errors.cash_bank_id = "Pilih kas atau bank pembayar.";
  else {
    const cb = await db.mCashBank.findUnique({ where: { id: cashBankId }, include: { currency: true } });
    if (!cb) errors.cash_bank_id = "Kas & Bank tidak ditemukan.";
    else if (cb.currency.currency_label !== BASE_CURRENCY_LABEL) errors.cash_bank_id = "Hanya kas & bank Rupiah untuk saat ini.";
    else if (cb.status !== "Active") errors.cash_bank_id = "Kas & Bank tersebut sudah nonaktif.";
    else cashBankAccountId = cb.account_id;
  }

  const charge = Number(input.bank_charge) || 0;
  if (!Number.isFinite(charge) || charge < 0 || charge !== Math.round(charge)) errors.bank_charge = "Biaya bank harus rupiah penuh, nol atau lebih.";

  const raw = Array.isArray(input.lines) ? input.lines : [];
  const lines: CheckedLine[] = [];
  if (!raw.length) errors._lines = "Pilih minimal satu tagihan yang dibayar.";
  const kindOf = (l: CashPaymentLineInput): PaidDocKind => (l.doc_type === "fin_ap_invoice" ? "fin_ap_invoice" : "fin_ap_advance");
  const bills = new Map(
    (
      await openPayables(
        db,
        {
          advanceIds: raw.filter((l) => kindOf(l) === "fin_ap_advance").map((l) => Number(l.doc_id)).filter(Boolean),
          invoiceIds: raw.filter((l) => kindOf(l) === "fin_ap_invoice").map((l) => Number(l.doc_id)).filter(Boolean),
        }
      )
    ).map((b) => [b.key, b])
  );
  const seen = new Set<string>();
  for (const [i, l] of raw.entries()) {
    const kind = kindOf(l);
    const bill = bills.get(paidKey(kind, Number(l.doc_id)));
    if (!bill) {
      errors[lineKey(i, "doc_id")] = "Tagihan tidak ditemukan.";
      continue;
    }
    if (purpose && !purpose.settles.includes(kind)) {
      errors[lineKey(i, "doc_id")] = `${bill.no} tidak dapat dibayar dengan tujuan ini.`;
      continue;
    }
    if (seen.has(bill.key)) {
      errors[lineKey(i, "doc_id")] = `${bill.no} dipilih lebih dari sekali.`;
      continue;
    }
    seen.add(bill.key);
    if (partnerId && bill.supplierId !== partnerId) {
      errors[lineKey(i, "doc_id")] = `${bill.no} bukan tagihan partner ini.`;
      continue;
    }
    if (kind === "fin_ap_advance" && bill.status !== "Issued") {
      errors[lineKey(i, "doc_id")] = `${bill.no} belum dicatat.`;
      continue;
    }
    if (kind === "fin_ap_invoice" && (bill.status !== "Posted" || !bill.apItemId)) {
      errors[lineKey(i, "doc_id")] = `${bill.no} belum diposting.`;
      continue;
    }
    if (DAY.test(date) && date < bill.date) {
      errors[lineKey(i, "doc_id")] = `Tanggal bayar sebelum tanggal ${bill.no}.`;
      continue;
    }
    const cash = Number(l.cash);
    const withhold = purpose?.withholding ? l.withhold !== false : false;
    const max = cashToClear(bill, bill.paid, withhold);
    const problem = receivedProblem(cash, max);
    if (problem) {
      errors[lineKey(i, "cash")] = problem === "Melebihi sisa tagihan." ? `Melebihi yang melunasi ${bill.no} (${money(max)}).` : problem;
      continue;
    }
    const settled = settleBillFromCash({ bill, before: bill.paid, cash, withhold });
    if (settled.cash !== cash) {
      errors[lineKey(i, "cash")] = `Nilai ini tidak dapat dibagi tepat dengan PPh-nya; ubah Rp1 (mis. ${money(settled.cash)}).`;
      continue;
    }
    lines.push({ ...settled, kind, docId: bill.id, withhold, bill });
  }
  if (!errors._lines && Object.keys(errors).some((k) => k.startsWith("lines."))) errors._lines = "Ada tagihan yang perlu diperbaiki.";

  const paid = lines.reduce((a, l) => a + l.cash, 0);
  // What leaves the bank is what the supplier gets plus the bank's charge (B25).
  const balance: PaymentTotals = {
    paid,
    bankCharge: charge,
    cash: paid + charge,
    settled: lines.reduce((a, l) => a + l.settled, 0),
    pph: lines.reduce((a, l) => a + l.pph, 0),
  };
  if (Object.keys(errors).length || !purpose) return { ok: false, errors };
  return {
    ok: true,
    c: {
      data: {
        direction: "Out",
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

async function nextTxNo(db: Db, date: Date): Promise<string> {
  return nextDocumentNumber(CASH_BANK_PREFIX.Out, date, async (series) => {
    const row = await db.finCashBankTx.findFirst({ where: { tx_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { tx_no: true } });
    return row?.tx_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "fin_cash_bank_tx", row_id: id, action, event, by } });
}

async function lineRows(db: Db, lines: CheckedLine[], actorId: number) {
  const typeIds: Partial<Record<PaidDocKind, number>> = {};
  for (const l of lines) typeIds[l.kind] ??= await docTypeId(db, l.kind);
  return lines.map((l, i) => ({
    line_no: i + 1,
    doc_type_id: typeIds[l.kind]!,
    doc_id: l.docId,
    settled_amount: l.settled,
    withhold: l.withhold,
    dpp_part: l.dppPart,
    ppn_part: l.ppnPart,
    pph_amount: l.pph,
    created_by: actorId,
    whts: { create: l.withholdings.map((w) => ({ withholding_tax_id: Number(w.key), rate: w.rate, base_amount: w.base, amount: w.amount })) },
  }));
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
    if (e instanceof ApItemOverdrawn || e instanceof InsufficientFunds) return { ok: false, errors: { _form: `Belum bisa diposting: ${e.message}` } };
    if (e instanceof PostingDryRun) return { ok: true, journal: e.lines } as T;
    throw e;
  }
}

export async function createCashPayment(input: CashPaymentInput, actorId: number): Promise<CashPaymentResult> {
  const r = await checkCashPayment(prisma, input);
  if (!r.ok) return r;
  const made = await prisma.$transaction(async (tx) => {
    const row = await tx.finCashBankTx.create({
      data: { ...r.c.data, tx_no: await nextTxNo(tx, r.c.data.tx_date), created_by: actorId, lines: { create: await lineRows(tx, r.c.lines, actorId) } },
    });
    await audit(tx, row.id, "TAMBAH", "create", actorId);
    return row;
  });
  return { ok: true, id: made.id, txNo: made.tx_no };
}

export async function updateCashPayment(id: number, input: CashPaymentInput, actorId: number): Promise<CashPaymentResult> {
  const current = await prisma.finCashBankTx.findUnique({ where: { id }, select: { status: true, tx_no: true, purpose: true, direction: true } });
  if (!current || current.direction !== "Out") return { ok: false, errors: { _form: "Pengeluaran tidak ditemukan." } };
  if (!cashBankTxIsEditable(current.status as CashBankTxStatus)) return { ok: false, errors: { _form: "Hanya pengeluaran berstatus Draft yang dapat diubah." } };
  if (input.purpose !== current.purpose) return { ok: false, errors: { purpose: "Tujuan tidak dapat diganti. Buat pengeluaran baru untuk tujuan lain." } };
  const r = await checkCashPayment(prisma, input);
  if (!r.ok) return r;
  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      const done = await tx.finCashBankTx.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: "Pengeluaran berubah saat diproses. Muat ulang halaman." });
      await tx.finCashBankTxLine.deleteMany({ where: { tx_id: id } });
      for (const line of await lineRows(tx, r.c.lines, actorId)) await tx.finCashBankTxLine.create({ data: { ...line, tx_id: id } });
      await audit(tx, id, "UPDATE", "update", actorId);
    });
    return { ok: true as const, id, txNo: current.tx_no };
  });
}

type StoredPayment = Prisma.FinCashBankTxGetPayload<{ include: { lines: { include: { doc_type: { select: { doc_table: true } } } } } }>;
const WITH_LINES = { lines: { include: { doc_type: { select: { doc_table: true } } } } } as const;

function asInput(t: StoredPayment): CashPaymentInput {
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
      .map((l) => ({ doc_type: l.doc_type.doc_table as PaidDocKind, doc_id: l.doc_id, cash: l.settled_amount.minus(l.pph_amount).toNumber(), withhold: l.withhold })),
  };
}

// ----------------------------------------------------------------- posting

async function accountProblem(db: Db, id: number): Promise<string | null> {
  const a = await db.accAccount.findUnique({ where: { id }, select: { is_postable: true, is_active: true } });
  if (!a) return "tidak ditemukan";
  if (!a.is_postable) return "bukan account postable";
  if (!a.is_active) return "non-aktif";
  return checkAccountIsLeaf(id);
}

/**
 * The journal a checked payment writes (B26):
 *
 *   Dr Uang Muka Pembelian   per advance bill, its DPP part, naming the supplier
 *   Dr PPN Masukan           the advance bills' PPN parts
 *   Dr Beban Bank            biaya bank
 *      Cr Kas & Bank            what left the bank
 *      Cr Hutang PPh            per Jenis PPh the company withheld
 */
async function buildPosting(db: Db, c: Checked, partnerName: string): Promise<{ ok: true; description: string; lines: JournalLineInput[] } | { ok: false; message: string }> {
  const advances = c.lines.filter((l) => l.kind === "fin_ap_advance");
  const invoices = c.lines.filter((l) => l.kind === "fin_ap_invoice");
  type Key = "purchase_advance_account" | "input_vat_account" | "bank_charge_account" | "payable_account";
  const keys: Key[] = [
    ...(advances.length ? (["purchase_advance_account", "input_vat_account"] as const) : []),
    ...(invoices.length ? (["payable_account"] as const) : []),
    ...(c.data.bank_charge > 0 ? (["bank_charge_account"] as const) : []),
  ];
  const mapped = await postingAccounts<Key>(keys);
  const missing: string[] = mapped.ok ? [] : [...mapped.missing];
  const whtIds = [...new Set(c.lines.flatMap((l) => l.withholdings.map((w) => Number(w.key))))];
  const taxes = new Map((await db.refWithholdingTax.findMany({ where: { id: { in: whtIds } } })).map((t) => [t.id, t]));
  for (const id of whtIds) {
    const t = taxes.get(id);
    if (!t?.account_id || (await accountProblem(db, t.account_id))) missing.push(`Account Hutang PPh pada Jenis PPh ${t?.wht_label ?? id}`);
  }
  if (await accountProblem(db, c.cashBankAccountId)) missing.push("Account pada Kas & Bank yang dipilih");
  if (missing.length || !mapped.ok) {
    return { ok: false, message: `Belum bisa diposting — account belum diatur atau tidak dapat dipakai: ${missing.join("; ")}. Atur di Accounting › Pengaturan › Account Mapping atau pada master terkait.` };
  }
  const ids = mapped.ids as Partial<Record<Key, number>>;
  const accounts = new Map(
    (
      await db.accAccount.findMany({
        where: { id: { in: [c.cashBankAccountId, ids.purchase_advance_account, ids.input_vat_account, ids.bank_charge_account, ids.payable_account, ...[...taxes.values()].map((t) => t.account_id)].filter((x): x is number => Boolean(x)) } },
        select: { id: true, require_partner: true },
      })
    ).map((a) => [a.id, a])
  );
  const currency = await db.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  const line = (accountId: number, debit: number, credit: number, description: string, partnerId: number | null = null): JournalLineInput => ({
    accountId,
    partnerId: accounts.get(accountId)?.require_partner ? partnerId : null,
    currencyId: currency!.id,
    rate: 1,
    debit,
    credit,
    description,
  });
  const out: JournalLineInput[] = [];
  for (const l of advances) {
    if (l.dppPart > 0) out.push(line(ids.purchase_advance_account!, l.dppPart, 0, `Uang muka ${l.bill.no} (${l.bill.orderNo})`, c.data.partner_id));
  }
  const ppn = advances.reduce((a, l) => a + l.ppnPart, 0);
  if (ppn > 0) out.push(line(ids.input_vat_account!, ppn, 0, `PPN Masukan uang muka — ${advances.filter((l) => l.ppnPart > 0).map((l) => l.bill.no).join(", ")}`));
  for (const l of invoices) {
    out.push(line(ids.payable_account!, l.settled, 0, `Pelunasan ${l.bill.no}${l.settled < l.bill.open ? " (sebagian)" : ""} (${l.bill.orderNo})`, c.data.partner_id));
  }
  if (c.data.bank_charge > 0) out.push(line(ids.bank_charge_account!, c.data.bank_charge, 0, "Biaya transfer bank"));
  const ref = c.data.bank_ref ? ` · ref ${c.data.bank_ref}` : "";
  out.push(line(c.cashBankAccountId, 0, c.data.cash_amount, `Dana dibayar ke ${partnerName}${ref}`));
  const pphByType = new Map<number, number>();
  for (const l of c.lines) for (const w of l.withholdings) pphByType.set(Number(w.key), (pphByType.get(Number(w.key)) ?? 0) + w.amount);
  for (const [k, amount] of pphByType) {
    const t = taxes.get(k)!;
    if (amount > 0) out.push(line(t.account_id!, 0, amount, `${t.wht_label} dipotong atas ${partnerName}`, c.data.partner_id));
  }
  return { ok: true, description: `Pembayaran ${c.lines.map((l) => l.bill.no).join(", ")} — ${partnerName}`, lines: out };
}

export async function previewCashPaymentPosting(id: number, actorId: number): Promise<JournalPreviewResult> {
  try {
    const r = await transitionCashPayment(id, "post", actorId, undefined, { dryRun: true });
    if (!r.ok) return r;
    return { ok: true, lines: await describeJournalLines(r.journal ?? []) };
  } catch (e) {
    if (e instanceof Error) return { ok: false, errors: { _form: e.message } };
    throw e;
  }
}

export type CashPaymentTransitionResult = { ok: true; journal?: JournalLineInput[] } | { ok: false; errors: Record<string, string> };

/**
 * **Posting** re-checks the stored payment with every bill locked, writes the
 * journal and the Cash Bank Book (refusing an overdraw), restates the lines as
 * posted and creates an AP item Uang Muka per advance bill paid, at its DPP
 * part — in one transaction. **Batalkan** (Draft) asks for a reason.
 */
export async function transitionCashPayment(
  id: number,
  action: CashBankTxAction,
  actorId: number,
  reason?: string,
  options: { dryRun?: boolean } = {}
): Promise<CashPaymentTransitionResult> {
  const t = await prisma.finCashBankTx.findUnique({ where: { id }, include: { ...WITH_LINES, partner: true } });
  if (!t || t.direction !== "Out") return { ok: false, errors: { _form: "Pengeluaran tidak ditemukan." } };
  const step = CASH_PAYMENT_TRANSITIONS[action];
  if (!step.from.includes(t.status as CashBankTxStatus)) return { ok: false, errors: { _form: `Pengeluaran berstatus ini tidak dapat di-${step.label.toLowerCase()}.` } };

  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan pembatalan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      const done = await tx.finCashBankTx.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error("Pengeluaran berubah saat diproses. Muat ulang halaman.");
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const period = await checkTransactionDate(isoDay(t.tx_date));
  if (!period.ok) return { ok: false, errors: { _form: period.message } };
  const currency = await prisma.refCurrency.findFirst({ where: { currency_label: BASE_CURRENCY_LABEL }, select: { id: true } });
  if (!currency) return { ok: false, errors: { _form: "Mata uang dasar tidak ditemukan." } };

  return refusable(async () => {
    await prisma.$transaction(async (tx) => {
      const stored = asInput(t);
      await lockPurchaseAdvances(tx, stored.lines.filter((l) => l.doc_type === "fin_ap_advance").map((l) => Number(l.doc_id)));
      const invoiceIds = stored.lines.filter((l) => l.doc_type === "fin_ap_invoice").map((l) => Number(l.doc_id));
      if (invoiceIds.length) await lockPurchaseInvoices(tx, invoiceIds);
      if (invoiceIds.length) await lockApItems(tx, (await settlementPurchaseInvoices({ ids: invoiceIds }, tx)).flatMap((i) => (i.apItemId ? [i.apItemId] : [])));
      const r = await checkCashPayment(tx, stored);
      if (!r.ok) throw new Refused({ _form: `Belum bisa diposting: ${Object.values(r.errors)[0]}` });
      const posting = await buildPosting(tx, r.c, t.partner.partner_name);
      if (!posting.ok) throw new Refused({ _form: posting.message });
      const done = await tx.finCashBankTx.updateMany({
        where: { id, status: "Draft" },
        data: { status: "Posted", cash_amount: r.c.data.cash_amount, settled_amount: r.c.balance.settled, pph_amount: r.c.balance.pph, updated_by: actorId },
      });
      if (done.count !== 1) throw new Refused({ _form: "Pengeluaran berubah saat diproses. Muat ulang halaman." });

      const typeId = await docTypeId(tx, "fin_cash_bank_tx");
      const journal = await postJournal(tx, {
        description: `${t.tx_no} · ${posting.description}`,
        sourceDocTypeId: typeId,
        sourceDocId: id,
        postingDate: t.tx_date,
        actorId,
        lines: posting.lines,
      });
      await recordCashBankEntry(tx, {
        cashBankId: t.cash_bank_id,
        date: isoDay(t.tx_date),
        type: "Transaction",
        direction: "Out",
        amount: r.c.data.cash_amount,
        sourceDocTypeId: typeId,
        sourceDocId: id,
        note: `${t.tx_no} · ${posting.description}`,
        actorId,
      });
      await tx.finCashBankTx.update({ where: { id }, data: { journal_id: journal.id } });
      await tx.finCashBankTxLine.deleteMany({ where: { tx_id: id } });
      for (const line of await lineRows(tx, r.c.lines, actorId)) await tx.finCashBankTxLine.create({ data: { ...line, tx_id: id } });
      // Each document records what this payment settled of it (P132, P133):
      // the next payment reads that as its `before`, not this payment.
      for (const l of r.c.lines) {
        if (l.kind === "fin_ap_advance") await recordPurchaseAdvancePaid(tx, l.docId, l.settled);
        else await recordPurchaseInvoicePaid(tx, l.docId, l.settled);
      }
      // Each advance bill paid is an Uang Muka the company now holds with the
      // supplier, in the bill's one AP item (P133), at its DPP part.
      const advanceType = r.c.lines.some((l) => l.kind === "fin_ap_advance") ? await docTypeId(tx, "fin_ap_advance") : 0;
      for (const l of r.c.lines) {
        if (l.kind !== "fin_ap_advance" || !(l.dppPart > 0)) continue;
        await payAdvance(tx, {
          partnerId: t.partner_id,
          currencyId: currency.id,
          date: isoDay(t.tx_date),
          source: { docTypeId: advanceType, docId: l.docId, no: l.bill.no },
          createdBy: { docTypeId: typeId, docId: id, no: t.tx_no },
          orderId: l.bill.orderId,
          amount: l.dppPart,
          note: `Uang muka ${l.bill.no} dibayar`,
          actorId,
        });
      }
      // Each Invoice paid lowers its AP item by all it settles (B27).
      for (const l of r.c.lines) {
        if (l.kind !== "fin_ap_invoice" || !l.bill.apItemId) continue;
        await settleApItem(tx, {
          itemId: l.bill.apItemId,
          event: "Payment",
          amount: l.settled,
          date: isoDay(t.tx_date),
          doc: { docTypeId: typeId, docId: id, no: t.tx_no },
          note: `Dibayar ${money(l.cash)}`,
          actorId,
        });
      }
      await audit(tx, id, "UPDATE", "post", actorId);
      if (options.dryRun) throw new PostingDryRun(posting.lines);
    });
    return { ok: true as const };
  });
}

// ------------------------------------------------------------------- reads

export type CashPaymentListRow = {
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

export async function listCashPayments(): Promise<CashPaymentListRow[]> {
  const rows = await prisma.finCashBankTx.findMany({
    where: { direction: "Out" },
    orderBy: [{ tx_date: "desc" }, { id: "desc" }],
    include: { partner: true, cash_bank: true, lines: { select: { doc_id: true, doc_type: { select: { doc_table: true } } } } },
  });
  const idsOf = (kind: PaidDocKind) => [...new Set(rows.flatMap((r) => r.lines.filter((l) => l.doc_type.doc_table === kind).map((l) => l.doc_id)))];
  const [advanceNos, invoiceNos] = await Promise.all([purchaseAdvanceNumbersByIds(idsOf("fin_ap_advance")), purchaseInvoiceNumbersByIds(idsOf("fin_ap_invoice"))]);
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
    docs: r.lines.map((l) => (l.doc_type.doc_table === "fin_ap_advance" ? advanceNos : invoiceNos).get(l.doc_id) ?? "?"),
  }));
}

export type CashPaymentView = {
  id: number;
  txNo: string;
  status: CashBankTxStatus;
  input: CashPaymentInput;
  partnerLabel: string;
  partnerName: string;
  cashBankLabel: string;
  cashBankName: string;
  cancelReason: string | null;
  journal: { id: number; journalNo: string } | null;
  lines: { kind: PaidDocKind; docId: number; settled: number; withhold: boolean; dppPart: number; ppnPart: number; pph: number; withholdings: { key: string; rate: number; base: number; amount: number }[] }[];
};

export async function getCashPayment(id: number): Promise<CashPaymentView | null> {
  const t = await prisma.finCashBankTx.findUnique({
    where: { id },
    include: {
      partner: true,
      cash_bank: true,
      journal: { select: { id: true, journal_no: true } },
      lines: { include: { whts: true, doc_type: { select: { doc_table: true } } }, orderBy: { line_no: "asc" } },
    },
  });
  if (!t || t.direction !== "Out") return null;
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
      kind: l.doc_type.doc_table as PaidDocKind,
      docId: l.doc_id,
      settled: l.settled_amount.toNumber(),
      withhold: l.withhold,
      dppPart: l.dpp_part.toNumber(),
      ppnPart: l.ppn_part.toNumber(),
      pph: l.pph_amount.toNumber(),
      withholdings: l.whts.map((w) => ({ key: String(w.withholding_tax_id), rate: w.rate.toNumber(), base: w.base_amount.toNumber(), amount: w.amount.toNumber() })),
    })),
  };
}
