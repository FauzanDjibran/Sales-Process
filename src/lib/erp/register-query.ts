/**
 * What a register is asked for, carried in the URL: `?page=&size=&q=&status=`,
 * and how a report loads a book's entries a page at a time.
 *
 * A register that grows with use is paged, searched and filtered by the
 * database, so a page costs the same however many documents exist. The URL is
 * the state — a link names a queue (`?status=Draft`), the back button works, and
 * the page stays a Server Component. Client-safe, so the route that parses it
 * and the list that writes it agree on one shape.
 */

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export type RegisterQuery = {
  page: number;
  size: number;
  /** Free-text search, trimmed; empty means none. */
  q: string;
  /** One status, or empty for all. */
  status: string;
};

type Params = Record<string, string | string[] | undefined>;

export const oneParam = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/**
 * Reads the register's parameters, ignoring anything it does not recognise.
 * `statuses` is the set the register offers: a `?status=` outside it reads as
 * "all", so a stale link never produces an empty page that looks like no data.
 */
export function parseRegisterQuery(params: Params, statuses?: readonly string[]): RegisterQuery {
  const page = Number(oneParam(params.page));
  const size = Number(oneParam(params.size));
  const status = oneParam(params.status) ?? "";
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    size: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
    q: (oneParam(params.q) ?? "").trim().slice(0, 100),
    status: !statuses || statuses.includes(status) ? status : "",
  };
}

/** One page of a register, and what the footer needs to describe it. */
export type Paged<T> = {
  rows: T[];
  /** Rows matching the query. */
  total: number;
  /** Rows the register holds before any search or status filter. */
  all: number;
  /** The page actually shown — the one asked for, clamped to what exists. */
  page: number;
  pages: number;
  size: number;
};

/** The skip/take for a query over `total` rows, with the page clamped. */
export function windowOf(total: number, query: Pick<RegisterQuery, "page" | "size">) {
  const pages = Math.max(1, Math.ceil(total / query.size));
  const page = Math.min(query.page, pages);
  return { page, pages, skip: (page - 1) * query.size, take: query.size };
}

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
