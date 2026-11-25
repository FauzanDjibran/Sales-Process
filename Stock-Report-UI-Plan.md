# Rencana — Laporan Stok mengikuti format Buku Subjek

> Status: **disetujui 20/11/2026** (keputusan K1–K6 di §4). Langkah 1–3 selesai (P297, P314). **Bentuk Kartu Stok dan Saldo Stok (§3.2–3.3) diganti `Stock-Position-Report-Plan.md` (P326).**
> Acuan: SIBA *Buku Subjek* / *Saldo Buku Subjek* (`subledger-report.tsx`,
> `subledger-balance-report.tsx`, `subject-params.tsx`) dan turunannya di ERP,
> *Buku / Saldo Piutang & Hutang* (`partner-book-report.tsx`, P233–P235).
> Yang diubah: Kartu Stok, Saldo Stok, Kartu Nilai Persediaan, Nilai Persediaan
> (`stock-card-reports.tsx`, `stock-reports.tsx`, `stock-report-params.tsx`,
> `inventory/report/[report]/page.tsx`).

## 1. Format Buku Subjek (yang dijadikan pola)

**Filter (header `.rfil`)**
- Subjek dipilih sebagai **chip** (`MultiSelect`), kosong = semua; ditulis ke URL (`partners=3,7`).
- Periode lewat **`PeriodRow`** bersama (pesan tanggal terbalik satu tempat, `INVALID_RANGE_HINT`).
- Pilihan yang mengubah *apa yang dibaca* (Buku: Piutang Usaha | Uang Muka) adalah **toggle `.dtog`** yang langsung pindah, bukan filter yang menunggu Tampilkan.
- *Tampilkan* di slot aksi header (`useReportRun`).

**Isi**
1. **Baris hitung `.rhead`**: `<b>n</b> partner · dd/mm/yyyy – dd/mm/yyyy`, lalu *Buka / Tutup Semua* (`ExpandAll`) bila lebih dari satu blok.
2. **Satu blok `.cblock` per subjek.** Header `.cbh` bisa diklik **dan** dari keyboard (`role=button`, `tabIndex`, `aria-expanded`, Enter/Spasi — P149): chevron · label tebal · `.cbn` nama · jumlah entri · **`ReportSummary` empat angka: Saldo Awal · Bertambah · Berkurang · Saldo akhir (key)**. Blok tidak pernah dijumlah lintas subjek.
3. **Buku** (mutasi): blok **tertutup** saat dibuka halaman (kecuali satu subjek); entri **dimuat saat blok dibuka, 100 per halaman** (`useLazyEntries`, `LazyRows`, keyset cursor — P221). Tabel: **Tanggal** (no. ledger di bawahnya, `.dstack`) · **Dokumen** (`DocLink`, perjanjian di bawahnya) · **Keterangan** (kejadian + catatan) · **Referensi** · **Bertambah** · **Berkurang** · **Saldo** berjalan. Baris `totrow` *Saldo per <awal>* di atas, `tfoot` *Saldo per <akhir>* dengan jumlah Bertambah / Berkurang. Baris kosong: *Tidak ada perubahan pada rentang tanggal ini.*
4. **Saldo** (posisi): blok **terbuka**; satu baris per item: Tanggal · Dokumen · Saldo Awal · Bertambah · Berkurang · **Saldo** (tebal); angka nol berupa `–`. Baris item menjumlah tepat ke header blok.
5. **Kosong**: `.empty sm` dengan ikon, *Belum ada posisi pada buku ini*, satu kalimat sebab.
6. Lebar tabel memakai `minWidth` dan menggulir di `.tw` (P149).

## 2. Keadaan laporan stok sekarang — selisihnya

