# PPh penjualan — menambahkan PPh ke menu yang sudah ada

> **Diperbarui oleh P302 (20/11/2026).** Isian baris sekarang adalah **Dilunasi** (bagian tagihan yang diselesaikan, PPN dan PPh termasuk), bukan uang yang diterima. PPh **selalu** dipotong bila tagihan punya Jenis PPh, termasuk pelunasan sebagian, dan saklar *Potong PPh* sudah dihapus. Uang = Dilunasi − PPh, dengan PPh = bagian positional (`settleBill`). Perhitungan mundur dari uang (`settleBillFromCash`, estimasi lalu geser beberapa rupiah, P134) **sudah tidak dipakai**; bagian dokumen ini yang memakainya tinggal sebagai riwayat. Cara hitung yang berlaku ada di Script Penjelasan 10.

## Skenario

Semua menu penjualan **sudah dibuat dan sudah jalan tanpa PPh**:

- Customer Order
- Uang Muka Penjualan
- Penerimaan dari Customer (`customer_receipt`)
- Invoice Penjualan

Yang belum ada hanya **PPh yang dipotong customer** (PPh 22, PPh 23). Dokumen
ini menjelaskan apa yang harus **ditambahkan** di setiap menu: kolom database,
isian layar, hitungan, posting, dan tes. Bagian yang tidak disebut di sini tidak
berubah.

Kode acuan (versi yang sudah lengkap dengan PPh):

| Bagian | File / fungsi |
| --- | --- |
| Estimasi PPh per Jenis PPh | `sales-tax.ts` → `withholdingsOf` |
| Customer Order | `sales-tax.ts` → `computeSalesTotals`; `customer-order.ts` (cek dan salin tarif) |
| Uang Muka | `sales-tax.ts` → `computeAdvance` |
| Invoice | `sales-tax.ts` → `computeInvoice`; `ar-invoice.ts` → salin dari baris CO, `settlementInvoices` |
| Penerimaan | `sales-tax.ts` → `settleBillFromCash`, `settleBill`, `cashToClear`; `cash-bank-tx.ts` |

Aturan bisnisnya: P44, P60, P69, P76, P119, P122, P134 di `Claude-ERP.md` dan
`tax_concept.md` §4. **Semua angka contoh berasal dari menjalankan kode asli**
(Customer Order dengan PPh 22 dan PPh 23 → Uang Muka dibayar dua kali →
Delivery Note → Invoice memotong uang muka → Invoice dibayar dua kali).

---

## 1. Ringkasan perubahan per menu

| Menu | Database | Layar | Hitungan | Posting |
| --- | --- | --- | --- | --- |
| **Master Jenis PPh** | `ref_withholding_tax` (sudah ada) | — | — | account PPh Dibayar Dimuka wajib saat dipakai |
| **Customer Order** | `withholding_tax_id`, `withholding_rate` di baris | pilihan Jenis PPh per baris; kotak *Estimasi Penerimaan* | `withholdingsOf` | tidak ada (CO tidak memposting) |
| **Uang Muka** | **tidak ada kolom baru** | kotak *Estimasi Penerimaan* | `computeAdvance` membagi DPP ke Jenis PPh | tidak ada |
| **Invoice** | `withholding_tax_id`, `withholding_rate` di baris (salinan CO) | kotak *Estimasi Penerimaan* | PPh dari DPP bersih (setelah uang muka) | **jurnal Invoice tidak berubah** |
| **Penerimaan** | `withhold`, `pph_amount` di baris; tabel baru `fin_cash_bank_tx_line_wht` | saklar *Potong PPh* dan kolom PPh per baris | Dilunasi ≠ Diterima; pembagian posisional PPh | **+ Dr PPh Dibayar Dimuka**; AR item dibayar = Dilunasi |

**Perubahan besar hanya di Penerimaan.** Tiga menu lainnya hanya menambah
*estimasi* yang dihitung ulang setiap kali dibaca; tidak ada angka PPh yang
disimpan di Customer Order, Uang Muka, Invoice atau AR item (P119).

---

## 2. Prasyarat: master Jenis PPh

Master `ref_withholding_tax` sudah ada. Yang dipakai penjualan:

