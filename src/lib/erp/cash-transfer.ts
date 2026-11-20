import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { InsufficientFunds, recordCashBankEntry } from "./cash-bank";
import { isBaseCurrency } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { checkTransactionDate, holdPostingPeriod, PeriodShut } from "./fiscal";
import { roundBase } from "./fx";
import { PostingDryRun, describeJournalLines, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { PeriodLockRefusal } from "./period-lock";
import { postingAccounts } from "./system-settings";
import {
  CASH_TRANSFER_PURPOSE_TEXT,
  CASH_TRANSFER_TRANSITIONS,
  cashTransferIsEditable,
  cashTransferTransitionAllowed,
  crossesCurrency,
  transferDestinationRefusal,
  transferLineAmounts,
  transferSourceRefusal,
  type CashTransferAction,
  type CashTransferPurpose,
  type CashTransferStatus,
} from "./cash-transfer-workflow";

/**
 * Transfer Kas & Bank (P299, Cash-Bank-Transfer-Plan.md; `fin_cash_bank_transfer`,
 * `TRF/YYYY/MM/NNNN`). SIBA's Cash Bank Transfer menu on ERP's multi-currency
 * concept: no rate layers — a foreign source leaves at its moving average (P37).
 *
 * **Posting**, one transaction, **per line**: the source's Cash Bank Book entry
 * Out for the line, then the destination's In. A Transfer and a Pembelian Valas
 * bring exactly the base that left (concept §5.8, §5.3), so they never differ;
 * a Pencairan brings round(amount × kurs) rupiah, and its difference to what
 * the pool released is selisih kurs (§5.4), on Account Mapping's Account Selisih
 * Kurs. One journal: Cr source, Dr each destination, the difference balancing.
 *
 * Named only by this module.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type CashTransferLineInput = {
  to_cash_bank_id: number | string | null;
  amount: number | string | null;
  exchange_rate?: number | string | null;
};

export type CashTransferInput = {
  transfer_date: string;
  purpose: CashTransferPurpose | string | null;
  from_cash_bank_id: number | string | null;
  reference?: string | null;
  note?: string | null;
  lines: CashTransferLineInput[];
};

export type CashTransferResult = { ok: true; id: number; transferNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const PURPOSES: CashTransferPurpose[] = ["Transfer", "Pencairan", "PembelianValas"];

// ---------------------------------------------------------------- options

export type CashTransferResource = {
  id: number;
  label: string;
  name: string;
  active: boolean;
  currency: string;
  isBase: boolean;
  balance: number;
};

export type CashTransferOptions = { resources: CashTransferResource[] };

export async function cashTransferOptions(): Promise<CashTransferOptions> {
  const rows = await prisma.mCashBank.findMany({
    select: {
      id: true,
      cash_bank_label: true,
      cash_bank_name: true,
      status: true,
      currency: { select: { currency_label: true } },
      book_balance: { select: { balance: true } },
    },
    orderBy: { cash_bank_label: "asc" },
  });
  return {
    resources: rows.map((r) => ({
      id: r.id,
      label: r.cash_bank_label,
      name: r.cash_bank_name,
      active: r.status === "Active",
      currency: r.currency.currency_label,
      isBase: isBaseCurrency(r.currency.currency_label),
      balance: r.book_balance?.balance.toNumber() ?? 0,
    })),
  };
}

// ------------------------------------------------------------- validation

type Side = { id: number; label: string; accountId: number; currencyId: number; currency: string; isBase: boolean };

export type CheckedCashTransfer = {
  purpose: CashTransferPurpose;
  from: Side;
  currencyId: number;
  lines: { to: Side; amount: number; rate: number; outAmount: number; inAmount: number }[];
  data: {
    transfer_date: Date;
    purpose: CashTransferPurpose;
    from_cash_bank_id: number;
    currency_id: number;
    transfer_amount: number;
    from_amount: number;
    reference: string | null;
    note: string | null;
  };
};

const money = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && Math.round(n * 100) === n * 100 ? n : null;
};
const kurs = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && Math.abs(Math.round(n * 1e6) - n * 1e6) < 1e-6 ? n : null;
};

async function side(db: Db, id: number): Promise<Side | string> {
  const r = await db.mCashBank.findUnique({
    where: { id },
    select: { id: true, cash_bank_label: true, status: true, account_id: true, currency_id: true, currency: { select: { currency_label: true } } },
  });
  if (!r) return "Kas & Bank tidak ditemukan.";
  if (r.status !== "Active") return `${r.cash_bank_label} sudah nonaktif.`;
  const currency = r.currency.currency_label;
  return { id: r.id, label: r.cash_bank_label, accountId: r.account_id, currencyId: r.currency_id, currency, isBase: isBaseCurrency(currency) };
}

/**
 * Every rule a transfer must satisfy to be saved — and, run again, to be
 * posted. Line errors are keyed `lines.<i>.<field>`.
 */
export async function checkCashTransfer(
  db: Db,
  input: CashTransferInput
): Promise<{ ok: true; c: CheckedCashTransfer } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const date = String(input.transfer_date ?? "").trim();
  if (!DAY.test(date)) errors.transfer_date = "Tanggal wajib diisi.";
  const purpose = PURPOSES.includes(input.purpose as CashTransferPurpose) ? (input.purpose as CashTransferPurpose) : null;
  if (!purpose) errors.purpose = "Pilih tujuan transfer.";

  let from: Side | null = null;
  const fromId = Number(input.from_cash_bank_id) || null;
  if (!fromId) errors.from_cash_bank_id = "Pilih Kas & Bank asal.";
  else {
    const s = await side(db, fromId);
    if (typeof s === "string") errors.from_cash_bank_id = s;
    else from = s;
  }
  if (from && purpose) {
    const why = transferSourceRefusal(purpose, from.isBase, from.currency);
    if (why) errors.from_cash_bank_id = why;
  }

  const lines: CheckedCashTransfer["lines"] = [];
  const seen = new Set<number>();
  let docCurrency: { id: number; label: string } | null = from && purpose !== "PembelianValas" ? { id: from.currencyId, label: from.currency } : null;
  if (!input.lines?.length) errors.lines = "Tambahkan minimal satu Kas & Bank tujuan.";
  for (const [i, l] of (input.lines ?? []).entries()) {
    const key = (f: string) => `lines.${i}.${f}`;
    const toId = Number(l.to_cash_bank_id) || null;
    let to: Side | null = null;
    if (!toId) errors[key("to_cash_bank_id")] = "Pilih Kas & Bank tujuan.";
    else if (toId === fromId) errors[key("to_cash_bank_id")] = "Tujuan harus berbeda dari Kas & Bank asal.";
    else if (seen.has(toId)) errors[key("to_cash_bank_id")] = "Kas & Bank ini sudah menjadi tujuan di baris lain.";
    else {
      seen.add(toId);
      const s = await side(db, toId);
      if (typeof s === "string") errors[key("to_cash_bank_id")] = s;
      else to = s;
    }
    if (to && purpose) {
      // A purchase is denominated in the currency it buys: the first destination's.
      if (!docCurrency && purpose === "PembelianValas" && !to.isBase) docCurrency = { id: to.currencyId, label: to.currency };
      const why = transferDestinationRefusal(purpose, docCurrency?.label ?? to.currency, to.currency, to.isBase);
      if (why) errors[key("to_cash_bank_id")] = why;
    }
    const amount = money(l.amount);
    if (amount === null) errors[key("amount")] = "Jumlah harus lebih dari 0, paling banyak dua desimal.";
    const rate = purpose && crossesCurrency(purpose) ? kurs(l.exchange_rate) : 1;
    if (rate === null) errors[key("exchange_rate")] = "Kurs harus lebih dari 0, paling banyak enam desimal.";
    if (to && amount !== null && rate !== null && purpose) {
      lines.push({ to, amount, rate, ...transferLineAmounts(purpose, amount, rate) });
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  const sum = (f: (l: (typeof lines)[number]) => number) => roundBase(lines.reduce((s, l) => s + f(l), 0));
  return {
    ok: true,
    c: {
      purpose: purpose!,
      from: from!,
      currencyId: docCurrency!.id,
      lines,
      data: {
        transfer_date: asDate(date),
        purpose: purpose!,
        from_cash_bank_id: from!.id,
        currency_id: docCurrency!.id,
        transfer_amount: sum((l) => l.amount),
        from_amount: sum((l) => l.outAmount),
        reference: String(input.reference ?? "").trim() || null,
        note: String(input.note ?? "").trim() || null,
      },
    },
  };
}

// ------------------------------------------------------------------ writes

async function nextTransferNo(db: Db, date: Date): Promise<string> {
  return nextDocumentNumber("TRF", date, async (series) => {
    const row = await db.finCashBankTransfer.findFirst({ where: { transfer_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { transfer_no: true } });
    return row?.transfer_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "fin_cash_bank_transfer", row_id: id, action, event, by } });
}

async function docTypeId(db: Db): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: "fin_cash_bank_transfer" }, select: { id: true } });
  if (!row) throw new Error("Jenis dokumen Transfer Kas & Bank belum terdaftar. Jalankan db:seed.");
  return row.id;
}

