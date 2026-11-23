# Rencana — Laporan Stok Produksi mengikuti Kartu Stok & Saldo Stok

> Status: **disetujui user 23/11/2026** (D1–D8 sesuai rekomendasi, P310). Langkah 0 selesai; sisanya belum dibangun.
> Melanjutkan K6 `Stock-Report-UI-Plan.md` ("laporan produksi menyusul").
> Tetap berlaku: tanpa harga di aplikasi Produksi (P275), satu tingkat lipat (K1),
> Masuk / Keluar (K3), Per Tanggal untuk saldo (K2), jumlah barang berbeda tidak dijumlah (P135).

## 1. Padanan konsep

| Stok | Produksi |
| --- | --- |
| Gudang | Unit |
| Lokasi | Tahap (Persiapan proses, Sedang Dikerjakan, QC Check, Stand By, Dalam Perjalanan) |
| Lot | No. Stok, ditambah Partai dan No. Job |
| Status (Tersedia, …) | Tanda: Balik QC, Bahan Penolong |
| `log_stock_ledger` | `prd_ledger` (baris bertanda, append-only, punya `item_id`, `unit_id`, `stage`) |
| Kartu = barang × gudang | Kartu = **barang × Unit** |

Bukunya sudah sebentuk. Tidak perlu skema, posting atau izin data baru.

## 2. Keadaan sekarang

| # | Laporan | Temuan |
| --- | --- | --- |
| A1 | Saldo Produksi | **Angka tanggal lampau bisa salah.** Dibaca dari `qty_balance` baris terakhir menurut tanggal; saldo itu mengikuti urutan posting, sehingga mutasi bertanggal mundur membuatnya meleset. Saldo Stok menjumlah `qty_change`, jadi benar. Di data lokal belum terjadi (0 dari 1.168 baris). |
| A2 | Saldo Produksi | Hanya per Unit; tidak ada filter Barang atau Partai. *Di mana barang atau partai ini?* tidak terjawab, padahal `plan-implementasi-produksi.md` menu 21 meminta Per Partai. |
| A3 | Saldo Produksi | Partai, Balik QC dan Bahan Penolong tidak ditampilkan; bahan penolong bercampur dengan barang yang dikerjakan. |
| A4 | Saldo Produksi | Kartu selalu terbuka, tanpa baris hitung, tanpa lipat, tanpa jumlah. UP5 sekarang satu tabel 191 baris. |
| A5 | — | **Tidak ada kartu mutasi per Unit.** *Berapa masuk, keluar dan sisa di Unit ini selama periode?* tidak terjawab di laporan mana pun. |
| A6 | Kartu No. Stok | Kolom Qty bertanda (bukan Masuk / Keluar), tanpa saldo awal / akhir, dokumen bukan tautan. Kolom *Saldo* adalah saldo satu tempat (Unit, tahap, Job), berganti tiap baris, sehingga tidak terbaca sebagai saldo No. Stok. |
| A7 | Kartu No. Stok | Bagian *Di Stok* tanpa saldo. Di buku, bagian No. Stok bisa berada di beberapa tempat sekaligus, jadi satu angka "Saldo" tanpa menyebut tempatnya menyesatkan. |
| A8 | Telusur | Silsilah, bukan laporan saldo. **Bentuknya tidak perlu diseragamkan.** |

## 3. Yang khas produksi — tidak boleh ditiru mentah

1. **Perpindahan tahap bukan masuk atau keluar Unit.** Satu Kerja menulis dua baris di Unit yang sama. Dari 1.168 baris lokal, 458 (39 %) hanya perpindahan di dalam Unit. Bila semuanya dijumlah, Masuk dan Keluar menggembung dan tidak berarti.
   → Kartu menetokan per **tanggal · dokumen · No. Stok** di satu Unit; yang nol tidak tampil. Data lokal: 1.168 baris menjadi 696.
   → Saldo akhir tidak berubah oleh penetoan; hanya Masuk / Keluar.
2. **Transformasi nyata tetap tampil.** Grading memakai No. Stok A dan melahirkan A-1, A-2: A Keluar, A-1 dan A-2 Masuk, sering dengan Barang lain. Karena itu Masuk − Keluar per Barang di Unit benar, dan susut terlihat di Unit tetapi tidak di satu kartu Barang.
3. **Satuan.** Gram sampai Barcoding, pcs sesudahnya. Header Per Unit dan Per Partai hanya menyebut jumlah Barang / baris, tidak menjumlah gram.
4. **Dalam Perjalanan dihitung di Unit pengirim** sampai Terima (T4), jadi termasuk saldo Unit itu dan ditandai.

## 4. Bentuk tujuan

### 4.1 Saldo Produksi = Saldo Stok
- **Kelompok** (`.dtog`, langsung pindah): **Per Unit | Per Barang | Per Partai**. Filter chip Unit, Barang, Partai; Per Tanggal; centang *Sertakan Bahan Penolong* (bawaan mati).
- Baris hitung + *Buka / Tutup Semua*; satu blok per Unit / Barang / Partai; satu tingkat lipat.
- Header blok: Per Barang **Jumlah** (satu satuan); Per Unit dan Per Partai **jumlah Barang**. Barang tanpa partai masuk blok *Sebelum Partai*.
- Baris per saldo: Barang / Unit · Tahap · Partai · No. Job · No. Stok (tanda Balik QC, Bahan Penolong) · Jumlah, urut tahap.
- Kode Barang atau Unit membuka Kartu Produksi bulan berjalan; No. Stok membuka Kartu Produksi dengan No. Stok itu terpilih.
- **Sumber: Σ `qty_change` sampai tanggal per bucket** (memperbaiki A1).

