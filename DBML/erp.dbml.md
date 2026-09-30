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
- Sales: `sal_order` and `sal_order_line` (P49–P53) — SO Barang, rupiah only,
  totals stored as `lib/erp/sales-tax.ts` computed them. A Sales Order posts
  nothing. Its life is Draft → Submitted → Open → Closed, with Cancelled and
  Rejected final (P63); it names no warehouse and no delivery date — the
  Surat Jalan and the delivery schedule will.
- `sal_advance` (P54–P58) — the AR advance bill, drawn from one Open
  Sales Order and numbered `ARA/…`. It posts nothing and stores no paid or
  used amount; that is left to the open items (C22).
- `sal_order` and `sal_advance` snapshot the PPN rate and DPP Nilai Lain factor
  they were computed with (P60); each `sal_order_line` stores its own DPP Nilai
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

Enum SalesOrderStatus {
  Draft
  Submitted
  Open
  Closed
  Cancelled
  Rejected
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

Table sal_order {
  id int [pk, increment, not null]
  order_no varchar [unique, not null]
  order_date date [not null]
  status SalesOrderStatus [not null, default: 'Draft']
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

Table sal_order_line {
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
  note varchar [null]

  indexes {
    (order_id, line_no) [unique]
    item_id
  }
}

Table sal_advance {
  id int [pk, increment, not null]
  advance_no varchar [unique, not null]
  advance_date date [not null]
  due_date date [not null]
  status AdvanceStatus [not null, default: 'Draft']
  order_id int [not null]
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
    order_id
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
Ref: sal_order.customer_id > m_partner.id
Ref: sal_order.address_id > m_partner_address.id
Ref: sal_order.term_id > ref_payment_term.id
Ref: sal_order.copied_from_id > sal_order.id
Ref: sal_order_line.order_id > sal_order.id
Ref: sal_order_line.item_id > m_item.id
Ref: sal_order_line.uom_id > ref_uom.id
Ref: sal_order_line.withholding_tax_id > ref_withholding_tax.id
Ref: sal_advance.order_id > sal_order.id
Ref: sal_advance.customer_id > m_partner.id
Ref: sal_advance.cash_bank_id > m_cash_bank.id
```
