# Produksi 03 — BSTB Issue: bahan dari gudang ke Unit

Satu-satunya pintu masuk barang ke produksi. Dibuat **Gudang** di ERP, diterima
**Unit** di Workspace.

## Kode acuan

| Bagian | File / fungsi |
| --- | --- |
| Dokumen | `stock-issue.ts` → `checkStockIssue`, `transitionStockIssue` |
| Tujuan | `stock-issue-purposes.ts` |
| Stok keluar | `inventory.ts` → `reserveStock`, `releaseReservation`, `issueStock` |
| Masuk produksi | `production-ledger.ts` → `issueJob`, `enterProduction` |

Kode memakai nama lama *stock issue*; di layar *BSTB Issue*.

---

## 1. Cara pakai

| # | Siapa | Di mana | Langkah |
| --: | --- | --- | --- |
| 1 | Gudang | ERP › Persediaan › Operasi Gudang › BSTB Issue | pilih **Tujuan**, Gudang, Unit, Tanggal |
| 2 | Gudang | baris | pilih Barang, isi jumlah (satuan dasar), **Pilih Lot** |
| 3 | Gudang | tombol | **Ajukan**: stok terkunci, belum pindah |
| 4 | Unit | Workspace › tab *Penerimaan* | buka dokumen, **Terima** |

| Tujuan | Kode | Unit | Barang menjadi |
| --- | --- | --- | --- |
| Bahan ke Produksi | `production_issue` | **hanya Unit pertama routing** (UGH) | barang kerja, **dengan No. Job** |
| Bahan Penolong ke Unit | `auxiliary_issue` | Unit mana pun | saldo Unit, tanpa Job dan partai |

Izin: `STOCK_ISSUE_VIEW / _CREATE / _EDIT / _SUBMIT / _POST / _CANCEL`.

Status: `Draft → Submitted (Diajukan) → Posted (Diterima)`; `Cancelled` hanya dari Draft.

---

## 2. Sumber data di layar

| Isian | Sumber |
| --- | --- |
| Gudang | `ref_warehouse` aktif, bukan Gudang Transit |
| Unit | `ref_unit` aktif; untuk Bahan ke Produksi harus = `firstProductionUnit()` |
| Barang | `m_item` Barang Kelola Stok |
| Lot | `lotOptions`: `log_stock_balance` gudang itu, dikurangi `reserved_qty` |

---

## 3. Tabel dan isi kolom

### 3.1 `log_stock_issue`

| Kolom | Diisi saat | Sumber | Contoh |
| --- | --- | --- | --- |
| `issue_no` | simpan | seri `BSTB_<unit>_<ddmmyy>_` | `BSTB_UGH_231126_00001` |
| `issue_date` | simpan | diketik; **tanggal jurnal** | 23/11/2026 |
| `purpose` | simpan | pilihan Tujuan | `production_issue` |
| `warehouse_id`, `unit_id` | simpan | dipilih | GBB, UGH |
| `status` | tiap langkah | — | `Posted` |
| `cost_amount` | Terima | Σ `log_stock_issue_line.cost_amount` | 60.000 |
| `journal_id` | Terima | `acc_journal.id` | |

### 3.2 `log_stock_issue_line`

| Kolom | Sumber | Contoh |
| --- | --- | --- |
| `item_id`, `uom_id` | dipilih; satuan dasar | MENTAH, GR |
| `qty` | diketik | 60 |
| `base_qty` | `qty × uom_factor` (faktor selalu 1) | 60 |
| `cost_amount` | Terima: Σ `cost_amount` lot | 60.000 |
| `unit_cost` | Terima: `cost_amount ÷ base_qty`, keterangan saja | 1.000 |

### 3.3 `log_stock_issue_tracking` — lot yang diambil

| Kolom | Sumber | Contoh |
| --- | --- | --- |
| `tracking_id`, `tracking_no`, `expiry_date` | lot yang dipilih; nomor dan kadaluarsa disalin | LOT-A |
| `location_id` | lokasi, bila gudang punya lokasi | — |
| `qty`, `base_qty` | diketik di Pilih Lot | 60 |
| `cost_amount` | Terima: nilai yang dilepas stok (`issueStock`) | 60.000 |
| `prd_bucket_id` | Terima: bucket yang dimasuki | B1 |

---

## 4. Yang terjadi

### 4.1 Ajukan

