import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { parseList } from "./partner-shape";
import {
  SPREADS_KEY,
  percentUnits,
  spreadRowErrors,
  spreadTotalProblem,
  type CostCenterTypeValue,
  type SpreadDraft,
} from "./cost-center-shape";

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
 * It also keeps **the costing masters** (P159, production Phase 5a): a Cost
 * Center's type and an Overhead's spread, the Production Cost Center a
 * Workstation pools into, and the Tarif Standar per workstation — what the
 * Eksekusi Produksi (Phase 5) and the month-end close (Phase 8) will read.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type CostCenterOption = { id: number; label: string; name: string; active: boolean; type: CostCenterTypeValue };

const option = (c: { id: number; cost_center_label: string; cost_center_name: string; status: string; cost_center_type: CostCenterTypeValue }): CostCenterOption => ({
  id: c.id,
  label: c.cost_center_label,
  name: c.cost_center_name,
  active: c.status === "Active",
  type: c.cost_center_type,
});

/** Every Cost Center, any type — a Tagihan Biaya line may name any of them (P159). */
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

// ------------------------------------------------------- costing masters

/**
 * An Overhead's spread in the shape the Alokasi tab edits it. Empty for any
 * other Cost Center, and for a new one.
 */
export async function costCenterCollections(costCenterId: number): Promise<{ spreads: SpreadDraft[] }> {
  const rows = await prisma.accCostCenterSpread.findMany({
    where: { overhead_cost_center_id: costCenterId },
    orderBy: { id: "asc" },
  });
  return {
    spreads: rows.map((r) => ({ id: r.id, key: `s${r.id}`, costCenterId: r.production_cost_center_id, percent: r.percent.toString() })),
  };
}

/** What names a Cost Center: posted cost, workstations and spreads — why its type is fixed. */
async function costCenterUses(costCenterId: number): Promise<string[]> {
  const [lines, workstations, spreads] = await Promise.all([
    prisma.accJournalLine.count({ where: { cost_center_id: costCenterId } }),
    prisma.refWorkstation.findMany({ where: { cost_center_id: costCenterId }, select: { workstation_label: true } }),
    prisma.accCostCenterSpread.count({
      where: { OR: [{ overhead_cost_center_id: costCenterId }, { production_cost_center_id: costCenterId }] },
    }),
  ]);
  const used: string[] = [];
  if (lines) used.push(`${lines} baris journal`);
  if (workstations.length) used.push(`Workstation ${workstations.map((w) => w.workstation_label).join(", ")}`);
  if (spreads) used.push("alokasi Overhead");
  return used;
}

export type CostCenterCollections = {
  spreads: { productionCostCenterId: number; percent: string }[];
};

/**
 * Checks a Cost Center form's type, spread method and Alokasi rows (P159).
 *
 * - The type is fixed once anything names the Cost Center (posted journal
 *   lines, a workstation, a spread), because the close reads its history by
 *   type.
 * - An Overhead needs a spread method; any other type has none.
 * - *Persentase* rows name active Production Cost Centers, each once, and add
 *   up to exactly 100. *Rata* and the other types keep no rows.
 */