| # | Laporan | Selisih dengan pola |
| --- | --- | --- |
| G1 | Semua | Filter punya baris tanggal sendiri, bukan `PeriodRow`; pesan galatnya disalin. *Kelompok* berupa `Select` yang menunggu Tampilkan, padahal ia mengubah cara baca (seperti toggle Buku). |
| G2 | Kartu Stok, Saldo Stok | Header blok (`BlockHead`) **tidak bisa dari keyboard** dan tanpa `aria-expanded`. |
| G3 | Kartu Stok | **Dua tingkat lipat** (blok → baris kartu → mutasi), tombol `Toggle` kecil terpisah dari klik header. Buku Subjek satu tingkat. |
| G4 | Kartu Stok | **Seluruh mutasi dikirim ke browser sekaligus** (`c.entries`), tanpa `LazyRows`; Buku Piutang memuat per blok saat dibuka. |
| G5 | Kartu Stok | Kolom terbalik dari buku: *Entri* menampilkan `MS/…·n` sebagai label dan dokumen kecil di bawahnya; Buku Piutang menaruh no. ledger di bawah Tanggal dan Dokumen sebagai tautan utama. Tidak ada **Keterangan** (jenis mutasi). Kolom Gudang berulang di setiap baris walau kartunya satu gudang. Saldo akhir ada di baris kartu, bukan `tfoot`. |
| G6 | Saldo Stok | Hanya **satu angka (Jumlah) per tanggal**; Saldo Piutang memberi empat angka per periode. Lot terlipat di bawah baris kartu (tingkat kedua). Blok mulai tertutup, Saldo Piutang terbuka. |
| G7 | Kartu Nilai Persediaan | **Satu barang saja** (`Combobox`), tanpa baris hitung, tanpa lipat, tanpa muat bertahap. Summary memakai *Nilai Awal / Nilai Akhir*, bukan *Saldo Awal / Saldo Akhir*. |
| G8 | Nilai Persediaan | Satu blok datar dengan satu barang opsional; tidak ada pengelompokan, tidak ada empat angka. Cek Buku Besar sudah baik (dipertahankan). |
| G9 | Semua | Peringatan *saldo tersimpan ≠ buku* di kaki halaman (`nbox`) — boleh tetap, karena cek stok bersifat global, bukan per blok. |
| G10 | Semua | Belum ada **Unduh XLSX** (Buku Piutang juga belum; Buku Kas & Bank sudah, P221). |

## 3. Bentuk tujuan

**Kata.** Stok memakai **Masuk / Keluar** di tempat Bertambah / Berkurang — arah stok selalu sama, dan itulah kata gudang (seperti Kas & Bank memakai Penerimaan / Pengeluaran, P17). Header blok tetap empat angka: **Saldo Awal · Masuk · Keluar · Saldo Akhir**.

### 3.1 Bersama
- Pindahkan `SubjectHead`, `CountLine`, `Empty` dari `partner-book-report.tsx` ke `components/report/report-blocks.tsx`, generik atas label/nama/angka. Partner book dan stok memakai yang sama (satu salinan, tidak ada drift).
- `StockReportParams` memakai `PeriodRow`; *Kelompok* menjadi `.dtog` *Per Barang | Per Gudang* yang langsung pindah (pola `BookToggle`), di baris pertama sebelum chip — sama letaknya dengan *Buku* di Buku Piutang.
- Kartu Nilai Persediaan dan Nilai Persediaan mendapat **chip Barang** (`items=`), kosong = semua; `item=` lama tetap dibaca agar tautan lama tidak putus.

### 3.2 Kartu Stok = Buku Piutang
- **Satu blok = satu kartu barang × gudang** (satu satuan, jadi empat angka selalu bisa dijumlah). *Kelompok* hanya mengurutkan blok dan memberi judul kelompok tipis (`.rgrp`, nama barang atau gudang) — lihat K1.
- Header: label barang · `.cbn` nama · gudang · satuan · *n mutasi* · Saldo Awal / Masuk / Keluar / Saldo Akhir.
- Mutasi dimuat saat blok dibuka (`loadStockCardEntries` di `app/actions/book-entries.ts`, cursor `BookCursor`), saldo berjalan per kartu dari saldo awal + agregat sebelum halaman (seperti halaman ledger, P221).
- Kolom: **Tanggal** (`MS/…·n` di bawah) · **Dokumen** (`DocLink`) · **Keterangan** (Penerimaan, Pengiriman, BSTB Issue, Injeksi, Retur…) · **Lokasi** · **Lot** (kadaluarsa, status ≠ Tersedia) · **Masuk** · **Keluar** · **Saldo**. Kolom Gudang hilang (ada di header). `totrow` awal, `tfoot` akhir.

