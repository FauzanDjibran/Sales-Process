# Plan Aplikasi Produksi: Dua Aplikasi, Satu Login

> Disusun 10/11/2026 (P253), **disetujui dan dikunci 10/11/2026 (P254)** setelah review tampilan terhadap
> simulasi Workspace Unit putaran kelima. **Belum ada yang dibangun.**
> Dasar: P245, `Production-Unit-Workspace-Plan.md` §3a dan §3b, `Produksi Walet (Real).md` (PWR),
> dan aplikasi di `main`. Nama tabel dan kolom yang belum dibangun adalah usulan; nama final ditetapkan di langkahnya.
> Selama update berlangsung, perubahan tampilan atau pengelompokan di luar dokumen ini ditanyakan dulu.

## 1. Ringkasan

1. Setelah login, user memilih **ERP** atau **Produksi**. User yang hanya punya satu langsung masuk.
2. **Tetap satu repo, satu deployment Vercel, satu database Neon** (P245). Yang dipisah sekarang: pintu masuk, menu, hak akses, dan kepemilikan tabel.
3. **Tidak ada tabel baru untuk "aplikasi".** Aplikasi adalah katalog di kode, dan akses ke sebuah aplikasi diturunkan dari menu yang boleh dilihat user.
4. **Delapan menu** pindah dari ERP ke Produksi (§4.1). **Semua master tetap di ERP kecuali Karyawan** (§4.3).
5. Skema ini sendiri hanya melahirkan **satu tabel baru** (`prd_user_unit`) dan menetapkan rumah **satu kelompok dokumen batas** (§6.1).
6. `DBML/erp.dbml.md` dibagi tiga bagian berpembatas: **Bersama** (9 tabel), **ERP**, **Produksi** (14 tabel) (§5).

## 2. Hasil analisa

### 2.1 Aplikasi yang berjalan

| Temuan | Akibat untuk plan |
| --- | --- |
| Menu adalah satu daftar `MODULES` di `src/lib/erp/nav.ts`; `visibleModules(permissions)` menyaringnya dan `landingHref` menentukan halaman pertama | Dua aplikasi cukup berupa dua himpunan modul di daftar yang sama |
| Modul ditentukan segmen pertama URL (`resolvePath`) | Seluruh `/production/*` menjadi aplikasi Produksi tanpa mengubah cara routing bekerja |
| Semua halaman berada di satu route group `(app)` dengan satu layout yang hanya memeriksa sesi | Dipecah menjadi `(erp)` dan `(production)`, masing-masing dengan penjaga aplikasinya. Route group tidak mengubah URL |
| Shell (`app-shell.tsx`): topbar, **rail** berisi ikon modul, **panel sub** berisi kelompok dan menu modul yang aktif | Untuk Produksi, rail berisi ikon **kelompok** (§3.3); perubahan kecil di satu komponen |
| Halaman master dibuat registry lewat route `/<modul>/[entity]`, yang sudah ada untuk `master`, `accounting`, dan `settings` | Master yang pindah modul cukup mendapat route `[entity]` di modul barunya. Risiko di plan awal gugur. Dua tautan mati ke `/master/unit/…` di `entity-pages.tsx` tetap benar, karena Unit tidak pindah |
| Modul **Produksi** sekarang mencampur lantai produksi dengan uang (Tagihan Biaya) | Dipisah |
| BSTB Issue ada di Persediaan › Operasi Gudang (`log_stock_issue`) | Sudah di tempat yang benar dan **tidak berubah** |
| `tests/module-boundaries.test.ts` sudah mencatat modul mana yang boleh menyebut tabel mana | Ditambah satu lapis: tabel milik aplikasi mana |

### 2.2 Posting yang hari ini menyentuh kedua sisi dalam satu transaksi

Bukan masalah selama databasenya satu. Dicatat supaya batasnya terlihat.

| Posting | Sisi Produksi | Sisi ERP |
| --- | --- | --- |
| Terima BSTB Issue (P228) | `prd_ledger`, `prd_balance` (masuk Persiapan) | buku stok, jurnal Dr WIP / Cr Persediaan |
| Dokumen Grading, Pengerjaan Unit (P241) | `prd_ledger`, `prd_tracking_link`, `prd_tracking_info` | `prd_cost_entry`, jurnal, pendaftaran No. Stok turunan di `log_stock_tracking` |
| BSTB Pengeluaran, BSTB ke Finish Goods (belum dibangun) | keluar dari Stand By | buku stok, jurnal |

