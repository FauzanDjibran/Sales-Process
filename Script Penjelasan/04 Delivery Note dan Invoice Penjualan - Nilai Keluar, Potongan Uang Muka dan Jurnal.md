# Delivery Note dan Invoice Penjualan — nilai barang keluar, potongan uang muka dan jurnal

Dokumen ini menjelaskan dua dokumen yang berurutan:

1. **Delivery Note** (`SJ/…`, Persediaan › Delivery Note) — barang keluar dari
   gudang. Ia menghitung **berapa nilai stok yang keluar** dan menulis jurnal
   HPP.
2. **Invoice Penjualan** (`INV/…`, Finance › Invoice › Invoice Penjualan) —
   tagihan ke customer. Ia **mengambil baris Delivery Note**, memberi harga dari
   Customer Order, **memotong Uang Muka**, lalu menulis jurnal Piutang dan
   AR item.

Kodenya:

| Bagian | File |
| --- | --- |
| Delivery Note (cek, posting, jurnal) | `src/lib/erp/delivery-note.ts` |
| Buku stok (`issueStock`, rata-rata bergerak) | `src/lib/erp/inventory.ts` |
| Invoice (cek, posting, jurnal) | `src/lib/erp/ar-invoice.ts` |
| Rumus harga, PPN, potongan uang muka | `src/lib/erp/sales-tax.ts` (`invoiceLineFigures`, `computeInvoice`, `advancePpnUsed`, `allocate`) |
| AR item dan Buku Piutang | `src/lib/erp/ar-item.ts` (`createArItem`, `settleArItem`) |

Aturan bisnisnya: P94, P95, P97, P106, P112, P113, P114, P117, P118, P120,
P268 di `Claude-ERP.md`. **Semua angka contoh di §10 berasal dari menjalankan
kode asli** (Customer Order → Uang Muka → Penerimaan → 2 Delivery Note → 2
Invoice) di database lokal, bukan hitungan tangan.

Dokumen ini menggambarkan dokumen **rupiah**. Untuk dokumen USD (P273) rumusnya
sama, hanya dihitung dalam sen dan setiap angka punya kembaran `base_` (lihat
§12).

> Dokumen ini menggantikan `04 Delivery Note - Pengiriman Barang dan Stok.md`
> yang lama, yang masih menyebut kolom `qty` / `unit_cost` di tabel lot
> (sudah dihapus oleh P268).

---

## 1. Empat hal yang perlu dipahami dulu

1. **Delivery Note tidak tahu harga jual.** Ia hanya mengurus kuantitas dan
   **nilai stok** (harga pokok). Harga, diskon, PPN dan Piutang semuanya urusan
   Invoice.
2. **Nilai barang keluar = rata-rata bergerak per barang**, bukan harga lot.
   Lot hanya menunjukkan *barang yang mana*; nilainya diambil dari satu pool per
   barang (Q = qty, V = nilai).
3. **Invoice mengambil baris Delivery Note utuh.** Satu baris Delivery Note
   hanya bisa ditagih oleh satu Invoice yang hidup. Qty-nya tidak bisa diubah di
   Invoice.
4. **PPN Invoice = PPN penuh dikurangi PPN uang muka.** PPN per baris dihitung
   dari DPP penuh; PPN bagian uang muka yang dipakai dikurangi sekali di header
   (P113). Piutang lahir di nilai penuh lalu dikurangi uang muka (P117).

Alurnya:

```
Customer Order ──► Sales Order ──► Delivery Order ──► Delivery Note ──► Invoice Penjualan ──► Penerimaan
 (harga, PPN)      (jadwal)        (perintah kirim,   (barang keluar,   (Piutang, Penjualan,   (bayar
                                     gudang)            HPP/Persediaan)   PPN, potong UM)        Piutang)
      │
      └──► Uang Muka Penjualan ──► Penerimaan ──► AR item Uang Muka ──┘ (dipotong di Invoice)
```

---

## 2. Delivery Note — data dari mana

Delivery Note dibuat dari **satu Delivery Order berstatus Diterbitkan**
(purpose `sales_delivery`, sumbernya pasangan lemah `source_doc_type_id` /
`source_doc_id`).

