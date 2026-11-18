# Perizinan — dari Pengajuan sampai pelunasan Invoice, dibanding penjualan barang

Dokumen ini menjelaskan alur **Perizinan** (jasa pengurusan registrasi produk
makloon) dari awal sampai lunas, dan di setiap langkah membandingkannya dengan
**alur penjualan barang** (Customer Order → Delivery Note → Invoice Penjualan)
yang sudah dijelaskan di dokumen 01, 04, 05 dan 06.

Kodenya:

| Bagian | File |
| --- | --- |
| Pengajuan Perizinan dan Realisasi | `src/lib/erp/permit-request.ts`, `permit-request-workflow.ts` |
| Uang Muka Perizinan | `src/lib/erp/permit-advance.ts` |
| Invoice Perizinan | `src/lib/erp/permit-invoice.ts` |
| Penerimaan (uang muka dan invoice) | `src/lib/erp/cash-bank-tx.ts` — purpose `customer_receipt`, sama dengan penjualan barang |
| Biaya Perizinan (pembayaran biaya ke instansi) | `src/lib/erp/cash-payment.ts` — purpose `permit_cost` |
| Rumus | `src/lib/erp/sales-tax.ts` (`computePermitTotals`, `computeAdvance`, `computeInvoice`, `advancePpnUsed`) |
| AR item | `src/lib/erp/ar-item.ts` |

Aturan bisnisnya: P137–P144 di `Claude-ERP.md` dan `Perizinan-Concept.md`
(Z1–Z23). **Semua angka contoh di dokumen ini berasal dari menjalankan kode
asli** (skenario 2 simulasi, sama dengan `tests/permit-flow.test.ts`), bukan
hitungan tangan.

---

## 1. Lima perbedaan utama dengan penjualan barang

| # | Penjualan barang | Perizinan |
| --- | --- | --- |
| 1 | Dasar tagihan adalah **Customer Order**: harga per baris, qty, satuan | Dasar tagihan adalah **Pengajuan Perizinan**: daftar izin dengan **estimasi**, lalu **realisasi** harga sebenarnya di dokumen yang sama |
| 2 | Ada barang yang keluar: **Delivery Note**, stok, jurnal HPP | **Tidak ada barang, stok atau Delivery Note.** Pengganti "pengiriman" adalah **Realisasi** |
| 3 | PPN dihitung **per baris**, dokumen = jumlah baris | PPN dihitung **sekali dari total** (dokumen ke customer hanya satu baris uraian) |
| 4 | Jenis PPh **per baris** Customer Order | **Satu** Jenis PPh untuk seluruh Pengajuan |
| 5 | Biaya barang = HPP dari stok (rata-rata bergerak) | Biaya = uang yang dibayar ke instansi lewat **Biaya Perizinan** (Pengeluaran), ditagih ke customer **at cost** |

Yang **sama persis** dengan penjualan barang: mesin Penerimaan dari Customer,
AR item dan Buku Piutang, rumus potongan uang muka (PPN penuh dikurangi PPN uang
muka, P113 / P118), dan bentuk jurnal Invoice.

Alurnya berdampingan:

```
PENJUALAN BARANG                           PERIZINAN
Customer Order (CO/…)                      Pengajuan Perizinan (PRZ/…)          ← estimasi
   │                                          │
   ├─ Uang Muka Penjualan (ARA/…)             ├─ Uang Muka Perizinan (UMP/…)     ← dari estimasi
   │     └─ Penerimaan (BKM/…)                │     └─ Penerimaan (BKM/…)        ← purpose yang sama
   │                                          │
   ├─ Sales Order → Delivery Order            ├─ Realisasi (RLZ/…, di dokumen    ← harga sebenarnya
   │     └─ Delivery Note (SJ/…)              │     yang sama)
   │         stok keluar, Dr HPP / Cr Persd.  │     └─ Biaya Perizinan (BKK/…)   ← Dr Biaya Perizinan / Cr Bank
   │                                          │
   └─ Invoice Penjualan (INV/…)               └─ Invoice Perizinan (INP/…)       ← satu per Pengajuan
         └─ Penerimaan (BKM/…)                      └─ Penerimaan (BKM/…)        ← purpose yang sama
```

---

## 2. Pengajuan Perizinan (`PRZ/…`)

