# Uang Muka Pembelian — tagihan, Pengeluaran dan AP item

| Bagian | File |
| --- | --- |
| Tagihan uang muka | `src/lib/erp/ap-advance.ts`, `ap-advance-workflow.ts` |
| Nilai, PPN, PPh | `src/lib/erp/sales-tax.ts` (`computeAdvance`, `settleBill`) |
| Pengeluaran | `src/lib/erp/cash-payment.ts` |
| AP item | `src/lib/erp/ap-item.ts` (`payAdvance`) |

Aturan: P126, P127, P133, P214, P302, B23–B26. Angka contoh diuji `tests/ap-invoice.test.ts`.

## 1. Yang perlu dipahami

1. **Tagihannya tidak memposting apa pun.** Uang muka baru masuk buku saat **dibayar**.
2. **Satu tagihan, satu AP item.** Pembayaran pertama melahirkan item, pembayaran berikutnya
   menaikkannya.
3. **AP item bernilai DPP saja.** PPN-nya masuk PPN Masukan saat dibayar.
4. **PPh selalu dipotong** dari yang dilunasi; uang yang keluar = Dilunasi − PPh.

## 2. Tagihan (`fin_ap_advance`)

Dari satu Purchase Order **Open**, dipilih sekali. Nilainya satu angka, % atau Nominal, dalam mode
harga PO; PPN mengikuti rantai `round(tarif × round(DPP × 11/12))`. Estimasi PPh mengikuti Jenis
PPh baris PO (dua kali tarif untuk supplier tanpa NPWP / NIK).

- Total tagihan hidup satu PO tidak melebihi nilai PO, dicek di bawah kunci PO.
- Draft → *Terbitkan* → Diterbitkan; *Batalkan* ditolak bila sudah dibayar.

## 3. Pembayaran: Pengeluaran tujuan *Pembayaran ke Supplier*

User mengisi **Dilunasi** per tagihan. Sistem membaginya menurut posisi kumulatif:

```
bagian(x) = round(x × (sebelum + dilunasi) / total) − round(x × sebelum / total)

PPN  = bagian(PPN tagihan)
DPP  = dilunasi − PPN
PPh  = Σ bagian(PPh per Jenis PPh)
Uang = dilunasi − PPh
```

Jurnal saat Posting:

```
Dr  Uang Muka Pembelian (supplier)   DPP
Dr  PPN Masukan                      PPN
Dr  Beban Bank                       biaya bank, bila ada
    Cr  Kas & Bank                      uang + biaya bank
    Cr  Hutang PPh (Jenis PPh)          PPh
```

Di transaksi yang sama: Buku Kas & Bank keluar (saldo kurang ditolak) dan AP item Uang Muka.

| `fin_ap_item` | Diisi |
| --- | --- |
| `item_type`, `direction` | `Advance`, `Decrease` |
| sumber | tagihannya; `purchase_order_id` = PO |
| `original_amount`, `current_balance` | naik sebesar DPP |
| `paid_amount` | naik sebesar Dilunasi |

## 4. Contoh

PO 10 × Rp100.000, PPN, PPh 23 2 %. Uang muka 30 %:

| Angka | Nilai |
| --- | ---: |
| DPP | 300.000 |
| PPN = round(12 % × round(300.000 × 11/12)) | 33.000 |
| Total tagihan | 333.000 |
| PPh 2 % × 300.000 | 6.000 |

Dilunasi penuh 333.000:

| Jurnal | Debit | Kredit |
| --- | ---: | ---: |
| Uang Muka Pembelian | 300.000 | |
| PPN Masukan | 33.000 | |
| Kas & Bank | | 327.000 |
| Hutang PPh 23 | | 6.000 |

AP item Uang Muka: saldo 300.000, `paid_amount` 333.000. Di Invoice saldonya menjadi 0 (script 06).

## 5. Cek

```sql
SELECT a.advance_no, a.total_amount, i.ap_item_no, i.paid_amount, i.original_amount, i.current_balance
FROM fin_ap_advance a
LEFT JOIN fin_ap_item i ON i.item_type = 'Advance' AND i.source_doc_id = a.id
 AND i.source_doc_type_id = (SELECT id FROM sys_doc_type WHERE doc_table = 'fin_ap_advance');
```

`npm run db:reconcile`: item Uang Muka = account Uang Muka Pembelian per supplier, dan tidak ada
tagihan yang dibayar melebihi totalnya.