| Kolom | Isi | Dipakai di |
| --- | --- | --- |
| `wht_label`, `wht_name` | mis. PPH22, PPH23 | label di layar dan jurnal |
| `rate` | tarif persen, `Decimal(9,4)` | disalin ke baris Customer Order |
| `usage` | **`Sales`** untuk penjualan (`Purchase` untuk pembelian) | filter pilihan di Customer Order |
| `account_id` | account *PPh Dibayar Dimuka* (aset) | **wajib** saat Penerimaan memposting PPh |

Seed sudah membuat PPH22 1,5 %, PPH23 2 %, PPH23-15 15 % (usage Sales) dan
account-nya lewat `db:seed-accounts`.

---

## 3. Customer Order

### 3.1 Yang ditambahkan

**Database** — `sal_customer_order_line`:

| Kolom | Isi |
| --- | --- |
| `withholding_tax_id` | Jenis PPh baris, null = *Tanpa PPh* |
| `withholding_rate` | **tarif yang disalin** dari master saat order disimpan |

Header **tidak** mendapat kolom PPh.

**Layar** — baris order mendapat pilihan **Jenis PPh** (pilihan kosong *Tanpa
PPh*), hanya menampilkan Jenis PPh `usage = Sales` yang aktif. Di kiri kotak
angka order ditambah kotak **Estimasi Penerimaan** (informasi, bukan bagian
dokumen, P63).

**Validasi** (`customer-order.ts`):

| Aturan | Pesan |
| --- | --- |
| Jenis PPh ada dan aktif | *Jenis PPh tidak ditemukan atau nonaktif.* |
| `usage` harus Sales | *… adalah Jenis PPh pembelian.* |
| Tarif disalin ke `withholding_rate` | (tanpa pesan) |

Tarif disalin supaya perubahan master tidak mengubah order yang sudah ada.
Setelah Ajukan, baris dan tarifnya terkunci bersama angka lain.

### 3.2 Hitungan (`withholdingsOf`)

```
Untuk setiap Jenis PPh yang dipakai baris:
  base  = Σ DPP baris yang memakai Jenis PPh itu
  PPh   = round(base × tarif ÷ 100)              (half up, rupiah penuh)

Total PPh            = Σ PPh semua Jenis PPh
Estimasi Penerimaan  = Total − Total PPh − PPN dipungut (bila customer Pemungut PPN)
```

PPh dihitung **per Jenis PPh dari jumlah DPP**, dibulatkan sekali. Bukan per
baris lalu dijumlah.

### 3.3 Contoh

| Baris | Qty × Harga | DPP | PPN | Jenis PPh | Tarif |
| --- | --- | ---: | ---: | --- | ---: |
| A | 10 × 100.000 | 1.000.000 | 110.000 | PPH22 | 1,5 % |
| B | 4 × 50.000 | 200.000 | 22.000 | PPH23 | 2 % |

| Jenis PPh | base | PPh |
| --- | ---: | ---: |
| PPH22 | 1.000.000 | 15.000 |
| PPH23 | 200.000 | 4.000 |
| **Total** | | **19.000** |

Total 1.332.000 → **Estimasi Penerimaan 1.313.000**.

### 3.4 Tabel kolom

Singkatan: `col` = `sal_customer_order_line`, `co` = `sal_customer_order`,
`wht` = `ref_withholding_tax`. "Per Jenis" = dikelompokkan menurut
`col.withholding_tax_id`.

| Data | Disimpan di kolom | Label di layar | Contoh | Formula |
| --- | --- | --- | --- | --- |
| Jenis PPh baris | `col.withholding_tax_id` | kolom **Jenis PPh** di baris | PPH22 / PPH23 | dipilih user dari `wht` (`usage = Sales`) |
| Tarif PPh baris | `col.withholding_rate` | angka % di baris Estimasi (*PPH22 1,5 %*) | 1,5 / 2 | `col.withholding_rate = wht.rate` (disalin saat simpan) |
| DPP baris | `col.dpp_amount` | kotak Nilai Pesanan (DPP) | 1.000.000 / 200.000 | sudah ada (Exclude: `col.amount`) |
| Dasar PPh per Jenis | tidak disimpan | *× DPP 1.000.000* di baris Estimasi | 1.000.000 / 200.000 | `Σ col.dpp_amount` per Jenis |
| PPh per Jenis | tidak disimpan | baris Estimasi *PPH22 1,5 % × DPP …* | 15.000 / 4.000 | `round(Σ col.dpp_amount × col.withholding_rate ÷ 100)` per Jenis |
| Total PPh | tidak disimpan | — | 19.000 | `Σ PPh per Jenis` |
| Total order | `co.total_amount` | **Total Customer Order** | 1.332.000 | sudah ada (`co.dpp_amount + co.ppn_amount`) |
| Estimasi dana diterima | tidak disimpan | **Estimasi dana diterima** | 1.313.000 | `co.total_amount − Total PPh` |

