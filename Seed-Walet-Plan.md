# Rencana Seed Walet

> Status: **dibangun 20/11/2026 (P296)**, semua rekomendasi Q1–Q6 disetujui. Menyimpang dari §2: nama item memakai item `db:seed-production-showcase` (SM-A …) bukan MK-1-0-0, UP8 tidak di-seed (P280), gudang walet tanpa lokasi, Q1 tidak relevan lagi karena Kerja dan Job Order sudah dibangun (P282, P283).
> Tujuan: dua seed demo yang berdiri sendiri — **Makloon** (yang sekarang,
> kosmetik dari simulasi PRJ.001) dan **Walet** (sarang burung walet, line
> Reguler dan Mie) — supaya database yang baru di-reset bisa langsung dipakai
> untuk mencoba alur walet dari pembelian sarang mentah sampai Finish Goods.

Sumber: artifact *Workspace Unit Produksi* (putaran 11, Unit dan langkah
prosesnya), artifact *Simulasi Produksi Walet* (nama item dari sheet contoh,
rate, skenario), `Produksi Walet (Real).md` (W41 Cold Storage, W8 Nama Jual,
W32 BJL, W61 bahan penolong Packing).

---

## 1. Bentuk dua seed

| | Makloon | Walet |
| --- | --- | --- |
| Skrip | `scripts/seed-makloon.ts` (rename dari `seed-showcase.ts`, isi sama) | `scripts/seed-walet.ts` (baru) |
| npm | `db:seed-makloon`, `db:neon-seed-makloon` | `db:seed-walet`, `db:neon-seed-walet` |
| Reset + isi | `db:fresh-makloon` | `db:fresh-walet` |
| Bersama | `scripts/lib/seed-common.ts`: actor Sistem, `audit()`, `villageFor()`, Tahun Fiskal berjalan, bank + Buku Kas & Bank, injeksi stok awal, `seedStarterAccounts` (sudah ada) |

Aturan yang sama dengan showcase sekarang (P11): **dev only**, tidak pernah di
`db:seed`, aditif dan idempoten (dicocokkan pada label / nama, tidak pernah
mengubah yang sudah ada), audit `create` per master, tanpa dokumen dan tanpa
saldo awal.

**Satu instalasi satu perusahaan (P9):** kedua seed tidak dimaksudkan untuk
dijalankan pada database yang sama. Tidak ada larangan teknis (semuanya
aditif), tapi hasilnya dua dunia usaha bercampur. `db:fresh-*` adalah cara
pakainya.

`db:seed-showcase` dan `db:fresh` lama: lihat pertanyaan **Q5**.

## 2. Isi seed Walet

### 2.1 Master struktur produksi (mengganti `db:seed-production`)

`seed-production-masters.ts` saat ini sudah menulis Workstation, Unit dan
routing Reguler. Seed Walet **memanggilnya** (bukan menyalin), lalu
`seed-production-masters.ts` diselaraskan dengan artifact putaran 11:

| Workstation | Unit | Langkah (artifact) | Sekarang di seed | Usulan |
| --- | --- | --- | --- | --- |
| BB + PPIC | UGH Grading Halus | Grading › QC | sama | — |
| | UPC Pre Cleaning | Assign › QC | sama | — |
| | UPY Penyebaran | Grading | sama | — |
| Cleaning | UPW Pre Wash | Assign › QC | sama | — |
| | UCL Cleaning | **Kerja** › QC | Assign › QC (shortcut, 6.5 belum) | **Q1** |
| | UC1 CCP-1 | Assign | sama | — |
| | USR Sortir | Assign | sama | — |
| Moulding | UDA Dry A ◆ | Grading › QC | sama | — |
| | UML Moulding | Grading › **Job Order** › Assign › QC | Grading › Assign › QC (6.6 belum) | **Q1** |
| | UDB Dry B | Grading › QC | sama | — |
| WIP Packing | UWP Wrapping | Assign › QC | sama | — |
| | UBC Barcoding ◆ | Grading › QC | sama | — |
| | UP5 Packing 95 | Assembly | sama | — |
| | **UP8 Packing 98** | Assembly | tidak ada (W81) | tambah, ujung routing |

◆ checkpoint partai. Nama Workstation "CL", "ML", "WP" diganti label yang
terbaca di artifact (Cleaning, Moulding, WIP Packing) — label pendeknya tetap.

**Line dan routing:**

| Line | Routing | Urutan |
| --- | --- | --- |
| — | PRA-PARTAI | UGH → UPC → UPY |
| REG Reguler | REG-1 | UPW → UCL → UC1 → USR → UDA◆ → UML → UDB → UWP → UBC◆ → UP5 → UP8 |
| **MIE Mie** (baru) | MIE-1 | UPW → UCL → UC1 → USR → UDA◆ → UWP → UBC◆ → UP5 → UP8 (tanpa Moulding dan Dry B) |

