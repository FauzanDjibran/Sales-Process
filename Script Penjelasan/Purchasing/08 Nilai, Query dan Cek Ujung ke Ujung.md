# Purchasing — nilai, query dan cek ujung ke ujung

## 1. Satu nilai, dari PO sampai lunas

| Tahap | Dari mana nilainya | Account |
| --- | --- | --- |
| Purchase Order | qty × harga − diskon, per satuan beli | — |
| Receipt Note | bagian kumulatif DPP PO menurut **qty satuan beli** | Dr Persediaan / Cr GR/IR |
| Stok | nilai Receipt Note ÷ **qty dasar** = biaya per satuan dasar | Persediaan |
| Invoice Pembelian | DPP Receipt Note, disalin | Dr GR/IR / Cr Hutang |
| Pengeluaran | saldo item Invoice | Dr Hutang / Cr Kas & Bank |

Account **Barang Diterima Belum Ditagih (GR/IR)** bersaldo hanya selama barang sudah diterima tetapi
belum ditagih. Setelah semua ditagih, saldonya nol per supplier.

## 2. Keadaan satu Purchase Order

```sql
SELECT o.order_no, o.status, i.item_label, u.uom_label AS satuan, l.uom_factor,
       l.qty, l.received_qty, l.qty - l.received_qty AS sisa,
       l.base_qty, l.received_base_qty, l.dpp_amount
FROM pur_order o JOIN pur_order_line l ON l.order_id = o.id
JOIN m_item i ON i.id = l.item_id JOIN ref_uom u ON u.id = l.uom_id
WHERE o.order_no = 'PO/2026/11/0001';
```

## 3. Semua dokumen di belakang satu PO

```sql
SELECT 'Receipt Note' AS jenis, n.rn_no AS nomor, n.rn_date AS tanggal, n.status::text, n.value_amount AS nilai
FROM log_receipt_note n JOIN pur_order o ON o.id = n.source_doc_id
WHERE n.purpose = 'purchase_receipt' AND o.order_no = 'PO/2026/11/0001'
UNION ALL
SELECT 'Uang Muka', a.advance_no, a.advance_date, a.status::text, a.total_amount
FROM fin_ap_advance a JOIN pur_order o ON o.id = a.purchase_order_id WHERE o.order_no = 'PO/2026/11/0001'
UNION ALL
SELECT 'Invoice', v.invoice_no, v.invoice_date, v.status::text, v.total_amount
FROM fin_ap_invoice v JOIN pur_order o ON o.id = v.purchase_order_id WHERE o.order_no = 'PO/2026/11/0001';
```

## 4. Barang diterima yang belum ditagih

```sql
SELECT p.partner_label, n.rn_no, n.rn_date, l.line_no, l.qty, l.value_amount
FROM log_receipt_note_line l JOIN log_receipt_note n ON n.id = l.receipt_note_id
JOIN m_partner p ON p.id = n.partner_id
WHERE n.status = 'Posted' AND n.purpose = 'purchase_receipt'
  AND NOT EXISTS (SELECT 1 FROM fin_ap_invoice_line x JOIN fin_ap_invoice v ON v.id = x.invoice_id
                  WHERE x.receipt_note_line_id = l.id AND v.status = 'Posted')
ORDER BY p.partner_label, n.rn_date;
```

Jumlahnya per supplier = saldo GR/IR supplier itu.

## 5. Penimbangan dan bonus

```sql
SELECT n.rn_no, l.line_no, w.qty_sj, w.qty_weighting, w.weighting_result, w.qty_received, w.qty_bonus, r.receipt_no AS bonus
FROM log_receipt_note_weighting w
JOIN log_receipt_note_line l ON l.id = w.receipt_line_id
JOIN log_receipt_note n ON n.id = l.receipt_note_id
LEFT JOIN log_stock_receipt r ON r.purpose = 'purchase_bonus' AND r.source_doc_id = n.id;
```

## 6. `npm run db:reconcile`

| Cek | Membuktikan |
| --- | --- |
| PO: `base_qty` = qty × faktor; bagian PR ≤ `base_qty` | konversi dibekukan, PR tidak dipenuhi dua kali |
| PO: diterima = Σ Receipt Note, di dua satuan | tidak ada penerimaan yang hilang |
| Receipt Note: `base_qty` baris = Σ lot | stok = dokumen |
| Penimbangan: qty baris = hasil timbangan; bonus = Stock Receipt bernilai 0 | script 03 |
| Invoice: baris ditagih sekali, DPP = nilai penerimaan | GR/IR terhapus tepat |
| GR/IR = penerimaan − Invoice per supplier | account cocok dengan dokumen |
| AP item = Buku Hutang = Hutang Usaha / Uang Muka Pembelian | script 07 |

Semua cek harus *agree*; satu yang gagal menampilkan barisnya.

## 7. Belum ada di purchasing

Retur ke supplier, Debit Note Pembelian, Faktur Pajak Masukan dan Bukti Potong terbitan sendiri,
cetak PO, jadwal kirim bertahap. Rinciannya di `Purchase-UOM-Plan.md` §5.
