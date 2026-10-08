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
 *              picks and what the stock books released for it
 *   stock      each bucket and pool equals its ledger, none negative; the two
 *              stock books move together; lots belong to stock items (P120)
 *   billing    a note line is billed once; an invoice equals its lines and
 *              deductions; a fully billed order line is billed exactly
 *   tax        each posted taxable event made its faktur, each PPh row its slip,
 *              at the same figures; PPN Keluaran and PPh Dibayar Dimuka in the
 *              GL equal the tax records
 *   advance    a bill's paid amount equals its posted lines, within its total;
 *              a cancelled bill has no payment
 *   ap         AP items equal their entries and Hutang Usaha / Uang Muka
 *              Pembelian per supplier; GR/IR equals receipts less invoices; PO
 *              received quantity equals posted receipts; a receipt line billed once
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
/** The Uang Muka applied to an invoice's item (P117); 0 for one posted before P117. */
const applied = (v: string) => `COALESCE((SELECT SUM(a.amount) FROM fin_ar_ledger a WHERE a.item_id = ${v}.ar_item_id AND a.event = 'AdvanceApplied'), 0)`;

const acc = (key: string) =>
  `COALESCE((SELECT NULLIF(setting_value, '')::int FROM sys_setting WHERE setting_key = '${key}'), -1)`;
