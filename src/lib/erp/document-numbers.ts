import "server-only";

import { cashBankTxNumbersByIds } from "./cash-bank-tx";
import type { LedgerEntryRow } from "./cash-bank";

/**
 * Fills `sourceDocNo` on book-report entries.
 *
 * A book may not name another module's table, so it reports only the weak pair
 * and this file asks the owning module. Keyed by table and id together: ids of
 * two tables overlap, and a number found by id alone would be another
 * document's. Every Cash Bank Book entry but an opening comes from
 * `fin_cash_bank_tx` today; a new source adds its table here.
 */
export async function attachDocumentNumbers(entries: LedgerEntryRow[]): Promise<void> {
  const ids = entries.flatMap((e) =>
    e.sourceDocTable === "fin_cash_bank_tx" && e.sourceDocId ? [e.sourceDocId] : []
  );
  const numbers = await cashBankTxNumbersByIds([...new Set(ids)]);
  for (const e of entries) {
    if (e.sourceDocTable === "fin_cash_bank_tx" && e.sourceDocId) {
      e.sourceDocNo = numbers.get(e.sourceDocId) ?? null;
    }
  }
}
