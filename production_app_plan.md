# Plan Aplikasi Produksi: Dua Aplikasi, Satu Login

> Disusun 10/11/2026 (P253). **Status: usulan, belum dibangun, menunggu persetujuan user.**
> Dasar: P245 (dua aplikasi di balik satu SSO), `Production-Unit-Workspace-Plan.md` §3a dan §3b,
> `Produksi Walet (Real).md` (PWR), dan aplikasi yang berjalan di `main` (`2aa6156`).
> Nama tabel dan kolom yang belum dibangun adalah usulan; nama final ditetapkan di langkahnya.

## 1. Ringkasan

1. Setelah login, user memilih **ERP** atau **Produksi**. User yang hanya punya satu langsung masuk.
2. **Tetap satu repo, satu deployment Vercel, satu database Neon** (P245). Yang dipisah sekarang: pintu masuk, menu, hak akses, dan kepemilikan tabel.
3. **Tidak ada tabel baru untuk "aplikasi".** Aplikasi adalah katalog di kode, dan akses ke sebuah aplikasi diturunkan dari menu yang boleh dilihat user.
4. Tiga belas menu yang sekarang ada di ERP pindah ke Produksi (§4). Satu menu, Tagihan Biaya, pindah modul di dalam ERP.
5. Skema dua aplikasi sendiri hanya melahirkan **dua tabel baru** dan **satu kelompok dokumen batas** (§6.1). Tabel lain di §6.2 lahir dari pembangunan Workspace Unit yang sudah disepakati.
6. `DBML/erp.dbml.md` dibagi tiga bagian berpembatas: **Bersama**, **ERP**, **Produksi** (§5).

## 2. Hasil analisa

### 2.1 Aplikasi yang berjalan

| Temuan | Akibat untuk plan |
| --- | --- |
| Menu adalah satu daftar `MODULES` di `src/lib/erp/nav.ts`; `visibleModules(permissions)` menyaringnya dan `landingHref` menentukan halaman pertama | Dua aplikasi cukup berupa dua himpunan modul di daftar yang sama. Shell tidak perlu ditulis ulang |
| Modul ditentukan segmen pertama URL (`resolvePath`) | Seluruh `/production/*` bisa menjadi aplikasi Produksi tanpa mengubah cara routing bekerja |
| Semua halaman berada di satu route group `(app)` dengan satu layout yang hanya memeriksa sesi | Dipecah menjadi `(erp)` dan `(production)`, masing-masing dengan penjaga aplikasinya. Route group tidak mengubah URL |
| Modul **Produksi** sekarang mencampur lantai produksi (Workspace Unit, Dokumen Grading, Pengerjaan Unit, QC Check, tiga laporan) dengan uang (Tagihan Biaya) | Dipisah: yang pertama ke aplikasi Produksi, yang kedua tetap di ERP |
| **Master › Produksi** memuat Workstation, Unit, Line, Routing, Standard Cost, Karyawan | Lima pindah ke Produksi; Standard Cost tetap di ERP |
| BSTB Issue sudah di Persediaan › Operasi Gudang (`log_stock_issue`) | Sudah di tempat yang benar: dokumen batas milik ERP |
| `tests/module-boundaries.test.ts` sudah mencatat modul mana yang boleh menyebut tabel mana | Ditambah satu lapis: tabel milik aplikasi mana |
| `prd_line.variance_account_id` menunjuk `acc_account` | Satu-satunya kolom akuntansi di tabel master Produksi; dipindah (§6.1) |
| Tiga tabel berawalan `prd_` adalah urusan uang: `prd_cost_bill(_line)`, `prd_rate_version(_line)`, `prd_cost_entry` | Milik ERP walau awalannya `prd_`. Tidak diganti nama (§5.3) |

### 2.2 Posting yang hari ini menyentuh kedua sisi dalam satu transaksi

