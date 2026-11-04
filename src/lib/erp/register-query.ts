/**
 * How a report loads a book's entries a page at a time. Pure and client-safe:
 * the page size is what the load-more button states.
 */

export const ENTRY_PAGE_SIZE = 100;

/** Where a page of a book stopped: the last row's place in (day, id) order. */
export type BookCursor = { date: string; id: number };

/** The rows of a book strictly after a cursor, in (day, id) order. */
export function afterBookCursor(cursor: BookCursor | null) {
  if (!cursor) return {};
  const day = new Date(`${cursor.date}T00:00:00Z`);
  return {
    OR: [{ entry_date: { gt: day } }, { entry_date: day, id: { gt: cursor.id } }],
  };
}
