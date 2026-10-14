import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { refValueOf } from "./system-defaults";
import { systemDefaults } from "./system-settings";

/**
 * Cost Center (P154, `production_project.md` §21e) — where a cost was
 * incurred, a tag on the journal line beside the account (what) and the
 * Partner (who). An account with *Require Cost Center* takes one on every
 * line and no other account takes any; `postJournal` enforces it (M88).
 *
 * Production cost lives in the General Ledger, so this module reads journal
 * lines only: the Cost Center master's options and *Laporan Cost Center*
 * (M90). It never writes a journal line.
 *
 * A Cost Center is an entity with a category, Produksi or Non-Produksi
 * (P160, M110). The role it plays in costing is set elsewhere, as the
 * mainstream keeps it (SAP's allocation cycles, NetSuite's allocation
 * schedules): a Workstation names the Produksi Cost Center it pools into, and
 * System Default names the one overhead, spread Rata over the others at the
 * month-end close.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type CostCenterCategoryValue = "Production" | "NonProduction";

export type CostCenterOption = { id: number; label: string; name: string; active: boolean; category: CostCenterCategoryValue };

const option = (c: { id: number; cost_center_label: string; cost_center_name: string; status: string; cost_center_category: CostCenterCategoryValue }): CostCenterOption => ({
  id: c.id,
  label: c.cost_center_label,
  name: c.cost_center_name,
  active: c.status === "Active",
  category: c.cost_center_category,
});

/** Every Cost Center, either category — a Tagihan Biaya line may name any of them (P159, M106). */
export async function costCenterOptions(db: Db = prisma): Promise<CostCenterOption[]> {
  const rows = await db.accCostCenter.findMany({ orderBy: { cost_center_label: "asc" } });
  return rows.map(option);
}

/** The Cost Centers by id — what a document checks its lines against. */
export async function costCentersByIds(ids: number[], db: Db = prisma): Promise<Map<number, CostCenterOption>> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (!unique.length) return new Map();
  const rows = await db.accCostCenter.findMany({ where: { id: { in: unique } } });
  return new Map(rows.map((c) => [c.id, option(c)]));
}

// ------------------------------------------------------- costing roles

/** The Cost Center System Default names as the overhead, or null (P160). */
export async function overheadCostCenterId(): Promise<number | null> {
  return refValueOf(await systemDefaults(), "production_overhead_cost_center");
}

/**
 * The options the *Cost Center Overhead* setting offers: Produksi Cost
 * Centers no workstation pools into — the overhead has no executions of its
 * own; it is spread over those that do.
 */
export async function overheadCostCenterOptions(): Promise<CostCenterOption[]> {
  const rows = await prisma.accCostCenter.findMany({
    where: { cost_center_category: "Production", workstations: { none: {} } },
    orderBy: { cost_center_label: "asc" },
  });
  return rows.map(option);
}

/** Why a Cost Center may not be the overhead, or null (P160, M110). */
export async function overheadCostCenterProblem(costCenterId: number): Promise<string | null> {
  const c = await prisma.accCostCenter.findUnique({
    where: { id: costCenterId },
    select: { cost_center_category: true, status: true, workstations: { select: { workstation_label: true } } },
  });
  if (!c) return "Cost Center tidak ditemukan.";
  if (c.cost_center_category !== "Production") return "Cost Center Overhead harus berkategori Produksi.";
  if (c.status !== "Active") return "Cost Center tersebut sudah nonaktif.";
  if (c.workstations.length) {
    return `Cost Center ini dipakai Workstation (${c.workstations.map((w) => w.workstation_label).join(", ")}): overhead tidak memiliki workstation sendiri.`;
  }
  return null;
}

/** What names a Cost Center: posted cost, workstations, the overhead setting — why its category is fixed. */
async function costCenterUses(costCenterId: number): Promise<string[]> {
  const [lines, workstations, overhead] = await Promise.all([
    prisma.accJournalLine.count({ where: { cost_center_id: costCenterId } }),
    prisma.refWorkstation.findMany({ where: { cost_center_id: costCenterId }, select: { workstation_label: true } }),
    overheadCostCenterId(),
  ]);
  const used: string[] = [];
  if (lines) used.push(`${lines} baris journal`);
  if (workstations.length) used.push(`Workstation ${workstations.map((w) => w.workstation_label).join(", ")}`);
  if (overhead === costCenterId) used.push("Cost Center Overhead di System Default");
  return used;
}

/** A Cost Center's category is fixed once anything names it (P160): the close reads its history by it. */
export async function costCenterCategoryProblem(values: Record<string, unknown>, costCenterId: number | null): Promise<string | null> {
  if (!costCenterId) return null;
  const before = await prisma.accCostCenter.findUnique({ where: { id: costCenterId }, select: { cost_center_category: true } });
  if (!before || before.cost_center_category === values.cost_center_category) return null;
  const used = await costCenterUses(costCenterId);
  return used.length ? `Kategori tidak dapat diubah: Cost Center ini sudah dipakai (${used.join(", ")}).` : null;
}

/**
 * Why a Cost Center may not be deactivated, or null: a workstation pools into
 * it, or it is the overhead — the close would send cost where nothing may be
 * chosen any more.
 */
export async function costCenterDeactivationRefusal(costCenterId: number): Promise<string | null> {
  const [workstations, overhead] = await Promise.all([
    prisma.refWorkstation.findMany({ where: { cost_center_id: costCenterId, status: "Active" }, select: { workstation_label: true } }),
    overheadCostCenterId(),
  ]);
  if (workstations.length) {
    return `Cost Center ini dipakai Workstation (${workstations.map((w) => w.workstation_label).join(", ")}): pindahkan dulu ke Cost Center lain.`;
  }
  if (overhead === costCenterId) return "Cost Center ini adalah Cost Center Overhead di System Default: ganti dulu di sana.";
  return null;
}

/** A Workstation pools into an active Produksi Cost Center that is not the overhead (M93, P160). */
export async function workstationCostCenterProblem(costCenterId: number | null): Promise<string | null> {
  if (!costCenterId) return null;
  const c = await prisma.accCostCenter.findUnique({ where: { id: costCenterId }, select: { cost_center_category: true, status: true } });
  if (!c) return "Cost Center tidak ditemukan.";
  if (c.cost_center_category !== "Production") return "Workstation hanya dapat memakai Cost Center berkategori Produksi.";
  if (c.status !== "Active") return "Cost Center tersebut sudah nonaktif.";
  if ((await overheadCostCenterId()) === costCenterId) {
    return "Cost Center ini adalah Cost Center Overhead: overhead dialokasikan ke workstation lain, bukan dipakai workstation.";
  }
  return null;
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
