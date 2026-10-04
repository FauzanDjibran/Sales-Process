import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { nextDocumentNumber } from "./document-number";
import { formatNumber } from "@/lib/format";
import { relieve, roundBase } from "./fx";
import type { PeriodRange } from "./period";

/**
 * The Cash Bank Book — the authoritative record of what is in each cash and
 * bank resource.
 *
 * `cash_bank_ledger` is append-only: an entry is never edited and never
 * deleted, because a book that can be rewritten is not evidence of anything. A
 * mistake is corrected by a further entry. `cash_bank_balance` is the running
 * total, written in the same database transaction as the entry that moved it,
 * so a balance read costs one row rather than a scan — and can always be
 * recomputed from the ledger by `rebuildCashBankBalance`.
 *
 * The book is independent by design: it is never a view over journal lines.
 * When the posting engine arrives it calls `recordCashBankEntry` alongside the
 * journal, rather than deriving one from the other.
 */

/** A Prisma client or an interactive transaction — every write here takes one. */
type Db = Prisma.TransactionClient | typeof prisma;

export type CashBankEntryType = "Opening" | "Transaction" | "Adjustment";

type EntryCommon = {
  cashBankId: number;
  /** `YYYY-MM-DD`. */
  date: string;
  type: CashBankEntryType;
  /** Positive; `direction` carries the sign. */
  amount: number;
  sourceDocTypeId?: number | null;
  sourceDocId?: number | null;
  note?: string | null;
  actorId: number;
};

/**
 * One movement for the book.
 *
 * **Money arriving** states the kurs it was received at, converting the
 * resource's own currency to base. Required, and deliberately so: there is no
 * sensible default. `1` is correct only when the resource holds base currency,
 * and defaulting to it for a foreign resource would silently record that a
 * dollar is a rupiah.
 *
 * **Money leaving** takes no kurs at all. It is valued at the resource's
 * moving average — `base_balance ÷ balance` at the moment it is posted
 * (Claude-ERP.md P37) — so a caller cannot state one, and the type says so.
 */
export type NewEntry =
  | (EntryCommon & { direction: "In"; rate: number })
  | (EntryCommon & { direction: "Out"; rate?: never });

const asDate = (d: string) => new Date(`${d}T00:00:00Z`);

/**
 * A movement refused because the resource does not hold enough to make it.
 *
 * Thrown rather than returned, like `JournalImbalance`: every caller is inside
 * the posting transaction, and an overdrawn resource has to take the whole
 * posting down rather than be reported and skipped.
 */
export class InsufficientFunds extends Error {
  constructor(
    readonly cashBankId: number,
    readonly balance: number,
    readonly requested: number
  ) {
    super(
      `Saldo Cash & Bank tidak mencukupi: tersedia ${formatNumber(balance)}, dibutuhkan ${formatNumber(requested)}. ` +
        "Transaksi dibatalkan."
    );
    this.name = "InsufficientFunds";
  }
}

/**
 * Next book entry number, `CBL/2026/09/0001`, in the series of the entry's own
 * month. The format lives in `document-number.ts`.
 */
async function nextEntryNo(db: Db, date: string): Promise<string> {
  return nextDocumentNumber("CBL", date, async (series) => {
    const row = await db.cashBankLedger.findFirst({
      where: { entry_no: { startsWith: series } },
      orderBy: { id: "desc" },
      select: { entry_no: true },
    });
    return row?.entry_no ?? null;
  });
}

/**
 * The moving average a resource is carried at, to the six decimals the `rate`
 * column holds. Recorded on an outgoing entry so the row says what it was
 * valued at; never multiplied by — the base released comes from `relieve`,
 * which computes it in one expression.
 */
function averageRate(balance: number, baseBalance: number): number {
  return Math.round((baseBalance / balance) * 1_000_000) / 1_000_000;
}

/**
 * Appends one entry and moves the balance with it.
 *
 * Both writes happen inside the caller's transaction, so the book and its total
 * can never disagree: either the entry and the new balance are both there, or
 * neither is.
 */
