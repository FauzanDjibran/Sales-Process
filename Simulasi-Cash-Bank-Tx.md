# Simulasi Cash Bank Transaction — langkah demi langkah

Simulasi Penerimaan (Kas & Bank) untuk **Uang Muka Penjualan** dan **Invoice
Penjualan**, masing-masing dua kasus: **dibayar sekali lunas** dan **dibayar
sebagian (dua kali)**. Setiap perhitungan ditulis dengan **Rumus → Hitung →
Hasil**.

Semua angka dihitung ulang dengan fungsi aplikasi sendiri
(`src/lib/erp/sales-tax.ts`: `computeSalesTotals`, `computeAdvance`,
`computeInvoice`, `cashToClear`, `settleBillFromCash`), jadi sama persis dengan
yang ditulis Posting. Logika dan tabelnya dijelaskan di
`Cash-Bank-Tx-Line-Logic.md`; keputusan terkait P66–P69, P76, P98, P113,
P116–P119, P132, P133.

> File ini diperbarui setiap kali simulasi ditambah atau aturan berubah.
> Sejak P134 semua pembayaran — lunas atau sebagian — melalui satu jalur
> perhitungan yang sama.

---

## 0. Konvensi dan rumus umum

**Simbol**

| Simbol | Arti |
| --- | --- |
| `round()` | pembulatan setengah ke atas ke rupiah penuh (PER-11/PJ/2025) |
| Tarif PPN | 12 % |
| Faktor DPP Nilai Lain | 11/12 |
| Tarif PPh 23 | 2 % |
| Total | yang diminta dokumen (tagihan uang muka atau Invoice), termasuk PPN |
| PPN, PPh | PPN dan PPh **dokumen** (bukan sisa) |
| Terbayar | `paid_amount` dokumen: yang sudah dilunasi Penerimaan yang sudah di-posting (uang + PPh) |
| TT | Tagihan Terlunasi oleh baris Penerimaan ini (`settled_amount`) |

**Rumus yang dipakai di setiap Penerimaan** (dibaca dari dokumen, tidak pernah
dari Penerimaan lain):

```
Outstanding          = Total − Terbayar
Outstanding PPn      = PPN − round(PPN × Terbayar / Total)
Outstanding PPh      = PPh − round(PPh × Terbayar / Total)
Uang Pelunas         = Outstanding − Outstanding PPh

Diterima > Uang Pelunas → ditolak (tidak ada lebih bayar)

Satu jalur untuk semua pembayaran, lunas maupun sebagian (P134):
  TT (estimasi)      = round(Diterima × Outstanding / Uang Pelunas)
  dicek: Diterima    = TT − PPh Terpotong   (jika meleset, TT digeser ±1..4,
                                              diambil TT terkecil yang tepat)
  Jika Diterima = Uang Pelunas, estimasinya tepat = Outstanding → dokumen lunas.

PPn Terlunasi        = round(PPN × (Terbayar + TT) / Total) − round(PPN × Terbayar / Total)
DPP Terlunasi        = TT − PPn Terlunasi
PPh Terpotong        = round(PPh × (Terbayar + TT) / Total) − round(PPh × Terbayar / Total)
Dasar PPh Terpotong  = round(Dasar PPh × (Terbayar + TT) / Total) − round(Dasar PPh × Terbayar / Total)

Dana Masuk ke Bank   = Σ Diterima − Biaya Bank
Terbayar baru        = Terbayar + TT                 (ditulis ke dokumen saat Posting)
```

**Kenapa kumulatif, bukan rasio sisa.** Rumus "PPn Terlunasi = TT ×
Outstanding PPn / Outstanding" memberi hasil yang sama untuk pembayaran
pertama (Terbayar = 0), tetapi pada cicilan berikutnya bisa meleset Rp1.
Rumus kumulatif di atas menjamin jumlah semua cicilan **tepat** sama dengan
PPN, PPh dan dasar PPh dokumen, dan cicilan yang melunasi mengambil sisanya.

---

## 1. Data awal — Customer Order

Customer Order (Open): Barang A, **100 PCS × Rp 100.000**, tanpa diskon,
**Kena PPN**, mode **Exclude PPN**, Jenis PPh **PPh 23 2 %**.

