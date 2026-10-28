import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { formatPrice } from "@/lib/format";
import { parseList } from "./partner-shape";
import { LINES_KEY, standardCostLineErrors, type StandardCostLineDraft } from "./standard-cost-shape";

/**
 * Standard cost (P160, `production_project.md` M107–M109) — what the Eksekusi
 * Produksi absorbs into WIP before the month-end close settles it to actual.
 *
 * - A **Standard Cost Item** (Master › Referensi) is a conversion cost — TKL,
 *   BOP Mesin, BOP Pabrik — and the account its absorption credits, as SAP's
 *   activity type or D365's and NetSuite's cost category. It names no Cost
 *   Center: the posting takes the workstation's.
 * - A **Standard Cost** (Accounting › Pengaturan) is a workstation's rates from
 *   a fiscal period on, one line per item. The entry in force for a period is
 *   the latest starting on or before it; an item it does not list, or lists
 *   at 0, has no standard there.
 *
 * Named only by this module (`acc_standard_cost_item`, `acc_standard_cost`,
 * `acc_standard_cost_line`), apart from the registry, which writes the rows.
 */

type Db = Prisma.TransactionClient | typeof prisma;

// ------------------------------------------------------ Standard Cost Item

/** An item credits a postable, active leaf account that requires a Cost Center (M107). */
export async function standardCostItemAccountProblem(accountId: number | null): Promise<string | null> {
  if (!accountId) return null;
  const a = await prisma.accAccount.findUnique({
    where: { id: accountId },
    select: { is_postable: true, is_active: true, require_cost_center: true, _count: { select: { children: true } } },
  });
  if (!a || !a.is_postable || !a.is_active || a._count.children > 0) return "Pilih account aktif yang dapat diposting.";
  if (!a.require_cost_center) return "Account Standard Cost harus ditandai Require Cost Center pada Chart of Accounts.";
  return null;
}

/** A Jenis Biaya names an active Standard Cost Item (M108). */
export async function standardCostItemProblem(itemId: number | null): Promise<string | null> {
  if (!itemId) return null;
  const item = await prisma.accStandardCostItem.findUnique({ where: { id: itemId }, select: { status: true } });
  if (!item) return "Standard Cost Item tidak ditemukan.";
  if (item.status !== "Active") return "Standard Cost Item tersebut sudah nonaktif.";
  return null;
}

/** The Standard Cost Items crediting an account, by label — why it stays a Cost Center account and active. */
export async function standardCostItemsUsingAccount(accountId: number): Promise<string[]> {
  const rows = await prisma.accStandardCostItem.findMany({ where: { account_id: accountId }, select: { item_label: true } });
  return rows.map((r) => r.item_label);
}

/** Why an item may not be deactivated, or null: a Standard Cost still in force lists it at a rate. */
export async function standardCostItemDeactivationRefusal(itemId: number): Promise<string | null> {
  const lines = await prisma.accStandardCostLine.findMany({
    where: { item_id: itemId, rate: { gt: 0 } },
    select: { standard_cost: { select: { workstation: { select: { workstation_label: true } } } } },
  });
  if (!lines.length) return null;
  const where = [...new Set(lines.map((l) => l.standard_cost.workstation.workstation_label))].join(", ");
  return `Item ini masih bertarif pada Standard Cost (${where}): buat Standard Cost baru tanpa item ini, atau dengan tarif 0, dulu.`;
}

// ---------------------------------------------------------- Standard Cost

/** A Standard Cost's lines in the shape its Item tab edits them. */
export async function standardCostCollections(standardCostId: number): Promise<{ lines: StandardCostLineDraft[] }> {
  const rows = await prisma.accStandardCostLine.findMany({ where: { standard_cost_id: standardCostId }, orderBy: { id: "asc" } });
  return { lines: rows.map((r) => ({ id: r.id, key: `l${r.id}`, itemId: r.item_id, rate: r.rate.toString() })) };
}

