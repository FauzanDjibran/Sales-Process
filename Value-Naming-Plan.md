# Rencana penyetaraan bahasa nilai

Status: **disetujui (N1–N6 sesuai rekomendasi). Fase 1 selesai (P331, 25/11/2026), fase 2 (P333, 26/11/2026)**; fase 3 dan N6 belum.

Tujuan: satu arti satu nama. **`base_` berarti ukuran yang sama dalam satuan default** (user,
25/11/2026): `base_qty` = qty dalam satuan dasar, `base_x_amount` = nilai dalam base currency.
Arti "dasar dari sesuatu" (dasar pengenaan) tidak boleh memakai kata *base*. Hanya nama yang berubah: tidak ada angka, rumus, posting atau journal yang
berubah, kecuali satu kolom di N2.

## 1. Temuan

Dokumen Sales, Purchasing dan Finance sudah setara: `dpp_amount` / `base_dpp_amount`,
`total_amount` / `base_total_amount` (P271). Yang belum:

| # | Masalah | Di mana |
| --- | --- | --- |
| F1 | **Satu arti, dua nama.** Nilai stok rupiah disebut `cost_amount` di dokumen keluar dan `value_amount` di dokumen masuk | cost: Delivery Note, Stock Issue (header, baris, tracking), header Stock Receipt. value: Receipt Note (header, baris, tracking), baris dan tracking Stock Receipt, baris Stock Adjustment |
| F2 | **Stock Receipt memakai keduanya** dalam satu dokumen: header `cost_amount`, barisnya `value_amount` | `log_stock_receipt` |
| F3 | **Pasangan yang tidak terlihat berpasangan.** `order_dpp_amount` (currency PO) dan `value_amount` (rupiah) adalah nilai yang sama dalam dua ukuran | `log_receipt_note_line` |
| F4 | **Satu nama, dua arti.** `cost_amount` di logistik = nilai stok; di produksi = **biaya Unit** (gram × rate) | `prd_grading(_input)`, `prd_work(_line)`, `prd_kerja_line`, `prd_box` |
| F5 | **`base_amount` bukan rupiah** melainkan dasar pengenaan PPh (DPP) | `fin_cash_bank_tx_line_wht`, `tax_withholding_slip` |
| F6 | **`base` di belakang**, bukan awalan | `out_base`, `in_base`, `from_base` (Transfer), `transaction_base_amount` (baris kas) |
| F7 | **Nama umum tanpa arti**: `value` | dokumen produksi (`prd_*_line`, input, output, box), `prd_tracking_link` |
| F8 | Nilai rupiah tanpa tanda base | `short_amount`, `over_amount`, `typed_value` (Stock Adjustment), `written_off_amount` (Stock Receipt) |
| F9 | Kode memakai `base` untuk **dasar pengenaan PPh** | tipe `withholdings` di `sales-tax.ts` (`base`, `withheldBase`), `cash-bank-tx.ts`, `cash-payment.ts`, `tax-document.ts`. Di `cash-bank-tx.ts` kata yang sama juga berarti rupiah |

Sudah sesuai arti *base*, jadi tetap: `base_qty`, `received_base_qty`, `base_uom_id`, dan `base_amount`
di baris order serta Invoice Penjualan (pasangan dari `amount`).

## 2. Kenapa bukan `base_dpp_amount` di Receipt Note

Untuk pembelian, `value_amount` memang tepat base dari `order_dpp_amount`. Tetapi tabel yang sama
dipakai **penerimaan retur** (`sales_return`). Di sana nilainya adalah HPP saat barang keluar,
bukan DPP; `order_dpp_amount` selalu 0. Nama `base_dpp_amount` akan salah untuk baris retur.

Yang benar untuk kedua tujuan adalah **cost**: berapa biaya barang ini masuk stok. Pada pembelian,
cost itu diambil dari DPP PO.

## 3. Aturan yang diusulkan

| Aturan | Isi |
| --- | --- |
| A | `x_amount` = currency dokumen; `base_x_amount` = base currency (rupiah). `base_` selalu di depan |
| B | Nilai barang di dokumen = **cost**. Selalu `base_cost_amount`, karena stok dinilai dalam rupiah |
| C | `cost_amount` tanpa base hanya ada bila dokumen bisa valas (baris Receipt Note) |
| D | `base_` hanya untuk ukuran yang punya satuan default (satuan dasar, base currency). "Dasar …" memakai nama benda sebenarnya, misalnya `dpp` |
| E | Biaya Unit produksi tidak disebut `cost_amount` |
| F | Buku memakai istilah bukunya (`value_change`, `value_balance`), lihat N3 |

## 4. Perubahan kolom

### Fase 1 — Logistik (F1, F2, F3, F8)

| Tabel | Sekarang | Menjadi |
| --- | --- | --- |
| `log_receipt_note_line` | `order_dpp_amount` | `cost_amount` (currency PO) |
| `log_receipt_note_line` | `value_amount` | `base_cost_amount` |
| `log_receipt_note`, `_tracking` | `value_amount` | `base_cost_amount` |
| `log_stock_receipt` | `cost_amount` | `base_cost_amount` |
| `log_stock_receipt_line`, `_tracking` | `value_amount` | `base_cost_amount` |
| `log_stock_receipt` | `written_off_amount` | `base_written_off_amount` |
| `log_delivery_note(_line, _tracking)` | `cost_amount` | `base_cost_amount` |
| `log_stock_issue(_line, _tracking)` | `cost_amount` | `base_cost_amount` |
| `log_stock_adjustment_line` | `value_amount` (bertanda ±) | `base_cost_amount` |
| `log_stock_adjustment_line` | `typed_value` | `base_typed_amount` |
| `log_stock_adjustment` | `short_amount`, `over_amount` | `base_short_amount`, `base_over_amount` |