### 2.3 Workspace Unit

Yang disepakati lewat simulasi (P242, P244–P252, PWR W96–W116) seluruhnya adalah isi aplikasi Produksi. Plan ini tidak mengubah satu pun keputusan itu; ia hanya menentukan **di aplikasi mana** tiap layar dan tabel berada.

## 3. Skema dua aplikasi

### 3.1 Alur masuk

```
/login ──► sesi (sys_session, satu untuk kedua aplikasi)
   │
   ├─ punya ERP dan Produksi ──► /apps (pilih aplikasi) ──► halaman pertama aplikasi itu
   ├─ hanya ERP ───────────────► halaman pertama ERP
   └─ hanya Produksi ──────────► Workspace Unit
```

- **SSO di sini berarti satu login dan satu sesi** untuk dua aplikasi dalam satu deployment. Penyedia identitas terpisah (KB `engineering/security-rbac` 2.0, OIDC) tetap *pinned* menunggu Portal.
- Tautan `?next=` setelah login tetap dihormati; pemilih aplikasi hanya muncul bila tidak ada tujuan.

### 3.2 Cara membangunnya

| Bagian | Sekarang | Menjadi |
| --- | --- | --- |
| Katalog aplikasi | tidak ada | `APPS` di `nav.ts`: `erp` (semua modul kecuali `production`) dan `production`. Katalog di kode, seperti katalog tujuan Kas & Bank (P66) |
| Akses aplikasi | tidak ada | **Diturunkan**: user punya sebuah aplikasi bila ada menunya yang terlihat. Tanpa permission `APP_*` dan tanpa tabel |
| URL | `/production/*` campuran | `/production/*` seluruhnya aplikasi Produksi; sisi uang di `/costing/*`; URL lain tetap |
| Layout | satu `(app)/layout.tsx` | `(erp)/layout.tsx` dan `(production)/layout.tsx`, masing-masing memanggil `requireApp(...)` |
| Halaman pertama | `landingHref(permissions)` | `landingHref(permissions, app)`; tanpa `app` dan user punya dua, hasilnya `/apps` |
| Matriks role | per modul | Per aplikasi, lalu per modul. Aplikasi dibaca dari `sys_permission.module` lewat katalog, tanpa kolom baru |
| Profil Saya | `/settings/profile` | Tetap, ditambah `/production/profile` dengan halaman yang sama |

**Penjagaan tetap di server.** Tiap halaman dan Server Action tetap memeriksa permission-nya sendiri; `requireApp` hanya lapis tambahan.

### 3.3 Tampilan yang dikunci

Mengikuti simulasi putaran kelima, kecuali yang diubah jawaban user 10/11/2026.

| Bagian | Bentuk |
| --- | --- |
| Halaman pilih aplikasi (`/apps`) | Satu kartu di tengah layar seperti halaman login: sapaan *Halo, \<nama\>*, role, lalu **dua tombol aplikasi bertumpuk**, masing-masing tanda merek, nama, dan satu kalimat isi. Hanya user dengan dua aplikasi yang sampai ke sini, jadi keadaan *Tidak ada akses* dan tombol *Coba akun lain* milik simulasi tidak dibangun |
| Teks tombol | **ERP**: *Penjualan, Pembelian, Persediaan, Finance, Pajak, Accounting, dan sisi biaya produksi.* **Produksi**: *Workspace Unit, dokumen pengerjaan, perpindahan antar Unit, dan telusur.* |
| Topbar | Tanda merek `ER` + *ERP*, atau `PR` (warna aksen) + *Produksi*, lalu versi. Di sebelahnya **ikon kisi "Pilih aplikasi"**, hanya untuk user dengan dua aplikasi. Chip user dan menunya (Profil Saya, Keluar) tidak berubah |
| Shell ERP | Rail dan panel sub seperti sekarang. Modul **Produksi** tetap di antara Pembelian dan Persediaan |
| Shell Produksi | Rail berisi **empat ikon kelompok**: Pengerjaan, Dokumen, Laporan, Master. Panel sub berjudul *Produksi* dengan keterangan *Lantai produksi: pengerjaan, perpindahan antar Unit, dan telusur. Biaya dan Closing ada di ERP.* dan selalu menampilkan **keempat kelompok**; ikon rail yang menyala mengikuti kelompok halaman yang dibuka |
| Halaman pertama Produksi | Workspace Unit. Setelah penugasan Unit dibangun (tahap 4), user dengan tepat satu Unit langsung ke halaman Unit itu |
| Menu yang belum dibangun | **Tidak ditampilkan.** Simulasi menampilkannya redup; aplikasi hanya memuat menu yang berfungsi, dan tiap menu muncul di tempat yang ditetapkan §4 saat dibangun |
| Nilai dan jurnal | Tetap tampil, di bagiannya sendiri (keputusan review 07/11/2026). Sakelar *Uji layar tanpa nilai* milik simulasi tidak dibangun |
| Istilah | Di layar aplikasi Produksi, **Lot menjadi No. Stok** (PWR W86): *Kartu No. Stok*, kolom dan label *No. Stok*. Layar ERP (Receipt Note, Delivery Note, BSTB Issue, laporan stok) tetap *Lot* untuk sekarang |
| Halaman, form, tabel | Tidak ada yang didesain ulang. Layar yang pindah aplikasi hanya berganti shell, breadcrumb, dan URL |