const lineRows = (c: CheckedCashTransfer) =>
  c.lines.map((l, i) => ({
    line_no: i + 1,
    to_cash_bank_id: l.to.id,
    amount: l.amount,
    exchange_rate: l.rate,
    out_amount: l.outAmount,
    in_amount: l.inAmount,
  }));

export async function createCashTransfer(input: CashTransferInput, actorId: number): Promise<CashTransferResult> {
  const r = await checkCashTransfer(prisma, input);
  if (!r.ok) return r;
  return prisma.$transaction(async (tx) => {
    const transferNo = await nextTransferNo(tx, r.c.data.transfer_date);
    const row = await tx.finCashBankTransfer.create({
      data: { ...r.c.data, transfer_no: transferNo, created_by: actorId, lines: { create: lineRows(r.c) } },
    });
    await audit(tx, row.id, "TAMBAH", "create", actorId);
    return { ok: true as const, id: row.id, transferNo };
  });
}

export async function updateCashTransfer(id: number, input: CashTransferInput, actorId: number): Promise<CashTransferResult> {
  const current = await prisma.finCashBankTransfer.findUnique({ where: { id }, select: { status: true, transfer_no: true } });
  if (!current) return { ok: false, errors: { _form: "Transfer tidak ditemukan." } };
  if (!cashTransferIsEditable(current.status as CashTransferStatus)) return { ok: false, errors: { _form: "Hanya Draft yang dapat diubah." } };
  const r = await checkCashTransfer(prisma, input);
  if (!r.ok) return r;
  return prisma.$transaction(async (tx) => {
    const done = await tx.finCashBankTransfer.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
    if (done.count !== 1) return { ok: false as const, errors: { _form: "Transfer berubah saat disimpan. Muat ulang halaman." } };
    await tx.finCashBankTransferLine.deleteMany({ where: { transfer_id: id } });
    await tx.finCashBankTransferLine.createMany({ data: lineRows(r.c).map((l) => ({ ...l, transfer_id: id })) });
    await audit(tx, id, "UPDATE", "update", actorId);
    return { ok: true as const, id, transferNo: current.transfer_no };
  });
}

