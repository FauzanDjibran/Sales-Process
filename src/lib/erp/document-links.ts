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
  fin_ar_advance: "/finance/advance/sales",
  fin_ap_advance: "/finance/advance/purchase",
  sal_customer_order: "/sales/customer-order",
  sal_order: "/sales/order",
  sal_delivery_order: "/sales/delivery-order",
  log_delivery_note: "/inventory/delivery-note",
  log_receipt_note: "/inventory/receipt-note",
  // One table, two menus: the Barang page reads any request by id (P123).
  pur_request: "/purchasing/request/goods",
  pur_order: "/purchasing/order/goods",
  fin_ar_invoice: "/finance/invoice/sales",
  fin_ap_invoice: "/finance/invoice/purchase",
  tax_faktur: "/tax/faktur",
  tax_withholding_slip: "/tax/withholding-slip",
};

/** The page a source document is read on, or null when it has none. */
export function documentHref(table: string | null, id: number | null): string | null {
  if (!table || !id) return null;
  const base = ROUTES[table];
  return base ? `${base}/${id}` : null;
}
