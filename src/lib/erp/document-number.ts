/**
 * The document-number format, in one place.
 *
 * Every document, journal and book entry is numbered `PREFIX/YYYY/MM/NNNN`
 * (Claude-ERP.md P15) — the simulation's format, with one series per prefix
 * per month: `JV/2026/09/0001` is the first journal dated September 2026, and
 * October starts again at `0001`. The month is the document's own date, not
 * the day it was typed, so a backdated document takes its number from the
 * month it belongs to. It is deliberately not the `prefix.0000` system-code
 * shape `nextCode()` produces for master records, so a document number is
 * recognisable on sight (§9).
 *
 * The format lives here; the query stays with the module that owns the table,
 * which is why `nextDocumentNumber` takes a reader rather than a Prisma
 * delegate. A shared helper that reached into every table would be exactly the
 * boundary violation the module contract exists to prevent.
 *
 * Deliberately free of `server-only` and of any database import.
 */

/** A `Date` or a `YYYY-MM-DD` day, as its `YYYY` and `MM` in UTC. */
function yearMonth(date: Date | string): { year: string; month: string } {
  const iso = date instanceof Date ? date.toISOString() : String(date);
  return { year: iso.slice(0, 4), month: iso.slice(5, 7) };
}

/**
 * `JV` + 2026-09-15 -> `JV/2026/09/`, the part every number in that month's
 * series shares. A reader looks up the series' highest number with it.
 */
export function documentSeries(prefix: string, date: Date | string): string {
  const { year, month } = yearMonth(date);
  return `${prefix}/${year}/${month}/`;
}

/** `JV`, 2026-09-15, 1 -> `JV/2026/09/0001`. Padded to four, longer beyond. */
export function formatDocumentNumber(
  prefix: string,
  date: Date | string,
  sequence: number
): string {
  return `${documentSeries(prefix, date)}${String(sequence).padStart(4, "0")}`;
}

/**
 * The numeric tail of a document number, or 0 for anything unreadable.
 *
 * The tail is whatever follows the last `/`, so a prefix is free to be any
 * length without the parse caring.
 */
export function documentSequence(documentNo: string | null | undefined): number {
  if (!documentNo) return 0;
  const slash = documentNo.lastIndexOf("/");
  if (slash < 0) return 0;
  const n = Number(documentNo.slice(slash + 1));
  return Number.isFinite(n) ? n : 0;
}

/**
 * The next number in a month's series.
 *
 * `highest` is handed the series (`JV/2026/09/`) and returns the current
 * highest-numbered document in it, which every caller answers with a single
 * `findFirst` filtered on that prefix and ordered by `id` descending: numbers
 * are assigned as "highest + 1" at insert, so within one series id order and
 * number order are the same, and ordering by the number column itself would go
 * wrong at `10000`.
 *
 * This is not a reservation. Two concurrent callers can read the same highest
 * number, and the second insert then fails on the column's unique constraint
 * rather than silently duplicating — the safe failure, and the reason every
 * document-number column is `@unique`.
 */
export async function nextDocumentNumber(
  prefix: string,
  date: Date | string,
  highest: (series: string) => Promise<string | null>
): Promise<string> {
  const series = documentSeries(prefix, date);
  return formatDocumentNumber(prefix, date, documentSequence(await highest(series)) + 1);
}
