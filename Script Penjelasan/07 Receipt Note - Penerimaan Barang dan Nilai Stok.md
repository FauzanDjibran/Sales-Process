# Receipt Note — penerimaan barang dari supplier dan nilai stok

Dokumen ini menjelaskan apa yang terjadi pada **Receipt Note** (`RN/…`,
Persediaan › Receipt Note): dari mana nilai barang yang masuk, bagaimana nilai
itu dibagi ke baris dan lot, dan apa yang ditulis ke buku stok dan jurnal saat
Posting.

Kodenya ada di `src/lib/erp/receipt-note.ts` (dokumen),
`src/lib/erp/receipt-note-workflow.ts` (`cumulativeShare`, rumus pembagian
nilai) dan `src/lib/erp/inventory.ts` (`receiveStock`, buku stok). Angka contoh
di §6 dihitung dengan `cumulativeShare` yang asli. Aturan bisnisnya ada di P114,
P120, P122, P125, P136 dan W10 (`Claude-ERP.md`, `Purchasing-Concept.md`
B17–B22).

Dokumen ini menggambarkan keadaan saat semua dokumen masih dalam rupiah.
Rencana multi-currency (`Multi-Currency-Plan.md`) akan menambah nilai valas di
Purchase Order; buku stok dan jurnal tetap dalam rupiah.

---

## 1. Tiga hal yang perlu dipahami dulu

1. **Nilai barang masuk diambil dari Purchase Order, bukan diketik.** Nilainya
   adalah DPP baris Purchase Order (sebelum PPN) sebanding dengan kuantitas yang
   diterima. PPN tidak pernah masuk ke nilai stok.
2. **Pembagiannya kumulatif.** Beberapa Receipt Note untuk satu baris PO, atau
   beberapa lot dalam satu baris, selalu berjumlah tepat DPP baris PO. Selisih
   pembulatan diambil oleh penerimaan terakhir.
3. **Simpan tidak menyentuh stok.** Draft hanya menulis dokumennya. Nomor lot,
   stok, nilai dan jurnal ditulis saat Posting, dalam satu transaksi.

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
| Sudah diterima | `pur_order_line.received_qty` | tidak |
| Gudang | awalnya Gudang Tujuan PO, bisa diganti (hanya untuk PO Barang) | ya |
| Qty per baris | diketik, paling banyak sisa baris PO | ya |
| Lot per baris (Kelola Stok saja) | diketik: nomor lot, kedaluwarsa, lokasi, qty | ya |
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

## 3. Saat Simpan (Draft)

| Tabel | Isi |
| --- | --- |
| `log_receipt_note` | nomor `RN/YYYY/MM/NNNN` (`RN-NP/…` bila PO tanpa PPN), `status` Draft, `purpose` `purchase_receipt`, PO sebagai sumber (`source_doc_type_id`, `source_doc_id`, `source_no`), supplier, gudang, tanggal, No. Surat Jalan Supplier. `value_amount` 0, `journal_id` kosong |
| `log_receipt_note_line` | per baris: `qty`, `uom_factor`, `base_qty` = qty × faktor, `is_stock`. `value_amount` 0 |
| `log_receipt_note_tracking` | per lot (baris Kelola Stok saja): `tracking_seq`, nomor lot (boleh kosong), kedaluwarsa, lokasi, `qty`. `base_qty`, `value_amount` 0 dan `tracking_id` kosong |

**Yang dicek saat Simpan:**

- PO harus Open, dan supplier-nya masih aktif.
- Tanggal Terima tidak sebelum tanggal PO.
- Qty lebih dari 0, paling banyak 4 desimal, dan tidak melebihi sisa baris PO.
- Lot hanya untuk barang Kelola Stok. Jumlah lot tidak melebihi Qty baris; boleh
  belum lengkap.
- Gudang yang punya lokasi: lokasi harus milik gudang itu dan aktif. Satu nomor
  lot boleh dipecah ke beberapa lokasi, sekali per lokasi.

---

## 4. Saat Posting

Posting mengecek ulang semuanya, ditambah:

- **Lot harus lengkap**: jumlah lot = Qty baris.
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
Nilai lot = round(Nilai baris × (lot sebelumnya + qty lot) / Qty)
          − round(Nilai baris × lot sebelumnya / Qty)

base_qty lot = qty lot × uom_factor
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
| `log_receipt_note_tracking` | nomor lot final, `base_qty`, `value_amount` nilai lot, `tracking_id` |
| `log_receipt_note_line` | `value_amount` nilai baris |
| `log_receipt_note` | `status` Posted, `value_amount` = Σ baris, `journal_id` |
| `acc_journal` dan barisnya | lihat §4.4 |
| `pur_order_line.received_qty` | naik sebesar Qty baris; PO ditutup otomatis bila semua barisnya diterima penuh |
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
keluar ada di `04 Delivery Note - Pengiriman Barang dan Stok.md`.

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

Lot 1 (1,5 SAK = 37,5 KG): round(666.667 × 1,5/2) − 0       = 500.000
Lot 2 (0,5 SAK = 12,5 KG): 666.667 − round(666.667 × 1,5/2) = 166.667
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
Σ value_change log_stock_ledger (source = Receipt Note itu)
  = Σ value_change log_stock_valuation_ledger (source sama)
  = Σ nilai baris Kelola Stok
Σ debit jurnal = kredit Barang Diterima Belum Ditagih = log_receipt_note.value_amount
Σ nilai semua Receipt Note satu baris PO = pur_order_line.dpp_amount   (bila sudah diterima penuh)
```

Pemeriksaan lengkapnya ada di `npm run db:reconcile`, termasuk Barang Diterima
Belum Ditagih = penerimaan Posted − Invoice Posted, per supplier.