Tabel: `sal_permit_request` (header) dan `sal_permit_request_line` (satu baris
per Jenis Perizinan). Menu: Penjualan › Perizinan › Pengajuan Perizinan.

### 2.1 Data dari mana

| Di Pengajuan | Asal | Pembanding Customer Order |
| --- | --- | --- |
| Customer, Alamat, Termin, Kena PPN, Mode Harga, No. PO, Salesperson | diketik / dipilih, default dari Partner | sama |
| **Produk yang Didaftarkan** | diketik | tidak ada |
| **Jenis PPh** | **satu** untuk seluruh dokumen (usage Penjualan) | per baris |
| Baris | **Jenis Perizinan** (`ref_permit_type`), dipilih di *Pilih Perizinan*, sekali per dokumen | Item (Barang, Dapat Dijual) |
| Harga Estimasi per baris | default *Harga Estimasi Standar* Jenis Perizinan, bisa diubah; dibulatkan rupiah penuh | harga, qty, diskon |
| Qty, satuan, diskon | **tidak ada** | ada |
| Tarif PPN dan faktor 11/12 | snapshot dari Pengaturan saat disimpan | sama |

### 2.2 Perhitungan (`computePermitTotals`)

```
amount  = Σ harga estimasi baris                     (estimate_amount)
Exclude: DPP = amount
Include: DPP, PPN = inclusiveSplit(amount)
DPP Nilai Lain = round(DPP × 11/12)                   (estimate_dpp_other)
PPN            = round(12 % × DPP Nilai Lain)         (estimate_ppn)   ← SEKALI dari total
Total          = DPP + PPN                            (estimate_total)
PPh (estimasi) = round(DPP × tarif Jenis PPh)         (hanya informasi, tidak disimpan)
```

**Kontras:** di Customer Order PPN dihitung per baris lalu dijumlah. Di
Perizinan PPN dihitung dari total karena faktur pajak dan invoice ke customer
hanya punya **satu baris uraian** (Z1). Hasilnya bisa beda 1 rupiah dari
penjumlahan per baris; itu disengaja.

### 2.3 Status

```
Draft ─Ajukan─► Diajukan ─Setujui─► Disetujui ─Realisasikan─► Terealisasi ─Invoice diposting─► Selesai
  │                │                    │
Batalkan         Tolak               Batalkan (ditolak bila ada Uang Muka Perizinan hidup)
```

| Status (layar) | Kode | Artinya |
| --- | --- | --- |
| Draft | `Draft` | bisa diubah |
| Diajukan | `Submitted` | angka estimasi dan snapshot PPN dibekukan |
| Disetujui | `Open` | boleh dibuatkan Uang Muka; boleh diisi Realisasi |
| Terealisasi | `Realized` | Realisasi sudah bernomor `RLZ/…`; boleh ditagih dan dibayar biayanya |
| Selesai | `Done` | Invoice Perizinan sudah diposting |

Pengajuan **tidak memposting apa pun** (seperti Customer Order).

### 2.4 Contoh

| Baris | Harga Estimasi |
| --- | ---: |
| PRE (pre-registrasi) | 500.000 |
| BPOM | 100.000 |
| STAB (uji stabilitas) | 200.000 |
| **amount = DPP** (Exclude) | **800.000** |
| DPP Nilai Lain = round(800.000 × 11/12) | 733.333 |
| PPN = round(12 % × 733.333) | 88.000 |
| **Total estimasi** | **888.000** |
| PPh 23 2 % (estimasi) | 16.000 |

---

## 3. Uang Muka Perizinan (`UMP/…`)

Tabel: `fin_ar_permit_advance`. Menu: Finance › Uang Muka › Uang Muka
Perizinan. Kodenya adalah `ar-advance.ts` dengan sumber yang ditukar
(`permitAdvanceSources`), jadi **rumusnya sama dengan Uang Muka Penjualan**
(dokumen 01).

| | Uang Muka Penjualan | Uang Muka Perizinan |
| --- | --- | --- |
| Sumber | Customer Order berstatus Open | Pengajuan berstatus **Disetujui atau Terealisasi** |
| Nilai dasar (100 %) | Customer Order: DPP bila Exclude, Total bila Include | **Estimasi** Pengajuan (bukan realisasi), aturan Exclude / Include yang sama |
| Baris | tidak disalin; satu baris uraian | sama: header saja, Uraian = satu baris |
| Batas | Σ tagihan hidup ≤ nilai Customer Order | Σ tagihan hidup ≤ **estimasi** Pengajuan |
| PPh estimasi | per Jenis PPh baris Customer Order | Jenis PPh tunggal Pengajuan |
| Status | Draft → Terbitkan → Diterbitkan; Batalkan | sama |
| Jurnal | tidak ada | tidak ada |