---

## 4. Uang Muka Penjualan

### 4.1 Yang ditambahkan

**Database** — **tidak ada**. Tagihan uang muka tidak menyimpan PPh; estimasinya
dihitung ulang dari baris Customer Order setiap kali dibaca.

**Layar** — kotak **Estimasi Penerimaan** di tagihan uang muka.

**Hitungan** — `computeAdvance` menerima `basis.withholdings` dari Customer
Order (base per Jenis PPh, dikelompokkan dari baris order), lalu membagi DPP
uang muka ke Jenis PPh:

```
Bobot   = [base PPH22 di CO, base PPH23 di CO, …, DPP CO tanpa PPh]
Bagian  = allocate(DPP uang muka, Bobot)
          (dibulatkan ke bawah, sisa pembulatan ke bobot terbesar)
PPh tiap Jenis = round(Bagian × tarif ÷ 100)
Uang Pelunas   = Total uang muka − Σ PPh − PPN dipungut
```

Bobot "tanpa PPh" ikut dihitung supaya DPP baris tanpa PPh tidak dibebankan
ke Jenis PPh yang ada.

Hasilnya, daftar `withholdings` (key, rate, base, amount), ikut ke data tagihan
yang dibaca Penerimaan (`withholdings` di `OpenBill`).

### 4.2 Contoh

Uang muka Nominal 300.000 (DPP) → PPN 33.000 → Total 333.000.

| Jenis PPh | Bobot | Bagian DPP | PPh |
| --- | ---: | ---: | ---: |
| PPH22 1,5 % | 1.000.000 | 250.000 | 3.750 |
| PPH23 2 % | 200.000 | 50.000 | 1.000 |
| **Total** | | **300.000** | **4.750** |

Uang Pelunas = 333.000 − 4.750 = **328.250**.

### 4.3 Tabel kolom

Singkatan: `adv` = `fin_ar_advance`, `col` / `co` seperti §3.4.

| Data | Disimpan di kolom | Label di layar | Contoh | Formula |
| --- | --- | --- | --- | --- |
| DPP uang muka | `adv.dpp_amount` | sudah ada (DPP) | 300.000 | sudah ada |
| PPN uang muka | `adv.ppn_amount` | sudah ada (PPN) | 33.000 | sudah ada |
| Total tagihan | `adv.total_amount` | **Total tagihan uang muka** | 333.000 | sudah ada (`adv.dpp_amount + adv.ppn_amount`) |
| Bobot per Jenis | tidak disimpan (dari CO) | — | 1.000.000 / 200.000 | `Σ col.dpp_amount` per Jenis |
| Bobot tanpa PPh | tidak disimpan | — | 0 | `co.dpp_amount − Σ bobot per Jenis` |
| Dasar PPh per Jenis | tidak disimpan | *× DPP 250.000* di baris Estimasi | 250.000 / 50.000 | `floor(adv.dpp_amount × bobot ÷ co.dpp_amount)`, sisa pembulatan ke bobot terbesar |
| PPh per Jenis | tidak disimpan | baris Estimasi *PPH22 1,5 % × DPP 250.000* | 3.750 / 1.000 | `round(dasar × col.withholding_rate ÷ 100)` |
| Total PPh | tidak disimpan | — | 4.750 | `Σ PPh per Jenis` |
| Estimasi dana diterima (Uang Pelunas) | tidak disimpan | **Estimasi dana diterima** | 328.250 | `adv.total_amount − Total PPh` |

---

## 5. Invoice Penjualan

### 5.1 Yang ditambahkan

**Database** — `fin_ar_invoice_line`:

| Kolom | Isi |
| --- | --- |
| `withholding_tax_id` | **disalin** dari baris Customer Order |
| `withholding_rate` | **disalin** dari baris Customer Order |

Header dan AR item **tidak** mendapat kolom PPh.

**Layar** — kotak **Estimasi Penerimaan** di Invoice. User tidak memilih Jenis
PPh di Invoice; ikut order.