### 3.4 Yang sengaja tidak dibuat

| Tidak dibuat | Alasan |
| --- | --- |
| Tabel `sys_app`, `sys_user_app`; permission `APP_*_ACCESS` | Akses sudah terjawab oleh permission menu; dua sumber kebenaran untuk hal yang sama |
| Kolom "aplikasi terakhir" di sesi atau user | URL sudah menyatakan aplikasinya |
| `acc_production_line_account` (usulan plan awal) | Gugur: Line tetap master ERP, jadi Akun Varians tetap satu kolom di `prd_line` (§4.3) |
| Menu *Pembayaran Biaya Produksi* | Tetap satu tujuan di Finance › Pengeluaran; Tagihan Biaya sudah menaut ke pembayarannya. Pintasan menu ditunda (C32) |
| Satu halaman *Serah Terima Produksi* bertab | User: nama menunya **BSTB Issue**, titik barang keluar dari ERP ke Produksi |
| Repo, deployment, database kedua; OIDC; outbox | P245 dan §8 |
| Ganti nama tabel `prd_` milik ERP | Migrasi besar tanpa manfaat fungsi; pembatas DBML sudah menjawabnya |

## 4. Pembagian menu

### 4.1 Aplikasi Produksi

| Kelompok | Menu | Asal | Status |
| --- | --- | --- | --- |
| Pengerjaan | Workspace Unit | ERP › Produksi › Pengerjaan | Dibangun sebagian (P242) |
| Dokumen | No. Grading (kini *Dokumen Grading*; nama register menurut P246) | ERP › Produksi › Pengerjaan | Dibangun (P241) |
| Dokumen | Pengerjaan Unit | ERP › Produksi › Pengerjaan | Dibangun (P241) |
| Dokumen | QC Check | ERP › Produksi › Pengerjaan | Dibangun (P241) |
| Dokumen | Kotak Packing 95, Dokumen Push, BSTB (antar Unit), Dokumen Reproses, Job Order | baru | Belum; urutannya seperti tertulis |
| Laporan | Saldo Produksi | ERP › Produksi › Laporan | Dibangun (P209) |
| Laporan | Kartu No. Stok (kini *Kartu Lot*) | ERP › Produksi › Laporan | Dibangun (P209) |
| Laporan | Telusur Produksi | ERP › Produksi › Laporan | Dibangun (P212) |
| Laporan | Susut per Partai | baru | Belum |
| Master | Karyawan | ERP › Master › Produksi | Dibangun (P225) |

**Delapan menu pindah dari ERP**: Workspace Unit, tiga dokumen, tiga laporan, dan Karyawan. Tidak ada menu lain di Penjualan, Pembelian, Persediaan, Finance, Pajak, Accounting, atau Pengaturan yang berisi pekerjaan lantai produksi.

### 4.2 Aplikasi ERP

Urutan rail tidak berubah. Yang berubah:

