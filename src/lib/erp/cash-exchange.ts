import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { InsufficientFunds, recordCashBankEntry } from "./cash-bank";
import { BASE_CURRENCY_LABEL, isBaseCurrency } from "./currency";
import { nextDocumentNumber } from "./document-number";
import { checkTransactionDate, holdPostingPeriod, PeriodShut } from "./fiscal";
import { roundBase } from "./fx";
import { PostingDryRun, describeJournalLines, postJournal, type JournalLineInput, type JournalPreviewResult } from "./journal";
import { PeriodLockRefusal } from "./period-lock";
import { postingAccounts } from "./system-settings";
import {
  CASH_EXCHANGE_KIND_TEXT,
  CASH_EXCHANGE_TRANSITIONS,
  cashExchangeIsEditable,
  cashExchangeKind,
  cashExchangeTransitionAllowed,
  type CashExchangeAction,
  type CashExchangeKind,
  type CashExchangeStatus,
} from "./cash-exchange-workflow";

/**
 * Penukaran Valas (Multi-Currency-Plan MC11a; `fin_cash_exchange`,
 * `PVL/YYYY/MM/NNNN`).
 *
 * Money moving between a rupiah Kas & Bank and a foreign one — the only way it
 * crosses currencies while bills settle within their own (MC11). Both amounts
 * are the bank's, typed. **Posting**, in one transaction: the source's Cash
 * Bank Book entry Out (a foreign source leaves at its moving average, P37), the
 * destination's In, and one journal — Dr destination / Cr source, each at its
 * own base. **Pembelian Valas** brings the rupiah paid into the foreign pool
 * exactly, so it has no difference (concept §5.3, create). **Pencairan Valas**
 * resolves two base values — what the pool released and the rupiah the bank
 * credited — and their difference is selisih kurs, the balancing figure
 * (concept §5.4), on Account Mapping's Account Selisih Kurs.
 *
 * Named only by this module.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type CashExchangeInput = {
  exchange_date: string;
  from_cash_bank_id: number | string | null;
  to_cash_bank_id: number | string | null;
  from_amount: number | string | null;
  to_amount: number | string | null;
  reference?: string | null;
  note?: string | null;
};

export type CashExchangeResult = { ok: true; id: number; exchangeNo: string } | { ok: false; errors: Record<string, string> };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string) => new Date(`${d}T00:00:00Z`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const cents = (n: number) => Math.round(n * 100);

// ---------------------------------------------------------------- options

export type CashExchangeResource = {
  id: number;
  label: string;
  name: string;
  active: boolean;
  currency: string;
  isBase: boolean;
  balance: number;
};

export type CashExchangeOptions = { resources: CashExchangeResource[] };

export async function cashExchangeOptions(): Promise<CashExchangeOptions> {
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

type Side = { id: number; label: string; accountId: number; currencyId: number; currency: string };

export type CheckedCashExchange = {
  kind: CashExchangeKind;
  from: Side;
  to: Side;
  data: {
    exchange_date: Date;
    from_cash_bank_id: number;
    to_cash_bank_id: number;
    from_amount: number;
    to_amount: number;
    reference: string | null;
    note: string | null;
  };
};

const money = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && cents(n) === n * 100 ? n : null;
};

/** Every rule a penukaran must satisfy to be saved — and, run again, to be posted. */
export async function checkCashExchange(
  db: Db,
  input: CashExchangeInput
): Promise<{ ok: true; c: CheckedCashExchange } | { ok: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  const date = String(input.exchange_date ?? "").trim();
  if (!DAY.test(date)) errors.exchange_date = "Tanggal wajib diisi.";

  const side = async (key: "from_cash_bank_id" | "to_cash_bank_id", what: string): Promise<Side | null> => {
    const id = Number(input[key]) || null;
    if (!id) {
      errors[key] = `Pilih Kas & Bank ${what}.`;
      return null;
    }
    const r = await db.mCashBank.findUnique({
      where: { id },
      select: { id: true, cash_bank_label: true, status: true, account_id: true, currency_id: true, currency: { select: { currency_label: true } } },
    });
    if (!r) errors[key] = "Kas & Bank tidak ditemukan.";
    else if (r.status !== "Active") errors[key] = `${r.cash_bank_label} sudah nonaktif.`;
    else return { id: r.id, label: r.cash_bank_label, accountId: r.account_id, currencyId: r.currency_id, currency: r.currency.currency_label };
    return null;
  };
  const from = await side("from_cash_bank_id", "asal");
  const to = await side("to_cash_bank_id", "tujuan");

  let kind: CashExchangeKind | null = null;
  if (from && to) {
    if (from.id === to.id) errors.to_cash_bank_id = "Kas & Bank tujuan harus berbeda dari asal.";
    else {
      kind = cashExchangeKind(isBaseCurrency(from.currency), isBaseCurrency(to.currency));
      if (!kind) {
        errors.to_cash_bank_id =
          from.currency === to.currency
            ? `Keduanya ${from.currency}: pemindahan dalam satu mata uang adalah Transfer, belum tersedia.`
            : `Penukaran selalu antara ${BASE_CURRENCY_LABEL} dan satu mata uang asing.`;
      }
    }
  }

  const fromAmount = money(input.from_amount);
  if (fromAmount === null) errors.from_amount = "Jumlah keluar harus lebih dari 0, paling banyak dua desimal.";
  const toAmount = money(input.to_amount);
  if (toAmount === null) errors.to_amount = "Jumlah masuk harus lebih dari 0, paling banyak dua desimal.";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    c: {
      kind: kind!,
      from: from!,
      to: to!,
      data: {
        exchange_date: asDate(date),
        from_cash_bank_id: from!.id,
        to_cash_bank_id: to!.id,
        from_amount: fromAmount!,
        to_amount: toAmount!,
        reference: String(input.reference ?? "").trim() || null,
        note: String(input.note ?? "").trim() || null,
      },
    },
  };
}