| Di Delivery Note | Diambil dari | Bisa diubah user? |
| --- | --- | --- |
| Customer Order, Customer | Delivery Order (`sal_delivery_order`) | tidak |
| Gudang, Alamat Kirim | header Delivery Order | tidak |
| Barang, satuan, faktor | baris Delivery Order → Sales Order → Customer Order | tidak (disalin ke baris, P106) |
| Sisa DO | Qty baris DO − yang sudah dipegang Delivery Note lain (Draft **dan** Posted) | — |
| Qty per baris | diketik, paling banyak Sisa DO | ya |
| Lot per baris | dipilih di *Pilih Lot*: lot · lokasi · status, qty dalam **satuan dasar** | ya |
| Tanggal Kirim | diketik, tidak boleh sebelum tanggal Delivery Order | ya |
| No. Kendaraan, Pengemudi, Catatan | diketik | ya |

**Pilih Lot** membaca buku stok (`lotOptions` di `inventory.ts`): setiap
*bucket* = barang · gudang · lokasi · lot · status, dengan qty tersedia =
`qty_balance − reserved_qty`. Urutannya kedaluwarsa paling awal dulu (FEFO).
Delivery Note `sales_delivery` hanya boleh mengambil status **Tersedia**.

### 2.1 Aturan baris dan lot (`checkDeliveryNote`, `checkPicks`)

| Aturan | Kapan dicek |
| --- | --- |
| Qty > 0, paling banyak 4 desimal, ≤ Sisa DO | Simpan dan Posting |
| Satu baris DO hanya sekali per Delivery Note | Simpan |
| Satu bucket (lot · lokasi · status) hanya sekali per baris | Simpan |
| Σ qty lot ≤ base qty baris | Simpan (Draft boleh baru sebagian) |
| Σ qty lot **= tepat** base qty baris | **Posting** |
| Barang tanpa Kelola Stok tidak bisa dikeluarkan | Posting |
| Stok bucket cukup (`qty_balance − reserved_qty`) | Posting (di `issueStock`) |

`base qty baris = qty × faktor satuan`. Penjualan memakai satuan dasar (P108),
jadi faktornya 1 dan base qty = qty.

---

## 3. Delivery Note — perhitungan nilai barang keluar

Saat Posting, **setiap baris lot dikeluarkan sendiri-sendiri** lewat
`issueStock`, berurutan. Untuk tiap lot:

```
Pool barang (log_stock_valuation_balance):  Q = qty pool,  V = nilai pool
q = base_qty lot yang dikeluarkan

nilai keluar r =  V                        kalau q = Q   (mengosongkan pool)
                  round(V × q ÷ Q)          kalau q < Q   (kalikan dulu, bagi terakhir, half up)

Pool sesudahnya:  Q' = Q − q,   V' = V − r
```

- Rata-rata (V ÷ Q) **tidak disimpan dan tidak dipakai menghitung**. Ia hanya
  ditampilkan. Yang dipakai selalu V dan Q.
- Lot pertama mengubah pool, jadi lot kedua dihitung dari pool yang sudah
  berkurang. Urutan lot dalam baris = urutan `pick_no`.
- Kalau pool kosong lewat pengeluaran terakhir, V dilepas utuh, jadi pool tidak
  pernah menyisakan 1 rupiah.

Lalu disimpan:

| Kolom | Isi |
| --- | --- |
| `log_delivery_note_tracking.base_cost_amount` | r lot itu |
| `log_delivery_note_line.base_qty` | Σ `base_qty` lot-lotnya |
| `log_delivery_note_line.base_cost_amount` | Σ `base_cost_amount` lot-lotnya |
| `log_delivery_note.base_cost_amount` | Σ `base_cost_amount` baris |
| Harga Pokok di layar | `base_cost_amount ÷ base_qty` — dihitung saat dibaca, **tidak disimpan** (P213, P268) |

Di buku stok, setiap lot menulis satu baris di `log_stock_ledger` (qty, per
bucket) dan satu kembarannya di `log_stock_valuation_ledger` (nilai, per
barang), dengan `value_change = −r`.

### 3.1 Contoh

Barang A punya dua lot di gudang yang sama:

| Lot | Masuk | Nilai masuk |
| --- | --- | --- |
| LA1 | 6 PCS | 240.000 (40.000/PCS) |
| LA2 | 10 PCS | 430.000 (43.000/PCS) |
| **Pool A** | **Q = 16** | **V = 670.000** (rata-rata 41.875) |

Delivery Note 1 mengirim A 4 PCS: 3 dari LA1, 1 dari LA2.

| Lot | q | Rumus | r | Pool sesudah |
| --- | --- | --- | --- | --- |
| LA1 | 3 | round(670.000 × 3 ÷ 16) = round(125.625) | **125.625** | Q 13, V 544.375 |
| LA2 | 1 | round(544.375 × 1 ÷ 13) = round(41.875) | **41.875** | Q 12, V 502.500 |
| **Baris A** | 4 | | **167.500** | |

