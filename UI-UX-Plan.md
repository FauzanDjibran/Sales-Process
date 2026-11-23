# Rencana Standarisasi UI/UX — Aplikasi ERP

> Disusun 23/11/2026 dari [UI-UX-Evaluasi-ERP.md](UI-UX-Evaluasi-ERP.md) dan
> jawaban user. **T1–T6 dibangun 23/11/2026 (P308)**; sisanya belum. Kode temuan (F, L, D,
> S, R, M) merujuk ke dokumen evaluasi.

## 1. Arahan user

| # | Arahan | Artinya di rencana ini |
| --- | --- | --- |
| U1 | Tidak ada tombol sambungan dulu; tiap dokumen dari menunya sendiri | Alur tersambung (F1) tidak dikerjakan. Enam tombol yang sudah ada: lihat T1 |
| U2 | Dokumen sumber selalu dicantumkan bila dirujuk | Aturan **Dokumen Sumber** (langkah 3.3) |
| U3 | Tombol simpan & ajukan langsung | Langkah 3.5 |
| U4 | Dashboard dikosongkan dulu | Langkah 1.6 |
| U5 | Kolom penting disusun ulang sesuai rekomendasi | Langkah 2.3 |
| U6 | Bahasa bersama → daftar seragam → struktur form → laporan & pengaturan | Tahap 1–4 |
| U7 | Form = header, lalu tab, lalu audit; satu bagian pun tetap tab | Tahap 3; **mengubah P38** ("form with one section has no tabs") |

**Lingkup:** Dashboard, Penjualan, Pembelian, Persediaan, Finance, Accounting,
Master, Pengaturan. **Tidak disentuh:** aplikasi Produksi, ERP › Produksi,
Master › Produksi, Pajak.

**Tidak berubah:** database, perhitungan, posting, journal, nomor, hak akses,
URL, dan status yang tersimpan. Tidak ada migrasi. Yang berubah hanya label,
susunan, dan komponen tampilan.

**Catatan lingkup komponen bersama.** Master dan form generik memakai komponen
yang sama dengan Master › Produksi, Standard Cost, BoM Packing dan Jenis Biaya;
label serta bentuk tab-nya ikut berubah. Layar aplikasi Produksi tidak.

---

## 2. Gambaran hasil

**Daftar**
```
Penjualan / Customer Order
[ikon] Customer Order                                  [+ Buat Customer Order]
Satu kalimat: isi daftar ini.
┌──────────────────────────────────────────────────────────────────────────┐
│ [Cari…] [Status: semua] [Periode] [Partner]  Bersihkan filter (1)           12 dari 40 dokumen │
│ No  Nomor  Status  Tanggal  Partner  Dokumen Sumber  …  Nilai  Pembayaran  👁 ✎ ⋯ │
│ Halaman 1 dari 2 · Tampil 25 · « ‹ 1 › »                                   │
└──────────────────────────────────────────────────────────────────────────┘
```

**Form / halaman dokumen**
```
Penjualan / Customer Order / CO/2026/11/0001
[ikon] CO/2026/11/0001  [DRAFT] [MODE UBAH]   [Batal] [Simpan Draft] [Simpan & Ajukan]
┌ HEADER ──────────────────────────────────────────────────────────────────┐
│ Dokumen Sumber │ Partner │ Tanggal & syarat │ Harga & Pajak │ Catatan       │
└──────────────────────────────────────────────────────────────────────────┘
┌ TAB ─────────────────────────────────────────────────────────────────────┐
│ ▣ Barang 3 │ Jadwal Sales Order │ Dokumen Terkait 2                         │
│ tabel baris … + kotak nilai                                                │
└──────────────────────────────────────────────────────────────────────────┘
┌ RIWAYAT (audit) ─────────────────────────────────────────────────────────┐
```

---

## 3. Tahap 1 — Bahasa bersama

Hasil: kata, warna, ikon, dan tombol yang sama artinya selalu sama bentuknya.