**Hitungan** — `computeInvoice` sudah membagi uang muka ke baris
(`advance_dpp_amount`, `net_dpp_amount`, lihat dokumen 04 §7.4). PPh memakai
**DPP bersih** itu:

```
base per Jenis = Σ net_dpp_amount baris yang memakai Jenis itu
PPh per Jenis  = round(base × tarif ÷ 100)
```

Kenapa DPP bersih: PPh atas bagian uang muka **sudah dipotong** saat uang muka
dibayar. Dari DPP penuh, PPh atas 300.000 terpotong dua kali.

**Posting** — **jurnal Invoice tidak berubah**. PPh bukan bagian Invoice; ia
hanya dikirim ke Penerimaan lewat `settlementInvoices` (`ar-invoice.ts`), yang
menghitung `withholdings` dari baris Invoice.

### 5.2 Contoh

Invoice semua barang, memotong uang muka DPP 300.000:

| Baris | DPP | Bagian UM | DPP bersih | Jenis PPh | PPh |
| --- | ---: | ---: | ---: | --- | ---: |
| A | 1.000.000 | 250.000 | 750.000 | PPH22 1,5 % | 11.250 |
| B | 200.000 | 50.000 | 150.000 | PPH23 2 % | 3.000 |
| **Σ** | **1.200.000** | **300.000** | **900.000** | | **14.250** |

Total Invoice 999.000 (900.000 + PPN 99.000). Uang Pelunas = **984.750**.

**Cek:** PPh uang muka 4.750 + PPh Invoice 14.250 = **19.000** = estimasi
Customer Order.

### 5.3 Tabel kolom

Singkatan: `inv` = `fin_ar_invoice`, `invl` = `fin_ar_invoice_line`, `col`
seperti §3.4. "Per Jenis" = dikelompokkan menurut `invl.withholding_tax_id`.

| Data | Disimpan di kolom | Label di layar | Contoh | Formula |
| --- | --- | --- | --- | --- |
| Jenis PPh baris | `invl.withholding_tax_id` | kolom **PPh** di baris Invoice | PPH22 / PPH23 | `invl.withholding_tax_id = col.withholding_tax_id` |
| Tarif PPh baris | `invl.withholding_rate` | angka % di baris Estimasi | 1,5 / 2 | `invl.withholding_rate = col.withholding_rate` |
| DPP baris | `invl.dpp_amount` | sudah ada | 1.000.000 / 200.000 | sudah ada |
| Bagian uang muka baris | `invl.advance_dpp_amount` | sudah ada | 250.000 / 50.000 | sudah ada: `floor(inv.advance_dpp_amount × invl.dpp_amount ÷ inv.dpp_amount)`, sisa ke DPP terbesar |
| DPP bersih baris | `invl.net_dpp_amount` | sudah ada | 750.000 / 150.000 | sudah ada: `invl.dpp_amount − invl.advance_dpp_amount` |
| Dasar PPh per Jenis | tidak disimpan | *× DPP 750.000* di baris Estimasi | 750.000 / 150.000 | `Σ invl.net_dpp_amount` per Jenis |
| PPh per Jenis | tidak disimpan | baris Estimasi *PPH22 1,5 % × DPP 750.000* | 11.250 / 3.000 | `round(Σ invl.net_dpp_amount × invl.withholding_rate ÷ 100)` per Jenis |
| Total PPh | tidak disimpan | — | 14.250 | `Σ PPh per Jenis` |
| Total tagihan | `inv.total_amount` | **Total Tagihan** | 999.000 | sudah ada (`inv.net_dpp_amount + inv.ppn_amount`) |
| Estimasi dana diterima (Uang Pelunas) | tidak disimpan | **Estimasi dana diterima** | 984.750 | `inv.total_amount − Total PPh` |

---

## 6. Penerimaan dari Customer — perubahan utama

### 6.1 Sebelum dan sesudah

| | **Sebelum (tanpa PPh)** | **Sesudah (dengan PPh)** |
| --- | --- | --- |
| Yang diketik | Diterima | Diterima + saklar Potong PPh |
| Dilunasi | **= Diterima** | Diterima + PPh (dicari, §6.3) |
| PPN baris | bagian posisional PPN | sama |
| PPh baris | — | bagian posisional PPh per Jenis |
| Disimpan | `settled_amount`, `dpp_part`, `ppn_part` | + `withhold`, `pph_amount`, tabel `_line_wht` |
| Jurnal | Dr Kas & Bank / Cr Uang Muka · PPN atau Cr Piutang | + **Dr PPh Dibayar Dimuka** per Jenis PPh |
| AR item dibayar (`paid_amount`) | Diterima | **Dilunasi** (uang + PPh) |