| Modul › Kelompok | Menu | Perubahan |
| --- | --- | --- |
| **Produksi** (URL `/costing`) › Biaya | Tagihan Biaya; kelak Closing Costing Produksi, Proyeksi Varians | Tagihan Biaya pindah dari `/production/cost-bill` |
| Produksi › Master Biaya | Standard Cost, Jenis Biaya | Pindah dari Master › Produksi dan Master › Referensi |
| Produksi › Laporan | Telusur Produksi; kelak Nilai WIP per Unit, Varians per Line | Telusur memakai halaman yang sama dengan aplikasi Produksi **Belum dibangun (P257):** halaman Telusur terikat ke URL `/production`, jadi entri ERP menunggu laporan Nilai WIP dan Varians dibangun bersama Closing. User yang punya kedua aplikasi membukanya di Produksi |
| Produksi › Perencanaan | Sales Planning, Rencana Produksi | Muncul saat dibangun (PWR §11) |
| Persediaan › Operasi Gudang | Receipt Note, **BSTB Issue**, Delivery Note | **Tidak berubah.** BSTB Pengeluaran dan BSTB ke Finish Goods kelak menjadi menu sendiri di kelompok ini, dengan namanya masing-masing |
| Master › Produksi | Workstation, Unit, Line Produksi, Routing | Tetap empat menu terpisah; Standard Cost dan Karyawan keluar dari kelompok ini |
| Pengaturan › User | tab **Unit** di form User (tahap 4) | Penugasan Unit diisi admin di ERP |

Keterangan modul Produksi di ERP: *Sisi uang produksi: rencana, biaya, Standard Cost, Closing, dan nilai WIP.*

### 4.3 Master: ERP atau Produksi?

User meminta tiap master ditentukan tempatnya; di mana pun, Workstation, Unit, Line, dan Routing tetap empat menu terpisah.

| Master | Tempat | Alasan |
| --- | --- | --- |
| Workstation | **ERP** | Pengelompok Unit; ikut Unit |
| Unit | **ERP** | Dipakai ERP sendiri: baris Standard Cost, tujuan BSTB Issue, `prd_cost_entry`, kelak Nilai WIP per Unit |
| Line Produksi | **ERP** | Memuat **Akun Varians**; kelak Varians per Line dan Sales Planning membacanya |
| Routing | **ERP** | Layar Standard Cost menyusun Unit menurut urutan routing; routing dan Unit tidak bisa dipisah aplikasi |
| Standard Cost, Jenis Biaya | **ERP** (Master Biaya) | Rupiah dan akun |
| Item (flag BJL), Gudang, Partner | **ERP** | Master bisnis |
| BoM Packing (belum dibangun) | **ERP** (usulan) | Memuat Item dan Nama Jual, yang menjadi target Sales Planning |
| Karyawan | **Produksi** | Hanya dipakai Pengerjaan Unit (W26), diubah orang lantai produksi, dan tidak pernah dibaca ERP |

**Aturan yang dipakai: master struktur produksi adalah milik ERP, dan Produksi hanya membacanya.** Dasarnya:

1. **Ketergantungan satu arah.** Bila Unit dan Line berada di Produksi, ERP harus menunjuk master Produksi (Standard Cost, BSTB Issue, varians) sementara Produksi menunjuk master ERP (Item). Dengan semua master di ERP, hanya Produksi yang bergantung pada ERP; saat database kelak dipisah, replikasi cukup satu arah.
2. **Pola mainstream.** SAP menyimpan work center dan routing di S/4HANA dan mengirimnya ke Digital Manufacturing; Dynamics 365 menyimpan resource dan route di Supply Chain; Odoo menyimpannya di Manufacturing, bukan Shop Floor.
3. **Perubahan master hanya oleh admin** (PWR §5), dan admin bekerja di ERP.
4. **Paling sedikit perubahan.** Keempat menu tidak berpindah, dan tabel `acc_production_line_account` tidak diperlukan.

Ini mengubah usulan menu simulasi, yang menaruh keempatnya di Produksi sebagai entri yang belum disimulasikan. Orang lantai produksi tetap melihat Workstation, Line, QC, dan checkpoint sebuah Unit di header halaman Unit pada Workspace.

### 4.4 Menu yang dipakai dari dua sisi