Selama ada Uang Muka Perizinan yang hidup, Pengajuan tidak bisa dibatalkan.

### 3.1 Contoh

Tipe Persen 100 % dari estimasi 800.000:

| Kolom `fin_ar_permit_advance` | Nilai |
| --- | ---: |
| `amount_type`, `amount_value` | Percent, 100 |
| `dpp_amount` | 800.000 |
| `dpp_other_amount` | 733.333 |
| `ppn_amount` | 88.000 |
| `total_amount` | 888.000 |

---

## 4. Pembayaran Uang Muka (Penerimaan `BKM/…`)

**Menu dan purpose yang sama** dengan penjualan barang: Finance › Kas & Bank ›
Penerimaan, purpose `customer_receipt` (*Penerimaan dari Customer*). Di *Pilih
Tagihan* Uang Muka Perizinan muncul dengan badge **UM Perizinan**, di samping
tagihan uang muka barang dan invoice customer yang sama; satu Penerimaan boleh
melunasi campuran semuanya.

Baris Penerimaan menyimpan `doc_type = fin_ar_permit_advance`. Rumus per baris
(Diterima → Dilunasi → bagian DPP / PPN / PPh) **sama persis** dengan dokumen
01–03.

### 4.1 Contoh

Customer mentransfer 872.000 (888.000 dipotong PPh 23 16.000):

| Kolom `fin_cash_bank_tx_line` | Nilai |
| --- | ---: |
| `settled_amount` (Dilunasi) | 888.000 |
| `dpp_part` | 800.000 |
| `ppn_part` | 88.000 |
| `pph_amount` | 16.000 |

### 4.2 Jurnal

| Keterangan | Debit | Kredit |
| --- | ---: | ---: |
| Kas & Bank — dana diterima | 872.000 | |
| PPh Dibayar Dimuka (PPh 23, bukti potong menunggu) | 16.000 | |
| **Uang Muka Perizinan** (Customer) | | 800.000 |
| PPN Keluaran — PPN uang muka terutang saat diterima | | 88.000 |

**Kontras:** bentuknya sama dengan uang muka barang, kecuali account kreditnya
**Uang Muka Perizinan** (Account Mapping › Perizinan), bukan Uang Muka
Penjualan. Keduanya account terpisah, jadi laporan Uang Muka Customer
mencocokkan masing-masing dengan account-nya sendiri.

### 4.3 AR item

| Tabel | Isi |
| --- | --- |
| `fin_ar_item` baru, tipe **Uang Muka** | `source` = Uang Muka Perizinan; **`scope` = Pengajuan Perizinan** (`sal_permit_request`); `original_amount` 800.000 (DPP); `paid_amount` 888.000 |
| `fin_ar_ledger` | `Create` +800.000 |

**Kontras:** AR item uang muka barang ber-scope **Customer Order**. Scope
inilah yang membuat Invoice hanya bisa memakai uang muka dari Pengajuan yang
sama (P140).

Faktur pajak uang muka (satu baris uraian, tanpa item) dibuat lewat hook pajak.
Modul Pajak sedang disembunyikan (MC19), tapi untuk dokumen rupiah fakturnya
tetap dibuat.

---

## 5. Realisasi (`RLZ/…`)

Realisasi **bukan dokumen baru**. Ia diisi di Pengajuan yang sama
(`/sales/permit/[id]/realization`), kolom `realized_*` di header dan
`realized_price` di baris.

| Yang diisi | Aturan |
| --- | --- |
| Harga realisasi per baris estimasi | wajib diisi, rupiah penuh; **0 = izin itu tidak jadi diurus** |
| Izin tambahan (`is_added = true`) | boleh ditambah; estimasinya 0, harga realisasinya diisi |
| Tanggal Realisasi, Catatan | diketik |
| Total realisasi | harus > 0 untuk bisa direalisasikan |

Rumusnya `computePermitTotals` yang sama, dari harga realisasi:
`realized_amount`, `realized_dpp`, `realized_dpp_other`, `realized_ppn`,
`realized_total`.