### 6.2 Yang ditambahkan

**Database**

| Tabel / kolom | Isi |
| --- | --- |
| `fin_cash_bank_tx_line.withhold` | saklar Potong PPh baris (default on) |
| `fin_cash_bank_tx_line.pph_amount` | Σ PPh baris |
| **`fin_cash_bank_tx_line_wht`** (baru) | satu baris per Jenis PPh: `withholding_tax_id`, `rate`, `dpp_amount`, `amount`; unik per (baris, Jenis PPh) |

**Layar** — per baris: saklar **Potong PPh** dan kolom **PPh**. Di dialog *Pilih
Tagihan*, nilai awal Diterima = **Uang Pelunas** (sisa − PPh sisa), bukan sisa
tagihan.

**Data tagihan** — setiap tagihan yang dibaca Penerimaan membawa
`withholdings` (key, rate, base, amount) dari §4 atau §5.

### 6.3 Hitungan

**Pembagian posisional** (`settleBill`) — sudah dipakai untuk PPN, sekarang juga
untuk setiap Jenis PPh (base dan PPh-nya):

```
before = yang sudah dilunasi sebelumnya,  after = before + Dilunasi
bagian(angka) = round(angka × after ÷ total) − round(angka × before ÷ total)

PPN baris      = bagian(PPN tagihan)
PPh per Jenis  = bagian(PPh Jenis itu)     ← 0 semua bila Potong PPh off
base per Jenis = bagian(base Jenis itu)
PPh baris      = Σ PPh per Jenis
DPP baris      = Dilunasi − PPN baris
```

**Mencari Dilunasi dari Diterima** (`settleBillFromCash`, P134). Tanpa PPh
langkah ini tidak perlu karena Dilunasi = Diterima. Dengan PPh:

```
Outstanding   = total − before
Uang Pelunas  = Outstanding − PPh sisa                  (cashToClear)
Perkiraan     = min(Outstanding, round(Diterima × Outstanding ÷ Uang Pelunas))
Cek Perkiraan −4 … +4: ambil yang Dilunasi − PPh(Dilunasi) = Diterima tepat
```

Bila Diterima = Uang Pelunas, hasilnya Outstanding persis (lunas). Bila Potong
PPh off, Uang Pelunas = Outstanding dan hasilnya kembali Dilunasi = Diterima.
Bila tidak ada angka yang pas (pembulatan), server menolak dan user diminta
mengubah Diterima 1 rupiah.

### 6.4 Posting

| Langkah | Tambahan |
| --- | --- |
| Cek account | setiap Jenis PPh yang dipakai harus punya `account_id` postable, kalau tidak: *Account PPh Dibayar Dimuka pada Jenis PPh …* |
| Jurnal | **Dr PPh Dibayar Dimuka** per Jenis PPh (dijumlah per Jenis untuk satu Penerimaan), menyebut customer |
| Kas & Bank | tidak berubah: tetap Diterima |
| AR item | `paid_amount` bertambah **Dilunasi**, bukan Diterima |
| Bukti potong | satu per tagihan, per pembayaran, per Jenis PPh (P69), lewat hook pajak (modul Pajak sedang disembunyikan, MC19) |

Sisi kredit jurnal tetap seperti sebelumnya:

| Tagihan | Kredit |
| --- | --- |
| Uang Muka | Cr Uang Muka Penjualan (DPP baris) · Cr PPN Keluaran (PPN baris) |
| Invoice | Cr Piutang Usaha (Dilunasi), tanpa PPN |

### 6.5 Contoh: uang muka dibayar dua kali

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

| Jurnal | Debit | Kredit |
| --- | ---: | ---: |
| Kas & Bank | 200.000 | |
| PPh Dibayar Dimuka — PPH22 *(baru)* | 2.285 | |
| PPh Dibayar Dimuka — PPH23 *(baru)* | 609 | |
| Uang Muka Penjualan | | 182.787 |
| PPN Keluaran | | 20.107 |

Tanpa PPh, Diterima 200.000 akan melunasi 200.000 saja (PPN 19.820, DPP
180.180). Dengan PPh, uang yang sama melunasi 202.894.