Ini bukan masalah selama databasenya satu. Dicatat supaya batasnya terlihat dan tidak bertambah tanpa sadar.

| Posting | Sisi Produksi | Sisi ERP |
| --- | --- | --- |
| Terima BSTB Issue (P228) | `prd_ledger`, `prd_balance` (masuk Persiapan) | buku stok, jurnal Dr WIP / Cr Persediaan |
| Dokumen Grading, Pengerjaan Unit (P241) | `prd_ledger`, `prd_tracking_link`, `prd_tracking_info` | `prd_cost_entry`, jurnal, pendaftaran No. Stok turunan di `log_stock_tracking` |
| BSTB Pengeluaran, BSTB ke Finish Goods (belum dibangun) | keluar dari Stand By | buku stok, jurnal |

### 2.3 Workspace Unit

Yang disepakati lewat simulasi (P242, P244–P252, PWR W96–W116) dan relevan di sini:

- Satu pintu **Workspace Unit**, lalu kartu Unit, lalu satu halaman kerja per Unit. Dokumen punya register sendiri di kelompok **Dokumen**.
- Dua tabel tetap per tahap: **Job** dan **No. Stok tanpa Job**, keduanya dibaca dari `prd_balance` (W111). Tidak ada tabel baru untuk tampilan.
- Admin Unit dikunci ke Unit-nya di server (penugasan), bukan lewat role per Unit.
- Nilai dan jurnal tampil di bagian terpisah di balik satu syarat (`canSeeValue`).
- Packing 95 satu Unit; Buat Kotak membaca seluruh Persiapan, tanpa pilah (W112–W116).

Seluruhnya adalah isi aplikasi Produksi. Plan ini tidak mengubah satu pun keputusan itu; ia hanya menentukan **di aplikasi mana** tiap layar dan tabel berada.

## 3. Skema dua aplikasi

### 3.1 Alur masuk

```
/login ──► sesi (sys_session, satu untuk kedua aplikasi)
   │
   ├─ punya ERP dan Produksi ──► /apps (pilih aplikasi) ──► halaman pertama aplikasi itu
   ├─ hanya ERP ───────────────► halaman pertama ERP
   └─ hanya Produksi ──────────► /production/workspace
```

- **SSO di sini berarti satu login dan satu sesi** untuk dua aplikasi dalam satu deployment. Belum ada penyedia identitas terpisah: KB `engineering/security-rbac` 2.0 (OIDC) tetap *pinned* menunggu Portal. Pemilih aplikasi ini adalah bentuk awalnya dan tidak bertentangan dengannya.
- Shell menampilkan nama aplikasi yang sedang dibuka dan tombol **Ganti Aplikasi** (hanya bila user punya dua). Bentuk layarnya mengikuti simulasi Workspace Unit putaran kelima.
- Tautan `?next=` setelah login tetap dihormati; pemilih aplikasi hanya muncul bila tidak ada tujuan.

### 3.2 Cara membangunnya (paling sedikit perubahan)

| Bagian | Sekarang | Menjadi |
| --- | --- | --- |
| Katalog aplikasi | tidak ada | `APPS` di `nav.ts`: `erp` (semua modul kecuali `production`) dan `production` (modul `production`). Katalog di kode, seperti katalog tujuan Kas & Bank (P66) |
| Akses aplikasi | tidak ada | **Diturunkan**: user punya sebuah aplikasi bila `visibleModules` untuk aplikasi itu tidak kosong. Tanpa permission baru dan tanpa tabel |
| URL | `/production/*` campuran | `/production/*` seluruhnya aplikasi Produksi; semua URL lain ERP |
| Layout | satu `(app)/layout.tsx` | `(erp)/layout.tsx` dan `(production)/layout.tsx`, masing-masing memanggil `requireApp(...)` lalu memberi shell modul aplikasinya |
| Halaman pertama | `landingHref(permissions)` | `landingHref(permissions, app)`; tanpa `app` dan user punya dua, hasilnya `/apps` |
| Matriks role | dikelompokkan per modul | Dikelompokkan per aplikasi, lalu per modul. Aplikasi dibaca dari `sys_permission.module` lewat katalog, tanpa kolom baru |
| Profil Saya | `/settings/profile` | Tetap, ditambah `/production/profile` yang memakai halaman yang sama, supaya user Produksi tidak dilempar ke shell ERP |

