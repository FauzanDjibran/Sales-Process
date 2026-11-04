import "server-only";

import { prisma } from "@/lib/prisma";
import { accountNetMovements } from "./ledger";
import { costPoolAccountIds } from "./production-cost";
import { hasProductionMovement } from "./production-ledger";

/**
 * What is left of the production close until Closing Costing Produksi is built
 * (`Produksi Walet (Real).md` §10, step 10): the year-end guard of R28.
 */

/** A period with a production movement or a cost on a Jenis Biaya account — one the year may not close without (R28). */
async function hasProductionActivity(from: Date, to: Date): Promise<boolean> {
  const [moved, nets] = await Promise.all([hasProductionMovement(from, to), costPoolAccountIds().then((ids) => accountNetMovements(ids, from, to))]);
  return moved || [...nets.values()].some((a) => a !== 0);
}

/**
 * Why a fiscal year may not close (R28): a period of it with production or
 * cost activity is not costed. Composed by the year-end closing's caller.
 */
export async function uncostedPeriodRefusal(fiscalYearId: number): Promise<string | null> {
  const periods = await prisma.accFiscalPeriod.findMany({ where: { fiscal_year_id: fiscalYearId, production_costed_at: null }, orderBy: { start_date: "asc" } });
  for (const p of periods) {
    if (await hasProductionActivity(p.start_date, p.end_date)) return `Periode ${p.period_name} belum ditutup biayanya (Closing Costing Produksi).`;
  }
  return null;
}