export async function recordCashBankEntry(db: Db, entry: NewEntry) {
  if (!(entry.amount > 0)) {
    throw new Error(
      `Nominal entri Cash Bank Book harus lebih besar dari nol (diterima ${entry.amount}).`
    );
  }
  if (entry.direction === "In" && !(entry.rate > 0)) {
    throw new Error(
      `Kurs entri Cash Bank Book harus lebih besar dari nol (diterima ${entry.rate}).`
    );
  }
  if (entry.direction === "Out" && entry.rate !== undefined) {
    throw new Error(
      "Pengeluaran Cash Bank Book tidak menerima kurs — nilainya selalu kurs " +
        "rata-rata resource saat diposting."
    );
  }

  const amount = entry.amount;

  const current = await db.cashBankBalance.findUnique({
    where: { cash_bank_id: entry.cashBankId },
    select: { balance: true, base_balance: true, entry_count: true },
  });
  const before = current ? current.balance.toNumber() : 0;
  const beforeBase = current ? current.base_balance.toNumber() : 0;

  // A resource cannot hold less than nothing, in any currency.
  if (entry.direction === "Out" && amount > before) {
    throw new InsufficientFunds(entry.cashBankId, before, amount);
  }

  // Money arriving joins the pool at its own kurs. Money leaving is released
  // at the pool's moving average as it stands *now* — the balance row is the
  // current position, whatever date the entry carries, so a backdated payment
  // is valued at today's average (Claude-ERP.md P37). `relieve` hands back the
  // remaining base exactly when the resource is emptied, so a pool never ends
  // holding zero currency against a leftover rupiah.
  let base: number;
  let rate: number;
  if (entry.direction === "In") {
    rate = entry.rate;
    base = roundBase(amount * rate);
  } else {
    base = relieve({ foreign: before, base: beforeBase }, amount).base;
    rate = averageRate(before, beforeBase);
  }

  const sign = entry.direction === "In" ? 1 : -1;
  const movement = sign * amount;
  const baseMovement = sign * base;
  const after = before + movement;
  const afterBase = roundBase(beforeBase + baseMovement);

  const created = await db.cashBankLedger.create({
    data: {
      entry_no: await nextEntryNo(db, entry.date),
      cash_bank_id: entry.cashBankId,
      entry_date: asDate(entry.date),
      entry_type: entry.type,
      direction: entry.direction,
      amount,
      movement,
      balance_after: after,
      rate,
      base_amount: base,
      base_movement: baseMovement,
      base_balance_after: afterBase,
      source_doc_type_id: entry.sourceDocTypeId ?? null,
      source_doc_id: entry.sourceDocId ?? null,
      note: entry.note ?? null,
      created_by: entry.actorId,
    },
  });

  await db.cashBankBalance.upsert({
    where: { cash_bank_id: entry.cashBankId },
    create: {
      cash_bank_id: entry.cashBankId,
      balance: after,
      base_balance: afterBase,
      entry_count: 1,
      last_entry_id: created.id,
      last_entry_date: created.entry_date,
    },
    update: {
      balance: after,
      base_balance: afterBase,
      entry_count: (current?.entry_count ?? 0) + 1,
      last_entry_id: created.id,
      last_entry_date: created.entry_date,
    },
  });

  return created;
}

/**
 * Opens the book for a newly registered resource.
 *
 * A resource always gets a balance row, even at zero, so every Cash & Bank has
 * a book from the moment it exists. A non-zero starting figure is written as an
 * `Opening` entry — it is a movement like any other, and appears in the book
 * rather than sitting in a column nobody can explain.
 */
