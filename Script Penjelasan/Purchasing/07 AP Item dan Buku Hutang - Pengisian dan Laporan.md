# AP item dan Buku Hutang — pengisian dan laporan

Satu-satunya penulis kedua tabel: `src/lib/erp/ap-item.ts`. Aturan: P127, P129, P133, P214, B32–B33.
Angka contoh diuji `tests/ap-invoice.test.ts`.

## 1. Yang perlu dipahami

1. **`fin_ap_item` menyimpan saldo**, `fin_ap_ledger` (Buku Hutang) menyimpan setiap perubahannya.
   Saldo = jumlah entrinya, ditulis dalam transaksi yang sama.
2. **Satu dokumen, satu item.** Item menyimpan berapa dokumennya sudah dibayar (`paid_amount`).
3. **Dua jenis:** Invoice menaikkan Hutang Usaha, Uang Muka menurunkannya.
4. Saldo tidak pernah di bawah nol, dan entri tidak pernah diubah.

## 2. Kolom

| `fin_ap_item` | Isi |
| --- | --- |
| `ap_item_no` | `API/YYYY/MM/NNNN` |
| `item_type`, `direction` | Invoice / Increase, Advance / Decrease |
| `source_doc_*` | tagihan uang muka atau Invoice Pembelian |
| `purchase_order_id` | Invoice hanya memakai uang muka PO-nya sendiri |
| `original_amount`, `current_balance` | nilai lahir dan saldo |
| `paid_amount` | Dilunasi lewat Pengeluaran (uang + PPh) |
| `base_*` | kembarannya dalam rupiah, untuk dokumen valas |

| `fin_ap_ledger` | Isi |
| --- | --- |
| `ledger_no`, `line_no` | `BH/…` satu nomor per posting |
| `event` | Create, AdvanceReceived, AdvanceUsed, AdvanceApplied, Payment |
| `movement` | bertanda: + saldo naik, − saldo turun |
| `doc_*`, `counter_item_id` | dokumen penyebab dan item lawannya |

## 3. Kapan terisi

| Kejadian | Item Uang Muka | Item Invoice |
| --- | --- | --- |
| Pengeluaran pertama atas tagihan uang muka | lahir, +DPP (`Create`) | |
| Pengeluaran berikutnya atas tagihan itu | +DPP (`AdvanceReceived`) | |
| Invoice Pembelian diposting | | lahir, +Hutang (`Create`) |
| uang muka dipakai Invoice itu | −DPP (`AdvanceUsed`) | −(DPP + PPN) (`AdvanceApplied`) |
| Pengeluaran atas Invoice | | −Dilunasi (`Payment`) |

Tagihan uang muka yang belum dibayar, Purchase Order dan Receipt Note **tidak** membuat item.
Hutang dari barang yang belum ditagih ada di account Barang Diterima Belum Ditagih.

## 4. Contoh (cerita script 05 dan 06)

| Urutan | Item Uang Muka | Item Invoice |
| --- | ---: | ---: |
| Bayar uang muka 333.000 | +300.000 → 300.000 | |
| Invoice diposting | | +1.096.050 → 1.096.050 |
| Uang muka dipakai | −300.000 → **0** | −333.000 → 763.050 |
| Pelunasan 763.050 | | −763.050 → **0** |

`paid_amount` akhirnya: item Uang Muka 333.000, item Invoice 763.050.

Selisih 33.000 antara kedua sisi pemakaian adalah PPN uang muka: ia tidak pernah ada di item Uang
Muka, karena sudah masuk PPN Masukan saat dibayar.

## 5. Laporan (Finance › Laporan)

| Laporan | Isi |
| --- | --- |
| Buku Hutang | entri per supplier; buku Hutang Usaha atau Uang Muka Supplier |
| Saldo Hutang | saldo awal, bertambah, berkurang, akhir per supplier dan dokumen |
| Umur Hutang | Invoice terbuka menurut jatuh tempo, beserta Uang Muka |
| Uang Muka Supplier | uang muka terbuka per supplier dan PO, dicocokkan ke General Ledger |

Semua dibaca dari Buku Hutang pada tanggalnya, jadi tanggal lampau tampil sebagaimana saat itu.

## 6. Cek

```sql
SELECT i.ap_item_no, i.item_type, i.current_balance, SUM(l.movement) AS dari_buku
FROM fin_ap_item i LEFT JOIN fin_ap_ledger l ON l.item_id = i.id
GROUP BY i.id HAVING i.current_balance <> COALESCE(SUM(l.movement), 0);   -- harus kosong
```
