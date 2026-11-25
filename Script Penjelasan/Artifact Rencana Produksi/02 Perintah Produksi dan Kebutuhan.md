# Rencana Produksi 02: Perintah Produksi

ERP › Produksi › Perencanaan › **Perintah Produksi**. Produksi membacanya di Perencanaan. Langkah simulasi 4 dan 9.

## 1. Isi

**Satu item, satu line, satu jumlah**, untuk baris Sales Order tertentu. Tidak dibuat dengan tangan.

| Tab | Isi |
| --- | --- |
| Tahap | Grading, Proses, Packing: yang boleh, yang sudah, sisa, dan tombol **Rilis** |
| Kebutuhan | Perkiraan siap packing dibanding yang dibutuhkan; **Tambah Gram** |
| Untuk Sales Order | Siapa yang dipenuhi, bagian tiap Sales Order, yang sudah diterima FG |
| Jadwal | Baris Planning milik Perintah ini |
| Dokumen | Issue, Grading, BSTB Penyebaran, Job Order, BSTB ke Finish Goods |

| Status | Arti |
| --- | --- |
| Menunggu Bahan | BB gudang kurang dan belum ada tahap dirilis |
| Siap | Bahan ada, belum dirilis |
| Dirilis | Minimal satu tahap dirilis |
| Selesai | Kotak diterima FG = jumlah |
| Ditutup Kurang | Ditutup dengan alasan; sisanya kembali ke antrean |

Status **dihitung** dari keadaan, hanya *Ditutup Kurang* yang disimpan.

## 2. Hitungan mundur BMK50, 14 kotak

```
Packing   14 × 50 g                           = 700 g
Keping siap packing dipakai                   − 100 g
Harus jadi                                    = 600 g
Harus disebar  600 ÷ 80 %                     = 750 g   → HLS-A 70 % 525, HLS-B 30 % 225
Siap Penyebaran dipakai (HLS-A)               − 150 g
Target Grading                                = 600 g   → HLS-A 375, HLS-B 225
BB boleh di-issue  600 ÷ 90 %                 = 667 g SM-A
```

Gram rencana dibulatkan ke atas. Target Job Order MLD-A 698 g, yaitu 750 × 93 % (contoh susut sampai Moulding).

## 3. Rilis per tahap

| Tahap | Membuka | Ditolak bila |
| --- | --- | --- |
| Grading | BSTB Issue | Bahan baku belum ada sama sekali |
| Proses | BSTB Penyebaran | — |
| Packing | Kotak | — |

Sejak Dirilis, item, jumlah dan line terkunci dan Perintah tidak bisa dibatalkan.

## 4. Hasil meleset: kebutuhan dihitung ulang

Langkah 7: 667 g SM-A menjadi HLS-A 333, HLS-B 186, BJL 66. Target HLS-A 375 dan HLS-B 225 tidak tercapai, dan itu wajar.

```
Keping siap packing                    100
Siap Penyebaran (333 + 186 + 150) × 80 %  = 535,2
Akan tersedia                             = 635,2
Masih dibutuhkan                          = 700
Kurang                                    =  64,8 g
Tambah BB kira-kira  64,8 ÷ (90 % × 80 %) =  90 g
```

| Perkiraan dihitung dari | Dikali |
| --- | --- |
| Keping di Packing 95 | 100 % |
| Barang di line | Susut unit yang belum dilewati |
| Siap Penyebaran, hanya jenis yang boleh disebar | Rendemen Proses |
| Grading, Pre Cleaning, belum di-issue | Rendemen Grading × Proses |

**Tambah Gram** menambah di Perintah yang sama; tujuan tetap 14 kotak.

| Dari | Yang bertambah |
| --- | --- |
| Bahan baku gudang | Boleh issue; target grading dan boleh sebar ikut menurut rendemen dan campuran |
| Barang siap Penyebaran | Boleh sebar; barangnya boleh milik Perintah lain |

Bila perkiraan **lebih**, kelebihannya menjadi stok siap pakai sesudah Perintah selesai.

## 5. Tutup Kurang

Alasan wajib. Ditolak selama barangnya masih di unit atau ada kotak yang belum diterima FG. Bagian Sales Order yang belum
diterima kembali ke antrean Rencana.