Akun Varians kedua line: *Varians Produksi* dari starter chart.

### 2.2 Standard Cost versi SC-1 (aktif)

Rate per gram dari artifact Workspace Unit (Rp/gram per Unit × langkah
berbiaya; QC dan Job Order tanpa rate):

| UGH 180 | UPC 120 | UPY 60 | UPW 90 | UCL 420 | UC1 40 | USR 70 |
| --- | --- | --- | --- | --- | --- | --- |
| **UDA 110** | **UML Grading 150 · Assign 240** | **UDB 110** | **UWP 80** | **UBC 130** | **UP5 160** | **UP8 95** |

Dibuat hanya bila belum ada versi aktif sama sekali (tidak menutup versi
milik user).

### 2.3 Item (Satuan dari system seed: GR, PCS, BOX, KRT)

Nama dan label dari sheet contoh di artifact Simulasi Produksi Walet. Semua
Barang, Kelola Stok, **tanpa** Memiliki Kadaluarsa (sarang kering; bila perlu
kadaluarsa, ubah di Q4).

| Kategori Item | Label | Nama | Satuan | Dapat Dibeli / Dijual | BJL |
| --- | --- | --- | --- | --- | --- |
| Bahan Baku | `MK-1-0-0` | Mangkok 1, bahan baku kotor (chong) | GR | Beli | |
| Bahan Baku | `MK-1-BSH` | Mangkok 1, bahan baku bersih | GR | Beli | |
| Barang Setengah Jadi | `MK-2-BSA-KR` | Mangkok 2 BSA KR | GR | — | |
| Barang Setengah Jadi | `MK-2-BSA-PB` | Mangkok 2 BSA PB | GR | — | |
| Barang Setengah Jadi | `G2-0-0-0` | Grade 2 | GR | — | |
| Barang Setengah Jadi | `MK-2-PK-G` | Mangkok 2 PK, hasil grading Moulding | GR | — | |
| Barang Setengah Jadi | `N-MK-PC` | N-MK PC (keping, target Job Order) | GR | — | |
| Barang Setengah Jadi | `KAKIAN` | Kakian | GR | Jual | ✓ |
| Barang Setengah Jadi | `BULU` | Bulu | GR | Jual | ✓ |
| Barang Setengah Jadi | `RONTOKAN` | Rontokan Bahan | GR | Jual | ✓ |
| Barang Jadi (Nama Jual) | `B-MK-50` | B-MK 50 gr | BOX (kotak) | Jual | |
| Barang Jadi (Nama Jual) | `B-MK-100` | B-MK 100 gr | BOX (kotak) | Jual | |
| Bahan Kemas | `BP-KOTAK` | Kotak | PCS | Beli | |
| Bahan Kemas | `BP-STIKER` | Stiker Daun | PCS | Beli | |
| Bahan Kemas | `BP-GRAMASI` | Gramasi | PCS | Beli | |
| Bahan Kemas | `BP-BOX` | Box Packing 98 | PCS | Beli | |
| Bahan Kemas | `BP-KARTON` | Karton | PCS (+ KRT isi 24 box?) | Beli | |
| Barang Habis Pakai | `BHP-SRG` | Sarung Tangan | BOX, tanpa Kelola Stok | Beli | |
| Jasa | `JS-LAB` | Jasa Uji Lab (nitrit) | UNIT | Beli | |
| Jasa | `JS-KIRIM` | Jasa Pengiriman | UNIT | Beli | |

BJL "Dapat Dijual" karena hasil samping walet laku dijual (W12 mengeluarkannya
ke Logistik); bila tidak, cukup tidak dicentang (**Q4**).

### 2.4 Gudang dan Lokasi

| Label | Nama | Lokasi | Gunanya |
| --- | --- | --- | --- |
| `GD-CS` | Cold Storage Bahan Baku | `R1`, `R2`, `R3` (Rak 1–3) | BB disimpan sampai BSTB Issue ke UGH (W41) |
| `GD-BP` | Gudang Bahan Penolong | — | Kotak, stiker, box, karton; BSTB Issue bahan penolong ke UP5 / UP8 |
| `GD-FG` | Gudang Finish Goods | `FG-A`, `FG-B` | Kotak Nama Jual dari BSTB ke Finish Goods; Delivery Note keluar dari sini |
| `GD-BJL` | Gudang Hasil Samping | — | BJL dan reject dari BSTB Pengeluaran |

### 2.5 Partner

**Supplier** (Pembelian, IDR): 3 — rumah walet badan usaha PKP
(`S-W01 PT Rumah Walet Kalbar`, Pontianak), pengepul orang pribadi NIK non-PKP
(`S-W02 Pengepul H. Syamsul`, Sampit), pemasok kemasan PKP
(`S-W03 CV Kemas Prima`, Surabaya).

