# ERP — database schema (DBML)

The current schema as DBML, kept in step with `prisma/schema.prisma`: every
migration updates this file in the same change (Claude-ERP.md §9).

- **As of migration:** `20260929233202_retire_currency_and_pph22_defaults`
- **Source of truth:** `prisma/schema.prisma` — this file is its readable
  mirror; where they differ, the schema wins and this file is corrected.
- **One company** (P9): no table carries a company. Budget, Cash Bank
  Transaction, Transfer, Debit / Credit Note, Funding Request and the subject
  books are not carried (P10, P19, P25). SIBA's rate layers were removed
  (P37): a foreign Cash & Bank resource is valued at its moving average,
  `cash_bank_balance.base_balance ÷ balance`.
- `sys_region_*` hold Indonesia's provinsi → kota/kabupaten → kecamatan →
  kelurahan/desa with each kelurahan's kode pos. They are system reference data
  seeded from `prisma/data/region.tsv.gz`. A Partner address stores only its
  kelurahan (P39).
- Reference masters `ref_uom`, `ref_payment_term`, `ref_warehouse` and
  `ref_withholding_tax` (P43, P44). There is no tax-code table: whether a line
  carries PPN is an enum on the transaction (P45).
- `m_item` with its unit conversions `m_item_uom` and the seeded, menu-less
  `sys_item_category` (P46–P48). An Item holds no price and no tax treatment.
- Sales: `sal_customer_order` and `sal_customer_order_line` (P49–P53, P78) —
  the Customer Order (the Sales Order until P78), `CO/…`, Barang only, rupiah
  only, totals stored as `lib/erp/sales-tax.ts` computed them. It posts
  nothing. Its life is Draft → Submitted → Open → Closed, with Cancelled and
  Rejected final (P63); it names no warehouse and no delivery date.
- `sal_order` and `sal_order_line` (P79) — the Sales Order, `SO/…`: a dated
  part of one Open Customer Order released to PPIC. Quantity and delivery
  date only; each line names the Customer Order line it takes from
  (`customer_order_line_id`, once per order) and reads its item and unit
  there. Life: Draft → Submitted → PreSO (Pra-SO) → Open → Closed, with
  Cancelled and Rejected final. Posts nothing; not an AR item.
- `sal_delivery_order` and `sal_delivery_order_line` (P93) — the Delivery
  Order, `DO/…`: the instruction to one warehouse (`warehouse_id`) to send
  goods of one Customer Order to one address on one date. Each line takes a
  quantity of one line of that order's Open Sales Orders
  (`sales_order_line_id`, once per Delivery Order). Life: Draft → Issued →
  Closed, with Cancelled final. Posts nothing; the Delivery Note will.
- `sal_delivery_note` and `sal_delivery_note_line` (P94) — the Delivery Note,
  `SJ/…`: the goods leaving, from one issued Delivery Order whose Customer
  Order, customer, warehouse and address it copies. Each line takes a quantity
  of one Delivery Order line and, at Posting, stores its base quantity, unit
  cost and cost. Posting writes the journal (`journal_id`) Dr HPP / Cr
  Persediaan. `delivered_qty` on `sal_order_line` and `sal_delivery_order_line`
  is what posted notes sent of each line. `sal_delivery_note_pick` (P95) is the
  stock picking of a line of a Barang with Kelola Stok: one row per lot, with
  the lot number and expiry copied, and its cost once posted.
- `sal_invoice`, `sal_invoice_line` and `sal_invoice_advance_deduction` (P97)
  — the Faktur Penjualan, `INV/…`: one Customer Order; each line is one whole
  posted Delivery Note line (`delivery_note_line_id`, billed by at most one
  live Faktur) priced from its Customer Order line; each deduction an Uang
  Muka AR item (by id, no foreign key: AR items are a book) and the DPP used.
  Its own `invoice_date`; `tax_date` and `due_date` from the latest Tanggal
  Kirim. Posting writes the journal and the Invoice AR item (`ar_item_id`).
  `delivered_qty` on `sal_customer_order_line` (P97) is what its Sales Order
  lines delivered; the order closes itself once all is delivered.
- `tmp_item_cost`, `tmp_stock_lot` and `tmp_stock_movement` (P94, P95) —
  **temporary**: the stand-in inventory's Harga Pokok per item, its lots per
  item and warehouse, and its issue log (one row per lot issued), named only by
  `lib/erp/inventory.ts`; dropped when inventory is built.
- `sal_advance` (P54–P58) — the AR advance bill, drawn from one Open
  Customer Order (`customer_order_id`) and numbered `ARA/…`. It posts nothing
  and stores no paid or used amount; that is left to the open items (C22).
- `fin_cash_bank_tx` (P66–P70) — Penerimaan and Pengeluaran Kas & Bank in one
  table (`BKM/…`, `BKK/…`). Its purpose is a key of the catalogue in code.
  `fin_cash_bank_tx_line` names each settled document by the weak
  `(doc_type_id, doc_id)` pair and stores its DPP / PPN parts;
  `fin_cash_bank_tx_line_wht` holds its PPh per Jenis PPh — the unit one
  Bukti Potong is made from. Posting writes the journal and the Cash Bank Book.
- `fin_ar_item` and `fin_ar_ledger` (P71–P75) — AR items (Uang Muka and
  Invoice) and Buku Piutang, the append-only history of every change to an
  item's balance. `current_balance` equals the sum of the item's entries. An
  item is numbered `ARI/…`, names the document it is **about** (the advance
  bill, the Faktur) by the weak pair and its Customer Order by id; what
  created it is its Create entry's document (P96, U1). It carries its own tax
  document's figures (`tax_*`, U9). There is no allocation table.