Tombol **Realisasikan** memberi nomor `RLZ/YYYY/MM/NNNN` dan status
**Terealisasi**. Sesudah itu realisasi **masih bisa dikoreksi**, sampai ada
Invoice Perizinan atau pembayaran Biaya Perizinan yang hidup atas Pengajuan ini.

**Kontras:** padanannya di penjualan barang adalah Delivery Note. Bedanya:

| Delivery Note | Realisasi |
| --- | --- |
| dokumen sendiri, bisa banyak per Customer Order | satu per Pengajuan, di dokumen yang sama |
| mengubah **qty** terkirim; harga tetap dari Customer Order | mengubah **harga**; tidak ada qty |
| memposting jurnal HPP dan buku stok | **tidak memposting apa pun** |
| ditagih per baris, bisa sebagian | ditagih **sekaligus**, satu Invoice per Pengajuan |

### 5.1 Contoh

| Baris | Estimasi | Realisasi | Selisih |
| --- | ---: | ---: | ---: |
| PRE | 500.000 | 550.000 | +50.000 |
| BPOM | 100.000 | 100.000 | 0 |
| STAB | 200.000 | 180.000 | −20.000 |
| MICRO (tambahan) | 0 | 150.000 | +150.000 |
| **amount = DPP** | **800.000** | **980.000** | **+180.000** |
| DPP Nilai Lain | 733.333 | 898.333 | |
| PPN = round(12 % × DPP NL) | 88.000 | 107.800 | |
| **Total** | **888.000** | **1.087.800** | |

---

## 6. Biaya Perizinan (`BKK/…`) — biaya yang dibayar ke instansi

Perizinan ditagih **at cost**: DPP realisasi adalah uang yang dibayar
perusahaan ke instansi (BPOM, lab, dan lain-lain). Pembayarannya lewat Finance
› Kas & Bank › **Pengeluaran**, purpose **`permit_cost`** (*Biaya Perizinan*).

| Aturan | |
| --- | --- |
| Partner | Customer pemilik Pengajuan (penerima uang sebenarnya ditulis di referensi bank) |
| Dokumen yang dibayar | Pengajuan berstatus **Terealisasi atau Selesai** (`doc_type = sal_permit_request`) |
| Batas | Σ dibayar ≤ `realized_dpp`; boleh bertahap |
| Pajak | **tidak ada** PPN atau PPh |
| Tercatat di | `sal_permit_request.cost_paid_amount` |
| Akibat | realisasi **dikunci** begitu ada pembayaran biaya yang hidup |

Jurnal contoh (980.000 sekaligus):

| Keterangan | Debit | Kredit |
| --- | ---: | ---: |
| **Biaya Perizinan** realisasi RLZ/… | 980.000 | |
| Kas & Bank — dana dibayar, ref BPOM | | 980.000 |

**Kontras:** di penjualan barang biaya yang dibebankan adalah **HPP** yang
dijurnal otomatis oleh Delivery Note dari nilai stok. Di Perizinan biaya
dibebankan saat **uang benar-benar dibayar** ke instansi; tidak ada stok dan
tidak ada AR item untuk biaya ini.

Langkah ini bisa dilakukan kapan saja sesudah Terealisasi, sebelum atau sesudah
Invoice.

---

## 7. Invoice Perizinan (`INP/…`)

Tabel: `fin_ar_permit_invoice` dan `fin_ar_permit_invoice_advance_deduction`.
Menu: Finance › Invoice › Invoice Perizinan.

### 7.1 Data dari mana

| | Invoice Penjualan | Invoice Perizinan |
| --- | --- | --- |
| Sumber | satu Customer Order (Open / Ditutup) | satu Pengajuan **Terealisasi** |
| Baris | baris Delivery Note Posted, diambil utuh | **tidak ada tabel baris**; satu baris uraian di header |
| Nilai | harga baris CO × qty, kumulatif (P112) | **`realized_amount`** Pengajuan, sekaligus |
| Jumlah Invoice | banyak per Customer Order | **satu yang hidup per Pengajuan** |
| Tanggal Pajak | Tanggal Kirim terakhir | **= Tanggal Invoice** (tidak ada pengiriman) |
| Jatuh Tempo | Tanggal Pajak + Termin | Tanggal Invoice + Termin |
| Uang muka yang boleh dipakai | AR item ber-scope Customer Order itu | AR item ber-scope **Pengajuan itu**; terisi otomatis dari yang tertua |
| PPh | per Jenis PPh baris, dari DPP bersih | Jenis PPh tunggal Pengajuan, dari DPP bersih |

