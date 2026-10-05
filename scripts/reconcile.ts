/**
 * `npm run db:reconcile` — proves the books and the documents agree, on the
 * data that actually exists (knowledge base `accounting/books-and-posting` §6).
 *
 * **Read-only by construction**: every check runs inside one `READ ONLY`
 * transaction, so the database refuses a write. Safe against local or deployed
 * data (`npm run db:neon-reconcile`).
 *
 * **Each check selects only the rows that disagree**; an empty result is a
 * pass. The command prints every check, lists the first disagreeing rows of
 * any that fail, and exits 1 if one did.
 *
 * What it proves, along the order-to-cash flow (`Sales-Process-Concept.md`):
 *   journal    every posted journal balances; every posted document has its
 *              journal and only posted ones do; each journal carries its
 *              document's figure
 *   cash       one Cash Bank Book entry per posted receipt at its cash; the
 *              balance rows equal their entries; each resource equals its GL
 *              account
 *   ar         every item's balance and running balance equal its entries;
 *              Uang Muka and Invoice items equal their GL accounts per customer;
 *              each posted receipt, invoice and deduction wrote its entry
 *   goods      delivered quantity on every order line equals what posted notes
 *              took, level by level; no level holds more than its parent; a
 *              fully delivered order is closed; a note's cost equals its lines,
 *              picks and stock issues
 *   billing    a note line is billed once; an invoice equals its lines and
 *              deductions; a fully billed order line is billed exactly
 *   tax        each posted taxable event made its faktur, each PPh row its slip,
 *              at the same figures; PPN Keluaran and PPh Dibayar Dimuka in the
 *              GL equal the tax records
 *   advance    no bill is paid beyond its total; a cancelled bill has no payment
 *
 * **Left out on purpose:** a Cash & Bank resource's Saldo Awal written at
 * registration is in the Cash Bank Book and the Opening Balance, not a posted
 * journal, so the resource-vs-GL check counts only entries a journal stands
 * behind (`entry_type <> 'Opening'`) against journal lines. Manual journals on
 * PPN Keluaran or PPh Dibayar Dimuka would show as a difference in the tax
 * checks — which is the point: they move a tax account with no tax record.
 */
import { prisma } from "../src/lib/prisma";
import type { Prisma } from "../src/generated/prisma/client";

type Check = { area: string; name: string; sql: string };

/** Accounts from Account Mapping, by key; `-1` matches nothing when unset. */
const acc = (key: string) =>
  `COALESCE((SELECT NULLIF(setting_value, '')::int FROM sys_setting WHERE setting_key = '${key}'), -1)`;
const docType = (table: string) => `(SELECT id FROM sys_doc_type WHERE doc_table = '${table}')`;
/** Σ debit − kredit on one account, per partner, from posted journals. */
const glByPartner = (account: string) => `
  SELECT l.partner_id, SUM(l.debit_amount - l.kredit_amount) AS bal
  FROM acc_journal_line l JOIN acc_journal j ON j.id = l.journal_id AND j.status = 'Posted'
  WHERE l.account_id = ${account} GROUP BY l.partner_id`;

