# Produksi 03 — BSTB Issue: bahan dari gudang ke Unit

Satu-satunya pintu masuk barang ke produksi, dengan **dua dokumen bernomor sama**
(P317): **Stock Issue** di ERP (gudang mengirim) dan **Production Receipt** di
Produksi (Unit menerima). *BSTB Issue* adalah nama tujuan Stock Issue.

## Kode acuan

| Bagian | File / fungsi |
| --- | --- |
| Pengirim | `stock-issue.ts` → `transitionStockIssue`, `takeIssueReceived` |
| Penerima | `production-receipt.ts` → `takeIssueSent`, `receiveProductionReceipt` |
| Penghubung | `handover.ts` → `deliver` |
| Tujuan | `stock-issue-purposes.ts` |

Kedua sisi tidak saling membaca; mereka hanya saling mengirim pesan.

---

## 1. Cara pakai

| # | Siapa | Di mana | Langkah |
| --: | --- | --- | --- |
| 1 | Gudang | ERP › Persediaan › Operasi Gudang › Stock Issue | Tujuan, Gudang (milik user), Unit, Tanggal, barang, **Pilih Lot** |
| 2 | Gudang | tombol | **Kirim**: periksa jurnal, lalu Ya, Kirim |
| 3 | Unit | Workspace › *Penerimaan*, atau Dokumen › Production Receipt | **Terima** |

| Tujuan | Kode | Unit | Barang menjadi |
| --- | --- | --- | --- |
| BSTB Issue · Bahan ke Produksi | `production_issue` | hanya Unit pertama routing (UGH) | barang kerja, **dengan No. Job** |
| BSTB Issue · Bahan Penolong | `auxiliary_issue` | Unit mana pun | saldo Unit, tanpa Job dan partai |

Status Stock Issue: `Draft → InTransit (Dalam Perjalanan) → Received (Diterima)`;
`Cancelled` hanya dari Draft. Production Receipt: `InTransit → Received`.

Izin: `STOCK_ISSUE_VIEW / _CREATE / _EDIT / _SUBMIT / _CANCEL` di ERP;
`PRODUCTION_RECEIPT_VIEW / _RECEIVE` di Produksi.

---

## 2. Yang terjadi

### 2.1 Kirim (ERP, satu transaksi)

```
periode ditahan; semua aturan diperiksa ulang
tiap lot:  issueStock   nilai = round(V pool × q ÷ Q pool), habis → V seluruhnya
           simpan base_qty dan cost_amount   ← NILAI BEKU
jurnal per barang: Dr WIP / Cr Persediaan, bertanggal dokumen
pesan IssueSent  →  Production Receipt lahir, menunggu
```

Barang yang menuju Unit **sudah WIP**. Pembelian sesudahnya mengubah rata-rata
gudang, tetapi tidak mengubah nilai yang dibawa dokumen.

### 2.2 Terima (Produksi, satu transaksi)

```
bertanggal hari ini, tidak sebelum tanggal Kirim
tiap No. Stok:
  issueJob          hanya Bahan: satu No. Job per No. Stok
  enterProduction   Persiapan proses pertama Unit, nilai = nilai beku (Issued)
pesan IssueReceived  →  Stock Issue menjadi Diterima
```

Terima **tidak berjurnal**.

---

## 3. Tabel

| Tabel | Kolom penting | Diisi |
| --- | --- | --- |
| `log_stock_issue` | `issue_no`, `purpose`, `issue_date` | simpan |
| | `cost_amount`, `journal_id` | Kirim |
| | `received_at` | pesan IssueReceived |
| `log_stock_issue_tracking` | `tracking_no`, `location_id`, `qty` | simpan |
| | `base_qty`, `cost_amount` (nilai beku) | Kirim |
| `prd_receipt` | `receipt_no` = `issue_no`, `purpose` (`material` / `auxiliary`), `unit_id`, `warehouse_code` | pesan IssueSent |
| | `received_at`, `received_by` | Terima |
| `prd_receipt_line` | `tracking_id`, `qty`, `value` (nilai beku) | pesan IssueSent |
| | `job_id`, `bucket_id` | Terima |

Harga pokok per satuan tidak disimpan; layar membaginya dari nilai (P213).

---

## 4. Contoh

| Dokumen | Tujuan | Lot | Qty | Nilai | Jurnal saat Kirim |
| --- | --- | --- | ---: | ---: | --- |
| `BSTB_UGH_231126_00001` | Bahan | LOT-A | 60 g | 60.000 | Dr WIP / Cr Persediaan 60.000 |
| `BSTB_UP5_231126_00001` | Penolong | STK | 5 PCS | 2.500 | Dr WIP / Cr Persediaan 2.500 |

Nilai 0 → tanpa jurnal.

---

## 5. Validasi utama

| Aturan | Pesan |
| --- | --- |
| Bahan hanya ke Unit pertama | *Bahan masuk produksi lewat Unit pertama routing.* |
| Kirim: lot terisi penuh | *… Pilih lot sampai penuh.* |
| Stok cukup | ditolak menyebut lot dan angkanya |
| Akun WIP ada | *Lengkapi Account Kategori Item …* |
| Gudang dan Unit milik user | ditolak |
| Terima dua kali | *Dokumen ini sudah diterima.* |

Stock Issue yang sudah dikirim tidak bisa dibatalkan. Barang salah kirim diterima
Unit, lalu dikembalikan dengan BSTB Pengeluaran (bagian 10).

---

## 6. Cek (`db:reconcile`)

| Cek | Rumus |
| --- | --- |
| Pengirim | `cost_amount` = stok keluar = debit jurnal = Σ `prd_receipt_line.value`; status kedua sisi sama |
| Penerima | diterima: masuk produksi (`Issued`) = Σ `value`; belum: 0 |
| WIP | WIP di GL = nilai produksi + Issue dalam perjalanan, per akun |