export async function openCashBankBook(
  db: Db,
  options: {
    cashBankId: number;
    openingBalance: number;
    /**
     * The kurs the opening figure is valued at — the first rate of the
     * resource's moving average. `1` for a base-currency resource.
     */
    rate: number;
    date: string;
    actorId: number;
  }
) {
  // A resource cannot start out owing money. The figure used to accept a
  // negative and write it as an `Out`, which was the one way to reach exactly
  // the state `recordCashBankEntry` now refuses to create.
  if (options.openingBalance < 0) {
    throw new Error(
      "Saldo awal Cash & Bank tidak boleh negatif — sebuah resource tidak dapat " +
        "dibuka dengan saldo minus."
    );
  }

  if (!options.openingBalance) {
    await db.cashBankBalance.create({
      data: {
        cash_bank_id: options.cashBankId,
        balance: 0,
        base_balance: 0,
        entry_count: 0,
      },
    });
    return;
  }

  await recordCashBankEntry(db, {
    cashBankId: options.cashBankId,
    date: options.date,
    type: "Opening",
    direction: "In",
    amount: options.openingBalance,
    rate: options.rate,
    note: "Saldo awal saat resource didaftarkan.",
    actorId: options.actorId,
  });
}

/**
 * Recomputes one resource's balance from its entries.
 *
 * The materialised total is a convenience; the ledger is the truth. This is
 * what proves the two agree, and what repairs the total if anything ever writes
 * the balance row on its own.
 */
export async function rebuildCashBankBalance(
  cashBankId: number
): Promise<{ balance: number; baseBalance: number }> {
  const entries = await prisma.cashBankLedger.findMany({
    where: { cash_bank_id: cashBankId },
    orderBy: { id: "asc" },
    select: {
      id: true,
      movement: true,
      base_movement: true,
      entry_date: true,
    },
  });
  const balance = entries.reduce((t, e) => t + e.movement.toNumber(), 0);
  // Both measures rebuild the same way, from their own signed column. That is
  // what makes them equally checkable: neither is derived from the other, and
  // neither is derived from a rate applied after the fact.
  const baseBalance = roundBase(
    entries.reduce((t, e) => t + e.base_movement.toNumber(), 0)
  );
  const last = entries.at(-1) ?? null;

  const row = {
    balance,
    base_balance: baseBalance,
    entry_count: entries.length,
    last_entry_id: last?.id ?? null,
    last_entry_date: last?.entry_date ?? null,
  };

  await prisma.cashBankBalance.upsert({
    where: { cash_bank_id: cashBankId },
    create: { cash_bank_id: cashBankId, ...row },
    update: row,
  });
  return { balance, baseBalance };
}

// ------------------------------------------------------------------- reads

export type CashBankBalanceRow = {
  cashBankId: number;
  label: string;
  name: string;
  currencyId: number;
  currencyLabel: string;
  type: string;
  active: boolean;
  balance: number;
  /** The same balance in base currency. */
  baseBalance: number;
  entries: number;
  lastEntryDate: string | null;
};

export type CashBookSummary = {
  /** Active resources only — an inactive resource is not spendable capacity. */
  resources: number;
  byCurrency: {
    currencyId: number;
    currencyLabel: string;
    balance: number;
    baseBalance: number;
    resources: number;
  }[];
  rows: CashBankBalanceRow[];
  /**
   * Every currency added together, in base.
   *
   * This is the one figure that could not exist before: with no rate there was
   * nothing to add USD to IDR with, so a total spanning currencies had to be a
   * list. Now that every entry carries what it was worth when it moved, the
   * sum is a real historical figure rather than a conversion invented at read
   * time. `byCurrency` stays, because what a resource actually holds is still
   * the figure somebody spends.
   */
  totalBase: number;
};

/**
 * Every active resource's balance, grouped by currency.
 *
 * Balances are reported per currency and never summed across them: converting
 * would need an exchange rate, and there is no authoritative source for one
 * yet. A single fabricated total is worse than four honest ones.
 */
