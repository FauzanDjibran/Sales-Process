# PPh di Kas & Bank — isian Dilunasi (P302)

Dokumen ini menjelaskan cara aplikasi menghitung PPh di **Penerimaan** dan
**Pengeluaran Kas & Bank** setelah P302 (20/11/2026). Ia menggantikan bagian
hitung-dari-uang di Script Penjelasan 01, 02, 03 dan 09.

Semua angka contoh berasal dari menjalankan `settleBill` di
`src/lib/erp/sales-tax.ts`, fungsi yang dipakai form dan posting.

---

## 1. Aturannya

| | Sebelum P302 | Sesudah P302 |
| --- | --- | --- |
| Yang diketik per baris | **Diterima**, yaitu uang yang masuk ke bank | **Dilunasi**, yaitu bagian tagihan yang diselesaikan (PPN dan PPh termasuk) |
| PPh | Selisih antara tagihan dan uang, dicari mundur (`settleBillFromCash`) | Bagian positional dari PPh tagihan (`settleBill`) |
| Saklar *Potong PPh* | Ada per baris | **Dihapus.** Bila tagihan punya Jenis PPh, PPh selalu dipotong, juga untuk pelunasan sebagian |
| Uang | Diketik | **Dihitung**: Diterima = Dilunasi − PPh |

Pelanggan yang lupa memotong PPh dan catatan PPh yang belum terselesaikan akan
punya alurnya sendiri. Keduanya di luar cakupan ini.

### 1.1 Rumus satu baris

Untuk tagihan dengan total `T`, PPN `PPN`, PPh `PPh`, yang sudah dilunasi
sebelumnya `sebelum`, dan isian baris `D`:

```text
sesudah    = sebelum + D
bagian(X)  = round(X × sesudah / T) − round(X × sebelum / T)

PPN bagian = bagian(PPN)
DPP bagian = D − PPN bagian
PPh        = bagian(PPh)            (per Jenis PPh, bila tujuan memotong PPh)
Diterima   = D − PPh
Sisa       = T − sesudah
```

`round` adalah pembulatan setengah ke atas ke rupiah penuh (`tax_concept.md` §7).
Karena setiap bagian dihitung kumulatif, jumlah semua pembayaran selalu sama
persis dengan angka tagihan, dan pembayaran yang melunasi mengambil sisanya.

### 1.2 Kapan ada PPh

- **Uang Muka Penjualan / Pembelian:** PPh dari Jenis PPh di baris Customer
  Order / Purchase Order. Dasarnya adalah DPP uang muka yang dibagi ke baris
  order menurut DPP (P55).
- **Invoice Penjualan:** PPh dihitung atas **DPP bersih setelah Uang Muka**
  (P119), karena PPh uang muka sudah dipotong saat uang muka dibayar.
- **Invoice Pembelian:** tidak ada PPh di Pengeluaran. PPh perusahaan sudah
  dibukukan di Invoice (B31), jadi Pengeluaran hanya membayar tunai.
- **Tujuan tanpa PPh** (Biaya Perizinan, Pembayaran Biaya Produksi,
  Pengembalian Dana Customer) tidak berubah: Dilunasi = uang.

---

## 2. Contoh: Customer Order dengan PPh 23

### 2.1 Customer Order

| Qty | Harga | DPP | DPP Nilai Lain | PPN | Total | Jenis PPh |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 100 | 100.000 | 10.000.000 | 9.166.667 | 1.100.000 | 11.100.000 | PPh 23 · 2 % |

- PPh 23 = 2 % × 10.000.000 = **200.000**.
- Estimasi Penerimaan = 11.100.000 − 200.000 = **10.900.000**.

### 2.2 Uang Muka Penjualan, Nominal 4.000.000

| DPP UM | DPP Nilai Lain | PPN | Total UM | Dasar PPh | PPh 23 | Estimasi Penerimaan |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 4.000.000 | 3.666.667 | 440.000 | **4.440.000** | 4.000.000 | **80.000** | 4.360.000 |

- Dasar PPh = DPP UM × DPP baris ber-PPh ÷ DPP CO = 4.000.000 × 10.000.000 ÷
  10.000.000 = 4.000.000. Satu-satunya baris CO kena PPh 23, jadi seluruh DPP
  uang muka menjadi dasar PPh.

### 2.3 Penerimaan, dibayar dua kali

Kasir memilih tagihan. Baris baru langsung terisi **Dilunasi = Sisa
(4.440.000)**. Untuk pembayaran sebagian, kasir menurunkan angka itu.

