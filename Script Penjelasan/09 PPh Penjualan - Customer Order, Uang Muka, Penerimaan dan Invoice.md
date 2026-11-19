# PPh penjualan — dari Customer Order, Uang Muka, Penerimaan sampai Invoice

Dokumen ini menjelaskan bagaimana **PPh yang dipotong customer** (PPh 22, PPh
23) dihitung dan ditangani di seluruh alur penjualan barang. Isinya:

1. Customer Order: di mana Jenis PPh dipilih dan bagaimana estimasinya.
2. Uang Muka Penjualan: bagaimana PPh dibagi ke uang muka.
3. Penerimaan uang muka: bagaimana PPh dihitung dari uang yang diterima.
4. Invoice Penjualan: PPh dari DPP setelah uang muka.
5. Penerimaan invoice: sama dengan nomor 3.

Kodenya:

| Bagian | File / fungsi |
| --- | --- |
| Estimasi PPh per Jenis PPh | `sales-tax.ts` → `withholdingsOf` |
| Customer Order | `sales-tax.ts` → `computeSalesTotals`; `customer-order.ts` (tarif disalin ke baris) |
| Uang Muka | `sales-tax.ts` → `computeAdvance` |
| Invoice | `sales-tax.ts` → `computeInvoice`; `ar-invoice.ts` → `settlementInvoices` |
| Penerimaan | `sales-tax.ts` → `settleBillFromCash`, `settleBill`, `cashToClear`; `cash-bank-tx.ts` |

Aturan bisnisnya: P44, P60, P61, P69, P76, P119, P122, P134 di
`Claude-ERP.md` dan `tax_concept.md` §4. **Semua angka contoh berasal dari
menjalankan kode asli** (Customer Order → Uang Muka dibayar dua kali → Delivery
Note → Invoice dengan potongan uang muka → Invoice dibayar dua kali), bukan
hitungan tangan.

Dokumen ini untuk dokumen **rupiah**. Untuk dokumen USD rumusnya sama, dihitung
dalam sen (P273).

---

## 1. Lima aturan yang perlu dipahami dulu

1. **PPh tidak pernah disimpan sebagai "utang PPh" di dokumen penagihan.**
   Customer Order, Uang Muka dan Invoice hanya menampilkan **estimasi**. PPh
   yang **benar-benar dipotong** baru tercatat saat Penerimaan diposting
   (`fin_cash_bank_tx_line_wht`), dan itulah yang dijurnal (P119).
2. **Jenis PPh dipilih per baris Customer Order**, bukan per Item dan bukan per
   customer. Tarifnya **disalin** ke baris saat disimpan, jadi perubahan master
   Jenis PPh tidak mengubah order yang sudah ada.
3. **PPh dihitung per Jenis PPh, dari jumlah DPP baris-barisnya**, dibulatkan
   sekali (half up). Bukan per baris lalu dijumlah.
4. **PPh mengikuti DPP yang ditagih dokumen itu**: Uang Muka dari DPP uang muka,
   Invoice dari DPP **setelah** uang muka. Jadi tidak ada PPh yang dipotong dua
   kali atas DPP yang sama.
5. **Di Penerimaan user mengetik uang yang masuk (Diterima).** PPh menjelaskan
   selisihnya. Untuk pembayaran sebagian, PPh dibagi **posisional** (kumulatif),
   jadi semua pembayaran selalu berjumlah tepat PPh dokumen.

Alurnya:

```
Customer Order          Jenis PPh + tarif per baris      → estimasi PPh (informasi)
   │
   ├─ Uang Muka         DPP uang muka dibagi ke Jenis PPh → estimasi PPh uang muka
   │     └─ Penerimaan  Diterima → Dilunasi → PPh dipotong → JURNAL Dr PPh Dibayar Dimuka
   │
   └─ Invoice           PPh dari DPP bersih (setelah UM)  → estimasi PPh invoice
         └─ Penerimaan  Diterima → Dilunasi → PPh dipotong → JURNAL Dr PPh Dibayar Dimuka
```

---

## 2. Data dari mana