export async function cashBookSummary(): Promise<CashBookSummary> {
  const resources = await prisma.mCashBank.findMany({
    where: { status: "Active" },
    orderBy: { id: "asc" },
    select: {
      id: true,
      cash_bank_label: true,
      cash_bank_name: true,
      cash_bank_type: true,
      status: true,
      currency: { select: { id: true, currency_label: true } },
      book_balance: {
        select: {
          balance: true,
          base_balance: true,
          entry_count: true,
          last_entry_date: true,
        },
      },
    },
  });

  const rows: CashBankBalanceRow[] = resources.map((r) => ({
    cashBankId: r.id,
    label: r.cash_bank_label,
    name: r.cash_bank_name,
    currencyId: r.currency.id,
    currencyLabel: r.currency.currency_label,
    type: r.cash_bank_type,
    active: r.status === "Active",
    balance: r.book_balance?.balance.toNumber() ?? 0,
    baseBalance: r.book_balance?.base_balance.toNumber() ?? 0,
    entries: r.book_balance?.entry_count ?? 0,
    lastEntryDate: r.book_balance?.last_entry_date
      ? r.book_balance.last_entry_date.toISOString().slice(0, 10)
      : null,
  }));

  const byCurrency = new Map<number, CashBookSummary["byCurrency"][number]>();
  for (const r of rows) {
    const acc = byCurrency.get(r.currencyId) ?? {
      currencyId: r.currencyId,
      currencyLabel: r.currencyLabel,
      balance: 0,
      baseBalance: 0,
      resources: 0,
    };
    acc.balance += r.balance;
    acc.baseBalance += r.baseBalance;
    acc.resources += 1;
    byCurrency.set(r.currencyId, acc);
  }

  return {
    resources: rows.length,
    byCurrency: [...byCurrency.values()].sort((a, b) =>
      a.currencyLabel.localeCompare(b.currencyLabel)
    ),
    rows,
    totalBase: roundBase(rows.reduce((t, r) => t + r.baseBalance, 0)),
  };
}

/** Balance per resource id, for list columns. */
export async function cashBankBalanceMap(): Promise<Map<number, number>> {
  const rows = await prisma.cashBankBalance.findMany({
    select: { cash_bank_id: true, balance: true },
  });
  return new Map(rows.map((r) => [r.cash_bank_id, r.balance.toNumber()]));
}

// ------------------------------------------------------------------ reports
//
// The two Report Views over this book — `Buku Kas & Bank` (every movement of one
// resource in a period) and `Saldo Kas & Bank` (opening, in, out and closing for
// every resource). Both live here because this module owns the book: a balance
// is read through the Cash Bank Book or not at all (CLAUDE.md §9, §12).
//
// The property both must hold is `opening + in - out === closing`. Opening is
// therefore computed the same way `rebuildCashBankBalance` computes a balance —
// by summing `movement` over everything before the period — rather than by
// trusting a stored figure, so the report's own arithmetic is checkable.

/** An inclusive calendar range, `YYYY-MM-DD` at both ends. */
// `PeriodRange` now lives in `./period` — the General Ledger and both report
// routes need the shape and none of them should import the Cash Bank Book for
// it. Not re-exported here on purpose: a re-export would keep the old path
// working and the boundary would quietly stay crossed.

const startOf = (d: string) => new Date(`${d}T00:00:00Z`);

export type LedgerEntryRow = {
  id: number;
  entryNo: string;
  date: string;
  type: string;
  direction: string;
  amount: number;
  movement: number;
  /** The kurs this entry moved at — this book's own, not another book's. */
  rate: number;
  baseAmount: number;
  baseMovement: number;
  note: string | null;
  /** The document that caused the movement, for drill-through. Null for an opening. */
  sourceDocTable: string | null;
  sourceDocId: number | null;
  sourceDocNo: string | null;
};

export type LedgerReport = {
  resource: {
    id: number;
    label: string;
    name: string;
    type: string;
    active: boolean;
    currencyLabel: string;
  };
  range: PeriodRange;
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  /** The same four figures in base currency. Both measures reconcile. */
  baseOpening: number;
  baseTotalIn: number;
  baseTotalOut: number;
  baseClosing: number;
  /** By date, oldest first — a book reads forward through the period. */
  entries: LedgerEntryRow[];
  /**
   * False when the resource's whole book, summed, disagrees with its
   * materialised balance in `cash_bank_balance` — **on either measure**. A
   * book that reconciles in its own currency but not in base has had a rate
   * written that its entries do not support, which is exactly the failure the
   * second measure exists to catch. It is a statement about the book rather
   * than the period: once entries may be backdated there is no running
   * balance for a period-bound check to lean on.
   */
  reconciles: boolean;
};