**Penjagaan tetap di server.** Menyembunyikan menu bukan otorisasi (§11): tiap halaman dan Server Action tetap memeriksa permission-nya sendiri, dan `requireApp` di layout hanya lapis tambahan.

### 3.3 Yang sengaja tidak dibuat

| Tidak dibuat | Alasan |
| --- | --- |
| Tabel `sys_app`, `sys_user_app` | Dua aplikasi adalah konstanta. Akses sudah terjawab oleh permission menu yang ada |
| Permission `APP_*_ACCESS` | Akan selalu sama dengan "punya minimal satu menu di aplikasi itu"; dua sumber kebenaran untuk hal yang sama |
| Kolom "aplikasi terakhir" di sesi atau user | URL sudah menyatakan aplikasinya |
| Repo, deployment, atau database kedua | P245: batas Vercel dan Neon. Lihat §8 |
| Penyedia identitas (OIDC) | Menunggu Portal (KB 2.0, pinned) |
| Outbox dan replikasi master | Hanya diperlukan saat database benar-benar dipisah (§8) |
| Ganti nama tabel `prd_` milik ERP | Migrasi dan perubahan kode besar tanpa manfaat fungsi; pembatas DBML sudah menjawabnya |

## 4. Pembagian menu

### 4.1 Aplikasi Produksi

Satu modul dengan empat kelompok. Kolom *Asal* menunjukkan tempatnya sekarang.

| Kelompok | Menu | Asal | Status |
| --- | --- | --- | --- |
| Pengerjaan | Workspace Unit | ERP › Produksi › Pengerjaan | Dibangun sebagian (P242) |
| Dokumen | Dokumen Grading | ERP › Produksi › Pengerjaan | Dibangun (P241) |
| Dokumen | Pengerjaan Unit | ERP › Produksi › Pengerjaan | Dibangun (P241) |
| Dokumen | QC Check | ERP › Produksi › Pengerjaan | Dibangun (P241) |
| Dokumen | Dokumen Push, BSTB antar Unit (Penyebaran, Transfer), Dokumen Reproses, Job Order, Kotak | baru | Belum |
| Laporan | Saldo Produksi | ERP › Produksi › Laporan | Dibangun (P209) |
| Laporan | Kartu No. Stok (kini *Kartu Lot*) | ERP › Produksi › Laporan | Dibangun (P209) |
| Laporan | Telusur Produksi | ERP › Produksi › Laporan | Dibangun (P212) |
| Laporan | Susut per Partai | baru | Belum |
| Master | Workstation | ERP › Master › Produksi | Dibangun (P239) |
| Master | Unit | ERP › Master › Produksi | Dibangun (P239) |
| Master | Line Produksi (tanpa Akun Varians) | ERP › Master › Produksi | Dibangun (P239) |
| Master | Routing | ERP › Master › Produksi | Dibangun (P239) |
| Master | Karyawan | ERP › Master › Produksi | Dibangun (P225) |
| Master | BoM Packing | baru | Belum |

**Jawaban atas "menu ERP mana yang seharusnya di Produksi": tiga belas menu**, yaitu empat di Pengerjaan, tiga laporan, lima master, dan Workspace Unit yang menjadi pintunya. Tidak ada menu lain di Penjualan, Pembelian, Persediaan, Finance, Pajak, Accounting, atau Pengaturan yang berisi pekerjaan lantai produksi.

### 4.2 Aplikasi ERP

Semua modul yang ada tetap, dengan perubahan berikut.