| Pembayaran | Sebelum | **Dilunasi** (diketik) | PPN bagian | DPP bagian | PPh 23 | Diterima | Sisa |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Ke-1 | 0 | **2.000.000** | 198.198 | 1.801.802 | 36.036 | 1.963.964 | 2.440.000 |
| Ke-2 | 2.000.000 | **2.440.000** | 241.802 | 2.198.198 | 43.964 | 2.396.036 | 0 |
| **Jumlah** | | 4.440.000 | 440.000 | 4.000.000 | 80.000 | 4.360.000 | |

Cara hitung pembayaran ke-1:

```text
PPN bagian = round(440.000 × 2.000.000 / 4.440.000) − 0 = round(198.198,20) = 198.198
DPP bagian = 2.000.000 − 198.198                                           = 1.801.802
PPh 23     = round(80.000 × 2.000.000 / 4.440.000) − 0  = round(36.036,04)  = 36.036
Diterima   = 2.000.000 − 36.036                                            = 1.963.964
```

Pembayaran ke-2 mengambil sisa setiap angka, jadi jumlahnya sama persis dengan
tagihan: PPN 440.000, DPP 4.000.000, PPh 80.000.

Bila dibayar **sekali lunas**, Dilunasi = 4.440.000 → PPh 80.000, Diterima
4.360.000. Angka ini sama dengan *Estimasi Penerimaan* di tagihan.

### 2.4 Journal pembayaran ke-1

| Account | Debit | Kredit |
| --- | ---: | ---: |
| Kas & Bank | 1.963.964 | |
| PPh 23 Dibayar Dimuka | 36.036 | |
| Uang Muka Penjualan (customer) | | 1.801.802 |
| PPN Keluaran | | 198.198 |
| **Jumlah** | **2.000.000** | **2.000.000** |

Posting yang sama juga:

- menambah `paid_amount` item Uang Muka sebesar Dilunasi, **2.000.000**
  (uang + PPh, P214);
- membuat satu **Bukti Potong** atas DPP bagian 1.801.802, PPh 36.036 (P69);
- membuat satu **Faktur Pajak Uang Muka** atas DPP 1.801.802, PPN 198.198.

### 2.5 Invoice yang memotong uang muka ini

Invoice menagih seluruh 100 qty dan memotong Uang Muka 4.000.000 (P113, P117):

| DPP penuh | PPN penuh | − UM (DPP + PPN) | Total Invoice | DPP bersih | PPh 23 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10.000.000 | 1.100.000 | 4.440.000 | **6.660.000** | 6.000.000 | **120.000** |

- Dilunasi 6.660.000 → PPh 120.000, Diterima 6.540.000.
- Total PPh = 80.000 (uang muka) + 120.000 (invoice) = 200.000, sama dengan PPh
  di Customer Order.

---

## 3. Yang tampil di layar

| Kolom | Isi |
| --- | --- |
| Tagihan | Nomor, jenis dokumen, order, jatuh tempo |
| Sisa Tagihan | Total − yang sudah dilunasi |
| **Dilunasi** | Diketik. Awalnya sama dengan Sisa. Di bawahnya tampil PPN yang dibukukan (khusus Uang Muka) |
| PPh Dipotong | Hitungan, per Jenis PPh, tidak bisa diubah |
| Diterima / Dibayar | Hitungan: Dilunasi − PPh |

Untuk tujuan tanpa PPh, kolom PPh dan Diterima tidak ditampilkan, dan
isiannya berlabel *Diterima* / *Dibayar*.

Di dialog *Pilih Tagihan*, kakinya menyebut uang yang harus masuk agar tagihan
terpilih lunas (`cashToClear`), misalnya *lunas bila diterima Rp 4.360.000*.
Angka ini membantu mencocokkan mutasi bank.

---

## 4. Pemeriksaan server

- Dilunasi harus lebih dari 0, rupiah penuh (sen untuk valas), dan **tidak
  melebihi Sisa**. Bila melebihi, pesannya *Melebihi sisa \<nomor\> (\<sisa\>)*.
- PPh dihitung ulang di server dengan fungsi yang sama. Form dan posting selalu
  menghasilkan angka yang sama.
- Kolom `withhold` di baris tetap ada, tetapi kini mengikuti tujuan. Baris yang
  diposting sebelum P302 tetap menyimpan apa yang tercatat waktu itu.
