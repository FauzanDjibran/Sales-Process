# Purchase Order — satuan alternatif dan pembagian ke Purchase Request

Dokumen ini menjelaskan apa yang terjadi pada **Purchase Order** (`PO/…`,
Pembelian › Pesanan): satuan dan harga barisnya, konversinya ke satuan dasar,
dan bagaimana kuantitasnya dibagi ke Purchase Request.

| Bagian | File |
| --- | --- |
| Cek, simpan, langkah Ajukan / Tolak / Tutup | `src/lib/erp/purchase-order.ts` |
| Pembagian ke PR, tarif PPh (dipakai form juga) | `src/lib/erp/purchase-order-workflow.ts` (`sharePurchaseOrderLine`, `purchaseWithholdingRate`) |
| Harga, diskon, DPP, PPN | `src/lib/erp/sales-tax.ts` (`computeSalesTotals`) |
| Form | `src/components/purchasing/purchase-order-form.tsx` |

Aturan bisnisnya: P124, P320 (`Claude-ERP.md`), B9–B16 (`Purchasing-Concept.md`),
`Purchase-UOM-Plan.md`. Contoh §6 memakai angka test `tests/purchase-order.test.ts`.

---

## 1. Empat hal yang perlu dipahami dulu

1. **Purchase Request selalu satuan dasar; Purchase Order boleh satuan lain**,
   yaitu satuan dasar item atau salah satu dari *Konversi Satuan* item itu.
2. **Qty dan harga diketik dalam satuan yang dipilih.** Pilih BOX isi 12 lalu
   ketik 9: yang dibeli 9 BOX (108 PCS), harganya per BOX.
3. **Yang ditagih nanti adalah satuan PO.** Qty dasar dipakai untuk memenuhi
   Purchase Request dan, di Receipt Note, untuk stok.
4. **Purchase Order tidak memposting apa pun.** Tidak ada jurnal atau stok.

---

## 2. Kolom kuantitas di `pur_order_line`

| Kolom | Isi |
| --- | --- |
| `uom_id`, `uom_factor` | satuan baris dan isi satuan dasarnya, disalin dari `m_item_uom.factor` (1 untuk satuan dasar) |
| `qty`, `price` | dalam satuan baris |
| `base_qty` | `round(qty × uom_factor, 4)` |
| `received_qty` | yang diterima, satuan baris; ditulis Receipt Note |
| `received_base_qty` | yang diterima, satuan dasar; ditulis Receipt Note |

`uom_factor` dan `base_qty` ditulis saat Simpan dan **dibekukan saat Ajukan**.
Mengubah Konversi Satuan item sesudahnya tidak mengubah Purchase Order itu.

Satuan Dasar item sendiri terkunci begitu item dipakai di dokumen atau stok
(`itemInUse` di `src/lib/erp/item.ts`), karena semua `base_qty` dihitung dengannya.

---

## 3. Yang dilakukan form

| Tindakan | Akibat |
| --- | --- |
| Pilih baris PR | Satu item menjadi satu baris dalam satuan dasar, Qty = sisa PR. PR lain untuk item itu digabung |
| Ganti satuan | **Qty dan Harga dikosongkan**; keduanya diketik ulang dalam satuan baru |
| Tambah PR untuk item yang barisnya sudah BOX | PR ikut ke baris itu; Qty BOX tidak diubah |
| Cabut PR dari baris BOX | PR lepas; Qty BOX tidak diubah |
| Item tanpa Konversi Satuan | Satuan tampil sebagai teks |

Di bawah Qty tampil `= 108 PCS` bila satuannya bukan satuan dasar.

---

## 4. Yang dicek saat Simpan (dan diulang saat Ajukan)

- Satuan harus milik item; Qty dan Harga lebih dari 0, Qty paling banyak 4 desimal.
- Qty dasar lebih dari 0.
- Setiap baris menaungi minimal satu baris PR Open dari item yang sama, dan satu
  baris PR hanya dipakai sekali per Purchase Order.
- Jenis PPh harus jenis pembelian; supplier tanpa NPWP / NIK dipotong dua kali tarif.

---

## 5. Pembagian ke Purchase Request

```
sisa = base_qty baris
untuk setiap baris PR, Tanggal Dibutuhkan paling awal dulu:
    bagian = min(sisa, kebutuhan PR − yang sudah di-PO)
    sisa   = sisa − bagian
yang masih tersisa = "melebihi PR", tidak milik PR mana pun
```

| Langkah | Yang terjadi pada PR |
| --- | --- |
| Draft | bagian disimpan sementara di `pur_order_line_request.base_qty`; PR belum dipesan |
| Ajukan | bagian dihitung ulang dan ditulis ke PR (`ordered_qty`); PR yang penuh menutup sendiri |
| Tolak | semua bagian dikembalikan |
| Tutup | yang belum diterima dikembalikan, kebutuhan paling akhir dulu; yang tetap = `received_base_qty` |

Purchase Order menutup sendiri saat `received_base_qty` semua barisnya mencapai `base_qty`.

---

## 6. Contoh

PR meminta 100 PCS. Purchase Order 9 BOX @ Rp24.000.

| | Faktor 12 | Faktor diubah 13 sebelum Ajukan |
| --- | ---: | ---: |
| Nilai (qty × harga) | 9 × 24.000 = 216.000 | 216.000 |
| `base_qty` | 108 | 117 |
| Bagian PR | 100 | 100 |
| Melebihi PR | 8 | 17 |
| PR | Ditutup | Ditutup |

Faktor hanya memengaruhi PCS. Nilai yang dibayar tetap 9 BOX × harga per BOX.

---

## 7. Cek

```sql
SELECT o.order_no, l.line_no, l.qty, l.uom_factor, l.base_qty, SUM(q.base_qty) AS bagian_pr
FROM pur_order_line l JOIN pur_order o ON o.id = l.order_id
LEFT JOIN pur_order_line_request q ON q.order_line_id = l.id
GROUP BY o.order_no, l.id;
```

`npm run db:reconcile` membuktikan `base_qty = round(qty × uom_factor, 4)`, bagian PR
tidak melebihi `base_qty`, dan yang diterima = Receipt Note Posted di kedua satuan.