```
Rumus   DPP Order = Qty × Harga
Hitung  DPP Order = 100 × 100.000
Hasil   DPP Order = 10.000.000

Rumus   DPP Nilai Lain Order = round(DPP Order × 11/12)
Hitung  DPP Nilai Lain Order = round(10.000.000 × 11/12) = round(9.166.666,67)
Hasil   DPP Nilai Lain Order = 9.166.667

Rumus   PPN Order = round(DPP Nilai Lain Order × Tarif PPN)
Hitung  PPN Order = round(9.166.667 × 12%) = round(1.100.000,04)
Hasil   PPN Order = 1.100.000

Rumus   Total Order = DPP Order + PPN Order
Hitung  Total Order = 10.000.000 + 1.100.000
Hasil   Total Order = 11.100.000
```

---

# Bagian A — Uang Muka Penjualan

## A.0 Tagihan Uang Muka (30 %) — sama untuk kedua kasus

```
Rumus   DPP Uang Muka = round(DPP Order × Persen Uang Muka)          (mode Exclude)
Hitung  DPP Uang Muka = round(10.000.000 × 30%)
Hasil   DPP Uang Muka = 3.000.000

Rumus   DPP Nilai Lain = round(DPP Uang Muka × 11/12)
Hitung  DPP Nilai Lain = round(3.000.000 × 11/12)
Hasil   DPP Nilai Lain = 2.750.000

Rumus   PPN = round(DPP Nilai Lain × Tarif PPN)
Hitung  PPN = round(2.750.000 × 12%)
Hasil   PPN = 330.000

Rumus   Total = DPP Uang Muka + PPN
Hitung  Total = 3.000.000 + 330.000
Hasil   Total = 3.330.000

Rumus   Dasar PPh = DPP Uang Muka (dibagi ke baris order per Jenis PPh; di sini satu baris PPh 23)
Hasil   Dasar PPh = 3.000.000

Rumus   PPh = round(Dasar PPh × Tarif PPh)
Hitung  PPh = round(3.000.000 × 2%)
Hasil   PPh = 60.000
```

*Terbitkan* tidak memposting apa pun: tidak ada jurnal, tidak ada AR item.
**Terbayar = 0.**

---

## A.1 Kasus 1 — dibayar sekali, lunas

Customer memotong PPh 23 dan mentransfer **Rp 3.270.000**. Bank memotong
biaya **Rp 6.500**.

### Langkah 1 · Baca dokumen

```
Rumus   Outstanding = Total − Terbayar
Hitung  Outstanding = 3.330.000 − 0
Hasil   Outstanding = 3.330.000

Rumus   Outstanding PPn = PPN − round(PPN × Terbayar / Total)
Hitung  Outstanding PPn = 330.000 − round(330.000 × 0 / 3.330.000)
Hasil   Outstanding PPn = 330.000

Rumus   Outstanding PPh = PPh − round(PPh × Terbayar / Total)
Hitung  Outstanding PPh = 60.000 − round(60.000 × 0 / 3.330.000)
Hasil   Outstanding PPh = 60.000

Rumus   Uang Pelunas = Outstanding − Outstanding PPh
Hitung  Uang Pelunas = 3.330.000 − 60.000
Hasil   Uang Pelunas = 3.270.000
```

### Langkah 2 · Diterima 3.270.000 = Uang Pelunas → jalur yang sama, hasilnya lunas

```
Rumus   TT (estimasi) = round(Diterima × Outstanding / Uang Pelunas)
Hitung  TT = round(3.270.000 × 3.330.000 / 3.270.000) = round(3.330.000)
Hasil   TT = 3.330.000               (= Outstanding)

Rumus   PPn Terlunasi = round(PPN × (Terbayar + TT) / Total) − round(PPN × Terbayar / Total)
Hitung  PPn Terlunasi = round(330.000 × 3.330.000 / 3.330.000) − round(330.000 × 0 / 3.330.000)
Hasil   PPn Terlunasi = 330.000

Rumus   DPP Terlunasi = TT − PPn Terlunasi
Hitung  DPP Terlunasi = 3.330.000 − 330.000
Hasil   DPP Terlunasi = 3.000.000

Rumus   PPh Terpotong = round(PPh × (Terbayar + TT) / Total) − round(PPh × Terbayar / Total)
Hitung  PPh Terpotong = round(60.000 × 3.330.000 / 3.330.000) − 0
Hasil   PPh Terpotong = 60.000

Rumus   Dasar PPh Terpotong = round(Dasar PPh × (Terbayar + TT) / Total) − round(Dasar PPh × Terbayar / Total)
Hitung  Dasar PPh Terpotong = round(3.000.000 × 3.330.000 / 3.330.000) − 0
Hasil   Dasar PPh Terpotong = 3.000.000

Rumus   Cek: Diterima = TT − PPh Terpotong
Hitung  3.330.000 − 60.000 = 3.270.000 ✓
```