LA1 bernilai 40.000/PCS saat masuk, tapi keluar di 41.875/PCS: **yang dipakai
rata-rata pool, bukan harga lot**.

Delivery Note 2 mengirim sisa A 6 PCS (3 LA1 + 3 LA2):

| Lot | q | Rumus | r | Pool sesudah |
| --- | --- | --- | --- | --- |
| LA1 | 3 | round(502.500 × 3 ÷ 12) | 125.625 | Q 9, V 376.875 |
| LA2 | 3 | round(376.875 × 3 ÷ 9) | 125.625 | Q 6, V 251.250 |

---

## 4. Delivery Note — jurnal dan yang ditulis balik

### 4.1 Jurnal

Satu jurnal per Delivery Note, tanggal = **Tanggal Kirim**, **dua baris per
baris Delivery Note**:

| Account | Debit | Kredit |
| --- | --- | --- |
| HPP (Kategori Item barang itu, kalau kosong Account Mapping *Account HPP*) | `base_cost_amount` baris | |
| Persediaan (Kategori Item, kalau kosong Account Mapping *Account Persediaan*) | | `base_cost_amount` baris |

- **Tidak ada Piutang, Penjualan atau PPN** di sini.
- Baris dengan `base_cost_amount` = 0 tidak menulis jurnal; kalau semua 0, Delivery
  Note diposting tanpa jurnal (`journal_id` kosong).
- Account yang kosong menolak Posting dengan pesan
  *Lengkapi Account Mapping atau Account Kategori Item dulu*.

Delivery Note 1 contoh (A 4 PCS = 167.500, B 4 PCS = 80.000):

| Keterangan | Debit | Kredit |
| --- | ---: | ---: |
| HPP A · 4 PCS | 167.500 | |
| Keluar Gudang · A · 4 PCS (Persediaan) | | 167.500 |
| HPP B · 4 PCS | 80.000 | |
| Keluar Gudang · B · 4 PCS (Persediaan) | | 80.000 |
| **Total** | **247.500** | **247.500** |

### 4.2 Ditulis balik ke dokumen sumber

Delivery Note tidak menulis tabel modul lain. Ia memanggil fungsi milik
Delivery Order (`recordDeliveryOrderDelivery`):

| Yang ditulis | Akibat |
| --- | --- |
| `sal_delivery_order_line.delivered_qty` += qty | Delivery Order **Ditutup sendiri** kalau semua baris terkirim |
| `sal_order_line.delivered_qty` += qty | Sales Order Ditutup sendiri kalau semua terkirim |
| `sal_customer_order_line.delivered_qty` += qty | Customer Order Ditutup sendiri kalau semua terkirim (P97) |

Customer Order yang sudah Ditutup **tetap bisa ditagih**: penagihan datang
sesudah pengiriman.

### 4.3 Urutan Posting (satu transaksi)

1. Kunci periode fiskal dan Customer Order (lewat Delivery Order).
2. Cek ulang seluruh dokumen (`checkDeliveryNote`, `forPosting = true`).
3. Status Draft → Posted (gagal kalau status sudah berubah).
4. Per baris, per lot: `issueStock` → simpan `base_cost_amount` lot; jumlahkan ke
   baris.
5. Tulis jurnal; simpan `journal_id` dan `base_cost_amount` header.
6. Tulis balik `delivered_qty` ke Delivery Order (dan seterusnya).

Kalau satu langkah gagal (stok kurang, account kosong, periode terkunci),
**semuanya batal**. Dialog konfirmasi Posting menjalankan urutan yang sama lalu
di-rollback (*dry run*, P103), jadi jurnal di dialog = jurnal yang benar-benar
ditulis.

---

## 5. Invoice — bagaimana baris Delivery Note diambil

Invoice dibuat dari **satu Customer Order** berstatus Open atau Ditutup.
Tombol *Pilih Surat Jalan* menampilkan baris Delivery Note milik Customer Order
itu (`invoiceSourceLines`):

```
Customer Order ─► Delivery Order-nya ─► Delivery Note purpose sales_delivery,
                                         status Posted ─► barisnya
```

| Aturan (`checkInvoice`) | Pesan kalau dilanggar |
| --- | --- |
| Baris milik Delivery Note Customer Order ini | *Barang bukan bagian Delivery Note Customer Order ini.* |
| Delivery Note sudah Posted | *SJ/… belum diposting.* |
| Belum ditagih Invoice lain yang hidup (Draft atau Posted) | *Sudah ditagih dengan INV/….* |
| Sekali saja per Invoice | *… dipilih lebih dari sekali.* |
| Minimal satu baris | *Pilih minimal satu barang dari Delivery Note.* |