**Pembayaran 2 — Diterima 128.250** (sisa Uang Pelunas):

| | Hasil |
| --- | ---: |
| Dilunasi | 130.106 (= 333.000 − 202.894, lunas) |
| PPN | 12.893 |
| PPH22 base / PPh | 97.677 / 1.465 |
| PPH23 base / PPh | 19.535 / 391 |
| Cek | 130.106 − 1.856 = **128.250** ✓ |

Jumlah dua pembayaran: Dilunasi 333.000, PPN 33.000, PPh 4.750 — tepat angka
tagihan.

### 6.6 Contoh: invoice dibayar dua kali

Tagihan Invoice: total 999.000, PPN 99.000, PPH22 base 750.000 / PPh 11.250,
PPH23 base 150.000 / PPh 3.000.

| | Pembayaran 1 | Pembayaran 2 | Σ |
| --- | ---: | ---: | ---: |
| Diterima | 500.000 | 484.750 | 984.750 |
| Dilunasi | 507.235 | 491.765 | 999.000 |
| PPH22 base / PPh | 380.807 / 5.712 | 369.193 / 5.538 | 750.000 / 11.250 |
| PPH23 base / PPh | 76.161 / 1.523 | 73.839 / 1.477 | 150.000 / 3.000 |
| PPh baris | 7.235 | 7.015 | 14.250 |

| Jurnal pembayaran 1 | Debit | Kredit |
| --- | ---: | ---: |
| Kas & Bank | 500.000 | |
| PPh Dibayar Dimuka — PPH22 *(baru)* | 5.712 | |
| PPh Dibayar Dimuka — PPH23 *(baru)* | 1.523 | |
| Piutang Usaha — pelunasan sebagian | | 507.235 |

### 6.7 Tabel kolom

Contoh angka: **pembayaran 1 uang muka** (§6.5, Diterima 200.000).
Singkatan: `tx` = `fin_cash_bank_tx`, `txl` = `fin_cash_bank_tx_line`, `whtl` =
`fin_cash_bank_tx_line_wht`, `item` = `fin_ar_item` tagihan itu, `bill` = tagihan
yang dibayar (`fin_ar_advance` atau `fin_ar_invoice`), `bill.pph` = PPh per Jenis
tagihan dari §4.3 / §5.3, `bill.base` = dasar PPh per Jenis tagihan.

Dua angka bantu yang dipakai di banyak rumus:

```
before = item.paid_amount            (sebelum Penerimaan ini; 0 bila item belum ada)
after  = before + txl.settled_amount
bagian(X) = round(X × after ÷ bill.total_amount) − round(X × before ÷ bill.total_amount)
```

| Data | Disimpan di kolom | Label di layar | Contoh | Formula |
| --- | --- | --- | --- | --- |
| Sisa tagihan | tidak disimpan | **Sisa Tagihan** | 333.000 | `bill.total_amount − before` |
| Uang Pelunas | tidak disimpan | nilai awal **Diterima** saat tagihan dipilih | 328.250 | `Sisa Tagihan − Σ (bill.pph − bagian(bill.pph) sampai before)` = sisa − PPh sisa |
| Potong PPh | `txl.withhold` *(baru)* | saklar **Potong PPh** | on | diisi user, default on |
| Diterima | tidak disimpan per baris | **Diterima** (diketik) | 200.000 | `txl.settled_amount − txl.pph_amount` |
| Dilunasi | `txl.settled_amount` | tidak tampil (P243) | 202.894 | dicari: `Dilunasi − Σ bagian(bill.pph) = Diterima` (§6.3) |
| PPN baris | `txl.ppn_part` | PPN di bawah Diterima (uang muka saja) | 20.107 | `bagian(bill.ppn_amount)` |
| DPP baris | `txl.dpp_part` | — | 182.787 | `txl.settled_amount − txl.ppn_part` |
| Jenis PPh | `whtl.withholding_tax_id` *(baru)* | label di kolom **PPh Dipotong** | PPH22 / PPH23 | = Jenis PPh tagihan |
| Tarif PPh | `whtl.rate` *(baru)* | angka % di kolom PPh Dipotong | 1,5 / 2 | = tarif tagihan |
| Dasar PPh | `whtl.dpp_amount` *(baru)* | — | 152.323 / 30.465 | `bagian(bill.base)` per Jenis |
| PPh per Jenis | `whtl.amount` *(baru)* | kolom **PPh Dipotong** | 2.285 / 609 | `bagian(bill.pph)` per Jenis; 0 bila `txl.withhold = false` |
| PPh baris | `txl.pph_amount` *(baru)* | jumlah kolom PPh Dipotong | 2.894 | `Σ whtl.amount` |
| Dana masuk ke bank | `tx.cash_amount` | **Dana masuk ke bank** | 200.000 | `Σ (txl.settled_amount − txl.pph_amount) − tx.bank_charge` |
| Total PPh transaksi | `tx.pph_amount` | daftar Penerimaan, kolom **PPh** | 2.894 | `Σ txl.pph_amount` |
| Sudah dibayar tagihan | `item.paid_amount` | status Sebagian / Lunas | 0 → 202.894 | `item.paid_amount + txl.settled_amount` (bukan + Diterima) |
| Jurnal PPh | `acc_journal_line.debit_amount` di account `wht.account_id` | konfirmasi Posting | 2.285 / 609 | `Σ whtl.amount` per `whtl.withholding_tax_id` |

