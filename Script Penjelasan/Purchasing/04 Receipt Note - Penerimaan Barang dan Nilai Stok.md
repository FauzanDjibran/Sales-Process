# Receipt Note — penerimaan barang dari supplier dan nilai stok

Dokumen ini menjelaskan apa yang terjadi pada **Receipt Note** (`RN/…`,
Persediaan › Receipt Note): dari mana nilai barang yang masuk, bagaimana nilai
itu dibagi ke baris dan lot, dan apa yang ditulis ke buku stok dan jurnal saat
Posting.

Kodenya ada di `src/lib/erp/receipt-note.ts` (dokumen),
`src/lib/erp/receipt-note-workflow.ts` (`cumulativeShare`, rumus pembagian
nilai) dan `src/lib/erp/inventory.ts` (`receiveStock`, buku stok). Angka contoh
di §6 dihitung dengan `cumulativeShare` yang asli. Aturan bisnisnya ada di P114,
P120, P122, P125, P136, P320 dan W10 (`Claude-ERP.md`, `Purchasing-Concept.md`
B17–B22).

Untuk Purchase Order valas (P273), nilai stok memakai DPP base pada kurs PO;
DPP dalam valas disimpan terpisah di `order_dpp_amount` untuk Invoice Pembelian.
Buku stok dan jurnal tetap rupiah.

> Dokumen ini menggantikan `07 Receipt Note - Penerimaan Barang dan Nilai Stok.md`
> di folder atas. Sejak P320 lot dihitung dalam **satuan dasar**.

---

## 1. Empat hal yang perlu dipahami dulu

1. **Nilai barang masuk diambil dari Purchase Order, bukan diketik.** Nilainya
   adalah DPP baris Purchase Order (sebelum PPN) sebanding dengan kuantitas yang
   diterima. PPN tidak pernah masuk ke nilai stok.
2. **Pembagiannya kumulatif.** Beberapa Receipt Note untuk satu baris PO, atau
   beberapa lot dalam satu baris, selalu berjumlah tepat DPP baris PO. Selisih
   pembulatan diambil oleh penerimaan terakhir.
3. **Simpan tidak menyentuh stok.** Draft hanya menulis dokumennya. Nomor lot,
   stok, nilai dan jurnal ditulis saat Posting, dalam satu transaksi.

4. **Ada dua kuantitas** (P320). `qty` dalam satuan PO: dipakai memenuhi PO,
   menghitung nilai dan ditagih Invoice. `base_qty` dalam satuan dasar: dipakai
   lot dan stok. Di sinilah yang dibeli (BOX) dikonversi menjadi yang diterima
   (PCS), memakai faktor **baris PO**, bukan faktor master hari itu.

Alurnya:

```
Purchase Request → Purchase Order → Receipt Note → Invoice Pembelian
                    (harga, DPP)     (barang masuk,   (Hutang Usaha,
                                      nilai = DPP PO)   PPN Masukan)
```

---

## 2. Data dari mana

Receipt Note dibuat dari **satu Purchase Order berstatus Open** (`pur_order`).

| Di Receipt Note | Diambil dari | Bisa diubah user? |
| --- | --- | --- |
| Supplier | `pur_order.supplier_id` | tidak |
| Barang, satuan, faktor | baris `pur_order_line` | tidak |
| Kelola Stok | `m_item.track_stock` barang itu | tidak |
| DPP baris | `pur_order_line.dpp_amount` | tidak |
| Sudah diterima | `pur_order_line.received_qty` dan `received_base_qty` | tidak |
| Gudang | awalnya Gudang Tujuan PO, bisa diganti (hanya untuk PO Barang) | ya |
| Qty per baris | diketik, paling banyak sisa baris PO | ya |
| Lot per baris (Kelola Stok saja) | diketik: nomor lot, kedaluwarsa, lokasi, qty **dalam satuan dasar** | ya |
| Tanggal Terima, No. Surat Jalan Supplier, Catatan | diketik | ya |

**Sisa baris PO** = Qty PO − Qty yang sudah dipakai Receipt Note lain (Draft
maupun Posted). Tidak boleh menerima lebih dari yang dipesan; kelebihan harus
lewat perubahan PO.

**Jenis baris:**

