# Delivery Note — pengiriman barang dan buku stok

Dokumen ini menjelaskan apa yang terjadi pada **Delivery Note** (`SJ/…`,
Persediaan › Delivery Note): kapan tabelnya terisi, bagaimana nilai barang yang
keluar dihitung, dan tabel apa saja yang ditulis saat Posting.

Kodenya ada di `src/lib/erp/delivery-note.ts` (dokumen) dan
`src/lib/erp/inventory.ts` (buku stok). Contoh di §7 dijalankan dengan
fungsi aslinya di database lokal, lalu datanya dihapus lagi; angka dan urutan
barisnya adalah hasil keluarannya. Aturan bisnisnya ada di keputusan P93–P95,
P106, P114, P120, P122 dan P136 (`Claude-ERP.md`).

---

## 1. Tiga hal yang perlu dipahami dulu

1. **Delivery Note hanya urusan barang dan HPP.** Delivery Note tidak membuat
   Piutang, Penjualan atau PPN. Semua itu urusan Invoice Penjualan, yang nanti
   mengambil baris Delivery Note yang sudah Posted.
2. **Nilai barang keluar memakai rata-rata per item, bukan per lot.** Lot hanya
   menentukan *barang mana* yang diambil. *Nilainya* dihitung dari satu kolam
   nilai per item untuk seluruh perusahaan, jadi dua lot dengan harga beli
   berbeda keluar dengan nilai rata-rata yang sama.
3. **Simpan tidak menyentuh stok.** Draft hanya menulis dokumennya. Stok belum
   berkurang dan tidak dipesan, jadi dua Draft bisa memilih lot yang sama, dan
   yang di-posting belakangan ditolak kalau stoknya sudah habis. Semua
   perubahan stok dan jurnal terjadi saat Posting, dalam satu transaksi.

Alurnya:

```
Customer Order → Sales Order → Delivery Order → Delivery Note → Invoice Penjualan
 (harga, PPN)     (jadwal)      (perintah ke     (barang keluar,   (Piutang,
                                  gudang)          HPP)              Penjualan, PPN)
```

---

## 2. Data dari mana

Delivery Note dibuat dari **satu Delivery Order berstatus Diterbitkan**
(`sal_delivery_order`). Setelah disimpan, Delivery Order-nya terkunci.

| Di Delivery Note | Diambil dari | Bisa diubah user? |
| --- | --- | --- |
| Customer | `sal_delivery_order.customer_id` | tidak |
| Gudang | `sal_delivery_order.warehouse_id` | tidak |
| Alamat kirim | `sal_delivery_order.address_id` | tidak |
| Barang, satuan, faktor | baris `sal_delivery_order_line` (lewat baris Customer Order) | tidak |
| Qty per baris | diketik, paling banyak sisa baris Delivery Order | ya |
| Lot per baris | stok di gudang itu, dari `log_stock_balance` | ya |
| Tanggal Kirim, No. Kendaraan, Pengemudi, Catatan | diketik | ya |

**Sisa baris Delivery Order** = Qty DO − Qty yang sudah dipakai Delivery Note
lain (Draft maupun Posted). Jadi dua Draft tidak bisa mengambil kuantitas yang
sama dari satu baris Delivery Order. Ini berbeda dengan stok, yang tidak dipesan
oleh Draft.

**Pilihan lot** di layar membaca `log_stock_balance` milik item itu di gudang
itu:

```
Tersedia per lot = qty_balance − reserved_qty
```

`reserved_qty` adalah stok yang dipegang BSTB Issue berstatus Diajukan.
Daftarnya diurutkan dari kedaluwarsa paling awal (FEFO), dan *Isi FEFO*
mengisi lot demi lot sampai Qty baris terpenuhi. Gudang yang memakai lokasi
menampilkan satu pilihan per lot per lokasi.

---

## 3. Saat Simpan (Draft)