Kode yang menyebutnya: `receipt-note.ts`, `delivery-note.ts`, `stock-issue.ts`, `stock-receipt.ts`,
`stock-adjustment.ts`, `reconcile.ts`, `simulate-walet.ts`, dan tes `multi-currency-flow`,
`sales-return`.

### Fase 2 — Finance dan Pajak (F5, F6)

| Tabel | Sekarang | Menjadi |
| --- | --- | --- |
| `fin_cash_bank_tx_line_wht` | `base_amount` | `dpp_amount` |
| `tax_withholding_slip` | `base_amount` | `dpp_amount` |
| `fin_cash_bank_tx_line` | `transaction_base_amount` | `base_transaction_amount` |
| `fin_cash_bank_transfer` | `from_base` | `base_from_amount` |
| `fin_cash_bank_transfer_line` | `out_base`, `in_base` | `base_out_amount`, `base_in_amount` |
| Kode: `withholdings` (F9) | `base`, `withheldBase` | `dpp`, `withheldDpp` |

### Fase 3 — Produksi (F4, F7)

| Tabel | Sekarang | Menjadi |
| --- | --- | --- |
| `prd_grading(_input)`, `prd_work(_line)`, `prd_kerja_line`, `prd_box` | `cost_amount` (biaya Unit) | `base_process_amount` |
| `prd_grading`, `prd_work_line` | `input_value` | `base_input_amount` |
| `prd_grading`, `prd_work(_line)`, `prd_box` | `aux_value` | `base_aux_amount` |
| `prd_grading`, `prd_work` | `scrap_amount` | `base_scrap_amount` |
| `prd_box` | `piece_value` | `base_piece_amount` |
| dokumen produksi lain | `value` | `base_cost_amount` |

Pesan `handover.ts` antar ERP dan Produksi ikut bila menamai nilai.

### Tidak diubah

| Yang tetap | Alasan |
| --- | --- |
| `debit_amount`, `kredit_amount` (journal) | Istilah akuntansi; selalu base, `trx_amount` sudah menandai yang lain |
| `amount_value`, `discount_value` | Angka yang diketik (% atau nominal), bukan nilai barang |
| Uang Muka tanpa `base_` | Tagihan belum menimbulkan nilai base (P271) |
| Perizinan, Tagihan Biaya tanpa `base_` | Dokumen rupiah saja (P273) |
| Credit Note tanpa base bruto, diskon dan DPP Nilai Lain | Bukan soal nama: kolomnya memang tidak disimpan |

## 5. Bahasa di layar

Nama kolom tidak tampil, tetapi kata di layar juga belum sama:

| Layar | Sekarang | Usulan |
| --- | --- | --- |
| Receipt Note, Stock Receipt, Stock Issue, Stock Adjustment | Nilai | **Nilai** (tetap) |
| Delivery Note | HPP | **HPP** (tetap): nilai stok yang keluar memang menjadi HPP |
| Baris Receipt Note dari PO valas | hanya Nilai rupiah | tampilkan juga cost currency PO (N6) |

Aplikasi Produksi tidak menampilkan nilai (P275).

## 6. Cara membangun

1. Tiap fase satu commit dan satu migrasi `ALTER TABLE … RENAME COLUMN`: data, indeks dan CHECK
   ikut, tidak ada data dipindah. Di N2, satu `UPDATE`.
2. Dalam commit yang sama: `schema.prisma`, kode, SQL mentah di `reconcile.ts` dan skrip,
   `DBML/erp.dbml.md`, `npm run db:map`, `Script Penjelasan/`, dan keputusan di §12.
3. Field TypeScript yang dikirim ke form (`value`, `orderDpp`) ikut, supaya bahasa kode juga sama.
4. Pembuktian per fase: `npm run build`, `npm run lint`, `npm test`, dan **`db:reconcile` sebelum
   dan sesudah migrasi memberi hasil yang sama**. Pencarian nama lama harus kosong di luar migrasi
   lama dan catatan keputusan lama.
5. Setelah push, Neon dimigrasi segera: **kode baru tidak bisa membaca kolom lama**, jadi antara
   deploy Vercel dan `db:neon-migrate` halaman logistik error.

Risiko utama adalah SQL mentah: nama kolom di dalam string tidak diperiksa TypeScript. Karena itu
pencarian nama lama dan `db:reconcile` menjadi syarat selesai.

## 7. Keputusan

| # | Pertanyaan | Rekomendasi |
| --- | --- | --- |
| N1 | Pasangan di baris Receipt Note | `cost_amount` / `base_cost_amount` (§2) |
| N2 | `cost_amount` pada baris **retur**, sekarang 0 | Isi sama dengan base: retur dinilai rupiah, jadi `base_x = x` (MC2). Satu-satunya angka yang berubah; tidak dibaca siapa pun selain Invoice Pembelian |
| N3 | Buku: `value_change` / `value_balance` di buku stok, nilai dan produksi ikut `base_`? | **Tidak.** Buku nilai hanya punya satu ukuran, dan konsep KB `inventory/stock-books` menyebutnya *value* (Q dan V) |
| N4 | Nama biaya Unit di produksi | `base_process_amount`. Bukan `unit_cost`, yang di aplikasi berarti biaya **per satuan** |
| N5 | Urutan | Fase 1 dulu, Anda periksa, baru 2 dan 3 |
| N6 | Tampilkan cost dalam currency PO di Receipt Note valas | Ya, sebagai langkah tersendiri sesudah Fase 1 |

Sesudah disetujui, aturan §3 ditawarkan ke KB (`engineering/data-conventions`), karena berlaku
untuk proyek lain.