Baris diambil **utuh**: qty Invoice = `log_delivery_note_line.qty`. Satu
Invoice boleh mengambil baris dari beberapa Delivery Note, asal semuanya dari
Customer Order yang sama.

### 5.1 Tanggal

| Tanggal | Rumus |
| --- | --- |
| Tanggal Pajak (`tax_date`) | Tanggal Kirim **terakhir** dari Delivery Note yang ditagih |
| Tanggal Invoice (`invoice_date`) | diketik, **tidak boleh sebelum** Tanggal Pajak; ini tanggal jurnal |
| Jatuh Tempo (`due_date`) | Tanggal Pajak + hari Termin Customer Order |

Mode harga, Kena PPN, tarif PPN dan faktor DPP Nilai Lain **disalin dari
Customer Order** (snapshot), tidak dipilih di Invoice.

---

## 6. Invoice — harga per baris (bruto, diskon, jumlah)

Harga **tidak dikirim lewat Delivery Note**. Setiap baris Invoice mencari
baris Customer Order-nya (`customerOrderLineId`) dan mengambil:

| Dari `sal_customer_order_line` | Dipakai sebagai |
| --- | --- |
| `qty` | Qty CO (`orderQty`) |
| `price` (6 desimal, tidak dibulatkan, P111) | harga satuan |
| `amount + discount_amount` | bruto baris CO (`orderGross`) |
| `discount_amount` | diskon baris CO (`orderDiscount`) |
| `discount_type`, `discount_value` | Percent / Amount dan nilainya |

Ditambah **qty yang sudah ditagih sebelumnya** (`billedQtyBefore`) =
Σ qty Invoice **Posted** untuk baris CO itu, plus baris sebelumnya di Invoice
yang sama untuk baris CO yang sama.

### 6.1 Rumus kumulatif (P112, `invoiceLineFigures`)

Bruto dan diskon **tidak** dihitung qty × harga per Invoice. Yang dihitung
adalah angka baris CO **sampai dengan** Invoice ini, dikurangi angka **sampai
sebelum** Invoice ini:

```
s = billedQtyBefore,   t = s + qty Invoice ini

upTo(x):
  kalau x ≥ Qty CO → bruto = orderGross, diskon = orderDiscount      (angka tersimpan CO, tepat)
  selain itu:
    raw    = x × harga
    bruto  = round(raw)
    potong = Percent: raw × nilai% ÷ 100
             Amount : nilai × x ÷ Qty CO
    diskon = bruto − round(raw − potong)

bruto baris  = upTo(t).bruto  − upTo(s).bruto
diskon baris = upTo(t).diskon − upTo(s).diskon
jumlah baris = bruto baris − diskon baris
```

Kenapa kumulatif: kalau baris CO ditagih dalam beberapa Invoice, jumlah semua
Invoice-nya **selalu tepat** sama dengan baris CO, dan selisih pembulatan tidak
pernah menumpuk lebih dari Rp1.

Contoh kecil (dari fungsi asli): baris CO 3 PCS × 33.333,5, diskon Nominal
1.000 → bruto CO 100.001, diskon CO 1.000. Ditagih 1 PCS tiga kali:

| Invoice | s → t | Bruto | Diskon | Jumlah |
| --- | --- | ---: | ---: | ---: |
| ke-1 | 0 → 1 | 33.334 | 334 | 33.000 |
| ke-2 | 1 → 2 | 33.333 | 333 | 33.000 |
| ke-3 | 2 → 3 | 33.334 | 333 | 33.001 |
| **Σ** | | **100.001** | **1.000** | **99.001** = baris CO |

Hanya Invoice **Posted** yang dihitung sebagai "sebelumnya". Angka Draft
bersifat sementara dan dihitung ulang saat Posting.

### 6.2 DPP dan PPN per baris

Dari `jumlah baris`, per mode harga Customer Order:

```
Exclude: DPP = jumlah
Include: DPP, PPN = inclusiveSplit(jumlah)        (lihat dokumen 01)

DPP Nilai Lain baris = round(DPP × 11/12)
PPN baris            = round(12% × DPP Nilai Lain)     ← dari DPP PENUH baris
```

Tanpa PPN (Kena PPN = Tidak): DPP = jumlah, PPN = 0.

---

## 7. Invoice — potongan Uang Muka

### 7.1 Uang muka mana yang bisa dipakai

