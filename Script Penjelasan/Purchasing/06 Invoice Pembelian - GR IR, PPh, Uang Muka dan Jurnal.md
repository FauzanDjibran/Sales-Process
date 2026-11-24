# Invoice Pembelian — GR/IR, PPh, uang muka dan jurnal

| Bagian | File |
| --- | --- |
| Cek, simpan, posting | `src/lib/erp/ap-invoice.ts` |
| Angka (`computePurchaseInvoice`) | `src/lib/erp/ap-invoice-workflow.ts`, `sales-tax.ts` |
| AP item | `src/lib/erp/ap-item.ts` (`createApItem`, `settleApItem`) |

Aturan: P128, P117, P118, P302, B28–B31. Angka contoh diuji `tests/ap-invoice.test.ts`.

## 1. Yang perlu dipahami

1. **Satu Invoice untuk satu Purchase Order**, Open atau Ditutup. Barisnya **baris Receipt Note
   utuh** yang sudah diposting; satu baris hanya ditagih satu Invoice hidup.
2. **Qty dan harga dalam satuan pembelian.** Satuan dasar tidak muncul di Invoice. DPP baris = DPP
   PO untuk qty yang diterima, sudah dihitung Receipt Note, jadi **Barang Diterima Belum Ditagih
   terhapus tepat**.
3. **Tidak ada penyesuaian harga.** Total supplier diketik sebagai pembanding.
4. **PPh dipotong di sini**, atas DPP setelah uang muka. Pelunasannya tunai saja.

Di bawah Harga PO tampil diskon baris PO, bila ada; DPP-nya sudah bersih dari diskon.

## 2. Angka

```
DPP        = Σ DPP baris
PPN penuh  = Σ round(tarif × round(DPP baris × 11/12))
Uang muka  = Σ DPP dipakai; PPN-nya dihitung ulang dengan rantai yang sama
DPP bersih = DPP − uang muka
PPN        = PPN penuh − PPN uang muka
Total      = DPP bersih + PPN
PPh        = per Jenis PPh atas DPP bersih
Selisih    = Total Tagihan Supplier − Total (0 bila tidak diisi)
Hutang     = DPP + PPN penuh + selisih − PPh          ← sebelum uang muka diterapkan
```

Selisih melebihi *Toleransi Selisih Tagihan Supplier*: Invoice bisa disimpan, tetapi **tidak bisa
diposting**.

## 3. Jurnal

```
Dr  Barang Diterima Belum Ditagih (supplier)   DPP
Dr  PPN Masukan                                PPN penuh
Dr/Cr Selisih Tagihan Supplier                 selisih
    Cr  Hutang Usaha (supplier)                   Hutang
    Cr  Hutang PPh                                PPh
per uang muka dipakai:
Dr  Hutang Usaha (supplier)                    DPP + PPN uang muka
    Cr  Uang Muka Pembelian (supplier)            DPP
    Cr  PPN Masukan                               PPN
```

## 4. Contoh

PO 10 × Rp100.000, diterima penuh, uang muka 300.000 dipakai, supplier menagih Rp777.050:

| Angka | Nilai |
| --- | ---: |
| DPP | 1.000.000 |
| PPN penuh | 110.000 |
| Uang muka: DPP / PPN | 300.000 / 33.000 |
| DPP bersih | 700.000 |
| PPN | 77.000 |
| Total | 777.000 |
| PPh 2 % × 700.000 | 14.000 |
| Selisih (777.050 − 777.000), dalam toleransi 100 | 50 |
| Hutang | 1.096.050 |

| Jurnal | Debit | Kredit |
| --- | ---: | ---: |
| Barang Diterima Belum Ditagih | 1.000.000 | |
| PPN Masukan | 110.000 | |
| Selisih Tagihan Supplier | 50 | |
| Hutang Usaha | | 1.096.050 |
| Hutang PPh 23 | | 14.000 |
| Hutang Usaha | 333.000 | |
| Uang Muka Pembelian | | 300.000 |
| PPN Masukan | | 33.000 |

Dengan total supplier Rp778.000 selisihnya 1.000: ditolak, *melebihi toleransi*.

Hutang tersisa 1.096.050 − 333.000 = **763.050**. Pelunasannya:

| Jurnal | Debit | Kredit |
| --- | ---: | ---: |
| Hutang Usaha | 763.050 | |
| Kas & Bank | | 763.050 |

Total uang keluar: 327.000 (uang muka) + 763.050 = 1.090.050. Ditambah PPh 20.000 = 1.110.050 =
1.000.000 + PPN 110.000 + selisih 50.

## 5. Bila barang diterima kurang

Invoice menagih Qty Terima. Supplier yang menagih penuh (mis. 5 BOX padahal diterima 4,777 BOX)
akan melebihi toleransi dan ditolak: supplier merevisi tagihan, atau mengirim kekurangannya lebih
dulu lalu kedua Receipt Note ditagih bersama. Debit Note Pembelian belum dibangun.

## 6. Layar

Halaman Invoice yang diposting menampilkan **Pembayaran** (Belum Dibayar / Sebagian / Lunas, Lewat
jatuh tempo) dan Pengeluaran yang membayarnya. Receipt Note menampilkan **Ditagih** per baris.

## 7. Cek

`npm run db:reconcile`: baris penerimaan ditagih paling banyak sekali; DPP baris = nilai Receipt
Note; Barang Diterima Belum Ditagih = penerimaan − Invoice per supplier; item Invoice = Hutang Usaha.