| Langkah | Yang dilakukan | Temuan |
| --- | --- | --- |
| **1.1 Peta status** | Label dan warna semua status dibaca dari **satu peta** yang sudah ada (`STATUS_TEXT` / `STATUS_CLASS` di `entities.ts`). Peta di tiap `*-workflow.ts` ERP dihapus. Kode status di database tetap | S1–S3, S5 |
| **1.2 Istilah** | Tabel di bawah, di menu, judul, kolom, pesan, konfirmasi dan toast. Teks yang sudah tertulis di journal dan riwayat tidak diubah | S4, D7 |
| **1.3 Tombol** | Dokumen **Buat \<nama lengkap\>**; master **Tambah \<nama\>**; baris **Pilih \<sumber\>** (dari dokumen) atau **Tambah Item** (dari master), selalu netral berikon `+`; tutup **Tutup**; posting **Posting** | L5, D6 |
| **1.4 Lencana** | Pekat hanya untuk status. Kena PPN, Terjadwal, Penagihan, Pengiriman menjadi tag tipis | D8 |
| **1.5 Header** | Breadcrumb selalu `Modul / Menu / Nomor`; subjudul satu kalimat ≤ 90 karakter (aturan posting pindah ke konfirmasi yang sudah menyebutnya); judul master = nama + chip label + kode; ikon Produksi di rail bukan gerigi | L9, M1, M5, D12 |
| **1.6 Dashboard** | Halaman tetap ada, isinya kosong: judul dan satu kalimat netral; teks usang dihapus | U4, F4 |

**Istilah baku**

| Dipakai | Menggantikan |
| --- | --- |
| Diposting / Posting | Posted / Post |
| Open | Disetujui (Pengajuan Perizinan) |
| Diterbitkan (hijau), aksi Terbitkan | Diterbitkan biru; aksi *Catat* di Uang Muka Pembelian |
| Tutup | Tutup Pesanan |
| Delivery Note | Surat Jalan (di layar; No. Surat Jalan Supplier tetap) |
| Kas & Bank | Cash & Bank, Cash Bank |
| Lot | No. Lot, No. Stok — kecuali layar BSTB yang berasal dari Produksi (P254) |
| Kena PPN, Mode Harga, Termin Pembayaran | PPN, Termin |

**Selesai bila:** tes baru menolak peta status di luar peta bersama dan menolak
istilah lama di layar ERP; semua konfirmasi terbaca benar.
**Ukuran:** 2 hari.

---

## 4. Tahap 2 — Daftar seragam

Hasil: semua daftar dokumen memakai satu komponen; daftar baru otomatis sama.

| Langkah | Yang dilakukan | Temuan |
| --- | --- | --- |
| **2.1 `DocumentRegister`** | Satu komponen dari potongan yang sudah ada (`DocumentHeader`, `SearchField`, `Pager`, `use-register-params`): header, toolbar, tabel, halaman kosong. Tiap daftar hanya memberi kolom dan data | L2 |
| **2.2 Perilaku baku** | **Status selalu dropdown, tanpa tab status di mana pun** (tab BSTB dan Transfer Kirim / Terima kembali menjadi filter); cari; **Periode** dan **Partner**; **Pembayaran** pada tagihan; `Bersihkan filter (n)`; "N dari M dokumen"; filter tersimpan di URL; kosong selalu bertombol bila user berizin | L4, L7, L8, L11, F5, F6 |
| **2.3 Kolom** | Urutan baku dan tabel di bawah; kolom Nomor dikunci di kiri, aksi di kanan bila tabel digeser | L1, L6, U5 |
| **2.4 Aksi baris** | 👁 lihat · ✎ ubah (Draft) · ⋯ langkah lifecycle, membuka konfirmasi yang sama dengan halaman dokumen | L3, A2 |
| **2.5 Pindahkan daftar** | Per modul: Penjualan (5) → Pembelian (4) → Persediaan (7) → Finance (10) → Accounting (Journal, Opening Balance) | — |
| **2.6 Daftar lain** | User dan Role: cari, filter, urut seperti master; ▲ hanya saat disorot; gudang tanpa lokasi satu baris; Saldo Kas & Bank ringkas satu baris di Penerimaan, Pengeluaran dan Transfer | L8, L10, L12, M8 |

**Urutan baku:** No · Nomor · Status · Tanggal · Partner · Dokumen Sumber ·
kolom khas · Nilai · Pembayaran · aksi.