*Pilih Uang Muka* menampilkan **AR item tipe Uang Muka** (`fin_ar_item`,
`item_type = Advance`) yang lingkupnya (`scope_doc_*`) **Customer Order yang
sama** dan saldonya > 0. Uang muka order lain tidak bisa dipakai (sisa uang muka
dikembalikan, bukan dipindah).

| Kolom di dialog | Asal |
| --- | --- |
| No. item | `fin_ar_item.ar_item_no` |
| Saldo | `fin_ar_item.current_balance` — **DPP** uang muka yang belum dipakai |
| Dicadangkan | Σ `dpp_used` di `fin_ar_invoice_advance_deduction` milik Invoice **Draft lain** |
| Bebas | Saldo − Dicadangkan |

Saldo AR item Uang Muka adalah **DPP**, bukan nilai termasuk PPN: AR item lahir
dari Penerimaan sebesar bagian DPP yang dikreditkan ke Uang Muka Penjualan
(lihat dokumen 05 dan 06).

### 7.2 Yang diketik dan batasnya

User mengetik **DPP dipakai** per item.

| Aturan | Pesan |
| --- | --- |
| > 0, rupiah penuh | *Isi DPP yang dipakai lebih dari 0.* |
| ≤ Bebas item itu | *Melebihi sisa uang muka (…; … dicadangkan Invoice Draft lain).* |
| Σ DPP dipakai ≤ DPP Invoice | *Uang muka dipakai (…) melebihi DPP invoice (…).* |
| Tarif PPN dan faktor sama dengan tagihan uang muka | *Tarif PPN … berbeda dengan invoice …* (P113) |

### 7.3 PPN uang muka yang dipakai (P118, `advancePpnUsed`)

AR item hanya menyimpan DPP, jadi PPN bagian yang dipakai **dihitung ulang**
dengan rantai PPN, kumulatif per item:

```
dipakaiSebelum = original_amount − current_balance     (DPP item yang sudah dipakai Invoice Posted)
sesudah        = dipakaiSebelum + DPP dipakai

PPN dipakai = rantai(sesudah) − rantai(dipakaiSebelum)
rantai(x)   = round(12% × round(x × 11/12)),   rantai(0) = 0
```

Jadi kalau satu uang muka dipakai beberapa Invoice, Σ PPN dipakai = rantai DPP
uang muka seluruhnya = PPN di faktur uang mukanya (untuk uang muka yang dibayar
sekaligus).

Contoh: uang muka DPP 300.000 (PPN 33.000), dipakai 200.000 lalu 100.000:

| Pemakaian | Sebelum | Sesudah | rantai(sesudah) − rantai(sebelum) | PPN dipakai |
| --- | ---: | ---: | --- | ---: |
| Invoice 1 | 0 | 200.000 | 22.000 − 0 | **22.000** |
| Invoice 2 | 200.000 | 300.000 | 33.000 − 22.000 | **11.000** |
| **Σ** | | | | **33.000** |

### 7.4 Membagi uang muka ke baris — hanya untuk PPh

DPP uang muka dibagi ke baris sebanding DPP baris (`allocate`: dibulatkan ke
bawah, sisa pembulatan ke baris DPP terbesar). Hasilnya `advance_dpp_amount` dan
`net_dpp_amount` per baris. **Ini hanya dasar PPh** (PPh dihitung dari DPP
setelah uang muka). PPN baris tetap dari DPP penuh.

### 7.5 Angka header (`computeInvoice`)

```
DPP Invoice         = Σ DPP baris                       (dpp_amount)
UM dipakai          = Σ DPP dipakai                     (advance_dpp_amount)
DPP bersih          = DPP − UM dipakai                  (net_dpp_amount)
PPN penuh           = Σ PPN baris                       (tidak disimpan di header; = Σ ppn_amount baris)
PPN UM              = Σ PPN dipakai                     (advance_ppn_amount)
PPN                 = PPN penuh − PPN UM                (ppn_amount)
Total (Piutang bersih) = DPP bersih + PPN               (total_amount)

Nilai penuh (face)  = DPP + PPN penuh                   (tidak disimpan di header; = original_amount AR item)
```

Cek cepat: `face − total = UM dipakai + PPN UM`.

---

## 8. Invoice — jurnal

Satu jurnal per Invoice, tanggal = **Tanggal Invoice**. Pertama Invoice di
nilai penuh, lalu per uang muka yang dipakai:

| # | Account | Debit | Kredit | Partner |
| --- | --- | --- | --- | --- |
| 1 | Piutang Usaha | face (DPP + PPN penuh) | | Customer |
| 2 | Penjualan | | DPP | |
| 3 | PPN Keluaran | | PPN penuh | |
| *per uang muka:* | | | | |
| 4 | Uang Muka Penjualan | DPP dipakai | | Customer |
| 5 | PPN Keluaran | PPN dipakai | | |
| 6 | Piutang Usaha | | DPP dipakai + PPN dipakai | Customer |