### 7.2 Perhitungan

Invoice Perizinan memanggil **`computeInvoice` yang sama** dengan Invoice
Penjualan, dengan **satu baris** yang dibuat di memori: amount = realisasi.
Jadi semua rumus dokumen 04 §6–§7 berlaku:

```
DPP              = realized_dpp (satu baris)
PPN penuh        = round(12 % × round(DPP × 11/12))           (full_ppn_amount — disimpan, beda dengan Invoice Penjualan)
DPP dipakai      = diketik per AR item uang muka, ≤ saldo, Σ ≤ DPP
PPN dipakai      = rantai(sebelum + dipakai) − rantai(sebelum)  (advancePpnUsed)
DPP bersih       = DPP − Σ DPP dipakai                         (net_dpp_amount)
PPN              = PPN penuh − Σ PPN dipakai                   (ppn_amount)
Total            = DPP bersih + PPN                            (total_amount)
Nilai penuh      = DPP + PPN penuh                             (= original_amount AR item)
PPh (estimasi)   = round(DPP bersih × tarif)
```

Karena hanya satu baris, PPN per baris sama dengan PPN dari total, jadi
konsisten dengan §2.2.

### 7.3 Contoh

| Kolom `fin_ar_permit_invoice` | Nilai | Rumus |
| --- | ---: | --- |
| `amount` = `dpp_amount` | 980.000 | realisasi |
| `dpp_other_amount` | 898.333 | round(980.000 × 11/12) |
| `full_ppn_amount` | 107.800 | round(12 % × 898.333) |
| `advance_dpp_amount` | 800.000 | diketik |
| `advance_ppn_amount` | 88.000 | rantai(800.000) − rantai(0) |
| `net_dpp_amount` | 180.000 | 980.000 − 800.000 |
| `ppn_amount` | 19.800 | 107.800 − 88.000 |
| **`total_amount`** | **199.800** | 180.000 + 19.800 |
| Nilai penuh | 1.087.800 | 980.000 + 107.800 |
| `tax_date` | = `invoice_date` | |
| `due_date` | `invoice_date` + 7 hari (Termin) | |

### 7.4 Jurnal

Bentuknya sama dengan Invoice Penjualan (dokumen 04 §8), hanya account-nya:

| Keterangan | Debit | Kredit | Pembanding barang |
| --- | ---: | ---: | --- |
| Piutang INP/… (Customer) | 1.087.800 | | sama |
| **Pendapatan Perizinan** | | 980.000 | Penjualan |
| PPN Keluaran — PPN atas jasa perizinan | | 107.800 | sama |
| **Uang Muka Perizinan** dipakai (Customer) | 800.000 | | Uang Muka Penjualan |
| PPN Keluaran — PPN uang muka sudah dilaporkan | 88.000 | | sama |
| Piutang — uang muka diterapkan (Customer) | | 888.000 | sama |
| **Total** | **1.975.800** | **1.975.800** | |

Bersih: Piutang +199.800, Pendapatan Perizinan −980.000, PPN Keluaran −19.800,
Uang Muka Perizinan +800.000 (habis).

### 7.5 AR item dan status Pengajuan

Sama dengan Invoice Penjualan (P117):

| Urutan | Item | Event | Movement |
| --- | --- | --- | ---: |
| 1 | Invoice baru (scope Pengajuan), `original_amount` 1.087.800 | `Create` | +1.087.800 |
| 2 | Uang Muka | `AdvanceUsed` | −800.000 |
| 3 | Invoice | `AdvanceApplied` | −888.000 |

Saldo item Invoice sesudahnya = 199.800 = `total_amount`.

Dalam transaksi yang sama, **Pengajuan berubah menjadi Selesai**
(`markPermitRequestInvoiced`), dan realisasi terkunci. Faktur pajak pelunasan
satu baris dibuat lewat hook pajak.

**Kontras:** Invoice Penjualan tidak menutup Customer Order; Customer Order
tertutup sendiri oleh pengiriman (Delivery Note), bukan oleh penagihan.

---

