# Produksi 10 — BSTB ke Finish Goods dan BSTB Pengeluaran

Dua jalan keluar produksi, masing-masing **dua dokumen bernomor sama** (P317):
**Production Issue** di Produksi (Unit mengirim) dan **Stock Receipt** di ERP
(gudang menerima).

| | **BSTB ke Finish Goods** | **BSTB Pengeluaran** |
| --- | --- | --- |
| `purpose` | `finish_goods` | `return` |
| Nomor | `BFG_<unit>_…` | `BPG_<unit>_…` |
| Dari Unit | hanya Unit **terakhir** routing line (UP5) | Unit mana pun |
| Dari tahap | Stand By | Persiapan **atau** Stand By |
| Jumlah | selalu utuh | Job utuh; No. Stok tanpa Job boleh sebagian |
| Bahan penolong | tidak | bisa |
| Alasan | tidak ada | opsional, dari daftar tetap |
| Nilai saat Terima | terbawa | **dipilih gudang**: terbawa / tanpa nilai |

## Kode acuan

| Bagian | File / fungsi |
| --- | --- |
| Pengirim | `production-issue.ts` → `sendProductionIssue`, `takeReceiptReceived` |
| Penerima | `stock-receipt.ts` → `takeReceiptSent`, `receiveStockReceipt` |
| Tujuan dan alasan | `production-handover-shape.ts`, `stock-receipt-purposes.ts` |

---

## 1. Cara pakai

| # | Siapa | Di mana | Langkah |
| --: | --- | --- | --- |
| 1 | Unit | Workspace › Stand By UP5 › **Kirim ke Finish Goods**; atau Persiapan / Stand By › **BSTB Pengeluaran** | barang, Gudang Tujuan, Tanggal → **Kirim** |
| 2 | Gudang | ERP › Persediaan › Operasi Gudang › **Stock Receipt** | pilih lokasi (bila ada) dan status tiap No. Stok → **Terima**; Pengeluaran: pilih nilai |

Status kedua dokumen: `InTransit (Dalam Perjalanan) → Received (Diterima)`. Tanpa
Draft dan tanpa batal. Izin: `PRODUCTION_ISSUE_VIEW / _SEND` dan
`STOCK_RECEIPT_VIEW / _RECEIVE`.

---

## 2. Yang terjadi

### 2.1 Kirim (Produksi)

```
tiap baris: sendInTransit   asal → Dalam Perjalanan
            bucket transit milik dokumen ini sendiri  ← NILAI BEKU
pesan ReceiptSent  →  Stock Receipt lahir, menunggu
```

Dua dokumen atas No. Stok yang sama masing-masing membawa nilainya sendiri, apa pun
urutan terimanya.

### 2.2 Terima (ERP)

```
tiap No. Stok: receiveStock   No. Stok SAMA, lokasi dan status pilihan gudang
               nilai beku (carried) atau 0 (none)
jurnal per barang, bertanggal hari Terima
pesan ReceiptReceived  →  bucket Dalam Perjalanan dikosongkan (Released)
                          Production Issue menjadi Diterima
```

| Pilihan | Debit | Kredit | Stok masuk |
| --- | --- | --- | --- |
| **Nilai terbawa** (dan selalu FG) | Persediaan | WIP | senilai produksi |
| **Tanpa nilai** | Beban Pemusnahan Produksi | WIP | jumlah masuk, **nilai 0** |

Nilai 0 → tanpa jurnal. Tanpa nilai menurunkan rata-rata barang itu.

---

## 3. Tabel

| Tabel | Isi |
| --- | --- |
| `prd_issue` | nomor, `purpose`, `reason`, Unit, kode gudang, tanggal, `received_at` |
| `prd_issue_line` | No. Stok, Job, partai, qty, gram, `base_cost_amount` (beku), bucket asal dan transit |
| `log_stock_receipt` | nomor sama, gudang, `base_cost_amount`, `value_mode`, `base_written_off_amount`, `journal_id` |
| `log_stock_receipt_line` | satu per **barang**: Σ qty dan nilai |
| `log_stock_receipt_tracking` | satu per **No. Stok**: qty, gram, nilai beku, `location_id`, `stock_status_id` |

Tabel ERP tidak menyimpan id produksi; yang disimpan nomor (`tracking_no`, `job_no`).

---

## 4. Contoh

| Dokumen | Barang | Pilihan | Nilai | Jurnal |
| --- | --- | --- | ---: | --- |
| `BPG_UGH_231126_00001` | BJL 3 g | terbawa | 0 | tidak ada |
| `BFG_UP5_231126_00001` | Kotak 1 PCS | terbawa | 61.891 | Dr Persediaan / Cr WIP 61.891 |
| `BPG_UP5_231126_00002` | Keping 5 g | **tanpa nilai** | 6.080 | Dr Beban Pemusnahan / Cr WIP 6.080 |

---

## 5. Validasi utama

| Aturan | Pesan |
| --- | --- |
| FG hanya dari Unit terakhir | *… bukan Unit terakhir routing …* |
| Job utuh di tahap itu | *No. Job … dikirim utuh …* |
| Gudang berlokasi | *… memakai lokasi: pilih lokasinya.* |
| Pengeluaran: nilai dipilih | *Pilih nilai barang yang diterima.* |
| Tanpa nilai butuh akun | *Lengkapi Account Mapping dulu …* |

Satu No. Stok masuk ke satu lokasi dan satu status.

---

## 6. Cek (`db:reconcile`)

| Cek | Rumus |
| --- | --- |
| Stock Receipt | `base_cost_amount` = Σ barang = Σ No. Stok = Σ `prd_issue_line.base_cost_amount`; diterima: stok masuk = `base_cost_amount − base_written_off_amount`, jurnal = `base_cost_amount` |
| Production Issue | dalam perjalanan: bucket transit = Σ `base_cost_amount`; diterima: `Released` = Σ `base_cost_amount` |
