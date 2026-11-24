# Purchasing — baca dulu: peta, tabel dan cerita contoh

Pintu masuk folder ini. Aturan bisnisnya ada di `Purchasing-Concept.md` (B1–B33),
`Purchase-UOM-Plan.md`, dan P121–P129, P302, P320, P321 di `Claude-ERP.md`.

## 1. Alur

```
Purchase Request ──► Purchase Order ──► Receipt Note ──► Invoice Pembelian ──► Pengeluaran
 (satuan dasar)      (satuan beli,       (timbang, lot,    (hutang, PPN          (bayar hutang)
                      harga, pajak)       stok, GR/IR)      Masukan, PPh)
                          │
                          └──► Uang Muka Pembelian ──► Pengeluaran ──► AP item Uang Muka
                                (tagihan saja)          (Dr Uang Muka)    (dipotong di Invoice)
```

| # | Dokumen | Menu | Tabel | Posting |
| --: | --- | --- | --- | --- |
| 01 | Purchase Request `PR/…` | Pembelian › Permintaan | `pur_request(_line)` | tidak ada |
| 02 | Purchase Order `PO/…` | Pembelian › Pesanan | `pur_order(_line)`, `pur_order_line_request` | tidak ada |
| 03, 04 | Receipt Note `RN/…` | Persediaan › Operasi Gudang | `log_receipt_note(_line, _tracking, _weighting)` | stok; Dr Persediaan atau Beban / Cr Barang Diterima Belum Ditagih |
| 03 | Stock Receipt bonus `SRC/…` | Persediaan › Operasi Gudang | `log_stock_receipt` | stok bernilai 0, tanpa jurnal |
| 05 | Uang Muka Pembelian `APA/…` | Finance › Uang Muka | `fin_ap_advance` | tidak ada (tagihan) |
| 05 | Pengeluaran `BKK/…` | Finance › Kas & Bank | `fin_cash_bank_tx(_line, _line_wht)` | Buku Kas & Bank, jurnal, AP item |
| 06 | Invoice Pembelian `PI/…` | Finance › Invoice | `fin_ap_invoice(_line, _advance_deduction)` | jurnal, AP item Invoice |
| 07 | Buku Hutang | Finance › Laporan | `fin_ap_item`, `fin_ap_ledger` | — |

Dokumen tanpa PPN memakai seri `-NP` (`PO-NP/…`, `RN-NP/…`, `APA-NP/…`, `PI-NP/…`).

## 2. Status

| Dokumen | Status |
| --- | --- |
| Purchase Request | Draft → Open → Ditutup; Dibatalkan |
| Purchase Order | Draft → Diajukan → Open → Ditutup; Ditolak, Dibatalkan |
| Receipt Note, Invoice Pembelian, Pengeluaran | Draft → Diposting; Dibatalkan |
| Uang Muka Pembelian | Draft → Diterbitkan; Dibatalkan |

Dokumen yang sudah diposting tidak bisa diubah atau dibatalkan.

## 3. Tiga aturan yang berlaku di mana-mana

1. **Yang dibayar adalah satuan pembelian.** Qty PO × harga PO, sampai Invoice. Satuan
   dasar dipakai untuk memenuhi Purchase Request dan untuk stok.
2. **Nilai barang diambil dari Purchase Order**, tidak pernah diketik di Receipt Note atau
   Invoice. Selisih total supplier hanya boleh sebesar toleransi.
3. **Pembagian kumulatif.** Penerimaan atau pembayaran sebagian selalu berjumlah tepat
   dengan dokumen asalnya.

## 4. Data yang harus ada

| Data | Di mana |
| --- | --- |
| Item Dapat Dibeli, Konversi Satuan, Timbangan | Master › Item |
| Supplier dengan Termin dan Mode Harga | Master › Partner |
| Account Pembelian (GR/IR, Hutang, Uang Muka, PPN Masukan, Selisih) | Accounting › Account Mapping |
| Account per Kategori Item (Persediaan, Beban) | Accounting › Account Kategori Item |
| Jenis PPh penggunaan Pembelian dengan Account Hutang PPh | Master › Jenis PPh |
| Toleransi Selisih Tagihan Supplier, tarif PPN | Pengaturan › System Default |

`npm run db:seed-makloon` mengisi semuanya, termasuk item dengan satuan beli dan timbangan.

## 5. Cerita contoh

Script 05, 06 dan 07 memakai satu cerita yang sama: PO 10 PCS @ Rp100.000, PPh 23 2 %,
uang muka 30 %, diterima penuh, ditagih, lalu dilunasi. **Angkanya dijalankan kode asli oleh
`tests/ap-invoice.test.ts`**, dan test itu gagal bila angkanya berubah.

Satuan BOX dicontohkan di 02 dan 04, penimbangan di 03.