| Modul | Perubahan | Alasan |
| --- | --- | --- |
| Persediaan › **Serah Terima Produksi** (kelompok baru) | BSTB Issue pindah ke sini dari Operasi Gudang; kelak BSTB Pengeluaran dan BSTB ke Finish Goods | Dokumen batas menggerakkan buku stok dan menjurnal, jadi milik ERP. Dikumpulkan supaya Gudang melihat seluruh serah terima di satu tempat |
| **Produksi** (modul ERP, kunci URL `costing`) › Biaya | Tagihan Biaya pindah dari `/production/cost-bill` ke `/costing/cost-bill`; kelak Closing Costing Produksi dan Proyeksi Varians | `/production` menjadi milik aplikasi Produksi. Isinya tidak berubah |
| Produksi › Master Biaya | Standard Cost dan Jenis Biaya pindah ke sini dari Master; **Akun Varians per Line** baru | Ketiganya tentang rupiah dan akun, diisi bagian costing |
| Produksi › Perencanaan | Sales Planning, Rencana Produksi | Belum dibangun (PWR §11) |
| Produksi › Laporan | Nilai WIP per Unit, Varians per Line, Telusur | Nilai WIP dan Varians dibangun bersama Closing. Telusur memakai halaman yang sama dengan aplikasi Produksi |
| Master › Produksi | **Dihapus**: isinya pindah (lima ke Produksi, Standard Cost ke Master Biaya) | |
| Master › Entitas › Item | Tetap; memuat flag BJL | Item adalah master ERP yang dibaca Produksi |

### 4.3 Menu yang dipakai dari dua sisi

| Menu | Rumah | Yang dikerjakan sisi lain |
| --- | --- | --- |
| BSTB Issue | ERP (Gudang membuat dan mengajukan) | Admin Unit **menerima** dari tab Masuk di Workspace. Tombolnya memanggil Server Action yang sama, dengan permission `STOCK_ISSUE_POST` |
| BSTB Pengeluaran, BSTB ke Finish Goods | ERP (Gudang menerima) | Admin Unit **membuat dan mengajukan** dari tab Stand By di Workspace |
| Telusur Produksi | Produksi | ERP punya entri menu ke halaman yang sama |
| Item, Gudang, Partner, User, Role | ERP | Produksi hanya membaca |

Aturannya satu: **tiap dokumen punya satu rumah (tabel dan register), dan sisi lain hanya mengerjakan separuh siklusnya lewat aksi yang sama.**

### 4.4 Alasan garis batasnya

- **ERP memegang uang, rencana, dan stok; Produksi memegang eksekusi dan perpindahan di antara Unit.** Ini pola SAP S/4HANA dengan Digital Manufacturing, Dynamics 365 Production Floor Execution, Oracle Production Supervisor Workbench, dan Odoo Shop Floor (rujukan di `Production-Unit-Workspace-Plan.md` §3a).
- Orang lantai produksi tidak perlu melihat Penjualan, Finance, atau Accounting; orang ERP tidak perlu Workspace. Dua sidebar pendek lebih mudah dipakai daripada satu sidebar panjang.
- Barang hanya menyeberang lewat **dokumen batas** dengan satu pihak menyerahkan dan pihak lain menerima, sehingga tanggung jawab jelas.

## 5. Kepemilikan tabel dan pembatas DBML

### 5.1 Tiga bagian

`DBML/erp.dbml.md` disusun ulang menjadi tiga bagian. **Hanya urutan dan komentar yang berubah**; tidak ada kolom yang disentuh, jadi tidak ada migrasi.

