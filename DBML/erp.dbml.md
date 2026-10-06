# ERP — database schema (DBML)

The current schema as DBML, kept in step with `prisma/schema.prisma`: every
migration updates this file in the same change (Claude-ERP.md §9).

- **As of migration:** `20261006180000_receipt_note`
- **Source of truth:** `prisma/schema.prisma` — this file is its readable
  mirror; where they differ, the schema wins and this file is corrected.
- **Layout:** tables are grouped in sections by prefix — System (`sys_`),
  Master Referensi (`ref_`), Master Data (`m_`), Accounting (`acc_`), Finance
  (`fin_`, the Cash Bank Book), Sales (`sal_`), Pembelian (`pur_`), Logistik (`log_`, the stock books
  among them) and Pajak (`tax_`). What a table is for is the `//` comment above it; what a column
  holds, the `//` comment after it.
- **References are inline** (`ref : > table.id`, `ref : -` for one-to-one).
  A pair `(doc_type_id, doc_id)` or an id with no `ref` is a weak reference
  across modules, deliberately without a foreign key (Claude-ERP.md §3.1).
- **Enums are written inline** as `enum('A', 'B')`; their names are in
  `prisma/schema.prisma`.
- **One company** (P9): no table carries a company. Budget, SIBA's Cash Bank
  Transaction, Transfer, Debit / Credit Note, Funding Request and the subject
  books are not carried (P10, P19, P25).
- `created_by` / `updated_by` hold a user id with no foreign key, as in SIBA.
- Money is `decimal(18,2)`, rates `decimal(18,6)`, percentages
  `decimal(9,4)`, quantities `decimal(18,4)`. Calendar dates are `date`,
  timestamps `timestamptz`.
- Document numbers read `PREFIX/YYYY/MM/NNNN`, one series per month (P15).

Paste the block below into <https://dbdiagram.io> to draw it.