// ------------------------------------------------------------------ writes

async function nextExchangeNo(db: Db, date: Date): Promise<string> {
  return nextDocumentNumber("PVL", date, async (series) => {
    const row = await db.finCashExchange.findFirst({ where: { exchange_no: { startsWith: series } }, orderBy: { id: "desc" }, select: { exchange_no: true } });
    return row?.exchange_no ?? null;
  });
}

async function audit(db: Db, id: number, action: "TAMBAH" | "UPDATE", event: string, by: number) {
  await db.auditLog.create({ data: { entity_key: "fin_cash_exchange", row_id: id, action, event, by } });
}

async function docTypeId(db: Db): Promise<number> {
  const row = await db.sysDocType.findFirst({ where: { doc_table: "fin_cash_exchange" }, select: { id: true } });
  if (!row) throw new Error("Jenis dokumen Penukaran Valas belum terdaftar. Jalankan db:seed.");
  return row.id;
}

export async function createCashExchange(input: CashExchangeInput, actorId: number): Promise<CashExchangeResult> {
  const r = await checkCashExchange(prisma, input);
  if (!r.ok) return r;
  return prisma.$transaction(async (tx) => {
    const exchangeNo = await nextExchangeNo(tx, r.c.data.exchange_date);
    const row = await tx.finCashExchange.create({ data: { ...r.c.data, exchange_no: exchangeNo, created_by: actorId } });
    await audit(tx, row.id, "TAMBAH", "create", actorId);
    return { ok: true as const, id: row.id, exchangeNo };
  });
}

export async function updateCashExchange(id: number, input: CashExchangeInput, actorId: number): Promise<CashExchangeResult> {
  const current = await prisma.finCashExchange.findUnique({ where: { id }, select: { status: true, exchange_no: true } });
  if (!current) return { ok: false, errors: { _form: "Penukaran Valas tidak ditemukan." } };
  if (!cashExchangeIsEditable(current.status as CashExchangeStatus)) return { ok: false, errors: { _form: "Hanya Draft yang dapat diubah." } };
  const r = await checkCashExchange(prisma, input);
  if (!r.ok) return r;
  return prisma.$transaction(async (tx) => {
    const done = await tx.finCashExchange.updateMany({ where: { id, status: "Draft" }, data: { ...r.c.data, updated_by: actorId } });
    if (done.count !== 1) return { ok: false as const, errors: { _form: "Penukaran berubah saat disimpan. Muat ulang halaman." } };
    await audit(tx, id, "UPDATE", "update", actorId);
    return { ok: true as const, id, exchangeNo: current.exchange_no };
  });
}

class Refused extends Error {
  constructor(readonly errors: Record<string, string>) {
    super("refused");
  }
}

export type CashExchangeTransitionResult = { ok: true; journal?: JournalLineInput[] } | { ok: false; errors: Record<string, string> };

