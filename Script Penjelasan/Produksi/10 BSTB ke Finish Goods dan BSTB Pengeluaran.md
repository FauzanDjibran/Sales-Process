# Produksi 10 — BSTB ke Finish Goods dan BSTB Pengeluaran

Dua jalan keluar produksi, **satu tabel** (`log_production_receipt`), dibedakan
kolom `purpose`.

| | **BSTB ke Finish Goods** | **BSTB Pengeluaran** |
| --- | --- | --- |
| `purpose` | `finish_goods` | `return` |
| Nomor | `BFG_<unit>_…` | `BPG_<unit>_…` |
| Dari Unit | hanya Unit **terakhir** routing line (UP5) | Unit mana pun |
| Dari tahap | Stand By | Persiapan **atau** Stand By |
| Jumlah | selalu utuh | Job utuh; No. Stok tanpa Job boleh sebagian |
| Bahan penolong | tidak | bisa |
| Nilai saat Terima | terbawa | **dipilih gudang**: terbawa / tanpa nilai |
| Dipakai untuk | barang jadi | hasil samping, reject, sisa penolong |

## Kode acuan

`production-receipt.ts` → `check`, `sendFinishGoods`, `receiveFinishGoods`,
`productionReceiptPreview`; kata-katanya `production-receipt-shape.ts`.

---

## 1. Cara pakai

| # | Siapa | Di mana | Langkah |
| --: | --- | --- | --- |
| 1 | Unit | Workspace › Stand By UP5 › **Kirim ke Finish Goods**; atau Persiapan / Stand By Unit mana pun › **BSTB Pengeluaran** | pilih barang, Gudang Tujuan, Tanggal → **Ajukan** |
| 2 | — | — | barang *Dalam Perjalanan* di Unit asal |
| 3 | Gudang | ERP › Persediaan › Operasi Gudang › menu masing-masing | **Terima**; Pengeluaran: pilih nilainya; periksa jurnal |

Izin: kirim `PRODUCTION_RECEIPT_SEND` (Unit user diperiksa); gudang
`PRODUCTION_RECEIPT_VIEW / _RECEIVE` (gudang user diperiksa).

Tanpa Draft dan tanpa batal: `Submitted (Diajukan) → Posted (Diterima)`.

---

## 2. Sumber data

| Data | Sumber |
| --- | --- |
| Boleh ke Finish Goods? | `endsLine`: Unit = langkah terakhir sebuah routing line |
| Barang | `prd_balance` Unit, menurut aturan `sendable` |
| Gudang Tujuan | `ref_warehouse` aktif **tanpa Lokasi**, bukan Gudang Transit |
| Gudang awal | nama mengandung *Finish* (FG) atau *Bahan Baku* (Pengeluaran) |

---

## 3. Tabel

`log_production_receipt`:

| Kolom | Diisi saat | Isi | Contoh FG |
| --- | --- | --- | ---: |
| `receipt_no` | Ajukan | seri BFG / BPG | `BFG_UP5_231126_00001` |
| `purpose` | Ajukan | `finish_goods` / `return` | |
| `receipt_date` | Ajukan | tanggal kirim | |
| `from_unit_id`, `warehouse_id`, `note` | Ajukan | | UP5, GFG |
| `received_at`, `received_by` | Terima | hari Terima = **tanggal jurnal** | |
| `cost_amount` | Terima | Σ nilai baris (dilepas produksi) | 61.891 |
| `value_mode` | Terima | `carried` / `none` | `carried` |
| `written_off_amount` | Terima | `none` → `cost_amount`; selain itu 0 | 0 |
| `journal_id` | Terima | | |

`log_production_receipt_line`:

| Kolom | Diisi saat | Isi |
| --- | --- | --- |
| `item_id`, `tracking_id`, `job_id` | Ajukan | dari bucket |
| `qty`, `grams` | Ajukan | jumlah dikirim |
| `from_bucket_id` | Ajukan | bucket asal |
| `transit_bucket_id` | Ajukan | bucket Dalam Perjalanan |
| `value` | Terima | nilai yang dilepas produksi |

---

## 4. Yang terjadi

### 4.1 Ajukan

```
tiap baris: sendInTransit   asal → Dalam Perjalanan, nilai sama
            (TransferOut + TransferIn; tanda penolong dibawa)
```

### 4.2 Terima

```
tiap baris:
  1. takeFromBucket    Dalam Perjalanan → keluar        prd_ledger Released
  2. receiveStock      masuk gudang, No. Stok SAMA
        nilai = nilai langkah 1   (carried)
        nilai = 0                 (none)
jurnal per Item
```

| Pilihan | Debit | Kredit | Stok masuk |
| --- | --- | --- | --- |
| **Nilai terbawa** (dan selalu FG) | Persediaan | WIP | senilai produksi |
| **Tanpa nilai** | Beban Pemusnahan Produksi | WIP | jumlah masuk, **nilai 0** |

Nilai 0 (misalnya BJL) → tanpa jurnal.

**Akibat Tanpa nilai:** jumlah stok naik tanpa nilai, jadi **moving average barang
itu turun**.

---

## 5. Contoh

| Dokumen | Barang | Pilihan | Nilai | Jurnal | Stok |
| --- | --- | --- | ---: | --- | --- |
| `BPG_UGH_231126_00001` | BJL 3 g, Stand By UGH | terbawa | 0 | tidak ada | BJL 3 g / Rp 0 |
| `BFG_UP5_231126_00001` | Kotak 1 PCS | terbawa | 61.891 | Dr Persediaan / Cr WIP 61.891 | Kotak 1 / 61.891 |
| `BPG_UP5_231126_00002` | Keping 5 g, Persiapan UP5 | **tanpa nilai** | 6.080 | Dr Beban Pemusnahan / Cr WIP 6.080 | Keping 5 g / Rp 0 |

Ledger kotak:

| Langkah | `movement` | Bucket | Nilai |
| --- | --- | --- | ---: |
| Ajukan | TransferOut | B150 UP5 Stand By | −61.891 |
| Ajukan | TransferIn | B151 UP5 Dalam Perjalanan | +61.891 |
| Terima | Released | B151 | −61.891 |

---

## 6. Validasi utama

| Aturan | Pesan |
| --- | --- |
| FG hanya dari Unit terakhir | *… bukan Unit terakhir routing: kirim lewat Push atau BSTB.* |
| Gudang | *Pilih Gudang aktif tanpa Lokasi.* |
| Job utuh di tahap itu | *No. Job … dikirim utuh: … belum ikut.* |
| Tidak melebihi saldo | *Melebihi saldo (…).* |
| Pengeluaran: nilai dipilih | *Pilih nilai barang yang diterima.* |
| Terima tidak sebelum tanggal kirim | *Tanggal kirim di masa depan …* |
| Tanpa nilai butuh akun | *Lengkapi Account Mapping dulu: Account Beban Pemusnahan Produksi.* |

---

## 7. Cek

| Keadaan | Rumus |
| --- | --- |
| Diterima | `cost_amount` = Σ `value` baris = `Released` produksi = debit jurnal |
| Diterima | stok masuk = `cost_amount − written_off_amount` |
| Diajukan | belum ada jurnal, dan tiap baris masih ada di Dalam Perjalanan |

---

## 8. Batasan

- *Hanya nilai bahan* tidak tersedia: biaya Unit tercatat di No. Stok **input**, jadi
  bagian bahannya tidak bisa dipisah dari hasil grading.
- Nilai Reject tidak diserap sisa partai; pilihannya terbawa atau beban.
- Alasan ditulis di *Alasan / Catatan* sebagai teks bebas.