| Data | Tabel / kolom | Keterangan |
| --- | --- | --- |
| Master Jenis PPh | `ref_withholding_tax`: `wht_label`, `rate`, `usage`, `account_id` | hanya usage **Penjualan** yang ditawarkan di Customer Order; `account_id` = *PPh Dibayar Dimuka* |
| Jenis PPh baris | `sal_customer_order_line.withholding_tax_id` | kosong = *Tanpa PPh* |
| Tarif baris (dibekukan) | `sal_customer_order_line.withholding_rate` | disalin dari master saat order disimpan |
| Tarif di Invoice | `fin_ar_invoice_line.withholding_tax_id`, `withholding_rate` | disalin dari baris Customer Order |
| PPh yang dipotong | `fin_cash_bank_tx_line.pph_amount` (total) dan `fin_cash_bank_tx_line_wht` (per Jenis PPh: `rate`, `base_amount`, `amount`) | satu-satunya PPh yang disimpan |
| Saklar | *Potong PPh* per baris Penerimaan (`withhold`) | default on; off = tidak ada PPh di baris itu |

**Tidak ada kolom PPh** di `sal_customer_order`, `fin_ar_advance`,
`fin_ar_invoice` atau `fin_ar_item`. Estimasinya selalu dihitung ulang saat
dibaca, dengan fungsi yang sama di layar dan di server.

---

## 3. Customer Order

### 3.1 Rumus (`withholdingsOf`)

```
Untuk setiap Jenis PPh yang dipakai baris:
  base  = Σ DPP baris yang memakai Jenis PPh itu
  PPh   = round(base × tarif ÷ 100)              (half up, rupiah penuh)

Total PPh            = Σ PPh semua Jenis PPh
Estimasi Penerimaan  = Total − Total PPh − PPN dipungut (hanya bila customer Pemungut PPN)
```

DPP baris berasal dari harga, qty, diskon dan mode harga (lihat dokumen 01 dan
04). Baris tanpa Jenis PPh tidak masuk ke base mana pun.

### 3.2 Contoh

Exclude, Kena PPN 12 % × 11/12:

| Baris | Qty × Harga | DPP | PPN | Jenis PPh | Tarif |
| --- | --- | ---: | ---: | --- | ---: |
| A | 10 × 100.000 | 1.000.000 | 110.000 | PPH22 | 1,5 % |
| B | 4 × 50.000 | 200.000 | 22.000 | PPH23 | 2 % |
| **Σ** | | **1.200.000** | **132.000** | | |

| Jenis PPh | base | PPh |
| --- | ---: | ---: |
| PPH22 | 1.000.000 | 15.000 |
| PPH23 | 200.000 | 4.000 |
| **Total PPh** | | **19.000** |

Total 1.332.000 → **Estimasi Penerimaan 1.313.000**. Ini hanya informasi
(kotak di kiri angka order, P63). Customer Order tidak memposting apa pun.

---

## 4. Uang Muka Penjualan

### 4.1 Rumus (`computeAdvance`)

Uang muka adalah **satu angka global**, tidak dipecah per baris. Tapi Jenis PPh
melekat di baris Customer Order, jadi **DPP uang muka dibagi ke Jenis PPh
sebanding base-nya di Customer Order**:

```
Bobot   = [base PPH22 di CO, base PPH23 di CO, …, DPP CO tanpa PPh]
Bagian  = allocate(DPP uang muka, Bobot)
          (dibulatkan ke bawah, sisa pembulatan ke bobot terbesar)
PPh tiap Jenis = round(Bagian × tarif ÷ 100)
```

Bagian untuk baris tanpa PPh ikut dihitung supaya PPh tidak "menumpuk" ke
Jenis PPh yang ada.

### 4.2 Contoh

Uang muka Nominal 300.000 (DPP) → PPN 33.000 → Total 333.000.

| Jenis PPh | Bobot (base CO) | Bagian DPP | PPh |
| --- | ---: | ---: | ---: |
| PPH22 1,5 % | 1.000.000 | 250.000 | 3.750 |
| PPH23 2 % | 200.000 | 50.000 | 1.000 |
| **Total** | | **300.000** | **4.750** |

