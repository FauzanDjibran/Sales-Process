# Purchase Request — permintaan dalam satuan dasar

`PR/YYYY/MM/NNNN`, Pembelian › Permintaan. Dua menu atas satu tabel: **Barang** dan **Jasa**.

Kode: `src/lib/erp/purchase-request.ts`, `purchase-request-workflow.ts`. Aturan: P123,
P124, B6–B8.

## 1. Yang perlu dipahami

1. **Selalu satuan dasar.** Satuan tidak bisa dipilih; satuan beli baru muncul di Purchase Order.
2. **Tanggal Dibutuhkan ada di setiap baris.** Satu item boleh diminta untuk dua tanggal,
   tetapi tidak dua kali untuk tanggal yang sama.
3. **Tanpa supplier, harga, pajak dan persetujuan.**
4. **Menutup sendiri** saat semua barisnya sudah penuh di-PO.

## 2. Tabel

| Tabel | Isi |
| --- | --- |
| `pur_request` | jenis (Barang / Jasa), tanggal, Tanggal Dibutuhkan (default baris), Peminta, Gudang Tujuan (Barang saja) |
| `pur_request_line` | item, satuan dasar, `qty`, `needed_date`, **`ordered_qty`** (yang sudah di-PO, satuan dasar) |

## 3. Yang dicek

- Item sesuai jenisnya, Aktif, dan **Dapat Dibeli**.
- Qty lebih dari 0, paling banyak 4 desimal.
- Tanggal Dibutuhkan tidak sebelum tanggal Purchase Request.
- Gudang Aktif dan bukan Gudang Transit.

## 4. Langkah

| Langkah | Dari → ke | Akibat |
| --- | --- | --- |
| Ajukan | Draft → Open | bisa dipilih di Purchase Order |
| Batalkan (alasan) | Draft → Dibatalkan | final |
| Tutup (alasan) | Open → Ditutup | sisa tidak lagi ditawarkan |
| otomatis | Open → Ditutup | semua baris `ordered_qty` ≥ `qty` |
| otomatis | Ditutup → Open | PO ditolak, atau ditutup sebelum diterima, mengembalikan bagiannya |

`ordered_qty` hanya ditulis lewat `recordPurchaseRequestOrdered`, dipanggil Purchase Order saat
Ajukan, Tolak dan Tutup. Nilainya **boleh melebihi** `qty` bila PO memesan lebih.

## 5. Contoh

PR meminta 60 PCS untuk 20/10 dan 50 PCS untuk 01/11. Satu PO memesan 130 PCS.

| Baris | Diminta | Dipesan |
| --- | ---: | ---: |
| 20/10 | 60 | 60 |
| 01/11 | 50 | 50 |
| melebihi PR | — | 20 |

Kedua baris penuh, jadi PR menutup sendiri. Bila PO-nya ditolak, `ordered_qty` kembali 0 dan PR
terbuka lagi. Angka ini diuji `tests/purchase-order.test.ts`.

Halaman PR menampilkan tab **Purchase Order**: semua PO yang memakainya.

## 6. Cek

```sql
SELECT r.request_no, l.line_no, l.qty, l.ordered_qty, SUM(q.base_qty) AS bagian_po
FROM pur_request_line l JOIN pur_request r ON r.id = l.request_id
LEFT JOIN pur_order_line_request q ON q.request_line_id = l.id
LEFT JOIN pur_order_line pl ON pl.id = q.order_line_id
LEFT JOIN pur_order o ON o.id = pl.order_id AND o.status IN ('Submitted', 'Open', 'Closed')
WHERE q.id IS NULL OR o.id IS NOT NULL
GROUP BY r.request_no, l.id;
```