/**
 * One resource's book over a period.
 *
 * Entries are ordered by date, oldest first, which is how a book is read.
 * **There is no running balance.** An entry may be dated before entries
 * already written — a backdated posting — so the `balance_after` stored on
 * each row is the balance at the moment of writing, not at the entry's date,
 * and printing it beside date-ordered rows would show figures no row above
 * produced. Opening and closing are derived from movements; the current
 * balance is `cash_bank_balance`'s, and `reconciles` checks the book against
 * it.
 *
 * Entries dated exactly `from` or exactly `to` are inside the period; anything
 * earlier is folded into the opening balance rather than listed.
 */
export async function cashBankLedgerReport(
  cashBankId: number,
  range: PeriodRange
): Promise<LedgerReport | null> {
  const resource = await prisma.mCashBank.findFirst({
    where: { id: cashBankId },
    select: {
      id: true,
      cash_bank_label: true,
      cash_bank_name: true,
      cash_bank_type: true,
      status: true,
      currency: { select: { currency_label: true } },
    },
  });
  if (!resource) return null;

  const [before, rows, wholeBook, stored] = await Promise.all([
    prisma.cashBankLedger.aggregate({
      where: { cash_bank_id: cashBankId, entry_date: { lt: startOf(range.from) } },
      _sum: { movement: true, base_movement: true },
    }),
    prisma.cashBankLedger.findMany({
      where: {
        cash_bank_id: cashBankId,
        entry_date: { gte: startOf(range.from), lte: startOf(range.to) },
      },
      // Date first: a backdated entry has a later id than the entries it
      // precedes, and a book is read in the order things happened.
      orderBy: [{ entry_date: "asc" }, { id: "asc" }],
      include: { source_doc_type: { select: { doc_table: true } } },
    }),
    prisma.cashBankLedger.aggregate({
      where: { cash_bank_id: cashBankId },
      _sum: { movement: true, base_movement: true },
    }),
    prisma.cashBankBalance.findUnique({
      where: { cash_bank_id: cashBankId },
      select: { balance: true, base_balance: true },
    }),
  ]);

  const opening = before._sum.movement?.toNumber() ?? 0;
  const baseOpening = roundBase(before._sum.base_movement?.toNumber() ?? 0);
  let totalIn = 0;
  let totalOut = 0;
  let baseTotalIn = 0;
  let baseTotalOut = 0;
  for (const r of rows) {
    if (r.direction === "In") {
      totalIn += r.amount.toNumber();
      baseTotalIn += r.base_amount.toNumber();
    } else {
      totalOut += r.amount.toNumber();
      baseTotalOut += r.base_amount.toNumber();
    }
  }
  const closing = opening + totalIn - totalOut;
  const baseClosing = roundBase(baseOpening + baseTotalIn - baseTotalOut);

  const docNumbers = await sourceDocumentNumbers(rows);

  const entries: LedgerEntryRow[] = rows.map((r) => ({
    id: r.id,
    entryNo: r.entry_no,
    date: r.entry_date.toISOString().slice(0, 10),
    type: r.entry_type,
    direction: r.direction,
    amount: r.amount.toNumber(),
    movement: r.movement.toNumber(),
    rate: r.rate.toNumber(),
    baseAmount: r.base_amount.toNumber(),
    baseMovement: r.base_movement.toNumber(),
    note: r.note,
    sourceDocTable: r.source_doc_type?.doc_table ?? null,
    sourceDocId: r.source_doc_id,
    sourceDocNo: r.source_doc_id ? docNumbers.get(r.source_doc_id) ?? null : null,
  }));

  const cents = (n: number) => Math.round(n * 100);
  const reconciles =
    !!stored &&
    cents(wholeBook._sum.movement?.toNumber() ?? 0) === cents(stored.balance.toNumber()) &&
    roundBase(wholeBook._sum.base_movement?.toNumber() ?? 0) ===
      stored.base_balance.toNumber();

  return {
    resource: {
      id: resource.id,
      label: resource.cash_bank_label,
      name: resource.cash_bank_name,
      type: resource.cash_bank_type,
      active: resource.status === "Active",
      currencyLabel: resource.currency.currency_label,
    },
    range,
    opening,
    totalIn,
    totalOut,
    closing,
    baseOpening,
    baseTotalIn,
    baseTotalOut,
    baseClosing,
    entries,
    reconciles,
  };
}