Uang yang diharapkan masuk (*Uang Pelunas*) = 333.000 − 4.750 = **328.250**.

Seperti dokumen 01, tagihan uang muka **tidak memposting apa pun**. Daftar PPh
ini (`withholdings` tagihan) adalah yang dipakai Penerimaan di §5.

---

## 5. Penerimaan (berlaku untuk Uang Muka dan Invoice)

### 5.1 Yang diketik dan yang dihitung

User mengetik **Diterima** = uang yang benar-benar masuk dari customer untuk
tagihan itu, dan saklar **Potong PPh**. Sistem mencari **Dilunasi** (bagian
tagihan yang lunas) sehingga:

```
Dilunasi − PPh(Dilunasi) = Diterima
```

### 5.2 Pembagian posisional (`settleBill`)

Untuk tagihan dengan `total`, yang sudah dilunasi sebelumnya `before`, dan
pelunasan ini `settled` (after = before + settled), setiap angka tagihan dibagi:

```
bagian(angka) = round(angka × after ÷ total) − round(angka × before ÷ total)
```

Diterapkan ke: PPN tagihan, dan untuk setiap Jenis PPh **base** dan **PPh**-nya.

```
PPN baris       = bagian(PPN tagihan)
DPP baris       = Dilunasi − PPN baris
PPh per Jenis   = bagian(PPh Jenis itu)       ← 0 semua bila Potong PPh off
base per Jenis  = bagian(base Jenis itu)
PPh baris       = Σ PPh per Jenis
Diterima        = Dilunasi − PPh baris
```

Karena posisional, pembayaran-pembayaran sebuah tagihan selalu berjumlah **tepat**
PPN, base dan PPh tagihan itu, dan pembayaran yang melunasi mengambil sisanya.

### 5.3 Mencari Dilunasi dari Diterima (`settleBillFromCash`, P134)

```
Outstanding   = total − before
Uang Pelunas  = Outstanding − PPh sisa                (cashToClear)
Perkiraan     = min(Outstanding, round(Diterima × Outstanding ÷ Uang Pelunas))
Lalu cek Perkiraan −4 … +4: ambil yang Dilunasi − PPh(Dilunasi) = Diterima tepat
```

Bila Diterima = Uang Pelunas, Perkiraan = Outstanding persis (lunas). Bila
Potong PPh off, Uang Pelunas = Outstanding dan Dilunasi = Diterima.

Bila tidak ada angka yang pas (kasus langka karena pembulatan), server menolak
dan user diminta mengubah Diterima 1 rupiah.

### 5.4 Yang disimpan dan dijurnal

| Kolom `fin_cash_bank_tx_line` | Isi |
| --- | --- |
| `settled_amount` | Dilunasi |
| `dpp_part`, `ppn_part` | bagian DPP dan PPN |
| `pph_amount` | Σ PPh baris |
| `fin_cash_bank_tx_line_wht` | satu baris per Jenis PPh: `rate`, `base_amount`, `amount` |

Jurnal: **Dr PPh Dibayar Dimuka** per Jenis PPh (account dari master Jenis PPh,
menyebut customer), di samping Dr Kas & Bank sebesar Diterima. Sisi kreditnya
tergantung jenis tagihan:

| Tagihan | Kredit |
| --- | --- |
| Uang Muka | Cr Uang Muka Penjualan (DPP baris) · Cr PPN Keluaran (PPN baris) |
| Invoice | Cr Piutang Usaha (Dilunasi). **Tidak ada PPN** (sudah dibukukan di Invoice) |

AR item mencatat **Dilunasi** (uang + PPh) sebagai yang dibayar
(`paid_amount`); PPh tidak disimpan di AR item.

Satu bukti potong per tagihan, per pembayaran, per Jenis PPh (P69). Modul Pajak
sedang disembunyikan (MC19), tapi barisnya tetap dibuat untuk dokumen rupiah.

### 5.5 Contoh: uang muka dibayar dua kali