**Customer:** 3 — eksportir/importir luar negeri **USD**, Currency Default USD
(`C-W01 Hong Kong Bird's Nest Trading Ltd`; alamat wajib kelurahan Indonesia
→ pakai alamat agen/forwarder di Jakarta Utara), distributor dalam negeri PKP
(`C-W02 PT Sarang Emas Nusantara`, Jakarta), toko oleh-oleh non-PKP
(`C-W03 Toko Walet Sehat`, Surabaya). Termin dan mode harga sebagai showcase.

### 2.6 Kas & Bank dan Kurs

`BCA` (IDR) dan `BCA-USD` (USD), masing-masing dengan Buku Kas & Bank; satu
Kurs Transaksi USD hari ini (mis. 16.250) supaya Customer Order USD langsung
terisi kursnya. Chart of accounts: `seedStarterAccounts` seperti makloon.

### 2.7 Karyawan dan user produksi

Karyawan `K1`–`K6`: Ani, Budi, Citra, Dedi, Eka, Fitri (artifact).

User demo (artifact): **Hendra** Supervisor Produksi (ERP + Produksi, semua
Unit), **Dewi** Admin Logistik (ERP saja), **Rina** Admin Unit (UGH),
**Bagas** Admin Unit (UPW, UCL), **Sari** Admin Unit (UP5) — dengan role dan
`prd_user_unit` (P260). Ini satu-satunya bagian yang membuat role baru dan
password; lihat **Q3**.

### 2.8 Stok awal (injeksi, tanpa journal, seperti showcase)

| Gudang · Lokasi | Item | No. Stok | Gram / Qty | Nilai |
| --- | --- | --- | --- | --- |
| GD-CS · R1 | MK-1-0-0 | `STK-0001` (S-W01) | 10.000 g | Rp 40.000.000 |
| GD-CS · R1 | MK-1-0-0 | `STK-0002` (S-W02) | 6.000 g | Rp 27.000.000 |
| GD-CS · R2 | MK-1-BSH | `STK-0003` (S-W01) | 5.000 g | Rp 32.500.000 |
| GD-BP | Kotak / Stiker / Gramasi | — | 500 pcs masing-masing | Rp 50.000 / 5.000 / 2.000 per pcs |
| GD-BP | Box / Karton | — | 200 / 20 pcs | Rp 150.000 / 40.000 per pcs |

Angka STK-0001/0002 sama dengan skenario Simulasi Produksi Walet, sehingga
hasil di ERP bisa dibandingkan dengan artifact. Tidak ada stok FG (FG lahir
dari produksi).

**Tidak dibuat:** BoM Packing (belum ada master-nya), Jenis Perizinan,
dokumen apa pun, saldo awal.

## 3. Langkah kerja (setelah disetujui)

1. `scripts/lib/seed-common.ts` dari bagian umum `seed-showcase.ts`;
   `seed-showcase.ts` → `seed-makloon.ts` memakai lib itu, isi tidak berubah.
2. `seed-production-masters.ts` diselaraskan (UP8, line MIE, nama
   Workstation, Q1); tetap bisa dijalankan sendiri.
3. `scripts/seed-walet.ts` + script npm (lokal dan Neon).
4. Uji: `db:reset` → `db:seed-walet` dua kali (kedua kali tidak membuat apa
   pun) → `db:reconcile` hijau → buka Workspace Unit, BSTB Issue STK-0001 ke
   UGH sampai Terima.
5. Catat keputusan (P279) di `Claude-ERP.md` §6/§12 dan `Produksi Walet
   (Real).md`; `git_command.md` diperbarui.

## 4. Pertanyaan untuk user

| # | Pertanyaan | Rekomendasi |
| --- | --- | --- |
| Q1 | UCL **Kerja** dan UML **Job Order** belum dibangun (6.5, 6.6). Seed langkah artifact sekarang (barang berhenti di UCL) atau tetap shortcut sampai langkahnya dibangun? | **Tetap shortcut**, diganti saat 6.5 / 6.6 selesai, supaya alur bisa dicoba sampai UP5 |
| Q2 | Line Mie ikut di-seed? | **Ya**, artifact punya dua line |
| Q3 | Seed membuat user demo (Hendra, Dewi, Rina, Bagas, Sari) dengan password dev dan role-nya? | **Ya, lokal saja**: di Neon password diambil dari `.env.neon` seperti admin, atau dilewati bila tidak ada |
| Q4 | Item: BJL dapat dijual? Sarang perlu tanggal kadaluarsa? Karton punya konversi KRT? | BJL dijual, tanpa kadaluarsa, tanpa konversi |
| Q5 | `db:seed-showcase` / `db:fresh` lama: dihapus (diganti `-makloon`) atau tetap sebagai alias makloon? | **Diganti nama**, tanpa alias (lebih jelas ada dua) |
| Q6 | Neon: setelah dibangun, Neon di-reset dan diisi Walet (atau Makloon)? | Tanya lagi saat push; reset Neon perlu persetujuan |
