# Plan simulasi: artifact Rencana Produksi

> Status: **putaran 1 terbit 25/11/2026** (P325): https://claude.ai/artifact/2hn2fkKtBx2WSUZrk2V7eX . Aturannya `Perintah-Produksi-Plan.md`; artifact ini contoh layarnya.
> **Syarat:** layar baru di artifact dibangun 1:1 di aplikasi. Jadi hanya memakai `globals.css`, komponen dan pola layar aplikasi.
> Script penjelasan: `Script Penjelasan/Artifact Rencana Produksi/`.

## 1. Alur yang disimulasikan

| # | Siapa | Layar | Yang terjadi |
| --- | --- | --- | --- |
| 1 | PPIC | Rencana Produksi | Mengumpulkan Sales Order Open, memilih, melihat FG, menetapkan prioritas dan keputusan |
| 2 | PPIC, Manager | Rencana Produksi | Ajukan, Setujui. **Perintah Produksi terbit**; bahan kurang menjadi Purchase Request |
| 3 | Logistik | (Receipt Note) | Bahan datang, Perintah *Menunggu Bahan* menjadi *Siap* |
| 4 | PPIC | Perintah Produksi | Rilis tahap Grading |
| 5 | PPIC | Planning Produksi | Membagi target ke hari, menerbitkan minggu |
| 6 | Logistik | Stock Issue | **Gerbang 1:** menunjuk Perintah; tanpa itu ditolak |
| 7 | Unit | Workspace, No. Grading | Hasil tidak menentu; kebutuhan dihitung ulang |
| 8 | PPIC | Perintah Produksi | Melihat proyeksi kurang, *Tambah Gram* atau memakai barang Perintah lain |
| 9 | Unit | BSTB Penyebaran | **Gerbang 2:** line datang dari Perintah, partai lahir |
| 10 | Unit | Workspace, Job Order | **Gerbang 3:** jenis lain diberi peringatan |
| 11 | Packing | Kotak | **Gerbang 4:** jumlah tidak boleh lebih |
| 12 | Gudang | Stock Receipt | Kotak diterima FG, Perintah Selesai, Sales Order *Siap Kirim* |
| 13 | PPIC | Rencana vs Realisasi | Capaian per Perintah dan per hari |

## 2. Layar

| Layar | Aplikasi | Sifat di artifact |
| --- | --- | --- |
| Rencana Produksi (register, form, halaman) | ERP › Produksi › Perencanaan | **Baru, 1:1** |
| Perintah Produksi (register, halaman) | ERP › Produksi › Perencanaan | **Baru, 1:1** |
| Planning Produksi (papan) | ERP › Produksi › Perencanaan | **Baru, 1:1** |
| Rencana vs Realisasi | ERP › Produksi › Laporan | **Baru, 1:1** |
| Stock Issue, BSTB Penyebaran, Job Order, Kotak | Persediaan, Produksi | Layar yang ada; **bagian Perintah di dalamnya 1:1**, sisanya diringkas |
| Workspace Unit | Produksi | Kolom Perintah dan urutan prioritas 1:1; proses unit diringkas |
| Sales Order, Purchase Request, Stock Receipt, No. Grading | ERP, Produksi | Diringkas, sekadar menyambung alur |
| Panduan Simulasi (bilah di bawah layar) | — | **Bukan bagian aplikasi:** langkah, ganti hari, muat ulang |

## 3. Cara dibuat

- Komponen bernama sama dengan aplikasi (`DocumentHeader`, `DocumentRegister`, `FormTabs`, `Field`, `Combobox`, `Select`,
  `MoneyInput`, `DateInput`, `Dialog`, `ConfirmDialog`, `Pager`) dan menulis markup yang sama, supaya layar dipindah tanpa digambar ulang.
- `globals.css` dibawa utuh. Tambahan hanya kelas `.pln-*` untuk papan Planning, yang pindah ke blok additions.
- Aturan ada di satu mesin terpisah (ditandai `ENGINE START` / `ENGINE END`), diuji sendiri, dan menjadi contoh logika server.
- Layar Produksi tanpa harga dan jurnal (P275). Tanpa data asli: customer, jumlah, rendemen hanya contoh.

## 4. Skenario data

| Sales Order | Isi | Menunjukkan |
| --- | --- | --- |
| SO 1 | 10 kotak BMK50 | FG 4, kurang 6 |
| SO 2 | 8 kotak BMK50 dan 4 kotak BMK100 | Digabung per item, dua Perintah |
| SO 3 | 5 kotak IDM50 (line Mie) | Line lain, bahan kurang, Purchase Request |
| SO 4 | 3 kotak BSD50, kirim terlalu dekat | Terlambat sejak Planning; FG cukup |
| SO 5 | Pra-SO | Hanya boleh beli bahan |

## 5. Di luar simulasi

Produksi tanpa Sales Order, kunci FG per Sales Order (OD-4), nilai dan jurnal, izin per user, Unduh XLSX.