```dbml
//////////////////////////////////
//
// System
//
/////////////////////////////////

// Users, roles, permissions and sessions: SIBA's own auth, carried as is (P29)
table sys_user {
  id                          int [pk, increment, not null]

  user_code                   varchar [not null, unique]

  email                       varchar [not null, unique]
  name                        varchar [not null]
  initials                    varchar [not null]
  password_hash               varchar [not null]

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

table sys_role {
  id                          int [pk, increment, not null]

  role_code                   varchar [not null, unique]

  role_label                  varchar [not null, unique]
  role_name                   varchar [not null]

  is_system                   boolean [not null, default: false]
  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

table sys_permission {
  id                          int [pk, increment, not null]

  permission_code             varchar [not null, unique]

  permission_name             varchar [not null]
  module                      varchar [not null]
  description                 varchar

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    module
  }
}

table sys_user_role {
  id                          int [pk, increment, not null]

  user_id                     int [not null, ref : > sys_user.id]
  role_id                     int [not null, ref : > sys_role.id]

  created_by                  int

  created_at                  timestamptz [not null, default: `now()`]

  indexes {
    (user_id, role_id) [unique]
    user_id
  }
}

table sys_role_permission {
  id                          int [pk, increment, not null]

  role_id                     int [not null, ref : > sys_role.id]
  permission_id               int [not null, ref : > sys_permission.id]

  created_by                  int

  created_at                  timestamptz [not null, default: `now()`]

  indexes {
    (role_id, permission_id) [unique]
    role_id
  }
}

table sys_session {
  id                          int [pk, increment, not null]

  token_hash                  varchar [not null, unique]

  user_id                     int [not null, ref : > sys_user.id]

  expires_at                  timestamptz [not null]
  last_seen_at                timestamptz [not null, default: `now()`]
  revoked_at                  timestamptz

  created_at                  timestamptz [not null, default: `now()`]

  indexes {
    user_id
    expires_at
  }
}

// System Default and Account Mapping over one store; the keys are a catalogue in code (P61)
table sys_setting {
  id                          int [pk, increment, not null]

  setting_key                 varchar [not null, unique]
  setting_value               varchar

  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

// every create / update, with an event for lifecycle steps
table audit_log {
  id                          int [pk, increment, not null]

  entity_key                  varchar [not null]

  row_id                      int [not null]

  action                      enum('TAMBAH', 'UPDATE', 'HAPUS') [not null]
  event                       varchar
  at                          timestamptz [not null, default: `now()`]
  by                          int [not null]

  indexes {
    (entity_key, row_id)
  }
}

// asset, liability, equity, revenue, expense — seeded
table sys_account_type {
  id                          int [pk, increment, not null]

  type_code                   varchar [not null, unique]

  type_label                  varchar [not null, unique]
  type_name                   varchar [not null]

  section                     enum('BalanceSheet', 'ProfitLoss') [not null]
  normal_balance              enum('Debit', 'Kredit') [not null]

  note                        varchar

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

// the main reference when a row points at a document: the weak (doc_type_id, doc_id) pair
table sys_doc_type {
  id                          int [pk, increment, not null]

  doc_code                    varchar [not null, unique]

  doc_label                   varchar [not null]
  doc_name                    varchar [not null]

  doc_table                   varchar [not null]

  note                        varchar

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

// Customer and Supplier only, seeded; Supplier starts inactive (P30, P41)
table sys_partner_category {
  id                          int [pk, increment, not null]

  category_code               varchar [not null, unique]

  category_label              varchar [not null]
  category_name               varchar [not null]

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

// seeded, no menu; an item takes only a category of its own type (P47)
table sys_item_category {
  id                          int [pk, increment, not null]

  category_code               varchar [not null, unique]

  category_label              varchar [not null, unique]
  category_name               varchar [not null]

  item_type                   enum('Barang', 'Jasa') [not null]

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    item_type
  }
}

// accounts per Kategori Item (P122, closes C25); an empty one falls back to Account Mapping
// (Persediaan, HPP) or is refused (Beban); a Jasa category takes Beban only
table acc_item_category_account {
  id                          int [pk, increment, not null]

  category_id                 int [not null, unique, ref : - sys_item_category.id]

  inventory_account_id        int [ref : > acc_account.id]
  cogs_account_id             int [ref : > acc_account.id]
  expense_account_id          int [ref : > acc_account.id]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

// Indonesia's provinsi → kota/kabupaten → kecamatan → kelurahan/desa, seeded from
// prisma/data/region.tsv.gz; a Partner address stores only its kelurahan (P39, P40)
table sys_region_province {
  id                          int [pk, increment, not null]

  code                        varchar [not null, unique]
  name                        varchar [not null]
}

table sys_region_city {
  id                          int [pk, increment, not null]

  code                        varchar [not null, unique]
  name                        varchar [not null]

  province_id                 int [not null, ref : > sys_region_province.id]

  indexes {
    province_id
  }
}

table sys_region_district {
  id                          int [pk, increment, not null]

  code                        varchar [not null, unique]
  name                        varchar [not null]

  city_id                     int [not null, ref : > sys_region_city.id]

  indexes {
    city_id
  }
}

table sys_region_village {
  id                          int [pk, increment, not null]

  code                        varchar [not null, unique]
  name                        varchar [not null]

  district_id                 int [not null, ref : > sys_region_district.id]

  postal_code                 varchar

  indexes {
    district_id
  }
}

//////////////////////////////////
//
// Master Referensi
//
/////////////////////////////////

// IDR (base) and USD seeded as starter rows (P62)
table ref_currency {
  id                          int [pk, increment, not null]

  currency_code               varchar [not null, unique]

  currency_label              varchar [not null]
  currency_name               varchar [not null]

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

// a unit only; conversions belong to the Item (P43)
table ref_uom {
  id                          int [pk, increment, not null]

  uom_code                    varchar [not null, unique]

  uom_label                   varchar [not null]
  uom_name                    varchar [not null]

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

// due_days counts the due date; 0 = Tunai (P43)
table ref_payment_term {
  id                          int [pk, increment, not null]

  term_code                   varchar [not null, unique]

  term_label                  varchar [not null]
  term_name                   varchar [not null]

  due_days                    int [not null]

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

// Jenis PPh, user managed; PPH22, PPH23, PPH23-15 seeded for sales (P44), PPH23-BELI for purchases
// one side each (P122): a sales one is withheld from the company (prepaid asset),
// a purchase one by the company (payable)
table ref_withholding_tax {
  id                          int [pk, increment, not null]

  wht_code                    varchar [not null, unique]

  wht_label                   varchar [not null]
  wht_name                    varchar [not null]

  rate                        decimal(9,4) [not null]
  tax_object                  varchar

  usage                       enum('Sales', 'Purchase') [not null, default: 'Sales'] // fixed at creation

  account_id                  int [ref : > acc_account.id] // Sales: PPh Dibayar Dimuka · Purchase: Hutang PPh

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    account_id
    usage
  }
}

// Gudang — shown under Master › Entitas (P43, P62); stock is kept per warehouse in log_stock_balance (P120)
table ref_warehouse {
  id                          int [pk, increment, not null]

  warehouse_code              varchar [not null, unique]

  warehouse_label             varchar [not null]
  warehouse_name              varchar [not null]

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

//////////////////////////////////
//
// Master Data
//
/////////////////////////////////

// no price and no tax treatment on the Item (P46, P48)
table m_item {
  id                          int [pk, increment, not null]

  item_code                   varchar [not null, unique]

  item_label                  varchar [not null]
  item_name                   varchar [not null]

  item_type                   enum('Barang', 'Jasa') [not null]

  category_id                 int [not null, ref : > sys_item_category.id]
  base_uom_id                 int [not null, ref : > ref_uom.id]

  can_sell                    boolean [not null, default: true]
  can_buy                     boolean [not null, default: false]
  track_stock                 boolean [not null, default: false]
  has_expiry                  boolean [not null, default: false]

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    category_id
    base_uom_id
  }
}

// the item's other units and their factor to the base unit, saved with the Item (P46)
table m_item_uom {
  id                          int [pk, increment, not null]

  item_id                     int [not null, ref : > m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id]

  factor                      decimal(18,4) [not null]

  sort_order                  int [not null, default: 0]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (item_id, uom_id) [unique]
    uom_id
  }
}

// one Partner for both roles; its tax identity in the Pajak tab, sales defaults in Penjualan (P39–P42, P51)
table m_partner {
  id                          int [pk, increment, not null]

  partner_code                varchar [not null, unique]

  partner_label               varchar [not null]
  partner_name                varchar [not null]

  category_id                 int [not null, ref : > sys_partner_category.id]

  note                        varchar
  status                      enum('Active', 'Inactive') [not null, default: 'Active']
  taxpayer_type               enum('Badan', 'OrangPribadi', 'InstansiPemerintah')
  is_pkp                      boolean [not null, default: false]
  tax_id_type                 enum('NPWP', 'NIK')
  tax_id                      varchar
  tax_name                    varchar
  withholds_pph23             boolean [not null, default: false]
  collects_pph22              boolean [not null, default: false]
  vat_collector               enum('None', 'Government')

  default_term_id             int [ref : > ref_payment_term.id]

  default_price_mode          enum('Exclude', 'Include')

  purchase_term_id            int [ref : > ref_payment_term.id] // supplier's purchase defaults (P122)
  purchase_price_mode         enum('Exclude', 'Include')

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    category_id
  }
}

// at least one; an address a document uses cannot be removed (P39, P53)
table m_partner_address {
  id                          int [pk, increment, not null]

  partner_id                  int [not null, ref : > m_partner.id]
  village_id                  int [not null, ref : > sys_region_village.id]

  street                      varchar [not null]
  note                        varchar
  is_billing                  boolean [not null, default: false]
  is_shipping                 boolean [not null, default: false]

  sort_order                  int [not null, default: 0]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    partner_id
    village_id
  }
}

table m_partner_contact {
  id                          int [pk, increment, not null]

  partner_id                  int [not null, ref : > m_partner.id]

  contact_name                varchar [not null]
  position                    varchar [not null]
  phone                       varchar [not null]
  email                       varchar [not null]

  sort_order                  int [not null, default: 0]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    partner_id
  }
}

// a Cash or Bank resource in one currency, posting to its own account
table m_cash_bank {
  id                          int [pk, increment, not null]

  cash_bank_code              varchar [not null, unique]

  cash_bank_label             varchar [not null]
  cash_bank_name              varchar [not null]

  cash_bank_type              enum('Cash', 'Bank') [not null]

  currency_id                 int [not null, ref : > ref_currency.id]
  account_id                  int [not null, ref : > acc_account.id]

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

//////////////////////////////////
//
// Accounting
//
/////////////////////////////////

table acc_account_category {
  id                          int [pk, increment, not null]

  account_type_id             int [not null, ref : > sys_account_type.id]

  category_code               varchar [not null, unique]

  category_label              varchar [not null, unique]
  category_name               varchar [not null]

  pl_group                    enum('OperatingRevenue', 'CostOfSales', 'OperatingExpense', 'OtherIncome', 'OtherExpense')

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    account_type_id
  }
}

table acc_account_subcategory {
  id                          int [pk, increment, not null]

  account_category_id         int [not null, ref : > acc_account_category.id]

  subcategory_code            varchar [not null, unique]

  subcategory_label           varchar [not null, unique]
  subcategory_name            varchar [not null]

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    account_category_id
  }
}

// lineage-numbered tree; is_postable derived, is_control_account set by the user (P14, P16)
table acc_account {
  id                          int [pk, increment, not null]

  account_subcategory_id      int [not null, ref : > acc_account_subcategory.id]

  account_code                varchar [not null, unique]

  account_label               varchar [not null]
  account_name                varchar [not null]

  parent_account              int [ref : > acc_account.id]
  is_postable                 boolean [not null, default: true]
  normal_balance              enum('Debit', 'Kredit') [not null]
  require_partner             boolean [not null, default: false]

  partner_category_id         int [ref : > sys_partner_category.id]

  is_control_account          boolean [not null, default: false]
  note                        varchar
  is_active                   boolean [not null, default: true]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    account_label [unique]
    account_subcategory_id
  }
}

table acc_fiscal_year {
  id                          int [pk, increment, not null]

  year_code                   varchar [not null, unique]

  year_label                  varchar [not null]
  year_name                   varchar [not null]

  start_date                  date [not null]
  end_date                    date [not null]

  note                        varchar

  status                      enum('Draft', 'Open', 'Closed') [not null, default: 'Draft']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

table acc_fiscal_period {
  id                          int [pk, increment, not null]

  fiscal_year_id              int [not null, ref : > acc_fiscal_year.id]

  sequence_no                 int [not null]

  period_code                 varchar [not null, unique]

  period_label                varchar [not null]
  period_name                 varchar [not null]

  start_date                  date [not null]
  end_date                    date [not null]

  note                        varchar

  status                      enum('Draft', 'Open', 'Closed') [not null, default: 'Draft']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    fiscal_year_id
  }
}

// one per year, written with the year's Closed status (P35)
table acc_fiscal_closing {
  id                          int [pk, increment, not null]

  fiscal_year_id              int [not null, ref : > acc_fiscal_year.id]

  status                      enum('Open', 'Closed') [not null, default: 'Open']
  closed_at                   timestamptz
  closed_by                   int

  closing_journal_id          int
  opening_balance_id          int

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    fiscal_year_id [unique]
  }
}

// append-only and immutable; JV/YYYY/MM/NNNN for a manual journal
table acc_journal {
  id                          int [pk, increment, not null]

  journal_no                  varchar [not null, unique]
  posting_date                date

  source_doc_type_id          int [ref : > sys_doc_type.id]
  source_doc_id               int

  description                 varchar [not null]
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Posted']
  is_manual                   boolean [not null, default: false]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    posting_date
    (source_doc_type_id, source_doc_id)
  }
}

table acc_journal_line {
  id                          int [pk, increment, not null]

  journal_id                  int [not null, ref : > acc_journal.id]

  sequence_no                 int [not null]

  account_id                  int [not null, ref : > acc_account.id]
  partner_id                  int [ref : > m_partner.id]
  currency_id                 int [not null, ref : > ref_currency.id]

  exchange_rate               decimal(18,6) [not null, default: 1]
  debit_amount                decimal(18,2) [not null, default: 0]
  kredit_amount               decimal(18,2) [not null, default: 0]
  trx_amount                  decimal(18,2) [not null]
  description                 varchar [not null]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    journal_id
    account_id
  }
}

// starts empty (P27)
table acc_opening_balance {
  id                          int [pk, increment, not null]

  opening_no                  varchar [not null, unique]
  posting_date                date [not null]

  fiscal_year_id              int [not null, ref : > acc_fiscal_year.id]
  source_fiscal_year_id       int [ref : > acc_fiscal_year.id]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    fiscal_year_id [unique]
  }
}

table acc_opening_balance_line {
  id                          int [pk, increment, not null]

  opening_id                  int [not null, ref : > acc_opening_balance.id]

  sequence_no                 int [not null]

  account_id                  int [not null, ref : > acc_account.id]
  partner_id                  int [ref : > m_partner.id]

  debit_amount                decimal(18,2) [not null, default: 0]
  kredit_amount               decimal(18,2) [not null, default: 0]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (opening_id, account_id, partner_id) [unique]
    opening_id
  }
}

//////////////////////////////////
//
// Finance
//
/////////////////////////////////

// the Cash Bank Book, append-only; written beside the journal at posting (P31)
table cash_bank_ledger {
  id                          int [pk, increment, not null]

  ledger_no                   varchar [not null] // CBL/YYYY/MM/NNNN, one per posting, shared by its entries (P110)
  line_no                     int [not null]

  cash_bank_id                int [not null, ref : > m_cash_bank.id]

  entry_date                  date [not null]
  entry_type                  enum('Opening', 'Transaction', 'Adjustment') [not null]
  direction                   enum('In', 'Out') [not null]
  amount                      decimal(18,2) [not null]
  movement                    decimal(18,2) [not null]
  balance_after               decimal(18,2) [not null]
  rate                        decimal(18,6) [not null]
  base_amount                 decimal(18,2) [not null]
  base_movement               decimal(18,2) [not null]
  base_balance_after          decimal(18,2) [not null]

  source_doc_type_id          int [ref : > sys_doc_type.id]
  source_doc_id               int

  note                        varchar

  created_by                  int [not null]

  created_at                  timestamptz [not null, default: `now()`]

  indexes {
    (ledger_no, line_no) [unique]
    (cash_bank_id, entry_date)
    (source_doc_type_id, source_doc_id)
  }
}

// one row per resource; a foreign resource is valued at its moving average,
// base_balance ÷ balance — no rate layers (P37)
table cash_bank_balance {
  cash_bank_id                int [pk, not null, ref : > m_cash_bank.id]
  balance                     decimal(18,2) [not null, default: 0]
  base_balance                decimal(18,2) [not null, default: 0]
  entry_count                 int [not null, default: 0]

  last_entry_id               int

  last_entry_date             date

  updated_at                  timestamptz [not null, default: `now()`]
}

// Penerimaan and Pengeluaran Kas & Bank in one table, BKM/… and BKK/… (P66–P70)
// purpose is a key of the catalogue in code (customer_receipt since P98)
// posting writes the journal and the Cash Bank Book
table fin_cash_bank_tx {
  id                          int [pk, increment, not null]

  tx_no                       varchar [not null, unique] // BKM/YYYY/MM/NNNN or BKK/…
  direction                   enum('In', 'Out') [not null]
  purpose                     varchar [not null] // key of the purpose catalogue in code: customer_receipt
  tx_date                     date [not null]
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']

  partner_id                  int [not null, ref : > m_partner.id]
  cash_bank_id                int [not null, ref : > m_cash_bank.id]

  bank_ref                    varchar
  note                        varchar
  cash_amount                 decimal(18,2) [not null] // what reached the resource: the lines' cash less the bank charge (P76)
  bank_charge                 decimal(18,2) [not null, default: 0]
  settled_amount              decimal(18,2) [not null, default: 0]
  pph_amount                  decimal(18,2) [not null, default: 0]

  journal_id                  int [ref : > acc_journal.id]

  cancel_reason               varchar

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (direction, status, tx_date)
    partner_id
  }
}

// one settled document — an advance bill (fin_ar_advance) or an Invoice (fin_ar_invoice) — by the weak pair (P98)
table fin_cash_bank_tx_line {
  id                          int [pk, increment, not null]

  tx_id                       int [not null, ref : > fin_cash_bank_tx.id] // deleted with its parent
  line_no                     int [not null]

  doc_type_id                 int [not null, ref : > sys_doc_type.id] // weak reference to the settled document: fin_ar_advance or fin_ar_invoice
  doc_id                      int [not null]

  settled_amount              decimal(18,2) [not null] // what the line cleared of the document: the cash received for it + its PPh (P76)
  withhold                    boolean [not null, default: true]
  dpp_part                    decimal(18,2) [not null, default: 0]
  ppn_part                    decimal(18,2) [not null, default: 0]
  pph_amount                  decimal(18,2) [not null, default: 0]

  created_by                  int [not null]

  created_at                  timestamptz [not null, default: `now()`]

  indexes {
    (tx_id, doc_type_id, doc_id) [unique]
    (doc_type_id, doc_id)
  }
}

// its PPh per Jenis PPh — the unit one Bukti Potong is made from (P69)
table fin_cash_bank_tx_line_wht {
  id                          int [pk, increment, not null]

  line_id                     int [not null, ref : > fin_cash_bank_tx_line.id] // deleted with its parent
  withholding_tax_id          int [not null, ref : > ref_withholding_tax.id]

  rate                        decimal(9,4) [not null]
  base_amount                 decimal(18,2) [not null]
  amount                      decimal(18,2) [not null]

  indexes {
    (line_id, withholding_tax_id) [unique]
  }
}

// AR items: Uang Muka and Invoice, ARI/… (P71–P75, P96)
// source = the document it is about (the advance bill, the Invoice); what created it is its Create entry
// current_balance = the sum of its Buku Piutang entries; there is no allocation table
table fin_ar_item {
  id                          int [pk, increment, not null]

  ar_item_no                  varchar [not null, unique] // ARI/YYYY/MM/NNNN, month of item_date
  item_type                   enum('Advance', 'Invoice') [not null]
  direction                   enum('Increase', 'Decrease') [not null] // Invoice raises Piutang Usaha, Uang Muka lowers it

  partner_id                  int [not null, ref : > m_partner.id]
  currency_id                 int [not null, ref : > ref_currency.id]

  item_date                   date [not null]
  due_date                    date // Invoice only; Umur Piutang ages from it

  source_doc_type_id          int [not null, ref : > sys_doc_type.id] // what it is about: the advance bill, the Faktur
  source_doc_id               int [not null]
  source_no                   varchar [not null]
  customer_order_id           int // weak: an invoice uses only its own Customer Order advances
  original_amount             decimal(18,2) [not null, default: 0] // what it was born at: an Uang Muka its DPP, an Invoice its face (P116)

  current_balance             decimal(18,2) [not null] // sum of its fin_ar_ledger entries

  created_by                  int [not null]

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (partner_id, item_type)
    customer_order_id
    (source_doc_type_id, source_doc_id)
  }
}

// Buku Piutang: the append-only history of every change to an item's balance (P72)
table fin_ar_ledger {
  id                          int [pk, increment, not null] // Buku Piutang — append-only

  ledger_no                   varchar [not null] // BP/YYYY/MM/NNNN, one per posting, shared by its entries (P110)
  line_no                     int [not null]

  item_id                     int [not null, ref : > fin_ar_item.id]

  event                       enum('Create', 'Payment', 'AdvanceUsed', 'AdvanceApplied') [not null]
  entry_date                  date [not null]
  amount                      decimal(18,2) [not null]
  movement                    decimal(18,2) [not null] // signed on the item balance
  balance_after               decimal(18,2) [not null]

  doc_type_id                 int [not null, ref : > sys_doc_type.id]
  doc_id                      int [not null]
  doc_no                      varchar [not null]
  counter_item_id             int [ref : > fin_ar_item.id] // the Invoice item that used an advance

  note                        varchar

  created_by                  int [not null]

  created_at                  timestamptz [not null, default: `now()`]

  indexes {
    (ledger_no, line_no) [unique]
    (item_id, entry_date)
    (doc_type_id, doc_id)
  }
}

// Uang Muka Penjualan, ARA/… (P54–P58; Finance since P107): a bill drawn from one Open Customer Order
// posts nothing and stores no paid or used amount
table fin_ar_advance {
  id                          int [pk, increment, not null]

  advance_no                  varchar [not null, unique]
  advance_date                date [not null]
  due_date                    date [not null]
  status                      enum('Draft', 'Issued', 'Cancelled') [not null, default: 'Draft']

  customer_order_id           int [not null] // weak: a Customer Order (P107)
  customer_id                 int [not null, ref : > m_partner.id]
  cash_bank_id                int [not null, ref : > m_cash_bank.id]

  description                 varchar [not null]
  note                        varchar
  price_mode                  enum('Exclude', 'Include') [not null]
  is_taxable                  boolean [not null]
  ppn_rate                    decimal(9,4)
  ppn_dpp_other_numerator     int
  ppn_dpp_other_denominator   int
  amount_type                 enum('Percent', 'Amount') [not null]
  amount_value                decimal(18,4) [not null]
  amount                      decimal(18,2) [not null]
  dpp_amount                  decimal(18,2) [not null]
  dpp_other_amount            decimal(18,2) [not null]
  ppn_amount                  decimal(18,2) [not null]
  total_amount                decimal(18,2) [not null]

  cancel_reason               varchar

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    customer_order_id
    customer_id
    (status, advance_date)
  }
}

// Invoice Penjualan, INV/… (P97, P99; Finance since P107): bills one Customer Order
// posting writes the journal and the Invoice AR item
table fin_ar_invoice {
  id                          int [pk, increment, not null]

  invoice_no                  varchar [not null, unique] // INV/YYYY/MM/NNNN
  invoice_date                date [not null] // typed; the journal date
  tax_date                    date [not null] // latest Tanggal Kirim billed; the faktur pajak date
  due_date                    date [not null] // tax_date + Termin days
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']

  customer_order_id           int [not null] // weak: a Customer Order (P107)
  customer_id                 int [not null, ref : > m_partner.id]
  address_id                  int [not null, ref : > m_partner_address.id] // billing address, any of the customer
  cash_bank_id                int [not null, ref : > m_cash_bank.id] // printed: where to pay

  price_mode                  enum('Exclude', 'Include') [not null] // the order, copied
  is_taxable                  boolean [not null]
  ppn_rate                    decimal(9,4)
  ppn_dpp_other_numerator     int
  ppn_dpp_other_denominator   int
  gross_amount                decimal(18,2) [not null, default: 0] // Σ lines (P111)
  discount_amount             decimal(18,2) [not null, default: 0] // Σ lines; amount = gross − discount
  amount                      decimal(18,2) [not null, default: 0]
  dpp_amount                  decimal(18,2) [not null, default: 0] // DPP of the goods billed
  advance_dpp_amount          decimal(18,2) [not null, default: 0] // Uang Muka used
  advance_ppn_amount          decimal(18,2) [not null, default: 0] // the PPN of the Uang Muka used, deducted once (P113)
  net_dpp_amount              decimal(18,2) [not null, default: 0]
  dpp_other_amount            decimal(18,2) [not null, default: 0] // Σ lines, on the full DPP
  ppn_amount                  decimal(18,2) [not null, default: 0] // Σ lines' full PPN − advance_ppn_amount (P113)
  total_amount                decimal(18,2) [not null, default: 0] // net Piutang
  tax_invoice_no              varchar // Coretax number, typed after upload

  journal_id                  int
  ar_item_id                  int // the Invoice AR item; none when nothing is left to pay

  note                        varchar
  cancel_reason               varchar

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    customer_order_id
    (status, invoice_date)
  }
}

// one whole posted Delivery Note line, billed by at most one live Invoice, priced from its order line
table fin_ar_invoice_line {
  id                          int [pk, increment, not null]

  invoice_id                  int [not null, ref : > fin_ar_invoice.id]
  line_no                     int [not null]

  delivery_note_line_id       int [not null] // weak: a log_delivery_note_line, taken whole (U17, P106)
  customer_order_line_id      int [not null] // weak: a Customer Order line (P107)

  qty                         decimal(18,4) [not null]
  price                       decimal(18,6) [not null] // the order line's, unrounded (P111)
  gross_amount                decimal(18,2) [not null, default: 0] // cumulative share of the order line's gross (P112, §7.5)
  discount_type               enum('Percent', 'Amount') // the order line's
  discount_value              decimal(18,4)
  discount_amount             decimal(18,2) [not null, default: 0] // cumulative share of the order line's discount (P112)
  amount                      decimal(18,2) [not null] // gross − discount
  dpp_amount                  decimal(18,2) [not null]
  advance_dpp_amount          decimal(18,2) [not null, default: 0] // its share of the Uang Muka used
  net_dpp_amount              decimal(18,2) [not null]
  dpp_other_amount            decimal(18,2) [not null, default: 0]
  ppn_amount                  decimal(18,2) [not null, default: 0]

  withholding_tax_id          int [ref : > ref_withholding_tax.id]

  withholding_rate            decimal(9,4)

  indexes {
    (invoice_id, line_no) [unique]
    (invoice_id, delivery_note_line_id) [unique]
    delivery_note_line_id
    customer_order_line_id
  }
}

// an Uang Muka AR item used, by id without a foreign key (AR items are a book), and the DPP used
table fin_ar_invoice_advance_deduction {
  id                          int [pk, increment, not null]

  invoice_id                  int [not null, ref : > fin_ar_invoice.id]
  ar_item_id                  int [not null] // weak: an Uang Muka AR item of the same order

  ar_item_no                  varchar [not null]
  dpp_used                    decimal(18,2) [not null]
  ppn_used                    decimal(18,2) [not null, default: 0] // cumulative share of the item's tax_ppn (P113, §7.5)

  indexes {
    (invoice_id, ar_item_id) [unique]
    ar_item_id
  }
}

//////////////////////////////////
//
// Sales
//
/////////////////////////////////

// Customer Order, CO/… (P49–P53, P63, P78): Barang only, rupiah only, posts nothing
// Draft → Submitted → Open → Closed; Cancelled and Rejected final
// snapshots the PPN rate and DPP Nilai Lain factor it was computed with (P60)
table sal_customer_order {
  id                          int [pk, increment, not null]

  order_no                    varchar [not null, unique]
  order_date                  date [not null]
  status                      enum('Draft', 'Submitted', 'Open', 'Closed', 'Cancelled', 'Rejected') [not null, default: 'Draft']

  customer_id                 int [not null, ref : > m_partner.id]
  address_id                  int [not null, ref : > m_partner_address.id]
  term_id                     int [not null, ref : > ref_payment_term.id]

  is_taxable                  boolean [not null, default: true]
  price_mode                  enum('Exclude', 'Include') [not null]
  ppn_rate                    decimal(9,4)
  ppn_dpp_other_numerator     int
  ppn_dpp_other_denominator   int
  po_no                       varchar
  po_date                     date
  salesperson                 varchar
  note                        varchar
  gross_amount                decimal(18,2) [not null, default: 0]
  discount_amount             decimal(18,2) [not null, default: 0]
  dpp_amount                  decimal(18,2) [not null, default: 0]
  dpp_other_amount            decimal(18,2) [not null, default: 0]
  ppn_amount                  decimal(18,2) [not null, default: 0]
  total_amount                decimal(18,2) [not null, default: 0]
  status_reason               varchar // why it was cancelled, rejected or closed by hand

  copied_from_id              int [ref : > sal_customer_order.id]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    customer_id
    (status, order_date)
  }
}

// stores its own DPP Nilai Lain, since PPN is computed per line (P60)
table sal_customer_order_line {
  id                          int [pk, increment, not null]

  order_id                    int [not null, ref : > sal_customer_order.id]
  line_no                     int [not null]

  item_id                     int [not null, ref : > m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id]

  uom_factor                  decimal(18,4) [not null]
  qty                         decimal(18,4) [not null]
  price                       decimal(18,6) [not null] // unrounded unit price (P111); amounts round to whole rupiah
  discount_type               enum('Percent', 'Amount')
  discount_value              decimal(18,4)
  discount_amount             decimal(18,2) [not null, default: 0]
  amount                      decimal(18,2) [not null]
  dpp_amount                  decimal(18,2) [not null]
  dpp_other_amount            decimal(18,2) [not null, default: 0]
  ppn_amount                  decimal(18,2) [not null]

  withholding_tax_id          int [ref : > ref_withholding_tax.id]

  withholding_rate            decimal(9,4)
  delivered_qty               decimal(18,4) [not null, default: 0] // what posted Delivery Notes sent (U21)

  note                        varchar

  indexes {
    (order_id, line_no) [unique]
    item_id
  }
}

// Sales Order, SO/… (P79): a dated part of one Open Customer Order released to PPIC
// quantity and delivery date only; Draft → Submitted → PreSO → Open → Closed; posts nothing
table sal_order {
  id                          int [pk, increment, not null]

  order_no                    varchar [not null, unique] // SO/YYYY/MM/NNNN
  order_date                  date [not null]
  delivery_date               date [not null] // what PPIC plans to
  status                      enum('Draft', 'Submitted', 'PreSO', 'Open', 'Closed', 'Cancelled', 'Rejected') [not null, default: 'Draft']

  customer_order_id           int [not null, ref : > sal_customer_order.id]
  customer_id                 int [not null, ref : > m_partner.id] // the Customer Order customer, for the list
  address_id                  int [not null, ref : > m_partner_address.id] // any of the customer addresses; starts on the Customer Order one

  note                        varchar
  status_reason               varchar

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    customer_order_id
    (status, delivery_date)
  }
}

// takes a quantity of one Customer Order line, once per Sales Order
table sal_order_line {
  id                          int [pk, increment, not null]

  order_id                    int [not null, ref : > sal_order.id]
  line_no                     int [not null]

  customer_order_line_id      int [not null, ref : > sal_customer_order_line.id] // its item and unit are read there

  qty                         decimal(18,4) [not null]
  delivered_qty               decimal(18,4) [not null, default: 0] // what posted Delivery Notes sent; a closed order holds only this

  note                        varchar

  indexes {
    (order_id, line_no) [unique]
    (order_id, customer_order_line_id) [unique]
    customer_order_line_id
  }
}

// Delivery Order, DO/… (P93): one warehouse, one address, one Customer Order
// Draft → Issued → Closed, Cancelled final; posts nothing
table sal_delivery_order {
  id                          int [pk, increment, not null]

  do_no                       varchar [not null, unique] // DO/YYYY/MM/NNNN
  do_date                     date [not null]
  delivery_date               date [not null] // when the goods are to leave
  status                      enum('Draft', 'Issued', 'Closed', 'Cancelled') [not null, default: 'Draft']

  customer_order_id           int [not null, ref : > sal_customer_order.id]
  customer_id                 int [not null, ref : > m_partner.id] // the Customer Order customer, for the list
  warehouse_id                int [not null, ref : > ref_warehouse.id] // the one warehouse the goods leave from
  address_id                  int [not null, ref : > m_partner_address.id] // any of the customer addresses; starts on the first Sales Order picked

  note                        varchar
  status_reason               varchar

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    customer_order_id
    (status, delivery_date)
  }
}

// takes a quantity of one line of an Open Sales Order, once per Delivery Order
table sal_delivery_order_line {
  id                          int [pk, increment, not null]

  delivery_order_id           int [not null, ref : > sal_delivery_order.id]
  line_no                     int [not null]

  sales_order_line_id         int [not null, ref : > sal_order_line.id] // a line of an Open Sales Order of the same Customer Order

  qty                         decimal(18,4) [not null]
  delivered_qty               decimal(18,4) [not null, default: 0] // what posted Delivery Notes sent; a closed order holds only this

  note                        varchar

  indexes {
    (delivery_order_id, line_no) [unique]
    (delivery_order_id, sales_order_line_id) [unique]
    sales_order_line_id
  }
}

//////////////////////////////////
//
// Pembelian
//
/////////////////////////////////

// Purchase Request, PR/… (P123, Purchasing-Concept.md B6–B8): what is needed, by when
// Barang or Jasa (one kind per request, two menus); no supplier, price or tax; posts nothing
// Draft -> Ajukan -> Open -> Tutup; closes itself once every line is fully ordered
table pur_request {
  id                          int [pk, increment, not null]

  request_no                  varchar [not null, unique] // PR/YYYY/MM/NNNN
  request_date                date [not null]
  item_type                   enum('Barang', 'Jasa') [not null] // fixed at creation
  status                      enum('Draft', 'Open', 'Closed', 'Cancelled') [not null, default: 'Draft']

  requester                   varchar // free text
  warehouse_id                int [ref : > ref_warehouse.id] // Gudang Tujuan; Barang only
  needed_date                 date [not null] // the default for its lines

  note                        varchar
  status_reason               varchar

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (item_type, status)
  }
}

// an item marked Dapat Dibeli of the request's type, in its base unit; once per date
table pur_request_line {
  id                          int [pk, increment, not null]

  request_id                  int [not null, ref : > pur_request.id]
  line_no                     int [not null]

  item_id                     int [not null, ref : > m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id] // the item's base unit

  qty                         decimal(18,4) [not null]
  needed_date                 date [not null] // not before the request
  ordered_qty                 decimal(18,4) [not null, default: 0] // written by the Purchase Order module; may exceed qty

  note                        varchar

  indexes {
    (request_id, line_no) [unique]
    item_id
  }
}

// Purchase Order, PO/… or PO-NP/… (P124, Purchasing-Concept.md B9–B16): one supplier, one kind
// made only from Open Purchase Requests; the Customer Order's tax arithmetic; posts nothing
// Draft -> Ajukan -> Diajukan -> Setujui -> Open -> Tutup; Tolak / Batalkan final
table pur_order {
  id                          int [pk, increment, not null]

  order_no                    varchar [not null, unique] // PO/YYYY/MM/NNNN, PO-NP/… without PPN
  order_date                  date [not null]
  item_type                   enum('Barang', 'Jasa') [not null] // fixed at creation
  status                      enum('Draft', 'Submitted', 'Open', 'Closed', 'Cancelled', 'Rejected') [not null, default: 'Draft']

  supplier_id                 int [not null, ref : > m_partner.id]
  term_id                     int [not null, ref : > ref_payment_term.id]
  delivery_date               date [not null] // Tanggal Kirim Diharapkan
  warehouse_id                int [ref : > ref_warehouse.id] // Gudang Tujuan; Barang only
  quotation_no                varchar // the supplier's quotation

  is_taxable                  boolean [not null, default: true] // only for a PKP supplier
  price_mode                  enum('Exclude', 'Include') [not null]
  ppn_rate                    decimal(9,4) // snapshot (P60)
  ppn_dpp_other_numerator     int
  ppn_dpp_other_denominator   int

  note                        varchar

  gross_amount                decimal(18,2) [not null, default: 0]
  discount_amount             decimal(18,2) [not null, default: 0]
  dpp_amount                  decimal(18,2) [not null, default: 0]
  dpp_other_amount            decimal(18,2) [not null, default: 0]
  ppn_amount                  decimal(18,2) [not null, default: 0]
  total_amount                decimal(18,2) [not null, default: 0]

  status_reason               varchar

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    supplier_id
    (item_type, status)
  }
}

// request lines of one item and unit become one line (B9); any unit of the item (B14)
table pur_order_line {
  id                          int [pk, increment, not null]

  order_id                    int [not null, ref : > pur_order.id]
  line_no                     int [not null]

  item_id                     int [not null, ref : > m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id]
  uom_factor                  decimal(18,4) [not null] // base units in one uom_id, copied at save
  qty                         decimal(18,4) [not null]
  price                       decimal(18,6) [not null]

  discount_type               enum('Percent', 'Amount')
  discount_value              decimal(18,4)
  discount_amount             decimal(18,2) [not null, default: 0]
  amount                      decimal(18,2) [not null]
  dpp_amount                  decimal(18,2) [not null]
  dpp_other_amount            decimal(18,2) [not null, default: 0]
  ppn_amount                  decimal(18,2) [not null]

  withholding_tax_id          int [ref : > ref_withholding_tax.id] // a purchase Jenis PPh
  withholding_rate            decimal(9,4) // the master's, doubled without an NPWP (B12)

  received_qty                decimal(18,4) [not null, default: 0] // in uom_id; written by the Receipt Note

  note                        varchar

  indexes {
    (order_id, line_no) [unique]
    item_id
  }
}

// the request lines a PO line covers and its share of each, base units, earliest need first (B15)
table pur_order_line_request {
  id                          int [pk, increment, not null]

  order_line_id               int [not null, ref : > pur_order_line.id]
  request_line_id             int [not null, ref : > pur_request_line.id]
  base_qty                    decimal(18,4) [not null, default: 0] // provisional while Draft; written to the request at Ajukan

  indexes {
    (order_line_id, request_line_id) [unique]
    request_line_id
  }
}

//////////////////////////////////
//
// Logistik
//
/////////////////////////////////

// Receipt Note, RN/… or RN-NP/… (P125, Purchasing-Concept.md B17–B22): goods or a service received
// standalone (P106): purpose + weak source pair; purchase_receipt: from one Open Purchase Order
// posting: Kelola Stok lines into the stock books by lot, others expensed; Dr Persediaan / Beban, Cr Barang Diterima Belum Ditagih
table log_receipt_note {
  id                          int [pk, increment, not null]

  rn_no                       varchar [not null, unique] // RN/YYYY/MM/NNNN, RN-NP/… for a PO without PPN
  rn_date                     date [not null] // Tanggal Terima, the journal date
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']

  purpose                     varchar [not null] // purchase_receipt
  source_doc_type_id          int [not null, ref : > sys_doc_type.id]
  source_doc_id               int [not null] // weak: pur_order.id
  source_no                   varchar [not null]
  partner_id                  int [not null, ref : > m_partner.id] // the supplier
  warehouse_id                int [ref : > ref_warehouse.id] // null for a Jasa receipt
  supplier_dn_no              varchar
  note                        varchar

  value_amount                decimal(18,2) [not null, default: 0] // Σ lines, set at Posting
  journal_id                  int // weak
  cancel_reason               varchar

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (source_doc_type_id, source_doc_id)
    (purpose, status)
    (status, rn_date)
  }
}

// a quantity of one PO line in its unit; never beyond what the PO line has left
table log_receipt_note_line {
  id                          int [pk, increment, not null]

  receipt_note_id             int [not null, ref : > log_receipt_note.id]
  line_no                     int [not null]
  source_doc_line_id          int [not null] // weak: pur_order_line.id

  item_id                     int [not null, ref : > m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id]
  uom_factor                  decimal(18,4) [not null]
  qty                         decimal(18,4) [not null]
  base_qty                    decimal(18,4) [not null]
  is_stock                    boolean [not null, default: false] // Barang with Kelola Stok
  value_amount                decimal(18,2) [not null, default: 0] // cumulative share of the PO line's DPP (B20)
  note                        varchar

  indexes {
    (receipt_note_id, line_no) [unique]
    (receipt_note_id, source_doc_line_id) [unique]
    source_doc_line_id
  }
}

// the lots a stock line comes in as, made at Posting
table log_receipt_note_lot {
  id                          int [pk, increment, not null]

  line_id                     int [not null, ref : > log_receipt_note_line.id]
  lot_seq                     int [not null]
  lot_no                      varchar // typed, or generated at Posting
  expiry_date                 date
  qty                         decimal(18,4) [not null] // in the line's unit
  base_qty                    decimal(18,4) [not null, default: 0]
  value_amount                decimal(18,2) [not null, default: 0] // cumulative share of the line's value
  tracking_id                 int // weak: log_stock_tracking.id, set at Posting

  indexes {
    (line_id, lot_seq) [unique]
  }
}

// Delivery Note, SJ/… (P106; P94, P95): goods leaving the warehouse to a partner
// standalone: purpose (catalogue in code) + weak source pair; quantity and stock cost only
// sales_delivery: from an issued Delivery Order; posting writes Dr HPP / Cr Persediaan
table log_delivery_note {
  id                          int [pk, increment, not null]

  dn_no                       varchar [not null, unique] // SJ/YYYY/MM/NNNN
  dn_date                     date [not null] // the day the goods leave; the journal date
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']

  purpose                     varchar [not null] // sales_delivery; later purchase_return
  source_doc_type_id          int [not null, ref : > sys_doc_type.id] // weak source: a Delivery Order
  source_doc_id               int [not null]
  source_no                   varchar [not null]
  partner_id                  int [not null, ref : > m_partner.id]
  warehouse_id                int [not null, ref : > ref_warehouse.id]
  address_id                  int [not null, ref : > m_partner_address.id]

  vehicle_no                  varchar
  driver_name                 varchar
  note                        varchar
  cost_amount                 decimal(18,2) [not null, default: 0] // sum of the lines, set at Posting

  journal_id                  int // Dr HPP / Cr Persediaan

  cancel_reason               varchar

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (source_doc_type_id, source_doc_id)
    (purpose, status)
    (status, dn_date)
  }
}

// one quantity of one source line; carries its own item, unit and factor (P106)
// unit cost and cost are set at Posting
table log_delivery_note_line {
  id                          int [pk, increment, not null]

  delivery_note_id            int [not null, ref : > log_delivery_note.id]
  line_no                     int [not null]

  source_doc_line_id          int [not null] // weak: a Delivery Order line
  item_id                     int [not null, ref : > m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id]
  uom_factor                  decimal(18,4) [not null, default: 1]

  qty                         decimal(18,4) [not null] // in uom_id
  base_qty                    decimal(18,4) [not null, default: 0] // qty x uom_factor
  unit_cost                   decimal(18,6) [not null, default: 0] // what the inventory issued at (a description, P114)
  cost_amount                 decimal(18,2) [not null, default: 0]

  note                        varchar

  indexes {
    (delivery_note_id, line_no) [unique]
    (delivery_note_id, source_doc_line_id) [unique]
    source_doc_line_id
    item_id
  }
}

// stock picking by lot for a Barang with Kelola Stok, one row per lot (P95)
// lot_id names a log_stock_tracking lot without a foreign key
table log_delivery_note_lot {
  id                          int [pk, increment, not null]

  delivery_note_line_id       int [not null, ref : > log_delivery_note_line.id]

  pick_no                     int [not null]

  lot_id                      int [not null] // the inventory's lot (log_stock_tracking); no FK

  lot_no                      varchar [not null] // as printed on the note
  expiry_date                 date
  qty                         decimal(18,4) [not null] // in the line unit
  base_qty                    decimal(18,4) [not null, default: 0] // set at Posting
  unit_cost                   decimal(18,6) [not null, default: 0] // a description of the movement, never an input (P114)
  cost_amount                 decimal(18,2) [not null, default: 0]

  indexes {
    (delivery_note_line_id, pick_no) [unique]
    (delivery_note_line_id, lot_id) [unique]
    lot_id
  }
}

//////////////////////////////////
//
// Persediaan — the stock books (P120), written only by lib/erp/inventory.ts
//
/////////////////////////////////

// stock statuses, seeded (P120): TERSEDIA, KARANTINA, DIBLOKIR; only Tersedia is used today
table sys_stock_status {
  id                          int [pk, increment, not null]

  status_code                 varchar [not null, unique]

  status_label                varchar [not null, unique]
  status_name                 varchar [not null]

  is_issuable                 boolean [not null, default: false]
  sort_order                  int [not null, default: 0]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

// a lot: one per item and number, made by the receipt that first brings it in
// only items with Kelola Stok are in the books, and always by lot
table log_stock_tracking {
  id                          int [pk, increment, not null]

  tracking_no                 varchar [not null] // unique per item, not globally

  tracking_date               date [not null] // first received

  item_id                     int [not null, ref : > m_item.id]

  source_doc_type_id          int [not null, ref : > sys_doc_type.id] // the receipt that made it, weak
  source_doc_id               int [not null]
  source_no                   varchar [not null]

  source_partner_id           int [ref : > m_partner.id] // the supplier, when named

  expiry_date                 date // required when the item has Memiliki Kadaluarsa

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (item_id, tracking_no) [unique]
    (source_doc_type_id, source_doc_id)
  }
}

// the stock ledger: one row per quantity movement of a lot in a warehouse and status; append-only
// MS/YYYY/MM/NNNN, one per posting (P110); each row has one twin in the valuation ledger
table log_stock_ledger {
  id                          int [pk, increment, not null]

  ledger_no                   varchar [not null]
  line_no                     int [not null]

  posting_date                date [not null] // the document's date

  source_doc_type_id          int [not null, ref : > sys_doc_type.id]
  source_doc_id               int [not null]
  source_no                   varchar [not null]

  warehouse_id                int [not null, ref : > ref_warehouse.id]
  tracking_id                 int [not null, ref : > log_stock_tracking.id]
  item_id                     int [not null, ref : > m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id] // the item's base unit
  stock_status_id             int [not null, ref : > sys_stock_status.id]

  qty_change                  decimal(18,6) [not null]
  qty_balance                 decimal(18,6) [not null] // the bucket after this row, in posting order
  unit_cost                   decimal(18,6) [not null] // |value ÷ qty|, a description (P114)
  value_change                decimal(18,2) [not null] // whole rupiah; equals its valuation twin

  created_by                  int [not null]

  created_at                  timestamptz [not null, default: `now()`]

  indexes {
    (ledger_no, line_no) [unique]
    (item_id, warehouse_id, posting_date)
    tracking_id
    (source_doc_type_id, source_doc_id)
  }
}

// quantity on hand per warehouse, lot and status: the stock ledger's sum; never negative (CHECK)
table log_stock_balance {
  id                          int [pk, increment, not null]

  warehouse_id                int [not null, ref : > ref_warehouse.id]
  tracking_id                 int [not null, ref : > log_stock_tracking.id]
  item_id                     int [not null, ref : > m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id]
  stock_status_id             int [not null, ref : > sys_stock_status.id]

  qty_balance                 decimal(18,6) [not null]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (warehouse_id, tracking_id, stock_status_id) [unique]
    (item_id, warehouse_id)
  }
}

// the valuation ledger: one row per movement of an item's moving-average pool (P114), company-wide
// MN/YYYY/MM/NNNN, one per posting (P110)
table log_stock_valuation_ledger {
  id                          int [pk, increment, not null]

  ledger_no                   varchar [not null]
  line_no                     int [not null]

  posting_date                date [not null]

  source_doc_type_id          int [not null, ref : > sys_doc_type.id]
  source_doc_id               int [not null]
  source_no                   varchar [not null]

  item_id                     int [not null, ref : > m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id]

  qty_change                  decimal(18,6) [not null]
  qty_balance                 decimal(18,6) [not null] // the pool after, every warehouse and status
  unit_cost                   decimal(18,6) // |value ÷ qty|, a description
  value_change                decimal(18,2) [not null] // a receipt its own value; an issue round(V × q ÷ Q), the emptying one V
  value_balance               decimal(18,2) [not null]
  avg_unit_cost               decimal(18,6) [not null] // V ÷ Q, cached for reading, never multiplied

  created_by                  int [not null]

  created_at                  timestamptz [not null, default: `now()`]

  indexes {
    (ledger_no, line_no) [unique]
    (item_id, posting_date)
    (source_doc_type_id, source_doc_id)
  }
}

// an item's moving-average pool: Q and V are the truth, the average derived; never negative (CHECK)
table log_stock_valuation_balance {
  id                          int [pk, increment, not null]

  item_id                     int [not null, unique, ref : - m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id]

  qty_balance                 decimal(18,6) [not null]
  value_balance               decimal(18,2) [not null]
  avg_unit_cost               decimal(18,6) [not null]

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

//////////////////////////////////
//
// Pajak
//
/////////////////////////////////

// Faktur Pajak Keluaran, FPK/… (P100, P101): made inside the posting of a receipt or an Invoice
// an internal record, one per event, no lifecycle; the NSFP is an optional reference
// kind: Advance = Faktur Uang Muka, Settlement = Faktur Pelunasan, Normal = Faktur Normal
table tax_faktur {
  id                          int [pk, increment, not null]

  faktur_no                   varchar [not null, unique] // FPK/YYYY/MM/NNNN
  kind                        enum('Advance', 'Settlement', 'Normal') [not null]
  tax_date                    date [not null] // receipt date (advance); latest Tanggal Kirim (goods)
  deadline                    date [not null] // 15th of the next month

  customer_id                 int [not null, ref : > m_partner.id]

  buyer_tax_type              varchar // NPWP / NIK, copied at posting
  buyer_tax_id                varchar
  buyer_name                  varchar [not null]
  buyer_address               varchar [not null]

  source_doc_type_id          int [not null] // the receipt or the Invoice
  source_doc_id               int [not null]
  source_no                   varchar [not null]
  ref_doc_type_id             int // the advance bill paid (advance only)
  ref_doc_id                  int
  ref_no                      varchar
  ar_item_id                  int // the Uang Muka AR item (advance only), no FK
  customer_order_id           int [not null]

  description                 varchar
  ppn_rate                    decimal(9,4) [not null]
  ppn_dpp_other_numerator     int [not null]
  ppn_dpp_other_denominator   int [not null]
  gross_dpp                   decimal(18,2) [not null]
  advance_dpp                 decimal(18,2) [not null, default: 0]
  advance_ppn                 decimal(18,2) [not null, default: 0] // the advances' PPN deducted at header level (P113)
  dpp                         decimal(18,2) [not null]
  dpp_other                   decimal(18,2) [not null]
  ppn                         decimal(18,2) [not null]
  nsfp                        varchar [unique] // 17 digits from Coretax: an optional reference, filled in and corrected by the user (P101)
  nsfp_date                   date // upload date, optional
  nsfp_by                     int

  created_by                  int [not null]

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    tax_date
    (source_doc_type_id, source_doc_id)
    ar_item_id
  }
}

table tax_faktur_line {
  id                          int [pk, increment, not null]

  faktur_id                   int [not null, ref : > tax_faktur.id]
  line_no                     int [not null]

  description                 varchar [not null]
  item_label                  varchar
  qty                         decimal(18,4)
  uom_label                   varchar
  price                       decimal(18,6)
  gross_dpp                   decimal(18,2) [not null]
  advance_dpp                 decimal(18,2) [not null, default: 0]
  dpp                         decimal(18,2) [not null]
  dpp_other                   decimal(18,2) [not null]
  ppn                         decimal(18,2) [not null]

  indexes {
    (faktur_id, line_no) [unique]
  }
}

// each Faktur Uang Muka a Faktur Pelunasan deducts, with the DPP deducted
table tax_faktur_ref {
  id                          int [pk, increment, not null]

  faktur_id                   int [not null, ref : > tax_faktur.id] // the Faktur Pelunasan
  ref_faktur_id               int [not null, ref : > tax_faktur.id] // the Faktur Uang Muka it deducts

  dpp_deducted                decimal(18,2) [not null]
  ppn_deducted                decimal(18,2) [not null, default: 0] // P113

  indexes {
    (faktur_id, ref_faktur_id) [unique]
  }
}

// Bukti Potong PPh, BPU/… (P100, P101): one per fin_cash_bank_tx_line_wht row
// Awaiting until the BPPU's number and date are recorded; correctable afterwards
// status: Awaiting = Menunggu Bukti Potong, Received = Diterima
table tax_withholding_slip {
  id                          int [pk, increment, not null]

  slip_no                     varchar [not null, unique] // BPU/YYYY/MM/NNNN
  status                      enum('Awaiting', 'Received') [not null, default: 'Awaiting']
  withheld_date               date [not null]
  tax_period                  varchar [not null] // YYYY-MM
  expected_date               date [not null] // 20th of the next month

  customer_id                 int [not null, ref : > m_partner.id]

  withholder_tax_type         varchar
  withholder_tax_id           varchar
  withholder_name             varchar [not null]

  receipt_line_wht_id         int [not null, unique] // fin_cash_bank_tx_line_wht.id, no FK
  receipt_id                  int [not null]

  receipt_no                  varchar [not null]

  doc_type_id                 int [not null] // the document the payment settled
  doc_id                      int [not null]
  doc_no                      varchar [not null]
  withholding_tax_id          int [not null, ref : > ref_withholding_tax.id]

  rate                        decimal(9,4) [not null]
  base_amount                 decimal(18,2) [not null]
  amount                      decimal(18,2) [not null]
  slip_number                 varchar // the BPPU, recorded when it arrives
  slip_date                   date
  received_by                 int

  created_by                  int [not null]

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (status, withheld_date)
    receipt_id
    (doc_type_id, doc_id)
  }
}

```
