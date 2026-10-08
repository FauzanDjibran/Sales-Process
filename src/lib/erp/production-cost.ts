import "server-only";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

/**
 * Production cost (P150, `production_project.md` E4).
 *
 * Labour and overhead are booked under **Elemen Biaya Produksi** — a kind of
 * production cost the user names, with the account it posts to (M53), as a
 * Jenis PPh or a Cash & Bank names its account. Every line on that account is
 * production cost (M40), and several elements may share one account (M61).
 *
 * **The cost ledger is the source of truth**, as the Cash Bank Book and the
 * stock books are for theirs (M60): the period close reads it, never the GL.
 * Nothing here checks the Control Account mark (M55) — keeping other postings
 * off an element's account is the user's guard, by that mark, as it is for
 * every other book's account. Phase 1 holds the elements; the cost ledger
 * joins in Phase 2.
 *
 * Named only by this module and the registry (`acc_production_cost_element`).
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** The elements naming this account — read before the account is deactivated. */
export async function elementsUsingAccount(accountId: number, db: Db = prisma): Promise<string[]> {
  const rows = await db.accProductionCostElement.findMany({ where: { account_id: accountId }, select: { element_label: true } });
  return rows.map((r) => r.element_label);
}