| Daftar | Dokumen Sumber | Kolom khas | Nilai |
| --- | --- | --- | --- |
| Customer Order | No. PO customer | Baris | Nilai |
| Sales Order | CO | Tanggal Kirim · Baris | — |
| Delivery Order | CO | Tanggal Kirim · Gudang · Baris | — |
| Sales Return | CO | Alasan · Baris | — |
| Pengajuan Perizinan | No. PO customer | Produk | Nilai |
| Purchase Request | — (Partner: Peminta) | Dibutuhkan · Gudang · Baris | — |
| Purchase Order | PR | Tanggal Kirim · Baris | Nilai |
| Receipt Note | PO / Sales Return | Gudang · Baris | Nilai |
| Delivery Note | DO | Gudang · Baris | HPP |
| BSTB Issue | — | Gudang → Unit · Baris | Nilai ke WIP |
| BSTB Finish Goods / Pengeluaran | — | Unit → Gudang · Baris · Qty | — |
| Transfer Kirim | — | Gudang Asal → Tujuan · Baris | — |
| Transfer Terima | Transfer Kirim | Gudang Asal → Tujuan · Baris | — |
| Uang Muka (Penjualan, Perizinan, Pembelian) | CO / Pengajuan / PO | Jatuh Tempo (di bawah Tanggal) | Total + Pembayaran; **DPP dan PPN keluar dari daftar** |
| Invoice (Penjualan, Perizinan, Pembelian) | CO / Pengajuan / PO | Jatuh Tempo (di bawah Tanggal) | Total + Pembayaran |
| Credit Note | Invoice | Baris | Total |
| Penerimaan / Pengeluaran | Tagihan yang dibayar | Tujuan · Kas & Bank | Nilai (PPh di bawahnya) |
| Transfer | — | Tujuan · Dari → Ke | Jumlah |
| Journal | Dokumen sumber | Keterangan · Baris | Satu kolom Nilai (debit = kredit), agar tidak tergeser |

**Selesai bila:** pada layar 1366 px tidak ada daftar yang menyembunyikan Status,
Nilai, Pembayaran, atau aksi; tes memeriksa semua daftar dokumen memakai
`DocumentRegister`.
**Ukuran:** 4–5 hari.

---

## 5. Tahap 3 — Struktur form seragam

Hasil: **header → tab → audit** di semua dokumen dan master, baru / lihat / ubah.

| Langkah | Yang dilakukan | Temuan |
| --- | --- | --- |
| **3.1 Komponen tab** | `FormTabs` diangkat dari tab yang sudah ada di form master: jumlah isi, tanda error, dan pindah otomatis ke tab yang error saat simpan ditolak. Tab yang tidak aktif tetap menyimpan isiannya. Satu tab pun tetap tampil sebagai tab (U7) | — |
| **3.2 Header dokumen** | `DocumentHeader` + `Amount` di semua dokumen. Kartu header dengan bagian berurutan tetap: **Dokumen Sumber · Partner · Dokumen · Harga & Pajak · Catatan**. Bagian Harga & Pajak satu komponen (Currency, Kurs, Kena PPN, Mode Harga, Termin satu baris). Mode lihat menyembunyikan field opsional yang kosong | D2–D5, D9, D15 |
| **3.3 Dokumen Sumber (U2)** | Aturan: setiap dokumen yang lahir dari dokumen lain menyebut nomornya **di header**, dan **di baris** bila tiap baris punya sumber sendiri; selalu tautan. Kini kurang: PO (PR hanya teks di baris), Credit Note (DN tanpa tautan), BSTB, Journal (pindah ke posisi yang sama). Dokumen posted menyebut **Journal**-nya di bagian yang sama | D4 |
| **3.4 Isi tab** | Tabel di bawah. Kotak nilai tetap di bawah tabel barisnya, satu komponen, angka tidak berubah | D10, D11, D14, F2 |
| **3.5 Simpan & Ajukan (U3)** | Form baru dan ubah: `Batal · Simpan Draft · Simpan & <langkah pertama>`. Cara kerja: simpan dengan aksi yang ada, buka halaman dokumen, dan **konfirmasinya langsung terbuka** (termasuk preview journal atau alasan penolakan). Bila dibatalkan, dokumen tetap Draft. Server tidak berubah; tombol tampil hanya bila user berizin langkah itu | F3 |
| **3.6 Pindahkan form** | Penjualan (5) → Pembelian (2) → Persediaan (8 layar) → Finance (9) → Accounting (2). Journal Manual sekaligus: Currency dan Kurs **tetap kolom sendiri**; Partner pindah ke bawah Account (tampil bila account memintanya) dan Keterangan dipersempit, sehingga Debit dan Kredit selalu terlihat di 1366 px | D1 |
| **3.7 Master** | Semua master: kartu header, lalu tab; master tanpa koleksi mendapat satu tab **Informasi** berisi Status dan Catatan | D12 |

**Isi tab per dokumen** — audit (Riwayat) selalu kartu terakhir, di luar tab.

