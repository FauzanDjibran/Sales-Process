# ERP — database schema (DBML)

The current schema as DBML, kept in step with `prisma/schema.prisma`: every
migration updates this file in the same change (Claude-ERP.md §9).

- **As of migration:** `20261124120000_stock_adjustment`
- **Source of truth:** `prisma/schema.prisma` — this file is its readable
  mirror; where they differ, the schema wins and this file is corrected.
- **Layout: three parts, one per owner** (P254, `production_app_plan.md` §5):
  **Bagian A — Bersama** (login, roles, permissions, settings, document types and number counters,
  audit), **Bagian B — ERP** and **Bagian C — Produksi**. One database still
  holds all three; the banners say which application a table belongs to.
  `tests/module-boundaries.test.ts` fails when a table sits in the wrong part
  or belongs to none. Inside a part, tables are grouped in sections by prefix —
  System (`sys_`), Master Referensi (`ref_`), Master Data (`m_`), Accounting
  (`acc_`), Finance (`fin_`, the Cash Bank Book), Sales (`sal_`), Pembelian
  (`pur_`), Logistik (`log_`, the stock books among them) and Pajak (`tax_`) —
  and in ERP three sections of production tables it owns: Struktur Produksi
  (masters Produksi reads), Stock Issue and Stock Receipt (the boundary documents) and Costing
  Produksi. A `prd_` table may be the ERP's. What a table is for is the `//`
  comment above it; what a column holds, the `//` comment after it.
- **A foreign key into another part** says so: `// lintas aplikasi → <part>`.
  It stays a foreign key while the database is one (`production_app_plan.md`
  §5.4).
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
//////////////////////////////////////////////////////////////////
//
//  BAGIAN A — BERSAMA (login, akses, audit)
//  Dipakai kedua aplikasi. Kelak milik Portal / SSO (P254).
//
//////////////////////////////////////////////////////////////////

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

