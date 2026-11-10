# Rencana Workspace Unit dan Beban Data Produksi

> **09/11/2026 (P242): tahap 1 sebagian dibangun** — Workspace Unit dengan scan membuka satu form untuk satu pekerjaan (tanpa timbangan); belum ada penugasan Unit per user, tab Line, dan Rincian.
>
> Status: **usulan, belum dibangun.** Konsep satu Workspace disetujui user; bentuk UI direview lewat
> [simulasi](https://claude.ai/artifact/TR9atVSRmuRUyh9nn9hHU7). Yang disepakati di sana dibangun sama persis. Belum ada perubahan sistem.
> Angka ukuran di bawah adalah **perkiraan**, bukan hasil uji: uji beban dibatalkan
> atas permintaan user dan beban server diasumsikan berat.

## 1. Masalah

1. Menu Dokumen Grading, Pengerjaan Unit, dan QC Check berpusat pada dokumen, dan Unit dipilih lewat dropdown. Admin harus tahu dulu apa yang perlu dikerjakan.
2. Admin Unit harus masuk ke Unit-nya dan tidak bisa membuka Unit lain.
3. Satu tempat harus menjawab: apa yang datang, apa yang belum dikerjakan, apa yang sudah selesai, dan apa langkah berikutnya.
4. Sidebar tidak boleh bertambah satu menu per Unit.
5. Beban diasumsikan 30 Unit × 100.000 baris per bulan: **3 juta baris per bulan, 36 juta per tahun, sekitar 15–18 GB per tahun** untuk `prd_ledger` beserta indeksnya.

## 2. Cara ERP mainstream menanganinya

| Sistem | Bentuk | Bagaimana Work Center dipilih | Yang dipelajari |
| --- | --- | --- | --- |
| Odoo Shop Floor | Satu modul; tiap work center punya halaman sendiri berisi kartu work order | Tombol + untuk menyalakan halaman work center; ada juga halaman My | Satu menu, banyak halaman |
| SAP Manage Work Center Queue | Satu app antrean operasi per work center | Terbuka di work center default dari pengaturan user | Unit melekat pada user |
| SAP Digital Manufacturing POD | Dashboard operator per work center, dirancang lewat POD Designer | Konfigurasi | Isi halaman mengikuti tipe kerja |
| Dynamics 365 Production Floor Execution | Satu antarmuka dengan tab All jobs, Active jobs, My jobs | Filter production unit › resource group › resource | Tab dikonfigurasi, bukan satu menu per resource |
| Oracle Production Supervisor Workbench / Dispatch List | Satu workbench, satu dispatch list | Pilih work center yang menjadi tanggung jawabnya | Hak akses membuka halaman, bukan membatasi work center |
| ERPNext Job Card, Plant Floor | Job Card per operasi per workstation; Plant Floor untuk status | Daftar yang difilter | Paling dekat dengan model dokumen kita sekarang |

**Kesimpulan.** Tidak ada satu pun yang membuat menu per Work Center. Polanya selalu: **satu pintu, lalu daftar Unit, lalu satu halaman kerja yang isinya digerakkan data.**

**Bedanya dengan kebutuhan kita:** di sumber yang saya temukan, pembatasan work center umumnya berupa default atau filter, bukan penguncian data. Kita perlu penguncian sungguhan, jadi harus ditegakkan di server.

## 3. Rancangan Workspace

### Menu

Produksi punya dua kelompok:

- **Pengerjaan › Workspace Unit** (`/production/unit`): satu entri, tempat bekerja. Menambah Unit tidak menambah menu.
- **Dokumen**: Dokumen Grading, Pengerjaan Unit, QC Check, Assembly Kotak, Dokumen Push, BSTB, dan Dokumen Reproses. Di sinilah dokumen disimpan dan dibuka, termasuk Draft, jadi Workspace **tidak punya Riwayat** (masukan user 07/11/2026). Tiap register memakai tab status dan filter Unit, dan Admin Unit hanya melihat dokumen Unit-nya.

### Daftar Unit (kartu)

- Satu kartu per Unit, dikelompokkan per Workstation. Unit sebelum partai berada di kelompok sendiri.
- Kartu memuat kode, nama, tipe, line, QC, dan empat hitungan berikut gramnya: Masuk, Persiapan, QC, dan Stand By.
- Tab **Line** (Semua, Reguler, …) menyaring Unit pada routing line itu dan hanya menghitung barang line itu. Unit sebelum partai selalu tampil karena dipakai semua line.
- User dengan satu Unit langsung masuk ke Unit tersebut.

### Halaman Unit: `/production/unit/[label]?tab=&line=`

Pola layar Pengajuan Budget di SIBA:

1. Header: nama dan tipe Unit, lalu Workstation, line, QC, dan checkpoint. `.selcount` dan aksi berada di `.ph-act`.
2. **Kartu ringkasan** `.kpis.bud`: Kiriman Masuk, Persiapan, QC Check (bila ada), dan Stand By, masing-masing dengan gram, jumlah baris dan partai, serta tanggal tertua. Tombol *Rincian* membuka pecahan per partai dan line.
3. **Satu card dengan tab navigasi** `.qtabs` (QueueTabs SIBA, dengan hitungan), lalu toolbar berisi pencarian, filter Line bila Unit dipakai lebih dari satu line, dan filter Partai. Di bawahnya tabel dengan kolom pilih.

| Tab | Isi | Aksi |
| --- | --- | --- |
| Masuk | BSTB yang menuju Unit ini, belum diterima | Terima |
| Persiapan | Barang belum dikerjakan, termasuk baris Balik QC | Kerjakan Grading (banyak No. Stok sekaligus) / Catat Pengerjaan / Buat Kotak, sesuai tipe Unit; Reproses; BSTB Pengeluaran |
| QC Check (`has_qc`) | Barang menunggu keputusan | Centang baris (satu partai), lalu **Reject** atau **Pass** di kanan atas; Reject menanyakan alasan opsional |
| Stand By | Barang selesai, dengan kolom **Tujuan** dari routing line partainya | Buat Dokumen Push / Buat BSTB ke tujuan itu: membuka **form** yang menunjukkan Dari, Ke, tanggal, partai, dan barang yang dikirim |

### Dokumen yang dibuat dari Workspace

- **Dokumen Grading** (`DG_<unit>_…`) memuat **banyak No. Grading** (`NG_<unit>_…`), satu per No. Stok input (W25). Form awalnya hanya **daftar baris** (No. Stok, partai, No. Job, diambil, output, susut, status). **Klik baris membuka pop up** untuk mengisi grading baris itu: gram diambil, output (Item dan gram), *Salin Item Baris Sebelumnya*, lalu Simpan Baris atau Simpan dan Baris Berikutnya. *Ini mengubah W25 dari "satu dokumen per No. Stok" menjadi "satu No. Grading per No. Stok di dalam satu dokumen"; perlu dicatat di PWR saat dibangun.*
- **Tambah baris dari form:** Dokumen Grading (*Tambah No. Stok*), Pengerjaan Unit (*Tambah No. Job*, satu partai), dan Dokumen Push atau BSTB (*Tambah Baris*, tujuan sama) punya tombol tambah yang membuka modal berisi baris Persiapan atau Stand By Unit itu, jadi baris yang terlupa tidak perlu diambil lewat Workspace lagi.
- **Dokumen Push dan BSTB lewat form**, bukan dialog: terlihat jelas dikirim ke mana dan apa saja sebelum Posting atau Ajukan. Line partai dipilih di form BSTB Penyebaran.
- **Nilai dan journal tetap tampil**, tetapi selalu di bagiannya sendiri: kolom Nilai di ujung tabel, kartu *Nilai* terpisah dari ringkasan gram, baris nilai tambahan di kartu ringkasan, journal di konfirmasi Posting dan di halaman dokumen. Semuanya bergantung pada satu syarat (`canSeeValue`), jadi kalau nanti dimatikan untuk orang produksi (misalnya lewat permission `PRODUCTION_VALUE_VIEW`), layar lain tidak berubah. Simulasi punya sakelar *Uji layar tanpa nilai* di menu akun untuk membuktikannya.
- **Bahan penolong** di semua eksekusi ditambah lewat tombol: *Tambah Bahan Penolong* membuka daftar bahan yang ada saldonya di Unit, lalu diisi qty-nya. Bahan yang tidak dipakai tidak tampil.
- **Assembly (Buat Kotak)** dimulai dari dua pilihan: **Nama Jual** (pilihannya menunjukkan maksimal kotak dari pcs dan bahan penolong) dan **Jumlah Kotak**. Gram, toleransi, isi pcs, dan bahan penolong per kotak dibaca dari BoM Packing. Setelah itu sistem menyusun kotak, user menukar pcs dengan tangan, lalu OK.
- **Line**: tiap No. Partai menampilkan line-nya. Line dipilih di BSTB Penyebaran dan partai lahir dengan line itu saat Terima. Tujuan Push, BSTB, dan Reproses mengikuti routing line partai.

### Akses

- **Permission menjawab *apa* yang boleh dilakukan, penugasan menjawab *di mana*.** Cukup satu role "Admin Unit" untuk semua Unit; tidak perlu 30 role.
- Tabel baru `sys_user_unit (user_id, unit_id)`, diisi lewat tab Unit di form User.
- Permission baru `PRODUCTION_UNIT_ALL` untuk supervisor, PPIC, dan Admin.
- `actor.unitIds` dimuat bersama sesi. Satu penjaga `requireUnit(actor, unitId)` dipanggil di **setiap** halaman dan Server Action, termasuk saat dokumen dibuka lewat id, supaya mengganti URL tidak menembus batas.
- Register di menu Dokumen difilter ke Unit milik user; supervisor melihat semua.

## 3a. Dua aplikasi dalam satu SSO (P245, usulan menu)

Niat user: saat diimplementasikan, ERP dan Produksi menjadi **dua aplikasi dengan satu SSO**. Setelah login user memilih aplikasi sesuai permission; yang hanya punya satu langsung masuk. Kelak tiap aplikasi punya database sendiri, tetapi **repo ini tetap satu aplikasi dan satu database** (batas Vercel dan Neon). Pemisahannya cukup di tampilan (simulasi putaran kelima) dan di `DBML/erp.dbml.md`, yang menandai tabel milik tiap aplikasi.

**Pola ERP mainstream.** SAP S/4HANA memegang master, order, biaya, dan goods movement, sedangkan SAP Digital Manufacturing (MES) memegang eksekusi di work center. Dynamics 365 memisahkan Production floor execution dari Supply Chain. Oracle punya Production Supervisor Workbench terpisah. Odoo memakai satu database, tetapi app Shop Floor terpisah dari Manufacturing dan Inventory. Pola yang sama: **ERP memegang uang, rencana, dan stok; aplikasi lantai produksi memegang eksekusi dan perpindahan.** Barang menyeberang lewat dokumen batas, dengan satu sisi menyerahkan dan sisi lain menerima.

| Aplikasi | Menu | Isi |
| --- | --- | --- |
| Produksi | Pengerjaan | Workspace Unit |
| Produksi | Dokumen | Dokumen Grading, Pengerjaan Unit, QC Check, Isi Wadah, Assembly Kotak, Dokumen Push, BSTB antar Unit, Dokumen Reproses, Job Order |
| Produksi | Laporan | Saldo Produksi per Unit (gram), Kartu No. Stok, Telusur Produksi, Rekap Susut per Partai |
| Produksi | Master | Unit dan Workstation, Line dan Routing, Karyawan, BoM Packing |
| ERP | Persediaan › Serah Terima Produksi | Dokumen batas: BSTB Issue diajukan Gudang dan diterima Unit; BSTB Pengeluaran dan BSTB ke Finish Goods diajukan Unit dan diterima Gudang |
| ERP | Produksi (sisi uang) | Perencanaan (Sales Planning, Rencana Produksi), Biaya (Tagihan Biaya, Pembayaran Biaya Produksi, Closing Costing Produksi), Master Biaya (Standard Cost per Unit, Line dan Akun Varians, Jenis Biaya), Laporan (Nilai WIP per Unit, Varians per Line, Telusur) |
| Keduanya | Item, Gudang, User dan Role | Milik ERP; Produksi membacanya |

**Catatan untuk saat database benar-benar dipisah** (bukan pekerjaan sekarang):
- Posting yang kini satu transaksi akan terbelah antara dua aplikasi: biaya unit, perubahan akun WIP di grading, Terima BSTB Issue, dan Finish Goods. Produksi harus mengirim kejadian, lalu ERP yang menjurnal (pola outbox).
- Standard Cost per Unit dan akun varians tinggal di ERP, sementara Unit dan Line ada di Produksi, jadi kode Unit perlu direplikasi.
- Nilai di layar Produksi tetap di balik satu syarat (`canSeeValue`), dibaca dari ERP.

## 4. Beban data: pilihan solusi

| # | Solusi | Kelebihan | Kekurangan | Putusan |
| --- | --- | --- | --- | --- |
| A | Satu tabel biasa, indeks diperbaiki | Paling sederhana | Tabel makin besar; menghapus data lama mahal; laporan lintas waktu makin lambat | Tidak cukup untuk asumsi ini |
| B | Satu tabel logis, partisi per bulan | Kode tetap melihat satu tabel; query berfilter tanggal hanya membaca bulannya; arsip tinggal lepas partisi | Primary key harus memuat tanggal; query tanpa tanggal memeriksa semua partisi; migrasi Prisma ditulis tangan | Tunda |
| C | Tabel atau partisi per Unit | Terlihat rapi per Unit | Unit adalah data, jadi Unit baru butuh DDL; Telusur No. Stok melintasi semua Unit; konsolidasi WIP makin berat | **Tolak** |
| D | Kurangi baris yang ditulis | Mengurangi tulis, baca, dan biaya sekaligus | Mengubah konsep buku; perlu keputusan | Opsional |
| F | **Ringkasan yang ditulis saat posting** | Laporan membaca sedikit baris; tetap satu tabel ledger | Satu tabel lagi yang harus cocok dengan ledger | **Pakai** |
| E | Data warehouse terpisah | Laporan besar sangat ringan | Sistem baru, sinkronisasi, biaya; berlebihan sekarang | Tunda |

### Rekomendasi: fokus ke sisi baca

Penyimpanan bukan masalah (user). Biaya baca mengikuti jumlah baris yang dibaca, bukan yang tersimpan, jadi laporan tidak menjumlahkan ledger saat dibuka. Partisi (B) ditunda.

| Kebutuhan | Sumber baca |
| --- | --- |
| Workspace, saldo hari ini | `prd_balance`, dengan indeks parsial `(unit_id, stage) WHERE qty_balance > 0` karena bucket kosong terus menumpuk |
| Saldo tanggal lampau | Snapshot Closing per bucket ditambah mutasi bulan itu |
| Rekap periode, dashboard, susut | Tabel ringkasan harian per Unit dan Item, ditulis dalam transaksi posting, seperti `cash_bank_period` (P221) |
| Rekap per partai | Ringkasan per partai dan Unit, cara tulisnya sama |
| Kartu No. Stok, rincian dokumen | `prd_ledger` lewat indeks, berhalaman dengan keyset cursor |
| Telusur | `prd_tracking_link` |
| Ekspor besar | Dibuat di latar belakang per bulan |

- Rentang tanggal di ledger memakai indeks BRIN pada `posting_date`, tanpa mengubah primary key.
- Closing mencocokkan ringkasan dengan jumlah ledger per bulan, sehingga selisih langsung terlihat.
- Partisi bisa ditambah kapan saja: tabel lama dipasang utuh sebagai satu partisi, bulan baru menjadi partisi baru. Arsip menyusul dengan cara yang sama dan **tidak menghapus data**.

### Mengurangi baris (D)

Satu No. Stok yang lewat satu Unit ber-QC kini menulis sekitar 6 baris: masuk (dua), selesai kerja (dua), QC (dua).

| Tuas | Dampak | Biaya |
| --- | --- | --- |
| Perpindahan stage di dalam Unit tidak menulis ledger. Stage hanya di saldo, jejaknya di dokumen QC dan pengerjaan. | Sekitar 6 baris menjadi sekitar 3 | Mengubah aturan "bucket sama dengan barisnya"; butuh perubahan identitas bucket |
| Baris per pcs di Barcoding dan Packing dipindah ke register terpisah; ledger per kelompok | Kemungkinan tuas terbesar: §16 PWR menyebut ±5.000 pcs per partai | Mengubah cara kerja No. Stok per pcs; diputuskan bersama Packing |
| Buang `qty_balance` dan `value_balance` dari ledger | Baris lebih ramping, sekitar 30 byte | Kartu dihitung saat baca, mengubah keputusan P114 untuk ledger ini |

### Titik lemah di kode sekarang

Ini ditemukan dari membaca kode, dan semuanya tetap perlu dibereskan apa pun pilihan di atas:

| Tempat | Masalah | Perbaikan |
| --- | --- | --- |
| `production-ledger.ts:write` | Tiap baris buku punya beberapa round trip: cek periode, nomor, update, insert, ditambah kunci bucket. Dokumen 5.000 baris bisa puluhan ribu query dan berisiko timeout | Penulis massal: kunci bucket berurutan sekali jalan, cek periode dan nomor sekali, `createMany` |
| `position()` | Mencari nomor terakhir dengan `startsWith` lalu urut id | Tabel penghitung per seri |
| `wipBalanceReport` | `DISTINCT ON` seluruh ledger di tiap buka laporan | Snapshot bulanan |
| `productionBooksReconcile` | `GROUP BY` seluruh ledger di tiap buka laporan | Pindah ke job terjadwal, per periode |
| `hasProductionMovement` | Filter `posting_date`, tetapi kolom ini tidak berindeks sendiri | Indeks BRIN |
| `availableBuckets` | Indeks hanya `unit_id`, semua bucket kosong ikut terbaca | Indeks parsial |

### Server

- Neon Free (1 GB per project) habis dalam kurang dari sebulan pada beban ini, jadi harus pindah ke paket berbayar.
- Biaya penyimpanan sekitar $0,35 per GB-bulan menurut sumber sekunder, tidak besar. Yang lebih menentukan adalah **compute**, dan itu dikurangi oleh lapis 1–3.
- Posting besar jangan berjalan di request halaman yang bisa terkena batas waktu fungsi. Ini dirancang bersama penulis massal.
- Cek ulang harga di halaman resmi Neon sebelum memutuskan; sumbernya saling berbeda.

## 5. Tahapan

| Tahap | Isi | Kapan |
| --- | --- | --- |
| 0 | Review simulasi sampai disepakati | Sekarang |
| 1 | `sys_user_unit`, penjaga akses, Workspace Unit, indeks parsial | Setelah simulasi disepakati |
| 2 | Tabel ringkasan, BRIN, penghitung nomor, penulis massal, rekonsiliasi terjadwal | **Sebelum** Dokumen Push dan BSTB Transfer |
| 3 | Dokumen Push, BSTB Transfer, dan menu berikutnya masuk ke tab Workspace | Lanjutan rencana menu |
| 4 | Snapshot bulanan | Bersama Closing |
| 5 | Keputusan grain pcs | Bersama Packing |
| 6 | Partisi dan arsip | Bila baca rentang atau ukuran tabel menuntut |

## 6. Keputusan yang dibutuhkan

1. **Perpindahan stage tanpa baris ledger?** Saran: ya, diputuskan di tahap 2.
2. **Laporan Produksi untuk Admin Unit:** dibatasi ke Unit-nya, atau tetap lintas Unit? Saran: dibatasi, kecuali Telusur, karena Telusur memang melintasi Unit.
3. **Masih terbuka di simulasi:** satu Dokumen Push untuk banyak kotak, dan OK per kotak atau sekaligus.

Putaran keempat 10/11/2026 (P244, PWR W96–W106): 1 baris = 1 Job dan isinya lewat modal; grading per Job, diambil utuh, dengan input bergaya timbangan; barang tanpa Job boleh diambil sebagian di form kirim; tab Dalam Perjalanan (tampilan saja); Packing 95 menjadi Isi Wadah, Pemberian CAIQ, dan Kotak; UMG ditandai O-13. Ini menggantikan "Dokumen Grading berisi banyak No. Grading, satu per No. Stok" di bawah: kini satu per Job.

Putaran ketiga 07/11/2026: grading berupa daftar baris dengan pop up per baris; QC centang lalu Reject atau Pass; Push dan BSTB lewat form; tombol tambah baris di tiap form pengerjaan dan pengiriman. Nilai dan journal tetap tampil di bagiannya sendiri, sehingga bisa dimatikan nanti tanpa mengubah layar (keputusan user; konvensi §9.1 tetap diikuti).

Sudah diputuskan lewat review simulasi 07/11/2026: konsep Workspace disetujui; daftar Unit berupa kartu; dokumen punya menu sendiri tanpa Riwayat di Workspace; kartu ringkasan dan tab navigasi mengikuti SIBA; Dokumen Grading berisi banyak No. Grading; bahan penolong ditambah lewat tombol; Assembly dimulai dari Nama Jual dan jumlah kotak; line terlihat di partai dan menjadi filter daftar Unit.

Deviation check primary key (§9, P223) gugur selama partisi ditunda, dan muncul lagi bila partisi diambil.

## 7. Risiko yang belum diperiksa

- Perilaku `prisma migrate` terhadap tabel partisi yang ditulis tangan: belum terdokumentasi, dibuktikan bila partisi diambil.
- Tabel ringkasan bisa berebut kunci baris saat dua posting menyentuh hari, Unit, dan Item yang sama. Urutan kuncinya dirancang di tahap 2.
- Perkiraan 15–18 GB per tahun belum diukur.
- Register pcs terpisah adalah pola yang saya ketahui secara umum, belum saya verifikasi di ERP mana pun.

## Sumber

- [Odoo Shop Floor overview](https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/manufacturing/shop_floor/shop_floor_overview.html)
- [SAP: Assigning Production Operators and Selecting Work](https://learning.sap.com/courses/s-4hana-peo-foundational-setup-and-basic-processes/assigning-production-operators-and-selecting-work)
- [SAP: Using Production Operator Dashboards](https://learning.sap.com/courses/executing-processes-for-discrete-industries-in-sap-digital-manufacturing/using-production-operator-dashboards_f3f8dc92-5c9c-43af-8d44-201c6317f40f)
- [Dynamics 365: How workers use the production floor execution interface](https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/production-floor-execution-use)
- [Dynamics 365: Design the interface](https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/production-floor-execution-tabs)
- [Oracle: Production Supervisor Workbench](https://docs.oracle.com/en/cloud/saas/readiness/scm/24d/mfg24d/24D-mfg-wn-F34298.htm)
- [Oracle: How You Review a Dispatch List](https://docs.oracle.com/en/cloud/saas/supply-chain-and-manufacturing/26a/faumf/how-you-review-a-dispatch-list.html)
- [ERPNext Job Card](https://docs.frappe.io/erpnext/user/manual/en/job-card)
- [ERPNext Plant Floor](https://docs.frappe.io/erpnext/user/manual/en/plant-floor)
- [PostgreSQL: Table Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)
- [Neon plans](https://neon.com/docs/introduction/plans)
- [Prisma issue 1708: partitioning](https://github.com/prisma/prisma/issues/1708)