| Dokumen | Tab 1 | Tab berikutnya | Simpan & … |
| --- | --- | --- | --- |
| Customer Order | Barang | Jadwal Sales Order · Dokumen Terkait | Ajukan |
| Sales Order | Barang | Perintah Kirim · Dokumen Terkait | Ajukan |
| Delivery Order | Barang | Pengiriman · Dokumen Terkait | Terbitkan |
| Sales Return | Barang | Penerimaan Gudang · Dokumen Terkait | Ajukan |
| Pengajuan Perizinan | Perizinan | Realisasi · Dokumen Terkait | Ajukan |
| Purchase Request | Barang / Jasa | Dokumen Terkait (PO-nya) | Ajukan |
| Purchase Order | Barang / Jasa | Penerimaan · Dokumen Terkait | Ajukan |
| Receipt Note (beli, retur) | Barang / Jasa | Dokumen Terkait | Posting |
| Delivery Note | Barang | Dokumen Terkait | Posting |
| BSTB Issue | Barang | — | Ajukan |
| BSTB Finish Goods / Pengeluaran | Barang | — | — (dibuat di Produksi; Terima tetap) |
| Transfer Kirim | Barang | Dokumen Terkait (Transfer Terima) | Kirim |
| Transfer Terima | Barang | — | Terima |
| Uang Muka (3) | Dasar Uang Muka | Pembayaran | Terbitkan |
| Invoice Penjualan / Perizinan / Pembelian | Barang (atau Perizinan) Ditagih | Uang Muka · Kredit Retur (Penjualan) · Pembayaran | Posting |
| Credit Note | Barang Dikredit | Dokumen Terkait | Posting |
| Penerimaan / Pengeluaran | Tagihan Dibayar (kotak total dan Dampak Transaksi di bawahnya) | — | Posting |
| Transfer | Kas & Bank Tujuan (+ Dampak Transaksi) | — | Posting |
| Journal | Baris Journal | — | Posting |
| Opening Balance | Saldo per Account | — | — |
| Fiscal Year | Periode | — | — |
| Partner · Item | seperti sekarang | — | — |
| User · Role | Role · Unit Produksi · Gudang; Role: Izin | — | — |

*Dokumen Terkait* = dokumen turunan (Jenis · Nomor · Tanggal · Status), **hanya
tautan, tanpa tombol buat**. Tampil hanya bila modulnya sudah punya pembaca data
itu; tab tidak menampilkan angka dokumen lain (DC §4.3). PR → PO dan CO → Uang
Muka / Sales Return membutuhkan satu pembacaan baru masing-masing, disusun oleh
halaman (§3.1 guideline).

**Selesai bila:** tes mewajibkan setiap form dokumen memakai `DocumentHeader`,
`FormTabs`, dan Riwayat di akhir (memperluas `DOCUMENT_SCREENS`); Simpan & Ajukan
dicoba di browser untuk tiap jenis langkah (Ajukan, Terbitkan, Kirim, Terima, Posting).
**Ukuran:** 6–8 hari — tahap terbesar, dikirim per modul.

---

## 6. Tahap 4 — Laporan dan pengaturan

| Langkah | Yang dilakukan | Temuan |
| --- | --- | --- |
| **4.1 Filter laporan** | Satu baris mengalir, lebar kontrol sama; urutan: Buku / Kelompok · subjek · periode; Tampilkan paling kanan | R6 |
| **4.2 Badan laporan** | Baris ringkas (N subjek · periode) → Buka / Tutup Semua → blok atau tabel → catatan kaki → waktu dibuat. Header blok terang, gaya Trial Balance, di 9 laporan berblok | R4, R5 |
| **4.3 Angka** | Satu aturan: nol `—` redup, negatif dalam kurung, currency selalu ikut, rata-rata 2 desimal (lengkap saat disorot) | R3, R5 |
| **4.4 Perilaku** | Semua laporan langsung tampil dengan blok tertutup. Kartu Nilai Persediaan tetap meminta satu barang | R2 |
| **4.5 Umur Piutang / Hutang** | Posisi Bersih terlihat di 1366 px: kolom partner lentur, bucket dipersempit | L1 |
| **4.6 Unduh XLSX** | Di semua laporan yang belum: Persediaan (4), Piutang / Hutang / Uang Muka (8) | R1 |
| **4.7 Menu laporan** | Finance: Kas & Bank (Buku, Saldo) → Piutang → Hutang | R7 |
| **4.8 Pengaturan** | Account Mapping, Account Kategori Item, System Default: mode lihat → **Ubah** → Simpan, dalam tab per kelompok. Profil: tab Identitas · Password · Akses | M6 |
| **4.9 Account Kategori Item** | Kategori dua baris, kolom pertama dikunci | M7 |
| **4.10 Role** | Izin dalam tab per modul, kotak cari, kode hanya saat disorot | M9 |
| **4.11 Pesan "belum diatur"** | Menyertakan tautan ke pengaturannya (mis. Gudang Transit). Ini pesan error, bukan tombol sambungan | M11 |