// the last number claimed per document series PREFIX/YYYY/MM; claimed inside the posting, so a rollback gives it back (5.4)
table sys_number_counter {
  id                          int [pk, increment]
  series                      text [unique, not null]
  last_no                     int [not null]
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

//////////////////////////////////////////////////////////////////
//
//  BAGIAN B — APLIKASI ERP
//  Uang, rencana, stok, pajak, master, costing produksi (P254).
//
//////////////////////////////////////////////////////////////////

//////////////////////////////////
//
// System
//
/////////////////////////////////

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
  wip_account_id              int [ref : > acc_account.id] // Barang only; no fallback (R16)

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

// Kurs: a foreign currency's rate to IDR on a date (Multi-Currency-Plan MC6).
// Only suggests a Customer Order / Purchase Order rate; never a carrying rate,
// never read by cash movements. One Active row per currency, type and date
// (partial unique index ref_exchange_rate_one_active).
table ref_exchange_rate {
  id                          int [pk, increment, not null]

  rate_code                   varchar [not null, unique]

  currency_id                 int [not null, ref : > ref_currency.id]
  rate_type                   enum('Transaction') [not null, default: 'Transaction'] // closing and KMK later
  rate_date                   date [not null]
  rate                        decimal(18,6) [not null, note: 'CHECK > 0']

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (currency_id, rate_type, rate_date)
  }
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

// Jenis Perizinan (P137): the permits a Pengajuan Perizinan lists; not an Item
table ref_permit_type {
  id                          int [pk, increment, not null]

  permit_code                 varchar [not null, unique]

  permit_label                varchar [not null]
  permit_name                 varchar [not null]
  category                    enum('Regulatory', 'Laboratory', 'Certification', 'IntellectualProperty') [not null]
  default_description         varchar
  standard_estimate           decimal(18,2) // before PPN; a Pengajuan line's starting estimate

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

// Lokasi Gudang (P267), its own master: a place inside one warehouse, one level; a warehouse that has any location keeps every stock row in one
// of them, one without keeps none; shown as <warehouse label>-<location label>; never deleted, deactivated instead (not while holding stock)
table ref_warehouse_location {
  id                          int [pk, increment, not null]

  warehouse_id                int [not null, ref : > ref_warehouse.id]

  location_code               varchar [not null, unique] // loc.NNNN
  location_label              varchar [not null]
  location_name               varchar [not null]

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (warehouse_id, location_label) [unique]
  }
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
  is_bjl                      boolean [not null, default: false] // BJL (W32): valued 0 in production; locked once used

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

// an item weighed when it is received; a row means it is (P321)
table m_item_weighting {
  id                          int [pk, increment, not null]

  item_id                     int [not null, unique, ref : > m_item.id]
  item_weight                 decimal(18,6) [not null] // Kg of one base unit, > 0
  receiving_tolerance         decimal(18,6) [not null, default: 0] // percent, 0 to under 100

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
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
  sales_currency_id           int [ref : > ref_currency.id] // currency a new Customer Order starts in; empty = IDR (Multi-Currency-Plan OD-11)
  purchase_currency_id        int [ref : > ref_currency.id] // currency a new Purchase Order starts in

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
// Struktur Produksi — master, dibaca aplikasi Produksi
//
/////////////////////////////////

// Workstation (P225, W33): only groups Units; holds no goods and no rate
table ref_workstation {
  id                          int [pk, increment, not null]

  workstation_code            varchar [not null, unique]

  workstation_label           varchar [not null]
  workstation_name            varchar [not null]

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

// Unit (P225, W33): where goods are held in production; the work done there is its ordered steps
// (ref_unit_step, P274); the old ref_workstation (P201) renamed in place
table ref_unit {
  id                          int [pk, increment, not null]

  unit_code                   varchar [not null, unique]

  unit_label                  varchar [not null] // the short code used in document numbers, e.g. UGH
  unit_name                   varchar [not null]
  workstation_id              int [ref : > ref_workstation.id]
  allow_reproses              boolean [not null, default: false] // may send goods back to an earlier Unit of the partai routing (T10)
  has_qc                      boolean [not null, default: false] // results of the last step wait in QC Check before Stand By (P281)

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

// The steps of a Unit (P274, T1): goods received enter step 1; a posted step document moves them to the next
// Persiapan without a Push; after the last they wait in QC Check (a Unit with QC) or Stand By. Rules in code:
// each process once per Unit, Assembly alone. QC is the Unit's has_qc, not a step (P281).
table ref_unit_step {
  id                          int [pk, increment, not null]

  unit_id                     int [not null, ref : > ref_unit.id]
  seq                         int [not null]
  process                     enum('Grading', 'JobOrder', 'Assign', 'Kerja', 'Assembly') [not null]

  indexes {
    (unit_id, seq) [unique]
    (unit_id, process) [unique]
  }
}

// Line Produksi (P225): a routing hangs on it; the month's variance goes to its account
table prd_line {
  id                          int [pk, increment, not null]

  line_code                   varchar [not null, unique]

  line_label                  varchar [not null]
  line_name                   varchar [not null]
  variance_account_id         int [ref : > acc_account.id]

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

// Routing (P227): the ordered Units; several per line for now, each naming its line;
// one row with no line = the segment before the partai (partial unique index prd_routing_one_segment)
table prd_routing {
  id                          int [pk, increment, not null]

  routing_code                varchar [not null, unique]

  routing_label               varchar [not null]
  routing_name                varchar [not null]
  line_id                     int [ref : > prd_line.id]

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

table prd_routing_step {
  id                          int [pk, increment, not null]

  routing_id                  int [not null, ref : > prd_routing.id]
  seq                         int [not null]
  unit_id                     int [not null, ref : > ref_unit.id]
  is_checkpoint               boolean [not null, default: false] // from here a partai moves whole (W28)
  is_skippable                boolean [not null, default: false]

  indexes {
    (routing_id, seq) [unique]
    (routing_id, unit_id) [unique]
    unit_id
  }
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

  status                      enum('Open', 'Locked', 'Closed') [not null, default: 'Open'] // Locked refuses postings until unlocked; Closed comes with the year's close

  production_costed_at        timestamptz // set by the Penutupan Biaya Produksi (R15)
  production_costed_by        int

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

  source_doc_type_id          int [ref : > sys_doc_type.id] // lintas aplikasi → Bersama
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

// The period lock (R15): accounts a costed period takes no journal line on.
table acc_fiscal_period_lock {
  id                          int [pk, increment, not null]
  period_id                   int [not null, ref : > acc_fiscal_period.id] // cascade
  account_id                  int [not null]

  indexes {
    (period_id, account_id) [unique]
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
  movement                    decimal(18,2) [not null] // signed: + in, − out; direction and size are read from it (P213)
  rate                        decimal(18,6) [not null]
  base_movement               decimal(18,2) [not null] // movement in base currency, signed the same way

  source_doc_type_id          int [ref : > sys_doc_type.id] // lintas aplikasi → Bersama
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
table cash_bank_period {
  id              int [pk, increment]
  cash_bank_id    int [not null, ref: > m_cash_bank.id]
  period          date [not null]
  opening         decimal(18,2) [not null, default: 0]
  total_in        decimal(18,2) [not null, default: 0]
  total_out       decimal(18,2) [not null, default: 0]
  closing         decimal(18,2) [not null, default: 0]
  min_balance     decimal(18,2) [not null, default: 0]
  base_opening    decimal(18,2) [not null, default: 0]
  base_total_in   decimal(18,2) [not null, default: 0]
  base_total_out  decimal(18,2) [not null, default: 0]
  base_closing    decimal(18,2) [not null, default: 0]
  updated_at      timestamptz [not null, default: `now()`]

  indexes {
    (cash_bank_id, period) [unique]
  }
}

table cash_bank_balance {
  id                          int [pk, increment, not null]
  cash_bank_id                int [not null, unique, ref : > m_cash_bank.id]
  balance                     decimal(18,2) [not null, default: 0]
  base_balance                decimal(18,2) [not null, default: 0]
  entry_count                 int [not null, default: 0]

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

  currency_id                 int [not null, ref : > ref_currency.id] // the document's currency (MC3)
  exchange_rate               decimal(18,6) [not null, default: 1] // the rate money arriving was received at (MC11)

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

  doc_type_id                 int [not null, ref : > sys_doc_type.id] // lintas aplikasi → Bersama · weak reference to the settled document: fin_ar_advance or fin_ar_invoice
  doc_id                      int [not null]

  settled_amount              decimal(18,2) [not null] // what the line cleared of the document: the cash received for it + its PPh (P76)
  base_settled_amount         decimal(18,2) [not null] // what the line released from the document, in base (MC12)
  transaction_base_amount     decimal(18,2) [not null] // what the money and PPh brought, in base
  fx_difference               decimal(18,2) [not null, default: 0] // base_settled_amount − transaction_base_amount; 0 within one currency
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

// Transfer Kas & Bank, TRF/… (P299, Cash-Bank-Transfer-Plan.md): the company's
// own money between its Kas & Bank — Transfer (one currency), Pencairan (foreign
// → rupiah), Pembelian Valas (rupiah → foreign). One source, one or more
// destinations. Penukaran Valas (P272) renamed in place; its rows kept PVL/….
table fin_cash_bank_transfer {
  id                          int [pk, increment, not null]

  transfer_no                 varchar [not null, unique]
  transfer_date               date [not null]
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']
  purpose                     enum('Transfer', 'Pencairan', 'PembelianValas') [not null]

  from_cash_bank_id           int [not null, ref : > m_cash_bank.id]
  currency_id                 int [not null, ref : > ref_currency.id] // document currency: the source's, or the currency bought
  transfer_amount             decimal(18,2) [not null, note: 'CHECK > 0'] // Σ lines' amount
  from_amount                 decimal(18,2) [not null, note: 'CHECK > 0'] // Σ lines' out_amount, source currency
  reference                   varchar // the bank's reference
  note                        varchar

  from_base                   decimal(18,2) // posted: Σ base the source released
  fx_difference               decimal(18,2) [not null, default: 0] // Σ lines' selisih kurs: + gain, − loss
  journal_id                  int [ref : > acc_journal.id]
  cancel_reason               varchar

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (status, transfer_date)
  }
}

// One destination; posted per line: Out from the source, In to it (no base shared out).
table fin_cash_bank_transfer_line {
  id                          int [pk, increment, not null]
  transfer_id                 int [not null, ref : > fin_cash_bank_transfer.id] // cascade
  line_no                     int [not null]
  to_cash_bank_id             int [not null, ref : > m_cash_bank.id] // never the source

  amount                      decimal(18,2) [not null, note: 'CHECK > 0'] // typed, document currency
  exchange_rate               decimal(18,6) [not null, note: 'CHECK > 0'] // typed when crossing, else 1
  out_amount                  decimal(18,2) [not null] // source currency: amount, or round(amount × rate) on a purchase
  in_amount                   decimal(18,2) [not null] // destination currency: amount, or round(amount × rate) on a sale
  out_base                    decimal(18,2) // posted: what the source released
  in_base                     decimal(18,2) // posted: out_base, or in_amount on a Pencairan
  fx_difference               decimal(18,2) [not null, default: 0] // in_base − out_base, Pencairan only

  indexes {
    (transfer_id, line_no) [unique]
    (transfer_id, to_cash_bank_id) [unique]
    to_cash_bank_id
  }
}

// AR items: Uang Muka and Invoice, ARI/… (P71–P75, P96)
// source = the document it is about (the advance bill, the Invoice); what created it is its Create entry
// current_balance = the sum of its Buku Piutang entries; there is no allocation table
table fin_ar_item {
  id                          int [pk, increment, not null]

  ar_item_no                  varchar [not null, unique] // ARI/YYYY/MM/NNNN, month of item_date
  item_type                   enum('Advance', 'Invoice', 'Return') [not null] // Return: a Credit Note Penjualan, customer credit until applied (P292)
  direction                   enum('Increase', 'Decrease') [not null] // Invoice raises Piutang Usaha, Uang Muka lowers it

  partner_id                  int [not null, ref : > m_partner.id]
  currency_id                 int [not null, ref : > ref_currency.id]

  item_date                   date [not null]
  due_date                    date // Invoice only; Umur Piutang ages from it

  source_doc_type_id          int [not null, ref : > sys_doc_type.id] // lintas aplikasi → Bersama · what it is about: the advance bill, the Faktur
  source_doc_id               int [not null]
  source_no                   varchar [not null]
  scope_doc_type_id           int [ref : > sys_doc_type.id] // lintas aplikasi → Bersama · the agreement it is settled within: Customer Order or Pengajuan Perizinan (P137)
  scope_doc_id                int // weak: an invoice uses only its own agreement's advances
  original_amount             decimal(18,2) [not null, default: 0] // what it was born at: an Uang Muka its DPP, an Invoice its face (P116)
  base_original_amount        decimal(18,2) [not null] // original_amount in base currency (MC1)
  paid_amount                 decimal(18,2) [not null, default: 0] // what its source document has been paid, cash + PPh; a receipt's `before`, raised at posting; CHECK ≥ 0 (P214)

  current_balance             decimal(18,2) [not null] // sum of its fin_ar_ledger entries
  base_current_balance        decimal(18,2) [not null] // current_balance in base currency (MC1)

  created_by                  int [not null]

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (partner_id, item_type)
    (scope_doc_type_id, scope_doc_id)
    (source_doc_type_id, source_doc_id) [unique] // one item per document, its identity (P214)
  }
}

// Buku Piutang: the append-only history of every change to an item's balance (P72)
table fin_ar_ledger {
  id                          int [pk, increment, not null] // Buku Piutang — append-only

  ledger_no                   varchar [not null] // BP/YYYY/MM/NNNN, one per posting, shared by its entries (P110)
  line_no                     int [not null]

  item_id                     int [not null, ref : > fin_ar_item.id]

  event                       enum('Create', 'Payment', 'AdvanceUsed', 'AdvanceApplied', 'AdvanceReceived', 'ReturnApplied', 'ReturnUsed') [not null] // AdvanceReceived: a later payment raising a bill's one Uang Muka item (P133); ReturnApplied / ReturnUsed: a Retur item applied to an Invoice item (P292)
  entry_date                  date [not null]
  movement                    decimal(18,2) [not null] // signed on the item balance: + grows, − falls; the one figure of the entry (P213)
  base_movement               decimal(18,2) [not null] // movement in base currency (MC1)

  doc_type_id                 int [not null, ref : > sys_doc_type.id] // lintas aplikasi → Bersama
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

// AP item, API/… (P127, Purchasing-Concept.md B32): the AR item mirrored — what is owed a supplier per document, or paid ahead
// Uang Muka: born by a posted payment of an AP advance bill, at its DPP; Invoice: by a posted Invoice Pembelian (step 7)
// a book: kernel imports only; type, direction and event reuse the AR enums
table fin_ap_item {
  id                          int [pk, increment, not null]

  ap_item_no                  varchar [not null, unique] // API/YYYY/MM/NNNN
  item_type                   enum('Advance', 'Invoice', 'Return') [not null] // shares the AR enum; Return unused on AP
  direction                   enum('Increase', 'Decrease') [not null] // on Hutang Usaha: an Invoice raises it, an Uang Muka lowers it
  partner_id                  int [not null, ref : > m_partner.id]
  currency_id                 int [not null, ref : > ref_currency.id]
  item_date                   date [not null]
  due_date                    date

  source_doc_type_id          int [not null, ref : > sys_doc_type.id] // lintas aplikasi → Bersama · what the item is about
  source_doc_id               int [not null]
  source_no                   varchar [not null]
  purchase_order_id           int // weak: the settlement scope

  current_balance             decimal(18,2) [not null] // Σ its Buku Hutang entries
  base_current_balance        decimal(18,2) [not null] // current_balance in base currency (MC1)
  original_amount             decimal(18,2) [not null, default: 0]
  base_original_amount        decimal(18,2) [not null] // original_amount in base currency (MC1)
  paid_amount                 decimal(18,2) [not null, default: 0] // what its source document has been paid; a payment's `before`, raised at posting; CHECK ≥ 0 (P214)

  created_by                  int [not null]
  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (partner_id, item_type)
    purchase_order_id
    (source_doc_type_id, source_doc_id) [unique] // one item per document, its identity (P214)
  }
}

// Buku Hutang (P127): every change to an AP item's balance, append-only; one BH/… number per posting (P110)
table fin_ap_ledger {
  id                          int [pk, increment, not null]

  ledger_no                   varchar [not null] // BH/YYYY/MM/NNNN
  line_no                     int [not null]
  item_id                     int [not null, ref : > fin_ap_item.id]
  event                       enum('Create', 'Payment', 'AdvanceUsed', 'AdvanceApplied', 'AdvanceReceived', 'ReturnApplied', 'ReturnUsed') [not null] // AdvanceReceived: a later payment raising a bill's one Uang Muka item (P133)
  entry_date                  date [not null]
  movement                    decimal(18,2) [not null] // signed on the item balance: + grows, − falls (P213)
  base_movement               decimal(18,2) [not null] // movement in base currency (MC1)

  doc_type_id                 int [not null, ref : > sys_doc_type.id] // lintas aplikasi → Bersama
  doc_id                      int [not null]
  doc_no                      varchar [not null]
  counter_item_id             int [ref : > fin_ap_item.id]
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

  currency_id                 int [not null, ref : > ref_currency.id] // the document's currency (MC3)

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

// Uang Muka Perizinan (P137): the Perizinan flow's advance bill, header-only; mirrors fin_ar_advance
table fin_ar_permit_advance {
  id                          int [pk, increment, not null]

  advance_no                  varchar [not null, unique]
  advance_date                date [not null]
  due_date                    date [not null]
  status                      enum('Draft', 'Issued', 'Cancelled') [not null, default: 'Draft']

  permit_request_id           int [not null] // weak: a Pengajuan Perizinan (P137)
  customer_id                 int [not null, ref : > m_partner.id]
  cash_bank_id                int [not null, ref : > m_cash_bank.id]

  description                 varchar [not null]
  note                        varchar
  price_mode                  enum('Exclude', 'Include') [not null]
  is_taxable                  boolean [not null]
  withholding_tax_id          int // the Pengajuan's one Jenis PPh, copied
  withholding_rate            decimal(9,4)
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
    permit_request_id
    customer_id
    (status, advance_date)
  }
}

// Invoice Perizinan (P137): bills one realised Pengajuan Perizinan, header-only (its Uraian
// is the one line); deducts the Pengajuan's own Uang Muka items as the goods Invoice does
table fin_ar_permit_invoice {
  id                          int [pk, increment, not null]

  invoice_no                  varchar [not null, unique] // INP/YYYY/MM/NNNN, INP-NP/… without PPN
  invoice_date                date [not null]
  tax_date                    date [not null] // = invoice_date
  due_date                    date [not null]
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']

  permit_request_id           int [not null] // weak: a Pengajuan Perizinan
  customer_id                 int [not null, ref : > m_partner.id]
  address_id                  int [not null, ref : > m_partner_address.id]
  cash_bank_id                int [not null, ref : > m_cash_bank.id]
  description                 varchar [not null] // the one line the customer sees

  price_mode                  enum('Exclude', 'Include') [not null]
  is_taxable                  boolean [not null]
  ppn_rate                    decimal(9,4)
  ppn_dpp_other_numerator     int
  ppn_dpp_other_denominator   int
  withholding_tax_id          int
  withholding_rate            decimal(9,4)

  amount                      decimal(18,2) [not null, default: 0]
  dpp_amount                  decimal(18,2) [not null, default: 0]
  advance_dpp_amount          decimal(18,2) [not null, default: 0]
  advance_ppn_amount          decimal(18,2) [not null, default: 0]
  net_dpp_amount              decimal(18,2) [not null, default: 0]
  dpp_other_amount            decimal(18,2) [not null, default: 0]
  full_ppn_amount             decimal(18,2) [not null, default: 0]
  ppn_amount                  decimal(18,2) [not null, default: 0] // full − advance (P113)
  total_amount                decimal(18,2) [not null, default: 0]

  journal_id                  int
  ar_item_id                  int
  note                        varchar
  cancel_reason               varchar

  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    permit_request_id
    (status, invoice_date)
  }
}

table fin_ar_permit_invoice_advance_deduction {
  id                          int [pk, increment, not null]
  invoice_id                  int [not null, ref : > fin_ar_permit_invoice.id]
  ar_item_id                  int [not null] // an Uang Muka item of the Pengajuan, no FK
  ar_item_no                  varchar [not null]
  dpp_used                    decimal(18,2) [not null]
  ppn_used                    decimal(18,2) [not null, default: 0] // recalculated (P118)

  indexes {
    (invoice_id, ar_item_id) [unique]
    ar_item_id
  }
}

// Uang Muka Pembelian, APA/… or APA-NP/… (P126, Purchasing-Concept.md B23): the supplier's request for a down payment
// the AR bill mirrored (P58): from one Open Purchase Order; posts nothing; Draft -> Catat -> Diterbitkan; Batalkan final
table fin_ap_advance {
  id                          int [pk, increment, not null]

  advance_no                  varchar [not null, unique] // APA/YYYY/MM/NNNN
  advance_date                date [not null]
  due_date                    date [not null]
  status                      enum('Draft', 'Issued', 'Cancelled') [not null, default: 'Draft']

  purchase_order_id           int [not null] // weak: pur_order.id
  supplier_id                 int [not null, ref : > m_partner.id]
  supplier_ref_no             varchar // the supplier's proforma / bill number
  description                 varchar [not null]
  note                        varchar

  price_mode                  enum('Exclude', 'Include') [not null] // from the PO
  is_taxable                  boolean [not null]
  ppn_rate                    decimal(9,4) // snapshot (P60)
  ppn_dpp_other_numerator     int
  ppn_dpp_other_denominator   int

  amount_type                 enum('Percent', 'Amount') [not null]
  amount_value                decimal(18,4) [not null]

  amount                      decimal(18,2) [not null] // drawn, in the PO's price mode
  dpp_amount                  decimal(18,2) [not null]
  dpp_other_amount            decimal(18,2) [not null]
  ppn_amount                  decimal(18,2) [not null]
  total_amount                decimal(18,2) [not null]

  cancel_reason               varchar

  currency_id                 int [not null, ref : > ref_currency.id] // the document's currency (MC3)

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    purchase_order_id
    supplier_id
    (status, advance_date)
  }
}

// Invoice Pembelian, PI/… or PI-NP/… (P128, Purchasing-Concept.md B28–B31): the supplier's bill for one Purchase Order
// whole lines of its posted Receipt Notes, always at the PO price (each line's DPP = its receipt's value, so GR/IR clears exactly)
// posting: Dr Barang Diterima Belum Ditagih · Dr PPN Masukan · Dr/Cr Selisih Tagihan Supplier / Cr Hutang Usaha (face) · Cr Hutang PPh;
// per Uang Muka: Dr Hutang Usaha / Cr Uang Muka Pembelian · Cr PPN Masukan; the Invoice AP item at its face
table fin_ap_invoice {
  id                          int [pk, increment, not null]

  invoice_no                  varchar [not null, unique] // PI/YYYY/MM/NNNN
  invoice_date                date [not null] // the journal date, not before the latest receipt
  due_date                    date [not null] // supplier invoice date + the PO's Termin
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']

  purchase_order_id           int [not null] // weak: pur_order.id
  supplier_id                 int [not null, ref : > m_partner.id]
  supplier_invoice_no         varchar [not null] // unique per supplier among live invoices
  supplier_invoice_date       date [not null]
  supplier_tax_invoice_no     varchar // reference until the tax module

  price_mode                  enum('Exclude', 'Include') [not null]
  is_taxable                  boolean [not null]
  ppn_rate                    decimal(9,4)
  ppn_dpp_other_numerator     int
  ppn_dpp_other_denominator   int

  dpp_amount                  decimal(18,2) [not null, default: 0]
  base_dpp_amount             decimal(18,2) [not null] // dpp_amount in base currency (MC1)
  advance_dpp_amount          decimal(18,2) [not null, default: 0]
  base_advance_dpp_amount     decimal(18,2) [not null] // advance_dpp_amount in base currency (MC1)
  advance_ppn_amount          decimal(18,2) [not null, default: 0]
  base_advance_ppn_amount     decimal(18,2) [not null] // advance_ppn_amount in base currency (MC1)
  net_dpp_amount              decimal(18,2) [not null, default: 0]
  base_net_dpp_amount         decimal(18,2) [not null] // net_dpp_amount in base currency (MC1)
  dpp_other_amount            decimal(18,2) [not null, default: 0]
  base_dpp_other_amount       decimal(18,2) [not null] // dpp_other_amount in base currency (MC1)
  ppn_amount                  decimal(18,2) [not null, default: 0] // full PPN − the advances' PPN (P113)
  base_ppn_amount             decimal(18,2) [not null] // ppn_amount in base currency (MC1)
  total_amount                decimal(18,2) [not null, default: 0] // net DPP + PPN, before PPh
  base_total_amount           decimal(18,2) [not null] // total_amount in base currency (MC1)
  pph_amount                  decimal(18,2) [not null, default: 0] // the company's PPh, on the DPP after the advance
  base_pph_amount             decimal(18,2) [not null] // pph_amount in base currency (MC1)
  supplier_total              decimal(18,2) // Total Tagihan Supplier as typed; null = not compared
  base_supplier_total         decimal(18,2) // supplier_total in base currency (MC1)
  difference_amount           decimal(18,2) [not null, default: 0] // within the tolerance, to Selisih Tagihan Supplier
  base_difference_amount      decimal(18,2) [not null] // difference_amount in base currency (MC1)
  payable_amount              decimal(18,2) [not null, default: 0] // Hutang born at: full DPP + full PPN + difference − PPh
  base_payable_amount         decimal(18,2) [not null] // payable_amount in base currency (MC1)

  journal_id                  int
  ap_item_id                  int
  note                        varchar
  cancel_reason               varchar

  currency_id                 int [not null, ref : > ref_currency.id] // the document's currency (MC3)

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    purchase_order_id
    (supplier_id, supplier_invoice_no)
    (status, invoice_date)
  }
}

// a whole posted Receipt Note line, billed by at most one live invoice
table fin_ap_invoice_line {
  id                          int [pk, increment, not null]

  invoice_id                  int [not null, ref : > fin_ap_invoice.id]
  line_no                     int [not null]
  receipt_note_line_id        int [not null] // weak: log_receipt_note_line.id
  purchase_order_line_id      int [not null] // weak: pur_order_line.id
  qty                         decimal(18,6) [not null] // in the PO line's unit: what is billed (P320)
  price                       decimal(18,6) [not null] // the PO's
  dpp_amount                  decimal(18,2) [not null] // the receipt's value
  base_dpp_amount             decimal(18,2) [not null] // dpp_amount in base currency (MC1)
  advance_dpp_amount          decimal(18,2) [not null, default: 0]
  base_advance_dpp_amount     decimal(18,2) [not null] // advance_dpp_amount in base currency (MC1)
  net_dpp_amount              decimal(18,2) [not null]
  base_net_dpp_amount         decimal(18,2) [not null] // net_dpp_amount in base currency (MC1)
  dpp_other_amount            decimal(18,2) [not null, default: 0]
  base_dpp_other_amount       decimal(18,2) [not null] // dpp_other_amount in base currency (MC1)
  ppn_amount                  decimal(18,2) [not null, default: 0]
  base_ppn_amount             decimal(18,2) [not null] // ppn_amount in base currency (MC1)
  withholding_tax_id          int // weak: a purchase Jenis PPh
  withholding_rate            decimal(9,4)

  indexes {
    (invoice_id, line_no) [unique]
    (invoice_id, receipt_note_line_id) [unique]
    receipt_note_line_id
    purchase_order_line_id
  }
}

// the PO's Uang Muka AP items an invoice uses: the DPP typed, its PPN recalculated (P118)
table fin_ap_invoice_advance_deduction {
  id                          int [pk, increment, not null]

  invoice_id                  int [not null, ref : > fin_ap_invoice.id]
  ap_item_id                  int [not null] // weak: fin_ap_item.id
  ap_item_no                  varchar [not null]
  dpp_used                    decimal(18,2) [not null]
  base_dpp_used               decimal(18,2) [not null] // dpp_used in base currency (MC1)
  ppn_used                    decimal(18,2) [not null, default: 0]
  base_ppn_used               decimal(18,2) [not null] // ppn_used in base currency (MC1)
  fx_difference               decimal(18,2) [not null, default: 0] // Hutang relieved less the advance and its PPN relieved (MC13)

  indexes {
    (invoice_id, ap_item_id) [unique]
    ap_item_id
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
  base_gross_amount           decimal(18,2) [not null] // gross_amount in base currency (MC1)
  discount_amount             decimal(18,2) [not null, default: 0] // Σ lines; amount = gross − discount
  base_discount_amount        decimal(18,2) [not null] // discount_amount in base currency (MC1)
  amount                      decimal(18,2) [not null, default: 0]
  base_amount                 decimal(18,2) [not null] // amount in base currency (MC1)
  dpp_amount                  decimal(18,2) [not null, default: 0] // DPP of the goods billed
  base_dpp_amount             decimal(18,2) [not null] // dpp_amount in base currency (MC1)
  advance_dpp_amount          decimal(18,2) [not null, default: 0] // Uang Muka used
  base_advance_dpp_amount     decimal(18,2) [not null] // advance_dpp_amount in base currency (MC1)
  advance_ppn_amount          decimal(18,2) [not null, default: 0] // the PPN of the Uang Muka used, deducted once (P113)
  base_advance_ppn_amount     decimal(18,2) [not null] // advance_ppn_amount in base currency (MC1)
  net_dpp_amount              decimal(18,2) [not null, default: 0]
  base_net_dpp_amount         decimal(18,2) [not null] // net_dpp_amount in base currency (MC1)
  dpp_other_amount            decimal(18,2) [not null, default: 0] // Σ lines, on the full DPP
  base_dpp_other_amount       decimal(18,2) [not null] // dpp_other_amount in base currency (MC1)
  ppn_amount                  decimal(18,2) [not null, default: 0] // Σ lines' full PPN − advance_ppn_amount (P113)
  base_ppn_amount             decimal(18,2) [not null] // ppn_amount in base currency (MC1)
  total_amount                decimal(18,2) [not null, default: 0] // net Piutang
  base_total_amount           decimal(18,2) [not null] // total_amount in base currency (MC1)
  tax_invoice_no              varchar // Coretax number, typed after upload

  journal_id                  int
  ar_item_id                  int // the Invoice AR item; none when nothing is left to pay

  note                        varchar
  cancel_reason               varchar

  currency_id                 int [not null, ref : > ref_currency.id] // the document's currency (MC3)

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
  base_gross_amount           decimal(18,2) [not null] // gross_amount in base currency (MC1)
  discount_type               enum('Percent', 'Amount') // the order line's
  discount_value              decimal(18,4)
  discount_amount             decimal(18,2) [not null, default: 0] // cumulative share of the order line's discount (P112)
  base_discount_amount        decimal(18,2) [not null] // discount_amount in base currency (MC1)
  amount                      decimal(18,2) [not null] // gross − discount
  base_amount                 decimal(18,2) [not null] // amount in base currency (MC1)
  dpp_amount                  decimal(18,2) [not null]
  base_dpp_amount             decimal(18,2) [not null] // dpp_amount in base currency (MC1)
  advance_dpp_amount          decimal(18,2) [not null, default: 0] // its share of the Uang Muka used
  base_advance_dpp_amount     decimal(18,2) [not null] // advance_dpp_amount in base currency (MC1)
  net_dpp_amount              decimal(18,2) [not null]
  base_net_dpp_amount         decimal(18,2) [not null] // net_dpp_amount in base currency (MC1)
  dpp_other_amount            decimal(18,2) [not null, default: 0]
  base_dpp_other_amount       decimal(18,2) [not null] // dpp_other_amount in base currency (MC1)
  ppn_amount                  decimal(18,2) [not null, default: 0]
  base_ppn_amount             decimal(18,2) [not null] // ppn_amount in base currency (MC1)

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
  base_dpp_used               decimal(18,2) [not null] // dpp_used in base currency (MC1)
  ppn_used                    decimal(18,2) [not null, default: 0] // cumulative share of the item's tax_ppn (P113, §7.5)
  base_ppn_used               decimal(18,2) [not null] // ppn_used in base currency (MC1)
  fx_difference               decimal(18,2) [not null, default: 0] // Piutang relieved less the advance and its PPN relieved (MC13)

  indexes {
    (invoice_id, ar_item_id) [unique]
    ar_item_id
  }
}

// Credit Note Penjualan, CNS/… and CNS-NP/… (P287, P292, Sales-Return-Plan.md §6): credits one posted Invoice
// for goods that came back after it was billed. Draft → Posted, Cancelled final. Posting writes
// Dr Retur Penjualan · Dr PPN Keluaran / Cr Piutang Usaha and a Retur AR item: open customer credit;
// it never lowers the Invoice itself (P330)
table fin_ar_credit_note {
  id                          int [pk, increment, not null]

  credit_no                   varchar [unique, not null]
  credit_date                 date [not null]
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']

  invoice_id                  int [not null, ref : > fin_ar_invoice.id] // the one Invoice it credits, locked once saved
  customer_order_id           int [not null] // weak: the Invoice's Customer Order — the lock and the AR scope
  customer_id                 int [not null, ref : > m_partner.id]
  currency_id                 int [not null, ref : > ref_currency.id]
  exchange_rate               decimal(18,6) [not null, default: 1] // the Invoice's rate: a credit is valued as what it reverses (MC8)
  is_taxable                  boolean [not null]
  customer_return_no          varchar // the buyer's Nota Retur, as given (SR6)
  note                        varchar

  gross_amount                decimal(18,2) [not null, default: 0]
  discount_amount             decimal(18,2) [not null, default: 0]
  dpp_amount                  decimal(18,2) [not null, default: 0]
  dpp_other_amount            decimal(18,2) [not null, default: 0]
  ppn_amount                  decimal(18,2) [not null, default: 0]
  total_amount                decimal(18,2) [not null, default: 0] // dpp + ppn: the Retur AR item's original
  base_dpp_amount             decimal(18,2) [not null, default: 0]
  base_ppn_amount             decimal(18,2) [not null, default: 0]
  base_total_amount           decimal(18,2) [not null, default: 0]

  ar_item_id                  int // weak: its Retur AR item, once posted
  journal_id                  int // weak: its journal, once posted
  cancel_reason               varchar

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    invoice_id
    (status, credit_date)
  }
}

// a quantity of one Invoice line, its figures the cumulative share of the line's after posted credits (P112)
table fin_ar_credit_note_line {
  id                          int [pk, increment, not null]

  credit_note_id              int [not null, ref : > fin_ar_credit_note.id]
  line_no                     int [not null]
  invoice_line_id             int [not null, ref : > fin_ar_invoice_line.id]
  item_id                     int [not null, ref : > m_item.id]

  qty                         decimal(18,4) [not null] // CHECK > 0
  gross_amount                decimal(18,2) [not null, default: 0]
  discount_amount             decimal(18,2) [not null, default: 0]
  dpp_amount                  decimal(18,2) [not null, default: 0]
  dpp_other_amount            decimal(18,2) [not null, default: 0]
  ppn_amount                  decimal(18,2) [not null, default: 0]
  base_dpp_amount             decimal(18,2) [not null, default: 0]
  base_ppn_amount             decimal(18,2) [not null, default: 0]

  indexes {
    (credit_note_id, line_no) [unique]
    (credit_note_id, invoice_line_id) [unique]
    invoice_line_id
    item_id
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
  base_gross_amount           decimal(18,2) [not null] // gross_amount in base currency (MC1)
  discount_amount             decimal(18,2) [not null, default: 0]
  base_discount_amount        decimal(18,2) [not null] // discount_amount in base currency (MC1)
  dpp_amount                  decimal(18,2) [not null, default: 0]
  base_dpp_amount             decimal(18,2) [not null] // dpp_amount in base currency (MC1)
  dpp_other_amount            decimal(18,2) [not null, default: 0]
  base_dpp_other_amount       decimal(18,2) [not null] // dpp_other_amount in base currency (MC1)
  ppn_amount                  decimal(18,2) [not null, default: 0]
  base_ppn_amount             decimal(18,2) [not null] // ppn_amount in base currency (MC1)
  total_amount                decimal(18,2) [not null, default: 0]
  base_total_amount           decimal(18,2) [not null] // total_amount in base currency (MC1)
  status_reason               varchar // why it was cancelled, rejected or closed by hand

  copied_from_id              int [ref : > sal_customer_order.id]

  currency_id                 int [not null, ref : > ref_currency.id] // the document's currency (MC3)
  exchange_rate               decimal(18,6) [not null, default: 1] // the rate it originates base figures at (MC6)

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
  base_discount_amount        decimal(18,2) [not null] // discount_amount in base currency (MC1)
  amount                      decimal(18,2) [not null]
  base_amount                 decimal(18,2) [not null] // amount in base currency (MC1)
  dpp_amount                  decimal(18,2) [not null]
  base_dpp_amount             decimal(18,2) [not null] // dpp_amount in base currency (MC1)
  dpp_other_amount            decimal(18,2) [not null, default: 0]
  base_dpp_other_amount       decimal(18,2) [not null] // dpp_other_amount in base currency (MC1)
  ppn_amount                  decimal(18,2) [not null]
  base_ppn_amount             decimal(18,2) [not null] // ppn_amount in base currency (MC1)

  withholding_tax_id          int [ref : > ref_withholding_tax.id]

  withholding_rate            decimal(9,4)
  delivered_qty               decimal(18,4) [not null, default: 0] // what posted Delivery Notes sent (U21)

  note                        varchar

  indexes {
    (order_id, line_no) [unique]
    item_id
  }
}

// Pengajuan Perizinan (P137): the internal list of permits for a makloon
// customer's product, each at its estimate and, once realised on the same
// document, at its real price. Posts nothing.
table sal_permit_request {
  id                          int [pk, increment, not null]

  request_no                  varchar [not null, unique] // PRZ/YYYY/MM/NNNN, PRZ-NP/… without PPN
  request_date                date [not null]
  status                      enum('Draft', 'Submitted', 'Open', 'Realized', 'Done', 'Cancelled', 'Rejected') [not null, default: 'Draft']

  customer_id                 int [not null, ref : > m_partner.id]
  address_id                  int [not null, ref : > m_partner_address.id]
  term_id                     int [not null, ref : > ref_payment_term.id]
  is_taxable                  boolean [not null, default: true]
  price_mode                  enum('Exclude', 'Include') [not null]
  ppn_rate                    decimal(9,4)
  ppn_dpp_other_numerator     int
  ppn_dpp_other_denominator   int
  withholding_tax_id          int [ref : > ref_withholding_tax.id] // one per Pengajuan, usage Sales
  withholding_rate            decimal(9,4)

  po_no                       varchar
  po_date                     date
  salesperson                 varchar
  product_name                varchar [not null]
  note                        varchar

  estimate_amount             decimal(18,2) [not null, default: 0] // PPN once on the total
  estimate_dpp                decimal(18,2) [not null, default: 0]
  estimate_dpp_other          decimal(18,2) [not null, default: 0]
  estimate_ppn                decimal(18,2) [not null, default: 0]
  estimate_total              decimal(18,2) [not null, default: 0]

  realization_no              varchar [unique] // RLZ/YYYY/MM/NNNN at Realisasikan
  realization_date            date
  realization_note            varchar
  realized_amount             decimal(18,2) [not null, default: 0]
  realized_dpp                decimal(18,2) [not null, default: 0]
  realized_dpp_other          decimal(18,2) [not null, default: 0]
  realized_ppn                decimal(18,2) [not null, default: 0]
  realized_total              decimal(18,2) [not null, default: 0]
  cost_paid_amount            decimal(18,2) [not null, default: 0] // posted Biaya Perizinan

  status_reason               varchar

  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

table sal_permit_request_line {
  id                          int [pk, increment, not null]
  request_id                  int [not null, ref : > sal_permit_request.id]
  line_no                     int [not null]
  permit_type_id              int [not null, ref : > ref_permit_type.id]
  description                 varchar [not null]
  estimate_price              decimal(18,2) [not null] // 0 only on a permit added at realisation
  realized_price              decimal(18,2) // null until entered; 0 = not done
  is_added                    boolean [not null, default: false]

  indexes {
    (request_id, line_no) [unique]
    (request_id, permit_type_id) [unique]
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

// Sales Return, SR/… / SR-NP/… (P287, Sales-Return-Plan.md §4): goods of one Customer Order coming back
// from its posted Delivery Notes; Draft → Submitted → Open → Closed, Cancelled / Rejected final; posts nothing
table sal_return {
  id                          int [pk, increment, not null]

  return_no                   varchar [not null, unique] // SR/YYYY/MM/NNNN, SR-NP/… without PPN
  return_date                 date [not null]
  status                      enum('Draft', 'Submitted', 'Open', 'Closed', 'Cancelled', 'Rejected') [not null, default: 'Draft']

  customer_order_id           int [not null, ref : > sal_customer_order.id] // Open or Closed, chosen once and locked
  customer_id                 int [not null, ref : > m_partner.id] // the Customer Order customer, for the list
  address_id                  int [not null, ref : > m_partner_address.id] // where the goods are collected; any of the customer addresses

  reason                      varchar [not null] // a key of SALES_RETURN_REASONS in code
  reason_note                 varchar // required when the reason is other
  customer_return_no          varchar // the PKP buyer's Nota Retur, as given
  customer_return_date        date
  note                        varchar
  status_reason               varchar

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    customer_order_id
    (status, return_date)
  }
}

// a base quantity of one posted Delivery Note line, once per return; the note is another module's (weak ids)
table sal_return_line {
  id                          int [pk, increment, not null]

  return_id                   int [not null, ref : > sal_return.id]
  line_no                     int [not null]

  delivery_note_id            int [not null] // weak → log_delivery_note.id
  delivery_note_line_id       int [not null] // weak → log_delivery_note_line.id, purpose sales_delivery, Posted

  item_id                     int [not null, ref : > m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id] // the item base unit (P108)

  base_qty                    decimal(18,4) [not null] // > 0; returns on a note line never exceed what left
  received_qty                decimal(18,4) [not null, default: 0] // what posted Receipt Notes brought back; ≤ base_qty

  note                        varchar

  indexes {
    (return_id, line_no) [unique]
    (return_id, delivery_note_line_id) [unique]
    delivery_note_line_id
    item_id
    uom_id
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
  base_gross_amount           decimal(18,2) [not null] // gross_amount in base currency (MC1)
  discount_amount             decimal(18,2) [not null, default: 0]
  base_discount_amount        decimal(18,2) [not null] // discount_amount in base currency (MC1)
  dpp_amount                  decimal(18,2) [not null, default: 0]
  base_dpp_amount             decimal(18,2) [not null] // dpp_amount in base currency (MC1)
  dpp_other_amount            decimal(18,2) [not null, default: 0]
  base_dpp_other_amount       decimal(18,2) [not null] // dpp_other_amount in base currency (MC1)
  ppn_amount                  decimal(18,2) [not null, default: 0]
  base_ppn_amount             decimal(18,2) [not null] // ppn_amount in base currency (MC1)
  total_amount                decimal(18,2) [not null, default: 0]
  base_total_amount           decimal(18,2) [not null] // total_amount in base currency (MC1)

  status_reason               varchar

  currency_id                 int [not null, ref : > ref_currency.id] // the document's currency (MC3)
  exchange_rate               decimal(18,6) [not null, default: 1] // the rate it originates base figures at (MC6)

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
  uom_factor                  decimal(18,4) [not null] // base units in one uom_id, copied at save and at Ajukan
  qty                         decimal(18,4) [not null] // in uom_id; price is per uom_id
  base_qty                    decimal(18,4) [not null] // qty × uom_factor: requests and stock are compared in it (P320)
  price                       decimal(18,6) [not null]

  discount_type               enum('Percent', 'Amount')
  discount_value              decimal(18,4)
  discount_amount             decimal(18,2) [not null, default: 0]
  base_discount_amount        decimal(18,2) [not null] // discount_amount in base currency (MC1)
  amount                      decimal(18,2) [not null]
  base_amount                 decimal(18,2) [not null] // amount in base currency (MC1)
  dpp_amount                  decimal(18,2) [not null]
  base_dpp_amount             decimal(18,2) [not null] // dpp_amount in base currency (MC1)
  dpp_other_amount            decimal(18,2) [not null, default: 0]
  base_dpp_other_amount       decimal(18,2) [not null] // dpp_other_amount in base currency (MC1)
  ppn_amount                  decimal(18,2) [not null]
  base_ppn_amount             decimal(18,2) [not null] // ppn_amount in base currency (MC1)

  withholding_tax_id          int [ref : > ref_withholding_tax.id] // a purchase Jenis PPh
  withholding_rate            decimal(9,4) // the master's, doubled without an NPWP (B12)

  received_qty                decimal(18,6) [not null, default: 0] // in uom_id; written by the Receipt Note
  received_base_qty           decimal(18,4) [not null, default: 0] // the same in base units (P320)

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
  source_doc_type_id          int [not null, ref : > sys_doc_type.id] // lintas aplikasi → Bersama
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
  uom_factor                  decimal(18,4) [not null] // the PO line's
  qty                         decimal(18,6) [not null] // in uom_id: what is valued and billed (P320)
  base_qty                    decimal(18,4) [not null] // what enters stock
  is_stock                    boolean [not null, default: false] // Barang with Kelola Stok
  order_dpp_amount            decimal(18,2) [not null, default: 0] // the PO line DPP for this quantity, in the PO currency (MC7)
  value_amount                decimal(18,2) [not null, default: 0] // cumulative share of the PO line's base DPP (B20, MC7)
  note                        varchar

  indexes {
    (receipt_note_id, line_no) [unique]
    (receipt_note_id, source_doc_line_id) [unique]
    source_doc_line_id
  }
}

// what was weighed of a line; it decides the line's quantity (P321)
table log_receipt_note_weighting {
  id                          int [pk, increment, not null]

  receipt_line_id             int [not null, unique, ref : > log_receipt_note_line.id]
  qty_sj                      decimal(18,6) [not null] // the supplier's, in uom_id
  uom_id                      int [not null, ref : > ref_uom.id] // the PO line's
  uom_factor                  decimal(18,4) [not null]
  item_weight                 decimal(18,6) [not null] // snapshot
  qty_calculated              decimal(18,6) [not null] // Kg: qty_sj × uom_factor × item_weight
  receiving_tolerance         decimal(18,6) [not null, default: 0] // snapshot, percent
  lower_tolerance             decimal(18,6) [not null] // Kg
  upper_tolerance             decimal(18,6) [not null] // Kg
  qty_weighting               decimal(18,6) [not null] // Kg, what the scale said
  weighting_result            enum('Within', 'Above', 'Below') [not null]
  qty_received                decimal(18,6) [not null] // in uom_id; the line's qty
  qty_bonus                   decimal(18,4) [not null, default: 0] // base units; its Stock Receipt at 0

  created_at                  timestamptz [not null, default: `now()`]
}

// the lots a stock line comes in as, made at Posting
table log_receipt_note_tracking {
  id                          int [pk, increment, not null]

  line_id                     int [not null, ref : > log_receipt_note_line.id]
  tracking_seq                     int [not null]
  tracking_no                      varchar // typed, or generated at Posting
  expiry_date                 date
  base_qty                    decimal(18,4) [not null] // base units, whatever the line's unit (P320)
  value_amount                decimal(18,2) [not null, default: 0] // cumulative share of the line's value
  tracking_id                 int // weak: log_stock_tracking.id, set at Posting
  location_id                 int // weak: ref_warehouse_location.id — where it is put, in a warehouse that has locations
  stock_status_id             int // weak: sys_stock_status.id the lot comes back under; null = Tersedia (purchase_receipt) (P289)
  source_tracking_id          int // weak: log_delivery_note_tracking.id it left on — purpose sales_return only (P289)

  indexes {
    (line_id, tracking_seq) [unique]
    source_tracking_id
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
  source_doc_type_id          int [not null, ref : > sys_doc_type.id] // lintas aplikasi → Bersama · weak source: a Delivery Order
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

// the summary of what leaves (P268): one quantity of one source line in the document's unit; carries its own item, unit and factor (P106)
// cost_amount is Σ its tracking rows, set at Posting; a unit cost is derived on read, never stored
table log_delivery_note_line {
  id                          int [pk, increment, not null]

  delivery_note_id            int [not null, ref : > log_delivery_note.id]
  line_no                     int [not null]

  source_doc_line_id          int [not null] // weak: a Delivery Order line
  item_id                     int [not null, ref : > m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id]
  uom_factor                  decimal(18,4) [not null, default: 1]

  qty                         decimal(18,4) [not null] // in uom_id
  base_qty                    decimal(18,4) [not null, default: 0] // qty x uom_factor = Σ its tracking rows' base_qty
  returned_qty                decimal(18,4) [not null, default: 0] // base qty brought back by posted Receipt Notes sales_return; CHECK 0 ≤ returned ≤ base_qty (P289)
  cost_amount                 decimal(18,2) [not null, default: 0] // Σ its tracking rows' cost_amount

  note                        varchar

  indexes {
    (delivery_note_id, line_no) [unique]
    (delivery_note_id, source_doc_line_id) [unique]
    source_doc_line_id
    item_id
  }
}

// the detail (P268): one stock bucket a line takes goods from — lot, location, status — in the base unit, with the value the stock released
// for a Barang with Kelola Stok (P95); tracking_id and location_id named without a foreign key
table log_delivery_note_tracking {
  id                          int [pk, increment, not null]

  delivery_note_line_id       int [not null, ref : > log_delivery_note_line.id]

  pick_no                     int [not null]

  tracking_id                      int [not null] // the inventory's lot (log_stock_tracking); no FK
  location_id                 int // the location it is taken from, in a warehouse that has locations; no FK
  stock_status_id             int [not null, ref : > sys_stock_status.id] // the bucket's status (P268); a purpose says which it may take

  tracking_no                      varchar [not null] // as printed on the note
  expiry_date                 date
  base_qty                    decimal(18,4) [not null] // in the item's base unit — what the stock books move
  cost_amount                 decimal(18,2) [not null, default: 0] // round(V × q ÷ Q) released at Posting (P114)

  indexes {
    (delivery_note_line_id, pick_no) [unique]
    (delivery_note_line_id, tracking_id, location_id, stock_status_id) [unique] // NULLS NOT DISTINCT: a pick is a bucket
    tracking_id
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

// a lot (No. Stok): one number, one stock in the whole system (W10), made by the receipt that first brings it in
// only items with Kelola Stok are in the books, and always by lot
table log_stock_tracking {
  id                          int [pk, increment, not null]

  tracking_no                 varchar [not null, unique] // one No. Stok is one stock in the whole system (W10)

  tracking_date               date [not null] // first received

  item_id                     int [not null, ref : > m_item.id]

  source_doc_type_id          int [not null, ref : > sys_doc_type.id] // lintas aplikasi → Bersama · the receipt that made it, weak
  source_doc_id               int [not null]
  source_no                   varchar [not null]

  source_partner_id           int [ref : > m_partner.id] // the supplier, when named

  expiry_date                 date // required when the item has Memiliki Kadaluarsa

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
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

  source_doc_type_id          int [not null, ref : > sys_doc_type.id] // lintas aplikasi → Bersama
  source_doc_id               int [not null]
  source_no                   varchar [not null]

  warehouse_id                int [not null, ref : > ref_warehouse.id]
  location_id                 int [ref : > ref_warehouse_location.id] // required in a warehouse that has locations, null otherwise (P267)
  tracking_id                 int [not null, ref : > log_stock_tracking.id]
  item_id                     int [not null, ref : > m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id] // the item's base unit
  stock_status_id             int [not null, ref : > sys_stock_status.id]

  qty_change                  decimal(18,6) [not null]
  qty_balance                 decimal(18,6) [not null] // the bucket after this row, in posting order
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

// quantity on hand per warehouse, location, lot and status: the stock ledger's sum; never negative (CHECK)
table log_stock_balance {
  id                          int [pk, increment, not null]

  warehouse_id                int [not null, ref : > ref_warehouse.id]
  location_id                 int [ref : > ref_warehouse_location.id] // required in a warehouse that has locations, null otherwise (P267)
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
    (warehouse_id, location_id, tracking_id, stock_status_id) [unique] // NULLS NOT DISTINCT: one bucket per lot where there is no location
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

  source_doc_type_id          int [not null, ref : > sys_doc_type.id] // lintas aplikasi → Bersama
  source_doc_id               int [not null]
  source_no                   varchar [not null]

  item_id                     int [not null, ref : > m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id]

  qty_change                  decimal(18,6) [not null]
  qty_balance                 decimal(18,6) [not null] // the pool after, every warehouse and status
  value_change                decimal(18,2) [not null] // a receipt its own value; an issue round(V × q ÷ Q), the emptying one V
  value_balance               decimal(18,2) [not null]

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
  scope_doc_type_id           int [not null] // its agreement: Customer Order or Pengajuan Perizinan (P137)
  scope_doc_id                int [not null]

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

//////////////////////////////////
//
// Stock Issue — dokumen batas ke Produksi
//
/////////////////////////////////

// Stock Issue (P317): Draft → Kirim (InTransit: out of stock, value frozen, Dr WIP / Cr Persediaan) → Received, said by
// Produksi; standalone by purpose (P106), BSTB_<unit>_<ddmmyy>_<NNNNN>
table log_stock_issue {
  id                          int [pk, increment, not null]

  issue_no                    varchar [not null, unique]
  issue_date                  date [not null]
  status                      enum('Draft', 'InTransit', 'Received', 'Posted', 'Cancelled') [not null, default: 'Draft'] // Posted: a purpose without a Unit
  purpose                     varchar [not null] // production_issue | auxiliary_issue | disposal | sample
  warehouse_id                int [not null, ref : > ref_warehouse.id]
  unit_id              int [ref : > ref_unit.id] // the production purposes only
  note                        varchar

  cost_amount                 decimal(18,2) [not null, default: 0]
  journal_id                  int // no FK
  received_at                 date // the day Produksi took the goods in
  cancel_reason               varchar

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (purpose, status)
    (status, issue_date)
  }
}

table log_stock_issue_line {
  id                          int [pk, increment, not null]

  stock_issue_id              int [not null, ref : > log_stock_issue.id]
  line_no                     int [not null]
  item_id                     int [not null, ref : > m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id] // the base unit, factor 1
  uom_factor                  decimal(18,4) [not null, default: 1]
  qty                         decimal(18,4) [not null]
  base_qty                    decimal(18,4) [not null, default: 0]
  cost_amount                 decimal(18,2) [not null, default: 0]
  note                        varchar

  indexes {
    (stock_issue_id, line_no) [unique]
    (stock_issue_id, item_id) [unique]
    item_id
  }
}

table log_stock_issue_tracking {
  id                          int [pk, increment, not null]

  stock_issue_line_id         int [not null, ref : > log_stock_issue_line.id]
  pick_no                     int [not null]
  tracking_id                      int [not null] // log_stock_tracking.id, no FK
  location_id                 int // ref_warehouse_location.id, no FK
  tracking_no                      varchar [not null]
  expiry_date                 date
  qty                         decimal(18,4) [not null]
  base_qty                    decimal(18,4) [not null, default: 0]
  cost_amount                 decimal(18,2) [not null, default: 0]

  indexes {
    (stock_issue_line_id, pick_no) [unique]
    (stock_issue_line_id, tracking_id, location_id) [unique] // NULLS NOT DISTINCT
    tracking_id
  }
}

//////////////////////////////////
//
// Stock Receipt — dokumen batas dari Produksi
//
/////////////////////////////////

// Goods into a warehouse without a partner (P317), by purpose; from production they are made by a
// Production Issue, under its number. Terima by the warehouse: Dr Persediaan (or beban) / Cr WIP.
table log_stock_receipt {
  id                          int [pk, increment, not null]
  receipt_no                  varchar [not null, unique] // the sender's: BFG_ / BPG_<unit>_<ddmmyy>_<NNNNN>; a bonus: SRC/YYYY/MM/NNNN
  purpose                     varchar [not null] // finish_goods | return | purchase_bonus (P321)
  receipt_date                date [not null] // the day sent
  status                      enum('InTransit', 'Received') [not null, default: 'InTransit']
  from_unit_id                int [ref : > ref_unit.id]
  warehouse_id                int [not null, ref : > ref_warehouse.id]
  source_doc_type_id          int // weak: the Receipt Note of a purchase_bonus (P321)
  source_doc_id               int
  source_no                   varchar
  note                        varchar
  received_at                 date // Terima, the journal's date
  received_by                 int
  cost_amount                 decimal(18,2) [not null, default: 0] // Σ lines, frozen by the sender
  value_mode                  varchar // carried | none, chosen at Terima (P304)
  written_off_amount          decimal(18,2) [not null, default: 0] // what `none` charged to Beban Pemusnahan Produksi
  journal_id                  int // acc_journal.id, no FK
  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (purpose, status)
    (status, receipt_date)
    warehouse_id
    (source_doc_type_id, source_doc_id)
  }
}

table log_stock_receipt_line {
  id                          int [pk, increment, not null]
  stock_receipt_id            int [not null, ref : > log_stock_receipt.id]
  line_no                     int [not null]
  item_id                     int [not null, ref : > m_item.id]
  base_qty                    decimal(18,6) [not null] // Σ its No. Stok
  value_amount                decimal(18,2) [not null, default: 0]

  indexes {
    (stock_receipt_id, line_no) [unique]
    (stock_receipt_id, item_id) [unique]
  }
}

table log_stock_receipt_tracking {
  id                          int [pk, increment, not null]
  stock_receipt_line_id       int [not null, ref : > log_stock_receipt_line.id]
  seq                         int [not null]
  tracking_no                 varchar [not null] // the same No. Stok in stock
  expiry_date                 date
  job_no                      varchar // production's, as printed
  base_qty                    decimal(18,6) [not null] // CHECK > 0
  grams                       decimal(18,6)
  value_amount                decimal(18,2) [not null, default: 0] // frozen by the sender
  location_id                 int // ref_warehouse_location.id, no FK; chosen at Terima
  stock_status_id             int // sys_stock_status.id, no FK; chosen at Terima

  indexes {
    (stock_receipt_line_id, seq) [unique]
    tracking_no
  }
}

//////////////////////////////////
//
// Transfer Stok (P300, Stock-Transfer-Plan.md)
//
/////////////////////////////////

// Which warehouses a user works in (OD-9); INVENTORY_WAREHOUSE_ALL needs no row.
table log_user_warehouse {
  id                          int [pk, increment, not null]
  user_id                     int [not null] // sys_user.id, no FK
  warehouse_id                int [not null, ref : > ref_warehouse.id]
  created_by                  int [not null]
  created_at                  timestamptz [not null, default: `now()`]

  indexes {
    (user_id, warehouse_id) [unique]
    warehouse_id
  }
}

enum StockTransferStatus {
  Draft
  InTransit // Dalam Perjalanan: in the Gudang Transit
  Received
  Cancelled
}

// Stock Adjustment (P318): a count of one warehouse; approving posts the differences,
// Persediaan against Selisih Persediaan. SA/YYYY/MM/NNNN
table log_stock_adjustment {
  id                          int [pk, increment, not null]
  adjustment_no               varchar [not null, unique]
  adjustment_date             date [not null]
  status                      enum('Draft', 'Submitted', 'Posted', 'Rejected', 'Cancelled') [not null, default: 'Draft']
  warehouse_id                int [not null, ref : > ref_warehouse.id]
  note                        varchar
  short_amount                decimal(18,2) [not null, default: 0] // Σ that left, at Posting
  over_amount                 decimal(18,2) [not null, default: 0] // Σ that came in
  journal_id                  int // acc_journal.id, no FK
  status_reason               varchar // why rejected or cancelled
  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (status, adjustment_date)
    warehouse_id
  }
}

table log_stock_adjustment_line {
  id                          int [pk, increment, not null]
  stock_adjustment_id         int [not null, ref : > log_stock_adjustment.id]
  line_no                     int [not null]
  item_id                     int [not null, ref : > m_item.id]
  tracking_id                 int [not null] // log_stock_tracking.id, no FK
  tracking_no                 varchar [not null]
  location_id                 int // ref_warehouse_location.id, no FK
  stock_status_id             int [not null] // sys_stock_status.id, no FK
  book_qty                    decimal(18,6) [not null] // when counted; CHECK >= 0
  counted_qty                 decimal(18,6) // null until counted; CHECK >= 0
  typed_value                 decimal(18,2) // for an excess with the pool empty
  value_amount                decimal(18,2) [not null, default: 0] // moved, signed, at Posting
  note                        varchar

  indexes {
    (stock_adjustment_id, line_no) [unique]
    tracking_id
  }
}

// Transfer Kirim (TSK/YYYY/MM/NNNN): origin -> Gudang Transit (System Default transit_warehouse). No journal;
// each pick is issueStock + receiveStock at the same value, so the pool and its average do not move (OD-6).
table log_stock_transfer {
  id                          int [pk, increment, not null]
  transfer_no                 varchar [not null, unique]
  transfer_date               date [not null]
  status                      StockTransferStatus [not null, default: 'Draft']
  from_warehouse_id           int [not null, ref : > ref_warehouse.id]
  to_warehouse_id             int [not null, ref : > ref_warehouse.id] // CHECK <> from
  transit_warehouse_id        int // copied from System Default at Kirim, no FK
  vehicle_no                  varchar
  driver_name                 varchar
  note                        varchar
  cancel_reason               varchar

  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (status, transfer_date)
    from_warehouse_id
    to_warehouse_id
  }
}

table log_stock_transfer_line {
  id                          int [pk, increment, not null]
  stock_transfer_id           int [not null, ref : > log_stock_transfer.id]
  line_no                     int [not null]
  item_id                     int [not null, ref : > m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id] // the base unit
  base_qty                    decimal(18,4) [not null] // = sum of its tracking rows
  received_qty                decimal(18,4) [not null, default: 0] // sum of posted Transfer Terima, <= base_qty
  note                        varchar

  indexes {
    (stock_transfer_id, line_no) [unique]
    (stock_transfer_id, item_id) [unique]
    item_id
  }
}

// One origin bucket: lot, location, status (any status may travel, OD-4).
table log_stock_transfer_tracking {
  id                          int [pk, increment, not null]
  stock_transfer_line_id      int [not null, ref : > log_stock_transfer_line.id]
  pick_no                     int [not null]
  tracking_id                 int [not null] // log_stock_tracking.id, no FK
  location_id                 int // origin location, no FK
  stock_status_id             int [not null] // sys_stock_status.id, no FK
  tracking_no                 varchar [not null]
  expiry_date                 date
  base_qty                    decimal(18,4) [not null]
  received_qty                decimal(18,4) [not null, default: 0]

  indexes {
    (stock_transfer_line_id, pick_no) [unique]
    (stock_transfer_line_id, tracking_id, location_id, stock_status_id) [unique] // NULLS NOT DISTINCT
    tracking_id
  }
}

enum StockTransferReceiptStatus {
  Draft
  Posted
  Cancelled
}

// Transfer Terima (TST/YYYY/MM/NNNN): Gudang Transit -> destination, one Transfer Kirim, in parts; not before it.
table log_stock_transfer_receipt {
  id                          int [pk, increment, not null]
  receipt_no                  varchar [not null, unique]
  receipt_date                date [not null]
  status                      StockTransferReceiptStatus [not null, default: 'Draft']
  stock_transfer_id           int [not null, ref : > log_stock_transfer.id]
  to_warehouse_id             int [not null, ref : > ref_warehouse.id] // the Kirim's, copied
  note                        varchar
  cancel_reason               varchar

  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    stock_transfer_id
    (status, receipt_date)
  }
}

table log_stock_transfer_receipt_line {
  id                          int [pk, increment, not null]
  receipt_id                  int [not null, ref : > log_stock_transfer_receipt.id]
  line_no                     int [not null]
  stock_transfer_line_id      int [not null, ref : > log_stock_transfer_line.id]
  item_id                     int [not null, ref : > m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id]
  base_qty                    decimal(18,4) [not null]
  note                        varchar

  indexes {
    (receipt_id, line_no) [unique]
    (receipt_id, stock_transfer_line_id) [unique]
    stock_transfer_line_id
  }
}

// One Kirim tracking row into one destination location; lot and status are the Kirim row's.
table log_stock_transfer_receipt_tracking {
  id                          int [pk, increment, not null]
  receipt_line_id             int [not null, ref : > log_stock_transfer_receipt_line.id]
  pick_no                     int [not null]
  stock_transfer_tracking_id  int [not null, ref : > log_stock_transfer_tracking.id]
  tracking_id                 int [not null] // no FK
  stock_status_id             int [not null] // no FK
  location_id                 int // destination location, no FK
  tracking_no                 varchar [not null]
  expiry_date                 date
  base_qty                    decimal(18,4) [not null]

  indexes {
    (receipt_line_id, pick_no) [unique]
    (receipt_line_id, stock_transfer_tracking_id, location_id) [unique] // NULLS NOT DISTINCT
    stock_transfer_tracking_id
  }
}

//////////////////////////////////
//
// Costing Produksi
//
/////////////////////////////////

// Standard Cost (P226): the rate per gram of each Unit; never edited once saved, one Active (partial unique index);
// saving a new version closes the active one, and a partai keeps the id it started on
table prd_rate_version {
  id                          int [pk, increment, not null]

  rate_code                   varchar [not null, unique]

  rate_label                  varchar [not null]
  rate_name                   varchar [not null]

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

table prd_rate_version_line {
  id                          int [pk, increment, not null]

  version_id                  int [not null, ref : > prd_rate_version.id]
  unit_id                     int [not null, ref : > ref_unit.id] // one rate per Unit, charged at its last step (P281)
  rate                        decimal(18,6) [not null]

  indexes {
    (version_id, unit_id) [unique]
    unit_id
  }
}

// BoM Packing (P284, T12): one kotak of a Nama Jual (the kotak item): target gram ± tolerance, piece
// count, bahan penolong per kotak. One active version per item (partial unique index prd_bom_one_active).
table prd_bom {
  id                          int [pk, increment, not null]

  bom_code                    varchar [not null, unique]
  bom_label                   varchar [not null]
  bom_name                    varchar [not null]
  item_id                     int [not null, ref : > m_item.id] // the Nama Jual
  target_grams                decimal(18,6) [not null] // CHECK > 0
  tolerance_grams             decimal(18,6) [not null, default: 0]
  min_pieces                  int [not null] // CHECK >= 1, max >= min
  max_pieces                  int [not null]
  note                        varchar
  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    item_id
  }
}

table prd_bom_component {
  id                          int [pk, increment, not null]

  bom_id                      int [not null, ref : > prd_bom.id]
  item_id                     int [not null, ref : > m_item.id] // bahan penolong
  qty                         decimal(18,4) [not null] // per kotak, base unit; CHECK > 0
  sort_order                  int [not null, default: 0]

  indexes {
    (bom_id, item_id) [unique]
  }
}

// Standard cost absorbed (P227, V1): grams × rate at one Unit, append-only
table prd_cost_entry {
  id                          int [pk, increment, not null]

  posting_date                date [not null]
  source_doc_type_id          int [not null]
  source_doc_id               int [not null]
  source_no                   varchar [not null]

  unit_id                     int [not null, ref : > ref_unit.id]
  rate_version_id             int [not null, ref : > prd_rate_version.id]
  tracking_id                 int [not null, ref : > log_stock_tracking.id]
  partai_no                   varchar // production's No. Partai, as printed (P318)
  line_id                     int [ref : > prd_line.id]
  grams                       decimal(18,6) [not null]
  rate                        decimal(18,6) [not null]
  amount                      decimal(18,2) [not null]
  is_rework                   boolean [not null, default: false] // W66

  created_by                  int [not null]
  created_at                  timestamptz [not null, default: `now()`]
}

// Jenis Biaya (R9): a Tagihan Biaya line's cost and the expense account it books to;
// the month-end close pools the net debit on these accounts (R10)
table acc_cost_type {
  id                          int [pk, increment, not null]

  cost_type_code              varchar [not null, unique]

  cost_type_label             varchar [not null]
  cost_type_name              varchar [not null]
  expense_account_id          int [not null, ref : > acc_account.id] // fixed once chosen

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

// Tagihan Biaya (R9): Dr each line's Jenis Biaya expense account / Cr Account Mapping's
// Hutang Biaya Produksi, copied at posting; paid by Pembayaran Biaya Produksi (P132)
table prd_cost_bill {
  id                          int [pk, increment, not null]

  bill_no                     varchar [not null, unique] // TBP/YYYY/MM/NNNN
  bill_date                   date [not null]
  partner_id                  int [ref : > m_partner.id] // the Supplier owed; required at saving
  supplier_ref                varchar
  due_date                    date
  description                 varchar [not null]
  note                        varchar

  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']
  cancel_reason               varchar
  total_amount                decimal(18,2) [not null, default: 0]
  payable_account_id          int [ref : > acc_account.id] // copied at posting
  paid_amount                 decimal(18,2) [not null, default: 0] // CHECK 0 ≤ paid ≤ total
  journal_id                  int // no FK

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    status
    partner_id
  }
}

table prd_cost_bill_line {
  id                          int [pk, increment, not null]

  bill_id                     int [not null, ref : > prd_cost_bill.id] // cascade
  line_no                     int [not null]
  cost_type_id                int [not null, ref : > acc_cost_type.id]
  amount                      decimal(18,2) [not null]
  note                        varchar

  indexes {
    bill_id
  }
}

//////////////////////////////////////////////////////////////////
//
//  BAGIAN C — APLIKASI PRODUKSI
//  Identitas, buku produksi, dokumen lantai produksi (P254).
//
//////////////////////////////////////////////////////////////////

//////////////////////////////////
//
// Master
//
/////////////////////////////////

// Karyawan (P225, W26): who worked a No. Job at a Pass Through Unit
table m_employee {
  id                          int [pk, increment, not null]

  employee_code               varchar [not null, unique]

  employee_label              varchar [not null]
  employee_name               varchar [not null]

  note                        varchar

  status                      enum('Active', 'Inactive') [not null, default: 'Active']

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

// Which Units a user may open in the Produksi application (P260): permission says
// what, this says where; PRODUCTION_UNIT_ALL needs no row. user_id has no foreign key
table prd_user_unit {
  id                          int [pk, increment, not null]
  user_id                     int [not null] // sys_user.id, no foreign key
  unit_id                     int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP

  created_by                  int [not null]
  created_at                  timestamptz [not null, default: `now()`]

  indexes {
    (user_id, unit_id) [unique]
    unit_id
  }
}

//////////////////////////////////
//
// Identitas
//
/////////////////////////////////

// A partai (P227): names its line, the routing it follows and the Standard Cost it started on
table prd_partai {
  id                          int [pk, increment, not null]

  partai_no                   varchar [not null, unique] // P_<ddmmyy>_<NNNNN> (W11)
  partai_date                 date [not null]
  line_id                     int [not null, ref : > prd_line.id] // lintas aplikasi → ERP
  routing_id                  int [not null, ref : > prd_routing.id] // lintas aplikasi → ERP
  rate_version_id             int [not null, ref : > prd_rate_version.id] // lintas aplikasi → ERP

  source_doc_type_id          int [not null] // the document that formed it, weak
  source_doc_id               int [not null]
  source_no                   varchar [not null]

  created_by                  int [not null]
  created_at                  timestamptz [not null, default: `now()`]
}

// A No. Job (P227): one pickup of one No. Stok when made (W31)
table prd_job {
  id                          int [pk, increment, not null]

  job_no                      varchar [not null, unique] // <kode unit>_<ddmmyy>_<NNNNN> (W11)
  job_date                    date [not null]
  unit_id                     int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP · the Unit that issued it
  tracking_id                 int [ref : > log_stock_tracking.id] // lintas aplikasi → ERP · the No. Stok picked up from; empty for a Job of several (W103, P262)
  partai_id                   int [ref : > prd_partai.id]

  source_doc_type_id          int [not null]
  source_doc_id               int [not null]
  source_no                   varchar [not null]

  created_by                  int [not null]
  created_at                  timestamptz [not null, default: `now()`]
}

// What a No. Stok locked when it started production (P227)
table prd_tracking_info {
  id                          int [pk, increment, not null]

  tracking_id                 int [not null, unique, ref : > log_stock_tracking.id] // lintas aplikasi → ERP
  rate_version_id             int [not null, ref : > prd_rate_version.id] // lintas aplikasi → ERP
  routing_id                  int [ref : > prd_routing.id] // lintas aplikasi → ERP
  grams                       decimal(18,6)
  form                        enum('Bulk', 'Piece', 'Box') [not null, default: 'Bulk']

  created_by                  int [not null]
  created_at                  timestamptz [not null, default: `now()`]
}

//////////////////////////////////
//
// Buku Produksi
//
/////////////////////////////////

table prd_balance {
  id                          int [pk, increment, not null]

  tracking_id                      int [not null, ref : > log_stock_tracking.id] // lintas aplikasi → ERP · the one lot register (P120)
  unit_id              int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP
  stage                       enum('Preparation', 'Working', 'QcCheck', 'StandBy', 'InTransit') [not null, default: 'Preparation'] // Persiapan of a step, Sedang Dikerjakan (Kerja), QC Check (P281), Stand By, Dalam Perjalanan (T4)
  unit_step_id                int [ref : > ref_unit_step.id] // lintas aplikasi → ERP · the step goods wait at; set exactly when stage is Preparation or Working
  partai_id                   int [ref : > prd_partai.id]
  job_id                      int [ref : > prd_job.id]
  item_id                     int [not null, ref : > m_item.id] // lintas aplikasi → ERP
  uom_id                      int [not null, ref : > ref_uom.id] // lintas aplikasi → ERP · the item's base unit

  qty_balance                 decimal(18,6) [not null, default: 0]
  value_balance               decimal(18,2) [not null, default: 0] // CHECK ≥ 0; 0 when the bucket is empty
  auxiliary                   boolean [not null, default: false] // bahan penolong (V8)
  qc_check_id                 int // the QC Check that turned it back (W66)
  transit_doc_type_id         int // the document an InTransit row travels on, weak (T4)
  transit_doc_id              int
  entered_at                  date // when it last rose from empty: the Workspace's Sejak (W111, P262)

  created_by                  int [not null]
  updated_by                  int

  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (tracking_id, unit_id, stage, unit_step_id, partai_id, job_id, qc_check_id, transit_doc_type_id, transit_doc_id) [unique, name: 'prd_balance_bucket_key'] // NULLS NOT DISTINCT
    (unit_id, stage, unit_step_id, job_id) [name: 'prd_balance_held_idx'] // WHERE qty_balance > 0, hand-written (W111, P262)
    unit_id
    item_id
  }
}

// The production ledger (R3): append-only, the balances after each row; MP/… per posting (P110)
table prd_ledger {
  id                          int [pk, increment, not null]

  ledger_no                   varchar [not null]
  line_no                     int [not null]
  posting_date                date [not null]
  source_doc_type_id          int [not null] // weak source pair (§3.1)
  source_doc_id               int [not null]
  source_no                   varchar [not null]
  movement                    enum('Issued', 'Consumed', 'Produced', 'TransferOut', 'TransferIn', 'Released') [not null]
  bucket_id                   int [not null, ref : > prd_balance.id]
  tracking_id                      int [not null, ref : > log_stock_tracking.id] // lintas aplikasi → ERP
  unit_id              int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP
  stage                       enum('Preparation', 'Working', 'QcCheck', 'StandBy', 'InTransit') [not null]
  unit_step_id                int [ref : > ref_unit_step.id] // lintas aplikasi → ERP
  partai_id                   int [ref : > prd_partai.id]
  job_id                      int [ref : > prd_job.id]
  item_id                     int [not null, ref : > m_item.id] // lintas aplikasi → ERP

  qty_change                  decimal(18,6) [not null]
  qty_balance                 decimal(18,6) [not null]
  value_change                decimal(18,2) [not null]
  value_balance               decimal(18,2) [not null]

  created_by                  int [not null]
  created_at                  timestamptz [not null, default: `now()`]

  indexes {
    posting_date [type: brin] // date ranges over the ledger (5.4)
    (ledger_no, line_no) [unique]
    (bucket_id, posting_date)
    (unit_id, posting_date) // a Unit's Kartu Produksi (P327)
    tracking_id
    (source_doc_type_id, source_doc_id)
  }
}

// Genealogy (R12): what each input of an execution gave each output lot
table prd_tracking_link {
  id                          int [pk, increment, not null]

  source_doc_type_id          int [not null]
  source_doc_id               int [not null]
  source_no                   varchar [not null]
  from_bucket_id              int [not null, ref : > prd_balance.id]
  from_tracking_id                 int [not null, ref : > log_stock_tracking.id] // lintas aplikasi → ERP
  to_tracking_id                   int [not null, ref : > log_stock_tracking.id] // lintas aplikasi → ERP
  qty                         decimal(18,6) [not null]
  value                       decimal(18,2) [not null]

  created_at                  timestamptz [not null, default: `now()`]

  indexes {
    (source_doc_type_id, source_doc_id)
    from_tracking_id
    to_tracking_id
  }
}

//////////////////////////////////
//
// Dokumen Lantai Produksi
//
/////////////////////////////////

// A production bucket (P227): one No. Stok · Unit · stage · Partai · Job, the last two optional; Σ value_balance is WIP.
// Written only by production-ledger.ts, beside its ledger row
// The documents of work at a Unit (P241). A bucket is the book's, named by id (§3.1).
table prd_grading {
  id                          int [pk, increment]
  grading_no                  text [unique, not null] // NG_<unit>_<ddmmyy>_<NNNNN>
  grading_date                date [not null]
  unit_id                     int [not null, ref: > ref_unit.id]
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']
  job_id                      int [ref: > prd_job.id] // the Job taken whole (W97); empty: one No. Stok without a Job, in part (W96)
  grams                       decimal(18,6) [not null, default: 0]
  rate                        decimal(18,6) [not null, default: 0]
  input_value                 decimal(18,2) [not null, default: 0]
  cost_amount                 decimal(18,2) [not null, default: 0]
  aux_value                   decimal(18,2) [not null, default: 0]
  scrap_amount                decimal(18,2) [not null, default: 0]
  journal_id                  int
  note                        text
  status_reason               text
  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null]
  updated_at                  timestamptz [not null]
}

// What a No. Grading takes from Persiapan; value, gram and cost written at Posting.
table prd_grading_input {
  id                          int [pk, increment]
  grading_id                  int [not null, ref: > prd_grading.id]
  line_no                     int [not null]
  group_no                    int [not null, default: 1] // the document line: a Job whole or a loose No. Stok in part (T6)
  job_id                      int // the Job of that line
  bucket_id                   int [not null]
  qty                         decimal(18,6) [not null]
  grams                       decimal(18,6) [not null, default: 0]
  value                       decimal(18,2) [not null, default: 0]
  cost_amount                 decimal(18,2) [not null, default: 0]
}

table prd_grading_output {
  id                          int [pk, increment]
  grading_id                  int [not null, ref: > prd_grading.id]
  line_no                     int [not null]
  group_no                    int [not null, default: 1] // the document line whose inputs it comes from (T6)
  item_id                     int [not null, ref: > m_item.id]
  qty                         decimal(18,6) [not null]
  grams                       decimal(18,6) [not null]
  is_bjl                      boolean [not null, default: false]
  tracking_id                 int
  tracking_no                 text
  value                       decimal(18,2) [not null, default: 0]
  to_bucket_id                int
}

// Who graded (P286): optional, several Karyawan per No. Grading.
table prd_grading_employee {
  id                          int [pk, increment, not null]

  grading_id                  int [not null, ref : > prd_grading.id]
  employee_id                 int [not null, ref : > m_employee.id]

  indexes {
    (grading_id, employee_id) [unique]
  }
}

table prd_work {
  id                          int [pk, increment]
  work_no                     text [unique, not null] // KRJ_<unit>_<ddmmyy>_<NNNNN>
  work_date                   date [not null]
  unit_id                     int [not null, ref: > ref_unit.id]
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']
  result_note                 text // read at Penyebaran (W42)
  rate                        decimal(18,6) [not null, default: 0]
  cost_amount                 decimal(18,2) [not null, default: 0]
  aux_value                   decimal(18,2) [not null, default: 0]
  scrap_amount                decimal(18,2) [not null, default: 0]
  journal_id                  int
  note                        text
  status_reason               text
  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null]
  updated_at                  timestamptz [not null]
}

table prd_work_line {
  id                          int [pk, increment]
  work_id                     int [not null, ref: > prd_work.id]
  line_no                     int [not null]
  bucket_id                   int [not null]
  job_id                      int
  employee_id                 int [not null, ref: > m_employee.id]
  qty                         decimal(18,6) [not null]
  grams                       decimal(18,6) [not null, default: 0]
  input_value                 decimal(18,2) [not null, default: 0]
  cost_amount                 decimal(18,2) [not null, default: 0]
  aux_value                   decimal(18,2) [not null, default: 0]
  value                       decimal(18,2) [not null, default: 0]
  to_bucket_id                int
}

table prd_aux_use {
  id                          int [pk, increment]
  grading_id                  int [ref: > prd_grading.id] // exactly one of the two
  work_id                     int [ref: > prd_work.id]
  line_no                     int [not null]
  bucket_id                   int [not null]
  job_id                      int
  qty                         decimal(18,6) [not null]
  value                       decimal(18,2) [not null, default: 0]
}

table prd_qc_check {
  id                          int [pk, increment]
  qc_no                       text [unique, not null] // QCK_<unit>_<ddmmyy>_<NNNNN>
  qc_date                     date [not null]
  unit_id                     int [not null, ref: > ref_unit.id]
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']
  inspector                   text
  note                        text
  status_reason               text
  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null]
  updated_at                  timestamptz [not null]
}

table prd_qc_check_line {
  id                          int [pk, increment]
  qc_check_id                 int [not null, ref: > prd_qc_check.id]
  line_no                     int [not null]
  bucket_id                   int [not null]
  qty                         decimal(18,6) [not null]
  value                       decimal(18,2) [not null, default: 0]
  decision                    enum('Pass', 'Return')
  reason                      text
  to_bucket_id                int
}

// Goods coming into production (P317): a copy of a Stock Issue, waiting for the Unit's Terima
table prd_receipt {
  id                          int [pk, increment, not null]
  receipt_no                  varchar [not null, unique] // the Stock Issue's number
  purpose                     varchar [not null] // material | auxiliary
  unit_id                     int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP
  warehouse_code              varchar [not null]
  warehouse_name              varchar [not null]
  sent_date                   date [not null]
  status                      enum('InTransit', 'Received') [not null, default: 'InTransit']
  received_at                 date
  received_by                 int
  note                        varchar
  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (unit_id, status)
  }
}

table prd_receipt_line {
  id                          int [pk, increment, not null]
  receipt_id                  int [not null, ref : > prd_receipt.id]
  line_no                     int [not null]
  item_id                     int [not null, ref : > m_item.id] // lintas aplikasi → ERP
  tracking_id                 int [not null] // log_stock_tracking.id, no FK
  qty                         decimal(18,6) [not null] // CHECK > 0
  value                       decimal(18,2) [not null, default: 0] // frozen by the sender
  job_id                      int // prd_job.id, no FK; born at Terima (W98)
  bucket_id                   int // prd_balance.id, no FK

  indexes {
    (receipt_id, line_no) [unique]
    tracking_id
  }
}

// Goods leaving production (P317): Dalam Perjalanan at the Unit until the warehouse takes them in
table prd_issue {
  id                          int [pk, increment, not null]
  issue_no                    varchar [not null, unique] // BFG_ / BPG_<unit>_<ddmmyy>_<NNNNN>
  purpose                     varchar [not null] // finish_goods | return
  reason                      varchar // of a return, for reading only
  unit_id                     int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP
  warehouse_code              varchar [not null]
  warehouse_name              varchar [not null]
  issue_date                  date [not null]
  status                      enum('InTransit', 'Received') [not null, default: 'InTransit']
  received_at                 date
  note                        varchar
  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (unit_id, status)
  }
}

table prd_issue_line {
  id                          int [pk, increment, not null]
  issue_id                    int [not null, ref : > prd_issue.id]
  line_no                     int [not null]
  item_id                     int [not null, ref : > m_item.id] // lintas aplikasi → ERP
  tracking_id                 int [not null] // log_stock_tracking.id, no FK
  job_id                      int // prd_job.id, no FK
  partai_id                   int // prd_partai.id, no FK
  qty                         decimal(18,6) [not null] // CHECK > 0
  grams                       decimal(18,6)
  value                       decimal(18,2) [not null, default: 0] // frozen at Kirim
  from_bucket_id              int [not null] // prd_balance.id, no FK
  transit_bucket_id           int [not null] // prd_balance.id, no FK; this document's own row

  indexes {
    (issue_id, line_no) [unique]
    tracking_id
  }
}

// Dokumen Push and BSTB between Units (P277, T8): made and posted (Push) or submitted (BSTB) in one step;
// a BSTB is received by the Unit it goes to. No journal: the value stays in WIP.
table prd_transfer {
  id                          int [pk, increment, not null]
  transfer_no                 varchar [not null, unique] // PSH_<from>_ddmmyy_NNNNN, BST_<to>_ddmmyy_NNNNN
  kind                        enum('Push', 'Bstb', 'BstbPartai') [not null]
  transfer_date               date [not null]
  from_unit_id                int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP · CHECK differs from to_unit_id
  to_unit_id                  int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP
  partai_id                   int [ref : > prd_partai.id] // born at Terima for BstbPartai
  line_id                     int [ref : > prd_line.id] // lintas aplikasi → ERP
  routing_id                  int // the routing of the line the new partai follows
  status                      enum('Submitted', 'Posted') [not null]
  received_at                 date
  received_by                 int
  note                        varchar

  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    from_unit_id
    (to_unit_id, status)
  }
}

table prd_transfer_line {
  id                          int [pk, increment, not null]
  transfer_id                 int [not null, ref : > prd_transfer.id]
  line_no                     int [not null]
  from_bucket_id              int [not null]
  tracking_id                 int [not null] // weak
  job_id                      int [ref : > prd_job.id] // the Job sent, or the one this pickup made
  is_new_job                  boolean [not null, default: false]
  qty                         decimal(18,6) [not null] // CHECK > 0
  grams                       decimal(18,6)
  value                       decimal(18,2) [not null, default: 0]
  transit_bucket_id           int
  to_bucket_id                int

  indexes {
    (transfer_id, line_no) [unique]
  }
}

// Kerja (P282, T13): Mulai moves Jobs at a Unit's Kerja step into Sedang Dikerjakan with one worker each;
// Selesai per line moves them on and, at the Unit's last step, charges the Unit rate with a journal; Batal
// Mulai returns them at no cost. KJ_<unit>_<ddmmyy>_<NNNNN>; one document, one partai.
table prd_kerja {
  id                          int [pk, increment, not null]

  kerja_no                    varchar [not null, unique]
  kerja_date                  date [not null]
  unit_id                     int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP
  unit_step_id                int [not null, ref : > ref_unit_step.id] // lintas aplikasi → ERP · its Kerja step
  partai_id                   int [ref : > prd_partai.id]
  status                      enum('Running', 'Finished', 'Cancelled') [not null, default: 'Running']
  note                        varchar

  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    unit_id
  }
}

table prd_kerja_line {
  id                          int [pk, increment, not null]

  kerja_id                    int [not null, ref : > prd_kerja.id]
  line_no                     int [not null]
  from_bucket_id              int [not null] // the Persiapan bucket taken whole
  work_bucket_id              int // the Sedang Dikerjakan bucket
  to_bucket_id                int // where Selesai or Batal Mulai put it
  tracking_id                 int [not null]
  job_id                      int [ref : > prd_job.id]
  employee_id                 int [not null, ref : > m_employee.id]
  qty                         decimal(18,6) [not null] // CHECK > 0
  grams                       decimal(18,6)
  is_rework                   boolean [not null, default: false] // a Balik QC row worked again
  value                       decimal(18,2) [not null, default: 0] // carried in at Mulai
  cost_amount                 decimal(18,2) [not null, default: 0] // the Unit rate Selesai charged
  journal_id                  int // the journal of that Selesai
  started_at                  timestamptz [not null, default: `now()`]
  finished_at                 timestamptz
  cancelled_at                timestamptz // CHECK not both
  closed_by                   int

  indexes {
    (kerja_id, line_no) [unique]
    work_bucket_id
  }
}

// Job Order (P283, T7): several No. Stok (in part) and one target jenis become one new No. Stok
// <largest input>-<n> with its own No. Job and JO_<job no>. JOD_<unit>_<ddmmyy>_<NNNNN>, posted in one
// step; gram unchanged, no Unit rate; a journal only when WIP accounts differ.
table prd_job_order {
  id                          int [pk, increment, not null]

  job_order_doc_no            varchar [not null, unique]
  doc_date                    date [not null]
  unit_id                     int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP
  unit_step_id                int [not null, ref : > ref_unit_step.id] // lintas aplikasi → ERP · its Job Order step
  partai_id                   int [ref : > prd_partai.id]
  journal_id                  int
  note                        varchar

  created_by                  int [not null]
  created_at                  timestamptz [not null, default: `now()`]

  indexes {
    unit_id
  }
}

table prd_job_order_line {
  id                          int [pk, increment, not null]

  job_order_id                int [not null, ref : > prd_job_order.id]
  line_no                     int [not null]
  target_item_id              int [not null, ref : > m_item.id] // lintas aplikasi → ERP · the jenis chosen
  job_order_no                varchar [not null, unique] // JO_<job no>
  grams                       decimal(18,6) [not null] // Σ inputs, no loss; CHECK > 0
  value                       decimal(18,2) [not null, default: 0]
  job_id                      int [not null, ref : > prd_job.id]
  tracking_id                 int [not null] // the new No. Stok
  tracking_no                 varchar [not null]
  to_bucket_id                int [not null]

  indexes {
    (job_order_id, line_no) [unique]
  }
}

table prd_job_order_input {
  id                          int [pk, increment, not null]

  job_order_line_id           int [not null, ref : > prd_job_order_line.id]
  bucket_id                   int [not null]
  tracking_id                 int [not null]
  qty                         decimal(18,6) [not null] // what is taken; the rest stays. CHECK > 0
  grams                       decimal(18,6) [not null]
  value                       decimal(18,2) [not null, default: 0]

  indexes {
    job_order_line_id
  }
}

// Kotak (P284, T12): pieces from Persiapan of a Unit's Assembly step, each with a unique CAIQ, become one
// new No. Stok KTK-<ddmmyy>-<nnn> of the Nama Jual item in Stand By, with no Job. ASM_<unit>_<ddmmyy>_<NNNNN>.
// value = piece_value + cost_amount (Unit rate × gram of pieces) + aux_value (CHECK).
table prd_box {
  id                          int [pk, increment, not null]

  box_doc_no                  varchar [not null, unique]
  box_date                    date [not null]
  unit_id                     int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP
  unit_step_id                int [not null, ref : > ref_unit_step.id] // lintas aplikasi → ERP · its Assembly step
  bom_id                      int [not null, ref : > prd_bom.id] // lintas aplikasi → ERP
  item_id                     int [not null, ref : > m_item.id] // lintas aplikasi → ERP · the Nama Jual
  partai_id                   int [ref : > prd_partai.id] // when every piece is of one partai
  tracking_id                 int [not null] // the kotak's No. Stok
  tracking_no                 varchar [not null, unique]
  grams                       decimal(18,6) [not null]
  pieces                      int [not null]
  piece_value                 decimal(18,2) [not null, default: 0]
  cost_amount                 decimal(18,2) [not null, default: 0]
  aux_value                   decimal(18,2) [not null, default: 0]
  value                       decimal(18,2) [not null, default: 0]
  to_bucket_id                int [not null]
  journal_id                  int

  created_by                  int [not null]
  created_at                  timestamptz [not null, default: `now()`]

  indexes {
    unit_id
  }
}

table prd_box_piece {
  id                          int [pk, increment, not null]

  box_id                      int [not null, ref : > prd_box.id]
  line_no                     int [not null]
  bucket_id                   int [not null]
  tracking_id                 int [not null]
  partai_id                   int
  grams                       decimal(18,6) [not null]
  value                       decimal(18,2) [not null, default: 0]
  caiq                        varchar [not null, unique]
  is_manual                   boolean [not null, default: false] // put in by a click, not a scan (P249)

  indexes {
    (box_id, line_no) [unique]
  }
}

table prd_box_component {
  id                          int [pk, increment, not null]

  box_id                      int [not null, ref : > prd_box.id]
  item_id                     int [not null]
  bucket_id                   int [not null] // the Unit's bahan penolong balance
  qty                         decimal(18,6) [not null] // CHECK > 0
  value                       decimal(18,2) [not null, default: 0]

  indexes {
    box_id
  }
}

```