Account dari Account Mapping › Faktur Penjualan (*Piutang Usaha*, *Penjualan*)
dan Penerimaan (*Uang Muka Penjualan*, *PPN Keluaran*).

Hasil bersih per account:

| Account | Bersih |
| --- | --- |
| Piutang Usaha | + total (DPP bersih + PPN) |
| Penjualan | − DPP penuh |
| PPN Keluaran | − PPN (penuh − PPN UM) |
| Uang Muka Penjualan | + DPP dipakai (saldo kreditnya berkurang) |

Kenapa PPN UM didebit: PPN atas uang muka **sudah** dikreditkan ke PPN
Keluaran saat Penerimaan uang muka dan sudah ada di faktur uang muka. Invoice
mengakui PPN penuh lalu mengembalikan bagian yang sudah dilaporkan.

### 8.1 AR item dan Buku Piutang (P117)

Ditulis di transaksi yang sama, **sebelum** jurnal:

| Urutan | Tabel | Event | Item | Movement |
| --- | --- | --- | --- | --- |
| 1 | `fin_ar_item` baru tipe Invoice, `original_amount` = face | `Create` | Invoice | + face |
| 2 | `fin_ar_ledger` | `AdvanceUsed` (*Dipakai Invoice*) | Uang Muka | − DPP dipakai |
| 3 | `fin_ar_ledger` | `AdvanceApplied` (*Uang Muka Diterapkan*) | Invoice | − (DPP dipakai + PPN dipakai) |

Setiap entri 2 dan 3 menyebut item lawannya (`counter_item_id`). Item Invoice
**selalu** dibuat, bahkan kalau uang muka menutup seluruhnya (saldo 0).
`paid_amount` tidak berubah oleh 2 dan 3: itu bukan pembayaran.

Sesudahnya `fin_ar_item.current_balance` Invoice = `total_amount` Invoice, dan
Penerimaan nanti melunasi dari saldo itu.

### 8.2 Urutan Posting (satu transaksi)

1. Kunci periode fiskal dan Customer Order.
2. Cek ulang seluruh Invoice (`checkInvoice`): baris belum ditagih, harga
   kumulatif dari Invoice Posted terbaru, saldo uang muka terbaru.
3. Status Draft → Posted, tulis ulang angka header dan baris.
4. Buat AR item Invoice; per uang muka `settleArItem` ×2; simpan
   `base_dpp_used`, `base_ppn_used`, `fx_difference` di baris potongan.
5. Tulis jurnal; simpan `journal_id` dan `ar_item_id`.
6. Faktur pajak lewat hook `afterPost` (modul Pajak; sedang disembunyikan,
   MC19, dan tidak dibuat untuk dokumen valas).

Dialog Posting memakai *dry run* yang sama (P103).

---

## 9. Ringkasan tabel yang ditulis

### Delivery Note

| Tabel | Kolom penting | Kapan |
| --- | --- | --- |
| `log_delivery_note` | `source_doc_id` (DO), `warehouse_id`, `dn_date`, `status`, `base_cost_amount`, `journal_id` | Simpan; cost & journal saat Posting |
| `log_delivery_note_line` | `source_doc_line_id` (baris DO), `item_id`, `uom_id`, `uom_factor`, `qty`, `base_qty`, `base_cost_amount` | Simpan; cost saat Posting |
| `log_delivery_note_tracking` | `tracking_id`, `location_id`, `stock_status_id`, `tracking_no`, `expiry_date`, `base_qty`, `base_cost_amount` | Simpan; cost saat Posting |
| `log_stock_ledger` / `_balance` | qty per bucket | Posting |
| `log_stock_valuation_ledger` / `_balance` | nilai per barang | Posting |
| `acc_journal(_line)` | Dr HPP / Cr Persediaan | Posting |
| `sal_delivery_order_line` / `sal_order_line` / `sal_customer_order_line` | `delivered_qty` | Posting |

### Invoice Penjualan