## 8. Pembayaran Invoice (Penerimaan `BKM/…`)

Lagi-lagi **purpose yang sama**, `customer_receipt`. Invoice Perizinan muncul di
*Pilih Tagihan* dengan badge **Inv. Perizinan** dan dilunasi **persis seperti
Invoice Penjualan**: sisa dibaca dari saldo AR item-nya, PPh dari DPP bersih,
dan **tidak ada PPN di jurnal** (PPN sudah dibukukan di Invoice).

### 8.1 Contoh

Customer mentransfer 196.200 = 199.800 − PPh 23 2 % × 180.000 (3.600):

| Kolom `fin_cash_bank_tx_line` | Nilai |
| --- | ---: |
| `settled_amount` | 199.800 |
| `dpp_part` / `ppn_part` (informasi saja) | 180.000 / 19.800 |
| `pph_amount` | 3.600 |

| Keterangan | Debit | Kredit |
| --- | ---: | ---: |
| Kas & Bank — dana diterima | 196.200 | |
| PPh Dibayar Dimuka (PPh 23) | 3.600 | |
| Piutang — pelunasan INP/… (Customer) | | 199.800 |

AR item Invoice: `Payment` −199.800 → saldo 0, `paid_amount` 199.800.

---

## 9. Ringkasan akhir contoh

### 9.1 AR item (scope: Pengajuan Perizinan)

| Item | Tipe | original | paid | saldo |
| --- | --- | ---: | ---: | ---: |
| ARI/…/0001 | Uang Muka | 800.000 | 888.000 | 0 |
| ARI/…/0002 | Invoice | 1.087.800 | 199.800 | 0 |

### 9.2 Buku Piutang

| # | Item | Event | Movement | Lawan |
| --- | --- | --- | ---: | --- |
| 1 | Uang Muka | Create (Penerimaan uang muka) | +800.000 | |
| 2 | Invoice | Create | +1.087.800 | |
| 3 | Uang Muka | AdvanceUsed | −800.000 | Invoice |
| 4 | Invoice | AdvanceApplied | −888.000 | Uang Muka |
| 5 | Invoice | Payment (Penerimaan invoice) | −199.800 | |

### 9.3 Uang yang bergerak

| | Masuk | Keluar |
| --- | ---: | ---: |
| Uang muka dari customer | 872.000 | |
| Pelunasan invoice dari customer | 196.200 | |
| Biaya ke instansi | | 980.000 |
| PPh 23 dipotong customer (kredit pajak) | 16.000 + 3.600 | |
| **Laba bruto** = Pendapatan 980.000 − Biaya 980.000 | **0** (at cost) | |

---

## 10. Hal yang belum dibangun

| | Status |
| --- | --- |
| Uang muka lebih besar dari realisasi (sisa uang muka dikembalikan) | **Pengembalian Uang Muka belum ada** (QZ9). Sisa tetap di AR item Uang Muka |
| Invoice Perizinan sebagian | tidak ada: satu Invoice per Pengajuan, sekaligus |
| Perizinan dalam valas | tidak ada: Perizinan selalu rupiah (P273) |
| Nota retur / koreksi invoice | belum ada, sama dengan penjualan barang |

---

## 11. Cek yang harus selalu benar

| Cek | Rumus |
| --- | --- |
| Estimasi | `estimate_total = estimate_dpp + estimate_ppn`, PPN dari total |
| Batas uang muka | Σ `amount` Uang Muka Perizinan hidup ≤ estimasi Pengajuan (DPP bila Exclude, Total bila Include) |
| AR item Uang Muka | `paid_amount` = Σ `settled_amount` baris Penerimaan Posted; saldo = DPP diterima − DPP dipakai |
| Invoice | `total = net_dpp + ppn`, `ppn = full_ppn − advance_ppn`, `dpp = realized_dpp` |
| AR item Invoice | `original_amount = dpp + full_ppn`; sesudah Posting saldo = `total_amount` |
| Satu Invoice | paling banyak satu Invoice Perizinan hidup per Pengajuan; Selesai tepat saat Invoice Posted |
| Biaya | `cost_paid_amount` = Σ baris Biaya Perizinan Posted ≤ `realized_dpp` |
| Account | saldo Uang Muka Perizinan per customer = Σ saldo AR item Uang Muka ber-scope Pengajuan (`db:reconcile`) |