/**
 * Document numbers for the entries that name one, so a row can say which
 * document moved the money rather than only that something did.
 *
 * Nothing but a resource's registration writes the book yet — SIBA's Cash Bank
 * Transaction was not carried (Claude-ERP.md P10) — so there is nothing to
 * look up. Pembayaran adds its own documents here when it is built.
 */
async function sourceDocumentNumbers(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  rows: { source_doc_id: number | null; source_doc_type: { doc_table: string } | null }[]
): Promise<Map<number, string>> {
  return new Map();
}

export type BalanceReportRow = {
  cashBankId: number;
  label: string;
  name: string;
  type: string;
  active: boolean;
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  baseOpening: number;
  baseTotalIn: number;
  baseTotalOut: number;
  baseClosing: number;
  /** Whether anything at all happened to this resource inside the period. */
  moved: boolean;
};

export type BalanceReportGroup = {
  currencyId: number;
  currencyLabel: string;
  rows: BalanceReportRow[];
  opening: number;
  totalIn: number;
  totalOut: number;
  closing: number;
  baseOpening: number;
  baseTotalIn: number;
  baseTotalOut: number;
  baseClosing: number;
};

export type BalanceReport = {
  range: PeriodRange;
  groups: BalanceReportGroup[];
  resources: number;
  /**
   * Every currency group's base figures added together.
   *
   * Grouping per currency stays, because what a resource holds is the figure
   * somebody spends. The base total is what the grouping could never give:
   * one figure for the whole report, built from what each movement was
   * actually worth rather than from a rate applied at read time.
   */
  baseOpening: number;
  baseTotalIn: number;
  baseTotalOut: number;
  baseClosing: number;
};

/**
 * Opening, movement and closing for every resource over a period.
 *
 * Grouped per currency and totalled per currency only: adding a USD balance to
 * an IDR one would need an exchange rate the system does not have, so it is
 * never done (CLAUDE.md §12).
 *
 * **Inactive resources are included when they moved.** A resource deactivated
 * during the period still held and moved money inside it, and leaving it out
 * would produce a report that does not reconcile against the ledger it claims
 * to summarise. `cashBookSummary` still excludes them, because that answers a
 * different question — what is spendable now.
 */