| Tabel | Kolom penting | Kapan |
| --- | --- | --- |
| `fin_ar_invoice` | `customer_order_id`, tanggal, snapshot PPN, `gross/discount/amount/dpp`, `advance_dpp_amount`, `advance_ppn_amount`, `net_dpp_amount`, `dpp_other_amount`, `ppn_amount`, `total_amount`, `journal_id`, `ar_item_id` | Simpan; ditulis ulang saat Posting |
| `fin_ar_invoice_line` | `delivery_note_line_id`, `customer_order_line_id`, `qty`, `price`, `gross/discount/amount`, `dpp_amount`, `advance_dpp_amount`, `net_dpp_amount`, `dpp_other_amount`, `ppn_amount` | Simpan; ditulis ulang saat Posting |
| `fin_ar_invoice_advance_deduction` | `ar_item_id`, `dpp_used`, `ppn_used`, `base_dpp_used`, `base_ppn_used`, `fx_difference` | Simpan (Draft = mencadangkan); base & fx saat Posting |
| `fin_ar_item`, `fin_ar_ledger` | §8.1 | Posting |
| `acc_journal(_line)` | §8 | Posting |

---

## 10. Contoh lengkap (hasil menjalankan kode)

**Customer Order** (Exclude, Kena PPN 12 % × 11/12, Termin 30 hari):

| Baris | Qty | Harga | Diskon | Bruto | Jumlah |
| --- | ---: | ---: | --- | ---: | ---: |
| A | 10 | 100.000 | 3 % | 1.000.000 | 970.000 |
| B | 4 | 50.000 | — | 200.000 | 200.000 |

**Uang Muka**: tagihan Nominal 300.000 (DPP) → PPN 33.000 → total 333.000,
dibayar penuh. AR item Uang Muka `ARI/…/0001`: original 300.000, saldo 300.000.

**Stok**: A pool 16 PCS / 670.000 (§3.1); B lot LB 10 PCS / 200.000.

### 10.1 Delivery Note

| Dokumen | Baris | Lot | base qty | cost |
| --- | --- | --- | ---: | ---: |
| SJ/…/0001 | A 4 | LA1 3 · LA2 1 | 4 | 125.625 + 41.875 = **167.500** |
| | B 4 | LB 4 | 4 | round(200.000 × 4 ÷ 10) = **80.000** |
| | | | header | **247.500** |
| SJ/…/0002 | A 6 | LA1 3 · LA2 3 | 6 | 125.625 + 125.625 = **251.250** |

Jurnal SJ/…/0001: Dr HPP 167.500 + 80.000 / Cr Persediaan 167.500 + 80.000
(§4.1). Jurnal SJ/…/0002: Dr HPP 251.250 / Cr Persediaan 251.250.

Sesudah SJ/…/0002 semua terkirim: Delivery Order, Sales Order dan Customer
Order **Ditutup sendiri**.

### 10.2 Invoice 1 — SJ/…/0001, uang muka DPP 200.000

Baris (s = 0 untuk keduanya):

| Baris | Qty | Bruto | Diskon | Jumlah = DPP | UM dibagi | DPP bersih | DPP NL | PPN |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 4 | 400.000 | 12.000 | 388.000 | 131.973 | 256.027 | 355.667 | 42.680 |
| B | 4 | 200.000 | 0 | 200.000 | 68.027 | 131.973 | 183.333 | 22.000 |
| **Σ** | | **600.000** | **12.000** | **588.000** | **200.000** | **388.000** | **539.000** | **64.680** |

- UM dibagi: floor(200.000 × 388.000 ÷ 588.000) = 131.972, floor(200.000 ×
  200.000 ÷ 588.000) = 68.027, sisa 1 ke A (DPP terbesar) → 131.973.
- PPN A: round(388.000 × 11/12) = 355.667 → round(12 % × 355.667) = 42.680.

Header:

| Angka | Nilai |
| --- | ---: |
| DPP | 588.000 |
| UM dipakai | 200.000 |
| DPP bersih | 388.000 |
| PPN penuh | 64.680 |
| PPN UM = rantai(200.000) − rantai(0) | 22.000 |
| PPN = 64.680 − 22.000 | 42.680 |
| **Total** = 388.000 + 42.680 | **430.680** |
| Face = 588.000 + 64.680 | 652.680 |

Jurnal INV/…/0001:

| Keterangan | Debit | Kredit |
| --- | ---: | ---: |
| Piutang INV/…/0001 — jatuh tempo … | 652.680 | |
| Penjualan barang SJ/…/0001 | | 588.000 |
| PPN atas penyerahan | | 64.680 |
| Uang muka ARI/…/0001 dipakai | 200.000 | |
| PPN uang muka ARI/…/0001 sudah dilaporkan | 22.000 | |
| Uang muka ARI/…/0001 diterapkan | | 222.000 |
| **Total** | **874.680** | **874.680** |

### 10.3 Invoice 2 — SJ/…/0002, sisa uang muka DPP 100.000