| Menu | Rumah | Yang dikerjakan sisi lain |
| --- | --- | --- |
| BSTB Issue | ERP (Gudang membuat dan mengajukan) | Admin Unit **menerima** dari tab Masuk di Workspace, lewat Server Action yang sama dengan permission `STOCK_ISSUE_POST` |
| BSTB Pengeluaran, BSTB ke Finish Goods | ERP (Gudang menerima) | Admin Unit **membuat dan mengajukan** dari tab Stand By di Workspace |
| Telusur Produksi | Produksi | ERP punya entri menu ke halaman yang sama |

**Tiap dokumen punya satu rumah (tabel dan register); sisi lain hanya mengerjakan separuh siklusnya lewat aksi yang sama.**

### 4.5 Alasan garis batasnya

- **ERP memegang uang, rencana, stok, dan master; Produksi memegang eksekusi dan perpindahan di antara Unit.**
- Orang lantai produksi tidak perlu melihat Penjualan, Finance, atau Accounting; orang ERP tidak perlu Workspace.
- Barang hanya menyeberang lewat **dokumen batas**, dengan satu pihak menyerahkan dan pihak lain menerima.

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
//  Uang, rencana, stok, pajak, master, costing produksi.
//
//////////////////////////////////////////////////////////////////

//////////////////////////////////////////////////////////////////
//
//  BAGIAN C — APLIKASI PRODUKSI
//  Identitas, buku produksi, dokumen lantai produksi.
//
//////////////////////////////////////////////////////////////////
```

Di dalam tiap bagian, subbagian per awalan tetap seperti sekarang. Tiap referensi yang menyeberang bagian diberi komentar `// lintas aplikasi → <bagian>` di kolomnya.

### 5.2 Tabel yang ada sekarang

**Bagian A — Bersama (9)**

`sys_user`, `sys_role`, `sys_permission`, `sys_user_role`, `sys_role_permission`, `sys_session`, `sys_setting`, `sys_doc_type`, `audit_log`.

**Bagian C — Produksi (14)**

| Kelompok | Tabel |
| --- | --- |
| Master | `m_employee` |
| Identitas | `prd_partai`, `prd_job`, `prd_tracking_info` |
| Buku produksi | `prd_balance`, `prd_ledger`, `prd_tracking_link` |
| Dokumen lantai | `prd_grading`, `prd_grading_output`, `prd_work`, `prd_work_line`, `prd_aux_use`, `prd_qc_check`, `prd_qc_check_line` |

**Bagian B — ERP (semua tabel lain)**

| Kelompok | Tabel |
| --- | --- |
| Data sistem bisnis | `sys_account_type`, `sys_partner_category`, `sys_item_category`, `sys_stock_status`, `sys_region_province / city / district / village` |
| Referensi | `ref_currency`, `ref_uom`, `ref_payment_term`, `ref_permit_type`, `ref_withholding_tax`, `ref_warehouse`, `ref_warehouse_location` |
| Master | `m_item`, `m_item_uom`, `m_partner`, `m_partner_address`, `m_partner_contact`, `m_cash_bank` |
| **Struktur Produksi (master, dibaca Produksi)** | `ref_workstation`, `ref_unit`, `prd_line`, `prd_routing`, `prd_routing_step` |
| Accounting | seluruh `acc_*`, termasuk `acc_item_category_account`, `acc_cost_type`, `acc_fiscal_period_lock` |
| Kas & Bank, Finance | `cash_bank_ledger`, `cash_bank_period`, `cash_bank_balance`, seluruh `fin_*` |
| Penjualan, Pembelian, Pajak | seluruh `sal_*`, `pur_*`, `tax_*` |
| Persediaan | `log_receipt_note(_line, _tracking)`, `log_delivery_note(_line, _tracking)`, `log_stock_tracking`, `log_stock_ledger`, `log_stock_balance`, `log_stock_valuation_ledger`, `log_stock_valuation_balance` |
| **Dokumen batas ke Produksi** | `log_stock_issue`, `log_stock_issue_line`, `log_stock_issue_tracking` |
| **Costing Produksi** | `prd_cost_bill`, `prd_cost_bill_line`, `prd_rate_version`, `prd_rate_version_line`, `prd_cost_entry` |

### 5.3 Tabel yang letaknya perlu dijelaskan