/**
 * Why a Standard Cost may not start in, or change for, a period, or null
 * (M94): the period is closed. Phase 5 adds the other half — an Eksekusi
 * Produksi already posted at the workstation in or after it.
 */
async function periodFrozenRefusal(periodId: number): Promise<string | null> {
  const period = await prisma.accFiscalPeriod.findUnique({ where: { id: periodId }, select: { status: true, period_name: true } });
  if (!period) return "Periode tidak ditemukan.";
  if (period.status === "Closed") return `Periode ${period.period_name} sudah ditutup.`;
  return null;
}

export type StandardCostCollections = { lines: { itemId: number; rate: string }[] };

/**
 * Checks a Standard Cost (P160): the workstation (active when chosen) and the
 * period are chosen once and the pair is unique; a closed period takes no
 * entry and its entry no change; the lines name active items, each once, at
 * a rate of 0 or more, and there is at least one.
 */
export async function checkStandardCost(
  values: Record<string, unknown>,
  standardCostId: number | null
): Promise<{ errors: Record<string, string>; clean: StandardCostCollections }> {
  const errors: Record<string, string> = {};
  const clean: StandardCostCollections = { lines: [] };
  const before = standardCostId
    ? await prisma.accStandardCost.findUnique({ where: { id: standardCostId }, select: { workstation_id: true, effective_period_id: true } })
    : null;
  const workstationId = before?.workstation_id ?? (Number(values.workstation_id) || null);
  const periodId = before?.effective_period_id ?? (Number(values.effective_period_id) || null);

  if (!before && workstationId) {
    const ws = await prisma.refWorkstation.findUnique({ where: { id: workstationId }, select: { status: true } });
    if (!ws) errors.workstation_id = "Workstation tidak ditemukan.";
    else if (ws.status !== "Active") errors.workstation_id = "Workstation tersebut sudah nonaktif.";
  }
  if (periodId) {
    const frozen = await periodFrozenRefusal(periodId);
    if (frozen) errors[before ? "_form" : "effective_period_id"] = frozen;
  }
  if (!before && workstationId && periodId && !errors.workstation_id && !errors.effective_period_id) {
    const clash = await prisma.accStandardCost.findFirst({ where: { workstation_id: workstationId, effective_period_id: periodId }, select: { id: true } });
    if (clash) errors.effective_period_id = "Workstation ini sudah memiliki Standard Cost mulai periode tersebut — ubah yang itu.";
  }

  const list = parseList<Partial<StandardCostLineDraft>>(values[LINES_KEY]);
  if (list === null) {
    errors[LINES_KEY] = "Data item tidak terbaca.";
    return { errors, clean };
  }
  const items = await prisma.accStandardCostItem.findMany({
    where: { id: { in: list.map((l) => Number(l.itemId)).filter((n) => Number.isInteger(n) && n > 0) } },
    select: { id: true, item_label: true, status: true },
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  const kept = new Set(
    standardCostId
      ? (await prisma.accStandardCostLine.findMany({ where: { standard_cost_id: standardCostId }, select: { item_id: true } })).map((l) => l.item_id)
      : []
  );
  const problems: string[] = [];
  const taken: number[] = [];
  for (const [i, l] of list.entries()) {
    const line = { itemId: Number(l.itemId) || null, rate: String(l.rate ?? "") };
    const lineErrors = standardCostLineErrors(line, taken);
    if (Object.keys(lineErrors).length) {
      problems.push(`Item ${i + 1}: ${Object.values(lineErrors)[0]}`);
      continue;
    }
    const item = byId.get(line.itemId!);
    if (!item) {
      problems.push(`Item ${i + 1}: Standard Cost Item tidak ditemukan.`);
      continue;
    }
    // An item deactivated later may stay on an entry that already listed it.
    if (item.status !== "Active" && !kept.has(item.id)) {
      problems.push(`Item ${i + 1}: ${item.item_label} sudah nonaktif.`);
      continue;
    }
    taken.push(item.id);
    clean.lines.push({ itemId: item.id, rate: String(Number(line.rate)) });
  }
  if (!problems.length && !clean.lines.length) problems.push("Tambahkan minimal satu Standard Cost Item.");
  if (problems.length) errors[LINES_KEY] = problems.join(" ");
  return { errors, clean };
}

/** Makes the Standard Cost's lines exactly what was submitted. */
export async function writeStandardCostLines(
  tx: Prisma.TransactionClient,
  standardCostId: number,
  clean: StandardCostCollections,
  actorId: number
): Promise<void> {
  await tx.accStandardCostLine.deleteMany({
    where: { standard_cost_id: standardCostId, item_id: { notIn: clean.lines.map((l) => l.itemId) } },
  });
  for (const l of clean.lines) {
    await tx.accStandardCostLine.upsert({
      where: { standard_cost_id_item_id: { standard_cost_id: standardCostId, item_id: l.itemId } },
      update: { rate: l.rate, updated_by: actorId },
      create: { standard_cost_id: standardCostId, item_id: l.itemId, rate: l.rate, created_by: actorId },
    });
  }
}

/** Each Standard Cost's lines in one line for its list — `TKL Rp 20.000 · BOP-MESIN Rp 15.000`. */
export async function standardCostSummaries(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const lines = await prisma.accStandardCostLine.findMany({
    where: { standard_cost_id: { in: ids } },
    include: { item: { select: { item_label: true } } },
    orderBy: { id: "asc" },
  });
  const out = new Map<number, string[]>();
  for (const l of lines) {
    const list = out.get(l.standard_cost_id) ?? [];
    list.push(`${l.item.item_label} ${formatPrice(l.rate.toNumber())}`);
    out.set(l.standard_cost_id, list);
  }
  return new Map([...out].map(([id, list]) => [id, list.join(" · ")]));
}

/** Standard Cost Item labels by id, to show what an execution booked. */
export async function standardCostItemLabels(ids: number[], db: Db = prisma): Promise<Map<number, string>> {
  const rows = await db.accStandardCostItem.findMany({ where: { id: { in: ids } }, select: { id: true, item_label: true } });
  return new Map(rows.map((r) => [r.id, r.item_label]));
}

export type StandardCostRate = { itemId: number; itemLabel: string; accountId: number; rate: number };

export type StandardCostInForce = { standardCostId: number | null; fromPeriod: string | null; rates: StandardCostRate[] };

/**
 * The Standard Cost in force at a workstation on a date (M109): the entry
 * starting in the latest period on or before the date's period, its items
 * with a rate above 0. None reads as no standard — the close absorbs the
 * whole cost (M91).
 */
export async function standardCostFor(workstationId: number, date: string, db: Db = prisma): Promise<StandardCostInForce> {
  const day = new Date(`${date}T00:00:00Z`);
  const row = await db.accStandardCost.findFirst({
    where: { workstation_id: workstationId, effective_period: { start_date: { lte: day } } },
    orderBy: { effective_period: { start_date: "desc" } },
    include: {
      effective_period: { select: { period_name: true } },
      lines: { include: { item: { select: { item_label: true, account_id: true } } }, orderBy: { id: "asc" } },
    },
  });
  if (!row) return { standardCostId: null, fromPeriod: null, rates: [] };
  return {
    standardCostId: row.id,
    fromPeriod: row.effective_period.period_name,
    rates: row.lines
      .filter((l) => l.rate.gt(0))
      .map((l) => ({ itemId: l.item_id, itemLabel: l.item.item_label, accountId: l.item.account_id, rate: l.rate.toNumber() })),
  };
}

/** Every Standard Cost Item with the account it credits — the close settles that account per Cost Center (P172). */
export async function standardCostItemAccounts(db: Db = prisma): Promise<{ id: number; label: string; accountId: number }[]> {
  const rows = await db.accStandardCostItem.findMany({ select: { id: true, item_label: true, account_id: true } });
  return rows.map((r) => ({ id: r.id, label: r.item_label, accountId: r.account_id }));
}
