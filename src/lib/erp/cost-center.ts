import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

/**
 * Cost Center (P154, `production_project.md` §21e) — where a cost was
 * incurred, a tag on the journal line beside the account (what) and the
 * Partner (who). An account with *Require Cost Center* takes one on every
 * line and no other account takes any; `postJournal` enforces it (M88).
 *
 * Production cost lives in the General Ledger, so this module reads journal
 * lines only: the Cost Center master's options and *Laporan Cost Center*
 * (M90). It never writes a journal line.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type CostCenterOption = { id: number; label: string; name: string; active: boolean };

export async function costCenterOptions(db: Db = prisma): Promise<CostCenterOption[]> {
  const rows = await db.accCostCenter.findMany({ orderBy: { cost_center_label: "asc" } });
  return rows.map((c) => ({ id: c.id, label: c.cost_center_label, name: c.cost_center_name, active: c.status === "Active" }));
}

/** The Cost Centers by id — what a document checks its lines against. */
export async function costCentersByIds(ids: number[], db: Db = prisma): Promise<Map<number, CostCenterOption>> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (!unique.length) return new Map();
  const rows = await db.accCostCenter.findMany({ where: { id: { in: unique } } });
  return new Map(rows.map((c) => [c.id, { id: c.id, label: c.cost_center_label, name: c.cost_center_name, active: c.status === "Active" }]));
}

// ---------------------------------------------------------------- report

export type CostCenterFigures = { opening: number; debit: number; credit: number; closing: number };

export type CostCenterLine = {
  id: number;
  date: string;
  journalId: number;
  journalNo: string;
  sourceDocTypeId: number | null;
  sourceDocId: number | null;
  partnerLabel: string | null;
  partnerName: string | null;
  description: string;
  debit: number;
  credit: number;
};

export type CostCenterAccountBlock = CostCenterFigures & {
  accountId: number;
  accountLabel: string;
  accountName: string;
  lines: CostCenterLine[];
};

export type CostCenterBlock = CostCenterFigures & {
  costCenterId: number;
  label: string;
  name: string;
  accounts: CostCenterAccountBlock[];
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * *Laporan Cost Center* (M90): per Cost Center, per account, Saldo Awal ·
 * Debit · Kredit · Saldo Akhir, and the journal lines of the period. Saldo
 * Awal counts from the fiscal year's start, because a cost account starts
 * every year at nil. Posted journals only; a draft reaches no report.
 */
export async function costCenterReport(input: {
  yearStart: string;
  from: string;
  to: string;
  costCenterIds?: number[];
}): Promise<CostCenterBlock[]> {
  const centers = await prisma.accCostCenter.findMany({
    where: input.costCenterIds?.length ? { id: { in: input.costCenterIds } } : {},
    orderBy: { cost_center_label: "asc" },
  });
  if (!centers.length) return [];
  const where = (gte: string, lte: Date, lt?: Date): Prisma.AccJournalLineWhereInput => ({
    cost_center_id: { in: centers.map((c) => c.id) },
    journal: { status: "Posted", posting_date: { gte: day(gte), ...(lt ? { lt } : { lte }) } },
  });
  const [openingRows, lines] = await Promise.all([
    input.from > input.yearStart
      ? prisma.accJournalLine.groupBy({
          by: ["cost_center_id", "account_id"],
          where: where(input.yearStart, day(input.from), day(input.from)),
          _sum: { debit_amount: true, kredit_amount: true },
        })
      : Promise.resolve([]),
    prisma.accJournalLine.findMany({
      where: where(input.from, day(input.to)),
      include: {
        journal: { select: { id: true, journal_no: true, posting_date: true, source_doc_type_id: true, source_doc_id: true } },
        partner: { select: { partner_label: true, partner_name: true } },
      },
      orderBy: [{ journal: { posting_date: "asc" } }, { journal_id: "asc" }, { sequence_no: "asc" }],
    }),
  ]);

  const accountIds = [...new Set([...openingRows.map((r) => r.account_id), ...lines.map((l) => l.account_id)])];
  const accounts = new Map(
    (await prisma.accAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true, account_label: true, account_name: true } })).map((a) => [a.id, a])
  );

  const blocks = new Map<number, Map<number, CostCenterAccountBlock>>();
  const blockOf = (centerId: number, accountId: number) => {
    const byAccount = blocks.get(centerId) ?? new Map<number, CostCenterAccountBlock>();
    blocks.set(centerId, byAccount);
    let b = byAccount.get(accountId);
    if (!b) {
      const a = accounts.get(accountId);
      b = { accountId, accountLabel: a?.account_label ?? `#${accountId}`, accountName: a?.account_name ?? "", opening: 0, debit: 0, credit: 0, closing: 0, lines: [] };
      byAccount.set(accountId, b);
    }
    return b;
  };
  for (const r of openingRows) {
    const b = blockOf(r.cost_center_id!, r.account_id);
    b.opening = cents(b.opening + (r._sum.debit_amount?.toNumber() ?? 0) - (r._sum.kredit_amount?.toNumber() ?? 0));
  }
  for (const l of lines) {
    const b = blockOf(l.cost_center_id!, l.account_id);
    const debit = l.debit_amount.toNumber();
    const credit = l.kredit_amount.toNumber();
    b.debit = cents(b.debit + debit);
    b.credit = cents(b.credit + credit);
    b.lines.push({
      id: l.id,
      date: l.journal.posting_date ? iso(l.journal.posting_date) : "",
      journalId: l.journal.id,
      journalNo: l.journal.journal_no,
      sourceDocTypeId: l.journal.source_doc_type_id,
      sourceDocId: l.journal.source_doc_id,
      partnerLabel: l.partner?.partner_label ?? null,
      partnerName: l.partner?.partner_name ?? null,
      description: l.description,
      debit,
      credit,
    });
  }

  return centers.map((c) => {
    const list = [...(blocks.get(c.id)?.values() ?? [])]
      .map((a) => ({ ...a, closing: cents(a.opening + a.debit - a.credit) }))
      .sort((x, y) => x.accountLabel.localeCompare(y.accountLabel, undefined, { numeric: true }));
    const sum = (f: (a: CostCenterAccountBlock) => number) => cents(list.reduce((s, a) => s + f(a), 0));
    return {
      costCenterId: c.id,
      label: c.cost_center_label,
      name: c.cost_center_name,
      opening: sum((a) => a.opening),
      debit: sum((a) => a.debit),
      credit: sum((a) => a.credit),
      closing: sum((a) => a.closing),
      accounts: list,
    };
  });
}