### Langkah 3 · Header

```
Rumus   Dana Masuk ke Bank = Σ Diterima − Biaya Bank
Hitung  Dana Masuk ke Bank = 3.270.000 − 6.500
Hasil   Dana Masuk ke Bank = 3.263.500        (cocokkan dengan rekening koran)
```

Simpan → **Draft** (belum ada yang dibukukan).

### Langkah 4 · Posting

```
Rumus   Dr Kas & Bank           = Dana Masuk ke Bank      = 3.263.500
Rumus   Dr Beban Bank           = Biaya Bank              =     6.500
Rumus   Dr PPh Dibayar Dimuka   = PPh Terpotong           =    60.000   (customer)
Rumus   Cr Uang Muka Penjualan  = DPP Terlunasi           = 3.000.000   (customer)
Rumus   Cr PPN Keluaran         = PPn Terlunasi           =   330.000
Rumus   Cek: Σ Debit = Σ Kredit → 3.330.000 = 3.330.000 ✓

Rumus   Terbayar baru = Terbayar + TT
Hitung  Terbayar baru = 0 + 3.330.000
Hasil   Terbayar baru = 3.330.000            → Lunas

Rumus   Item Uang Muka (baru, entri "Terbentuk") = DPP Terlunasi
Hasil   Saldo item Uang Muka = 3.000.000
```

Dokumen pajak:

```
Faktur Pajak Uang Muka #1
Rumus   DPP            = DPP Terlunasi                              = 3.000.000
Rumus   DPP Nilai Lain = round(DPP × 11/12)                         = 2.750.000
Rumus   PPN            = PPn Terlunasi                              =   330.000

Bukti Potong PPh 23
Rumus   Dasar = Dasar PPh Terpotong = 3.000.000;  PPh = PPh Terpotong = 60.000
```

---

## A.2 Kasus 2 — dibayar sebagian, dua kali

Tagihan yang sama (A.0). Tanpa biaya bank.

### Pembayaran 1 — customer transfer Rp 2.000.000 (potong PPh)

**Langkah 1 · Baca dokumen** (Terbayar = 0)

```
Rumus   Outstanding = Total − Terbayar
Hitung  Outstanding = 3.330.000 − 0
Hasil   Outstanding = 3.330.000

Rumus   Outstanding PPh = PPh − round(PPh × Terbayar / Total)
Hitung  Outstanding PPh = 60.000 − 0
Hasil   Outstanding PPh = 60.000

Rumus   Uang Pelunas = Outstanding − Outstanding PPh
Hitung  Uang Pelunas = 3.330.000 − 60.000
Hasil   Uang Pelunas = 3.270.000
```

**Langkah 2 · Diterima 2.000.000 < 3.270.000 → sebagian**

```
Rumus   TT (estimasi) = round(Diterima × Outstanding / Uang Pelunas)
Hitung  TT = round(2.000.000 × 3.330.000 / 3.270.000) = round(2.036.697,25)
Hasil   TT = 2.036.697

Rumus   PPh Terpotong = round(PPh × (Terbayar + TT) / Total) − round(PPh × Terbayar / Total)
Hitung  PPh Terpotong = round(60.000 × 2.036.697 / 3.330.000) − 0 = round(36.697,24)
Hasil   PPh Terpotong = 36.697

Rumus   Cek: Diterima = TT − PPh Terpotong
Hitung  2.036.697 − 36.697 = 2.000.000 ✓

Rumus   PPn Terlunasi = round(PPN × (Terbayar + TT) / Total) − round(PPN × Terbayar / Total)
Hitung  PPn Terlunasi = round(330.000 × 2.036.697 / 3.330.000) − 0 = round(201.834,84)
Hasil   PPn Terlunasi = 201.835

Rumus   DPP Terlunasi = TT − PPn Terlunasi
Hitung  DPP Terlunasi = 2.036.697 − 201.835
Hasil   DPP Terlunasi = 1.834.862

Rumus   Dasar PPh Terpotong = round(Dasar PPh × (Terbayar + TT) / Total) − round(Dasar PPh × Terbayar / Total)
Hitung  Dasar PPh Terpotong = round(3.000.000 × 2.036.697 / 3.330.000) − 0 = round(1.834.862,16)
Hasil   Dasar PPh Terpotong = 1.834.862

Rumus   Dana Masuk ke Bank = Σ Diterima − Biaya Bank
Hitung  Dana Masuk ke Bank = 2.000.000 − 0
Hasil   Dana Masuk ke Bank = 2.000.000
```