### 3.3 Saldo Stok — bentuk Saldo Piutang, tetap *Per Tanggal*
- Tetap **satu tanggal** (K2); karena itu header blok memberi satu angka, **Jumlah**, bukan empat.
- **Satu tingkat lipat** (K1): baris kartu yang menyembunyikan lot dihapus.
- Per Barang: blok per barang (header Jumlah, satu satuan), **satu baris per bucket** — Gudang · Lokasi · Lot · Kadaluarsa / status · Jumlah. Blok **terbuka**.
- Per Gudang: blok per gudang, baris per barang × bucket dengan kolom Barang dan Satuan; header hanya **jumlah barang** (satuan berbeda tidak dijumlah, P135).
- Kode barang (Per Gudang) atau gudang (Per Barang) di baris membuka Kartu Stok-nya (`Drill`, sudah ada).

### 3.4 Kartu Nilai Persediaan = Buku, satu blok per barang
- Chip Barang, satu blok per pool (barang, seluruh gudang), tertutup kecuali satu, mutasi dimuat saat dibuka.
- Header: Saldo Awal · Masuk · Keluar · Saldo Akhir **dalam rupiah**, qty di `.cbn`.
- Kolom: Tanggal (`MN/…`) · Dokumen · Keterangan · Qty · Nilai · Saldo Qty · Saldo Nilai · Rata-rata. *Harga Satuan* dihapus dari baris (turunan, P213; rata-rata tetap).

### 3.5 Nilai Persediaan — tetap satu tabel, filter Barang
- Tetap **Per Tanggal** (K2) dan **tanpa pengelompokan** (K4): satu blok, baris per barang (Barang · Satuan · Jumlah · Rata-rata · Nilai), header Total Nilai · Buku Besar · Selisih seperti sekarang.
- Yang berubah hanya filternya: **chip Barang** (kosong = semua) dengan baris hitung `.rhead` (*n barang · per dd/mm/yyyy*) dan tampilan kosong bersama. Pencocokan Buku Besar tetap hanya untuk seluruh barang.

### 3.6 Unduh XLSX — ditunda (K5)
Nanti keempatnya mendapat `exportHref` lewat route `inventory/report/[report]/export`, pola `book-export.ts` (P219, P221).

## 4. Keputusan user (20/11/2026)

| # | Pertanyaan | Keputusan |
| --- | --- | --- |
| K1 | Kartu Stok: blok = kartu barang × gudang, atau kartu bersarang? | **Kartu per blok; tidak ada lagi dua tingkat lipat** di laporan stok mana pun. Mengubah P135 untuk Kartu Stok (Kelompok hanya mengurutkan dan memberi judul blok). |
| K2 | Saldo Stok dan Nilai Persediaan memakai periode? | **Tetap Per Tanggal.** |
| K3 | Kata pergerakan? | **Masuk / Keluar.** |
| K4 | Nilai Persediaan dikelompokkan per Kategori Item? | **Tidak; konsepnya tetap filter Barang.** |
| K5 | Unduh XLSX? | **Nanti**, di luar rencana ini. |
| K6 | Laporan Produksi diseragamkan? | **Nanti**, menyusul. |

## 5. Langkah bangun

1. **Bersama** — `report-blocks.tsx`, partner book memakainya (tanpa perubahan tampilan), `StockReportParams` dengan `PeriodRow` dan toggle Kelompok, header blok stok bisa dari keyboard. *Tanpa perubahan angka.* **Selesai 20/11/2026 (P297).**
2. **Kartu Stok** — blok per kartu, loader bertahap + rollup dari SQL, kolom 3.2. **Selesai 23/11/2026 (P314).**
3. **Saldo Stok** — satu tingkat lipat, baris per bucket, tetap per tanggal. **Selesai 23/11/2026 (P314).**
4. **Kartu Nilai Persediaan** — chip, blok per barang, loader bertahap.
5. **Nilai Persediaan** — chip Barang, baris hitung, tampilan kosong bersama.

Tiap langkah: `npm run build`, `lint`, `test`; `ui-audit` dengan **Buku Piutang** sebagai layar acuan; Kartu Stok dan Kartu Nilai masuk `DOCUMENT_SCREENS`-setara di `tests/design-system.test.ts` bila polanya diuji di sana; angka dibandingkan dengan laporan lama pada data yang sama (`db:reconcile` tetap hijau). Setiap langkah yang jadi dicatat sebagai P-baru di `Claude-ERP.md` §12.