Tagihan: total 333.000, PPN 33.000, PPH22 base 250.000 / PPh 3.750, PPH23 base
50.000 / PPh 1.000. Uang Pelunas 328.250.

**Pembayaran 1 — Diterima 200.000** (before 0):

| Langkah | Hitungan | Hasil |
| --- | --- | ---: |
| Perkiraan | round(200.000 × 333.000 ÷ 328.250) | 202.894 |
| PPN | round(33.000 × 202.894 ÷ 333.000) | 20.107 |
| PPH22 base / PPh | round(250.000 × …) / round(3.750 × …) | 152.323 / 2.285 |
| PPH23 base / PPh | round(50.000 × …) / round(1.000 × …) | 30.465 / 609 |
| PPh baris | 2.285 + 609 | 2.894 |
| Cek | 202.894 − 2.894 | **200.000** ✓ |
| DPP baris | 202.894 − 20.107 | 182.787 |

| Jurnal BKM 1 | Debit | Kredit |
| --- | ---: | ---: |
| Kas & Bank | 200.000 | |
| PPh Dibayar Dimuka — PPH22 | 2.285 | |
| PPh Dibayar Dimuka — PPH23 | 609 | |
| Uang Muka Penjualan | | 182.787 |
| PPN Keluaran | | 20.107 |

**Pembayaran 2 — Diterima 128.250** (before 202.894; sisa uang pelunas):

| | Hasil |
| --- | ---: |
| Dilunasi | 130.106 (= 333.000 − 202.894, lunas) |
| PPN | 12.893 (= 33.000 − 20.107) |
| PPH22 base / PPh | 97.677 / 1.465 (= 3.750 − 2.285) |
| PPH23 base / PPh | 19.535 / 391 (= 1.000 − 609) |
| Cek | 130.106 − 1.856 = **128.250** ✓ |

Jumlah dua pembayaran: Dilunasi 333.000, PPN 33.000, PPh 4.750 — **tepat
angka tagihan**.

---

## 6. Invoice Penjualan

### 6.1 Rumus (`computeInvoice` → `withholdingsOf`)

PPh Invoice dihitung dari **DPP bersih** tiap baris (DPP − bagian uang muka),
dikelompokkan per Jenis PPh:

```
Bagian UM per baris = allocate(DPP uang muka dipakai, DPP baris)
DPP bersih baris    = DPP baris − bagian UM
base per Jenis      = Σ DPP bersih baris yang memakai Jenis itu
PPh per Jenis       = round(base × tarif ÷ 100)
```

Kenapa DPP bersih: PPh atas bagian uang muka **sudah dipotong** saat uang muka
dibayar (§5). Bila dihitung dari DPP penuh, PPh atas 300.000 itu terpotong dua
kali.

Jurnal Invoice **tidak berisi PPh** (lihat dokumen 04 §8). PPh Invoice hanya
estimasi untuk Penerimaan, dihitung ulang saat dibaca
(`settlementInvoices` di `ar-invoice.ts`).

### 6.2 Contoh

Invoice semua barang (DPP 1.200.000), memotong uang muka DPP 300.000:

| Baris | DPP | Bagian UM | DPP bersih | Jenis PPh | PPh |
| --- | ---: | ---: | ---: | --- | ---: |
| A | 1.000.000 | 250.000 | 750.000 | PPH22 1,5 % | 11.250 |
| B | 200.000 | 50.000 | 150.000 | PPH23 2 % | 3.000 |
| **Σ** | **1.200.000** | **300.000** | **900.000** | | **14.250** |

Total Invoice = DPP bersih 900.000 + PPN (132.000 − 33.000 = 99.000) =
**999.000**. Uang Pelunas = 999.000 − 14.250 = **984.750**.

**Cek total PPh seluruh alur:** PPh uang muka 4.750 + PPh Invoice 14.250 =
**19.000** = estimasi PPh Customer Order. Tidak ada yang dipotong dua kali.

### 6.3 Contoh: invoice dibayar dua kali

Rumus §5 yang sama, tagihan = Invoice (total 999.000, PPN 99.000, PPH22 base
750.000 / PPh 11.250, PPH23 base 150.000 / PPh 3.000).