Baris A 6 PCS, s = 4 (sudah ditagih Invoice 1 Posted), t = 10 = Qty CO → upTo(10)
memakai angka tersimpan CO (bruto 1.000.000, diskon 30.000):

| | Bruto | Diskon | Jumlah |
| --- | ---: | ---: | ---: |
| upTo(10) | 1.000.000 | 30.000 | |
| upTo(4) | 400.000 | 12.000 | |
| **Baris** | **600.000** | **18.000** | **582.000** |

| Angka | Nilai |
| --- | ---: |
| DPP | 582.000 |
| PPN penuh: round(12 % × round(582.000 × 11/12)) = round(12 % × 533.500) | 64.020 |
| UM dipakai | 100.000 |
| PPN UM = rantai(300.000) − rantai(200.000) = 33.000 − 22.000 | 11.000 |
| PPN = 64.020 − 11.000 | 53.020 |
| DPP bersih | 482.000 |
| **Total** = 482.000 + 53.020 | **535.020** |
| Face = 582.000 + 64.020 | 646.020 |

Jurnal INV/…/0002: Dr Piutang 646.020 / Cr Penjualan 582.000 / Cr PPN Keluaran
64.020; Dr Uang Muka Penjualan 100.000, Dr PPN Keluaran 11.000 / Cr Piutang
111.000.

### 10.4 AR item dan Buku Piutang sesudah kedua Invoice

| Item | Tipe | original | paid | saldo |
| --- | --- | ---: | ---: | ---: |
| ARI/…/0001 | Uang Muka | 300.000 | 333.000 | **0** |
| ARI/…/0002 | Invoice 1 | 652.680 | 0 | **430.680** |
| ARI/…/0003 | Invoice 2 | 646.020 | 0 | **535.020** |

| # | Item | Event | Movement | Lawan |
| --- | --- | --- | ---: | --- |
| 1 | UM 0001 | Create (dari Penerimaan) | + 300.000 | |
| 2 | INV 0002 | Create | + 652.680 | |
| 3 | UM 0001 | AdvanceUsed | − 200.000 | INV 0002 |
| 4 | INV 0002 | AdvanceApplied | − 222.000 | UM 0001 |
| 5 | INV 0003 | Create | + 646.020 | |
| 6 | UM 0001 | AdvanceUsed | − 100.000 | INV 0003 |
| 7 | INV 0003 | AdvanceApplied | − 111.000 | UM 0001 |

`paid_amount` uang muka 333.000 adalah yang dibayar customer atas tagihan uang
mukanya (DPP + PPN); saldonya dalam DPP. Saldo Invoice = `total_amount`-nya.

---

## 11. Cek yang harus selalu benar

| Cek | Rumus |
| --- | --- |
| Baris DN = lot-lotnya | `line.base_qty = Σ tracking.base_qty`, `line.base_cost_amount = Σ tracking.base_cost_amount` |
| Header DN = barisnya | `log_delivery_note.base_cost_amount = Σ line.base_cost_amount` |
| Jurnal DN = nilai keluar | Σ debit HPP = Σ kredit Persediaan = `base_cost_amount` header |
| Buku stok = DN | Σ `value_change` valuasi dari DN = − `base_cost_amount` header |
| Baris CO tertagih penuh | Σ bruto / diskon / jumlah Invoice Posted = angka baris CO |
| Header Invoice | `total = net_dpp + ppn`, `ppn = Σ ppn baris − advance_ppn`, `net_dpp = dpp − advance_dpp` |
| PPN uang muka | Σ `ppn_used` semua Invoice atas satu item = rantai(DPP item yang terpakai) |
| AR item Invoice | `original_amount = dpp_amount + Σ ppn_amount baris`; sesudah Posting `current_balance = total_amount` |
| Piutang di GL = AR item | saldo Piutang Usaha per customer = Σ saldo AR item Invoice (`db:reconcile`) |

---

## 12. Catatan valas (P273)

Untuk Customer Order USD:

- Rumus di §6–§7 dihitung dalam **sen** (`taxScale` = 100), half up yang sama.
- Setiap angka Invoice punya kembaran `base_…` = angka × kurs Customer Order.
- **Delivery Note tidak berubah**: nilai stok selalu rupiah.
- Uang muka dilepas di **kurs bawaannya sendiri**; Invoice di kurs order. Beda
  keduanya dicatat sebagai `fx_difference` di baris potongan dan satu baris
  jurnal *Selisih Kurs* (Account Mapping *Account Selisih Kurs*).
- Tidak ada faktur pajak untuk dokumen valas selama modul Pajak menunggu (MC15).