| Tabel | Isi |
| --- | --- |
| `log_delivery_note` | nomor `SJ/YYYY/MM/NNNN` (`SJ-NP/…` bila Customer Order tanpa PPN), `status` Draft, `purpose` `sales_delivery`, Delivery Order sebagai sumber (`source_doc_type_id`, `source_doc_id`, `source_no`), customer, gudang, alamat, tanggal, kendaraan, pengemudi. `cost_amount` 0, `journal_id` kosong |
| `log_delivery_note_line` | per barang: `qty`, `uom_factor`, `base_qty` = qty × faktor, barang dan satuan disalin dari sumbernya. `unit_cost` dan `cost_amount` 0 |
| `log_delivery_note_tracking` | per lot yang dipilih: lot, lokasi, nomor lot dan kedaluwarsa disalin seperti tercetak, `qty`. `base_qty`, `unit_cost` dan `cost_amount` 0 |

Tidak ada baris di buku stok, buku nilai, jurnal, atau Delivery Order.

**Yang dicek saat Simpan:**

- Delivery Order harus Diterbitkan, dan customer-nya masih aktif.
- Tanggal Kirim tidak sebelum tanggal Delivery Order.
- Qty lebih dari 0, paling banyak 4 desimal, dan tidak melebihi sisa baris
  Delivery Order.
- Lot harus milik item itu dan ada di gudang itu. Setiap lot hanya sekali per
  baris, dan jumlah lot tidak melebihi Qty baris. Lot boleh belum lengkap.

---

## 4. Saat Posting

Posting mengecek ulang semuanya, ditambah tiga aturan:

- **Lot harus terisi penuh**: jumlah lot = Qty baris.
- **Hanya Barang dengan Kelola Stok** yang bisa keluar.
- **Stok harus cukup per lot**: Qty lot ≤ Tersedia. Kalau kurang, Posting
  ditolak dengan menyebut lot, gudang, jumlah tersedia dan yang diminta.

Lalu, untuk setiap lot yang dipilih, berurutan:

### 4.1 Hitungan nilai satu lot

```
q = Qty lot × uom_factor                (kuantitas dalam satuan dasar)
Q = qty_balance  di log_stock_valuation_balance item itu
V = value_balance di log_stock_valuation_balance item itu

Nilai keluar  = round(V × q / Q)        bila q < Q   (setengah ke atas)
              = V                       bila q = Q   (kolam habis, nilainya keluar semua)

Q baru = Q − q
V baru = V − Nilai keluar
```

`Q` dan `V` adalah **seluruh** stok item itu di semua gudang, lot dan status.
Lot berikutnya dihitung dari `Q` dan `V` yang sudah berkurang oleh lot
sebelumnya. Kalau kolam habis, nilainya keluar semua, jadi tidak pernah tersisa
satu rupiah di kolam kosong.

### 4.2 Tabel yang ditulis

| Tabel | Isi |
| --- | --- |
| `log_stock_ledger` | satu baris per lot: `qty_change` −q, `qty_balance` sisa lot itu di bucket tersebut, `value_change` −nilai keluar. Satu nomor `MS/…` per Posting, `line_no` per lot |
| `log_stock_balance` | `qty_balance` bucket lot itu turun sebesar q |
| `log_stock_valuation_ledger` | satu baris per lot: `qty_change` −q, `value_change` −nilai keluar, lalu `qty_balance` (Q baru) dan `value_balance` (V baru). Satu nomor `MN/…` per Posting |
| `log_stock_valuation_balance` | Q dan V item itu turun |
| `log_delivery_note_tracking` | `base_qty` q, `cost_amount` nilai keluar, `unit_cost` = nilai ÷ q |
| `log_delivery_note_line` | `cost_amount` = Σ nilai lot-nya, `unit_cost` = cost ÷ `base_qty` |
| `log_delivery_note` | `status` Posted, `cost_amount` = Σ baris, `journal_id` |
| `acc_journal` dan barisnya | per baris barang: **Dr HPP / Cr Persediaan** sebesar `cost_amount` baris, bertanggal Tanggal Kirim |
| `sal_delivery_order_line.delivered_qty` | naik sebesar Qty baris |
| `sal_order_line.delivered_qty` dan `sal_customer_order_line.delivered_qty` | ikut naik lewat modul masing-masing |
| `audit_log` | event Posting |