export const CHECKS: Check[] = [
  // ------------------------------------------------------------- journal
  {
    area: "journal",
    name: "every posted journal balances",
    sql: `SELECT j.journal_no, SUM(l.debit_amount) AS debit, SUM(l.kredit_amount) AS kredit
          FROM acc_journal j JOIN acc_journal_line l ON l.journal_id = j.id
          WHERE j.status = 'Posted' GROUP BY j.id, j.journal_no HAVING SUM(l.debit_amount) <> SUM(l.kredit_amount)`,
  },
  {
    area: "journal",
    name: "every posted receipt, note and invoice has a posted journal naming it; no other has one",
    sql: `SELECT 'receipt' AS kind, t.tx_no AS doc, t.status::text, t.journal_id FROM fin_cash_bank_tx t
            LEFT JOIN acc_journal j ON j.id = t.journal_id
          WHERE (t.status = 'Posted' AND (j.id IS NULL OR j.status <> 'Posted' OR j.source_doc_type_id <> ${docType("fin_cash_bank_tx")} OR j.source_doc_id <> t.id))
             OR (t.status <> 'Posted' AND t.journal_id IS NOT NULL)
          UNION ALL
          SELECT 'delivery note', n.dn_no, n.status::text, n.journal_id FROM sal_delivery_note n
            LEFT JOIN acc_journal j ON j.id = n.journal_id
          WHERE (n.status = 'Posted' AND n.cost_amount > 0 AND (j.id IS NULL OR j.status <> 'Posted' OR j.source_doc_type_id <> ${docType("sal_delivery_note")} OR j.source_doc_id <> n.id))
             OR (n.status <> 'Posted' AND n.journal_id IS NOT NULL)
          UNION ALL
          SELECT 'invoice', v.invoice_no, v.status::text, v.journal_id FROM sal_invoice v
            LEFT JOIN acc_journal j ON j.id = v.journal_id
          WHERE (v.status = 'Posted' AND (j.id IS NULL OR j.status <> 'Posted' OR j.source_doc_type_id <> ${docType("sal_invoice")} OR j.source_doc_id <> v.id))
             OR (v.status <> 'Posted' AND v.journal_id IS NOT NULL)`,
  },
  {
    area: "journal",
    name: "each journal carries its document's figure",
    sql: `SELECT 'receipt' AS kind, t.tx_no AS doc, t.settled_amount AS expected, SUM(l.debit_amount) AS journal_debit
          FROM fin_cash_bank_tx t JOIN acc_journal_line l ON l.journal_id = t.journal_id
          WHERE t.status = 'Posted' GROUP BY t.id HAVING SUM(l.debit_amount) <> t.settled_amount
          UNION ALL
          SELECT 'delivery note', n.dn_no, n.cost_amount, SUM(l.debit_amount)
          FROM sal_delivery_note n JOIN acc_journal_line l ON l.journal_id = n.journal_id
          WHERE n.status = 'Posted' GROUP BY n.id HAVING SUM(l.debit_amount) <> n.cost_amount
          UNION ALL
          SELECT 'invoice', v.invoice_no, v.dpp_amount + v.ppn_amount, SUM(l.kredit_amount)
          FROM sal_invoice v JOIN acc_journal_line l ON l.journal_id = v.journal_id
          WHERE v.status = 'Posted' GROUP BY v.id HAVING SUM(l.kredit_amount) <> v.dpp_amount + v.ppn_amount`,
  },
  // ---------------------------------------------------------------- cash
  {
    area: "cash",
    name: "one Cash Bank Book entry per posted receipt, at its cash, into its resource",
    sql: `SELECT t.tx_no, t.cash_amount, COUNT(e.id) AS entries, SUM(e.amount) AS booked
          FROM fin_cash_bank_tx t
          LEFT JOIN cash_bank_ledger e ON e.source_doc_type_id = ${docType("fin_cash_bank_tx")} AND e.source_doc_id = t.id
            AND e.cash_bank_id = t.cash_bank_id AND e.direction = t.direction
          WHERE t.status = 'Posted' GROUP BY t.id HAVING COUNT(e.id) <> 1 OR SUM(e.amount) <> t.cash_amount`,
  },
  {
    area: "cash",
    name: "each Cash Bank balance row equals its entries",
    sql: `SELECT b.cash_bank_id, b.balance, b.base_balance, COALESCE(SUM(e.movement), 0) AS entries, COALESCE(SUM(e.base_movement), 0) AS base_entries
          FROM cash_bank_balance b LEFT JOIN cash_bank_ledger e ON e.cash_bank_id = b.cash_bank_id
          GROUP BY b.cash_bank_id, b.balance, b.base_balance
          HAVING b.balance <> COALESCE(SUM(e.movement), 0) OR b.base_balance <> COALESCE(SUM(e.base_movement), 0)`,
  },
  {
    area: "cash",
    name: "each resource's journalled entries equal its GL account",
    sql: `SELECT c.cash_bank_label, book.base AS book, COALESCE(gl.bal, 0) AS gl
          FROM m_cash_bank c
          JOIN (SELECT cash_bank_id, SUM(base_movement) AS base FROM cash_bank_ledger WHERE entry_type <> 'Opening' GROUP BY cash_bank_id) book ON book.cash_bank_id = c.id
          LEFT JOIN (SELECT l.account_id, SUM(l.debit_amount - l.kredit_amount) AS bal FROM acc_journal_line l
                     JOIN acc_journal j ON j.id = l.journal_id AND j.status = 'Posted' AND j.is_manual = false
                     GROUP BY l.account_id) gl ON gl.account_id = c.account_id
          WHERE book.base <> COALESCE(gl.bal, 0)`,
  },
  // ------------------------------------------------------------------ ar
  {
    area: "ar",
    name: "every AR item's balance equals its entries, and each entry's running balance follows",
    sql: `SELECT i.ar_item_no, i.current_balance, SUM(e.movement) AS entries FROM fin_ar_item i
            JOIN fin_ar_ledger e ON e.item_id = i.id GROUP BY i.id HAVING i.current_balance <> SUM(e.movement)
          UNION ALL
          SELECT x.ar_item_no, x.balance_after, x.running FROM (
            SELECT i.ar_item_no, e.balance_after, SUM(e.movement) OVER (PARTITION BY e.item_id ORDER BY e.id) AS running
            FROM fin_ar_ledger e JOIN fin_ar_item i ON i.id = e.item_id) x WHERE x.balance_after <> x.running`,
  },
  {
    area: "ar",
    name: "Uang Muka items equal the Uang Muka Penjualan account, per customer",
    sql: `SELECT p.partner_label, COALESCE(items.bal, 0) AS items, COALESCE(-gl.bal, 0) AS gl FROM m_partner p
          LEFT JOIN (SELECT partner_id, SUM(current_balance) AS bal FROM fin_ar_item WHERE item_type = 'Advance' GROUP BY partner_id) items ON items.partner_id = p.id
          LEFT JOIN (${glByPartner(acc("sales_advance_account"))}) gl ON gl.partner_id = p.id
          WHERE COALESCE(items.bal, 0) <> COALESCE(-gl.bal, 0)`,
  },
  {
    area: "ar",
    name: "Invoice items equal the Piutang Usaha account, per customer",
    sql: `SELECT p.partner_label, COALESCE(items.bal, 0) AS items, COALESCE(gl.bal, 0) AS gl FROM m_partner p
          LEFT JOIN (SELECT partner_id, SUM(current_balance) AS bal FROM fin_ar_item WHERE item_type = 'Invoice' GROUP BY partner_id) items ON items.partner_id = p.id
          LEFT JOIN (${glByPartner(acc("receivable_account"))}) gl ON gl.partner_id = p.id
          WHERE COALESCE(items.bal, 0) <> COALESCE(gl.bal, 0)`,
  },
  {
    area: "ar",
    name: "each posted receipt's advance line made one Uang Muka item at its DPP part",
    sql: `SELECT t.tx_no, l.doc_id AS bill_id, l.dpp_part, COUNT(e.id) AS items, SUM(e.amount) AS amount
          FROM fin_cash_bank_tx t JOIN fin_cash_bank_tx_line l ON l.tx_id = t.id AND l.doc_type_id = ${docType("sal_advance")}
          LEFT JOIN fin_ar_ledger e ON e.event = 'Create' AND e.doc_type_id = ${docType("fin_cash_bank_tx")} AND e.doc_id = t.id
          LEFT JOIN fin_ar_item i ON i.id = e.item_id AND i.item_type = 'Advance' AND i.source_doc_type_id = l.doc_type_id AND i.source_doc_id = l.doc_id
          WHERE t.status = 'Posted' AND l.dpp_part > 0 AND (i.id IS NOT NULL OR e.id IS NULL)
          GROUP BY t.id, l.id HAVING COUNT(i.id) <> 1 OR SUM(CASE WHEN i.id IS NOT NULL THEN e.amount END) <> l.dpp_part`,
  },
  {
    area: "ar",
    name: "each posted receipt's invoice line wrote one Pembayaran on the invoice's item",
    sql: `SELECT t.tx_no, v.invoice_no, l.settled_amount, COUNT(e.id) AS entries, SUM(e.amount) AS paid
          FROM fin_cash_bank_tx t JOIN fin_cash_bank_tx_line l ON l.tx_id = t.id AND l.doc_type_id = ${docType("sal_invoice")}
          JOIN sal_invoice v ON v.id = l.doc_id
          LEFT JOIN fin_ar_ledger e ON e.item_id = v.ar_item_id AND e.event = 'Payment' AND e.doc_type_id = ${docType("fin_cash_bank_tx")} AND e.doc_id = t.id
          WHERE t.status = 'Posted' GROUP BY t.id, l.id, v.invoice_no HAVING COUNT(e.id) <> 1 OR SUM(e.amount) <> l.settled_amount`,
  },
  {
    area: "ar",
    name: "each posted invoice has its Invoice item at net Piutang (none when nothing is left to pay)",
    sql: `SELECT v.invoice_no, v.total_amount, i.ar_item_no, i.item_type::text, e.amount AS created
          FROM sal_invoice v
          LEFT JOIN fin_ar_item i ON i.id = v.ar_item_id
          LEFT JOIN fin_ar_ledger e ON e.item_id = i.id AND e.event = 'Create'
          WHERE v.status = 'Posted' AND (
            (v.total_amount > 0 AND (i.id IS NULL OR i.item_type <> 'Invoice' OR i.source_doc_type_id <> ${docType("sal_invoice")} OR i.source_doc_id <> v.id OR e.amount <> v.total_amount))
            OR (v.total_amount = 0 AND v.ar_item_id IS NOT NULL))`,
  },
  {
    area: "ar",
    name: "each posted invoice's deduction wrote one Dipakai Invoice on its Uang Muka item",
    sql: `SELECT v.invoice_no, d.ar_item_no, d.dpp_used, COUNT(e.id) AS entries, SUM(e.amount) AS used
          FROM sal_invoice v JOIN sal_invoice_advance_deduction d ON d.invoice_id = v.id
          LEFT JOIN fin_ar_ledger e ON e.item_id = d.ar_item_id AND e.event = 'AdvanceUsed' AND e.doc_type_id = ${docType("sal_invoice")} AND e.doc_id = v.id
            AND e.counter_item_id IS NOT DISTINCT FROM v.ar_item_id
          WHERE v.status = 'Posted' GROUP BY v.id, d.id HAVING COUNT(e.id) <> 1 OR SUM(e.amount) <> d.dpp_used`,
  },
  {
    area: "ar",
    name: "no AR entry comes from a receipt or invoice that is not posted",
    sql: `SELECT e.id, e.doc_no, e.event::text FROM fin_ar_ledger e
          LEFT JOIN fin_cash_bank_tx t ON e.doc_type_id = ${docType("fin_cash_bank_tx")} AND t.id = e.doc_id
          LEFT JOIN sal_invoice v ON e.doc_type_id = ${docType("sal_invoice")} AND v.id = e.doc_id
          WHERE (t.id IS NOT NULL AND t.status <> 'Posted') OR (v.id IS NOT NULL AND v.status <> 'Posted')`,
  },
  // --------------------------------------------------------------- goods
  {
    area: "goods",
    name: "delivered quantity on every order line equals what posted notes took, level by level",
    sql: `SELECT 'delivery order line' AS level, dol.id, dol.delivered_qty AS stored, COALESCE(SUM(nl.qty) FILTER (WHERE n.status = 'Posted'), 0) AS from_children
          FROM sal_delivery_order_line dol LEFT JOIN sal_delivery_note_line nl ON nl.delivery_order_line_id = dol.id
          LEFT JOIN sal_delivery_note n ON n.id = nl.delivery_note_id
          GROUP BY dol.id HAVING dol.delivered_qty <> COALESCE(SUM(nl.qty) FILTER (WHERE n.status = 'Posted'), 0)
          UNION ALL
          SELECT 'sales order line', sol.id, sol.delivered_qty, COALESCE(SUM(dol.delivered_qty), 0)
          FROM sal_order_line sol LEFT JOIN sal_delivery_order_line dol ON dol.sales_order_line_id = sol.id
          GROUP BY sol.id HAVING sol.delivered_qty <> COALESCE(SUM(dol.delivered_qty), 0)
          UNION ALL
          SELECT 'customer order line', col.id, col.delivered_qty, COALESCE(SUM(sol.delivered_qty), 0)
          FROM sal_customer_order_line col LEFT JOIN sal_order_line sol ON sol.customer_order_line_id = col.id
          GROUP BY col.id HAVING col.delivered_qty <> COALESCE(SUM(sol.delivered_qty), 0)`,
  },
  {
    area: "goods",
    name: "no level holds more than its parent line (a closed child counts what it delivered)",
    sql: `SELECT 'sales orders on customer order line' AS level, col.id, col.qty AS parent, SUM(CASE WHEN so.status = 'Closed' THEN sol.delivered_qty ELSE sol.qty END) AS held
          FROM sal_customer_order_line col JOIN sal_order_line sol ON sol.customer_order_line_id = col.id
          JOIN sal_order so ON so.id = sol.order_id AND so.status NOT IN ('Cancelled', 'Rejected')
          GROUP BY col.id HAVING SUM(CASE WHEN so.status = 'Closed' THEN sol.delivered_qty ELSE sol.qty END) > col.qty
          UNION ALL
          SELECT 'delivery orders on sales order line', sol.id, sol.qty, SUM(CASE WHEN d.status = 'Closed' THEN dol.delivered_qty ELSE dol.qty END)
          FROM sal_order_line sol JOIN sal_delivery_order_line dol ON dol.sales_order_line_id = sol.id
          JOIN sal_delivery_order d ON d.id = dol.delivery_order_id AND d.status <> 'Cancelled'
          GROUP BY sol.id HAVING SUM(CASE WHEN d.status = 'Closed' THEN dol.delivered_qty ELSE dol.qty END) > sol.qty
          UNION ALL
          SELECT 'delivery notes on delivery order line', dol.id, dol.qty, SUM(nl.qty)
          FROM sal_delivery_order_line dol JOIN sal_delivery_note_line nl ON nl.delivery_order_line_id = dol.id
          JOIN sal_delivery_note n ON n.id = nl.delivery_note_id AND n.status <> 'Cancelled'
          GROUP BY dol.id HAVING SUM(nl.qty) > dol.qty`,
  },
  {
    area: "goods",
    name: "a fully delivered order is closed",
    sql: `SELECT 'delivery order' AS kind, d.do_no AS doc, d.status::text FROM sal_delivery_order d
          WHERE d.status = 'Issued' AND NOT EXISTS (SELECT 1 FROM sal_delivery_order_line l WHERE l.delivery_order_id = d.id AND l.delivered_qty < l.qty)
          UNION ALL
          SELECT 'sales order', s.order_no, s.status::text FROM sal_order s
          WHERE s.status IN ('PreSO', 'Open') AND NOT EXISTS (SELECT 1 FROM sal_order_line l WHERE l.order_id = s.id AND l.delivered_qty < l.qty)
          UNION ALL
          SELECT 'customer order', c.order_no, c.status::text FROM sal_customer_order c
          WHERE c.status = 'Open' AND NOT EXISTS (SELECT 1 FROM sal_customer_order_line l WHERE l.order_id = c.id AND l.delivered_qty < l.qty)`,
  },
  {
    area: "goods",
    name: "a posted note's cost equals its lines, its picks and its stock issues",
    sql: `SELECT n.dn_no, n.cost_amount, (SELECT SUM(cost_amount) FROM sal_delivery_note_line WHERE delivery_note_id = n.id) AS lines,
                 (SELECT SUM(cost_amount) FROM tmp_stock_movement WHERE source_doc_type_id = ${docType("sal_delivery_note")} AND source_doc_id = n.id) AS issued
          FROM sal_delivery_note n WHERE n.status = 'Posted' AND (
            n.cost_amount <> COALESCE((SELECT SUM(cost_amount) FROM sal_delivery_note_line WHERE delivery_note_id = n.id), 0)
            OR n.cost_amount <> COALESCE((SELECT SUM(cost_amount) FROM tmp_stock_movement WHERE source_doc_type_id = ${docType("sal_delivery_note")} AND source_doc_id = n.id), 0))
          UNION ALL
          SELECT n.dn_no, l.cost_amount, SUM(p.cost_amount), SUM(p.qty) - l.qty
          FROM sal_delivery_note n JOIN sal_delivery_note_line l ON l.delivery_note_id = n.id JOIN sal_delivery_note_pick p ON p.delivery_note_line_id = l.id
          WHERE n.status = 'Posted' GROUP BY n.dn_no, l.id HAVING l.cost_amount <> SUM(p.cost_amount) OR SUM(p.qty) <> l.qty`,
  },
  {
    area: "goods",
    name: "a posted note's lot-controlled lines left by lot",
    sql: `SELECT n.dn_no, l.id AS line, m.item_label FROM sal_delivery_note n
          JOIN sal_delivery_note_line l ON l.delivery_note_id = n.id
          JOIN sal_delivery_order_line dol ON dol.id = l.delivery_order_line_id
          JOIN sal_order_line sol ON sol.id = dol.sales_order_line_id
          JOIN sal_customer_order_line col ON col.id = sol.customer_order_line_id
          JOIN m_item m ON m.id = col.item_id AND m.item_type = 'Barang' AND m.track_stock = true
          WHERE n.status = 'Posted' AND NOT EXISTS (SELECT 1 FROM sal_delivery_note_pick p WHERE p.delivery_note_line_id = l.id)`,
  },
  // ------------------------------------------------------------- billing
  {
    area: "billing",
    name: "a note line is billed by at most one live invoice, of its own order, once the note is posted",
    sql: `SELECT nl.id AS note_line, COUNT(*) AS invoices, MIN(v.invoice_no) AS first FROM sal_invoice_line il
          JOIN sal_invoice v ON v.id = il.invoice_id AND v.status <> 'Cancelled'
          JOIN sal_delivery_note_line nl ON nl.id = il.delivery_note_line_id
          GROUP BY nl.id HAVING COUNT(*) > 1
          UNION ALL
          SELECT nl.id, 0, v.invoice_no FROM sal_invoice_line il
          JOIN sal_invoice v ON v.id = il.invoice_id AND v.status <> 'Cancelled'
          JOIN sal_delivery_note_line nl ON nl.id = il.delivery_note_line_id
          JOIN sal_delivery_note n ON n.id = nl.delivery_note_id
          WHERE n.status <> 'Posted' OR n.customer_order_id <> v.customer_order_id OR il.qty <> nl.qty`,
  },
  {
    area: "billing",
    name: "an invoice equals its lines and its deductions",
    sql: `SELECT v.invoice_no, v.dpp_amount, SUM(l.dpp_amount) AS lines_dpp, v.ppn_amount, SUM(l.ppn_amount) AS lines_ppn, v.total_amount
          FROM sal_invoice v JOIN sal_invoice_line l ON l.invoice_id = v.id
          WHERE v.status <> 'Cancelled'
          GROUP BY v.id HAVING v.dpp_amount <> SUM(l.dpp_amount) OR v.ppn_amount <> SUM(l.ppn_amount)
            OR v.advance_dpp_amount <> SUM(l.advance_dpp_amount) OR v.net_dpp_amount <> SUM(l.net_dpp_amount)
            OR v.dpp_other_amount <> SUM(l.dpp_other_amount) OR v.total_amount <> v.net_dpp_amount + v.ppn_amount
            OR v.advance_dpp_amount <> COALESCE((SELECT SUM(dpp_used) FROM sal_invoice_advance_deduction d WHERE d.invoice_id = v.id), 0)`,
  },
  {
    area: "billing",
    name: "an invoice uses only its own order's Uang Muka",
    sql: `SELECT v.invoice_no, d.ar_item_no, i.customer_order_id AS item_order, v.customer_order_id AS invoice_order
          FROM sal_invoice v JOIN sal_invoice_advance_deduction d ON d.invoice_id = v.id
          JOIN fin_ar_item i ON i.id = d.ar_item_id
          WHERE v.status <> 'Cancelled' AND (i.item_type <> 'Advance' OR i.customer_order_id IS DISTINCT FROM v.customer_order_id OR i.partner_id <> v.customer_id)`,
  },
  {
    area: "billing",
    name: "a fully billed order line is billed at exactly its amount",
    sql: `SELECT col.id AS order_line, col.amount, SUM(il.amount) AS billed FROM sal_customer_order_line col
          JOIN sal_invoice_line il ON il.customer_order_line_id = col.id
          JOIN sal_invoice v ON v.id = il.invoice_id AND v.status = 'Posted'
          GROUP BY col.id HAVING SUM(il.qty) = col.qty AND SUM(il.amount) <> col.amount`,
  },
  // ----------------------------------------------------------------- tax
  {
    area: "tax",
    name: "each posted advance line with PPN made one Faktur Uang Muka at its DPP and PPN",
    sql: `SELECT t.tx_no, l.doc_id AS bill_id, l.dpp_part, l.ppn_part, COUNT(f.id) AS fakturs, MIN(f.dpp) AS dpp, MIN(f.ppn) AS ppn
          FROM fin_cash_bank_tx t JOIN fin_cash_bank_tx_line l ON l.tx_id = t.id AND l.doc_type_id = ${docType("sal_advance")}
          LEFT JOIN tax_faktur f ON f.kind = 'Advance' AND f.source_doc_type_id = ${docType("fin_cash_bank_tx")} AND f.source_doc_id = t.id
            AND f.ref_doc_type_id = l.doc_type_id AND f.ref_doc_id = l.doc_id
          WHERE t.status = 'Posted' AND l.ppn_part > 0
          GROUP BY t.id, l.id HAVING COUNT(f.id) <> 1 OR MIN(f.dpp) <> l.dpp_part OR MIN(f.ppn) <> l.ppn_part`,
  },
  {
    area: "tax",
    name: "each posted taxable invoice made one faktur at its net DPP and PPN, deducting its advances' fakturs",
    sql: `SELECT v.invoice_no, v.net_dpp_amount, v.ppn_amount, COUNT(f.id) AS fakturs, MIN(f.kind::text) AS kind, MIN(f.dpp) AS dpp, MIN(f.ppn) AS ppn,
                 (SELECT SUM(r.dpp_deducted) FROM tax_faktur_ref r JOIN tax_faktur ff ON ff.id = r.faktur_id
                  WHERE ff.source_doc_type_id = ${docType("sal_invoice")} AND ff.source_doc_id = v.id) AS deducted
          FROM sal_invoice v
          LEFT JOIN tax_faktur f ON f.source_doc_type_id = ${docType("sal_invoice")} AND f.source_doc_id = v.id
          WHERE v.status = 'Posted' AND v.is_taxable AND v.net_dpp_amount > 0
          GROUP BY v.id
          HAVING COUNT(f.id) <> 1 OR MIN(f.dpp) <> v.net_dpp_amount OR MIN(f.ppn) <> v.ppn_amount
             OR MIN(f.kind::text) <> CASE WHEN v.advance_dpp_amount > 0 THEN 'Settlement' ELSE 'Normal' END
             OR COALESCE((SELECT SUM(r.dpp_deducted) FROM tax_faktur_ref r JOIN tax_faktur ff ON ff.id = r.faktur_id
                          WHERE ff.source_doc_type_id = ${docType("sal_invoice")} AND ff.source_doc_id = v.id), 0) <> v.advance_dpp_amount`,
  },
  {
    area: "tax",
    name: "each PPh row of a posted receipt made one Bukti Potong at the same figures",
    sql: `SELECT t.tx_no, w.id AS pph_row, w.amount, s.slip_no, s.amount AS slip_amount
          FROM fin_cash_bank_tx t JOIN fin_cash_bank_tx_line l ON l.tx_id = t.id JOIN fin_cash_bank_tx_line_wht w ON w.line_id = l.id
          LEFT JOIN tax_withholding_slip s ON s.receipt_line_wht_id = w.id
          WHERE t.status = 'Posted' AND (s.id IS NULL OR s.amount <> w.amount OR s.base_amount <> w.base_amount OR s.withholding_tax_id <> w.withholding_tax_id OR s.receipt_id <> t.id)`,
  },
  {
    area: "tax",
    name: "PPN Keluaran in the General Ledger equals the fakturs",
    sql: `SELECT gl.bal AS gl, f.ppn AS fakturs FROM
            (SELECT COALESCE(SUM(l.kredit_amount - l.debit_amount), 0) AS bal FROM acc_journal_line l
             JOIN acc_journal j ON j.id = l.journal_id AND j.status = 'Posted' WHERE l.account_id = ${acc("output_vat_account")}) gl,
            (SELECT COALESCE(SUM(ppn), 0) AS ppn FROM tax_faktur) f
          WHERE gl.bal <> f.ppn`,
  },
  {
    area: "tax",
    // Per account, not per Jenis PPh: several Jenis PPh may share one PPh
    // Dibayar Dimuka account (PPH23 and PPH23-15 often do).
    name: "PPh Dibayar Dimuka in the General Ledger equals the Bukti Potong, per account",
    sql: `SELECT a.account_label, COALESCE(gl.bal, 0) AS gl, COALESCE(s.amount, 0) AS slips
          FROM (SELECT DISTINCT prepaid_account_id AS account_id FROM ref_withholding_tax WHERE prepaid_account_id IS NOT NULL) x
          JOIN acc_account a ON a.id = x.account_id
          LEFT JOIN (SELECT l.account_id, SUM(l.debit_amount - l.kredit_amount) AS bal FROM acc_journal_line l
                     JOIN acc_journal j ON j.id = l.journal_id AND j.status = 'Posted' GROUP BY l.account_id) gl ON gl.account_id = x.account_id
          LEFT JOIN (SELECT w.prepaid_account_id AS account_id, SUM(s.amount) AS amount FROM tax_withholding_slip s
                     JOIN ref_withholding_tax w ON w.id = s.withholding_tax_id GROUP BY w.prepaid_account_id) s ON s.account_id = x.account_id
          WHERE COALESCE(gl.bal, 0) <> COALESCE(s.amount, 0)`,
  },
  // ------------------------------------------------------------- advance
  {
    area: "advance",
    name: "no bill is paid beyond its total; a cancelled or unissued bill has no payment",
    sql: `SELECT a.advance_no, a.status::text, a.total_amount, SUM(l.settled_amount) AS paid
          FROM sal_advance a JOIN fin_cash_bank_tx_line l ON l.doc_type_id = ${docType("sal_advance")} AND l.doc_id = a.id
          JOIN fin_cash_bank_tx t ON t.id = l.tx_id AND t.status = 'Posted'
          GROUP BY a.id HAVING SUM(l.settled_amount) > a.total_amount OR a.status <> 'Issued'`,
  },
];

export type CheckResult = { area: string; name: string; rows: Record<string, unknown>[] };

/** Runs every check inside one read-only transaction. */
export async function reconcile(): Promise<CheckResult[]> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const out: CheckResult[] = [];
    for (const c of CHECKS) {
      out.push({ ...c, rows: (await tx.$queryRawUnsafe(c.sql)) as Record<string, unknown>[] });
    }
    return out;
  }, { timeout: 120_000 });
}

const plain = (v: unknown) => (typeof v === "bigint" ? Number(v) : v && typeof v === "object" && "toNumber" in v ? (v as { toNumber(): number }).toNumber() : v);

async function main() {
  const results = await reconcile();
  let failed = 0;
  for (const r of results) {
    const ok = r.rows.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? "  ok  " : " FAIL "} [${r.area}] ${r.name}${ok ? "" : ` — ${r.rows.length} row(s)`}`);
    for (const row of r.rows.slice(0, 5)) {
      console.log("         ", JSON.stringify(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, plain(v)]))));
    }
  }
  console.log(failed ? `\n${failed} of ${results.length} checks disagree.` : `\nAll ${results.length} checks agree.`);
  process.exitCode = failed ? 1 : 0;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/reconcile.ts")) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