```dbml
//////////////////////////////////////////////////////////////////
//
//  BAGIAN A — BERSAMA (login, akses, audit)
//  Dipakai kedua aplikasi. Kelak milik Portal / SSO.
//
//////////////////////////////////////////////////////////////////

//////////////////////////////////////////////////////////////////
//
//  BAGIAN B — APLIKASI ERP
//  Uang, rencana, stok, pajak, master bisnis, costing produksi.
//
//////////////////////////////////////////////////////////////////

//////////////////////////////////////////////////////////////////
//
//  BAGIAN C — APLIKASI PRODUKSI
//  Struktur produksi, identitas, buku produksi, dokumen lantai.
//
//////////////////////////////////////////////////////////////////
```

Di dalam tiap bagian, subbagian per awalan tetap seperti sekarang. Tiap referensi yang menyeberang bagian diberi komentar `// lintas aplikasi → <bagian>` di kolomnya.

### 5.2 Tabel yang ada sekarang

**Bagian A — Bersama (9)**

`sys_user`, `sys_role`, `sys_permission`, `sys_user_role`, `sys_role_permission`, `sys_session`, `sys_setting`, `sys_doc_type`, `audit_log`.

**Bagian C — Produksi (19)**

| Kelompok | Tabel |
| --- | --- |
| Struktur | `ref_workstation`, `ref_unit`, `prd_line`, `prd_routing`, `prd_routing_step` |
| Master pendukung | `m_employee` |
| Identitas | `prd_partai`, `prd_job`, `prd_tracking_info` |
| Buku produksi | `prd_balance`, `prd_ledger`, `prd_tracking_link` |
| Dokumen lantai | `prd_grading`, `prd_grading_output`, `prd_work`, `prd_work_line`, `prd_aux_use`, `prd_qc_check`, `prd_qc_check_line` |

**Bagian B — ERP (semua tabel lain)**

| Kelompok | Tabel |
| --- | --- |
| Data sistem bisnis | `sys_account_type`, `sys_partner_category`, `sys_item_category`, `sys_stock_status`, `sys_region_province / city / district / village` |
| Referensi | `ref_currency`, `ref_uom`, `ref_payment_term`, `ref_permit_type`, `ref_withholding_tax`, `ref_warehouse`, `ref_warehouse_location` |
| Master | `m_item`, `m_item_uom`, `m_partner`, `m_partner_address`, `m_partner_contact`, `m_cash_bank` |
| Accounting | seluruh `acc_*`, termasuk `acc_item_category_account`, `acc_cost_type`, `acc_fiscal_period_lock` |
| Kas & Bank, Finance | `cash_bank_ledger`, `cash_bank_period`, `cash_bank_balance`, seluruh `fin_*` |
| Penjualan, Pembelian, Pajak | seluruh `sal_*`, `pur_*`, `tax_*` |
| Persediaan | `log_receipt_note(_line, _tracking)`, `log_delivery_note(_line, _tracking)`, `log_stock_tracking`, `log_stock_ledger`, `log_stock_balance`, `log_stock_valuation_ledger`, `log_stock_valuation_balance` |
| **Serah Terima Produksi (dokumen batas)** | `log_stock_issue`, `log_stock_issue_line`, `log_stock_issue_tracking` |
| **Costing Produksi** | `prd_cost_bill`, `prd_cost_bill_line`, `prd_rate_version`, `prd_rate_version_line`, `prd_cost_entry` |

### 5.3 Tabel yang letaknya perlu dijelaskan