Beberapa hal penting:

- **Akun jurnal**: HPP dan Persediaan diambil dari Account Kategori Item milik
  barang itu; kalau kosong, dari Account Mapping › Pengiriman Barang. Posting
  ditolak bila keduanya kosong.
- **Barang bernilai 0 tidak membuat jurnal.** Stoknya tetap keluar, tetapi
  `journal_id` kosong.
- **`unit_cost` hanya keterangan.** Nilai yang dipakai di mana pun adalah
  `cost_amount`; `unit_cost` tidak pernah dipakai untuk menghitung lagi.
- **Delivery Order, Sales Order dan Customer Order menutup diri sendiri** bila
  semua barisnya sudah terkirim penuh (status Ditutup).

Setelah Posted, Delivery Note tidak bisa diubah atau dibatalkan. Batalkan hanya
untuk Draft, dengan alasan, dan mengembalikan kuantitasnya ke Delivery Order.

---

## 5. Kenapa rata-rata per item, bukan harga lot

Lot B pada contoh §7 dibeli Rp 44.444 per PCS, lebih mahal dari lot A yang
Rp 40.000. Tetapi keduanya keluar sekitar Rp 41.026 per PCS, yaitu rata-rata
kolam item itu. Aturannya (P114, P120):

- Satu kolam nilai per item untuk seluruh perusahaan. Yang disimpan hanya
  kuantitas (Q) dan nilai (V); rata-rata = V ÷ Q tidak disimpan sebagai dasar
  hitungan.
- Lot dipakai untuk melacak barang dan kedaluwarsa, bukan untuk menilai.
- Karena itu Saldo Stok per gudang tidak menampilkan nilai; nilai per item ada
  di laporan Nilai Persediaan, dan harus sama dengan saldo akun Persediaan.

---

## 6. Yang tidak terjadi di Delivery Note

- Tidak ada Piutang, Penjualan, PPN atau AR item. Semua itu dibuat Invoice
  Penjualan dari baris Delivery Note yang sudah Posted.
- Tidak ada harga jual. Harga ada di Customer Order.
- Draft tidak memesan stok.
- Belum ada retur. Koreksi barang yang sudah keluar akan menjadi dokumen
  tersendiri.

---

## 7. Contoh lengkap

Barang A (Kelola Stok, satuan dasar PCS). Stok awal di satu gudang, dari dua
penerimaan:

| Lot | Qty | Nilai | Per PCS |
| --- | ---: | ---: | ---: |
| LA | 100 | 4.000.000 | 40.000 |
| LB | 30 | 1.333.333 | 44.444,43 |
| **Kolam item A** | **Q 130** | **V 5.333.333** | |

Customer Order 10 PCS → Sales Order 10 → Delivery Order `DO/2026/11/0001` 10
PCS, Diterbitkan. Delivery Note `SJ/2026/11/0001`: 10 PCS, diambil 7 dari LA
dan 3 dari LB.

### 7.1 Setelah Simpan

| Tabel | Isi |
| --- | --- |
| `log_delivery_note` | `SJ/2026/11/0001`, Draft, `source_no` `DO/2026/11/0001`, `cost_amount` 0, `journal_id` kosong |
| `log_delivery_note_line` | qty 10, faktor 1, `base_qty` 10, `unit_cost` 0, `cost_amount` 0 |
| `log_delivery_note_tracking` | LA qty 7 dan LB qty 3, semua nilai 0 |
| Buku stok dan Delivery Order | belum berubah: LA 100, LB 30, Q 130, V 5.333.333, `delivered_qty` 0 |

### 7.2 Hitungan saat Posting

