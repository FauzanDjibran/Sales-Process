"use server";

import { isAccessDenied } from "@/lib/erp/auth-errors";
import { authorizeAction } from "@/lib/erp/auth";
import {
  ledgerEntriesPage,
  type LedgerCursor,
  type LedgerEntryPage,
} from "@/lib/erp/ledger";

export type LedgerEntriesResult =
  | ({ ok: true } & LedgerEntryPage)
  | { ok: false; error: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * One page of a General Ledger account's entries, read when the account is
 * opened rather than with the report, under the page's own permission.
 */
export async function loadLedgerEntries(
  accountId: number,
  from: string,
  to: string,
  cursor: LedgerCursor | null,
  partnerIds: number[] = []
): Promise<LedgerEntriesResult> {
  try {
    await authorizeAction("REPORT_GENERAL_LEDGER_VIEW");
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, error: error.message };
    throw error;
  }

  if (!Number.isInteger(accountId) || !DAY.test(from) || !DAY.test(to)) {
    return { ok: false, error: "Permintaan tidak valid." };
  }
  if (!Array.isArray(partnerIds) || !partnerIds.every((id) => Number.isInteger(id))) {
    return { ok: false, error: "Permintaan tidak valid." };
  }
  if (
    cursor &&
    (!DAY.test(cursor.date) || !Number.isInteger(cursor.journalId) || !Number.isInteger(cursor.sequenceNo))
  ) {
    return { ok: false, error: "Permintaan tidak valid." };
  }

  const page = await ledgerEntriesPage(accountId, { from, to }, cursor, partnerIds);
  if (!page) return { ok: false, error: "Account tidak ditemukan." };
  return { ok: true, ...page };
}
