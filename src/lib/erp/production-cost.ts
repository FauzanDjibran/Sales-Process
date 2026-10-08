import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

/**
 * Jenis Biaya (P154, `production_project.md` §21e M75, M84; was Elemen Biaya
 * Produksi, M53) — the master a Tagihan Biaya line picks instead of an
 * account. Each names the **expense account** its cost is booked to and the
 * **credit account** it is credited to; *Dibayar lewat Pengeluaran* says only
 * whether that credit is settled by a payment.
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
  /** Null only on a row made before P154 without a mapping to fill it from. */
  contraAccountId: number | null;
  contraAccountLabel: string | null;
  contraAccountName: string | null;
  isPayable: boolean;
  active: boolean;
};

const include = {
  expense_account: { select: { account_label: true, account_name: true } },
  contra_account: { select: { account_label: true, account_name: true } },
} as const;

type Row = Prisma.AccCostTypeGetPayload<{ include: typeof include }>;

const info = (t: Row): CostTypeInfo => ({
  id: t.id,
  label: t.cost_type_label,
  name: t.cost_type_name,
  expenseAccountId: t.expense_account_id,
  expenseAccountLabel: t.expense_account.account_label,
  expenseAccountName: t.expense_account.account_name,
  contraAccountId: t.contra_account_id,
  contraAccountLabel: t.contra_account?.account_label ?? null,
  contraAccountName: t.contra_account?.account_name ?? null,
  isPayable: t.is_payable,
  active: t.status === "Active",
});

/** The Jenis Biaya by id, with both accounts. */
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

/** The Jenis Biaya naming this account on either side — read before the account is deactivated or loses its Cost Center rule. */
export async function costTypesUsingAccount(accountId: number, db: Db = prisma): Promise<{ asExpense: string[]; asContra: string[] }> {
  const rows = await db.accCostType.findMany({
    where: { OR: [{ expense_account_id: accountId }, { contra_account_id: accountId }] },
    select: { cost_type_label: true, expense_account_id: true },
  });
  return {
    asExpense: rows.filter((r) => r.expense_account_id === accountId).map((r) => r.cost_type_label),
    asContra: rows.filter((r) => r.expense_account_id !== accountId).map((r) => r.cost_type_label),
  };
}