- `sal_customer_order` and `sal_advance` snapshot the PPN rate and DPP Nilai
  Lain factor they were computed with (P60); each `sal_customer_order_line` stores its own DPP Nilai
  Lain, since PPN is computed per line.
- `created_by` / `updated_by` hold a user id with no foreign key, as in SIBA.
- Money is `decimal(18, 2)`, rates `decimal(18, 6)`. Calendar dates are `date`,
  timestamps `timestamptz`.
- Document numbers read `PREFIX/YYYY/MM/NNNN`, one series per month (P15).

Paste the block below into <https://dbdiagram.io> to draw it.

```dbml
Enum ActiveStatus {
  Active
  Inactive
}

Enum CashBankType {
  Cash
  Bank
}

Enum NormalBalance {
  Debit
  Kredit
}

Enum AccountSection {
  BalanceSheet
  ProfitLoss
}

Enum ProfitLossGroup {
  OperatingRevenue
  CostOfSales
  OperatingExpense
  OtherIncome
  OtherExpense
}

Enum FiscalStatus {
  Draft
  Open
  Closed
}

Enum FiscalClosingStatus {
  Open
  Closed
}

Enum FlowDirection {
  In
  Out
}

Enum AuditAction {
  TAMBAH
  UPDATE
  HAPUS
}

Enum TaxpayerType {
  Badan
  OrangPribadi
  InstansiPemerintah
}

Enum TaxIdType {
  NPWP
  NIK
}

Enum VatCollector {
  None
  Government
}

Enum PriceMode {
  Exclude
  Include
}

Enum CustomerOrderStatus {
  Draft
  Submitted
  Open
  Closed
  Cancelled
  Rejected
}

Enum SalesOrderStatus {
  Draft
  Submitted
  PreSO
  Open
  Closed
  Cancelled
  Rejected
}

Enum DeliveryOrderStatus {
  Draft
  Issued
  Closed
  Cancelled
}

Enum DeliveryNoteStatus {
  Draft
  Posted
  Cancelled
}

Enum InvoiceStatus {
  Draft
  Posted
  Cancelled
}

Enum DiscountType {
  Percent
  Amount
}

Enum AdvanceStatus {
  Draft
  Issued
  Cancelled
}

Enum AdvanceAmountType {
  Percent
  Amount
}

Enum ItemType {
  Barang
  Jasa
}

Enum CashBankEntryType {
  Opening
  Transaction
  Adjustment
}

Enum JournalStatus {
  Draft
  Posted
  Cancelled
}

Table sys_user {
  id int [pk, increment, not null]
  user_code varchar [unique, not null]
  email varchar [unique, not null]
  name varchar [not null]
  initials varchar [not null]
  password_hash varchar [not null]
  status ActiveStatus [not null, default: 'Active']
  created_by int [null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]
}

Table sys_role {
  id int [pk, increment, not null]
  role_code varchar [unique, not null]
  role_label varchar [unique, not null]
  role_name varchar [not null]
  is_system boolean [not null, default: false]
  note varchar [null]
  status ActiveStatus [not null, default: 'Active']
  created_by int [null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]
}

Table sys_permission {
  id int [pk, increment, not null]
  permission_code varchar [unique, not null]
  permission_name varchar [not null]
  module varchar [not null]
  description varchar [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    module
  }
}

Table sys_setting {
  id int [pk, increment, not null]
  setting_key varchar [unique, not null]
  setting_value varchar [null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]
}

Table sys_user_role {
  id int [pk, increment, not null]
  user_id int [not null]
  role_id int [not null]
  created_by int [null]
  created_at timestamptz [not null, default: `now()`]

  indexes {
    (user_id, role_id) [unique]
    user_id
  }
}

Table sys_role_permission {
  id int [pk, increment, not null]
  role_id int [not null]
  permission_id int [not null]
  created_by int [null]
  created_at timestamptz [not null, default: `now()`]

  indexes {
    (role_id, permission_id) [unique]
    role_id
  }
}

Table sys_session {
  id int [pk, increment, not null]
  token_hash varchar [unique, not null]
  user_id int [not null]
  expires_at timestamptz [not null]
  last_seen_at timestamptz [not null, default: `now()`]
  revoked_at timestamptz [null]
  created_at timestamptz [not null, default: `now()`]

  indexes {
    user_id
    expires_at
  }
}

Table sys_account_type {
  id int [pk, increment, not null]
  type_code varchar [unique, not null]
  type_label varchar [unique, not null]
  type_name varchar [not null]
  section AccountSection [not null]
  normal_balance NormalBalance [not null]
  note varchar [null]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]
}

Table sys_doc_type {
  id int [pk, increment, not null]
  doc_code varchar [unique, not null]
  doc_label varchar [not null]
  doc_name varchar [not null]
  doc_table varchar [not null]
  note varchar [null]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]
}

Table sys_partner_category {
  id int [pk, increment, not null]
  category_code varchar [unique, not null]
  category_label varchar [not null]
  category_name varchar [not null]
  note varchar [null]
  status ActiveStatus [not null, default: 'Active']
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]
}

Table ref_currency {
  id int [pk, increment, not null]
  currency_code varchar [unique, not null]
  currency_label varchar [not null]
  currency_name varchar [not null]
  note varchar [null]
  status ActiveStatus [not null, default: 'Active']
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]
}

Table ref_uom {
  id int [pk, increment, not null]
  uom_code varchar [unique, not null]
  uom_label varchar [not null]
  uom_name varchar [not null]
  note varchar [null]
  status ActiveStatus [not null, default: 'Active']
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]
}

Table sys_item_category {
  id int [pk, increment, not null]
  category_code varchar [unique, not null]
  category_label varchar [unique, not null]
  category_name varchar [not null]
  item_type ItemType [not null]
  status ActiveStatus [not null, default: 'Active']
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    item_type
  }
}

Table m_item {
  id int [pk, increment, not null]
  item_code varchar [unique, not null]
  item_label varchar [not null]
  item_name varchar [not null]
  item_type ItemType [not null]
  category_id int [not null]
  base_uom_id int [not null]
  can_sell boolean [not null, default: true]
  can_buy boolean [not null, default: false]
  track_stock boolean [not null, default: false]
  has_expiry boolean [not null, default: false]
  note varchar [null]
  status ActiveStatus [not null, default: 'Active']
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    category_id
    base_uom_id
  }
}

Table m_item_uom {
  id int [pk, increment, not null]
  item_id int [not null]
  uom_id int [not null]
  factor decimal(18, 4) [not null]
  sort_order int [not null, default: 0]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    (item_id, uom_id) [unique]
    uom_id
  }
}

Table ref_payment_term {
  id int [pk, increment, not null]
  term_code varchar [unique, not null]
  term_label varchar [not null]
  term_name varchar [not null]
  due_days int [not null]
  note varchar [null]
  status ActiveStatus [not null, default: 'Active']
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]
}

Table ref_warehouse {
  id int [pk, increment, not null]
  warehouse_code varchar [unique, not null]
  warehouse_label varchar [not null]
  warehouse_name varchar [not null]
  note varchar [null]
  status ActiveStatus [not null, default: 'Active']
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]
}

Table ref_withholding_tax {
  id int [pk, increment, not null]
  wht_code varchar [unique, not null]
  wht_label varchar [not null]
  wht_name varchar [not null]
  rate decimal(9, 4) [not null]
  tax_object varchar [null]
  prepaid_account_id int [null]
  note varchar [null]
  status ActiveStatus [not null, default: 'Active']
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    prepaid_account_id
  }
}

Table m_partner {
  id int [pk, increment, not null]
  partner_code varchar [unique, not null]
  partner_label varchar [not null]
  partner_name varchar [not null]
  category_id int [not null]
  note varchar [null]
  status ActiveStatus [not null, default: 'Active']
  taxpayer_type TaxpayerType [null]
  is_pkp boolean [not null, default: false]
  tax_id_type TaxIdType [null]
  tax_id varchar [null]
  tax_name varchar [null]
  withholds_pph23 boolean [not null, default: false]
  collects_pph22 boolean [not null, default: false]
  vat_collector VatCollector [null]
  default_term_id int [null]
  default_price_mode PriceMode [null]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    category_id
  }
}

Table m_partner_address {
  id int [pk, increment, not null]
  partner_id int [not null]
  village_id int [not null]
  street varchar [not null]
  note varchar [null]
  is_billing boolean [not null, default: false]
  is_shipping boolean [not null, default: false]
  sort_order int [not null, default: 0]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    partner_id
    village_id
  }
}

Table m_partner_contact {
  id int [pk, increment, not null]
  partner_id int [not null]
  contact_name varchar [not null]
  position varchar [not null]
  phone varchar [not null]
  email varchar [not null]
  sort_order int [not null, default: 0]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    partner_id
  }
}

Table sys_region_province {
  id int [pk, increment, not null]
  code varchar [unique, not null]
  name varchar [not null]
}

Table sys_region_city {
  id int [pk, increment, not null]
  code varchar [unique, not null]
  name varchar [not null]
  province_id int [not null]

  indexes {
    province_id
  }
}

Table sys_region_district {
  id int [pk, increment, not null]
  code varchar [unique, not null]
  name varchar [not null]
  city_id int [not null]

  indexes {
    city_id
  }
}

Table sys_region_village {
  id int [pk, increment, not null]
  code varchar [unique, not null]
  name varchar [not null]
  district_id int [not null]
  postal_code varchar [null]

  indexes {
    district_id
  }
}

Table m_cash_bank {
  id int [pk, increment, not null]
  cash_bank_code varchar [unique, not null]
  cash_bank_label varchar [not null]
  cash_bank_name varchar [not null]
  cash_bank_type CashBankType [not null]
  currency_id int [not null]
  account_id int [not null]
  note varchar [null]
  status ActiveStatus [not null, default: 'Active']
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]
}

Table cash_bank_ledger {
  id int [pk, increment, not null]
  entry_no varchar [unique, not null]
  cash_bank_id int [not null]
  entry_date date [not null]
  entry_type CashBankEntryType [not null]
  direction FlowDirection [not null]
  amount decimal(18, 2) [not null]
  movement decimal(18, 2) [not null]
  balance_after decimal(18, 2) [not null]
  rate decimal(18, 6) [not null]
  base_amount decimal(18, 2) [not null]
  base_movement decimal(18, 2) [not null]
  base_balance_after decimal(18, 2) [not null]
  source_doc_type_id int [null]
  source_doc_id int [null]
  note varchar [null]
  created_by int [not null]
  created_at timestamptz [not null, default: `now()`]

  indexes {
    (cash_bank_id, entry_date)
    (source_doc_type_id, source_doc_id)
  }
}

Table cash_bank_balance {
  cash_bank_id int [pk, not null]
  balance decimal(18, 2) [not null, default: 0]
  base_balance decimal(18, 2) [not null, default: 0]
  entry_count int [not null, default: 0]
  last_entry_id int [null]
  last_entry_date date [null]
  updated_at timestamptz [not null, default: `now()`]
}

Table acc_account_category {
  id int [pk, increment, not null]
  account_type_id int [not null]
  category_code varchar [unique, not null]
  category_label varchar [unique, not null]
  category_name varchar [not null]
  pl_group ProfitLossGroup [null]
  note varchar [null]
  status ActiveStatus [not null, default: 'Active']
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    account_type_id
  }
}

Table acc_account_subcategory {
  id int [pk, increment, not null]
  account_category_id int [not null]
  subcategory_code varchar [unique, not null]
  subcategory_label varchar [unique, not null]
  subcategory_name varchar [not null]
  note varchar [null]
  status ActiveStatus [not null, default: 'Active']
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    account_category_id
  }
}

Table acc_account {
  id int [pk, increment, not null]
  account_subcategory_id int [not null]
  account_code varchar [unique, not null]
  account_label varchar [not null]
  account_name varchar [not null]
  parent_account int [null]
  is_postable boolean [not null, default: true]
  normal_balance NormalBalance [not null]
  require_partner boolean [not null, default: false]
  partner_category_id int [null]
  is_control_account boolean [not null, default: false]
  note varchar [null]
  is_active boolean [not null, default: true]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    account_label [unique]
    account_subcategory_id
  }
}

Table acc_fiscal_year {
  id int [pk, increment, not null]
  year_code varchar [unique, not null]
  year_label varchar [not null]
  year_name varchar [not null]
  start_date date [not null]
  end_date date [not null]
  note varchar [null]
  status FiscalStatus [not null, default: 'Draft']
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]
}

Table acc_fiscal_period {
  id int [pk, increment, not null]
  fiscal_year_id int [not null]
  sequence_no int [not null]
  period_code varchar [unique, not null]
  period_label varchar [not null]
  period_name varchar [not null]
  start_date date [not null]
  end_date date [not null]
  note varchar [null]
  status FiscalStatus [not null, default: 'Draft']
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    fiscal_year_id
  }
}

Table acc_fiscal_closing {
  id int [pk, increment, not null]
  fiscal_year_id int [not null]
  status FiscalClosingStatus [not null, default: 'Open']
  closed_at timestamptz [null]
  closed_by int [null]
  closing_journal_id int [null]
  opening_balance_id int [null]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    fiscal_year_id [unique]
  }
}

Table acc_opening_balance {
  id int [pk, increment, not null]
  opening_no varchar [unique, not null]
  posting_date date [not null]
  fiscal_year_id int [not null]
  source_fiscal_year_id int [null]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    fiscal_year_id [unique]
  }
}

Table acc_opening_balance_line {
  id int [pk, increment, not null]
  opening_id int [not null]
  sequence_no int [not null]
  account_id int [not null]
  partner_id int [null]
  debit_amount decimal(18, 2) [not null, default: 0]
  kredit_amount decimal(18, 2) [not null, default: 0]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    (opening_id, account_id, partner_id) [unique]
    opening_id
  }
}

Table acc_journal {
  id int [pk, increment, not null]
  journal_no varchar [unique, not null]
  posting_date date [null]
  source_doc_type_id int [null]
  source_doc_id int [null]
  description varchar [not null]
  status JournalStatus [not null, default: 'Posted']
  is_manual boolean [not null, default: false]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    posting_date
    (source_doc_type_id, source_doc_id)
  }
}

Table acc_journal_line {
  id int [pk, increment, not null]
  journal_id int [not null]
  sequence_no int [not null]
  account_id int [not null]
  partner_id int [null]
  currency_id int [not null]
  exchange_rate decimal(18, 6) [not null, default: 1]
  debit_amount decimal(18, 2) [not null, default: 0]
  kredit_amount decimal(18, 2) [not null, default: 0]
  trx_amount decimal(18, 2) [not null]
  description varchar [not null]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    journal_id
    account_id
  }
}

Table audit_log {
  id int [pk, increment, not null]
  entity_key varchar [not null]
  row_id int [not null]
  action AuditAction [not null]
  event varchar [null]
  at timestamptz [not null, default: `now()`]
  by int [not null]

  indexes {
    (entity_key, row_id)
  }
}

Table sal_customer_order {
  id int [pk, increment, not null]
  order_no varchar [unique, not null]
  order_date date [not null]
  status CustomerOrderStatus [not null, default: 'Draft']
  customer_id int [not null]
  address_id int [not null]
  term_id int [not null]
  is_taxable boolean [not null, default: true]
  price_mode PriceMode [not null]
  ppn_rate decimal(9, 4) [null]
  ppn_dpp_other_numerator int [null]
  ppn_dpp_other_denominator int [null]
  po_no varchar [null]
  po_date date [null]
  salesperson varchar [null]
  note varchar [null]
  gross_amount decimal(18, 2) [not null, default: 0]
  discount_amount decimal(18, 2) [not null, default: 0]
  dpp_amount decimal(18, 2) [not null, default: 0]
  dpp_other_amount decimal(18, 2) [not null, default: 0]
  ppn_amount decimal(18, 2) [not null, default: 0]
  total_amount decimal(18, 2) [not null, default: 0]
  status_reason varchar [null, note: 'why it was cancelled, rejected or closed by hand']
  copied_from_id int [null]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    customer_id
    (status, order_date)
  }
}

Table sal_customer_order_line {
  id int [pk, increment, not null]
  order_id int [not null]
  line_no int [not null]
  item_id int [not null]
  uom_id int [not null]
  uom_factor decimal(18, 4) [not null]
  qty decimal(18, 4) [not null]
  price decimal(18, 2) [not null]
  discount_type DiscountType [null]
  discount_value decimal(18, 4) [null]
  discount_amount decimal(18, 2) [not null, default: 0]
  amount decimal(18, 2) [not null]
  dpp_amount decimal(18, 2) [not null]
  dpp_other_amount decimal(18, 2) [not null, default: 0]
  ppn_amount decimal(18, 2) [not null]
  withholding_tax_id int [null]
  withholding_rate decimal(9, 4) [null]
  delivered_qty decimal(18, 4) [not null, default: 0, note: 'what posted Delivery Notes sent (U21)']
  note varchar [null]

  indexes {
    (order_id, line_no) [unique]
    item_id
  }
}

Table sal_order {
  id int [pk, increment, not null]
  order_no varchar [unique, not null, note: 'SO/YYYY/MM/NNNN']
  order_date date [not null]
  delivery_date date [not null, note: 'what PPIC plans to']
  status SalesOrderStatus [not null, default: 'Draft']
  customer_order_id int [not null]
  customer_id int [not null, note: 'the Customer Order customer, for the list']
  address_id int [not null, note: 'any of the customer addresses; starts on the Customer Order one']
  note varchar [null]
  status_reason varchar [null]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    customer_order_id
    (status, delivery_date)
  }
}

Table sal_order_line {
  id int [pk, increment, not null]
  order_id int [not null]
  line_no int [not null]
  customer_order_line_id int [not null, note: 'its item and unit are read there']
  qty decimal(18, 4) [not null]
  delivered_qty decimal(18, 4) [not null, default: 0, note: 'what posted Delivery Notes sent; a closed order holds only this']
  note varchar [null]

  indexes {
    (order_id, line_no) [unique]
    (order_id, customer_order_line_id) [unique]
    customer_order_line_id
  }
}

Table sal_delivery_order {
  id int [pk, increment, not null]
  do_no varchar [unique, not null, note: 'DO/YYYY/MM/NNNN']
  do_date date [not null]
  delivery_date date [not null, note: 'when the goods are to leave']
  status DeliveryOrderStatus [not null, default: 'Draft']
  customer_order_id int [not null]
  customer_id int [not null, note: 'the Customer Order customer, for the list']
  warehouse_id int [not null, note: 'the one warehouse the goods leave from']
  address_id int [not null, note: 'any of the customer addresses; starts on the first Sales Order picked']
  note varchar [null]
  status_reason varchar [null]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    customer_order_id
    (status, delivery_date)
  }
}

Table sal_delivery_order_line {
  id int [pk, increment, not null]
  delivery_order_id int [not null]
  line_no int [not null]
  sales_order_line_id int [not null, note: 'a line of an Open Sales Order of the same Customer Order']
  qty decimal(18, 4) [not null]
  delivered_qty decimal(18, 4) [not null, default: 0, note: 'what posted Delivery Notes sent; a closed order holds only this']
  note varchar [null]

  indexes {
    (delivery_order_id, line_no) [unique]
    (delivery_order_id, sales_order_line_id) [unique]
    sales_order_line_id
  }
}

Table sal_delivery_note {
  id int [pk, increment, not null]
  dn_no varchar [unique, not null, note: 'SJ/YYYY/MM/NNNN']
  dn_date date [not null, note: 'the day the goods leave; the journal date']
  status DeliveryNoteStatus [not null, default: 'Draft']
  delivery_order_id int [not null]
  customer_order_id int [not null, note: 'copied from the Delivery Order']
  customer_id int [not null]
  warehouse_id int [not null]
  address_id int [not null]
  vehicle_no varchar [null]
  driver_name varchar [null]
  note varchar [null]
  cost_amount decimal(18, 2) [not null, default: 0, note: 'sum of the lines, set at Posting']
  journal_id int [null, note: 'Dr HPP / Cr Persediaan']
  cancel_reason varchar [null]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    delivery_order_id
    customer_order_id
    (status, dn_date)
  }
}

Table sal_delivery_note_line {
  id int [pk, increment, not null]
  delivery_note_id int [not null]
  line_no int [not null]
  delivery_order_line_id int [not null]
  qty decimal(18, 4) [not null, note: 'in the Customer Order line unit']
  base_qty decimal(18, 4) [not null, default: 0, note: 'qty x unit factor, set at Posting']
  unit_cost decimal(18, 2) [not null, default: 0, note: 'what the inventory issued at']
  cost_amount decimal(18, 2) [not null, default: 0]
  note varchar [null]

  indexes {
    (delivery_note_id, line_no) [unique]
    (delivery_note_id, delivery_order_line_id) [unique]
    delivery_order_line_id
  }
}

Table sal_delivery_note_pick {
  id int [pk, increment, not null]
  delivery_note_line_id int [not null]
  pick_no int [not null]
  lot_id int [not null, note: 'the inventory lot; no FK (stand-in today)']
  lot_no varchar [not null, note: 'as printed on the note']
  expiry_date date [null]
  qty decimal(18, 4) [not null, note: 'in the line unit']
  base_qty decimal(18, 4) [not null, default: 0, note: 'set at Posting']
  unit_cost decimal(18, 2) [not null, default: 0]
  cost_amount decimal(18, 2) [not null, default: 0]

  indexes {
    (delivery_note_line_id, pick_no) [unique]
    (delivery_note_line_id, lot_id) [unique]
    lot_id
  }
}

Table sal_invoice {
  id int [pk, increment, not null]
  invoice_no varchar [unique, not null, note: 'INV/YYYY/MM/NNNN']
  invoice_date date [not null, note: 'typed; the journal date']
  tax_date date [not null, note: 'latest Tanggal Kirim billed; the faktur pajak date']
  due_date date [not null, note: 'tax_date + Termin days']
  status InvoiceStatus [not null, default: 'Draft']
  customer_order_id int [not null]
  customer_id int [not null]
  address_id int [not null, note: 'billing address, any of the customer']
  cash_bank_id int [not null, note: 'printed: where to pay']
  price_mode PriceMode [not null, note: 'the order, copied']
  is_taxable boolean [not null]
  ppn_rate decimal(9, 4) [null]
  ppn_dpp_other_numerator int [null]
  ppn_dpp_other_denominator int [null]
  amount decimal(18, 2) [not null, default: 0]
  dpp_amount decimal(18, 2) [not null, default: 0, note: 'DPP of the goods billed']
  advance_dpp_amount decimal(18, 2) [not null, default: 0, note: 'Uang Muka used']
  net_dpp_amount decimal(18, 2) [not null, default: 0]
  dpp_other_amount decimal(18, 2) [not null, default: 0]
  ppn_amount decimal(18, 2) [not null, default: 0, note: 'on the net DPP, per line']
  total_amount decimal(18, 2) [not null, default: 0, note: 'net Piutang']
  tax_invoice_no varchar [null, note: 'Coretax number, typed after upload']
  journal_id int [null]
  ar_item_id int [null, note: 'the Invoice AR item; none when nothing is left to pay']
  note varchar [null]
  cancel_reason varchar [null]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    customer_order_id
    (status, invoice_date)
  }
}

Table sal_invoice_line {
  id int [pk, increment, not null]
  invoice_id int [not null]
  line_no int [not null]
  delivery_note_line_id int [not null, note: 'taken whole (U17)']
  customer_order_line_id int [not null]
  qty decimal(18, 4) [not null]
  price decimal(18, 2) [not null]
  amount decimal(18, 2) [not null]
  dpp_amount decimal(18, 2) [not null]
  advance_dpp_amount decimal(18, 2) [not null, default: 0, note: 'its share of the Uang Muka used']
  net_dpp_amount decimal(18, 2) [not null]
  dpp_other_amount decimal(18, 2) [not null, default: 0]
  ppn_amount decimal(18, 2) [not null, default: 0]
  withholding_tax_id int [null]
  withholding_rate decimal(9, 4) [null]

  indexes {
    (invoice_id, line_no) [unique]
    (invoice_id, delivery_note_line_id) [unique]
    delivery_note_line_id
    customer_order_line_id
  }
}

Table sal_invoice_advance_deduction {
  id int [pk, increment, not null]
  invoice_id int [not null]
  ar_item_id int [not null, note: 'weak: an Uang Muka AR item of the same order']
  ar_item_no varchar [not null]
  dpp_used decimal(18, 2) [not null]

  indexes {
    (invoice_id, ar_item_id) [unique]
    ar_item_id
  }
}

Table tmp_stock_lot {
  id int [pk, increment, not null, note: 'TEMPORARY until inventory is built']
  item_id int [not null]
  warehouse_id int [not null]
  lot_no varchar [not null]
  expiry_date date [null, note: 'required when the item has an expiry']
  status ActiveStatus [not null, default: 'Active']
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    (item_id, warehouse_id, lot_no) [unique]
  }
}

Table tmp_item_cost {
  id int [pk, increment, not null, note: 'TEMPORARY until inventory is built']
  item_id int [unique, not null]
  unit_cost decimal(18, 2) [not null, note: 'Harga Pokok per base unit']
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]
}

Table tmp_stock_movement {
  id int [pk, increment, not null, note: 'TEMPORARY until inventory is built']
  item_id int [not null]
  warehouse_id int [not null]
  movement_date date [not null]
  lot_id int [null, note: 'the lot issued, for an item kept by lot']
  lot_no varchar [null]
  base_qty_out decimal(18, 4) [not null]
  unit_cost decimal(18, 2) [not null]
  cost_amount decimal(18, 2) [not null]
  source_doc_type_id int [not null]
  source_doc_id int [not null]
  source_no varchar [not null]
  created_by int [not null]
  created_at timestamptz [not null, default: `now()`]

  indexes {
    (item_id, warehouse_id, movement_date)
    (source_doc_type_id, source_doc_id)
  }
}

Table sal_advance {
  id int [pk, increment, not null]
  advance_no varchar [unique, not null]
  advance_date date [not null]
  due_date date [not null]
  status AdvanceStatus [not null, default: 'Draft']
  customer_order_id int [not null]
  customer_id int [not null]
  cash_bank_id int [not null]
  description varchar [not null]
  note varchar [null]
  price_mode PriceMode [not null]
  is_taxable boolean [not null]
  ppn_rate decimal(9, 4) [null]
  ppn_dpp_other_numerator int [null]
  ppn_dpp_other_denominator int [null]
  amount_type AdvanceAmountType [not null]
  amount_value decimal(18, 4) [not null]
  amount decimal(18, 2) [not null]
  dpp_amount decimal(18, 2) [not null]
  dpp_other_amount decimal(18, 2) [not null]
  ppn_amount decimal(18, 2) [not null]
  total_amount decimal(18, 2) [not null]
  cancel_reason varchar [null]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    customer_order_id
    customer_id
    (status, advance_date)
  }
}

Ref: sys_user_role.user_id > sys_user.id
Ref: sys_user_role.role_id > sys_role.id
Ref: sys_role_permission.role_id > sys_role.id
Ref: sys_role_permission.permission_id > sys_permission.id
Ref: sys_session.user_id > sys_user.id
Ref: m_item.category_id > sys_item_category.id
Ref: m_item.base_uom_id > ref_uom.id
Ref: m_item_uom.item_id > m_item.id
Ref: m_item_uom.uom_id > ref_uom.id
Ref: ref_withholding_tax.prepaid_account_id > acc_account.id
Ref: m_partner.category_id > sys_partner_category.id
Ref: m_partner.default_term_id > ref_payment_term.id
Ref: m_partner_address.partner_id > m_partner.id
Ref: m_partner_address.village_id > sys_region_village.id
Ref: m_partner_contact.partner_id > m_partner.id
Ref: sys_region_city.province_id > sys_region_province.id
Ref: sys_region_district.city_id > sys_region_city.id
Ref: sys_region_village.district_id > sys_region_district.id
Ref: m_cash_bank.currency_id > ref_currency.id
Ref: m_cash_bank.account_id > acc_account.id
Ref: cash_bank_ledger.cash_bank_id > m_cash_bank.id
Ref: cash_bank_ledger.source_doc_type_id > sys_doc_type.id
Ref: cash_bank_balance.cash_bank_id > m_cash_bank.id
Ref: acc_account_category.account_type_id > sys_account_type.id
Ref: acc_account_subcategory.account_category_id > acc_account_category.id
Ref: acc_account.account_subcategory_id > acc_account_subcategory.id
Ref: acc_account.partner_category_id > sys_partner_category.id
Ref: acc_account.parent_account > acc_account.id
Ref: acc_fiscal_period.fiscal_year_id > acc_fiscal_year.id
Ref: acc_fiscal_closing.fiscal_year_id > acc_fiscal_year.id
Ref: acc_opening_balance.fiscal_year_id > acc_fiscal_year.id
Ref: acc_opening_balance.source_fiscal_year_id > acc_fiscal_year.id
Ref: acc_opening_balance_line.opening_id > acc_opening_balance.id
Ref: acc_opening_balance_line.account_id > acc_account.id
Ref: acc_opening_balance_line.partner_id > m_partner.id
Ref: acc_journal.source_doc_type_id > sys_doc_type.id
Ref: acc_journal_line.journal_id > acc_journal.id
Ref: acc_journal_line.account_id > acc_account.id
Ref: acc_journal_line.partner_id > m_partner.id
Ref: acc_journal_line.currency_id > ref_currency.id
Ref: sal_customer_order.customer_id > m_partner.id
Ref: sal_customer_order.address_id > m_partner_address.id
Ref: sal_customer_order.term_id > ref_payment_term.id
Ref: sal_customer_order.copied_from_id > sal_customer_order.id
Ref: sal_customer_order_line.order_id > sal_customer_order.id
Ref: sal_customer_order_line.item_id > m_item.id
Ref: sal_customer_order_line.uom_id > ref_uom.id
Ref: sal_customer_order_line.withholding_tax_id > ref_withholding_tax.id
Ref: sal_advance.customer_order_id > sal_customer_order.id
Ref: sal_order.customer_order_id > sal_customer_order.id
Ref: sal_order.customer_id > m_partner.id
Ref: sal_order.address_id > m_partner_address.id
Ref: sal_order_line.order_id > sal_order.id
Ref: sal_order_line.customer_order_line_id > sal_customer_order_line.id
Ref: sal_delivery_order.customer_order_id > sal_customer_order.id
Ref: sal_delivery_order.customer_id > m_partner.id
Ref: sal_delivery_order.warehouse_id > ref_warehouse.id
Ref: sal_delivery_order.address_id > m_partner_address.id
Ref: sal_delivery_order_line.delivery_order_id > sal_delivery_order.id
Ref: sal_delivery_order_line.sales_order_line_id > sal_order_line.id
Ref: sal_delivery_note.delivery_order_id > sal_delivery_order.id
Ref: sal_delivery_note.customer_order_id > sal_customer_order.id
Ref: sal_delivery_note.customer_id > m_partner.id
Ref: sal_delivery_note.warehouse_id > ref_warehouse.id
Ref: sal_delivery_note.address_id > m_partner_address.id
Ref: sal_delivery_note_line.delivery_note_id > sal_delivery_note.id
Ref: sal_delivery_note_line.delivery_order_line_id > sal_delivery_order_line.id
Ref: sal_delivery_note_pick.delivery_note_line_id > sal_delivery_note_line.id
Ref: sal_invoice.customer_order_id > sal_customer_order.id
Ref: sal_invoice.customer_id > m_partner.id
Ref: sal_invoice.address_id > m_partner_address.id
Ref: sal_invoice.cash_bank_id > m_cash_bank.id
Ref: sal_invoice_line.invoice_id > sal_invoice.id
Ref: sal_invoice_line.delivery_note_line_id > sal_delivery_note_line.id
Ref: sal_invoice_line.customer_order_line_id > sal_customer_order_line.id
Ref: sal_invoice_line.withholding_tax_id > ref_withholding_tax.id
Ref: sal_invoice_advance_deduction.invoice_id > sal_invoice.id
Ref: tmp_stock_lot.item_id > m_item.id
Ref: tmp_stock_lot.warehouse_id > ref_warehouse.id
Ref: tmp_item_cost.item_id - m_item.id
Ref: tmp_stock_movement.item_id > m_item.id
Ref: tmp_stock_movement.warehouse_id > ref_warehouse.id
Ref: sal_advance.customer_id > m_partner.id
Ref: sal_advance.cash_bank_id > m_cash_bank.id

Enum CashBankTxStatus {
  Draft
  Posted
  Cancelled
}

Table fin_cash_bank_tx {
  id int [pk, increment, not null]
  tx_no varchar [unique, not null, note: 'BKM/YYYY/MM/NNNN or BKK/…']
  direction FlowDirection [not null]
  purpose varchar [not null, note: 'key of the purpose catalogue in code']
  tx_date date [not null]
  status CashBankTxStatus [not null, default: 'Draft']
  partner_id int [not null]
  cash_bank_id int [not null]
  bank_ref varchar [null]
  note varchar [null]
  cash_amount decimal(18, 2) [not null, note: 'what reached the resource: the lines\' cash less the bank charge (P76)']
  bank_charge decimal(18, 2) [not null, default: 0]
  settled_amount decimal(18, 2) [not null, default: 0]
  pph_amount decimal(18, 2) [not null, default: 0]
  journal_id int [null]
  cancel_reason varchar [null]
  created_by int [not null]
  updated_by int [null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    (direction, status, tx_date)
    partner_id
  }
}

Table fin_cash_bank_tx_line {
  id int [pk, increment, not null]
  tx_id int [not null]
  line_no int [not null]
  doc_type_id int [not null, note: 'weak reference to the settled document']
  doc_id int [not null]
  settled_amount decimal(18, 2) [not null, note: 'what the line cleared of the document: the cash received for it + its PPh (P76)']
  withhold boolean [not null, default: true]
  dpp_part decimal(18, 2) [not null, default: 0]
  ppn_part decimal(18, 2) [not null, default: 0]
  pph_amount decimal(18, 2) [not null, default: 0]
  created_by int [not null]
  created_at timestamptz [not null, default: `now()`]

  indexes {
    (tx_id, doc_type_id, doc_id) [unique]
    (doc_type_id, doc_id)
  }
}

Table fin_cash_bank_tx_line_wht {
  id int [pk, increment, not null]
  line_id int [not null]
  withholding_tax_id int [not null]
  rate decimal(9, 4) [not null]
  base_amount decimal(18, 2) [not null]
  amount decimal(18, 2) [not null]

  indexes {
    (line_id, withholding_tax_id) [unique]
  }
}

Ref: fin_cash_bank_tx.partner_id > m_partner.id
Ref: fin_cash_bank_tx.cash_bank_id > m_cash_bank.id
Ref: fin_cash_bank_tx.journal_id > acc_journal.id
Ref: fin_cash_bank_tx_line.tx_id > fin_cash_bank_tx.id [delete: cascade]
Ref: fin_cash_bank_tx_line.doc_type_id > sys_doc_type.id
Ref: fin_cash_bank_tx_line_wht.line_id > fin_cash_bank_tx_line.id [delete: cascade]
Ref: fin_cash_bank_tx_line_wht.withholding_tax_id > ref_withholding_tax.id

Enum ArItemType {
  Advance
  Invoice
}

Enum ArDirection {
  Increase
  Decrease
}

Enum ArEvent {
  Create
  Payment
  AdvanceUsed
}

Table fin_ar_item {
  id int [pk, increment, not null]
  ar_item_no varchar [unique, not null, note: 'ARI/YYYY/MM/NNNN, month of item_date']
  item_type ArItemType [not null]
  direction ArDirection [not null, note: 'Invoice raises Piutang Usaha, Uang Muka lowers it']
  partner_id int [not null]
  currency_id int [not null]
  item_date date [not null]
  due_date date [null, note: 'Invoice only; Umur Piutang ages from it']
  source_doc_type_id int [not null, note: 'what it is about: the advance bill, the Faktur']
  source_doc_id int [not null]
  source_no varchar [not null]
  customer_order_id int [null, note: 'weak: an invoice uses only its own Customer Order advances']
  current_balance decimal(18, 2) [not null, note: 'sum of its fin_ar_ledger entries']
  tax_dpp decimal(18, 2) [null, note: 'its own tax document: Faktur Pajak Uang Muka']
  tax_dpp_other decimal(18, 2) [null]
  tax_ppn decimal(18, 2) [null]
  tax_invoice_no varchar [null, note: 'Coretax number, typed after upload']
  created_by int [not null]
  created_at timestamptz [not null, default: `now()`]
  updated_at timestamptz [not null, default: `now()`]

  indexes {
    (partner_id, item_type)
    customer_order_id
    (source_doc_type_id, source_doc_id)
  }
}

Table fin_ar_ledger {
  id int [pk, increment, not null, note: 'Buku Piutang — append-only']
  item_id int [not null]
  event ArEvent [not null]
  entry_date date [not null]
  amount decimal(18, 2) [not null]
  movement decimal(18, 2) [not null, note: 'signed on the item balance']
  balance_after decimal(18, 2) [not null]
  doc_type_id int [not null]
  doc_id int [not null]
  doc_no varchar [not null]
  counter_item_id int [null, note: 'the Invoice item that used an advance']
  note varchar [null]
  created_by int [not null]
  created_at timestamptz [not null, default: `now()`]

  indexes {
    (item_id, entry_date)
    (doc_type_id, doc_id)
  }
}

Ref: fin_ar_item.partner_id > m_partner.id
Ref: fin_ar_item.currency_id > ref_currency.id
Ref: fin_ar_item.source_doc_type_id > sys_doc_type.id
Ref: fin_ar_ledger.item_id > fin_ar_item.id
Ref: fin_ar_ledger.counter_item_id > fin_ar_item.id
Ref: fin_ar_ledger.doc_type_id > sys_doc_type.id
```