export async function cashBankBalanceReport(
  range: PeriodRange,
  cashBankId?: number | null
): Promise<BalanceReport> {
  const resources = await prisma.mCashBank.findMany({
    where: cashBankId ? { id: cashBankId } : {},
    orderBy: { cash_bank_label: "asc" },
    select: {
      id: true,
      cash_bank_label: true,
      cash_bank_name: true,
      cash_bank_type: true,
      status: true,
      currency: { select: { id: true, currency_label: true } },
    },
  });
  if (!resources.length) {
    return {
      range,
      groups: [],
      resources: 0,
      baseOpening: 0,
      baseTotalIn: 0,
      baseTotalOut: 0,
      baseClosing: 0,
    };
  }

  const ids = resources.map((r) => r.id);

  // Two grouped queries rather than one per resource: opening is everything
  // before the period, movement is the period itself split by direction.
  const [openings, movements] = await Promise.all([
    prisma.cashBankLedger.groupBy({
      by: ["cash_bank_id"],
      where: { cash_bank_id: { in: ids }, entry_date: { lt: startOf(range.from) } },
      _sum: { movement: true, base_movement: true },
    }),
    prisma.cashBankLedger.groupBy({
      by: ["cash_bank_id", "direction"],
      where: {
        cash_bank_id: { in: ids },
        entry_date: { gte: startOf(range.from), lte: startOf(range.to) },
      },
      _sum: { amount: true, base_amount: true },
    }),
  ]);

  const openingOf = new Map(
    openings.map((o) => [o.cash_bank_id, o._sum.movement?.toNumber() ?? 0])
  );
  const baseOpeningOf = new Map(
    openings.map((o) => [o.cash_bank_id, o._sum.base_movement?.toNumber() ?? 0])
  );
  const inOf = new Map<number, number>();
  const outOf = new Map<number, number>();
  const baseInOf = new Map<number, number>();
  const baseOutOf = new Map<number, number>();
  for (const m of movements) {
    const incoming = m.direction === "In";
    (incoming ? inOf : outOf).set(
      m.cash_bank_id,
      m._sum.amount?.toNumber() ?? 0
    );
    (incoming ? baseInOf : baseOutOf).set(
      m.cash_bank_id,
      m._sum.base_amount?.toNumber() ?? 0
    );
  }

  const groups = new Map<number, BalanceReportGroup>();
  let counted = 0;

  for (const r of resources) {
    const opening = openingOf.get(r.id) ?? 0;
    const totalIn = inOf.get(r.id) ?? 0;
    const totalOut = outOf.get(r.id) ?? 0;
    const baseOpening = baseOpeningOf.get(r.id) ?? 0;
    const baseTotalIn = baseInOf.get(r.id) ?? 0;
    const baseTotalOut = baseOutOf.get(r.id) ?? 0;
    const moved = totalIn !== 0 || totalOut !== 0;

    // An inactive resource earns its row only by having something to report.
    if (r.status !== "Active" && !moved && opening === 0) continue;

    const group = groups.get(r.currency.id) ?? {
      currencyId: r.currency.id,
      currencyLabel: r.currency.currency_label,
      rows: [],
      opening: 0,
      totalIn: 0,
      totalOut: 0,
      closing: 0,
      baseOpening: 0,
      baseTotalIn: 0,
      baseTotalOut: 0,
      baseClosing: 0,
    };
    const closing = opening + totalIn - totalOut;
    const baseClosing = roundBase(baseOpening + baseTotalIn - baseTotalOut);
    group.rows.push({
      cashBankId: r.id,
      label: r.cash_bank_label,
      name: r.cash_bank_name,
      type: r.cash_bank_type,
      active: r.status === "Active",
      opening,
      totalIn,
      totalOut,
      closing,
      baseOpening,
      baseTotalIn,
      baseTotalOut,
      baseClosing,
      moved,
    });
    group.opening += opening;
    group.totalIn += totalIn;
    group.totalOut += totalOut;
    group.closing += closing;
    group.baseOpening += baseOpening;
    group.baseTotalIn += baseTotalIn;
    group.baseTotalOut += baseTotalOut;
    group.baseClosing += baseClosing;
    groups.set(r.currency.id, group);
    counted += 1;
  }

  const all = [...groups.values()];
  return {
    range,
    resources: counted,
    groups: all.sort((a, b) => a.currencyLabel.localeCompare(b.currencyLabel)),
    baseOpening: roundBase(all.reduce((t, g) => t + g.baseOpening, 0)),
    baseTotalIn: roundBase(all.reduce((t, g) => t + g.baseTotalIn, 0)),
    baseTotalOut: roundBase(all.reduce((t, g) => t + g.baseTotalOut, 0)),
    baseClosing: roundBase(all.reduce((t, g) => t + g.baseClosing, 0)),
  };
}

/** One resource's headline figures, for the Cash & Bank master detail. */
export async function cashBankBookSummary(cashBankId: number): Promise<{
  balance: number;
  baseBalance: number;
  entries: number;
  lastEntryDate: string | null;
}> {
  const row = await prisma.cashBankBalance.findUnique({
    where: { cash_bank_id: cashBankId },
    select: {
      balance: true,
      base_balance: true,
      entry_count: true,
      last_entry_date: true,
    },
  });
  return {
    balance: row?.balance.toNumber() ?? 0,
    baseBalance: row?.base_balance.toNumber() ?? 0,
    entries: row?.entry_count ?? 0,
    lastEntryDate: row?.last_entry_date
      ? row.last_entry_date.toISOString().slice(0, 10)
      : null,
  };
}