**Langkah 3 · Posting**

```
Rumus   Dr Kas & Bank           = Dana Masuk ke Bank      = 2.000.000
Rumus   Dr PPh Dibayar Dimuka   = PPh Terpotong           =    36.697
Rumus   Cr Uang Muka Penjualan  = DPP Terlunasi           = 1.834.862
Rumus   Cr PPN Keluaran         = PPn Terlunasi           =   201.835
Rumus   Cek: 2.036.697 = 2.036.697 ✓

Rumus   Terbayar baru = Terbayar + TT
Hitung  Terbayar baru = 0 + 2.036.697
Hasil   Terbayar baru = 2.036.697            → Sebagian

Rumus   Item Uang Muka (baru, entri "Terbentuk") = DPP Terlunasi
Hasil   Saldo item Uang Muka = 1.834.862

Faktur Pajak Uang Muka #1
Rumus   DPP = 1.834.862;  DPP Nilai Lain = round(1.834.862 × 11/12) = 1.681.957;  PPN = 201.835
Bukti Potong #1:  Dasar = 1.834.862;  PPh = 36.697
```

### Pembayaran 2 — customer melunasi sisanya

**Langkah 1 · Baca dokumen** (Terbayar = 2.036.697, dari tagihan itu sendiri)

```
Rumus   Outstanding = Total − Terbayar
Hitung  Outstanding = 3.330.000 − 2.036.697
Hasil   Outstanding = 1.293.303

Rumus   Outstanding PPn = PPN − round(PPN × Terbayar / Total)
Hitung  Outstanding PPn = 330.000 − round(330.000 × 2.036.697 / 3.330.000) = 330.000 − 201.835
Hasil   Outstanding PPn = 128.165

Rumus   Outstanding PPh = PPh − round(PPh × Terbayar / Total)
Hitung  Outstanding PPh = 60.000 − round(60.000 × 2.036.697 / 3.330.000) = 60.000 − 36.697
Hasil   Outstanding PPh = 23.303

Rumus   Uang Pelunas = Outstanding − Outstanding PPh
Hitung  Uang Pelunas = 1.293.303 − 23.303
Hasil   Uang Pelunas = 1.270.000
```

**Langkah 2 · Diterima 1.270.000 = Uang Pelunas → jalur yang sama, hasilnya lunas**

```
Rumus   TT (estimasi) = round(Diterima × Outstanding / Uang Pelunas)
Hitung  TT = round(1.270.000 × 1.293.303 / 1.270.000) = round(1.293.303)
Hasil   TT = 1.293.303               (= Outstanding)

Rumus   PPn Terlunasi = round(PPN × (Terbayar + TT) / Total) − round(PPN × Terbayar / Total)
Hitung  PPn Terlunasi = round(330.000 × 3.330.000 / 3.330.000) − 201.835 = 330.000 − 201.835
Hasil   PPn Terlunasi = 128.165

Rumus   DPP Terlunasi = TT − PPn Terlunasi
Hitung  DPP Terlunasi = 1.293.303 − 128.165
Hasil   DPP Terlunasi = 1.165.138

Rumus   PPh Terpotong = round(PPh × (Terbayar + TT) / Total) − round(PPh × Terbayar / Total)
Hitung  PPh Terpotong = 60.000 − 36.697
Hasil   PPh Terpotong = 23.303

Rumus   Dasar PPh Terpotong = round(Dasar PPh × (Terbayar + TT) / Total) − round(Dasar PPh × Terbayar / Total)
Hitung  Dasar PPh Terpotong = 3.000.000 − 1.834.862
Hasil   Dasar PPh Terpotong = 1.165.138

Rumus   Cek: Diterima = TT − PPh Terpotong
Hitung  1.293.303 − 23.303 = 1.270.000 ✓
```

**Langkah 3 · Posting**

```
Rumus   Dr Kas & Bank           = 1.270.000
Rumus   Dr PPh Dibayar Dimuka   =    23.303
Rumus   Cr Uang Muka Penjualan  = 1.165.138
Rumus   Cr PPN Keluaran         =   128.165
Rumus   Cek: 1.293.303 = 1.293.303 ✓

Rumus   Terbayar baru = Terbayar + TT
Hitung  Terbayar baru = 2.036.697 + 1.293.303
Hasil   Terbayar baru = 3.330.000            → Lunas

Rumus   Item Uang Muka (yang sama, entri "Uang Muka Diterima") = Saldo + DPP Terlunasi
Hitung  Saldo item Uang Muka = 1.834.862 + 1.165.138
Hasil   Saldo item Uang Muka = 3.000.000     (satu item per tagihan, P133)

Faktur Pajak Uang Muka #2 (mengacu ke item yang sama)
Rumus   DPP = 1.165.138;  DPP Nilai Lain = round(1.165.138 × 11/12) = 1.068.043;  PPN = 128.165
Bukti Potong #2:  Dasar = 1.165.138;  PPh = 23.303
```