**Selesai bila:** semua laporan diperiksa berdampingan di 1366 px, angka sebelum
dan sesudah sama persis, dan file unduhan sama dengan layar.
**Ukuran:** 4 hari; 4.6 sekitar setengahnya.

---

## 7. Cara kerja dan pengecekan

1. Satu langkah = satu commit kecil ke `main`; satu keputusan P per tahap.
   Guideline dan dokumen ini ditandai setiap langkah selesai.
2. Tiap tahap **berhenti untuk direview** dengan daftar cek layar. Tidak ada
   migrasi, jadi Neon hanya menerima deploy kode.
3. Pengecekan tiap langkah: `npm run build`, `npm run lint`, `npm test`, lalu
   tangkapan layar sebelum / sesudah di 1366 dan 1440 px dengan skill `ui-audit`.
4. Form besar (Customer Order, Invoice, Pengajuan) hanya dipindah bagiannya ke
   tab; perhitungannya tidak ditulis ulang. Angka kotak nilai dibandingkan
   sebelum dan sesudah.

**Risiko utama**

| Risiko | Penjagaan |
| --- | --- |
| Isian hilang saat pindah tab | Isi tab tetap terpasang, hanya disembunyikan; dites |
| Error tersembunyi di tab lain | Tanda error di tab + pindah otomatis |
| Tes desain lama menolak bentuk baru | Aturannya diubah bersama langkahnya, bukan dilewati |
| Aksi dari daftar melewati pemeriksaan halaman | Memakai konfirmasi dan Server Action yang sama |
| Simpan berhasil tetapi Ajukan ditolak | Dokumen tetap Draft, alasannya tampil di konfirmasi |

**Urutan dan perkiraan:** Tahap 1 (2 hari) → 2 (4–5) → 3 (6–8) → 4 (4) =
16–19 hari kerja.

---

## 8. Yang perlu dijawab sebelum mulai

Bagian konvensi yang berubah dikutip apa adanya (deviation check). Pilihan:
**A** ikut konvensi · **B** perbaiki konvensi untuk semua proyek · **C** konsep
kedua · **D** pengecualian ERP saja.

| # | Pertanyaan | Aturan sekarang dan alasannya | Rekomendasi |
| --- | --- | --- | --- |
| **T1** | Enam tombol sambungan yang sudah ada (Buat Sales Order / Invoice di CO, Buat DO, Buat Delivery Note, Terima Barang di Sales Return dan Transfer Kirim) ikut dihapus? | — | **Hapus**, agar semua menu sama. Salin, Terima BSTB, dan *Penerimaan Retur* di daftar Receipt Note tetap: itu satu-satunya jalan membuatnya dari menu sendiri — **disetujui dan dibangun (P308)** |
| **T2** | Tab selalu ada, walau satu | P38 dan DC `header-tabs`: "A form with one section has no tabs" — menghindari klik dan bingkai kosong | Ikuti arahan Anda: **B** — **disetujui dan dibangun (P308)** |
| **T3** | Status sebagai filter | DC §5.4 | **Dijawab user: dropdown, tanpa tab status** — dibangun (P308) |
| **T4** | Posted / Post → Diposting / Posting | DC §10.3 menulis *Posted*; §10.17: "Established product terms stay in English inside Indonesian copy, e.g. Budget, Journal, Draft, Post" — istilah seragam antar proyek | **B**: lebih banyak layar ERP sudah memakai *Diposting* — **disetujui dan dibangun (P308)** |
| **T5** | Header blok laporan terang | `globals.css` bawaan SIBA, tidak diubah (guideline §14) — layar sama di semua proyek | **D**: kelas baru di bagian tambahan — **disetujui dan dibangun (P308)** |
| **T6** | Nol `—` dan negatif dalam kurung di semua laporan | P145: "a nil figure reads `Rp 0`, never a dash"; P148 membatasi kurung ke buku | Ubah P145 dan P148 untuk ERP — **disetujui dan dibangun (P308)** |
| **T7** | General Ledger dan Buku Kas & Bank langsung tampil | Sekarang meminta pilihan dulu, agar tidak memuat seluruh buku | Ya; isi blok dimuat saat dibuka (P221) |
| **T8** | Daftar dan form Journal | P146 memakai dua kolom di daftar | **Dijawab user: daftar satu kolom Nilai; form Kurs tetap kolom sendiri** |

**Tidak masuk rencana ini:** alur tersambung, dashboard berisi, menu PR / PO
digabung, nama di bawah ikon rail, kontras token, pintasan keyboard, tampilan
kartu di ponsel, tautan master ke laporan, peringatan keluar form, pemilih banyak
item (F8).
