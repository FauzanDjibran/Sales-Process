import "server-only";

import { cashBankTxNumbersByIds } from "./cash-bank-tx";
import { customerOrderNumbersByIds } from "./customer-order";
import { permitRequestNumbersByIds } from "./permit-request";
import { purchaseOrderNumbersByIds } from "./purchase-order";
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

type Agreement = { scopeTable: string | null; scopeId: number | null };

/** Each AR / AP item's agreement number by `table:id`: a Customer Order, a Pengajuan Perizinan or a Purchase Order. */
export async function agreementNumbers(rows: Agreement[]): Promise<Record<string, string>> {
  const ids = (table: string) => [...new Set(rows.filter((r) => r.scopeTable === table && r.scopeId).map((r) => r.scopeId!))];
  const tables = [
    ["sal_customer_order", customerOrderNumbersByIds],
    ["sal_permit_request", permitRequestNumbersByIds],
    ["pur_order", purchaseOrderNumbersByIds],
  ] as const;
  const found = await Promise.all(tables.map(async ([table, read]) => [table, await read(ids(table))] as const));
  return Object.fromEntries(found.flatMap(([table, numbers]) => [...numbers].map(([id, no]) => [`${table}:${id}`, no] as const)));
}

export async function withAgreementNumbers<T extends Agreement>(rows: T[]): Promise<(T & { agreementNo: string | null })[]> {
  const numbers = await agreementNumbers(rows);
  return rows.map((r) => ({ ...r, agreementNo: numbers[`${r.scopeTable}:${r.scopeId}`] ?? null }));
}