### Cek total kasus A.2

```
Σ TT            = 2.036.697 + 1.293.303 = 3.330.000 = Total ✓
Σ PPn Terlunasi =   201.835 +   128.165 =   330.000 = PPN ✓
Σ DPP Terlunasi = 1.834.862 + 1.165.138 = 3.000.000 = DPP ✓
Σ PPh Terpotong =    36.697 +    23.303 =    60.000 = PPh ✓
Σ Diterima      = 2.000.000 + 1.270.000 = 3.270.000 = sama dengan kasus A.1 ✓
```

---

# Bagian B — Invoice Penjualan

## B.0 Invoice — sama untuk kedua kasus

60 PCS dikirim dan ditagih; Invoice memakai **Uang Muka DPP 1.800.000** dari
item Uang Muka di atas (saldo 3.000.000, baik dari kasus A.1 maupun A.2).

```
Rumus   DPP Penuh = Qty × Harga
Hitung  DPP Penuh = 60 × 100.000
Hasil   DPP Penuh = 6.000.000

Rumus   DPP Nilai Lain Penuh = round(DPP Penuh × 11/12)
Hitung  DPP Nilai Lain Penuh = round(6.000.000 × 11/12)
Hasil   DPP Nilai Lain Penuh = 5.500.000

Rumus   PPN Penuh = round(DPP Nilai Lain Penuh × Tarif PPN)
Hitung  PPN Penuh = round(5.500.000 × 12%)
Hasil   PPN Penuh = 660.000

Rumus   PPN Uang Muka Dipakai = round(round((Dipakai Sebelumnya + Dipakai) × 11/12) × 12%)
                               − round(round(Dipakai Sebelumnya × 11/12) × 12%)
Hitung  PPN Uang Muka Dipakai = round(round(1.800.000 × 11/12) × 12%) − 0 = round(1.650.000 × 12%)
Hasil   PPN Uang Muka Dipakai = 198.000

Rumus   DPP Neto = DPP Penuh − DPP Uang Muka Dipakai
Hitung  DPP Neto = 6.000.000 − 1.800.000
Hasil   DPP Neto = 4.200.000

Rumus   PPN Invoice = PPN Penuh − PPN Uang Muka Dipakai
Hitung  PPN Invoice = 660.000 − 198.000
Hasil   PPN Invoice = 462.000

Rumus   Total Invoice = DPP Neto + PPN Invoice
Hitung  Total Invoice = 4.200.000 + 462.000
Hasil   Total Invoice = 4.662.000

Rumus   Dasar PPh = DPP Neto                 (PPh atas DPP setelah uang muka)
Hasil   Dasar PPh = 4.200.000

Rumus   PPh = round(Dasar PPh × Tarif PPh)
Hitung  PPh = round(4.200.000 × 2%)
Hasil   PPh = 84.000
```

**Posting Invoice**

```
Rumus   Dr Piutang Usaha (face)  = DPP Penuh + PPN Penuh              = 6.660.000
Rumus   Cr Penjualan             = DPP Penuh                          = 6.000.000
Rumus   Cr PPN Keluaran          = PPN Penuh                          =   660.000
Rumus   Dr Uang Muka Penjualan   = DPP Uang Muka Dipakai              = 1.800.000
Rumus   Dr PPN Keluaran          = PPN Uang Muka Dipakai              =   198.000
Rumus   Cr Piutang Usaha         = DPP UM Dipakai + PPN UM Dipakai    = 1.998.000

Rumus   Saldo item Invoice = Face − (DPP UM Dipakai + PPN UM Dipakai)
Hitung  Saldo item Invoice = 6.660.000 − 1.998.000
Hasil   Saldo item Invoice = 4.662.000      (= Total Invoice)

Rumus   Saldo item Uang Muka = Saldo − DPP UM Dipakai
Hitung  Saldo item Uang Muka = 3.000.000 − 1.800.000
Hasil   Saldo item Uang Muka = 1.200.000
```

