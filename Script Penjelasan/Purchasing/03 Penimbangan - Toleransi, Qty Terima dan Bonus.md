# Penimbangan di Receipt Note — toleransi, Qty Terima dan bonus

Dokumen ini menjelaskan bagaimana barang yang ditimbang diterima: dari Qty Surat
Jalan (SJ) supplier dan hasil timbangan menjadi Qty Terima dan bonus.

| Bagian | File |
| --- | --- |
| Rumus (dipakai modal, Simpan dan Posting) | `src/lib/erp/receipt-weighting.ts` (`weigh`) |
| Setelan per item | `src/lib/erp/item.ts` (`checkItemWeighting`, `writeItemWeighting`) |
| Cek, simpan, posting | `src/lib/erp/receipt-note.ts` |
| Bonus yang menunggu | `src/lib/erp/receipt-note.ts` (`postedBonuses`) |
| Stock Receipt bonus | `src/lib/erp/stock-receipt.ts` (`createStockReceipt`, `receiveStockReceipt`) |
| Modal | `src/components/inventory/receipt-weigh-dialog.tsx` |

Aturan bisnisnya: P321 (`Claude-ERP.md`), `Purchase-UOM-Plan.md` §3. **Angka contoh
§6 berasal dari menjalankan kode asli** di database lokal.

---

## 1. Empat hal yang perlu dipahami dulu

1. **Yang diketik adalah Qty SJ dan Qty Timbangan.** Qty Terima dihitung sistem.
2. **Item ditimbang bila punya Timbangan** di master: Berat Satuan (Kg per satuan
   dasar) dan Toleransi (%).
3. **Hasil timbangan mengisi `qty` dan `base_qty` baris Receipt Note.** Sesudah itu
   nilai, stok, jurnal, sisa PO dan Invoice berjalan seperti biasa.
4. **Bonus bernilai 0** dan masuk lewat Stock Receipt yang dibuat gudang (P339).

Urutannya: klik field Qty baris → modal Penimbangan (Qty SJ, Qty Timbangan) → bagi lot → Posting.

---

## 2. Rumus

```
SJ dasar    = Qty SJ × faktor PO                     (satuan dasar, 4 desimal)
Pembanding  = SJ dasar × Berat Satuan                (Kg)
Batas bawah = Pembanding × (1 − Toleransi)
Batas atas  = Pembanding × (1 + Toleransi)
```

| Timbangan | Hasil | Qty Terima (satuan dasar) | Bonus (satuan dasar) |
| --- | --- | --- | --- |
| di antara batas, batasnya termasuk | Dalam Toleransi | SJ dasar | — |
| > batas atas | Di atas Toleransi | SJ dasar | (Timbangan − **batas atas**) ÷ Berat Satuan |
| < batas bawah | Di bawah Toleransi | Timbangan ÷ Berat Satuan | — |

```
Qty Terima (satuan PO) = Qty SJ, atau Qty Terima dasar ÷ faktor (6 desimal) bila di bawah toleransi
```

Hasil bagi berat dibulatkan **ke bawah** pada desimal ke-4. Akibat toleransi:
timbangan 720 dari range 720–880 diterima 800, sedangkan 719 diterima 719; kelebihan
sampai batas atas tidak dicatat.

---

## 3. Tabel

| Tabel | Isi |
| --- | --- |
| `m_item_weighting` | satu baris per item yang ditimbang: `item_weight`, `receiving_tolerance` |
| `log_receipt_note_weighting` | satu baris per baris Receipt Note: `qty_sj`, salinan berat dan toleransi, `qty_calculated`, `lower_tolerance`, `upper_tolerance`, `qty_weighting`, `weighting_result`, `qty_received`, `qty_bonus` |
| `log_receipt_note_line` | `qty` = `qty_received` (satuan PO); `base_qty` = Qty Terima dasar |
| `log_stock_receipt` | bonus: `purpose` = `purchase_bonus`, nomor `SRC/…`, sumber = Receipt Note |

---

## 4. Simpan dan Posting

| Langkah | Yang terjadi |
| --- | --- |
| Simpan Draft, belum ditimbang | baris disimpan dengan Qty SJ, tanpa baris timbangan |
| Simpan Draft, sudah ditimbang | baris timbangan disimpan dengan setelan item **saat itu** |
| Ubah Qty SJ | hasil timbangan dikosongkan; timbang ulang |
| Posting, belum ditimbang | ditolak: *<item> belum ditimbang* |
| Posting | dihitung ulang dengan **salinan** berat dan toleransi; mengubah master sesudahnya tidak berpengaruh |

Lot diketik dalam satuan PO (P338): jumlahnya harus sama dengan Qty Terima, bukan Qty SJ.

---

## 5. Bonus

Posting Receipt Note **tidak** memasukkan bonus (P339). Bonus menunggu di `qty_bonus` dan
tampil di kartu *Menunggu Diterima* Stock Receipt, sampai gudang membuat satu Stock Receipt
tujuan **Bonus Pembelian** untuk Receipt Note itu:

- Diterima utuh; satu Stock Receipt hidup per Receipt Note (indeks unik parsial).
- No. Stok baru, diusulkan `<nomor RN>-<baris>-BONUS` dan boleh diganti; kedaluwarsa dan
  lokasi diusulkan dari lot pertama barisnya; status dipilih gudang.
- Nilai 0: tidak ada jurnal, GR/IR atau tagihan. Rata-rata item **turun**.
- Tidak mengurangi sisa PO dan tidak terbaca Invoice Pembelian.

---

## 6. Contoh: PO 30 BOX isi 12 @ Rp1.200.000, berat 0,5 Kg per PCS, toleransi 2%

| | RN 1 | RN 2 | RN 3 |
| --- | ---: | ---: | ---: |
| Qty SJ (BOX) | 10 | 10 | 5 |
| Pembanding (Kg) | 60 | 60 | 30 |
| Range (Kg) | 58,8–61,2 | 58,8–61,2 | 29,4–30,6 |
| Timbangan (Kg) | 59,5 | 66,2 | 28,662 |
| Hasil | Dalam | Di atas | Di bawah |
| Qty Terima (BOX) | 10 | 10 | 4,777 |
| Qty Terima (PCS) | 120 | 120 | 57,324 |
| Bonus (PCS) | — | (66,2 − 61,2) ÷ 0,5 = 10 | — |
| Nilai (ditagih) | 12.000.000 | 12.000.000 | 5.732.400 |
| Kolam stok sesudahnya: Q | 120 | 250 | 307,324 |
| Kolam stok sesudahnya: V | 12.000.000 | 24.000.000 | 29.732.400 |
| Rata-rata per PCS | 100.000 | **96.000** | 96.746,11 |

PO sesudahnya: diterima 24,777 BOX (297,324 PCS); sisa 5,223 BOX. Bonus 10 PCS tidak
ikut dihitung.

---

## 7. Cek

```sql
SELECT n.rn_no, w.qty_sj, w.qty_weighting, w.weighting_result, w.qty_received, w.qty_bonus, l.qty, l.base_qty
FROM log_receipt_note_weighting w
JOIN log_receipt_note_line l ON l.id = w.receipt_line_id
JOIN log_receipt_note n ON n.id = l.receipt_note_id;
```

`npm run db:reconcile` membuktikan `line.qty = qty_received`, Qty Terima = SJ kecuali di bawah
toleransi, dan bonus yang sudah diterima = stok yang masuk lewat Stock Receipt-nya, bernilai 0 tanpa jurnal.