| Tabel | Bagian | Alasan |
| --- | --- | --- |
| `ref_workstation`, `ref_unit`, `prd_line`, `prd_routing(_step)` | ERP | Master struktur (§4.3). Kunci "sudah dipakai" pada Routing membaca `prd_partai`: satu bacaan lintas aplikasi, seperti kunci BJL pada Item |
| `prd_cost_bill(_line)` | ERP | Tagihan ke supplier, menjurnal, dibayar lewat Pengeluaran |
| `prd_rate_version(_line)` | ERP | Rate rupiah per gram |
| `prd_cost_entry` | ERP | Biaya unit yang diserap; dasar varians di Closing. Hari ini ditulis dalam posting Grading dan Pengerjaan (§2.2) |
| `log_stock_issue*` | ERP | Menggerakkan buku stok dan menjurnal; Unit hanya menerima |
| `log_stock_tracking` | ERP | Register No. Stok satu untuk seluruh sistem (W10). Produksi mendaftarkan No. Stok turunan lewat fungsi buku |
| `m_employee` | Produksi | §4.3 |
| `prd_balance`, `prd_ledger` | Produksi | Buku produksi. **Kolom nilainya** adalah angka ERP yang ikut disimpan di sini; tetap selama satu database (§8) |
| `sys_setting`, `sys_doc_type`, `audit_log` | Bersama | Satu katalog dan satu jejak untuk kedua aplikasi |

### 5.4 Referensi lintas aplikasi yang ada

Foreign key ini **tetap** selama databasenya satu. Daftar ini yang kelak menjadi referensi lemah.

| Arah | Kolom |
| --- | --- |
| Produksi → master ERP | `item_id` → `m_item`, `tracking_id` → `log_stock_tracking`, `unit_id` → `ref_unit`, `line_id` → `prd_line`, `routing_id` → `prd_routing` di identitas, buku, dan dokumen Produksi |
| ERP → Produksi | `prd_cost_entry.partai_id` → `prd_partai` saja |
| Keduanya → Bersama | `created_by`, `updated_by` (sudah tanpa foreign key) |

**Aturan untuk tabel baru:** referensi ke **master** aplikasi lain boleh foreign key; ke **dokumen** aplikasi lain memakai pasangan lemah `(doc_type_id, doc_id)`, sama dengan kontrak modul §3.1 `Claude-ERP.md`.

## 6. Tabel baru

### 6.1 Karena skema dua aplikasi

| Tabel (usulan) | Bagian | Fungsi | Alasan |
| --- | --- | --- | --- |
| `prd_user_unit` (`user_id`, `unit_id`, unik berdua) | Produksi | Unit mana yang boleh dibuka seorang user. Dimuat ke `actor.unitIds`; `requireUnit` dipanggil di tiap halaman dan aksi Workspace. Diisi lewat tab Unit di form User | Menggantikan nama `sys_user_unit` di rencana Workspace: isinya milik Produksi, dan `user_id` cukup tanpa foreign key seperti `created_by`, sehingga tidak ada tabel Bersama yang menunjuk aplikasi lain |
| `log_production_receipt`, `_line`, `_tracking` | ERP (dokumen batas) | BSTB Pengeluaran dan BSTB ke Finish Goods: Unit mengajukan dari Stand By, Gudang menerima; Terima memasukkan barang ke buku stok dengan No. Stok yang sama dan menjurnal | Cermin `log_stock_issue`. Satu tabel dengan *tujuan* (`production_return`, `finished_goods`) seperti dokumen standalone lain (P106), tampil sebagai dua menu. Dokumennya sudah ada di rencana menu; di sini hanya ditetapkan **rumahnya di ERP** |

Permission baru: `PRODUCTION_UNIT_ALL` (supervisor melihat semua Unit) dan `MENU_COSTING_ACCESS` (modul Produksi di ERP). Role yang kini memegang `PRODUCTION_COST_BILL_VIEW`, `RATE_VERSION_VIEW`, atau `COST_TYPE_VIEW` menerima `MENU_COSTING_ACCESS` lewat migrasi.

### 6.2 Karena pembangunan Workspace Unit (sudah disepakati di PWR dan rencana Workspace)

Semuanya **Bagian C — Produksi**, kecuali yang disebut lain.