| Tabel | Bagian | Alasan |
| --- | --- | --- |
| `prd_cost_bill(_line)` | ERP | Tagihan ke supplier, menjurnal, dibayar lewat Pengeluaran |
| `prd_rate_version(_line)` | ERP | Rate rupiah per gram; ditetapkan costing, bukan lantai produksi. Menunjuk `ref_unit` (lintas aplikasi) |
| `prd_cost_entry` | ERP | Biaya unit yang diserap; dasar varians di Closing. Hari ini ditulis dalam posting Grading dan Pengerjaan (§2.2) |
| `log_stock_issue*` | ERP | Menggerakkan buku stok dan menjurnal; Unit hanya menerima |
| `log_stock_tracking` | ERP | Register No. Stok satu untuk seluruh sistem (W10). Produksi mendaftarkan No. Stok turunan lewat fungsi buku, bukan menulis sendiri |
| `m_employee` | Produksi | Hanya dipakai Pengerjaan Unit (W26); bukan data kepegawaian |
| `m_item` (`is_bjl`) | ERP | Master bisnis; flag BJL adalah atribut Item yang dibaca Produksi |
| `prd_balance`, `prd_ledger` | Produksi | Buku produksi. **Kolom nilainya** (`value_*`) adalah angka ERP yang ikut disimpan di sini; tetap selama satu database (§8) |
| `sys_setting`, `sys_doc_type`, `audit_log` | Bersama | Satu katalog dan satu jejak untuk kedua aplikasi |

### 5.4 Referensi lintas aplikasi yang ada

Foreign key ini **tetap** selama databasenya satu. Daftar ini yang kelak menjadi referensi lemah.

| Arah | Kolom |
| --- | --- |
| Produksi → ERP | `item_id` → `m_item` dan `tracking_id` → `log_stock_tracking` di buku dan dokumen Produksi; `prd_line.variance_account_id` → `acc_account` (dipindah, §6.1) |
| ERP → Produksi | `prd_rate_version_line.unit_id`, `prd_cost_entry.unit_id / partai_id / line_id`, `log_stock_issue.unit_id` |
| Keduanya → Bersama | `created_by`, `updated_by` (sudah tanpa foreign key) |

**Aturan untuk tabel baru:** referensi dari satu aplikasi ke **master** aplikasi lain boleh foreign key; ke **dokumen** aplikasi lain memakai pasangan lemah `(doc_type_id, doc_id)`, sama dengan kontrak modul §3.1.

## 6. Tabel baru

### 6.1 Karena skema dua aplikasi

| Tabel (usulan) | Bagian | Fungsi | Alasan |
| --- | --- | --- | --- |
| `prd_user_unit` (`user_id`, `unit_id`, unik berdua) | Produksi | Unit mana yang boleh dibuka seorang user. Dimuat ke `actor.unitIds`; `requireUnit` dipanggil di tiap halaman dan aksi Workspace | Sudah direncanakan sebagai `sys_user_unit`. **Diusulkan berawalan `prd_`**, karena isinya milik Produksi dan `user_id` cukup tanpa foreign key seperti `created_by`. Dengan begitu tidak ada tabel Bersama yang menunjuk tabel Produksi |
| `acc_production_line_account` (`line_id` unik, `variance_account_id`) | ERP | Akun Varians tiap Line, diisi di ERP › Produksi › Master Biaya | Menggantikan `prd_line.variance_account_id`, sehingga master Line di Produksi tidak lagi memuat akun. Polanya sama dengan `acc_item_category_account` (P122). Migrasi memindahkan nilainya |
| `log_production_receipt`, `_line`, `_tracking` | ERP (dokumen batas) | BSTB Pengeluaran dan BSTB ke Finish Goods: Unit mengajukan dari Stand By, Gudang menerima; Terima memasukkan barang ke buku stok dengan No. Stok yang sama dan menjurnal | Cermin `log_stock_issue`. Satu tabel dengan *tujuan* (`production_return`, `finished_goods`) seperti dokumen standalone lain (P106). Sudah ada di rencana menu (16 dan Packing); di sini hanya ditetapkan **rumahnya di ERP** |

Permission baru: `PRODUCTION_UNIT_ALL` (supervisor melihat semua Unit) dan `MENU_COSTING_ACCESS` (modul Produksi di ERP). Role yang kini memegang `PRODUCTION_COST_BILL_VIEW`, `RATE_VERSION_VIEW`, atau `COST_TYPE_VIEW` menerima `MENU_COSTING_ACCESS` lewat migrasi.

### 6.2 Karena pembangunan Workspace Unit (sudah disepakati di PWR dan rencana Workspace)

