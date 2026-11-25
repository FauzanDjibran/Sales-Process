"use server";

import { isAccessDenied } from "@/lib/erp/auth-errors";
import { authorizeAction } from "@/lib/erp/auth";
import { cashBankEntriesPage, type LedgerEntryRow } from "@/lib/erp/cash-bank";
import { apBookEntriesPage } from "@/lib/erp/ap-item";
import { arBookEntriesPage } from "@/lib/erp/ar-item";
import { attachDocumentNumbers, withAgreementNumbers } from "@/lib/erp/document-numbers";
import type { BookEntry, BookKind, BookSide } from "@/lib/erp/partner-book";
import { productionCardEntriesPage, productionLots, type ProductionCardEntry, type ProductionCardFilter, type ProductionCardKind } from "@/lib/erp/production-report";
import { stockCardEntriesPage, type StockLedgerEntry } from "@/lib/erp/stock-report";
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
  if (!page) return { ok: false, error: "Kas & Bank tidak ditemukan." };
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

/** One page of a Kartu Stok block's movements, read when it is opened. */
export async function loadStockCardEntries(
  filter: { itemIds: number[]; warehouseIds: number[] },
  from: string,
  to: string,
  lotNos: string[],
  cursor: BookCursor | null
): Promise<Page<StockLedgerEntry>> {
  try {
    await authorizeAction("REPORT_STOCK_LEDGER_VIEW");
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, error: error.message };
    throw error;
  }
  const cursorOk = !cursor || (DAY.test(cursor.date) && Number.isInteger(cursor.id));
  const lotsOk = Array.isArray(lotNos) && lotNos.every((l) => typeof l === "string");
  const ints = (v: unknown): v is number[] => Array.isArray(v) && v.every(Number.isInteger);
  if (!ints(filter?.itemIds) || !ints(filter.warehouseIds) || !DAY.test(from) || !DAY.test(to) || !cursorOk || !lotsOk) {
    return { ok: false, error: "Permintaan tidak valid." };
  }
  return { ok: true, ...(await stockCardEntriesPage({ itemIds: filter.itemIds, warehouseIds: filter.warehouseIds }, { from, to }, lotNos, cursor)) };
}

/** One page of a Kartu Produksi block's rows, read when it is opened (P310). */
export async function loadProductionCardEntries(
  kind: ProductionCardKind,
  subjectId: number,
  filter: ProductionCardFilter,
  from: string,
  to: string,
  cursor: BookCursor | null
): Promise<Page<ProductionCardEntry>> {
  try {
    await authorizeAction("REPORT_PRODUCTION_CARD_VIEW");
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, error: error.message };
    throw error;
  }
  const ints = (v: unknown): v is number[] => Array.isArray(v) && v.every(Number.isInteger);
  const cursorOk = !cursor || (DAY.test(cursor.date) && Number.isInteger(cursor.id));
  const filterOk = ints(filter?.unitIds) && ints(filter.itemIds) && ints(filter.lotIds);
  if (!["unit", "item", "lot"].includes(kind) || !Number.isInteger(subjectId) || !filterOk || !DAY.test(from) || !DAY.test(to) || !cursorOk) {
    return { ok: false, error: "Permintaan tidak valid." };
  }
  return { ok: true, ...(await productionCardEntriesPage(kind, subjectId, filter, { from, to }, cursor)) };
}

/** The No. Stok a typed or scanned number names, for Kartu Produksi's filter. */
export async function findProductionLot(no: string): Promise<{ ok: true; no: string } | { ok: false; error: string }> {
  try {
    await authorizeAction("REPORT_PRODUCTION_CARD_VIEW");
  } catch (error) {
    if (isAccessDenied(error)) return { ok: false, error: error.message };
    throw error;
  }
  if (typeof no !== "string" || !no.trim()) return { ok: false, error: "Isi No. Stok." };
  const [lot] = await productionLots([no.trim()]);
  if (!lot) return { ok: false, error: `No. Stok ${no.trim()} tidak ditemukan.` };
  return lot.first ? { ok: true, no: lot.no } : { ok: false, error: `${lot.no} belum pernah di produksi.` };
}
