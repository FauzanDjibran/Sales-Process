"use server";

import { isAccessDenied } from "@/lib/erp/auth-errors";
import { authorizeAction } from "@/lib/erp/auth";
import { cashBankEntriesPage, type LedgerEntryRow } from "@/lib/erp/cash-bank";
import { attachDocumentNumbers } from "@/lib/erp/document-numbers";
import type { BookCursor } from "@/lib/erp/register-query";

type Page<T> = { ok: true; entries: T[]; next: BookCursor | null } | { ok: false; error: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** One page of a Cash & Bank's entries, read when its block is opened. */
export async function loadCashBankEntries(
  cashBankId: number,
  from: string,
  to: string,
  cursor: BookCursor | null
): Promise<Page<LedgerEntryRow>> {
  try {
    await authorizeAction("REPORT_CASH_BANK_LEDGER_VIEW");
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, error: error.message };
    throw error;
  }
  const cursorOk = !cursor || (DAY.test(cursor.date) && Number.isInteger(cursor.id));
  if (!Number.isInteger(cashBankId) || !DAY.test(from) || !DAY.test(to) || !cursorOk) {
    return { ok: false, error: "Permintaan tidak valid." };
  }

  const page = await cashBankEntriesPage(cashBankId, { from, to }, cursor);
  if (!page) return { ok: false, error: "Cash & Bank tidak ditemukan." };
  await attachDocumentNumbers(page.entries);
  return { ok: true, ...page };
}