class Refused extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("refused");
  }
}

export type CashTransferTransitionResult = { ok: true; journal?: JournalLineInput[] } | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle step. **Posting** rechecks the document, moves each line
 * through both Cash Bank Books, writes the journal and stores each line's
 * bases; with `dryRun` it throws `PostingDryRun` after all of it (P103).
 * **Batalkan** (Draft) asks for a reason.
 */
export async function transitionCashTransfer(
  id: number,
  action: CashTransferAction,
  actorId: number,
  reason?: string,
  options: { dryRun?: boolean } = {}
): Promise<CashTransferTransitionResult> {
  const d = await prisma.finCashBankTransfer.findUnique({ where: { id }, include: { lines: { orderBy: { line_no: "asc" } } } });
  if (!d) return { ok: false, errors: { _form: "Transfer tidak ditemukan." } };
  const t = CASH_TRANSFER_TRANSITIONS[action];
  if (!cashTransferTransitionAllowed(action, d.status as CashTransferStatus)) {
    return { ok: false, errors: { _form: `Transfer berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  const moved = "Transfer berubah saat diproses. Muat ulang halaman.";
  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      const done = await tx.finCashBankTransfer.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const date = isoDay(d.transfer_date);
  const period = await checkTransactionDate(date);
  if (!period.ok) return { ok: false, errors: { _form: period.message } };

  try {
    let journalLines: JournalLineInput[] = [];
    await prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, date);
      const r = await checkCashTransfer(tx, {
        transfer_date: date,
        purpose: d.purpose,
        from_cash_bank_id: d.from_cash_bank_id,
        reference: d.reference,
        note: d.note,
        lines: d.lines.map((l) => ({ to_cash_bank_id: l.to_cash_bank_id, amount: l.amount.toString(), exchange_rate: l.exchange_rate.toString() })),
      });
      if (!r.ok) {
        const first = Object.entries(r.errors).find(([k]) => !k.startsWith("_"))?.[1] ?? Object.values(r.errors)[0];
        throw new Refused({ _form: `Belum bisa diposting: ${first}` });
      }
      const { purpose, from, lines } = r.c;
      const fx = purpose === "Pencairan" ? await postingAccounts(["fx_account"] as const) : null;
      if (fx && !fx.ok) throw new Refused({ _form: `Lengkapi Account Mapping dulu: ${fx.missing.join(", ")}.` });

      const done = await tx.finCashBankTransfer.updateMany({ where: { id, status: "Draft" }, data: { status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });

      const typeId = await docTypeId(tx);
      const source = { sourceDocTypeId: typeId, sourceDocId: id, type: "Transaction" as const, date, actorId };
      const label = CASH_TRANSFER_PURPOSE_TEXT[purpose];
      let fromBase = 0;
      let totalDiff = 0;
      const destLines: JournalLineInput[] = [];

      for (const [i, l] of lines.entries()) {
        const note = `${d.transfer_no} · ${label} → ${l.to.label}`;
        // Drawn per line, so no base is shared out between lines (TB5): rupiah
        // leaves at itself, a foreign pool at its moving average (P37).
        const out = await recordCashBankEntry(tx, { ...source, cashBankId: from.id, direction: "Out", amount: l.outAmount, note });
        const outBase = -out.base_movement.toNumber();
        // A Transfer or a purchase brings exactly the base that left (§5.8,
        // §5.3); a sale brings the rupiah the kurs gives.
        const inBase = purpose === "Pencairan" ? l.inAmount : outBase;
        const inRate = l.to.isBase ? 1 : inBase / l.inAmount;
        await recordCashBankEntry(tx, { ...source, cashBankId: l.to.id, direction: "In", amount: l.inAmount, rate: inRate, base: inBase, note });
        const diff = roundBase(inBase - outBase);
        fromBase = roundBase(fromBase + outBase);
        totalDiff = roundBase(totalDiff + diff);
        await tx.finCashBankTransferLine.update({
          where: { id: d.lines[i].id },
          data: { out_base: outBase, in_base: inBase, fx_difference: diff },
        });
        destLines.push({
          accountId: l.to.accountId,
          currencyId: l.to.currencyId,
          rate: inRate,
          debit: l.inAmount,
          credit: 0,
          baseAmount: inBase,
          description: `${d.transfer_no} · ${label} — masuk ${l.to.label}`,
        });
      }

      const fromAmount = r.c.data.from_amount;
      journalLines = [
        ...destLines,
        {
          accountId: from.accountId,
          currencyId: from.currencyId,
          rate: from.isBase ? 1 : fromBase / fromAmount,
          debit: 0,
          credit: fromAmount,
          baseAmount: fromBase,
          description: `${d.transfer_no} · ${label} — keluar ${from.label}`,
        },
      ];
      // The balancing figure (concept §5.4): positive is a gain, negative a loss.
      if (totalDiff !== 0 && fx?.ok) {
        journalLines.push({
          accountId: fx.ids.fx_account,
          currencyId: lines[0].to.currencyId,
          rate: 1,
          debit: totalDiff < 0 ? -totalDiff : 0,
          credit: totalDiff > 0 ? totalDiff : 0,
          description: `${d.transfer_no} · selisih kurs ${totalDiff > 0 ? "laba" : "rugi"}`,
        });
      }
      const journal = await postJournal(tx, {
        description: `${d.transfer_no} · ${label} dari ${from.label}`,
        sourceDocTypeId: typeId,
        sourceDocId: id,
        postingDate: r.c.data.transfer_date,
        actorId,
        lines: journalLines,
      });
      await tx.finCashBankTransfer.update({ where: { id }, data: { from_base: fromBase, fx_difference: totalDiff, journal_id: journal.id } });
      await audit(tx, id, "UPDATE", "post", actorId);
      if (options.dryRun) throw new PostingDryRun(journalLines);
    });
    return { ok: true, journal: journalLines };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, errors: e.errors };
    if (e instanceof InsufficientFunds) return { ok: false, errors: { _form: `Belum bisa diposting: ${e.message}` } };
    if (e instanceof PeriodShut || e instanceof PeriodLockRefusal) return { ok: false, errors: { _form: e.message } };
    if (e instanceof PostingDryRun) return { ok: true, journal: e.lines };
    throw e;
  }
}

/** The journal Posting would write, for the confirmation dialog (P103). */
export async function cashTransferPreview(id: number, actorId: number): Promise<JournalPreviewResult> {
  try {
    const r = await transitionCashTransfer(id, "post", actorId, undefined, { dryRun: true });
    if (!r.ok) return r;
    return { ok: true, lines: await describeJournalLines(r.journal ?? []) };
  } catch (e) {
    if (e instanceof Error) return { ok: false, errors: { _form: e.message } };
    throw e;
  }
}

// ------------------------------------------------------------------- reads

type Resource = { id: number; label: string; name: string; currency: string };

export type CashTransferLineView = {
  toId: number;
  to: Resource;
  amount: number;
  rate: number;
  outAmount: number;
  inAmount: number;
  outBase: number | null;
  inBase: number | null;
  fxDifference: number;
};

export type CashTransferView = {
  id: number;
  transferNo: string;
  transferDate: string;
  status: CashTransferStatus;
  purpose: CashTransferPurpose;
  fromId: number;
  from: Resource;
  currency: string;
  transferAmount: number;
  fromAmount: number;
  reference: string | null;
  note: string | null;
  fromBase: number | null;
  fxDifference: number;
  journalId: number | null;
  journalNo: string | null;
  cancelReason: string | null;
  lines: CashTransferLineView[];
};

const RESOURCE = { select: { id: true, cash_bank_label: true, cash_bank_name: true, currency: { select: { currency_label: true } } } } as const;
type ResourceRow = { id: number; cash_bank_label: string; cash_bank_name: string; currency: { currency_label: string } };
const resource = (r: ResourceRow): Resource => ({ id: r.id, label: r.cash_bank_label, name: r.cash_bank_name, currency: r.currency.currency_label });

const INCLUDE = {
  from_cash_bank: RESOURCE,
  currency: { select: { currency_label: true } },
  journal: { select: { journal_no: true } },
  lines: { orderBy: { line_no: "asc" }, include: { to_cash_bank: RESOURCE } },
} as const;

function view(d: Prisma.FinCashBankTransferGetPayload<{ include: typeof INCLUDE }>): CashTransferView {
  const n = (v: { toNumber(): number } | null) => v?.toNumber() ?? null;
  return {
    id: d.id,
    transferNo: d.transfer_no,
    transferDate: isoDay(d.transfer_date),
    status: d.status as CashTransferStatus,
    purpose: d.purpose as CashTransferPurpose,
    fromId: d.from_cash_bank_id,
    from: resource(d.from_cash_bank),
    currency: d.currency.currency_label,
    transferAmount: d.transfer_amount.toNumber(),
    fromAmount: d.from_amount.toNumber(),
    reference: d.reference,
    note: d.note,
    fromBase: n(d.from_base),
    fxDifference: d.fx_difference.toNumber(),
    journalId: d.journal_id,
    journalNo: d.journal?.journal_no ?? null,
    cancelReason: d.cancel_reason,
    lines: d.lines.map((l) => ({
      toId: l.to_cash_bank_id,
      to: resource(l.to_cash_bank),
      amount: l.amount.toNumber(),
      rate: l.exchange_rate.toNumber(),
      outAmount: l.out_amount.toNumber(),
      inAmount: l.in_amount.toNumber(),
      outBase: n(l.out_base),
      inBase: n(l.in_base),
      fxDifference: l.fx_difference.toNumber(),
    })),
  };
}

export async function listCashTransfers(): Promise<CashTransferView[]> {
  const rows = await prisma.finCashBankTransfer.findMany({ include: INCLUDE, orderBy: [{ transfer_date: "desc" }, { id: "desc" }] });
  return rows.map(view);
}

export async function getCashTransfer(id: number): Promise<CashTransferView | null> {
  const d = await prisma.finCashBankTransfer.findUnique({ where: { id }, include: INCLUDE });
  return d ? view(d) : null;
}

export async function cashTransferNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.finCashBankTransfer.findMany({ where: { id: { in: ids } }, select: { id: true, transfer_no: true } });
  return new Map(rows.map((r) => [r.id, r.transfer_no]));
}