| Barang | Masuk ke | Lot |
| --- | --- | --- |
| Barang dengan Kelola Stok | buku stok, di gudang, per lot | wajib |
| Barang tanpa Kelola Stok | langsung jadi beban | tidak ada |
| Jasa (PO Jasa) | langsung jadi beban (penerimaan jasa) | tidak ada |

---

## 2a. Dari qty PO ke qty dasar

```
sisa       = qty PO − qty Receipt Note lain (Draft dan Posted)
sisa dasar = base_qty PO − base_qty Receipt Note lain

Bila qty = sisa, atau round(qty × faktor, 4) ≥ sisa dasar:
    qty = sisa,  base_qty = sisa dasar       ← mengambil sisa keduanya
Selain itu:
    base_qty = round(qty × faktor, 4)
```

Jadi tidak ada pecahan yang tertinggal di salah satu satuan. Contoh: PO 100 BOX
isi 12, sudah diterima 41,666667 BOX (500 PCS). Sisa 58,333333 BOX masuk sebagai
tepat 700 PCS. Fungsinya `receivesRest` dan `receivedBaseQty`, dipakai form dan
server.

Qty yang diketik paling banyak 4 desimal; sisa baris boleh sampai 6.

Untuk item yang ditimbang, qty yang diketik adalah **Qty SJ** dan `qty` / `base_qty`
baris berasal dari timbangan: lihat `03 Penimbangan - Toleransi, Qty Terima dan Bonus.md`.

---

## 3. Saat Simpan (Draft)

| Tabel | Isi |
| --- | --- |
| `log_receipt_note` | nomor `RN/YYYY/MM/NNNN` (`RN-NP/…` bila PO tanpa PPN), `status` Draft, `purpose` `purchase_receipt`, PO sebagai sumber (`source_doc_type_id`, `source_doc_id`, `source_no`), supplier, gudang, tanggal, No. Surat Jalan Supplier. `value_amount` 0, `journal_id` kosong |
| `log_receipt_note_line` | per baris: `qty`, `uom_factor`, `base_qty` (lihat §2a), `is_stock`. `value_amount` 0 |
| `log_receipt_note_tracking` | per lot (baris Kelola Stok saja): `tracking_seq`, nomor lot (boleh kosong), kedaluwarsa, lokasi, `base_qty`. `value_amount` 0 dan `tracking_id` kosong |

**Yang dicek saat Simpan:**

- PO harus Open, dan supplier-nya masih aktif.
- Tanggal Terima tidak sebelum tanggal PO.
- Qty lebih dari 0, paling banyak 4 desimal, dan tidak melebihi sisa baris PO.
- Lot hanya untuk barang Kelola Stok. Jumlah lot tidak melebihi qty dasar baris;
  boleh belum lengkap.
- Gudang yang punya lokasi: lokasi harus milik gudang itu dan aktif. Satu nomor
  lot boleh dipecah ke beberapa lokasi, sekali per lokasi.

---

## 4. Saat Posting

Posting mengecek ulang semuanya, ditambah:

- **Lot harus lengkap**: jumlah lot = qty dasar baris.
- **Kedaluwarsa wajib** untuk barang yang memiliki kedaluwarsa.
- **Lokasi wajib** di gudang yang punya lokasi.
- **Nomor lot harus baru di seluruh sistem** (W10). Nomor yang sudah dipakai
  ditolak, kecuali dipakai lot lain di Posting yang sama (satu lot dipecah ke
  beberapa lokasi).
- **Akun harus ada**: Persediaan dari Kategori Item (atau Account Mapping),
  Beban dari Kategori Item (tanpa cadangan), dan Barang Diterima Belum Ditagih
  dari Account Mapping.

Lalu, per baris, berurutan:

### 4.1 Nilai baris

```
DPP_PO      = pur_order_line.dpp_amount
Qty_PO      = pur_order_line.qty
Sebelumnya  = pur_order_line.received_qty    (dari Receipt Note yang sudah Posted)
Qty         = qty baris Receipt Note ini       (satuan PO)

Nilai s.d.(q) = round(DPP_PO × q / Qty_PO)

Nilai baris = Nilai s.d.(Sebelumnya + Qty) − Nilai s.d.(Sebelumnya)
```

Kuantitasnya dalam satuan PO, bukan satuan dasar, karena DPP PO dihitung per
satuan PO. Penerimaan yang melengkapi baris PO mendapat sisa nilainya tepat,
sehingga semua penerimaan berjumlah DPP baris PO.

### 4.2 Nilai lot