export async function checkCostCenter(
  values: Record<string, unknown>,
  costCenterId: number | null
): Promise<{ errors: Record<string, string>; clean: CostCenterCollections }> {
  const errors: Record<string, string> = {};
  const clean: CostCenterCollections = { spreads: [] };
  const type = String(values.cost_center_type ?? "") as CostCenterTypeValue;
  const method = String(values.spread_method ?? "");

  if (costCenterId) {
    const before = await prisma.accCostCenter.findUnique({ where: { id: costCenterId }, select: { cost_center_type: true } });
    if (before && before.cost_center_type !== type) {
      const used = await costCenterUses(costCenterId);
      if (used.length) errors.cost_center_type = `Tipe tidak dapat diubah: Cost Center ini sudah dipakai (${used.join(", ")}).`;
    }
  }
  if (type === "Overhead" && method !== "Even" && method !== "Percent") {
    errors.spread_method = "Pilih Metode Alokasi.";
  }
  if (type !== "Overhead" || method !== "Percent") return { errors, clean };

  const list = parseList<Partial<SpreadDraft>>(values[SPREADS_KEY]);
  if (list === null) {
    errors[SPREADS_KEY] = "Data alokasi tidak terbaca.";
    return { errors, clean };
  }
  const targets = await prisma.accCostCenter.findMany({
    where: { id: { in: list.map((r) => Number(r.costCenterId)).filter((n) => Number.isInteger(n) && n > 0) } },
    select: { id: true, cost_center_label: true, cost_center_type: true, status: true },
  });
  const byId = new Map(targets.map((t) => [t.id, t]));
  const problems: string[] = [];
  const taken: number[] = [];
  for (const [i, r] of list.entries()) {
    const row = { ...r, costCenterId: Number(r.costCenterId) || null, percent: String(r.percent ?? "") };
    const rowErrors = spreadRowErrors(row, taken);
    if (Object.keys(rowErrors).length) {
      problems.push(`Alokasi ${i + 1}: ${Object.values(rowErrors)[0]}`);
      continue;
    }
    const target = byId.get(row.costCenterId!);
    if (!target || target.id === costCenterId) {
      problems.push(`Alokasi ${i + 1}: pilih Cost Center Produksi lain.`);
      continue;
    }
    if (target.cost_center_type !== "Production") {
      problems.push(`Alokasi ${i + 1}: ${target.cost_center_label} bukan Cost Center Produksi.`);
      continue;
    }
    if (target.status !== "Active") {
      problems.push(`Alokasi ${i + 1}: ${target.cost_center_label} sudah nonaktif.`);
      continue;
    }
    taken.push(target.id);
    clean.spreads.push({ productionCostCenterId: target.id, percent: (percentUnits(row.percent)! / 10000).toString() });
  }
  if (!problems.length) {
    const total = spreadTotalProblem(clean.spreads);
    if (total) problems.push(total);
  }
  if (problems.length) errors[SPREADS_KEY] = problems.join(" ");
  return { errors, clean };
}

/** Makes the Overhead's spread exactly what was submitted — none for another type or *Rata*. */
export async function writeCostCenterSpreads(
  tx: Prisma.TransactionClient,
  costCenterId: number,
  clean: CostCenterCollections,
  actorId: number
): Promise<void> {
  const keep = clean.spreads.map((s) => s.productionCostCenterId);
  await tx.accCostCenterSpread.deleteMany({
    where: { overhead_cost_center_id: costCenterId, production_cost_center_id: { notIn: keep } },
  });
  for (const s of clean.spreads) {
    await tx.accCostCenterSpread.upsert({
      where: { overhead_cost_center_id_production_cost_center_id: { overhead_cost_center_id: costCenterId, production_cost_center_id: s.productionCostCenterId } },
      update: { percent: s.percent, updated_by: actorId },
      create: { overhead_cost_center_id: costCenterId, production_cost_center_id: s.productionCostCenterId, percent: s.percent, created_by: actorId },
    });
  }
}

/**
 * Why a Cost Center may not be deactivated, or null: a workstation pools into
 * it, or an active Overhead spreads into it by Persentase — the close would
 * send cost where nothing may be chosen any more.
 */
export async function costCenterDeactivationRefusal(costCenterId: number): Promise<string | null> {
  const [workstations, spreads] = await Promise.all([
    prisma.refWorkstation.findMany({ where: { cost_center_id: costCenterId, status: "Active" }, select: { workstation_label: true } }),
    prisma.accCostCenterSpread.findMany({
      where: { production_cost_center_id: costCenterId, overhead: { status: "Active", spread_method: "Percent" } },
      select: { overhead: { select: { cost_center_label: true } } },
    }),
  ]);
  if (workstations.length) {
    return `Cost Center ini dipakai Workstation (${workstations.map((w) => w.workstation_label).join(", ")}): pindahkan dulu ke Cost Center lain.`;
  }
  if (spreads.length) {
    return `Cost Center ini menerima alokasi Overhead (${spreads.map((s) => s.overhead.cost_center_label).join(", ")}): ubah alokasinya dulu.`;
  }
  return null;
}