| Tabel atau kolom (usulan) | Fungsi | Sumber |
| --- | --- | --- |
| Indeks parsial `prd_balance (unit_id, stage, job_id) WHERE qty_balance > 0` | Dua tabel Workspace (Job, No. Stok tanpa Job) tanpa membaca bucket kosong | W111, §3b |
| `prd_balance.entered_at` | Kolom *Sejak* | §3b |
| `prd_job.tracking_id`, `prd_job.partai_id` boleh kosong | Job dari banyak No. Stok atau lintas partai | W103, §3b |
| `prd_grading.job_id` + `prd_grading_input` | Grading per Job dengan banyak bucket input | W97, W107 |
| `prd_push`, `prd_push_line` | Dokumen Push | W58 |
| `prd_transfer`, `prd_transfer_line` | BSTB antar Unit (Penyebaran dan Transfer); partai lahir saat Terima Penyebaran | W20, W64, W83 |
| `prd_rework`, `prd_rework_line` | Dokumen Reproses | W77–W80 |
| `prd_job_order` | Job Order per No. Job keluar Moulding (grading) | W69 |
| `prd_box`, `prd_box_line` (`caiq_no` unik, `is_manual`) | Kotak Packing 95 | W112–W116 |
| `prd_composition` | Komposisi kotak untuk Telusur | PWR §12 |
| `prd_daily_summary`, `prd_partai_summary` | Ringkasan yang ditulis saat posting, dibaca laporan | Rencana Workspace §4 (F) |
| `prd_packing_bom`, `_line` (**ERP**) | BoM Packing per Nama Jual | W112, §4.3 |
| `sys_doc_counter` (**Bersama**) | Penghitung nomor per seri | Rencana Workspace §4 |

## 7. Tahapan implementasi

Tiap tahap satu commit ke `main`: build, lint, dan test hijau, DBML bersamaan dengan migrasinya, keputusan dicatat, push, migrasi Neon, lalu **review user di Neon sebelum tahap berikutnya**.

| Tahap | Isi | Migrasi | Selesai bila |
| --- | --- | --- | --- |
| 1 | **Selesai (P255).** **Pembatas DBML**: `erp.dbml.md` disusun menjadi Bagian A, B, C dengan komentar lintas aplikasi. Peta kepemilikan tabel di `tests/module-boundaries.test.ts`, dengan tes bahwa tiap model di `schema.prisma` punya tepat satu pemilik | tidak | Tes gagal bila ada tabel baru tanpa pemilik |
| 2 | **Selesai (P256).** **Dua pintu**: `APPS`, `requireApp`, route group `(erp)` dan `(production)`, halaman `/apps`, `landingHref` per aplikasi, tanda merek dan ikon *Pilih aplikasi* di topbar, rail kelompok untuk Produksi | tidak | User dua aplikasi melihat pemilih; user satu aplikasi langsung masuk; URL aplikasi yang tidak dimiliki ditolak |
| 3 | **Selesai (P257), kecuali entri Telusur di ERP.** **Pindah menu** menurut §4: Tagihan Biaya, Standard Cost, dan Jenis Biaya ke `/costing`; Karyawan ke `/production/employee`; kelompok Pengerjaan, Dokumen, Laporan, Master di Produksi; *No. Grading* dan *Kartu No. Stok*; Lot menjadi No. Stok di layar Produksi; redirect dari URL lama; matriks role per aplikasi; `MENU_COSTING_ACCESS` | ya (permission) | Tiap menu di §4 terbuka di aplikasinya; URL lama dialihkan; role lama tidak kehilangan akses |
| 4 | **Selesai (P260).** **Penugasan Unit, sebagai fondasi** (urutan disetujui 11/11/2026): `prd_user_unit`; `PRODUCTION_UNIT_ALL`, diberikan migrasi ke tiap role pemegang `PRODUCTION_UNIT_VIEW`; Unit milik user dibaca hanya oleh kode Produksi, bukan dimuat di tiap request; satu modul helper `unitScope` dan `requireUnit`, dipasang di titik yang tetap ada setelah tahap 5 — pemuat Workspace, fungsi daftar dan baca dokumen, Server Action simpan dan transisi, Terima BSTB Issue; tab Unit di form User. **Isi halaman Unit dan form grading tidak disentuh** (ditulis ulang di tahap 5) | ya | Admin Unit tidak bisa membuka Unit lain walau mengganti URL atau id dokumen |
| 5 | **Workspace Unit sesuai artifact**, urut: **5.0** daftar perbedaan artifact vs aplikasi dan pelanggaran design convention, disetujui user, tanpa kode (`Workspace-Unit-Diff.md`, **disetujui 11/11/2026, P261**); **5.1** **selesai (P262)**: indeks parsial dan `entered_at` di `prd_balance`, `prd_job` boleh tanpa No. Stok, No. Job pertama di BSTB Issue, data produksi development direset; *grading per Job dipindah ke 5.3 bersama formnya, supaya modul grading ditulis sekali*; **5.2** **selesai (P263)**: layar Unit dibangun ulang dan kode putaran pertama dihapus di commit yang sama (kartu KPI, `unitStageSummary` bila tak terpakai, `bucket-lines.tsx`); **5.3** grading per Job **selesai (P264)** (`prd_grading.job_id`, `prd_grading_input`, Grading Halus melepas Job) dan QC sebagai form; **5.4** fondasi beban data sebelum dokumen perpindahan (ringkasan, penghitung nomor, penulis massal; Workspace plan §5); **5.5** dokumen baru satu per commit, tabelnya lahir bersama dokumennya: Push, BSTB Penyebaran dan Transfer, Reproses, Job Order | ya, per langkah | Layar sama dengan artifact yang disetujui di 5.0 |
| 6 | **Dokumen batas keluar**: `log_production_receipt` untuk BSTB Pengeluaran, lalu BSTB ke Finish Goods bersama Packing | ya | Barang kembali ke stok dengan No. Stok yang sama; jurnal dan buku stok cocok di `db:reconcile` |