Untuk barang Kelola Stok, nilai baris dibagi ke lotnya dengan cara yang sama,
sesuai urutan lot:

```
Nilai lot = round(Nilai baris × (lot sebelumnya + base_qty lot) / base_qty baris)
          − round(Nilai baris × lot sebelumnya / base_qty baris)
```

Lot terakhir mendapat sisa, jadi jumlah nilai lot = nilai baris.

### 4.3 Tabel yang ditulis

| Tabel | Isi |
| --- | --- |
| `log_stock_tracking` | lot baru: nomor (bila kosong dibuat `<nomor RN tanpa garis miring>-<baris>-<urutan>`, misalnya `RN2026110001-1-1`), barang, kedaluwarsa, supplier sebagai sumber |
| `log_stock_ledger` | satu baris per lot: `qty_change` +base_qty, `qty_balance` saldo bucket itu, `value_change` +nilai lot. Satu nomor `MS/…` per Posting |
| `log_stock_balance` | bucket gudang · lokasi · lot · status Tersedia naik sebesar base_qty |
| `log_stock_valuation_ledger` | satu baris per lot: `qty_change` dan `value_change` positif, lalu `qty_balance` (Q baru) dan `value_balance` (V baru). Satu nomor `MN/…` per Posting |
| `log_stock_valuation_balance` | Q dan V item itu naik |
| `log_receipt_note_tracking` | nomor lot final, `value_amount` nilai lot, `tracking_id` |
| `log_receipt_note_line` | `value_amount` nilai baris |
| `log_receipt_note` | `status` Posted, `value_amount` = Σ baris, `journal_id` |
| `acc_journal` dan barisnya | lihat §4.4 |
| `pur_order_line` | `received_qty` naik sebesar Qty baris, `received_base_qty` sebesar qty dasarnya; PO ditutup otomatis bila `received_base_qty` semua barisnya = `base_qty` |
| `audit_log` | event Posting |

Baris tanpa Kelola Stok (beban dan jasa) tidak menulis buku stok sama sekali;
nilainya hanya masuk jurnal.

### 4.4 Jurnal

Satu jurnal per Receipt Note, bertanggal Tanggal Terima:

```
Dr  Persediaan (Kategori Item, atau Account Mapping)   nilai baris   ← baris Kelola Stok
Dr  Beban (Kategori Item)                              nilai baris   ← baris lain dan Jasa
    Cr  Barang Diterima Belum Ditagih (Account Mapping)   Σ nilai baris, atas nama supplier
```

- Debit satu baris jurnal per baris Receipt Note; kredit satu baris untuk total.
- Barang Diterima Belum Ditagih adalah kewajiban sementara. Invoice Pembelian
  nanti mendebitnya sebesar nilai yang sama persis, karena Invoice menagih baris
  Receipt Note dengan harga PO.
- Baris bernilai 0 tidak membuat baris jurnal. Bila semuanya 0, tidak ada jurnal.

---

## 5. Rata-rata persediaan setelah penerimaan

Nilai kolam per item hanya ditambah. Rata-rata (V ÷ Q) tidak disimpan, jadi
penerimaan dengan harga berbeda langsung menggeser rata-rata, dan Delivery Note
berikutnya keluar dengan rata-rata baru itu:

```
Sebelum   Q = 100 KG, V = 4.000.000        rata-rata 40.000
Masuk     75 KG senilai 3.300.000
Sesudah   Q = 175 KG, V = 7.300.000        rata-rata 41.714,29
```

Penerimaan tidak pernah menyesuaikan barang yang sudah keluar. Rincian nilai
keluar ada di `../04 Delivery Note dan Invoice Penjualan - Nilai Keluar, Potongan Uang Muka dan Jurnal.md`.

---

## 6. Contoh lengkap

Barang B (Kelola Stok, satuan dasar KG). Purchase Order `PO/2026/11/0001`
memesan **3 SAK** (1 SAK = 25 KG), DPP baris **1.000.000** (Rp 333.333,33 per
SAK). Kolam barang B masih kosong.

### 6.1 Receipt Note pertama — 1 SAK, satu lot

```
Nilai baris = round(1.000.000 × 1/3) − round(1.000.000 × 0/3)
            = 333.333 − 0 = 333.333
Lot 1 (1 SAK = 25 KG): nilai = 333.333
```