```
Lot LA: q = 7 × 1 = 7
        Nilai keluar = round(5.333.333 × 7 / 130) = round(287.179,47) = 287.179
        Q = 130 − 7 = 123          V = 5.333.333 − 287.179 = 5.046.154

Lot LB: q = 3 × 1 = 3
        Nilai keluar = round(5.046.154 × 3 / 123) = round(123.076,93) = 123.077
        Q = 123 − 3 = 120          V = 5.046.154 − 123.077 = 4.923.077

Baris:  cost_amount = 287.179 + 123.077 = 410.256
        unit_cost   = 410.256 / 10 = 41.025,6
```

### 7.3 Setelah Posting

`log_stock_ledger` (baris baru):

| `ledger_no` | `line_no` | Lot | `qty_change` | `qty_balance` | `value_change` |
| --- | ---: | --- | ---: | ---: | ---: |
| `MS/2026/11/0007` | 1 | LA | −7 | 93 | −287.179 |
| `MS/2026/11/0007` | 2 | LB | −3 | 27 | −123.077 |

`log_stock_valuation_ledger` (baris baru):

| `ledger_no` | `line_no` | `qty_change` | `qty_balance` (Q) | `value_change` | `value_balance` (V) |
| --- | ---: | ---: | ---: | ---: | ---: |
| `MN/2026/11/0007` | 1 | −7 | 123 | −287.179 | 5.046.154 |
| `MN/2026/11/0007` | 2 | −3 | 120 | −123.077 | 4.923.077 |

`log_stock_balance`: LA 93, LB 27. `log_stock_valuation_balance` item A:
Q 120, V 4.923.077.

`log_delivery_note_tracking`:

| Lot | `qty` | `base_qty` | `cost_amount` | `unit_cost` |
| --- | ---: | ---: | ---: | ---: |
| LA | 7 | 7 | 287.179 | 41.025,571429 |
| LB | 3 | 3 | 123.077 | 41.025,666667 |

`log_delivery_note_line`: `cost_amount` 410.256, `unit_cost` 41.025,6.
`log_delivery_note`: Posted, `cost_amount` 410.256, `journal_id` terisi.

Jurnal `SJ/2026/11/0001 · Pengiriman DO/2026/11/0001 — <customer>`:

| Akun | Debit | Kredit |
| --- | ---: | ---: |
| HPP (Kategori Item barang A) | 410.256 | |
| Persediaan (Kategori Item barang A) | | 410.256 |

`delivered_qty` menjadi 10 di baris Delivery Order, Sales Order dan Customer
Order, dan ketiganya **Ditutup** karena sudah terkirim penuh. Delivery Note
kedua untuk Delivery Order ini ditolak: *Delivery Order harus berstatus
Diterbitkan*.

---

## 8. Cek setelah Posting

Yang harus selalu sama:

```
log_delivery_note.cost_amount  = Σ log_delivery_note_line.cost_amount
log_delivery_note_line.cost_amount = Σ log_delivery_note_tracking.cost_amount (baris itu)
Σ log_delivery_note_tracking.cost_amount = − Σ value_change di log_stock_ledger (source = Delivery Note itu)
                                         = − Σ value_change di log_stock_valuation_ledger (source sama)
                                         = debit HPP di jurnalnya
log_stock_balance.qty_balance  = Σ qty_change log_stock_ledger per bucket
log_stock_valuation_balance (Q, V) = Σ log_stock_valuation_ledger per item
V semua item  = saldo akun Persediaan di General Ledger
```

Contoh query untuk satu Delivery Note:

```sql
SELECT
  (SELECT cost_amount FROM log_delivery_note WHERE id = :dn) AS dn_cost,
  (SELECT -SUM(value_change) FROM log_stock_ledger l
     JOIN sys_doc_type t ON t.id = l.source_doc_type_id
    WHERE t.doc_table = 'log_delivery_note' AND l.source_doc_id = :dn) AS stock_ledger,
  (SELECT -SUM(value_change) FROM log_stock_valuation_ledger l
     JOIN sys_doc_type t ON t.id = l.source_doc_type_id
    WHERE t.doc_table = 'log_delivery_note' AND l.source_doc_id = :dn) AS valuation_ledger;
```

Ketiga angka harus sama. Pemeriksaan lengkapnya ada di `npm run db:reconcile`.
