# 11 — Stock Adjustment: hitung fisik dan selisih

Koreksi stok dari **hitungan**, bukan dari sebab yang sudah diketahui (P318).
Barang pecah atau dipakai memakai dokumennya sendiri; yang baru ketahuan saat
dihitung memakai ini.

Kode: `stock-adjustment.ts`, `stock-adjustment-workflow.ts`, `inventory.ts`
(`stockBuckets`, `lockItemPools`, `increaseValue`).

## 1. Cara pakai

ERP › Persediaan › Operasi Gudang › **Stock Adjustment**

| # | Langkah |
| --: | --- |
| 1 | Pilih Gudang → **Muat Saldo**: satu baris per lot · lokasi · status |
| 2 | Isi **Fisik**; selisih tampil di sebelahnya. **Lot Ditemukan** untuk lot tanpa saldo buku |
| 3 | Simpan Draft, boleh belum lengkap → **Ajukan** bila semua baris terisi |
| 4 | Atasan **Setujui & Posting** (periksa jurnal) atau **Tolak** |

Status: `Draft → Submitted (Diajukan) → Posted (Diposting)`, atau `Rejected`,
`Cancelled`. Nomor `SA/YYYY/MM/NNNN`.

## 2. Aturan nilai

| Selisih | Nilai |
| --- | --- |
| Kurang | `issueStock`: round(V × q ÷ Q), habis → V seluruhnya |
| Lebih | round(V × q ÷ Q) dari pool |
| Lebih, stok perusahaan kosong | nilai yang diketik di baris |

**Semua kekurangan diposting sebelum kelebihan**, jadi urutan baris tidak mengubah
nilai.

| Selisih | Debit | Kredit |
| --- | --- | --- |
| Kurang | Selisih Persediaan | Persediaan |
| Lebih | Persediaan | Selisih Persediaan |

Persediaan dari Kategori Item; Selisih Persediaan dari Account Mapping. Hitungan
tanpa selisih diposting tanpa jurnal.

## 3. Saldo yang berubah

Baris menyimpan `book_qty` saat dihitung. Bila bucket itu bergerak sesudahnya,
baris ditolak saat Simpan, Ajukan maupun Posting: *Saldo buku … berubah … Muat
ulang saldo dan hitung lagi.*

## 4. Contoh

Stok 1.100 g senilai 1.100.000. Fisik 1.080 g.

| | Debit | Kredit |
| --- | ---: | ---: |
| Selisih Persediaan | 20.000 | |
| Persediaan | | 20.000 |

## 5. Batasan

- Gudang Transit belum bisa dihitung: kekurangannya juga harus menutup Transfer Kirim.
- Lot yang nomornya belum dikenal ditolak; itu Receipt Note atau stok awal.
- Hitungan yang ditolak dibuat baru; tidak kembali ke Draft.
- Produksi belum punya dokumen koreksi.