/**
 * Runs one lifecycle step. **Posting**, in one transaction: rechecks the
 * document, writes the source's entry Out and the destination's In, then the
 * journal with the selisih kurs as its balancing line, and stores the base of
 * each side. With `dryRun` it throws `PostingDryRun` after all of it, so the
 * confirmation shows exactly what Posting writes (P103). **Batalkan** (Draft)
 * asks for a reason.
 */
export async function transitionCashExchange(
  id: number,
  action: CashExchangeAction,
  actorId: number,
  reason?: string,
  options: { dryRun?: boolean } = {}
): Promise<CashExchangeTransitionResult> {
  const d = await prisma.finCashExchange.findUnique({ where: { id } });
  if (!d) return { ok: false, errors: { _form: "Penukaran Valas tidak ditemukan." } };
  const t = CASH_EXCHANGE_TRANSITIONS[action];
  if (!cashExchangeTransitionAllowed(action, d.status as CashExchangeStatus)) {
    return { ok: false, errors: { _form: `Penukaran berstatus ini tidak dapat di-${t.label.toLowerCase()}.` } };
  }
  const moved = "Penukaran berubah saat diproses. Muat ulang halaman.";
  if (action === "cancel") {
    const why = String(reason ?? "").trim();
    if (!why) return { ok: false, errors: { reason: "Alasan wajib diisi." } };
    await prisma.$transaction(async (tx) => {
      const done = await tx.finCashExchange.updateMany({ where: { id, status: "Draft" }, data: { status: "Cancelled", cancel_reason: why, updated_by: actorId } });
      if (done.count !== 1) throw new Error(moved);
      await audit(tx, id, "UPDATE", "cancel", actorId);
    });
    return { ok: true };
  }

  const date = isoDay(d.exchange_date);
  const period = await checkTransactionDate(date);
  if (!period.ok) return { ok: false, errors: { _form: period.message } };

  try {
    let journalLines: JournalLineInput[] = [];
    await prisma.$transaction(async (tx) => {
      await holdPostingPeriod(tx, date);
      const r = await checkCashExchange(tx, {
        exchange_date: date,
        from_cash_bank_id: d.from_cash_bank_id,
        to_cash_bank_id: d.to_cash_bank_id,
        from_amount: d.from_amount.toString(),
        to_amount: d.to_amount.toString(),
        reference: d.reference,
        note: d.note,
      });
      if (!r.ok) {
        const first = Object.entries(r.errors).find(([k]) => !k.startsWith("_"))?.[1] ?? Object.values(r.errors)[0];
        throw new Refused({ _form: `Belum bisa diposting: ${first}` });
      }
      const { kind, from, to, data } = r.c;
      const fx = kind === "Sell" ? await postingAccounts(["fx_account"] as const) : null;
      if (fx && !fx.ok) throw new Refused({ _form: `Lengkapi Account Mapping dulu: ${fx.missing.join(", ")}.` });

      const done = await tx.finCashExchange.updateMany({ where: { id, status: "Draft" }, data: { status: "Posted", updated_by: actorId } });
      if (done.count !== 1) throw new Refused({ _form: moved });

      const typeId = await docTypeId(tx);
      const source = { sourceDocTypeId: typeId, sourceDocId: id, type: "Transaction" as const, date, actorId };
      const note = `${d.exchange_no} · ${CASH_EXCHANGE_KIND_TEXT[kind]}`;

      // The source leaves at what its pool releases: rupiah at itself, a
      // foreign pool at its moving average (P37).
      const out = await recordCashBankEntry(tx, { ...source, cashBankId: from.id, direction: "Out", amount: data.from_amount, note });
      const fromBase = -out.base_movement.toNumber();
      // A purchase brings exactly the rupiah paid (concept §5.8); a sale brings
      // the rupiah the bank credited.
      const toBase = kind === "Buy" ? fromBase : data.to_amount;
      await recordCashBankEntry(tx, {
        ...source,
        cashBankId: to.id,
        direction: "In",
        amount: data.to_amount,
        rate: kind === "Buy" ? fromBase / data.to_amount : 1,
        base: toBase,
        note,
      });
      // The balancing figure (concept §5.4): positive is a gain, negative a loss.
      const diff = roundBase(toBase - fromBase);

      journalLines = [
        {
          accountId: to.accountId,
          currencyId: to.currencyId,
          rate: kind === "Buy" ? fromBase / data.to_amount : 1,
          debit: data.to_amount,
          credit: 0,
          baseAmount: toBase,
          description: `${note} — masuk ${to.label}`,
        },
        {
          accountId: from.accountId,
          currencyId: from.currencyId,
          rate: kind === "Sell" ? fromBase / data.from_amount : 1,
          debit: 0,
          credit: data.from_amount,
          baseAmount: fromBase,
          description: `${note} — keluar ${from.label}`,
        },
      ];
      if (diff !== 0 && fx?.ok) {
        journalLines.push({
          accountId: fx.ids.fx_account,
          currencyId: to.currencyId,
          rate: 1,
          debit: diff < 0 ? -diff : 0,
          credit: diff > 0 ? diff : 0,
          description: `${note} — selisih kurs ${diff > 0 ? "laba" : "rugi"}`,
        });
      }
      const journal = await postJournal(tx, {
        description: `${d.exchange_no} · ${CASH_EXCHANGE_KIND_TEXT[kind]} ${from.label} → ${to.label}`,
        sourceDocTypeId: typeId,
        sourceDocId: id,
        postingDate: data.exchange_date,
        actorId,
        lines: journalLines,
      });
      await tx.finCashExchange.update({ where: { id }, data: { from_base: fromBase, to_base: toBase, fx_difference: diff, journal_id: journal.id } });
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
export async function cashExchangePreview(id: number, actorId: number): Promise<JournalPreviewResult> {
  try {
    const r = await transitionCashExchange(id, "post", actorId, undefined, { dryRun: true });
    if (!r.ok) return r;
    return { ok: true, lines: await describeJournalLines(r.journal ?? []) };
  } catch (e) {
    if (e instanceof Error) return { ok: false, errors: { _form: e.message } };
    throw e;
  }
}

// ------------------------------------------------------------------- reads

type Resource = { label: string; name: string; currency: string };

export type CashExchangeView = {
  id: number;
  exchangeNo: string;
  exchangeDate: string;
  status: CashExchangeStatus;
  kind: CashExchangeKind | null;
  fromId: number;
  toId: number;
  from: Resource;
  to: Resource;
  fromAmount: number;
  toAmount: number;
  reference: string | null;
  note: string | null;
  fromBase: number | null;
  toBase: number | null;
  fxDifference: number;
  journalId: number | null;
  journalNo: string | null;
  cancelReason: string | null;
};

const RESOURCE = { select: { cash_bank_label: true, cash_bank_name: true, currency: { select: { currency_label: true } } } } as const;
type ResourceRow = { cash_bank_label: string; cash_bank_name: string; currency: { currency_label: string } };
const resource = (r: ResourceRow): Resource => ({ label: r.cash_bank_label, name: r.cash_bank_name, currency: r.currency.currency_label });

function view(d: Prisma.FinCashExchangeGetPayload<{ include: { from_cash_bank: typeof RESOURCE; to_cash_bank: typeof RESOURCE; journal: { select: { journal_no: true } } } }>): CashExchangeView {
  const from = resource(d.from_cash_bank);
  const to = resource(d.to_cash_bank);
  return {
    id: d.id,
    exchangeNo: d.exchange_no,
    exchangeDate: isoDay(d.exchange_date),
    status: d.status as CashExchangeStatus,
    kind: cashExchangeKind(isBaseCurrency(from.currency), isBaseCurrency(to.currency)),
    fromId: d.from_cash_bank_id,
    toId: d.to_cash_bank_id,
    from,
    to,
    fromAmount: d.from_amount.toNumber(),
    toAmount: d.to_amount.toNumber(),
    reference: d.reference,
    note: d.note,
    fromBase: d.from_base?.toNumber() ?? null,
    toBase: d.to_base?.toNumber() ?? null,
    fxDifference: d.fx_difference.toNumber(),
    journalId: d.journal_id,
    journalNo: d.journal?.journal_no ?? null,
    cancelReason: d.cancel_reason,
  };
}

const INCLUDE = { from_cash_bank: RESOURCE, to_cash_bank: RESOURCE, journal: { select: { journal_no: true } } } as const;

export async function listCashExchanges(): Promise<CashExchangeView[]> {
  const rows = await prisma.finCashExchange.findMany({ include: INCLUDE, orderBy: [{ exchange_date: "desc" }, { id: "desc" }] });
  return rows.map(view);
}

export async function getCashExchange(id: number): Promise<CashExchangeView | null> {
  const d = await prisma.finCashExchange.findUnique({ where: { id }, include: INCLUDE });
  return d ? view(d) : null;
}

export async function cashExchangeNumbersByIds(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await prisma.finCashExchange.findMany({ where: { id: { in: ids } }, select: { id: true, exchange_no: true } });
  return new Map(rows.map((r) => [r.id, r.exchange_no]));
}
