# ERP — skema Produksi bila Simulasi Workspace Unit diterapkan (DBML target)

**Ini bukan skema yang berlaku.** Skema yang berlaku ada di `erp.dbml.md`
(migrasi `20261111180000_workspace_foundation` dan sesudahnya). File ini
menunjukkan bentuk tabel produksi **kalau putaran 8–10 Simulasi Workspace Unit
diterapkan**
(<https://claude.ai/artifact/TR9atVSRmuRUyh9nn9hHU7>, versi 19).
Isinya rencana: belum dicatat di Claude-ERP §12 atau PWR, dan belum ada
migrasinya.

- **Cakupan:** hanya tabel produksi — Struktur Produksi, BSTB Issue dan
  Costing (milik ERP), serta Bagian C (milik Produksi). Tabel ERP lain yang
  dirujuk ditulis sebagai rangka singkat di akhir, supaya blok ini tetap bisa
  digambar di <https://dbdiagram.io>.
- **Konvensi** sama dengan `erp.dbml.md`: enum ditulis inline, pasangan
  `(doc_type_id, doc_id)` atau id tanpa `ref` adalah referensi lemah, dan
  `// lintas aplikasi → <bagian>` menandai foreign key ke bagian lain.
- **Harga tidak tampil di layar Produksi** (putaran 10), **tetapi nilai tetap
  disimpan.** Buku produksi masih menilai barang (WIP, standard cost, journal
  ke ERP). Kolom nilai di bawah hanya dibaca aplikasi ERP: Costing, Closing dan
  journal.
- **Konsekuensi:** keputusan W97, W107, W111, P241, P264 dan P265 berubah, dan
  data produksi harus di-reset dulu (`db:reset-production`, dengan persetujuan
  user).

## Perubahan terhadap skema sekarang

| # | Konsep (putaran) | Tabel |
| --- | --- | --- |
| T1 | **Satu Unit = urutan proses** (Grading, Job Order, Assign, QC, Assembly); tiap proses punya tab Persiapan dan dokumennya sendiri. Satu proses tidak boleh muncul dua kali dalam satu Unit, dan QC selalu terakhir. Kalau line lain butuh urutan proses lain, buat Unit lain (r8) | **baru `ref_unit_step`**; `ref_unit.process`, `has_qc`, `releases_job`, `issues_job_order` **dihapus**; **baru `ref_unit.allow_reproses`** |
| T2 | **Grading selalu melepas No. Job**, dan hasilnya selalu No. Stok baru (r8) | aturan, tanpa kolom (`releases_job` hilang) |
| T3 | **Standard Cost dipilih per Unit dan proses**. QC dan Job Order tanpa rate (r8) | `prd_rate_version_line.unit_step_id` menggantikan `unit_id`; `prd_cost_entry.unit_step_id` |
| T4 | **Barang tahu sedang di Unit mana dan di proses apa**: Persiapan proses tertentu, Stand By, atau Dalam Perjalanan. Dalam Perjalanan hanya status, bukan reservasi; QC menjadi proses, bukan tahap (r8) | `prd_balance` / `prd_ledger`: stage `Preparation · StandBy · InTransit`, **baru `unit_step_id`**; stage `QcCheck` hilang |
| T5 | **Checkpoint partai** di Dry A dan Barcoding (r8) | `prd_routing_step.is_checkpoint`, tetap |
| T6 | **Dokumen Grading berisi banyak Job**, karyawan bisa lebih dari satu di header, satu nomor NG per dokumen (r10) | **baru `prd_grading_line`, `prd_grading_worker`**; `prd_grading.job_id` dan figur header pindah ke baris |
| T7 | **Job Order mencampur**: beberapa No. Stok (boleh sebagian) dan satu jenis target menjadi satu No. Stok baru dengan No. Job dan Job Order sendiri (r10) | **baru `prd_job_order`, `prd_job_order_line`, `prd_job_order_input`** |
| T8 | **Barang tanpa Job yang diambil mendapat Job**. Push dan BSTB mengambil per gram, dan satu No. Stok bisa menjadi banyak Job (r8, r10) | **baru `prd_transfer`, `prd_transfer_line`**: Dokumen Push, BSTB Transfer, BSTB Penyebaran |
| T9 | **QC Balik kembali ke proses pertama Unit**, bukan Reproses (r8) | aturan; `prd_balance.qc_check_id` tetap |
| T10 | **Reproses = pindah ke Unit sebelumnya**, hanya kalau Unit mengizinkan, dan tidak melewati checkpoint yang sudah dilewati partai (r8) | **baru `prd_reproses`, `prd_reproses_line`** |
| T11 | **BSTB Pengeluaran** ke Logistik: Draft → Ajukan → Terima (P238) | **baru `log_production_return`, `_line`** |
| T12 | **Packing 95 memakai BoM per Nama Jual**: keping menurut gram, bahan kemas per kotak, satu versi aktif (r10) | **baru `prd_bom`, `prd_bom_component`** (ERP); **baru `prd_box`, `prd_box_piece`, `prd_box_component`** (Produksi) |

Tidak berubah: `ref_workstation`, `prd_line`, `prd_routing`, `prd_cost_bill`,
`acc_cost_type`, `m_employee`, `prd_user_unit`, `prd_partai`, `prd_job`,
`prd_tracking_info`, `prd_tracking_link`, `prd_work` dan `prd_work_line`
(sekarang proses Assign), `prd_qc_check` dan `_line`, serta `log_stock_issue`
dan `_line` / `_tracking`. BSTB Issue sudah memberi Job saat Terima (P262).

```dbml
//////////////////////////////////////////////////////////////////
//
//  BAGIAN B — ERP (tabel produksi milik ERP)
//
//////////////////////////////////////////////////////////////////

//////////////////////////////////
//
// Struktur Produksi — master, dibaca aplikasi Produksi
//
/////////////////////////////////

// Workstation: only groups Units (unchanged)
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

// Unit (T1): where goods are held; what it does is its ordered steps (ref_unit_step).
// Dropped: process, has_qc (a QC step), releases_job (grading always releases, T2), issues_job_order (a Job Order step)
table ref_unit {
  id                          int [pk, increment, not null]
  unit_code                   varchar [not null, unique]
  unit_label                  varchar [not null] // short code in document numbers, e.g. UML
  unit_name                   varchar [not null]
  workstation_id              int [ref : > ref_workstation.id]
  allow_reproses              boolean [not null, default: false] // T10: may send goods back to an earlier Unit; on by default for a Unit with a QC step
  note                        varchar
  status                      enum('Active', 'Inactive') [not null, default: 'Active']
  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

// The routing inside a Unit (T1): goods received enter step 1; a posted step document moves them to the next
// step's Persiapan without a Push; after the last step they wait in Stand By.
// Rules (in code): a process once per Unit; QC is the last step; Assembly stands alone; locked once goods have moved through it
table ref_unit_step {
  id                          int [pk, increment, not null]
  unit_id                     int [not null, ref : > ref_unit.id]
  seq                         int [not null] // 1 = the step goods are received into
  process                     enum('Grading', 'JobOrder', 'Assign', 'QC', 'Assembly') [not null]

  indexes {
    (unit_id, seq) [unique]
    (unit_id, process) [unique] // no process twice in one Unit
  }
}

// Line Produksi (unchanged)
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

// Routing line (unchanged): the order of Units; no line = the segment before the partai
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
  is_checkpoint               boolean [not null, default: false] // T5: the whole partai must stand in Stand By here before it leaves (UDA, UBC)
  is_skippable                boolean [not null, default: false]

  indexes {
    (routing_id, seq) [unique]
    (routing_id, unit_id) [unique]
    unit_id
  }
}

// BoM Packing (T12): one active version per Nama Jual (output item) at an Assembly Unit (partial unique index on
// output_item_id WHERE status = 'Active'); never edited once used, a change is a new version
table prd_bom {
  id                          int [pk, increment, not null]
  bom_code                    varchar [not null, unique]
  output_item_id              int [not null, ref : > m_item.id] // the Nama Jual, e.g. B-MK 50 gr
  version                     int [not null]
  unit_id                     int [not null, ref : > ref_unit.id] // an Assembly Unit, e.g. UP5
  piece_item_id               int [not null, ref : > m_item.id] // the pieces it is filled with (keping)
  target_grams                decimal(18,6) [not null]
  tolerance_grams             decimal(18,6) [not null]
  min_pieces                  int [not null]
  max_pieces                  int [not null]
  note                        varchar
  status                      enum('Active', 'Inactive') [not null, default: 'Inactive']
  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]

  indexes {
    (output_item_id, version) [unique]
  }
}

// Packaging per box (T12): taken exactly as stated from the Unit's bahan penolong when a box is closed
table prd_bom_component {
  id                          int [pk, increment, not null]
  bom_id                      int [not null, ref : > prd_bom.id]
  line_no                     int [not null]
  item_id                     int [not null, ref : > m_item.id] // wadah, stiker daun, gramasi, …
  qty_per_box                 decimal(18,4) [not null]
  uom_id                      int [not null, ref : > ref_uom.id]

  indexes {
    (bom_id, line_no) [unique]
    (bom_id, item_id) [unique]
  }
}

//////////////////////////////////
//
// BSTB Issue — dokumen batas ke Produksi (unchanged; Terima gives every pickup its No. Job, P262)
//
/////////////////////////////////

table log_stock_issue {
  id                          int [pk, increment, not null]
  issue_no                    varchar [not null, unique] // BSTB_<unit>_<ddmmyy>_<NNNNN>
  issue_date                  date [not null]
  status                      enum('Draft', 'Submitted', 'Posted', 'Cancelled') [not null, default: 'Draft']
  purpose                     varchar [not null] // production_issue · auxiliary_issue
  warehouse_id                int [not null, ref : > ref_warehouse.id]
  unit_id                     int [ref : > ref_unit.id]
  note                        varchar
  cost_amount                 decimal(18,2) [not null, default: 0]
  journal_id                  int
  cancel_reason               varchar
  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

table log_stock_issue_line {
  id                          int [pk, increment, not null]
  stock_issue_id              int [not null, ref : > log_stock_issue.id]
  line_no                     int [not null]
  item_id                     int [not null, ref : > m_item.id]
  uom_id                      int [not null, ref : > ref_uom.id]
  uom_factor                  decimal(18,4) [not null, default: 1]
  qty                         decimal(18,4) [not null]
  base_qty                    decimal(18,4) [not null, default: 0]
  cost_amount                 decimal(18,2) [not null, default: 0]
}

table log_stock_issue_tracking {
  id                          int [pk, increment, not null]
  stock_issue_line_id         int [not null, ref : > log_stock_issue_line.id]
  pick_no                     int [not null]
  tracking_id                 int [not null] // no FK
  location_id                 int
  tracking_no                 varchar [not null]
  base_qty                    decimal(18,4) [not null, default: 0]
  cost_amount                 decimal(18,2) [not null, default: 0]
  prd_bucket_id               int // weak
}

// BSTB Pengeluaran (T11, P238): goods leave production to Logistik — reject, return. Draft → Ajukan (goods InTransit)
// → Terima by Logistik; numbered by the origin Unit
table log_production_return {
  id                          int [pk, increment, not null]
  return_no                   varchar [not null, unique] // BPG_<unit>_<ddmmyy>_<NNNNN>
  return_date                 date [not null]
  status                      enum('Draft', 'Submitted', 'Received', 'Cancelled') [not null, default: 'Draft']
  from_unit_id                int [not null, ref : > ref_unit.id]
  warehouse_id                int [ref : > ref_warehouse.id] // set by Logistik at Terima
  reason                      varchar
  journal_id                  int
  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null, default: `now()`]
  updated_at                  timestamptz [not null, default: `now()`]
}

table log_production_return_line {
  id                          int [pk, increment, not null]
  return_id                   int [not null, ref : > log_production_return.id]
  line_no                     int [not null]
  bucket_id                   int [not null] // prd_balance.id, weak
  tracking_id                 int [not null] // weak
  grams                       decimal(18,6) [not null]
  value                       decimal(18,2) [not null, default: 0]
}

//////////////////////////////////
//
// Costing Produksi
//
/////////////////////////////////

// Standard Cost (unchanged header): one Active version
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

// T3: a rate per gram per Unit and step (Grading, Assign, Assembly); QC and Job Order carry none, a step left out costs 0
table prd_rate_version_line {
  id                          int [pk, increment, not null]
  version_id                  int [not null, ref : > prd_rate_version.id]
  unit_step_id                int [not null, ref : > ref_unit_step.id] // replaces unit_id
  rate                        decimal(18,6) [not null]

  indexes {
    (version_id, unit_step_id) [unique]
  }
}

// Standard cost absorbed: grams × rate at one Unit step, append-only
table prd_cost_entry {
  id                          int [pk, increment, not null]
  posting_date                date [not null]
  source_doc_type_id          int [not null]
  source_doc_id               int [not null]
  source_no                   varchar [not null]
  unit_id                     int [not null, ref : > ref_unit.id]
  unit_step_id                int [not null, ref : > ref_unit_step.id] // T3
  rate_version_id             int [not null, ref : > prd_rate_version.id]
  tracking_id                 int [not null, ref : > log_stock_tracking.id]
  partai_id                   int [ref : > prd_partai.id] // lintas aplikasi → Produksi
  line_id                     int [ref : > prd_line.id]
  grams                       decimal(18,6) [not null]
  rate                        decimal(18,6) [not null]
  amount                      decimal(18,2) [not null]
  is_rework                   boolean [not null, default: false] // worked again after QC Balik
  created_by                  int [not null]
  created_at                  timestamptz [not null, default: `now()`]
}

table acc_cost_type {
  id                          int [pk, increment, not null]
  cost_type_code              varchar [not null, unique]
  cost_type_label             varchar [not null]
  cost_type_name              varchar [not null]
  expense_account_id          int [not null, ref : > acc_account.id]
  status                      enum('Active', 'Inactive') [not null, default: 'Active']
}

table prd_cost_bill {
  id                          int [pk, increment, not null]
  bill_no                     varchar [not null, unique] // TBP/YYYY/MM/NNNN
  bill_date                   date [not null]
  partner_id                  int [ref : > m_partner.id]
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']
  total_amount                decimal(18,2) [not null, default: 0]
  paid_amount                 decimal(18,2) [not null, default: 0]
  journal_id                  int
}

table prd_cost_bill_line {
  id                          int [pk, increment, not null]
  bill_id                     int [not null, ref : > prd_cost_bill.id]
  line_no                     int [not null]
  cost_type_id                int [not null, ref : > acc_cost_type.id]
  amount                      decimal(18,2) [not null]
}

//////////////////////////////////////////////////////////////////
//
//  BAGIAN C — APLIKASI PRODUKSI
//
//////////////////////////////////////////////////////////////////

//////////////////////////////////
//
// Master
//
/////////////////////////////////

table m_employee {
  id                          int [pk, increment, not null]
  employee_code               varchar [not null, unique]
  employee_label              varchar [not null]
  employee_name               varchar [not null]
  status                      enum('Active', 'Inactive') [not null, default: 'Active']
}

table prd_user_unit {
  id                          int [pk, increment, not null]
  user_id                     int [not null] // no FK
  unit_id                     int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP

  indexes {
    (user_id, unit_id) [unique]
  }
}

//////////////////////////////////
//
// Identitas
//
/////////////////////////////////

table prd_partai {
  id                          int [pk, increment, not null]
  partai_no                   varchar [not null, unique] // P_<ddmmyy>_<NNNNN>
  partai_date                 date [not null]
  line_id                     int [not null, ref : > prd_line.id] // lintas aplikasi → ERP
  routing_id                  int [not null, ref : > prd_routing.id] // lintas aplikasi → ERP
  rate_version_id             int [not null, ref : > prd_rate_version.id] // lintas aplikasi → ERP
  source_doc_type_id          int [not null] // the BSTB Penyebaran received
  source_doc_id               int [not null]
  source_no                   varchar [not null]
}

// A No. Job: born by every pickup of goods without one — BSTB Issue Terima, a Push / BSTB pickup, Job Order, QC Balik,
// Reproses (T8, T9) — and released by every grading (T2). A Job always moves whole.
table prd_job {
  id                          int [pk, increment, not null]
  job_no                      varchar [not null, unique] // <unit>_<ddmmyy>_<NNNNN>
  job_date                    date [not null]
  unit_id                     int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP · the Unit that issued it
  tracking_id                 int [ref : > log_stock_tracking.id] // lintas aplikasi → ERP · the No. Stok picked up from
  partai_id                   int [ref : > prd_partai.id]
  job_order_no                varchar [unique] // JO_<job_no> when born by a Job Order (T7)
  source_doc_type_id          int [not null]
  source_doc_id               int [not null]
  source_no                   varchar [not null]
}

table prd_tracking_info {
  id                          int [pk, increment, not null]
  tracking_id                 int [not null, unique, ref : > log_stock_tracking.id] // lintas aplikasi → ERP
  rate_version_id             int [not null, ref : > prd_rate_version.id] // lintas aplikasi → ERP
  routing_id                  int [ref : > prd_routing.id] // lintas aplikasi → ERP
  grams                       decimal(18,6)
  form                        enum('Bulk', 'Piece', 'Box') [not null, default: 'Bulk']
  caiq_no                     varchar [unique] // a piece paired in a box (T12)
}

//////////////////////////////////
//
// Buku Produksi
//
/////////////////////////////////

// A bucket (T4): No. Stok · Unit · where in the Unit · Partai · Job. Where = the Persiapan of one step
// (unit_step_id set), Stand By (after the last step) or InTransit (a submitted BSTB / Pengeluaran / Reproses:
// still at this Unit, a status and not a reservation). Σ value_balance is WIP, read by the ERP only.
table prd_balance {
  id                          int [pk, increment, not null]
  tracking_id                 int [not null, ref : > log_stock_tracking.id] // lintas aplikasi → ERP
  unit_id                     int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP
  stage                       enum('Preparation', 'StandBy', 'InTransit') [not null, default: 'Preparation'] // QcCheck dropped: QC is a step
  unit_step_id                int [ref : > ref_unit_step.id] // lintas aplikasi → ERP · set exactly when stage = Preparation
  partai_id                   int [ref : > prd_partai.id]
  job_id                      int [ref : > prd_job.id]
  item_id                     int [not null, ref : > m_item.id] // lintas aplikasi → ERP
  uom_id                      int [not null, ref : > ref_uom.id] // lintas aplikasi → ERP
  qty_balance                 decimal(18,6) [not null, default: 0]
  value_balance               decimal(18,2) [not null, default: 0]
  auxiliary                   boolean [not null, default: false] // bahan penolong
  qc_check_id                 int // T9: the QC Check that turned it back to the first step (Balik QC)
  transit_doc_type_id         int // T4: the document it travels on while InTransit, weak
  transit_doc_id              int
  entered_at                  date // the Workspace's Sejak

  indexes {
    (tracking_id, unit_id, stage, unit_step_id, partai_id, job_id) [unique] // NULLS NOT DISTINCT
    (unit_id, stage, unit_step_id, job_id) [name: 'prd_balance_held_idx'] // WHERE qty_balance > 0
    item_id
  }
}

// The production ledger: append-only, balances after each row; one MP/… per posting. A step move inside a Unit
// writes TransferOut / TransferIn like a move between Units (P266)
table prd_ledger {
  id                          int [pk, increment, not null]
  ledger_no                   varchar [not null]
  line_no                     int [not null]
  posting_date                date [not null]
  source_doc_type_id          int [not null]
  source_doc_id               int [not null]
  source_no                   varchar [not null]
  movement                    enum('Issued', 'Consumed', 'Produced', 'TransferOut', 'TransferIn', 'Released') [not null]
  bucket_id                   int [not null, ref : > prd_balance.id]
  tracking_id                 int [not null, ref : > log_stock_tracking.id] // lintas aplikasi → ERP
  unit_id                     int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP
  stage                       enum('Preparation', 'StandBy', 'InTransit') [not null]
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
    posting_date [type: brin]
    (ledger_no, line_no) [unique]
    (bucket_id, posting_date)
    (source_doc_type_id, source_doc_id)
  }
}

// Genealogy: what each input gave each output — grading, Job Order (many inputs → one output, T7) and box
table prd_tracking_link {
  id                          int [pk, increment, not null]
  source_doc_type_id          int [not null]
  source_doc_id               int [not null]
  source_no                   varchar [not null]
  from_bucket_id              int [not null, ref : > prd_balance.id]
  from_tracking_id            int [not null, ref : > log_stock_tracking.id] // lintas aplikasi → ERP
  to_tracking_id              int [not null, ref : > log_stock_tracking.id] // lintas aplikasi → ERP
  qty                         decimal(18,6) [not null]
  value                       decimal(18,2) [not null]

  indexes {
    from_tracking_id
    to_tracking_id
  }
}

//////////////////////////////////
//
// Dokumen lantai produksi — satu dokumen per proses (T1)
//
/////////////////////////////////

// Grading (T6): one document, many Jobs; NG_<unit>_<ddmmyy>_<NNNNN>; Posting needs every line complete.
// Every output is a new No. Stok <origin>-<n> without a Job (T2)
table prd_grading {
  id                          int [pk, increment]
  grading_no                  varchar [unique, not null]
  grading_date                date [not null]
  unit_id                     int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP
  unit_step_id                int [not null, ref : > ref_unit_step.id] // lintas aplikasi → ERP · its Grading step
  partai_id                   int [ref : > prd_partai.id] // one partai per document
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']
  journal_id                  int
  note                        varchar
  status_reason               varchar
  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null]
  updated_at                  timestamptz [not null]
}

// The karyawan who graded (T6): optional, several
table prd_grading_worker {
  id                          int [pk, increment]
  grading_id                  int [not null, ref : > prd_grading.id]
  employee_id                 int [not null, ref : > m_employee.id]

  indexes {
    (grading_id, employee_id) [unique]
  }
}

// One Job graded (T6), filled in a panel; a line without a Job is one No. Stok
table prd_grading_line {
  id                          int [pk, increment]
  grading_id                  int [not null, ref : > prd_grading.id]
  line_no                     int [not null]
  job_id                      int [ref : > prd_job.id] // released at Posting (T2)
  grams                       decimal(18,6) [not null, default: 0]
  input_value                 decimal(18,2) [not null, default: 0] // values: ERP only
  cost_amount                 decimal(18,2) [not null, default: 0]
  aux_value                   decimal(18,2) [not null, default: 0]
  scrap_amount                decimal(18,2) [not null, default: 0]

  indexes {
    (grading_id, line_no) [unique]
  }
}

table prd_grading_input {
  id                          int [pk, increment]
  grading_line_id             int [not null, ref : > prd_grading_line.id] // was grading_id
  line_no                     int [not null]
  bucket_id                   int [not null]
  qty                         decimal(18,6) [not null]
  grams                       decimal(18,6) [not null, default: 0]
  value                       decimal(18,2) [not null, default: 0]
  cost_amount                 decimal(18,2) [not null, default: 0]
}

table prd_grading_output {
  id                          int [pk, increment]
  grading_line_id             int [not null, ref : > prd_grading_line.id] // was grading_id
  line_no                     int [not null]
  item_id                     int [not null, ref : > m_item.id] // lintas aplikasi → ERP
  qty                         decimal(18,6) [not null]
  grams                       decimal(18,6) [not null]
  is_bjl                      boolean [not null, default: false]
  tracking_id                 int // the new No. Stok
  tracking_no                 varchar
  value                       decimal(18,2) [not null, default: 0]
  to_bucket_id                int
}

// Job Order (T7): JOD_<unit>_<ddmmyy>_<NNNNN>; each line mixes several No. Stok (in part allowed) into one new
// No. Stok of its target jenis with its own No. Job and Job Order; no rate, no journal. The mix is accepted:
// tracing reaches the set of inputs, not one piece
table prd_job_order {
  id                          int [pk, increment]
  job_order_doc_no            varchar [unique, not null]
  doc_date                    date [not null]
  unit_id                     int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP
  unit_step_id                int [not null, ref : > ref_unit_step.id] // lintas aplikasi → ERP
  partai_id                   int [ref : > prd_partai.id]
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']
  note                        varchar
  status_reason               varchar
  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null]
  updated_at                  timestamptz [not null]
}

table prd_job_order_line {
  id                          int [pk, increment]
  job_order_id                int [not null, ref : > prd_job_order.id]
  line_no                     int [not null]
  target_item_id              int [not null, ref : > m_item.id] // lintas aplikasi → ERP · the jenis chosen
  grams                       decimal(18,6) [not null, default: 0] // Σ inputs, no loss
  value                       decimal(18,2) [not null, default: 0]
  job_id                      int [ref : > prd_job.id] // born at Posting, carries job_order_no
  tracking_id                 int // the new No. Stok <largest input>-<n>
  tracking_no                 varchar
  to_bucket_id                int

  indexes {
    (job_order_id, line_no) [unique]
  }
}

table prd_job_order_input {
  id                          int [pk, increment]
  job_order_line_id           int [not null, ref : > prd_job_order_line.id]
  bucket_id                   int [not null]
  grams                       decimal(18,6) [not null] // what is taken; the rest stays
  value                       decimal(18,2) [not null, default: 0]
}

// Assign (P241, unchanged tables): Pengerjaan Unit, one karyawan per Job, Jobs taken whole
table prd_work {
  id                          int [pk, increment]
  work_no                     varchar [unique, not null] // KRJ_<unit>_<ddmmyy>_<NNNNN>
  work_date                   date [not null]
  unit_id                     int [not null, ref : > ref_unit.id]
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']
  result_note                 varchar
  rate                        decimal(18,6) [not null, default: 0]
  cost_amount                 decimal(18,2) [not null, default: 0]
  aux_value                   decimal(18,2) [not null, default: 0]
  journal_id                  int
}

table prd_work_line {
  id                          int [pk, increment]
  work_id                     int [not null, ref : > prd_work.id]
  line_no                     int [not null]
  bucket_id                   int [not null]
  job_id                      int
  employee_id                 int [not null, ref : > m_employee.id]
  grams                       decimal(18,6) [not null, default: 0]
  cost_amount                 decimal(18,2) [not null, default: 0]
  value                       decimal(18,2) [not null, default: 0]
  to_bucket_id                int
}

// QC Check (unchanged tables): the Unit's last step; Lulus to Stand By, Balik to the first step's Persiapan (T9)
table prd_qc_check {
  id                          int [pk, increment]
  qc_no                       varchar [unique, not null] // QCK_<unit>_<ddmmyy>_<NNNNN>
  qc_date                     date [not null]
  unit_id                     int [not null, ref : > ref_unit.id]
  status                      enum('Draft', 'Posted', 'Cancelled') [not null, default: 'Draft']
  note                        varchar
}

table prd_qc_check_line {
  id                          int [pk, increment]
  qc_check_id                 int [not null, ref : > prd_qc_check.id]
  line_no                     int [not null]
  bucket_id                   int [not null]
  qty                         decimal(18,6) [not null]
  decision                    enum('Pass', 'Return')
  reason                      varchar
  to_bucket_id                int
}

// Bahan penolong used by a grading, an Assign or a box (exactly one of the three)
table prd_aux_use {
  id                          int [pk, increment]
  grading_id                  int [ref : > prd_grading.id]
  work_id                     int [ref : > prd_work.id]
  box_id                      int [ref : > prd_box.id]
  line_no                     int [not null]
  bucket_id                   int [not null]
  qty                         decimal(18,6) [not null]
  value                       decimal(18,2) [not null, default: 0]
}

// Moving goods between Units (T8): Dokumen Push inside a Workstation (Posted at once, PSH_<unit>_…, no Terima),
// BSTB across (Submitted → goods InTransit → Received at the receiving Unit, BSTB_<to unit>_…), BSTB Penyebaran
// forming the partai at Terima. Leaves from Stand By only; a checkpoint Unit sends the whole partai (T5)
table prd_transfer {
  id                          int [pk, increment]
  transfer_no                 varchar [unique, not null]
  kind                        enum('Push', 'Bstb', 'BstbPartai') [not null]
  transfer_date               date [not null]
  from_unit_id                int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP
  to_unit_id                  int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP
  partai_id                   int [ref : > prd_partai.id] // empty before the partai; born at Terima for BstbPartai
  line_id                     int [ref : > prd_line.id] // BstbPartai: the line the new partai follows
  status                      enum('Draft', 'Submitted', 'Posted', 'Cancelled') [not null, default: 'Draft'] // Posted = received
  received_at                 date
  received_by                 int
  created_by                  int [not null]
  updated_by                  int
  created_at                  timestamptz [not null]
  updated_at                  timestamptz [not null]
}

// One pickup (T8): a Job sent whole, or grams taken from a No. Stok without a Job — each such line is one new No. Job
table prd_transfer_line {
  id                          int [pk, increment]
  transfer_id                 int [not null, ref : > prd_transfer.id]
  line_no                     int [not null]
  from_bucket_id              int [not null]
  tracking_id                 int [not null] // weak
  job_id                      int [ref : > prd_job.id] // the Job sent whole, or the one born by this pickup
  is_new_job                  boolean [not null, default: false]
  grams                       decimal(18,6) [not null]
  value                       decimal(18,2) [not null, default: 0]
  to_bucket_id                int

  indexes {
    (transfer_id, line_no) [unique]
  }
}

// Reproses (T10): moves goods back to an earlier Unit of the partai's routing, never past a checkpoint the partai
// passed, only from a Unit with allow_reproses; a Push inside a Workstation, a BSTB without QC across; RPR_<unit>_…
table prd_reproses {
  id                          int [pk, increment]
  reproses_no                 varchar [unique, not null]
  reproses_date               date [not null]
  from_unit_id                int [not null, ref : > ref_unit.id]
  to_unit_id                  int [not null, ref : > ref_unit.id]
  partai_id                   int [ref : > prd_partai.id]
  reason                      varchar
  status                      enum('Draft', 'Submitted', 'Posted', 'Cancelled') [not null, default: 'Draft']
  created_by                  int [not null]
  created_at                  timestamptz [not null]
}

table prd_reproses_line {
  id                          int [pk, increment]
  reproses_id                 int [not null, ref : > prd_reproses.id]
  line_no                     int [not null]
  from_bucket_id              int [not null]
  job_id                      int [ref : > prd_job.id] // a row without one gets a Job here
  grams                       decimal(18,6) [not null]
  to_bucket_id                int
}

// Kotak (T12): one box per piece of work at Packing 95 from its BoM; pieces by grams within the tolerance and
// count, each paired with a unique CAIQ; packaging taken as the BoM says; the box is a new No. Stok of the
// BoM's output item, born without a Job (the Push to Packing 98 gives it one)
table prd_box {
  id                          int [pk, increment]
  box_no                      varchar [unique, not null] // KTK_<unit>_<ddmmyy>_<NNNNN>
  box_date                    date [not null]
  unit_id                     int [not null, ref : > ref_unit.id] // lintas aplikasi → ERP
  bom_id                      int [not null, ref : > prd_bom.id] // lintas aplikasi → ERP · the version used
  grams                       decimal(18,6) [not null]
  pieces                      int [not null]
  tracking_id                 int // the No. Stok Kotak
  tracking_no                 varchar
  cost_amount                 decimal(18,2) [not null, default: 0]
  value                       decimal(18,2) [not null, default: 0]
  journal_id                  int
  status                      enum('Open', 'Closed', 'Cancelled') [not null, default: 'Open'] // an open box holds its pieces
  created_by                  int [not null]
  created_at                  timestamptz [not null]
}

table prd_box_piece {
  id                          int [pk, increment]
  box_id                      int [not null, ref : > prd_box.id]
  line_no                     int [not null]
  bucket_id                   int [not null]
  tracking_id                 int [not null] // weak
  grams                       decimal(18,6) [not null]
  caiq_no                     varchar [not null, unique]
  is_manual                   boolean [not null, default: false] // put in without a scan (P249)
}

table prd_box_component {
  id                          int [pk, increment]
  box_id                      int [not null, ref : > prd_box.id]
  bom_component_id            int [not null, ref : > prd_bom_component.id] // lintas aplikasi → ERP
  bucket_id                   int [not null] // the auxiliary bucket it was taken from
  qty                         decimal(18,4) [not null]
  value                       decimal(18,2) [not null, default: 0]
}

//////////////////////////////////
//
// Rangka tabel ERP lain yang dirujuk (lihat erp.dbml.md)
//
/////////////////////////////////

table acc_account { id int [pk] }
table m_item { id int [pk] }
table m_partner { id int [pk] }
table ref_uom { id int [pk] }
table ref_warehouse { id int [pk] }
table log_stock_tracking { id int [pk] }
```
