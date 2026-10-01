/**
 * Where a document named by its weak `(doc_type, doc_id)` pair is read.
 *
 * A journal points at the document that produced it through that pair rather
 * than a relation (CLAUDE.md §3), so the book never learns another module's
 * routes. The screen that shows the journal does, and asks here — keyed on the
 * document type's `doc_table`, which is stable, never on its label.
 *
 * Client-safe: a map of strings and nothing else.
 */
const ROUTES: Record<string, string> = {
  acc_fiscal_year: "/accounting/fiscal-year",
  acc_opening_balance: "/accounting/opening-balance",
  // Only Penerimaan exists yet; Pengeluaran will need the direction to route.
  fin_cash_bank_tx: "/finance/cash-bank/receipt",
  sal_advance: "/finance/advance/sales",
  sal_customer_order: "/sales/customer-order",
};

/** The page a source document is read on, or null when it has none. */
export function documentHref(table: string | null, id: number | null): string | null {
  if (!table || !id) return null;
  const base = ROUTES[table];
  return base ? `${base}/${id}` : null;
}
