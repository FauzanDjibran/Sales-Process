# Tahap 6: Artifact Workspace v20 (putaran 7–11) vs Aplikasi, dan Langkah Implementasi

> Status: **usulan, belum disetujui.** Putaran 7–11 artifact
> (<https://claude.ai/artifact/TR9atVSRmuRUyh9nn9hHU7>, versi 20, 17/11/2026)
> belum dicatat di Claude-ERP §12 maupun PWR. Bentuk tabelnya sudah ada di
> `DBML/erp-produksi-target.dbml.md` (T1–T13). File ini membandingkannya dengan
> yang sudah dibangun (P262–P266) dan menyusun urutan build.

## 1. Posisi aplikasi sekarang

Yang sudah berjalan (tahap 5.1–5.4):

| Area | Aplikasi sekarang |
| --- | --- |
| Unit | Satu Unit = **satu proses** (`ref_unit.process`: Pass Through / Grading / Assembly) + flag `has_qc`, `releases_job`, `issues_job_order` |
| Tahap barang | `PrdStage` = Preparation · **QcCheck** · StandBy. QC adalah tahap, bukan proses |
| Moulding | Dua Unit, UMG (Grading) dan UMP (Pass Through) |
| Grading | **1 dokumen = 1 Job**, diambil utuh (P264); Job dilepas hanya bila Unit `releases_job` |
| Pengerjaan Unit | Pilih Job, satu karyawan per Job (P265) |
| QC Check | Form per Job, Lulus / Balik; Balik kembali ke Persiapan Unit yang sama |
| Workspace | Tab Masuk · Persiapan · QC Check · Stand By · Dalam Perjalanan (kosong); **dua tabel** (Job, No. Stok tanpa Job, W111); centang untuk *Periksa* |
| Nilai | Kolom Nilai di register dan kartu Nilai di form; journal di konfirmasi Posting (P103) |
| Rate | Standard Cost per Unit |
| Checkpoint | Hanya UBC (P239) |
| Belum ada | Push, BSTB Transfer, Dalam Perjalanan, Reproses, BSTB Pengeluaran, Job Order, Packing / BoM. **Barang berhenti di Stand By** (§17) |

## 2. Perbedaan dengan artifact v20

| # | Artifact v20 | Aplikasi | Dampak |
| --- | --- | --- | --- |
| G1 | **Unit = urutan proses** (Grading, Job Order, Assign, Kerja, QC, Assembly); QC selalu terakhir; satu proses sekali per Unit (T1) | Satu proses + flag | `ref_unit_step` baru; empat kolom `ref_unit` dihapus; `allow_reproses` baru; form Unit dapat tab *Proses* |
| G2 | **Tab Persiapan per proses**, pindah antar proses dalam Unit tanpa Push; setelah proses terakhir ke Stand By (T4) | Satu Persiapan + tahap QcCheck | `prd_balance` / `prd_ledger`: `unit_step_id`, stage `Preparation · Working · StandBy · InTransit`; `QcCheck` hilang |
| G3 | **UML = Grading › Job Order › Assign › QC**; UMG + UMP digabung | UMG, UMP | Seed produksi ditulis ulang; routing Reguler berubah |
| G4 | **Rate per Unit per proses**; QC dan Job Order tanpa rate (T3) | Rate per Unit | `prd_rate_version_line.unit_step_id`, `prd_cost_entry.unit_step_id`; form Standard Cost per baris proses |
| G5 | **Grading selalu melepas Job**, hasil selalu No. Stok baru (T2) | Hanya Unit `releases_job` | Aturan, tanpa kolom |
| G6 | **Satu Dokumen Grading berisi banyak Job**, karyawan multi di header, satu nomor NG (T6) | 1 dokumen = 1 Job (P264) | `prd_grading_line`, `prd_grading_worker`; `prd_grading.job_id` pindah ke baris. **Membalik P264 / W107** |
| G7 | **Job Order** mencampur beberapa No. Stok (boleh sebagian) + jenis target → satu No. Stok baru dengan Job dan JO sendiri (T7) | Tidak ada | `prd_job_order(_line, _input)`, `JOD_…`, tanpa rate dan journal |
| G8 | **Kerja** di UCL: Mulai (Job + karyawan → *Sedang Dikerjakan*), Selesai per Job membebankan rate, Batal Mulai tanpa biaya (T13) | Tidak ada (UCL Pass Through) | `prd_kerja(_line)`, stage `Working` |
| G9 | **Push / BSTB** mengambil barang tanpa Job per gram, tiap ambilan Job baru; *Ambil Semua Sisa* di checkpoint; Dalam Perjalanan = status (T8) | Tidak ada | `prd_transfer(_line)`: Dokumen Push, BSTB Transfer, BSTB Penyebaran (partai lahir di Terima) |
| G10 | **QC Balik ke proses pertama Unit**; baris tanpa Job mendapat Job baru (T9) | Balik ke Persiapan | Aturan |
| G11 | **Reproses** = pindah ke Unit sebelumnya, hanya Unit ber-QC, tidak melewati checkpoint yang sudah dilewati; checkpoint **UDA dan UBC** (T5, T10) | Tidak ada; checkpoint UBC saja | `prd_reproses(_line)`; seed checkpoint UDA |
| G12 | **BSTB Pengeluaran** ke Logistik: Draft › Ajukan › Terima (T11) | Tidak ada | `log_production_return(_line)` (ERP) |
| G13 | **Packing 95 dengan BoM per Nama Jual** (T12) | Tidak ada | `prd_bom(_component)` ERP; `prd_box(_piece, _component)` Produksi. O-12 masih Open |
| U1 | **Satu tabel per tab**: baris = Job, atau No. Stok bila tanpa Job | Dua tabel (W111) | Membalik W111 / P263 |
| U2 | **Tanpa centang** di tabel Workspace (kecuali *Sedang Dikerjakan*); satu aksi utama per tab; klik baris membuka pekerjaannya | Centang untuk *Periksa* | `unitBoard` + halaman Unit |
| U3 | **Satu baris input** (pilih / scan → gram bila boleh sebagian → Tambah) di Grading, Assign, QC, Kerja, Job Order, Push / BSTB, Pengeluaran, Reproses | Tiap form berbeda; `JobPicker` dialog | Satu komponen bersama `InputBar` |
| U4 | **Setelah Posting**: dialog *Buat Lagi* (ingat Tujuan, Jenis, karyawan) atau *Selesai* | Kembali ke tab Unit (D4) | Komponen bersama |
| U5 | **Tanpa harga di layar Produksi**: tanpa kolom / kartu Nilai, tanpa journal di konfirmasi | Ada (P265, P103) | Hapus dari Workspace, form, register, konfirmasi. **Perlu deviation check** (§4) |
| U6 | Tab pertama bernama **Penerimaan** (kartu tetap *Masuk*) | *Masuk* | Label |

Tidak berubah: Workstation, Line, Routing, Tagihan Biaya, Karyawan, `prd_user_unit`, `prd_partai`, `prd_job`, BSTB Issue (Job lahir di Terima, P262), Penutupan (masih langkah 10).

## 3. Langkah implementasi

Setiap langkah satu commit ke `main`, di-migrate dan di-seed ke Neon, lalu berhenti untuk review (phase review gate). Langkah 6.1 mengubah skema inti, jadi **data produksi di-reset** (`db:reset-production`, dengan persetujuan).

| Langkah | Isi | Selesai bila |
| --- | --- | --- |
| **6.0 Keputusan** | Catat putaran 7–11 di PWR (W130…) dan §12 (P274); jawab deviation check §4; persetujuan reset data produksi | Keputusan tercatat, tanpa kode |
| **6.1 Fondasi proses Unit** (G1–G5, G10) | Migrasi: `ref_unit_step`, `allow_reproses`, hapus `process` / `has_qc` / `releases_job` / `issues_job_order`; stage baru + `unit_step_id`; rate dan cost entry per step. Form Unit tab *Proses* (urutan, QC terakhir, terkunci bila dipakai); Standard Cost per Unit × proses. `production-ledger.ts`: pindah step (`advanceStep`), QC Balik ke step 1. Grading, Pengerjaan Unit, QC Check yang ada ditulis ulang di atas step (Grading selalu lepas Job). Seed produksi sesuai artifact (UML gabungan, checkpoint UDA + UBC). `db:reconcile` disesuaikan | Grading → Assign → QC berjalan di satu Unit tanpa Push; tes posting lulus |
| **6.2 Kerangka layar Workspace** (U1–U6) | Tab Penerimaan · Persiapan per proses · Sedang Dikerjakan · Stand By · Dalam Perjalanan; satu tabel per tab; tanpa centang; klik baris membuka pekerjaan; komponen `InputBar` dan dialog *Buat Lagi / Selesai*; semua Nilai dan journal hilang dari layar Produksi | Ui-audit terhadap artifact |
| **6.3 Push dan BSTB Transfer** (G9) | `prd_transfer(_line)`: Push (dalam Workstation, langsung), BSTB Transfer (lintas, Ajukan → Dalam Perjalanan → Terima), BSTB Penyebaran (partai lahir di Terima); ambil per gram, Job baru per ambilan; *Ambil Semua Sisa* di checkpoint | **Barang bisa jalan dari UGH sampai UBC** (menutup §17 "Goods stop in Stand By") |
| **6.4 Grading banyak Job** (G6) | `prd_grading_line`, `prd_grading_worker`; satu NG per dokumen, isi per Job di panel; input bar Jenis → gram → Enter | Membalik P264 |
| **6.5 Kerja** (G8) | `prd_kerja(_line)`, Mulai / Selesai / Batal Mulai, stage Working, rate di Selesai; UCL memakai Kerja | |
| **6.6 Job Order** (G7) | `prd_job_order(_line, _input)` di UML; mix No. Stok → No. Stok `<input terbesar>-n` dengan Job + JO; tanpa rate dan journal | Alur Moulding lengkap |
| **6.7 Reproses** (G11) | `prd_reproses(_line)`; hanya Unit `allow_reproses`, ke Unit sebelumnya di routing yang sama, tidak melewati checkpoint yang sudah dilewati | |
| **6.8 BSTB Pengeluaran** (G12) | `log_production_return(_line)` di ERP Persediaan; Draft › Ajukan › Terima Logistik; Reject sebelum partai ke Beban Pemusnahan | Menutup §17 "BSTB Issue Diajukan tanpa jalan balik" |
| **6.9 Packing 95 / BoM** (G13) | Master BoM Packing (ERP), dokumen Kotak dengan rekomendasi `planBoxes` | **Ditahan sampai O-12 ditutup** |

Sesudah itu (di luar rencana ini): BSTB ke Finish Goods, Packing 98, Penutupan Costing Produksi (langkah 10), laporan Rekap per partai.

## 4. Keputusan yang dibutuhkan

1. **Putaran 7–11 menjadi keputusan?** Tanpa ini tidak ada yang dibangun (P4, §18). G6 dan U1 membalik P264 / W107 dan P263 / W111 yang sudah dibangun.
2. **Deviation check, design convention §9.1** (*konfirmasi Posting menyatakan journal yang akan ditulis*): artifact menghapus journal dari layar Produksi (memori 13/11/2026). Alasan mempertahankan aturan: operator melihat akibat Posting sebelum terjadi. Pilihan: **A** ikuti konsep, **B** ubah untuk semua proyek, **C** konsep kedua, **D** pengecualian lokal untuk aplikasi Produksi (usulan: D, journal tetap terlihat di ERP).
3. **Reset data produksi** lokal dan Neon sebelum 6.1.
4. **Urutan**: usulan menaruh Push / BSTB (6.3) sebelum Grading banyak Job (6.4), supaya barang tidak lagi berhenti di Stand By secepatnya.

## 5. Risiko

- `prisma migrate dev` masih menolak database lokal (§17, checksum migrasi Walet); migrasi 6.1 ditulis tangan seperti `user_unit`, atau database lokal di-reset dulu.
- 6.1 menyentuh semua dokumen produksi yang sudah ada sekaligus; bila terlalu besar, bagi menjadi 6.1a (skema + ledger + seed) dan 6.1b (tiga dokumen).
- Volume: tab per proses menambah kunci pada `prd_balance_held_idx`; indeks perlu `unit_step_id` (sudah di target DBML).
