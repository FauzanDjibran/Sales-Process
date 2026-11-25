# Rencana — Laporan Stok Gudang dan Produksi: dua tingkat, tempat dan barang

> Status: **dibangun 25/11/2026 (P326)**, mengikuti arahan user §1.
> Mengganti bentuk di `Stock-Report-UI-Plan.md` §3.2–3.3 dan `Production-Report-Plan.md` §4.1–4.2.
> Tetap: Per Tanggal untuk saldo (K2), Masuk / Keluar (K3), tanpa harga di Produksi (P275),
> Kartu Nilai Persediaan, Nilai Persediaan dan Telusur tidak disentuh.
> Tanpa perubahan skema, posting, izin, atau menu.

## 1. Aturan (user, 25/11/2026)

1. Fokusnya **barang apa ada di mana** dan **di mana ada apa**.
2. **Toggle tetap ada di keempat laporan, isinya hanya Per Barang | Per Tempat** (Gudang atau Unit). Tidak boleh yang lain.
   - **Per Barang**: tingkat 1 barang, tingkat 2 ada di tempat mana saja.
   - **Per Gudang / Per Unit**: tingkat 1 tempat, tingkat 2 barangnya apa saja.
3. **Paling banyak dua tingkat.** Tanpa judul kelompok (`.rgrp`) di atas blok, tanpa sub-baris.
4. **Informasi tambahan menjadi kolom**: lokasi, langkah Unit (Proses), tahap, No. Stok, kadaluarsa, status, partai, job. Tidak menjadi tingkat dan **tidak masuk ringkasan kepala blok**.
5. **Ringkasan kepala blok hanya tentang subjek tingkat 1**: barang, Unit, atau gudang.
6. **Gudang**: No. Stok lewat centang *Tampilkan No. Stok* (bawaan mati, hanya di Saldo Stok). **Produksi**: No. Stok selalu tampil.
7. **Produksi**: perpindahan per tahap terbaca dari kolom tahap.

Mockup: https://claude.ai/artifact/GbqjXRFNJ3prYT4EfzH9Jc

## 2. Temuan

| # | Sekarang | Akibat |
| --- | --- | --- |
| T1 | Kelompok juga berisi Per Partai (Saldo Produksi) dan Per No. Stok (Kartu Produksi) | Toggle bukan lagi barang / tempat |
| T2 | Saldo Stok selalu satu baris per lot | Jumlah barang per gudang tidak tampil |
| T3 | Kartu Stok dan Kartu Produksi: `.rgrp` → blok → baris | Tiga tingkat |
| T4 | Saldo Produksi: tahap berupa teks per baris | Tidak ada jumlah per tahap |
| T5 | Kartu Produksi per Barang × Unit | Grading pecah ke beberapa kartu; susut tidak terlihat |
| T6 | Pindah tahap = teks di balik centang, Masuk / Keluar kosong | Perpindahan tidak bisa dijumlah; data lokal 237 baris |

## 3. Gudang

### 3.1 Saldo Stok

Filter: toggle, Barang, Gudang, Per Tanggal, centang Tampilkan No. Stok (`showLots=1`).

| | Per Barang | Per Gudang |
| --- | --- | --- |
| Kepala blok | Jumlah (satu satuan) | banyaknya Barang (P135: barang berbeda tidak dijumlah) |
| Kolom | Gudang · Lokasi · Jumlah · Satuan | Barang · Lokasi · Jumlah · Satuan |

- Baris = barang × gudang × lokasi. Bila ada stok bukan Tersedia, kolom **Tidak Tersedia** muncul di semua blok.
- Dicentang: baris per No. Stok × lokasi × status, dengan kolom No. Stok · Kadaluarsa · Status. Tanpa centang, lot tidak dibaca.
- Kolom sejajar antar blok. Baris membuka Kartu Stok barang × gudang itu.

### 3.2 Kartu Stok

Baris = mutasi. Kolom: Tanggal · Dokumen · No. Ledger · Keterangan · **Gudang atau Barang** · Lokasi · No. Stok · Kadaluarsa · Status (bila ada) · Masuk · Keluar · Saldo.

- **Per Barang**: kepala Saldo Awal · Masuk · Keluar · Saldo Akhir, melintasi gudang terpilih. Pindah gudang terhitung di Masuk dan Keluar; saldo akhirnya tetap benar.
- **Per Gudang**: kepala hanya banyaknya Barang; kolom *Saldo Barang* berjalan per barang.

## 4. Produksi

### 4.1 Saldo Produksi

Filter: toggle, Unit, Barang, Partai, Per Tanggal, Sertakan Bahan Penolong.

| | Per Barang | Per Unit (urut routing) |
| --- | --- | --- |
| Kepala blok | Jumlah | banyaknya Barang · Jumlah per satuan |
| Kolom pertama | Unit | Barang |

Kolom berikutnya sama: No. Stok · **Proses** · Partai · No. Job · Tanda (Balik QC, Bahan Penolong) · Persiapan · Dikerjakan · QC · Stand By · Dalam Perjalanan · Tujuan · Jumlah · Satuan.

- Lima kolom tahap yang tetap; langkah Unit menjadi kolom **Proses**, jadi UML (tiga proses) tidak melebar. Kolom kosong di blok itu tidak digambar.
- Jumlah per tahap di kaki tabel, tidak di kepala.
- Baris digambar 100 per halaman di browser; seluruh baris tanggal itu masih dikirim sekaligus seperti sebelumnya (ditandai `shortcut:` di kode).

### 4.2 Kartu Produksi