const docType = (table: string) => `(SELECT id FROM sys_doc_type WHERE doc_table = '${table}')`;
/** The advance-bill document types: Uang Muka Penjualan and Uang Muka Perizinan (P137). */
const advanceTypes = `(SELECT id FROM sys_doc_type WHERE doc_table IN ('fin_ar_advance', 'fin_ar_permit_advance'))`;
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
          SELECT 'delivery note', n.dn_no, n.status::text, n.journal_id FROM log_delivery_note n
            LEFT JOIN acc_journal j ON j.id = n.journal_id
          WHERE (n.status = 'Posted' AND n.cost_amount > 0 AND (j.id IS NULL OR j.status <> 'Posted' OR j.source_doc_type_id <> ${docType("log_delivery_note")} OR j.source_doc_id <> n.id))
             OR (n.status <> 'Posted' AND n.journal_id IS NOT NULL)
          UNION ALL
          -- Under P117 the journal credits the full PPN and the Uang Muka applied against
          -- Piutang; an invoice posted before credits its net PPN and nothing applied.
          SELECT 'invoice', v.invoice_no, v.status::text, v.journal_id FROM fin_ar_invoice v
            LEFT JOIN acc_journal j ON j.id = v.journal_id
          WHERE (v.status = 'Posted' AND (j.id IS NULL OR j.status <> 'Posted' OR j.source_doc_type_id <> ${docType("fin_ar_invoice")} OR j.source_doc_id <> v.id))
             OR (v.status <> 'Posted' AND v.journal_id IS NOT NULL)`,
  },
  {
    area: "journal",
    name: "each journal carries its document's figure",
    // A Penerimaan's debits are what it settled (bank + charge + PPh); a
    // Pengeluaran's are what it settled plus the bank charge, which leaves
    // the bank with the payment (P127).
    sql: `SELECT 'receipt' AS kind, t.tx_no AS doc, t.settled_amount + CASE WHEN t.direction = 'Out' THEN t.bank_charge ELSE 0 END AS expected, SUM(l.debit_amount) AS journal_debit
          FROM fin_cash_bank_tx t JOIN acc_journal_line l ON l.journal_id = t.journal_id
          WHERE t.status = 'Posted' GROUP BY t.id HAVING SUM(l.debit_amount) <> t.settled_amount + CASE WHEN t.direction = 'Out' THEN t.bank_charge ELSE 0 END
          UNION ALL
          SELECT 'delivery note', n.dn_no, n.cost_amount, SUM(l.debit_amount)
          FROM log_delivery_note n JOIN acc_journal_line l ON l.journal_id = n.journal_id
          WHERE n.status = 'Posted' GROUP BY n.id HAVING SUM(l.debit_amount) <> n.cost_amount
          UNION ALL
          SELECT 'invoice', v.invoice_no, v.dpp_amount + v.ppn_amount + CASE WHEN ${applied("v")} <> 0 THEN v.advance_ppn_amount + ${applied("v")} ELSE 0 END, SUM(l.kredit_amount)
          FROM fin_ar_invoice v JOIN acc_journal_line l ON l.journal_id = v.journal_id
          WHERE v.status = 'Posted' GROUP BY v.id
          HAVING SUM(l.kredit_amount) <> v.dpp_amount + v.ppn_amount + CASE WHEN ${applied("v")} <> 0 THEN v.advance_ppn_amount + ${applied("v")} ELSE 0 END`,
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
          LEFT JOIN (SELECT partner_id, SUM(current_balance) AS bal FROM fin_ar_item
                     WHERE item_type = 'Advance' AND source_doc_type_id = ${docType("fin_ar_advance")} GROUP BY partner_id) items ON items.partner_id = p.id
          LEFT JOIN (${glByPartner(acc("sales_advance_account"))}) gl ON gl.partner_id = p.id
          WHERE COALESCE(items.bal, 0) <> COALESCE(-gl.bal, 0)`,
  },
  {
    area: "ar",
    name: "Uang Muka Perizinan items equal the Uang Muka Perizinan account, per customer (P137)",
    sql: `SELECT p.partner_label, COALESCE(items.bal, 0) AS items, COALESCE(-gl.bal, 0) AS gl FROM m_partner p
          LEFT JOIN (SELECT partner_id, SUM(current_balance) AS bal FROM fin_ar_item
                     WHERE item_type = 'Advance' AND source_doc_type_id = ${docType("fin_ar_permit_advance")} GROUP BY partner_id) items ON items.partner_id = p.id
          LEFT JOIN (${glByPartner(acc("permit_advance_account"))}) gl ON gl.partner_id = p.id
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
    name: "each posted receipt's advance line wrote one entry at its DPP part on the bill's one Uang Muka item (P133)",
    sql: `SELECT t.tx_no, l.doc_id AS bill_id, l.dpp_part, COUNT(e.id) AS entries, SUM(e.amount) AS amount
          FROM fin_cash_bank_tx t JOIN fin_cash_bank_tx_line l ON l.tx_id = t.id AND l.doc_type_id IN ${advanceTypes}
          LEFT JOIN fin_ar_item i ON i.item_type = 'Advance' AND i.source_doc_type_id = l.doc_type_id AND i.source_doc_id = l.doc_id
          LEFT JOIN fin_ar_ledger e ON e.item_id = i.id AND e.event IN ('Create', 'AdvanceReceived')
            AND e.doc_type_id = ${docType("fin_cash_bank_tx")} AND e.doc_id = t.id
          WHERE t.status = 'Posted' AND l.dpp_part > 0
          GROUP BY t.id, l.id HAVING COUNT(e.id) <> 1 OR SUM(e.amount) <> l.dpp_part`,
  },
  {
    area: "ar",
    name: "one Uang Muka item per bill, its original amount the DPP its posted receipts brought in (P133)",
    sql: `SELECT i.ar_item_no, i.original_amount, COALESCE(p.dpp, 0) AS received,
                 (SELECT COUNT(*) FROM fin_ar_item o WHERE o.item_type = 'Advance' AND o.source_doc_type_id = i.source_doc_type_id AND o.source_doc_id = i.source_doc_id) AS items
          FROM fin_ar_item i
          LEFT JOIN (SELECT l.doc_type_id, l.doc_id, SUM(l.dpp_part) AS dpp FROM fin_cash_bank_tx_line l
                     JOIN fin_cash_bank_tx t ON t.id = l.tx_id AND t.status = 'Posted'
                     WHERE l.doc_type_id IN ${advanceTypes} GROUP BY l.doc_type_id, l.doc_id) p
            ON p.doc_type_id = i.source_doc_type_id AND p.doc_id = i.source_doc_id
          WHERE i.item_type = 'Advance'
            AND (i.original_amount <> COALESCE(p.dpp, 0)
                 OR (SELECT COUNT(*) FROM fin_ar_item o WHERE o.item_type = 'Advance' AND o.source_doc_type_id = i.source_doc_type_id AND o.source_doc_id = i.source_doc_id) <> 1)`,
  },
  {
    area: "ar",
    name: "each Invoice's paid amount equals its posted receipt lines, and its total less it equals its item's balance (P133)",
    sql: `SELECT v.invoice_no, v.total_amount, v.paid_amount, COALESCE(p.paid, 0) AS lines, i.current_balance
          FROM fin_ar_invoice v
          LEFT JOIN fin_ar_item i ON i.id = v.ar_item_id
          LEFT JOIN (SELECT l.doc_id, SUM(l.settled_amount) AS paid FROM fin_cash_bank_tx_line l
                     JOIN fin_cash_bank_tx t ON t.id = l.tx_id AND t.status = 'Posted'
                     WHERE l.doc_type_id = ${docType("fin_ar_invoice")} GROUP BY l.doc_id) p ON p.doc_id = v.id
          WHERE v.paid_amount <> COALESCE(p.paid, 0)
             OR (v.status = 'Posted' AND v.ar_item_id IS NOT NULL AND v.total_amount - v.paid_amount <> i.current_balance)
             OR (v.status <> 'Posted' AND v.paid_amount <> 0)`,
  },
  {
    area: "ar",
    name: "each posted receipt's invoice line wrote one Pembayaran on the invoice's item",
    sql: `SELECT t.tx_no, v.invoice_no, l.settled_amount, COUNT(e.id) AS entries, SUM(e.amount) AS paid
          FROM fin_cash_bank_tx t JOIN fin_cash_bank_tx_line l ON l.tx_id = t.id AND l.doc_type_id = ${docType("fin_ar_invoice")}
          JOIN fin_ar_invoice v ON v.id = l.doc_id
          LEFT JOIN fin_ar_ledger e ON e.item_id = v.ar_item_id AND e.event = 'Payment' AND e.doc_type_id = ${docType("fin_cash_bank_tx")} AND e.doc_id = t.id
          WHERE t.status = 'Posted' GROUP BY t.id, l.id, v.invoice_no HAVING COUNT(e.id) <> 1 OR SUM(e.amount) <> l.settled_amount`,
  },
  {
    area: "ar",
    name: "each posted invoice's Invoice item: born at its face, less the Uang Muka applied, leaving its net Piutang (P117)",
    // An invoice posted before P117 was born at net with nothing applied, and had
    // no item when its Uang Muka covered it whole; the identity holds for both.
    sql: `SELECT v.invoice_no, v.total_amount, i.ar_item_no, i.original_amount, e.amount AS created, ${applied("v")} AS applied
          FROM fin_ar_invoice v
          LEFT JOIN fin_ar_item i ON i.id = v.ar_item_id
          LEFT JOIN fin_ar_ledger e ON e.item_id = i.id AND e.event = 'Create'
          WHERE v.status = 'Posted' AND (
            (v.ar_item_id IS NULL AND v.total_amount <> 0)
            OR (v.ar_item_id IS NOT NULL AND (i.item_type <> 'Invoice' OR i.source_doc_type_id <> ${docType("fin_ar_invoice")} OR i.source_doc_id <> v.id
                OR e.amount <> i.original_amount OR e.amount - ${applied("v")} <> v.total_amount
                OR (${applied("v")} <> 0 AND (e.amount <> v.dpp_amount + v.ppn_amount + v.advance_ppn_amount
                                              OR ${applied("v")} <> v.advance_dpp_amount + v.advance_ppn_amount)))))`,
  },
  {
    area: "ar",
    name: "each posted invoice's deduction wrote one Dipakai Invoice on its Uang Muka item",
    sql: `SELECT v.invoice_no, d.ar_item_no, d.dpp_used, COUNT(e.id) AS entries, SUM(e.amount) AS used
          FROM fin_ar_invoice v JOIN fin_ar_invoice_advance_deduction d ON d.invoice_id = v.id
          LEFT JOIN fin_ar_ledger e ON e.item_id = d.ar_item_id AND e.event = 'AdvanceUsed' AND e.doc_type_id = ${docType("fin_ar_invoice")} AND e.doc_id = v.id
            AND e.counter_item_id IS NOT DISTINCT FROM v.ar_item_id
          WHERE v.status = 'Posted' GROUP BY v.id, d.id HAVING COUNT(e.id) <> 1 OR SUM(e.amount) <> d.dpp_used`,
  },
  {
    area: "ar",
    name: "under P117 each deduction also lowered the Invoice item by its DPP and PPN, naming the Uang Muka item",
    sql: `SELECT v.invoice_no, d.ar_item_no, d.dpp_used + d.ppn_used AS expected, COUNT(e.id) AS entries, SUM(e.amount) AS applied
          FROM fin_ar_invoice v JOIN fin_ar_invoice_advance_deduction d ON d.invoice_id = v.id
          LEFT JOIN fin_ar_ledger e ON e.item_id = v.ar_item_id AND e.event = 'AdvanceApplied' AND e.counter_item_id = d.ar_item_id
          WHERE v.status = 'Posted' AND ${applied("v")} <> 0
          GROUP BY v.id, d.id HAVING COUNT(e.id) <> 1 OR SUM(e.amount) <> d.dpp_used + d.ppn_used`,
  },
  {
    area: "ar",
    name: "no AR entry comes from a receipt or invoice that is not posted",
    sql: `SELECT e.id, e.doc_no, e.event::text FROM fin_ar_ledger e
          LEFT JOIN fin_cash_bank_tx t ON e.doc_type_id = ${docType("fin_cash_bank_tx")} AND t.id = e.doc_id
          LEFT JOIN fin_ar_invoice v ON e.doc_type_id = ${docType("fin_ar_invoice")} AND v.id = e.doc_id
          WHERE (t.id IS NOT NULL AND t.status <> 'Posted') OR (v.id IS NOT NULL AND v.status <> 'Posted')`,
  },
  // --------------------------------------------------------------- goods
  {
    area: "goods",
    name: "delivered quantity on every order line equals what posted notes took, level by level",
    sql: `SELECT 'delivery order line' AS level, dol.id, dol.delivered_qty AS stored, COALESCE(SUM(nl.qty) FILTER (WHERE n.status = 'Posted'), 0) AS from_children
          FROM sal_delivery_order_line dol LEFT JOIN (log_delivery_note_line nl JOIN log_delivery_note n ON n.id = nl.delivery_note_id AND n.purpose = 'sales_delivery')
            ON nl.source_doc_line_id = dol.id
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
          FROM sal_delivery_order_line dol JOIN log_delivery_note_line nl ON nl.source_doc_line_id = dol.id
          JOIN log_delivery_note n ON n.id = nl.delivery_note_id AND n.purpose = 'sales_delivery' AND n.status <> 'Cancelled'
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
    name: "a posted note's cost equals its lines, its picks and, since P120, what the stock books released for it",
    sql: `SELECT n.dn_no, n.cost_amount, (SELECT SUM(cost_amount) FROM log_delivery_note_line WHERE delivery_note_id = n.id) AS lines,
                 (SELECT -SUM(value_change) FROM log_stock_valuation_ledger WHERE source_doc_type_id = ${docType("log_delivery_note")} AND source_doc_id = n.id) AS issued
          FROM log_delivery_note n WHERE n.status = 'Posted' AND (
            n.cost_amount <> COALESCE((SELECT SUM(cost_amount) FROM log_delivery_note_line WHERE delivery_note_id = n.id), 0)
            OR (EXISTS (SELECT 1 FROM log_stock_valuation_ledger WHERE source_doc_type_id = ${docType("log_delivery_note")} AND source_doc_id = n.id)
                AND n.cost_amount <> (SELECT -SUM(value_change) FROM log_stock_valuation_ledger WHERE source_doc_type_id = ${docType("log_delivery_note")} AND source_doc_id = n.id)))
          UNION ALL
          SELECT n.dn_no, l.cost_amount, SUM(p.cost_amount), SUM(p.qty) - l.qty
          FROM log_delivery_note n JOIN log_delivery_note_line l ON l.delivery_note_id = n.id JOIN log_delivery_note_lot p ON p.delivery_note_line_id = l.id
          WHERE n.status = 'Posted' GROUP BY n.dn_no, l.id HAVING l.cost_amount <> SUM(p.cost_amount) OR SUM(p.qty) <> l.qty`,
  },
  {
    area: "goods",
    name: "a posted note's lot-controlled lines left by lot",
    sql: `SELECT n.dn_no, l.id AS line, m.item_label FROM log_delivery_note n
          JOIN log_delivery_note_line l ON l.delivery_note_id = n.id
          JOIN m_item m ON m.id = l.item_id AND m.item_type = 'Barang' AND m.track_stock = true
          WHERE n.status = 'Posted' AND NOT EXISTS (SELECT 1 FROM log_delivery_note_lot p WHERE p.delivery_note_line_id = l.id)`,
  },
  // ------------------------------------------------------------- billing
  {
    area: "billing",
    name: "a note line is billed by at most one live invoice, of its own order, once the note is posted",
    sql: `SELECT nl.id AS note_line, COUNT(*) AS invoices, MIN(v.invoice_no) AS first FROM fin_ar_invoice_line il
          JOIN fin_ar_invoice v ON v.id = il.invoice_id AND v.status <> 'Cancelled'
          JOIN log_delivery_note_line nl ON nl.id = il.delivery_note_line_id
          GROUP BY nl.id HAVING COUNT(*) > 1
          UNION ALL
          SELECT nl.id, 0, v.invoice_no FROM fin_ar_invoice_line il
          JOIN fin_ar_invoice v ON v.id = il.invoice_id AND v.status <> 'Cancelled'
          JOIN log_delivery_note_line nl ON nl.id = il.delivery_note_line_id
          JOIN log_delivery_note n ON n.id = nl.delivery_note_id
          LEFT JOIN sal_delivery_order d ON d.id = n.source_doc_id AND n.purpose = 'sales_delivery'
          WHERE n.status <> 'Posted' OR d.customer_order_id IS DISTINCT FROM v.customer_order_id OR il.qty <> nl.qty`,
  },
  {
    area: "billing",
    name: "an invoice equals its lines and its deductions",
    sql: `SELECT v.invoice_no, v.dpp_amount, SUM(l.dpp_amount) AS lines_dpp, v.ppn_amount, SUM(l.ppn_amount) AS lines_ppn, v.total_amount
          FROM fin_ar_invoice v JOIN fin_ar_invoice_line l ON l.invoice_id = v.id
          WHERE v.status <> 'Cancelled'
          GROUP BY v.id HAVING v.dpp_amount <> SUM(l.dpp_amount) OR v.ppn_amount <> SUM(l.ppn_amount) - v.advance_ppn_amount
            OR v.advance_dpp_amount <> SUM(l.advance_dpp_amount) OR v.net_dpp_amount <> SUM(l.net_dpp_amount)
            OR v.dpp_other_amount <> SUM(l.dpp_other_amount) OR v.total_amount <> v.net_dpp_amount + v.ppn_amount
            OR v.gross_amount <> SUM(l.gross_amount) OR v.discount_amount <> SUM(l.discount_amount)
            OR v.amount <> v.gross_amount - v.discount_amount OR SUM(l.amount) <> SUM(l.gross_amount) - SUM(l.discount_amount)
            OR v.advance_dpp_amount <> COALESCE((SELECT SUM(dpp_used) FROM fin_ar_invoice_advance_deduction d WHERE d.invoice_id = v.id), 0)
            OR v.advance_ppn_amount <> COALESCE((SELECT SUM(ppn_used) FROM fin_ar_invoice_advance_deduction d WHERE d.invoice_id = v.id), 0)`,
  },
  {
    area: "billing",
    name: "an invoice uses only its own order's Uang Muka",
    sql: `SELECT v.invoice_no, d.ar_item_no, i.scope_doc_id AS item_order, v.customer_order_id AS invoice_order
          FROM fin_ar_invoice v JOIN fin_ar_invoice_advance_deduction d ON d.invoice_id = v.id
          JOIN fin_ar_item i ON i.id = d.ar_item_id
          LEFT JOIN sys_doc_type st ON st.id = i.scope_doc_type_id
          WHERE v.status <> 'Cancelled' AND (i.item_type <> 'Advance' OR st.doc_table IS DISTINCT FROM 'sal_customer_order'
                 OR i.scope_doc_id IS DISTINCT FROM v.customer_order_id OR i.partner_id <> v.customer_id)`,
  },
  {
    area: "billing",
    name: "a fully billed order line is billed at exactly its amount, gross and discount (P112)",
    sql: `SELECT col.id AS order_line, col.amount, SUM(il.amount) AS billed, col.discount_amount, SUM(il.discount_amount) AS billed_discount
          FROM sal_customer_order_line col
          JOIN fin_ar_invoice_line il ON il.customer_order_line_id = col.id
          JOIN fin_ar_invoice v ON v.id = il.invoice_id AND v.status = 'Posted'
          GROUP BY col.id HAVING SUM(il.qty) = col.qty AND (SUM(il.amount) <> col.amount
            OR SUM(il.discount_amount) <> col.discount_amount OR SUM(il.gross_amount) <> col.amount + col.discount_amount)`,
  },
  // ----------------------------------------------------------------- tax
  {
    area: "tax",
    name: "each posted advance line with PPN made one Faktur Uang Muka at its DPP and PPN",
    sql: `SELECT t.tx_no, l.doc_id AS bill_id, l.dpp_part, l.ppn_part, COUNT(f.id) AS fakturs, MIN(f.dpp) AS dpp, MIN(f.ppn) AS ppn
          FROM fin_cash_bank_tx t JOIN fin_cash_bank_tx_line l ON l.tx_id = t.id AND l.doc_type_id IN ${advanceTypes}
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
                  WHERE ff.source_doc_type_id = ${docType("fin_ar_invoice")} AND ff.source_doc_id = v.id) AS deducted
          FROM fin_ar_invoice v
          LEFT JOIN tax_faktur f ON f.source_doc_type_id = ${docType("fin_ar_invoice")} AND f.source_doc_id = v.id
          WHERE v.status = 'Posted' AND v.is_taxable AND v.net_dpp_amount > 0
          GROUP BY v.id
          HAVING COUNT(f.id) <> 1 OR MIN(f.dpp) <> v.net_dpp_amount OR MIN(f.ppn) <> v.ppn_amount
             OR MIN(f.kind::text) <> CASE WHEN v.advance_dpp_amount > 0 THEN 'Settlement' ELSE 'Normal' END
             OR COALESCE((SELECT SUM(r.dpp_deducted) FROM tax_faktur_ref r JOIN tax_faktur ff ON ff.id = r.faktur_id
                          WHERE ff.source_doc_type_id = ${docType("fin_ar_invoice")} AND ff.source_doc_id = v.id), 0) <> v.advance_dpp_amount
             OR MIN(f.advance_ppn) <> v.advance_ppn_amount
             OR COALESCE((SELECT SUM(r.ppn_deducted) FROM tax_faktur_ref r JOIN tax_faktur ff ON ff.id = r.faktur_id
                          WHERE ff.source_doc_type_id = ${docType("fin_ar_invoice")} AND ff.source_doc_id = v.id), 0) <> v.advance_ppn_amount`,
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
          FROM (SELECT DISTINCT account_id AS account_id FROM ref_withholding_tax WHERE account_id IS NOT NULL) x
          JOIN acc_account a ON a.id = x.account_id
          LEFT JOIN (SELECT l.account_id, SUM(l.debit_amount - l.kredit_amount) AS bal FROM acc_journal_line l
                     JOIN acc_journal j ON j.id = l.journal_id AND j.status = 'Posted' GROUP BY l.account_id) gl ON gl.account_id = x.account_id
          LEFT JOIN (SELECT w.account_id AS account_id, SUM(s.amount) AS amount FROM tax_withholding_slip s
                     JOIN ref_withholding_tax w ON w.id = s.withholding_tax_id GROUP BY w.account_id) s ON s.account_id = x.account_id
          WHERE COALESCE(gl.bal, 0) <> COALESCE(s.amount, 0)`,
  },
  // ------------------------------------------------------------- advance
  {
    area: "advance",
    name: "each bill's paid amount equals its posted receipt lines, within its total; a cancelled or unissued bill has no payment (P132)",
    sql: `SELECT a.advance_no, a.status::text, a.total_amount, a.paid_amount, COALESCE(p.paid, 0) AS lines
          FROM fin_ar_advance a
          LEFT JOIN (SELECT l.doc_id, SUM(l.settled_amount) AS paid
                     FROM fin_cash_bank_tx_line l JOIN fin_cash_bank_tx t ON t.id = l.tx_id AND t.status = 'Posted'
                     WHERE l.doc_type_id = ${docType("fin_ar_advance")} GROUP BY l.doc_id) p ON p.doc_id = a.id
          WHERE a.paid_amount <> COALESCE(p.paid, 0) OR a.paid_amount > a.total_amount
             OR (a.paid_amount > 0 AND a.status <> 'Issued')`,
  },
  {
    area: "advance",
    name: "each Uang Muka Perizinan's paid amount equals its posted receipt lines, within its total (P137)",
    sql: `SELECT a.advance_no, a.status::text, a.total_amount, a.paid_amount, COALESCE(p.paid, 0) AS lines
          FROM fin_ar_permit_advance a
          LEFT JOIN (SELECT l.doc_id, SUM(l.settled_amount) AS paid
                     FROM fin_cash_bank_tx_line l JOIN fin_cash_bank_tx t ON t.id = l.tx_id AND t.status = 'Posted'
                     WHERE l.doc_type_id = ${docType("fin_ar_permit_advance")} GROUP BY l.doc_id) p ON p.doc_id = a.id
          WHERE a.paid_amount <> COALESCE(p.paid, 0) OR a.paid_amount > a.total_amount
             OR (a.paid_amount > 0 AND a.status <> 'Issued')`,
  },
  {
    area: "permit",
    name: "each Invoice Perizinan's paid amount equals its posted receipt lines, and its total less it equals its item's balance (P137)",
    sql: `SELECT v.invoice_no, v.total_amount, v.paid_amount, COALESCE(p.paid, 0) AS lines, i.current_balance
          FROM fin_ar_permit_invoice v
          LEFT JOIN fin_ar_item i ON i.id = v.ar_item_id
          LEFT JOIN (SELECT l.doc_id, SUM(l.settled_amount) AS paid FROM fin_cash_bank_tx_line l
                     JOIN fin_cash_bank_tx t ON t.id = l.tx_id AND t.status = 'Posted'
                     WHERE l.doc_type_id = ${docType("fin_ar_permit_invoice")} GROUP BY l.doc_id) p ON p.doc_id = v.id
          WHERE v.paid_amount <> COALESCE(p.paid, 0)
             OR (v.status = 'Posted' AND (v.ar_item_id IS NULL OR v.total_amount - v.paid_amount <> i.current_balance))`,
  },
  {
    area: "permit",
    name: "each Pengajuan's cost paid equals its posted Biaya Perizinan lines and never exceeds its realised DPP (P137)",
    sql: `SELECT r.request_no, r.realized_dpp, r.cost_paid_amount, COALESCE(p.paid, 0) AS lines
          FROM sal_permit_request r
          LEFT JOIN (SELECT l.doc_id, SUM(l.settled_amount) AS paid FROM fin_cash_bank_tx_line l
                     JOIN fin_cash_bank_tx t ON t.id = l.tx_id AND t.status = 'Posted'
                     WHERE l.doc_type_id = ${docType("sal_permit_request")} GROUP BY l.doc_id) p ON p.doc_id = r.id
          WHERE r.cost_paid_amount <> COALESCE(p.paid, 0) OR r.cost_paid_amount > r.realized_dpp`,
  },
  {
    area: "permit",
    name: "a Pengajuan is billed by at most one live Invoice Perizinan, and is Selesai exactly when one is posted (P137)",
    sql: `SELECT r.request_no, r.status::text, COUNT(v.id) FILTER (WHERE v.status <> 'Cancelled') AS live,
                 COUNT(v.id) FILTER (WHERE v.status = 'Posted') AS posted
          FROM sal_permit_request r LEFT JOIN fin_ar_permit_invoice v ON v.permit_request_id = r.id
          GROUP BY r.id
          HAVING COUNT(v.id) FILTER (WHERE v.status <> 'Cancelled') > 1
              OR (COUNT(v.id) FILTER (WHERE v.status = 'Posted') = 1) <> (r.status = 'Done')`,
  },
  {
    area: "tax",
    name: "no Faktur Uang Muka is deducted beyond its DPP, and the deductions are taken oldest first (P133)",
    // Oldest first: a faktur is drawn on only once every older faktur of the
    // same item has been used up.
    sql: `SELECT f.faktur_no, f.dpp, SUM(r.dpp_deducted) AS deducted FROM tax_faktur f JOIN tax_faktur_ref r ON r.ref_faktur_id = f.id
          WHERE f.kind = 'Advance' GROUP BY f.id HAVING SUM(r.dpp_deducted) > f.dpp
          UNION ALL
          SELECT f.faktur_no, f.dpp, NULL FROM tax_faktur f
          WHERE f.kind = 'Advance' AND EXISTS (SELECT 1 FROM tax_faktur_ref r WHERE r.ref_faktur_id = f.id)
            AND EXISTS (SELECT 1 FROM tax_faktur o WHERE o.kind = 'Advance' AND o.ar_item_id = f.ar_item_id
                          AND (o.tax_date, o.id) < (f.tax_date, f.id)
                          AND o.dpp > COALESCE((SELECT SUM(r2.dpp_deducted) FROM tax_faktur_ref r2 WHERE r2.ref_faktur_id = o.id), 0))`,
  },
  {
    area: "tax",
    name: "a fully used Uang Muka's PPN deducted by Invoices is the PPN chain on its whole DPP (P118)",
    // Only items every use of which deducted PPN under P113/P118 (invoices posted
    // before P113 deducted none). Half up, as the tax module rounds.
    sql: `SELECT i.ar_item_no, i.original_amount, SUM(d.ppn_used) AS deducted,
                 ROUND(ROUND(i.original_amount * MIN(v.ppn_dpp_other_numerator) / MIN(v.ppn_dpp_other_denominator), 0) * MIN(v.ppn_rate) / 100, 0) AS chain
          FROM fin_ar_item i JOIN fin_ar_invoice_advance_deduction d ON d.ar_item_id = i.id
          JOIN fin_ar_invoice v ON v.id = d.invoice_id AND v.status = 'Posted' AND v.is_taxable
          WHERE i.item_type = 'Advance' AND i.current_balance = 0
          GROUP BY i.id HAVING MIN(d.ppn_used) > 0
             AND SUM(d.ppn_used) <> ROUND(ROUND(i.original_amount * MIN(v.ppn_dpp_other_numerator) / MIN(v.ppn_dpp_other_denominator), 0) * MIN(v.ppn_rate) / 100, 0)`,
  },
  // ----------------------------------------------------------- purchasing
  {
    area: "ap",
    name: "every AP item's balance equals its Buku Hutang entries (P127)",
    sql: `SELECT i.ap_item_no, i.current_balance, SUM(e.movement) AS entries FROM fin_ap_item i
            JOIN fin_ap_ledger e ON e.item_id = i.id GROUP BY i.id HAVING i.current_balance <> SUM(e.movement)`,
  },
  {
    area: "ap",
    name: "Invoice AP items equal the Hutang Usaha account, per supplier (P128)",
    sql: `SELECT p.partner_label, COALESCE(items.bal, 0) AS items, COALESCE(-gl.bal, 0) AS gl FROM m_partner p
          LEFT JOIN (SELECT partner_id, SUM(current_balance) AS bal FROM fin_ap_item WHERE item_type = 'Invoice' GROUP BY partner_id) items ON items.partner_id = p.id
          LEFT JOIN (${glByPartner(acc("payable_account"))}) gl ON gl.partner_id = p.id
          WHERE COALESCE(items.bal, 0) <> COALESCE(-gl.bal, 0)`,
  },
  {
    area: "ap",
    name: "Uang Muka AP items equal the Uang Muka Pembelian account, per supplier (P127)",
    sql: `SELECT p.partner_label, COALESCE(items.bal, 0) AS items, COALESCE(gl.bal, 0) AS gl FROM m_partner p
          LEFT JOIN (SELECT partner_id, SUM(current_balance) AS bal FROM fin_ap_item WHERE item_type = 'Advance' GROUP BY partner_id) items ON items.partner_id = p.id
          LEFT JOIN (${glByPartner(acc("purchase_advance_account"))}) gl ON gl.partner_id = p.id
          WHERE COALESCE(items.bal, 0) <> COALESCE(gl.bal, 0)`,
  },
  {
    area: "ap",
    name: "Barang Diterima Belum Ditagih equals posted receipts less posted invoices, per supplier (B22)",
    sql: `SELECT p.partner_label, COALESCE(r.v, 0) - COALESCE(b.v, 0) AS open_receipts, COALESCE(-gl.bal, 0) AS gl FROM m_partner p
          LEFT JOIN (SELECT n.partner_id, SUM(n.value_amount) AS v FROM log_receipt_note n WHERE n.status = 'Posted' GROUP BY n.partner_id) r ON r.partner_id = p.id
          LEFT JOIN (SELECT v.supplier_id, SUM(v.dpp_amount) AS v FROM fin_ap_invoice v WHERE v.status = 'Posted' GROUP BY v.supplier_id) b ON b.supplier_id = p.id
          LEFT JOIN (${glByPartner(acc("goods_received_account"))}) gl ON gl.partner_id = p.id
          WHERE COALESCE(r.v, 0) - COALESCE(b.v, 0) <> COALESCE(-gl.bal, 0)`,
  },
  {
    area: "ap",
    name: "received quantity on every PO line equals what posted Receipt Notes took, never more than ordered (P125)",
    sql: `SELECT o.order_no, l.line_no, l.qty, l.received_qty, COALESCE(r.q, 0) AS receipts FROM pur_order_line l JOIN pur_order o ON o.id = l.order_id
          LEFT JOIN (SELECT rl.source_doc_line_id, SUM(rl.qty) AS q FROM log_receipt_note_line rl JOIN log_receipt_note n ON n.id = rl.receipt_note_id
                     WHERE n.status = 'Posted' AND n.purpose = 'purchase_receipt' GROUP BY rl.source_doc_line_id) r ON r.source_doc_line_id = l.id
          WHERE l.received_qty <> COALESCE(r.q, 0) OR l.received_qty > l.qty`,
  },
  {
    area: "ap",
    name: "a receipt line is billed by at most one live Invoice Pembelian (P128)",
    sql: `SELECT l.receipt_note_line_id, COUNT(*) AS invoices FROM fin_ap_invoice_line l JOIN fin_ap_invoice v ON v.id = l.invoice_id AND v.status IN ('Draft', 'Posted')
          GROUP BY l.receipt_note_line_id HAVING COUNT(*) > 1`,
  },
  {
    area: "ap",
    name: "one Uang Muka AP item per bill, its original amount the DPP its posted payments paid (P133)",
    sql: `SELECT i.ap_item_no, i.original_amount, COALESCE(p.dpp, 0) AS paid
          FROM fin_ap_item i
          LEFT JOIN (SELECT l.doc_id, SUM(l.dpp_part) AS dpp FROM fin_cash_bank_tx_line l
                     JOIN fin_cash_bank_tx t ON t.id = l.tx_id AND t.status = 'Posted'
                     WHERE l.doc_type_id = ${docType("fin_ap_advance")} GROUP BY l.doc_id) p ON p.doc_id = i.source_doc_id
          WHERE i.item_type = 'Advance'
            AND (i.original_amount <> COALESCE(p.dpp, 0)
                 OR (SELECT COUNT(*) FROM fin_ap_item o WHERE o.item_type = 'Advance' AND o.source_doc_type_id = i.source_doc_type_id AND o.source_doc_id = i.source_doc_id) <> 1)`,
  },
  {
    area: "ap",
    name: "each Invoice Pembelian's paid amount equals its posted payment lines, and what it owes less it equals its item's balance (P133)",
    sql: `SELECT v.invoice_no, v.paid_amount, COALESCE(p.paid, 0) AS lines, i.current_balance
          FROM fin_ap_invoice v
          LEFT JOIN fin_ap_item i ON i.id = v.ap_item_id
          LEFT JOIN (SELECT l.doc_id, SUM(l.settled_amount) AS paid FROM fin_cash_bank_tx_line l
                     JOIN fin_cash_bank_tx t ON t.id = l.tx_id AND t.status = 'Posted'
                     WHERE l.doc_type_id = ${docType("fin_ap_invoice")} GROUP BY l.doc_id) p ON p.doc_id = v.id
          WHERE v.paid_amount <> COALESCE(p.paid, 0)
             OR (v.status = 'Posted' AND v.ap_item_id IS NOT NULL
                 AND v.payable_amount - v.advance_dpp_amount - v.advance_ppn_amount - v.paid_amount <> i.current_balance)
             OR (v.status <> 'Posted' AND v.paid_amount <> 0)`,
  },
  {
    area: "ap",
    name: "each AP advance bill's paid amount equals its posted payment lines, within its total; a cancelled or unrecorded bill has no payment (P127, P132)",
    sql: `SELECT a.advance_no, a.status::text, a.total_amount, a.paid_amount, COALESCE(p.paid, 0) AS lines
          FROM fin_ap_advance a
          LEFT JOIN (SELECT l.doc_id, SUM(l.settled_amount) AS paid
                     FROM fin_cash_bank_tx_line l JOIN fin_cash_bank_tx t ON t.id = l.tx_id AND t.status = 'Posted'
                     WHERE l.doc_type_id = ${docType("fin_ap_advance")} GROUP BY l.doc_id) p ON p.doc_id = a.id
          WHERE a.paid_amount <> COALESCE(p.paid, 0) OR a.paid_amount > a.total_amount
             OR (a.paid_amount > 0 AND a.status <> 'Issued')`,
  },
  // --------------------------------------------------------------- books
  {
    area: "books",
    name: "each posting has one ledger number per book, numbering its entries 1..n, and each number one posting (P110)",
    sql: `SELECT 'buku piutang' AS book, MIN(ledger_no) AS ledger_no, COUNT(DISTINCT ledger_no) AS numbers, COUNT(*) AS entries, MAX(line_no) AS last_line
          FROM fin_ar_ledger GROUP BY doc_type_id, doc_id
          HAVING COUNT(DISTINCT ledger_no) <> 1 OR MAX(line_no) <> COUNT(*) OR MIN(line_no) <> 1
          UNION ALL
          SELECT 'cash bank book', MIN(ledger_no), COUNT(DISTINCT ledger_no), COUNT(*), MAX(line_no)
          FROM cash_bank_ledger WHERE source_doc_id IS NOT NULL GROUP BY source_doc_type_id, source_doc_id
          HAVING COUNT(DISTINCT ledger_no) <> 1 OR MAX(line_no) <> COUNT(*) OR MIN(line_no) <> 1
          UNION ALL
          SELECT 'stock ledger', MIN(ledger_no), COUNT(DISTINCT ledger_no), COUNT(*), MAX(line_no)
          FROM log_stock_ledger GROUP BY source_doc_type_id, source_doc_id
          HAVING COUNT(DISTINCT ledger_no) <> 1 OR MAX(line_no) <> COUNT(*) OR MIN(line_no) <> 1
          UNION ALL
          SELECT 'stock valuation ledger', MIN(ledger_no), COUNT(DISTINCT ledger_no), COUNT(*), MAX(line_no)
          FROM log_stock_valuation_ledger GROUP BY source_doc_type_id, source_doc_id
          HAVING COUNT(DISTINCT ledger_no) <> 1 OR MAX(line_no) <> COUNT(*) OR MIN(line_no) <> 1
          UNION ALL
          SELECT 'buku piutang', ledger_no, COUNT(DISTINCT (doc_type_id, doc_id)), COUNT(*), MAX(line_no)
          FROM fin_ar_ledger GROUP BY ledger_no HAVING COUNT(DISTINCT (doc_type_id, doc_id)) > 1
          UNION ALL
          SELECT 'cash bank book', ledger_no, COUNT(DISTINCT (source_doc_type_id, source_doc_id)), COUNT(*), MAX(line_no)
          FROM cash_bank_ledger GROUP BY ledger_no HAVING COUNT(DISTINCT (source_doc_type_id, source_doc_id)) > 1
          UNION ALL
          SELECT 'stock ledger', ledger_no, COUNT(DISTINCT (source_doc_type_id, source_doc_id)), COUNT(*), MAX(line_no)
          FROM log_stock_ledger GROUP BY ledger_no HAVING COUNT(DISTINCT (source_doc_type_id, source_doc_id)) > 1
          UNION ALL
          SELECT 'stock valuation ledger', ledger_no, COUNT(DISTINCT (source_doc_type_id, source_doc_id)), COUNT(*), MAX(line_no)
          FROM log_stock_valuation_ledger GROUP BY ledger_no HAVING COUNT(DISTINCT (source_doc_type_id, source_doc_id)) > 1`,
  },
  // --------------------------------------------------------------- stock
  {
    area: "stock",
    name: "each stock bucket's quantity is the sum of its stock ledger rows, and is not negative (P120)",
    // A bucket is warehouse, location, lot and status; the location is null in a warehouse without locations.
    sql: `SELECT b.id, b.warehouse_id, b.location_id, b.tracking_id, b.stock_status_id, b.qty_balance,
                 COALESCE((SELECT SUM(l.qty_change) FROM log_stock_ledger l
                   WHERE l.warehouse_id = b.warehouse_id AND l.location_id IS NOT DISTINCT FROM b.location_id
                     AND l.tracking_id = b.tracking_id AND l.stock_status_id = b.stock_status_id), 0) AS ledger
          FROM log_stock_balance b
          WHERE b.qty_balance < 0 OR b.qty_balance <> COALESCE((SELECT SUM(l.qty_change) FROM log_stock_ledger l
                   WHERE l.warehouse_id = b.warehouse_id AND l.location_id IS NOT DISTINCT FROM b.location_id
                     AND l.tracking_id = b.tracking_id AND l.stock_status_id = b.stock_status_id), 0)
          UNION ALL
          SELECT NULL, l.warehouse_id, l.location_id, l.tracking_id, l.stock_status_id, NULL, SUM(l.qty_change)
          FROM log_stock_ledger l
          WHERE NOT EXISTS (SELECT 1 FROM log_stock_balance b WHERE b.warehouse_id = l.warehouse_id AND b.location_id IS NOT DISTINCT FROM l.location_id
                              AND b.tracking_id = l.tracking_id AND b.stock_status_id = l.stock_status_id)
          GROUP BY l.warehouse_id, l.location_id, l.tracking_id, l.stock_status_id`,
  },
  {
    area: "stock",
    name: "each item's pool is the sum of its valuation rows, not negative, empty in value when empty in quantity, its average V ÷ Q (P114)",
    sql: `SELECT b.item_id, b.qty_balance, b.value_balance, b.avg_unit_cost, l.q, l.v
          FROM log_stock_valuation_balance b
          LEFT JOIN (SELECT item_id, SUM(qty_change) AS q, SUM(value_change) AS v FROM log_stock_valuation_ledger GROUP BY item_id) l ON l.item_id = b.item_id
          WHERE b.qty_balance <> COALESCE(l.q, 0) OR b.value_balance <> COALESCE(l.v, 0)
             OR b.qty_balance < 0 OR b.value_balance < 0
             OR (b.qty_balance = 0 AND b.value_balance <> 0)
             OR b.avg_unit_cost <> CASE WHEN b.qty_balance > 0 THEN ROUND(b.value_balance / b.qty_balance, 6) ELSE 0 END`,
  },
  {
    area: "stock",
    name: "the two stock books move together: per posting and item, the same quantity and value; and each item's pool holds every bucket",
    sql: `SELECT 'per posting' AS kind, COALESCE(s.source_doc_type_id, v.source_doc_type_id) AS doc_type, COALESCE(s.source_doc_id, v.source_doc_id) AS doc,
                 COALESCE(s.item_id, v.item_id) AS item_id, s.q AS stock_qty, v.q AS valuation_qty, s.v AS stock_value, v.v AS valuation_value
          FROM (SELECT source_doc_type_id, source_doc_id, item_id, SUM(qty_change) q, SUM(value_change) v, COUNT(*) n FROM log_stock_ledger GROUP BY 1, 2, 3) s
          FULL JOIN (SELECT source_doc_type_id, source_doc_id, item_id, SUM(qty_change) q, SUM(value_change) v, COUNT(*) n FROM log_stock_valuation_ledger GROUP BY 1, 2, 3) v
            ON v.source_doc_type_id = s.source_doc_type_id AND v.source_doc_id = s.source_doc_id AND v.item_id = s.item_id
          WHERE s.q IS DISTINCT FROM v.q OR s.v IS DISTINCT FROM v.v OR s.n IS DISTINCT FROM v.n
          UNION ALL
          SELECT 'per item', NULL, NULL, p.item_id, b.q, p.qty_balance, NULL, NULL
          FROM log_stock_valuation_balance p
          LEFT JOIN (SELECT item_id, SUM(qty_balance) q FROM log_stock_balance GROUP BY item_id) b ON b.item_id = p.item_id
          WHERE p.qty_balance <> COALESCE(b.q, 0)`,
  },
  {
    area: "stock",
    name: "every lot belongs to an item kept in stock, and an item with Memiliki Kadaluarsa has its expiry",
    sql: `SELECT t.id, t.tracking_no, m.item_label, m.track_stock, m.has_expiry, t.expiry_date
          FROM log_stock_tracking t JOIN m_item m ON m.id = t.item_id
          WHERE m.item_type <> 'Barang' OR NOT m.track_stock OR (m.has_expiry AND t.expiry_date IS NULL)`,
  },
  {
    area: "stock",
    name: "stock held in a warehouse with Gunakan Lokasi names one of its own locations, and stock elsewhere names none",
    // Held stock only: a warehouse may switch Gunakan Lokasi on once empty, so its past rows may have none.
    sql: `SELECT b.id, w.warehouse_label, w.use_location, b.location_id, loc.warehouse_id AS location_warehouse, b.qty_balance
          FROM log_stock_balance b
          JOIN ref_warehouse w ON w.id = b.warehouse_id
          LEFT JOIN ref_warehouse_location loc ON loc.id = b.location_id
          WHERE b.qty_balance <> 0
            AND ((w.use_location AND b.location_id IS NULL)
              OR (NOT w.use_location AND b.location_id IS NOT NULL)
              OR (b.location_id IS NOT NULL AND loc.warehouse_id <> b.warehouse_id))`,
  },
  // ------------------------------------------------------------ production
  {
    area: "production",
    name: "every posted Tagihan Biaya Produksi has a posted journal naming it, at its total; no other has one (P150 M68)",
    sql: `SELECT b.bill_no, b.status::text, b.total_amount, SUM(l.debit_amount) AS journal_debit
          FROM prd_cost_bill b
          LEFT JOIN acc_journal j ON j.id = b.journal_id
          LEFT JOIN acc_journal_line l ON l.journal_id = j.id
          GROUP BY b.id, j.id
          HAVING (b.status = 'Posted' AND (j.id IS NULL OR j.status <> 'Posted' OR j.source_doc_type_id <> ${docType("prd_cost_bill")} OR j.source_doc_id <> b.id
                                          OR COALESCE(SUM(l.debit_amount), 0) <> b.total_amount))
              OR (b.status <> 'Posted' AND b.journal_id IS NOT NULL)`,
  },
  {
    area: "production",
    name: "each posted Tagihan Biaya Produksi's lines equal its cost-ledger rows; no other bill has rows (P150 M60)",
    sql: `SELECT b.bill_no, b.status::text, b.total_amount, COALESCE(c.amount, 0) AS cost_rows, COALESCE(c.n, 0) AS rows_count
          FROM prd_cost_bill b
          LEFT JOIN (SELECT source_doc_id, SUM(amount) AS amount, COUNT(*) AS n FROM prd_cost_ledger
                     WHERE source_doc_type_id = ${docType("prd_cost_bill")} GROUP BY source_doc_id) c ON c.source_doc_id = b.id
          WHERE (b.status = 'Posted' AND (COALESCE(c.amount, 0) <> b.total_amount
                                         OR COALESCE(c.n, 0) <> (SELECT COUNT(*) FROM prd_cost_bill_line x WHERE x.bill_id = b.id)))
             OR (b.status <> 'Posted' AND c.n IS NOT NULL)`,
  },
  {
    area: "production",
    name: "each cost-ledger row names its element's own account (P150 M53)",
    sql: `SELECT c.ledger_no, c.line_no, c.account_id, e.account_id AS element_account
          FROM prd_cost_ledger c JOIN acc_production_cost_element e ON e.id = c.element_id
          WHERE c.account_id <> e.account_id`,
  },
  {
    area: "production",
    name: "a Tagihan Biaya Produksi's paid amount equals its posted payment lines; only a bill posted on its payable records one (P132, M68, P151)",
    sql: `SELECT b.bill_no, b.payable_account_id, b.total_amount, b.paid_amount, COALESCE(p.paid, 0) AS lines
          FROM prd_cost_bill b
          LEFT JOIN (SELECT l.doc_id, SUM(l.settled_amount) AS paid FROM fin_cash_bank_tx_line l
                     JOIN fin_cash_bank_tx t ON t.id = l.tx_id AND t.status = 'Posted'
                     WHERE l.doc_type_id = ${docType("prd_cost_bill")} GROUP BY l.doc_id) p ON p.doc_id = b.id
          WHERE b.paid_amount <> COALESCE(p.paid, 0) OR b.paid_amount > b.total_amount OR (b.payable_account_id IS NULL AND b.paid_amount <> 0)`,
  },
  {
    // A warning, never acted on (M67): the cost ledger is the source of truth;
    // a row here means something posted to an element account outside a
    // Tagihan Biaya Produksi (a manual journal), or the reverse.
    area: "production",
    name: "per element account, the cost ledger equals the GL, closing journals aside (warning, P150 M67)",
    sql: `WITH acc AS (SELECT DISTINCT account_id FROM acc_production_cost_element),
               cl AS (SELECT account_id, SUM(amount) AS amount FROM prd_cost_ledger GROUP BY account_id),
               gl AS (SELECT l.account_id, SUM(l.debit_amount - l.kredit_amount) AS amount
                      FROM acc_journal_line l JOIN acc_journal j ON j.id = l.journal_id AND j.status = 'Posted'
                      LEFT JOIN sys_doc_type d ON d.id = j.source_doc_type_id
                      WHERE COALESCE(d.doc_table, '') <> 'acc_fiscal_year' AND l.account_id IN (SELECT account_id FROM acc)
                      GROUP BY l.account_id)
          SELECT a.account_id, COALESCE(cl.amount, 0) AS cost_ledger, COALESCE(gl.amount, 0) AS gl
          FROM acc a LEFT JOIN cl ON cl.account_id = a.account_id LEFT JOIN gl ON gl.account_id = a.account_id
          WHERE COALESCE(cl.amount, 0) <> COALESCE(gl.amount, 0)`,
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