Faktur Pajak Pelunasan: DPP 6.000.000, potongan uang muka DPP 1.800.000 / PPN
198.000, DPP neto 4.200.000, PPN 462.000. Potongan diambil dari Faktur Uang
Muka **tertua dulu**:

- dari kasus A.1: Faktur UM #1 (DPP 3.000.000) memberi 1.800.000 / 198.000;
- dari kasus A.2: Faktur UM #1 (DPP 1.834.862) cukup memberi seluruh 1.800.000 / 198.000.

**Terbayar Invoice = 0.**

---

## B.1 Kasus 1 — dibayar sekali, lunas

Customer memotong PPh 23 dan mentransfer **Rp 4.578.000**. Tanpa biaya bank.

### Langkah 1 · Baca dokumen

```
Rumus   Outstanding = Total − Terbayar
Hitung  Outstanding = 4.662.000 − 0
Hasil   Outstanding = 4.662.000

Rumus   Outstanding PPn = PPN − round(PPN × Terbayar / Total)
Hitung  Outstanding PPn = 462.000 − 0
Hasil   Outstanding PPn = 462.000

Rumus   Outstanding PPh = PPh − round(PPh × Terbayar / Total)
Hitung  Outstanding PPh = 84.000 − 0
Hasil   Outstanding PPh = 84.000

Rumus   Uang Pelunas = Outstanding − Outstanding PPh
Hitung  Uang Pelunas = 4.662.000 − 84.000
Hasil   Uang Pelunas = 4.578.000
```

### Langkah 2 · Diterima 4.578.000 = Uang Pelunas → jalur yang sama, hasilnya lunas

```
Rumus   TT (estimasi) = round(Diterima × Outstanding / Uang Pelunas)
Hitung  TT = round(4.578.000 × 4.662.000 / 4.578.000) = round(4.662.000)
Hasil   TT = 4.662.000               (= Outstanding)

Rumus   PPn Terlunasi = round(PPN × (Terbayar + TT) / Total) − round(PPN × Terbayar / Total)
Hitung  PPn Terlunasi = round(462.000 × 4.662.000 / 4.662.000) − 0
Hasil   PPn Terlunasi = 462.000            (informasi saja; PPN sudah dibukukan Invoice)

Rumus   DPP Terlunasi = TT − PPn Terlunasi
Hitung  DPP Terlunasi = 4.662.000 − 462.000
Hasil   DPP Terlunasi = 4.200.000          (informasi saja)

Rumus   PPh Terpotong = round(PPh × (Terbayar + TT) / Total) − round(PPh × Terbayar / Total)
Hitung  PPh Terpotong = round(84.000 × 4.662.000 / 4.662.000) − 0
Hasil   PPh Terpotong = 84.000

Rumus   Dasar PPh Terpotong = round(Dasar PPh × (Terbayar + TT) / Total) − round(Dasar PPh × Terbayar / Total)
Hitung  Dasar PPh Terpotong = round(4.200.000 × 4.662.000 / 4.662.000) − 0
Hasil   Dasar PPh Terpotong = 4.200.000

Rumus   Cek: Diterima = TT − PPh Terpotong
Hitung  4.662.000 − 84.000 = 4.578.000 ✓

Rumus   Dana Masuk ke Bank = Σ Diterima − Biaya Bank
Hitung  Dana Masuk ke Bank = 4.578.000 − 0
Hasil   Dana Masuk ke Bank = 4.578.000
```

### Langkah 3 · Posting

PPN Invoice sudah dibukukan saat Invoice di-posting, jadi seluruh TT
mengkredit Piutang:

```
Rumus   Dr Kas & Bank          = Dana Masuk ke Bank      = 4.578.000
Rumus   Dr PPh Dibayar Dimuka  = PPh Terpotong           =    84.000
Rumus   Cr Piutang Usaha       = TT                      = 4.662.000   (customer)
Rumus   Cek: 4.662.000 = 4.662.000 ✓

Rumus   Terbayar baru = Terbayar + TT
Hitung  Terbayar baru = 0 + 4.662.000
Hasil   Terbayar baru = 4.662.000            → Lunas

Rumus   Saldo item Invoice = Saldo − TT     (entri "Pembayaran")
Hitung  Saldo item Invoice = 4.662.000 − 4.662.000
Hasil   Saldo item Invoice = 0

Rumus   Cek reconcile: Total − Terbayar = Saldo item
Hitung  4.662.000 − 4.662.000 = 0 ✓
```

Bukti Potong PPh 23: dasar 4.200.000, PPh 84.000. Membayar Invoice **tidak**
membuat faktur.

