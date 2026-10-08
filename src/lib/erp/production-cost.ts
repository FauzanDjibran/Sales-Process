import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { checkAccountIsLeaf } from "./records";

/**
 * Production cost (P150, `production_project.md` E4).
 *
 * Labour and overhead are booked to **Elemen Biaya Produksi** — expense
 * accounts whose every line is production cost (M40) — and gathered in the
 * cost ledger, which the period close spreads over the finished goods (M23).
 * Phase 1 holds the elements; the cost ledger joins in Phase 2.
 *
 * **An element is a Control Account** (M39): the manual journal refuses a
 * Control Account (P16), so only documents post to an element, and each of
 * them writes the cost ledger in the same posting — the cost ledger is the
 * element's subledger, as AR items are Piutang's. For the same reason an
 * element is chosen **before anything posts to it**, and an account that some
 * other posting rule already points at (Account Mapping, a Jenis PPh, a
 * Kategori Item's Persediaan or HPP) cannot become one: those documents would
 * post to it without writing the cost ledger.
 *
 * Named only by this module (`acc_production_cost_element`).
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** The chart's Biaya type: every element sits under it. */
const COST_TYPE_PREFIX = "5.";

/** Whether an account label sits under the chart's Biaya type (`5.x`). */
export function isCostAccountLabel(label: string): boolean {
  return label.startsWith(COST_TYPE_PREFIX);
}

/**
 * Why an account cannot become an element, or null when it can. Covers the
 * account itself; the posting rules that point at it are the caller's to
 * compose (`elementUseProblem` in the Server Action), because they belong to
 * other modules.
 */
export async function costElementAccountProblem(accountId: number, db: Db = prisma): Promise<string | null> {
  const account = await db.accAccount.findUnique({
    where: { id: accountId },
    select: {
      account_label: true,
      is_postable: true,
      is_active: true,
      is_control_account: true,
      _count: { select: { journal_lines: true } },
    },
  });
  if (!account) return "Account tidak ditemukan.";
  if (!account.is_postable) return "Account tersebut bukan account postable.";
  if (!account.is_active) return "Account tersebut non-aktif.";
  const leaf = await checkAccountIsLeaf(accountId);
  if (leaf) return leaf;
  if (!isCostAccountLabel(account.account_label)) return "Elemen Biaya Produksi harus account Biaya (5.x).";
  if (!account.is_control_account) {
    return "Tandai account ini sebagai Control Account dulu, agar hanya dokumen produksi yang memostingnya.";
  }
  if (account._count.journal_lines > 0) {
    return "Account ini sudah pernah diposting. Pilih account yang belum dipakai, agar seluruh isinya tercatat di Buku Biaya Produksi.";
  }
  return null;
}

/** The accounts that are elements (active or not), out of `accountIds`. */
export async function costElementAccounts(accountIds: number[], db: Db = prisma): Promise<Set<number>> {
  const ids = [...new Set(accountIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return new Set();
  const rows = await db.accProductionCostElement.findMany({ where: { account_id: { in: ids } }, select: { account_id: true } });
  return new Set(rows.map((r) => r.account_id));
}

/** Whether one account is an element — read by the guards of other masters. */
export async function isCostElementAccount(accountId: number, db: Db = prisma): Promise<boolean> {
  return (await costElementAccounts([accountId], db)).has(accountId);
}

/** The refusal another posting rule gives when it is pointed at an element. */
export const COST_ELEMENT_REFUSAL =
  "Account ini adalah Elemen Biaya Produksi; hanya dokumen produksi yang memostingnya.";