Tahap 1–3 tidak mengubah satu pun angka atau posting. Tahap 3 membutuhkan tahap 2.

## 8. Saat database benar-benar dipisah (bukan pekerjaan sekarang)

1. Posting di §2.2 terbelah dua. Produksi mengirim kejadian, ERP yang menjurnal (pola outbox).
2. Foreign key di §5.4 menjadi referensi lemah; master ERP direplikasi ke Produksi, satu arah.
3. Kolom nilai di `prd_balance` dan `prd_ledger` serta `prd_cost_entry` perlu diputuskan: tetap disalin ke Produksi atau dibaca dari ERP.
4. Register No. Stok (`log_stock_tracking`) perlu satu penerbit nomor.
5. Bagian A pindah ke Portal bersama OIDC (KB `security-rbac` 2.0).

## 9. Keputusan yang dikunci (10/11/2026)

| # | Keputusan | Asal |
| --- | --- | --- |
| 1 | Akses aplikasi diturunkan dari menu, tanpa permission `APP_*` | Saran disetujui |
| 2 | `/production/*` adalah aplikasi Produksi; sisi uang di `/costing/*` | Saran disetujui |
| 3 | Standard Cost dan Jenis Biaya di ERP › Produksi › Master Biaya | Saran disetujui |
| 4 | Akun Varians **tetap di Line**; `acc_production_line_account` tidak dibuat | Gugur oleh #9 |
| 5 | Penugasan Unit bernama `prd_user_unit` | Saran disetujui |
| 6 | Telusur muncul di kedua aplikasi, satu halaman | Saran disetujui; entri ERP-nya ditunda (P257) |
| 7 | Menu **BSTB Issue** tetap dengan nama dan letaknya; bukan satu halaman Serah Terima Produksi | Jawaban user |
| 8 | Pembayaran Biaya Produksi tanpa menu sendiri | Jawaban user |
| 9 | Workstation, Unit, Line Produksi, Routing **di ERP**, empat menu terpisah; Karyawan di Produksi | Identifikasi atas permintaan user (§4.3) |
| 10 | Lot menjadi No. Stok di layar aplikasi Produksi saja | Jawaban user |
| 11 | Tampilan menurut §3.3 | Simulasi putaran kelima |

## 10. Yang belum diperiksa

- Tidak ada kode yang diubah dan tidak ada yang dijalankan; ini dokumen rencana.
- Jumlah kata *Lot* di layar Produksi (tahap 3) belum dihitung.
- BoM Packing di ERP (§4.3) adalah usulan; ditetapkan saat Packing direncanakan.