Filter: toggle, Unit, Barang, No. Stok, periode. Memilih No. Stok menampilkan perjalanan No. Stok itu (filter, bukan toggle). Tanpa centang perpindahan tahap.

Baris = tanggal × dokumen × No. Stok × Unit. Kolom: Tanggal · Dokumen · Keterangan · **Barang atau Unit** · No. Stok · Proses · Partai · No. Job · lima tahap (mutasi bertanda) · Masuk · Keluar · Susut (Per Unit) · Satuan (bila lebih dari satu).

- **Masuk / Keluar = melintasi batas Unit** (`Issued`, `TransferIn`, `Released`, `TransferOut`). Pindah tahap dan transformasi hanya di kolom tahap. Mengubah P310 D2.
- **Susut** = −Σ (`Consumed` + `Produced`) per dokumen di satu Unit, tanpa bahan penolong, di baris terakhir dokumen; kosong bila dokumen memakai lebih dari satu satuan, yang dihitung sebagai *Ubah satuan* di kepala Unit.
- **Kepala Per Unit**: Masuk · Keluar · Susut · Saldo Akhir. **Kepala Per Barang**: Saldo Akhir saja, karena transformasi membuat Masuk / Keluar antar Unit tidak berarti untuk satu barang.
- Per Unit: awal + Masuk − Keluar − Susut + Ubah satuan = akhir, per satuan. Tiap kolom tahap: awal + Σ = akhir = Saldo Produksi tanggal itu.
- Yang masuk dan keluar tahap dalam satu dokumen dinetokan; tahap yang dilewati ditulis di Keterangan.
- **Lebar**: pada 1.400 px sebagian besar kartu muat dengan kolom rapat; UDB dan kartu Per Barang BJL-S masih menggulir sedikit.

## 5. Perubahan kode

| Berkas | Isi |
| --- | --- |
| `stock-report.ts` | `stockBalanceReport` per barang × gudang × lokasi; lot hanya saat dicentang. Kartu Stok: subjek barang **atau** gudang |
| `stock-card-reports.tsx` | Badan dua tingkat; `.rgrp` dihapus |
| `stock-report-params.tsx` | Toggle tetap; centang Tampilkan No. Stok (hanya Saldo Stok) |
| `production-report.ts` | `wipBalanceReport`: rollup per Unit × tahap × satuan + halaman baris per Unit; filter No. Stok. Kartu: subjek `unit_id` atau `item_id`, bukan keduanya, jumlah per (tahap, langkah), masuk / keluar, susut. **Butir barisnya tetap** (tanggal · dokumen · No. Stok · Unit), jadi cursor lama dipakai |
| `production-card-reports.tsx`, `production-report-params.tsx` | Badan dan filter baru; toggle hanya unit dan item di kedua laporan; centang tahap dihapus |
| `book-entries.ts` | Loader kartu tanpa `stages`; loader baru untuk isi Saldo Produksi |
| dua `report/[report]/page.tsx` | Nilai `group` selain barang / tempat, dan `stages`, **diabaikan**, bukan galat |
| `reports.ts`, `nav.ts` | Deskripsi saja; alamat tetap |
| `scripts/db-map.ts` | Pembaca baru |
| Tes | `inventory`, `warehouse-location`, `production-report` disesuaikan |

## 6. Langkah

| # | Isi | Cek selesai |
| --- | --- | --- |
| 0 | Mockup empat layar dengan data nyata, disetujui user | — |
| 1 | Saldo Stok dan Kartu Stok | Σ baris = kepala; kedua arah berisi baris yang sama; Saldo Stok = saldo akhir Kartu Stok |
| 2 | Saldo Produksi | Σ tahap = Jumlah; hari ini = `prd_balance` |
| 3 | Kartu Produksi | Dua persamaan §4.2; UGH 23/11/2026 di data lokal menjadi tes; mutasi bertanggal mundur; halaman memotong dokumen (susut tetap benar) |
| 4 | Dokumen: P-baru di `Claude-ERP.md`, `Production-Process.md`, pengecualian KB di `KNOWLEDGE.md` (§7 D2), `ui-audit`, uji dengan `db:seed-walet-ledger` | — |

Langkah 1, 2 dan 3 bisa rilis sendiri-sendiri; 3 sesudah 2.

Risiko: kecepatan kartu satu Unit di beban 100.000 baris per bulan. `prd_ledger` hanya punya BRIN di `posting_date` dan indeks `bucket_id, posting_date`, tidak ada indeks `unit_id`. Diukur di langkah 3; bila lambat, lewat `bucket_id` Unit itu sebelum menambah indeks.

## 7. Keputusan user

| # | Pertanyaan | Rekomendasi |
| --- | --- | --- |
| D1 | KB `stock-books` §5.2 | **Gugur**: toggle Per Barang / Per Tempat sesuai aturan itu (*grouped either way*); KB tidak berubah |
| D2 | KB §5.3 (*"Quantities of different items are never added up"*): di Produksi gram barang berbeda dijumlah per Unit, per tahap dan untuk susut | **D disetujui**: pengecualian Produksi, hanya satuan sama |
| D3 | Masuk / Keluar hanya melintasi Unit (mengubah P310 D2) | **Ya** |
| D4 | Kelompok Per Partai dilepas; partai jadi filter dan kolom (mengubah P310 D3) | **Ya** |
| D5 | Kartu Stok: selalu menampilkan No. Stok (centang hanya di Saldo Stok) | **Ya**, kartu dibaca untuk memeriksa mutasinya |
| D6 | Dalam Perjalanan tetap di Unit pengirim (T4) | **Ya** |