Semuanya **Bagian C — Produksi**. Dicantumkan supaya gambaran DBML-nya lengkap; keputusannya ada di dokumen sumber.

| Tabel atau kolom (usulan) | Fungsi | Sumber |
| --- | --- | --- |
| Indeks parsial `prd_balance (unit_id, stage, job_id) WHERE qty_balance > 0` | Dua tabel Workspace (Job, No. Stok tanpa Job) tanpa membaca bucket kosong | W111, §3b |
| `prd_balance.entered_at` | Kolom *Sejak*: kapan barang masuk tahap itu | §3b |
| `prd_job.tracking_id`, `prd_job.partai_id` boleh kosong | Job yang lahir dari banyak No. Stok atau lintas partai | W103, §3b |
| `prd_grading.job_id` + `prd_grading_input` | Grading per Job dengan banyak bucket input | W97, W107 |
| `prd_push`, `prd_push_line` | Dokumen Push: pindah di dalam Workstation, tanpa jurnal | W58 |
| `prd_transfer`, `prd_transfer_line` | BSTB antar Unit (Penyebaran dan Transfer): Ajukan lalu Terima; partai lahir saat Terima Penyebaran | W20, W64, W83 |
| `prd_rework`, `prd_rework_line` | Dokumen Reproses ke Unit sebelumnya | W77–W80 |
| `prd_job_order` | Job Order per No. Job keluar Moulding (grading) | W69 |
| `prd_packing_bom`, `_line` | BoM Packing per Nama Jual: target gram, toleransi, isi, bahan penolong | W112 |
| `prd_box`, `prd_box_line` (`caiq_no` unik, `is_manual`) | Kotak: isinya, CAIQ per pcs, tanda Manual | W112–W116 |
| `prd_composition` | Komposisi kotak untuk Telusur | PWR §12 |
| `prd_daily_summary`, `prd_partai_summary` | Ringkasan yang ditulis saat posting, dibaca laporan | Rencana Workspace §4 (F) |
| `sys_doc_counter` (Bersama) | Penghitung nomor per seri, pengganti pencarian nomor terakhir | Rencana Workspace §4 |

## 7. Tahapan implementasi

Tiap tahap satu commit ke `main`: build, lint, dan test hijau, DBML bersamaan dengan migrasinya, keputusan dicatat, push, migrasi Neon, lalu **review user di Neon sebelum tahap berikutnya**.

| Tahap | Isi | Migrasi | Selesai bila |
| --- | --- | --- | --- |
| 0 | Plan ini disetujui; keputusan dicatat di `Claude-ERP.md` dan PWR | tidak | User menyetujui §3–§6 |
| 1 | **Pembatas DBML**: `erp.dbml.md` disusun menjadi Bagian A, B, C dengan komentar lintas aplikasi. Peta kepemilikan tabel ditambahkan ke `tests/module-boundaries.test.ts`, dengan tes bahwa tiap model di `schema.prisma` punya tepat satu pemilik | tidak | Tes gagal bila ada tabel baru tanpa pemilik |
| 2 | **Dua pintu**: `APPS` di `nav.ts`, `requireApp`, route group `(erp)` dan `(production)`, halaman `/apps`, `landingHref` per aplikasi, nama aplikasi dan *Ganti Aplikasi* di shell | tidak | User dua aplikasi melihat pemilih; user satu aplikasi langsung masuk; membuka URL aplikasi yang tidak dimiliki ditolak |
| 3 | **Pindah menu**: Tagihan Biaya ke `/costing/cost-bill`; modul ERP Produksi (Biaya, Master Biaya); lima master ke `/production/master/...`; kelompok Serah Terima Produksi; kelompok Dokumen dan Laporan di Produksi; redirect dari URL lama; matriks role per aplikasi; `MENU_COSTING_ACCESS` | ya (permission) | Tiap menu di §4 terbuka di aplikasinya; URL lama dialihkan; role lama tidak kehilangan akses |
| 4 | **Penugasan Unit**: `prd_user_unit`, tab Unit di form User, `actor.unitIds`, `requireUnit`, `PRODUCTION_UNIT_ALL`, register Dokumen difilter ke Unit user | ya | Admin Unit tidak bisa membuka Unit lain walau mengganti URL atau id dokumen |
| 5 | **Akun Varians per Line**: `acc_production_line_account`, layarnya di Master Biaya, kolom lama dibuang | ya | Form Line di Produksi tanpa akun; nilainya tidak hilang |
| 6 | **Workspace Unit lanjutan** menurut `Production-Unit-Workspace-Plan.md` §5 dan PWR §13, kini di dalam aplikasi Produksi: perubahan W111, lalu Dokumen Push, BSTB antar Unit, Reproses, dan seterusnya | ya, per langkah | Menurut dokumen sumbernya |
| 7 | **Dokumen batas keluar**: `log_production_receipt` untuk BSTB Pengeluaran, lalu BSTB ke Finish Goods bersama Packing | ya | Barang kembali ke stok dengan No. Stok yang sama; jurnal dan buku stok cocok di `db:reconcile` |