```
periksa ulang semua aturan
status Draft → Submitted
tiap lot:  log_stock_balance.reserved_qty += jumlah
```

Stok belum keluar, buku produksi belum berubah, belum ada jurnal. Lot yang
dicadangkan tidak bisa diambil Delivery Note atau BSTB lain.

### 4.2 Terima (satu transaksi)

```
untuk setiap lot:
  1. releaseReservation        reserved_qty -= jumlah
  2. issueStock                stok keluar di moving average
        nilai = round(V pool × q ÷ Q pool), habis → V seluruhnya
  3. issueJob                  hanya Bahan ke Produksi: satu No. Job per lot
  4. enterProduction           bucket Persiapan proses pertama Unit
        qty = jumlah, value = nilai langkah 2, movement Issued
  5. simpan cost_amount dan prd_bucket_id di baris lot
jurnal per baris: Dr WIP / Cr Persediaan
```

**Nilai masuk produksi = nilai yang dilepas stok**, rupiah demi rupiah. No. Stok
tetap sama di produksi.

### 4.3 Yang ditulis

| Tabel | Baris | Isi |
| --- | --- | --- |
| `log_stock_ledger` | 1 per lot | −60 g |
| `log_stock_valuation_ledger` | 1 per lot | −60.000 |
| `prd_job` | 1 per lot | `UGH_231126_00001` |
| `prd_balance` | 1 per lot | UGH, Preparation, proses Grading, +60 / 60.000 |
| `prd_ledger` | 1 per lot | `Issued` |
| `acc_journal` | 1 per dokumen | §5 |

---

## 5. Jurnal

| Baris | Akun dari | Debit | Kredit |
| --- | --- | ---: | ---: |
| WIP | Kategori Item, tanpa cadangan | 60.000 | |
| Persediaan | Kategori Item, cadangan Account Mapping | | 60.000 |

Bernilai 0 → tanpa jurnal.

---

## 6. Contoh

| Dokumen | Tujuan | Lot | Qty | Nilai | Bucket | No. Job |
| --- | --- | --- | ---: | ---: | --- | --- |
| `BSTB_UGH_231126_00001` | Bahan | LOT-A | 60 g | 60.000 | B1 | `UGH_231126_00001` |
| `BSTB_UGH_231126_00002` | Bahan | LOT-B | 40 g | 40.000 | B2 | `UGH_231126_00002` |
| `BSTB_UP5_231126_00001` | Penolong | STK | 5 PCS | 2.500 | B3 *(auxiliary)* | — |
| `BSTB_UPC_231126_00001` | Penolong | STK | 2 PCS | 1.000 | B4 *(auxiliary)* | — |

Bahan penolong masuk **Persiapan proses pertama** Unit itu, sama seperti bahan,
tetapi `auxiliary = true`: tidak tampil sebagai barang kerja, dan hanya bisa
dipakai lewat isian bahan penolong atau BoM Kotak.

---

## 7. Validasi utama

| Aturan | Pesan |
| --- | --- |
| Bahan ke Produksi hanya ke Unit pertama | *Bahan masuk produksi lewat Unit pertama routing.* |
| Ada routing sebelum partai | *Belum ada routing sebelum partai. Buat dulu di Master.* |
| Bukan Gudang Transit | pesan Gudang Transit |
| Barang Kelola Stok | *Hanya Barang dengan Kelola Stok yang dapat dikeluarkan ke produksi.* |
| Satu barang satu baris | *… dipilih lebih dari sekali.* |
| Ajukan: lot terisi penuh | Draft boleh belum penuh |
| Stok cukup saat Ajukan dan Terima | ditolak menyebut lot dan angkanya |
| Akun WIP ada | *Lengkapi Account Kategori Item …* |
| Unit yang menerima = Unit user | `assertUnit` |

---

## 8. Cek

| Cek | Rumus |
| --- | --- |
| Nilai dokumen | `cost_amount` = stok keluar = masuk produksi (`Issued`) = debit jurnal |
| Cadangan | Σ `reserved_qty` = Σ lot BSTB Issue berstatus `Submitted` |

Keduanya dijalankan `db:reconcile`.

---

## 9. Catatan

- BSTB Issue yang sudah **Diajukan tidak bisa dibatalkan**; harus diterima dulu.
- Standard Cost **belum dikunci** di sini. Ia dikunci saat No. Stok pertama kali
  dikerjakan (bagian 01 §5).