| | Pembayaran 1 | Pembayaran 2 | Σ |
| --- | ---: | ---: | ---: |
| Diterima | 500.000 | 484.750 | 984.750 |
| Dilunasi | 507.235 | 491.765 | 999.000 |
| PPH22 base / PPh | 380.807 / 5.712 | 369.193 / 5.538 | 750.000 / 11.250 |
| PPH23 base / PPh | 76.161 / 1.523 | 73.839 / 1.477 | 150.000 / 3.000 |
| PPh baris | 7.235 | 7.015 | 14.250 |
| `ppn_part` (informasi saja) | 50.267 | 48.733 | 99.000 |

Perkiraan pembayaran 1: round(500.000 × 999.000 ÷ 984.750) = 507.235; cek
507.235 − 7.235 = 500.000 ✓.

| Jurnal BKM 3 (pembayaran 1) | Debit | Kredit |
| --- | ---: | ---: |
| Kas & Bank | 500.000 | |
| PPh Dibayar Dimuka — PPH22 | 5.712 | |
| PPh Dibayar Dimuka — PPH23 | 1.523 | |
| Piutang Usaha — pelunasan INV/… (sebagian) | | 507.235 |

---

## 7. Ringkasan per dokumen

| Dokumen | Dasar PPh | PPh disimpan? | Jurnal PPh? |
| --- | --- | --- | --- |
| Customer Order | DPP baris, per Jenis PPh | tidak (hanya Jenis dan tarif per baris) | tidak |
| Uang Muka Penjualan | DPP uang muka dibagi sebanding base CO | tidak | tidak |
| Penerimaan uang muka | bagian posisional PPh tagihan | **ya** (`_line_wht`) | **Dr PPh Dibayar Dimuka** |
| Invoice Penjualan | DPP bersih (setelah UM), per Jenis PPh | tidak | tidak |
| Penerimaan invoice | bagian posisional PPh invoice | **ya** (`_line_wht`) | **Dr PPh Dibayar Dimuka** |

---

## 8. Kasus khusus

| Kasus | Penanganan |
| --- | --- |
| Customer tidak memotong PPh | matikan **Potong PPh** di baris Penerimaan: PPh 0, Dilunasi = Diterima, tidak ada bukti potong |
| Customer memotong dengan nilai berbeda | **tidak dimodelkan** (P60): PPh selalu mengikuti tarif aturan dari uang yang diketik, jadi selisih tetap terlihat sebagai sisa di tagihan |
| Satu pembayaran dengan Potong PPh off, pembayaran berikutnya on | pembagian posisional: pembayaran yang off tidak meninggalkan PPh untuk dibebankan ke pembayaran berikutnya |
| Tarif master Jenis PPh berubah | order lama tetap memakai tarif yang disalin; Invoice menyalin dari baris order |
| Baris tanpa Jenis PPh | tidak masuk base PPh; di uang muka tetap ikut sebagai bobot "tanpa PPh" |
| Dokumen USD | rumus sama, dalam sen; jurnal PPh dalam rupiah di Kurs Terima (P273) |
| Uang muka lebih besar dari DPP Invoice | ditolak: Σ DPP uang muka dipakai ≤ DPP Invoice, jadi DPP bersih tidak pernah negatif |

---

## 9. Cek yang harus selalu benar

| Cek | Rumus |
| --- | --- |
| Satu tagihan lunas | Σ `pph_amount` semua Penerimaan tagihan itu = PPh tagihan (bila Potong PPh selalu on) |
| Per Jenis PPh | Σ `fin_cash_bank_tx_line_wht.amount` per Jenis = PPh Jenis itu di tagihan |
| Baris Penerimaan | `settled_amount − pph_amount` = uang yang diterima untuk tagihan itu |
| Jurnal | Σ Dr PPh Dibayar Dimuka per Jenis = Σ `_line_wht.amount` per Jenis |
| Seluruh alur | PPh uang muka + PPh Invoice = PPh estimasi Customer Order (bila semua dibayar dan ditagih penuh) |
