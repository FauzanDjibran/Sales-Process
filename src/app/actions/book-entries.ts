"use server";

import { isAccessDenied } from "@/lib/erp/auth-errors";
import { authorizeAction } from "@/lib/erp/auth";
import { cashBankEntriesPage, type LedgerEntryRow } from "@/lib/erp/cash-bank";
import { apBookEntriesPage } from "@/lib/erp/ap-item";
import { arBookEntriesPage } from "@/lib/erp/ar-item";
import { attachDocumentNumbers, withAgreementNumbers } from "@/lib/erp/document-numbers";
import type { BookEntry, BookKind, BookSide } from "@/lib/erp/partner-book";
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

/** One page of a partner's entries in Buku Piutang / Hutang, read when its block is opened (P233). */
export async function loadPartnerBookEntries(
  side: BookSide,
  book: BookKind,
  partnerId: number,
  from: string,
  to: string,
  cursor: BookCursor | null
): Promise<Page<BookEntry>> {
  try {
    await authorizeAction(side === "ar" ? "REPORT_AR_LEDGER_VIEW" : "REPORT_AP_LEDGER_VIEW");
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, error: error.message };
    throw error;
  }
  const cursorOk = !cursor || (DAY.test(cursor.date) && Number.isInteger(cursor.id));
  if (!Number.isInteger(partnerId) || !["Invoice", "Advance"].includes(book) || !DAY.test(from) || !DAY.test(to) || !cursorOk) {
    return { ok: false, error: "Permintaan tidak valid." };
  }
  const page = await (side === "ar" ? arBookEntriesPage : apBookEntriesPage)(book, partnerId, { from, to }, cursor);
  return { ok: true, entries: await withAgreementNumbers(page.entries), next: page.next };
}
