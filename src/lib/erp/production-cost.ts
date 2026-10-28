import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

/**
 * Jenis Biaya (P154, `production_project.md` §21e M75, M84; was Elemen Biaya
 * Produksi, M53) — the master a Tagihan Biaya line picks instead of an
 * account. Each names the **expense account** its cost is booked to, and the
 * Standard Cost Item it is absorbed under at the close (P160, M108); the
 * credit side of every Tagihan is Account Mapping's *Hutang Biaya Produksi*
 * (P156).
 *
 * Production cost has no book of its own any more (M73): it is the General
 * Ledger's, tagged by Cost Center on the journal line (`cost-center.ts`).
 *
 * Named only by this module (`acc_cost_type`), apart from the registry, which
 * writes its rows.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type CostTypeInfo = {
  id: number;
  label: string;
  name: string;
  expenseAccountId: number;
  expenseAccountLabel: string;
  expenseAccountName: string;
  active: boolean;
};

const include = {
  expense_account: { select: { account_label: true, account_name: true } },
} as const;

type Row = Prisma.AccCostTypeGetPayload<{ include: typeof include }>;

const info = (t: Row): CostTypeInfo => ({
  id: t.id,
  label: t.cost_type_label,
  name: t.cost_type_name,
  expenseAccountId: t.expense_account_id,
  expenseAccountLabel: t.expense_account.account_label,
  expenseAccountName: t.expense_account.account_name,
  active: t.status === "Active",
});

/** The Jenis Biaya by id, with its account. */
export async function costTypesByIds(ids: number[], db: Db = prisma): Promise<Map<number, CostTypeInfo>> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (!unique.length) return new Map();
  const rows = await db.accCostType.findMany({ where: { id: { in: unique } }, include });
  return new Map(rows.map((t) => [t.id, info(t)]));
}

/** Every Jenis Biaya, by label, for pickers. */
export async function costTypeOptions(db: Db = prisma): Promise<CostTypeInfo[]> {
  const rows = await db.accCostType.findMany({ include, orderBy: { cost_type_label: "asc" } });
  return rows.map(info);
}

/** The Jenis Biaya booking to this account — read before the account is deactivated or loses its Cost Center rule. */
export async function costTypesUsingAccount(accountId: number, db: Db = prisma): Promise<string[]> {
  const rows = await db.accCostType.findMany({ where: { expense_account_id: accountId }, select: { cost_type_label: true } });
  return rows.map((r) => r.cost_type_label);
}

/** The Jenis Biaya absorbed under a Standard Cost Item (P160, M108), by label. */
export async function costTypesUsingStandardCostItem(itemId: number, db: Db = prisma): Promise<string[]> {
  const rows = await db.accCostType.findMany({ where: { standard_cost_item_id: itemId, status: "Active" }, select: { cost_type_label: true } });
  return rows.map((r) => r.cost_type_label);
}

/** Which Standard Cost Item each Jenis Biaya's expense account is absorbed under (P160 M108) — how the close reads a Cost Center's actual cost per item (P172). */
export async function expenseAccountItems(db: Db = prisma): Promise<Map<number, number>> {
  const rows = await db.accCostType.findMany({ where: { standard_cost_item_id: { not: null } }, select: { expense_account_id: true, standard_cost_item_id: true } });
  return new Map(rows.map((r) => [r.expense_account_id, r.standard_cost_item_id!]));
}