Untuk **Invoice** rumusnya sama; bedanya `txl.ppn_part` hanya informasi (tidak
dijurnal) dan kreditnya Piutang Usaha sebesar `txl.settled_amount`.

---

## 7. Kasus khusus

| Kasus | Penanganan |
| --- | --- |
| Customer tidak memotong PPh | matikan **Potong PPh** di baris Penerimaan: PPh 0, Dilunasi = Diterima, tidak ada bukti potong (perilaku sama seperti sebelum PPh ditambahkan) |
| Customer memotong dengan nilai berbeda | **tidak dimodelkan** (P60): PPh selalu mengikuti tarif aturan dari uang yang diketik, jadi selisih tetap terlihat sebagai sisa di tagihan |
| Satu pembayaran Potong PPh off, pembayaran berikutnya on | pembagian posisional: pembayaran yang off tidak meninggalkan PPh untuk dibebankan ke pembayaran berikutnya |
| Tarif master Jenis PPh berubah | order lama tetap memakai tarif yang disalin; Invoice menyalin dari baris order |
| Baris tanpa Jenis PPh | tidak masuk base PPh; di uang muka tetap ikut sebagai bobot "tanpa PPh" |
| Dokumen USD | rumus sama, dalam sen; jurnal PPh dalam rupiah di Kurs Terima (P273) |
| Data lama sebelum PPh ditambahkan | baris order lama punya `withholding_tax_id` null, jadi PPh 0; Penerimaan lama tidak punya baris `_line_wht` |

---

## 8. Tes yang perlu ditambahkan

| Tes | Yang dibuktikan |
| --- | --- |
| Customer Order | Jenis PPh pembelian ditolak; tarif tersalin; estimasi per Jenis PPh sesuai §3.3 |
| Uang Muka | PPh dibagi sebanding base CO, termasuk bobot tanpa PPh (§4.2) |
| Invoice | PPh dari DPP bersih; tarif tersalin dari baris CO; jurnal Invoice tidak berubah |
| Penerimaan lunas | Diterima = Uang Pelunas → Dilunasi = Outstanding |
| Penerimaan sebagian | Dilunasi − PPh = Diterima tepat; dua pembayaran berjumlah tepat angka tagihan (§6.5, §6.6) |
| Potong PPh off | PPh 0, Dilunasi = Diterima, tidak ada baris `_line_wht` |
| Jurnal | Σ Dr PPh Dibayar Dimuka per Jenis = Σ `_line_wht.amount` per Jenis |
| Account kosong | Penerimaan ditolak bila Jenis PPh belum punya account |

---

## 9. Cek yang harus selalu benar

| Cek | Rumus |
| --- | --- |
| Satu tagihan lunas | Σ `pph_amount` semua Penerimaan tagihan itu = PPh tagihan (bila Potong PPh selalu on) |
| Per Jenis PPh | Σ `_line_wht.amount` per Jenis = PPh Jenis itu di tagihan |
| Baris Penerimaan | `settled_amount − pph_amount` = uang diterima untuk tagihan itu |
| AR item | `paid_amount` = Σ `settled_amount` (bukan Σ uang diterima) |
| Seluruh alur | PPh uang muka + PPh Invoice = PPh estimasi Customer Order (bila semua dibayar dan ditagih penuh) |