---

## B.2 Kasus 2 — dibayar sebagian, dua kali

Invoice yang sama (B.0). Tanpa biaya bank.

### Pembayaran 1 — customer transfer Rp 3.000.000 (potong PPh)

**Langkah 1 · Baca dokumen** (Terbayar = 0)

```
Rumus   Outstanding = Total − Terbayar
Hitung  Outstanding = 4.662.000 − 0
Hasil   Outstanding = 4.662.000

Rumus   Outstanding PPh = PPh − round(PPh × Terbayar / Total)
Hitung  Outstanding PPh = 84.000 − 0
Hasil   Outstanding PPh = 84.000

Rumus   Uang Pelunas = Outstanding − Outstanding PPh
Hitung  Uang Pelunas = 4.662.000 − 84.000
Hasil   Uang Pelunas = 4.578.000
```

**Langkah 2 · Diterima 3.000.000 < 4.578.000 → sebagian**

```
Rumus   TT (estimasi) = round(Diterima × Outstanding / Uang Pelunas)
Hitung  TT = round(3.000.000 × 4.662.000 / 4.578.000) = round(3.055.045,87)
Hasil   TT = 3.055.046

Rumus   PPh Terpotong = round(PPh × (Terbayar + TT) / Total) − round(PPh × Terbayar / Total)
Hitung  PPh Terpotong = round(84.000 × 3.055.046 / 4.662.000) − 0 = round(55.045,87)
Hasil   PPh Terpotong = 55.046

Rumus   Cek: Diterima = TT − PPh Terpotong
Hitung  3.055.046 − 55.046 = 3.000.000 ✓

Rumus   PPn Terlunasi = round(PPN × (Terbayar + TT) / Total) − round(PPN × Terbayar / Total)
Hitung  PPn Terlunasi = round(462.000 × 3.055.046 / 4.662.000) − 0 = round(302.752,31)
Hasil   PPn Terlunasi = 302.752            (informasi saja)

Rumus   DPP Terlunasi = TT − PPn Terlunasi
Hitung  DPP Terlunasi = 3.055.046 − 302.752
Hasil   DPP Terlunasi = 2.752.294          (informasi saja)

Rumus   Dasar PPh Terpotong = round(Dasar PPh × (Terbayar + TT) / Total) − round(Dasar PPh × Terbayar / Total)
Hitung  Dasar PPh Terpotong = round(4.200.000 × 3.055.046 / 4.662.000) − 0 = round(2.752.293,69)
Hasil   Dasar PPh Terpotong = 2.752.294

Rumus   Dana Masuk ke Bank = Σ Diterima − Biaya Bank
Hitung  Dana Masuk ke Bank = 3.000.000 − 0
Hasil   Dana Masuk ke Bank = 3.000.000
```

**Langkah 3 · Posting**

```
Rumus   Dr Kas & Bank          = Dana Masuk ke Bank      = 3.000.000
Rumus   Dr PPh Dibayar Dimuka  = PPh Terpotong           =    55.046
Rumus   Cr Piutang Usaha       = TT                      = 3.055.046
Rumus   Cek: 3.055.046 = 3.055.046 ✓

Rumus   Terbayar baru = Terbayar + TT
Hitung  Terbayar baru = 0 + 3.055.046
Hasil   Terbayar baru = 3.055.046            → Sebagian

Rumus   Saldo item Invoice = Saldo − TT
Hitung  Saldo item Invoice = 4.662.000 − 3.055.046
Hasil   Saldo item Invoice = 1.606.954

Rumus   Cek reconcile: Total − Terbayar = Saldo item
Hitung  4.662.000 − 3.055.046 = 1.606.954 ✓
```

Bukti Potong #1: dasar 2.752.294, PPh 55.046.

### Pembayaran 2 — customer melunasi sisanya

**Langkah 1 · Baca dokumen** (Terbayar = 3.055.046, dari Invoice itu sendiri)

```
Rumus   Outstanding = Total − Terbayar
Hitung  Outstanding = 4.662.000 − 3.055.046
Hasil   Outstanding = 1.606.954

Rumus   Outstanding PPn = PPN − round(PPN × Terbayar / Total)
Hitung  Outstanding PPn = 462.000 − round(462.000 × 3.055.046 / 4.662.000) = 462.000 − 302.752
Hasil   Outstanding PPn = 159.248

Rumus   Outstanding PPh = PPh − round(PPh × Terbayar / Total)
Hitung  Outstanding PPh = 84.000 − round(84.000 × 3.055.046 / 4.662.000) = 84.000 − 55.046
Hasil   Outstanding PPh = 28.954

Rumus   Uang Pelunas = Outstanding − Outstanding PPh
Hitung  Uang Pelunas = 1.606.954 − 28.954
Hasil   Uang Pelunas = 1.578.000
```