/** A Workstation pools into an active Production Cost Center (M93). */
export async function workstationCostCenterProblem(costCenterId: number | null): Promise<string | null> {
  if (!costCenterId) return null;
  const c = await prisma.accCostCenter.findUnique({ where: { id: costCenterId }, select: { cost_center_type: true, status: true } });
  if (!c) return "Cost Center tidak ditemukan.";
  if (c.cost_center_type !== "Production") return "Workstation hanya dapat memakai Cost Center bertipe Produksi.";
  if (c.status !== "Active") return "Cost Center tersebut sudah nonaktif.";
  return null;
}

/**
 * Why a Tarif Standar row may not start in, or change for, a period, or null
 * (M94): the period is closed. Phase 5 adds the other half — an Eksekusi
 * Produksi already posted at the workstation in or after it.
 */
async function rateFrozenRefusal(periodId: number): Promise<string | null> {
  const period = await prisma.accFiscalPeriod.findUnique({ where: { id: periodId }, select: { status: true, period_name: true } });
  if (!period) return "Periode tidak ditemukan.";
  if (period.status === "Closed") return `Periode ${period.period_name} sudah ditutup.`;
  return null;
}

/**
 * Checks a Tarif Standar row (P159). Workstation and period are chosen once
 * (locked on edit); the pair is unique; the rate is 0 or more; a closed
 * period takes no row and its row no change.
 */
export async function checkStandardRate(
  values: Record<string, unknown>,
  rateId: number | null
): Promise<Record<string, string>> {
  const errors: Record<string, string> = {};
  const before = rateId
    ? await prisma.refWorkstationRate.findUnique({ where: { id: rateId }, select: { workstation_id: true, effective_period_id: true } })
    : null;
  const workstationId = before?.workstation_id ?? (Number(values.workstation_id) || null);
  const periodId = before?.effective_period_id ?? (Number(values.effective_period_id) || null);

  const raw = String(values.rate ?? "").trim();
  const rate = Number(raw);
  if (raw !== "" && (!Number.isFinite(rate) || rate < 0)) errors.rate = "Tarif tidak boleh negatif.";

  if (!before && workstationId) {
    const ws = await prisma.refWorkstation.findUnique({ where: { id: workstationId }, select: { status: true } });
    if (!ws) errors.workstation_id = "Workstation tidak ditemukan.";
    else if (ws.status !== "Active") errors.workstation_id = "Workstation tersebut sudah nonaktif.";
  }
  if (periodId) {
    const frozen = await rateFrozenRefusal(periodId);
    if (frozen) errors[before ? "rate" : "effective_period_id"] ??= frozen;
  }
  if (!before && workstationId && periodId && !errors.workstation_id && !errors.effective_period_id) {
    const clash = await prisma.refWorkstationRate.findFirst({ where: { workstation_id: workstationId, effective_period_id: periodId }, select: { id: true } });
    if (clash) errors.effective_period_id = "Workstation ini sudah memiliki Tarif Standar mulai periode tersebut — ubah tarif itu.";
  }
  return errors;
}

export type StandardRate = { rate: number; rateId: number | null; fromPeriod: string | null };

/**
 * The Tarif Standar in force at a workstation on a date (M94): the row
 * starting in the latest period on or before the date's period. None reads as
 * a rate of 0 — no standard, and the close absorbs the whole cost (M91).
 */
export async function standardRateFor(workstationId: number, date: string, db: Db = prisma): Promise<StandardRate> {
  const day = new Date(`${date}T00:00:00Z`);
  const row = await db.refWorkstationRate.findFirst({
    where: { workstation_id: workstationId, effective_period: { start_date: { lte: day } } },
    orderBy: { effective_period: { start_date: "desc" } },
    include: { effective_period: { select: { period_name: true } } },
  });
  return row
    ? { rate: row.rate.toNumber(), rateId: row.id, fromPeriod: row.effective_period.period_name }
    : { rate: 0, rateId: null, fromPeriod: null };
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