| Tabel | Hasil |
| --- | --- |
| `log_stock_ledger` | lot `RN2026110001-1-1`: +25 KG, +333.333 |
| `log_stock_valuation_balance` | Q 25, V 333.333 |
| Jurnal | Dr Persediaan 333.333 / Cr Barang Diterima Belum Ditagih 333.333 |
| `pur_order_line.received_qty` | 1 |

### 6.2 Receipt Note kedua — 2 SAK, dipecah dua lot

```
Nilai baris = round(1.000.000 × 3/3) − round(1.000.000 × 1/3)
            = 1.000.000 − 333.333 = 666.667

Lot 1 (37,5 KG dari 50 KG): round(666.667 × 37,5/50) − 0       = 500.000
Lot 2 (12,5 KG):            666.667 − round(666.667 × 37,5/50) = 166.667
```

| Tabel | Hasil |
| --- | --- |
| `log_stock_ledger` | lot 1: +37,5 KG, +500.000 · lot 2: +12,5 KG, +166.667 (satu nomor `MS/…`, baris 1 dan 2) |
| `log_stock_valuation_ledger` | Q 62,5 · V 833.333, lalu Q 75 · V 1.000.000 |
| Jurnal | Dr Persediaan 666.667 / Cr Barang Diterima Belum Ditagih 666.667 |
| `pur_order_line.received_qty` | 3, PO ditutup otomatis |

Jumlah kedua penerimaan: 333.333 + 666.667 = **1.000.000**, tepat DPP baris PO.
Barang Diterima Belum Ditagih untuk supplier ini bersaldo 1.000.000, menunggu
Invoice Pembelian.

---

### 6.3 Contoh hasil menjalankan kode asli: 10 BOX, diterima 4 lalu 6

PO 10 BOX isi 12 @ Rp1.200.000 (DPP 12.000.000), PCS satuan dasar:

| | Receipt Note 1 | Receipt Note 2 |
| --- | ---: | ---: |
| `qty` (BOX) | 4 | 6 |
| `base_qty` (PCS) | 48 | 72 |
| `value_amount` | 4.800.000 | 7.200.000 |
| Lot (PCS → nilai) | 30 → 3.000.000 · 18 → 1.800.000 | 72 → 7.200.000 |
| Jurnal Dr Persediaan / Cr Barang Diterima Belum Ditagih | 4.800.000 | 7.200.000 |
| `received_qty` / `received_base_qty` PO sesudahnya | 4 / 48 | 10 / 120, PO ditutup |
| Kolam stok sesudahnya (Q · V) | 48 · 4.800.000 | 120 · 12.000.000 |

Invoice Pembelian menagih 4 BOX dan 6 BOX @ Rp1.200.000; PCS tidak muncul di sana.

---

## 7. Yang tidak terjadi di Receipt Note

- Tidak ada Hutang Usaha, PPN Masukan atau PPh. Semuanya dibuat Invoice
  Pembelian.
- Tidak ada harga yang diketik. Selisih harga dengan tagihan supplier diurus di
  Invoice Pembelian dengan toleransi; nilai stok tidak disesuaikan.
- Tidak bisa menerima lebih dari PO.
- Setelah Posted, Receipt Note tidak bisa diubah atau dibatalkan. Batalkan hanya
  untuk Draft, dengan alasan, dan mengembalikan kuantitasnya ke PO.

---

## 8. Cek setelah Posting

```
log_receipt_note.value_amount = Σ log_receipt_note_line.value_amount
log_receipt_note_line.value_amount = Σ log_receipt_note_tracking.value_amount   (baris Kelola Stok)
log_receipt_note_line.base_qty     = Σ log_receipt_note_tracking.base_qty       (baris Kelola Stok)
pur_order_line.received_qty / received_base_qty = Σ qty / Σ base_qty Receipt Note Posted
Σ value_change log_stock_ledger (source = Receipt Note itu)
  = Σ value_change log_stock_valuation_ledger (source sama)
  = Σ nilai baris Kelola Stok
Σ debit jurnal = kredit Barang Diterima Belum Ditagih = log_receipt_note.value_amount
Σ nilai semua Receipt Note satu baris PO = pur_order_line.dpp_amount   (bila sudah diterima penuh)
```

Pemeriksaan lengkapnya ada di `npm run db:reconcile`, termasuk Barang Diterima
Belum Ditagih = penerimaan Posted − Invoice Posted, per supplier.
