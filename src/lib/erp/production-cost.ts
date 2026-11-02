import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

/**
 * Jenis Biaya (R9) — the master a Tagihan Biaya line picks instead of an
 * account. Each names the **expense account** its cost is booked to; the
 * credit side of every Tagihan is Account Mapping's *Hutang Biaya Produksi*.
 * The month-end close pools the net debit on these accounts (R10).
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

/** The Jenis Biaya booking to this account — read before the account is deactivated. */
export async function costTypesUsingAccount(accountId: number, db: Db = prisma): Promise<string[]> {
  const rows = await db.accCostType.findMany({ where: { expense_account_id: accountId }, select: { cost_type_label: true } });
  return rows.map((r) => r.cost_type_label);
}

/** Every account a Jenis Biaya books to, active or not — the close's pool accounts (R10). */
export async function costPoolAccountIds(db: Db = prisma): Promise<number[]> {
  const rows = await db.accCostType.findMany({ distinct: ["expense_account_id"], select: { expense_account_id: true } });
  return rows.map((r) => r.expense_account_id);
}