Tahap 1–3 tidak mengubah satu pun angka atau posting. Tahap 1 dan 2 bisa dikerjakan tanpa menunggu yang lain; tahap 3 membutuhkan tahap 2.

**Titik yang perlu dibuktikan di tahap 3:** halaman master dibuat oleh registry di `/master/[entity]`. Lima master Produksi akan disajikan di `/production/master/[entity]` dengan halaman yang sama. Cara registry menyusun tautannya belum saya periksa; bila tautannya ditulis mati ke `/master`, perubahannya ada di satu tempat itu.

## 8. Saat database benar-benar dipisah (bukan pekerjaan sekarang)

Dicatat supaya keputusan hari ini tidak menutup jalannya.

1. Posting di §2.2 terbelah dua. Produksi mengirim kejadian, ERP yang menjurnal (pola outbox).
2. Foreign key di §5.4 menjadi referensi lemah; Item, Gudang, dan kode Unit direplikasi.
3. Kolom nilai di `prd_balance` dan `prd_ledger` serta `prd_cost_entry` perlu diputuskan: tetap disalin ke Produksi atau dibaca dari ERP.
4. Register No. Stok (`log_stock_tracking`) perlu satu pemilik dan satu penerbit nomor.
5. Bagian A pindah ke Portal bersama OIDC (KB `security-rbac` 2.0).

## 9. Keputusan yang dibutuhkan dari user

| # | Pertanyaan | Saran |
| --- | --- | --- |
| 1 | Akses aplikasi diturunkan dari menu, tanpa permission `APP_*`? | Ya |
| 2 | `/production/*` menjadi aplikasi Produksi dan sisi uang pindah ke `/costing/*`? | Ya: hanya satu menu yang berpindah URL |
| 3 | Standard Cost dan Jenis Biaya pindah dari Master ke ERP › Produksi › Master Biaya? | Ya, sesuai usulan menu simulasi |
| 4 | Akun Varians dipindah ke `acc_production_line_account` (tahap 5)? | Ya, tetapi boleh ditunda sampai Closing dibangun |
| 5 | Penugasan Unit bernama `prd_user_unit`, bukan `sys_user_unit`? | Ya |
| 6 | Telusur muncul di kedua aplikasi? | Ya, satu halaman dengan dua entri menu |

## 10. Yang belum diperiksa

- Simulasi Workspace Unit putaran kelima tidak saya buka ulang; tata letak pemilih aplikasi dan shell Produksi mengikuti yang tercatat di P245 dan §3a.
- Cara registry menyusun tautan master (tahap 3).
- Tidak ada kode yang diubah dan tidak ada yang dijalankan; ini dokumen rencana.