### 4.2 Kartu Produksi = Kartu Stok, dan memuat Kartu No. Stok (user 23/11/2026)
Satu laporan. **Menu Kartu No. Stok hilang; menjadi pilihan No. Stok di Kartu Produksi.** Sumbernya sama (`prd_ledger`).

- **Kelompok**: Per Unit | Per Barang | **Per No. Stok**. Filter Unit, Barang, **No. Stok**, periode (`PeriodRow`).
- **Filter No. Stok**: ketik atau scan lalu Enter menjadi chip, boleh beberapa. Dicari di server; daftar keping terlalu banyak untuk dikirim ke browser. Nomor yang tidak ada ditolak di isiannya.
- **Memilih No. Stok** memindahkan Kelompok ke Per No. Stok dan periode ke seluruh hidupnya (mutasi pertama sampai hari ini); keduanya tetap bisa diubah.
- Per Unit / Per Barang: satu blok per Barang × Unit. Per No. Stok: satu blok per No. Stok melintasi semua Unit, dengan Barang, asal, supplier, kadaluarsa, *Sekarang di* (Unit · Tahap · jumlah) dan tombol Telusur di kepalanya; wajib memilih No. Stok, Barang atau Unit agar tidak membuka semuanya.
- Kepala blok: **Saldo Awal · Masuk · Keluar · Saldo Akhir**; tertutup kecuali hanya satu; mutasi dimuat saat dibuka, 100 per halaman.
- Kolom: Tanggal (`MP/…` di bawah) · Dokumen (tautan) · Keterangan (Dari gudang, Dari UGH, Ke UPC, Dipakai grading, Hasil grading, Ke gudang) · Unit (hanya Per No. Stok) · No. Stok (selain Per No. Stok) · Partai / No. Job · Masuk · Keluar · Saldo.
- Baris dinetokan (§3.1). Pindah Unit pada Per No. Stok tampil sebagai satu baris *UGH → UPC* tanpa Masuk / Keluar, karena barangnya tidak bertambah atau berkurang.
- Centang **Tampilkan perpindahan tahap** (bawaan mati; menyala saat No. Stok dipilih): baris *Persiapan → Stand By* tanpa Masuk / Keluar. Saldo dan total tidak berubah, jadi rincian Kartu No. Stok lama tidak hilang.
- Tanpa Nilai.

**Yang dilepas:** tabel *Di Stok* (mutasi gudang). Batas produksi tetap terlihat (*Dari gudang*, *Ke gudang*, bertaut ke dokumennya), posisi sekarang di gudang atau terkirim ada di Telusur, mutasi gudang ada di Kartu Stok ERP. Yang tidak ada lagi: riwayat gudang satu No. Stok, karena Kartu Stok belum punya filter Lot (D8).

**Izin dan tautan:** `REPORT_LOT_CARD_VIEW` diganti nama di tempat menjadi `REPORT_PRODUCTION_CARD_VIEW`, role yang memegangnya tetap. Alamat lama `lot-card?q=…` dialihkan; tautan No. Stok di Saldo Produksi dan Telusur menuju Kartu Produksi dengan No. Stok itu terpilih.

### 4.3 Tidak diubah
Telusur; laporan stok Persediaan; nilai WIP (menyusul di ERP bersama Closing).

## 5. Langkah

| # | Isi | Besar |
| --- | --- | --- |
| 0 | **Perbaiki A1** dan satu tes mutasi bertanggal mundur | **selesai (P310)** |
| 1 | `Stock-Report-UI-Plan.md` langkah 2–3 (Kartu Stok dan Saldo Stok ke bentuk satu tingkat) — pola yang dipakai ulang | sedang |
| 2 | Saldo Produksi (§4.1) | sedang |
| 3 | Kartu Produksi dengan pilihan No. Stok, dan Kartu No. Stok dihapus (§4.2) | sedang |

Langkah 1 lebih dulu: Kartu Stok hari ini masih dua tingkat lipat dan mengirim semua mutasi ke browser; menirunya sekarang berarti membangun dua kali. Pada beban produksi (satu keping satu No. Stok sesudah Barcoding), pemuatan bertahap wajib untuk kartu. Bagian isi Saldo juga perlu dibatasi per blok bila satu Unit memegang ribuan keping; angka header tetap dari agregat.

Cek: Σ kartu = Saldo Produksi per Barang × Unit; saldo awal + masuk − keluar = akhir; saldo hari ini = `prd_balance`; kedua kelompok berisi baris yang sama; tes yang ada (`production-report.test.ts`) disesuaikan.

## 6. Keputusan user

| # | Pertanyaan | Rekomendasi |
| --- | --- | --- |
| D1 | Kartu Produksi dan Kartu No. Stok | **Diputuskan user 23/11/2026: satu laporan**; No. Stok menjadi pilihan di Kartu Produksi |
| D2 | Masuk / Keluar hanya yang melintasi Unit atau mengubah No. Stok (perpindahan tahap dinetokan, terlihat lewat centang)? | **Ya** |
| D3 | Kelompok Per Partai di Saldo Produksi? | **Ya** — sudah ada di rencana menu 21 |
| D4 | Bahan penolong disembunyikan dulu, lewat centang? | **Ya** |
| D5 | Tabel *Di Stok* dilepas dari laporan produksi? | **Ya** |
| D6 | Kartu Stok & Saldo Stok (langkah 1) dirampungkan lebih dulu? | **Ya** |
| D7 | Laporan dibatasi Unit milik user (P260 sengaja belum)? | **Belum** — PPIC dan QC perlu melihat lintas Unit |
| D8 | Filter Lot di Kartu Stok ERP, supaya riwayat gudang satu No. Stok tetap bisa dibaca? | **Ya**, bersama langkah 1 |
