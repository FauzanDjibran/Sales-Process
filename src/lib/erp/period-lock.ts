import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * The period lock of the Penutupan Biaya Produksi (R15): once a fiscal period
 * is costed, the value it spread over WIP, stock and HPP stands as it was
 * computed, so nothing dated inside it may move stock or production, nor touch
 * the accounts its pool and credit were read from. Shared kernel: the books ask
 * it at their one write point; only the close writes it.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** A posting the period lock refuses; callers show its message. */
export class PeriodLockRefusal extends Error {}
const asDay = (date: Date | string) => (typeof date === "string" ? new Date(`${date}T00:00:00Z`) : date);

async function costedPeriodAt(date: Date | string, db: Db) {
  const day = asDay(date);
  return db.accFiscalPeriod.findFirst({
    where: { start_date: { lte: day }, end_date: { gte: day }, production_costed_at: { not: null } },
    select: { id: true, period_name: true },
  });
}

/** Why a stock or production posting dated `date` is refused, or null when it may post. */
export async function costedPeriodRefusal(date: Date | string, db: Db = prisma): Promise<string | null> {
  const p = await costedPeriodAt(date, db);
  return p ? `Periode ${p.period_name} sudah ditutup biayanya (Penutupan Biaya Produksi): tidak ada posting stok atau produksi bertanggal di dalamnya.` : null;
}

/** Why a journal dated `date` with lines on these accounts is refused, or null. */
export async function lockedAccountRefusal(date: Date | string, accountIds: number[], db: Db = prisma): Promise<string | null> {
  if (!accountIds.length) return null;
  const p = await costedPeriodAt(date, db);
  if (!p) return null;
  const hit = await db.accFiscalPeriodLock.findFirst({ where: { period_id: p.id, account_id: { in: accountIds } }, select: { id: true } });
  return hit ? `Periode ${p.period_name} sudah ditutup biayanya (Penutupan Biaya Produksi): account biaya produksi dan Biaya Produksi Dibebankan tidak menerima posting bertanggal di dalamnya.` : null;
}

/** Marks a period costed and locks it for these accounts — the close's last write. */
export async function lockCostedPeriod(tx: Prisma.TransactionClient, periodId: number, accountIds: number[], actorId: number): Promise<void> {
  await tx.accFiscalPeriod.update({ where: { id: periodId }, data: { production_costed_at: new Date(), production_costed_by: actorId } });
  const ids = [...new Set(accountIds)];
  if (ids.length) await tx.accFiscalPeriodLock.createMany({ data: ids.map((account_id) => ({ period_id: periodId, account_id })) });
}