**Langkah 2 · Diterima 1.578.000 = Uang Pelunas → jalur yang sama, hasilnya lunas**

```
Rumus   TT (estimasi) = round(Diterima × Outstanding / Uang Pelunas)
Hitung  TT = round(1.578.000 × 1.606.954 / 1.578.000) = round(1.606.954)
Hasil   TT = 1.606.954               (= Outstanding)

Rumus   PPn Terlunasi = round(PPN × (Terbayar + TT) / Total) − round(PPN × Terbayar / Total)
Hitung  PPn Terlunasi = 462.000 − 302.752
Hasil   PPn Terlunasi = 159.248            (informasi saja)

Rumus   DPP Terlunasi = TT − PPn Terlunasi
Hitung  DPP Terlunasi = 1.606.954 − 159.248
Hasil   DPP Terlunasi = 1.447.706          (informasi saja)

Rumus   PPh Terpotong = round(PPh × (Terbayar + TT) / Total) − round(PPh × Terbayar / Total)
Hitung  PPh Terpotong = 84.000 − 55.046
Hasil   PPh Terpotong = 28.954

Rumus   Dasar PPh Terpotong = round(Dasar PPh × (Terbayar + TT) / Total) − round(Dasar PPh × Terbayar / Total)
Hitung  Dasar PPh Terpotong = 4.200.000 − 2.752.294
Hasil   Dasar PPh Terpotong = 1.447.706

Rumus   Cek: Diterima = TT − PPh Terpotong
Hitung  1.606.954 − 28.954 = 1.578.000 ✓
```

**Langkah 3 · Posting**

```
Rumus   Dr Kas & Bank          = 1.578.000
Rumus   Dr PPh Dibayar Dimuka  =    28.954
Rumus   Cr Piutang Usaha       = 1.606.954
Rumus   Cek: 1.606.954 = 1.606.954 ✓

Rumus   Terbayar baru = Terbayar + TT
Hitung  Terbayar baru = 3.055.046 + 1.606.954
Hasil   Terbayar baru = 4.662.000            → Lunas

Rumus   Saldo item Invoice = Saldo − TT
Hitung  Saldo item Invoice = 1.606.954 − 1.606.954
Hasil   Saldo item Invoice = 0
```

Bukti Potong #2: dasar 1.447.706, PPh 28.954.

### Cek total kasus B.2

```
Σ TT                  = 3.055.046 + 1.606.954 = 4.662.000 = Total ✓
Σ PPn Terlunasi       =   302.752 +   159.248 =   462.000 = PPN ✓
Σ PPh Terpotong       =    55.046 +    28.954 =    84.000 = PPh ✓
Σ Dasar PPh Terpotong = 2.752.294 + 1.447.706 = 4.200.000 = Dasar PPh ✓
Σ Diterima            = 3.000.000 + 1.578.000 = 4.578.000 = sama dengan kasus B.1 ✓
```

---

## Ringkasan perbandingan

| | Uang Muka sekali (A.1) | Uang Muka 2× (A.2) | Invoice sekali (B.1) | Invoice 2× (B.2) |
| --- | --- | --- | --- | --- |
| Uang diterima | 3.270.000 | 2.000.000 + 1.270.000 | 4.578.000 | 3.000.000 + 1.578.000 |
| PPh dipotong | 60.000 | 36.697 + 23.303 | 84.000 | 55.046 + 28.954 |
| Kredit di jurnal | Uang Muka 3.000.000 · PPN 330.000 | (1.834.862 · 201.835) + (1.165.138 · 128.165) | Piutang 4.662.000 | Piutang 3.055.046 + 1.606.954 |
| Item | 1 item Uang Muka, *Terbentuk* | 1 item, *Terbentuk* + *Uang Muka Diterima* | Item Invoice, *Pembayaran* | Item Invoice, 2× *Pembayaran* |
| Faktur Pajak | 1 Faktur UM | 2 Faktur UM (keduanya ke item yang sama) | — | — |
| Bukti Potong | 1 | 2 | 1 | 2 |
| Terbayar akhir | 3.330.000 (Lunas) | 3.330.000 (Lunas) | 4.662.000 (Lunas) | 4.662.000 (Lunas) |
