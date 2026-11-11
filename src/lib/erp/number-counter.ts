import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { documentSequence, documentSeries, formatDocumentNumber } from "./document-number";

/**
 * The next number of a `PREFIX/YYYY/MM/NNNN` series from its counter
 * (`sys_number_counter`), one row per series locked by the update, instead of
 * searching the numbers already written (Workspace plan §4). The first claim of
 * a series starts from `highest`, so a series numbered before its counter
 * carries on. In the caller's transaction: a rolled-back posting gives its
 * number back.
 */
export async function claimDocumentNumber(
  tx: Prisma.TransactionClient,
  prefix: string,
  date: Date | string,
  highest: (series: string) => Promise<string | null>
): Promise<string> {
  const series = documentSeries(prefix, date);
  const known = await tx.sysNumberCounter.findUnique({ where: { series }, select: { id: true } });
  const row = known
    ? await tx.sysNumberCounter.update({ where: { series }, data: { last_no: { increment: 1 } } })
    : await tx.sysNumberCounter.upsert({
        where: { series },
        create: { series, last_no: documentSequence(await highest(series)) + 1 },
        update: { last_no: { increment: 1 } },
      });
  return formatDocumentNumber(prefix, date, row.last_no);
}
