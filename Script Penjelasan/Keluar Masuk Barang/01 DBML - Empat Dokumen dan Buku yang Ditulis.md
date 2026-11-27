# Keluar Masuk Barang 01 — DBML: empat dokumen dan buku yang ditulis

Acuan lengkap: `DBML/erp.dbml.md`. Di bawah ini diringkas: kolom `id`, `created_*`,
`updated_*` dan sebagian index tidak ditulis ulang.

## 1. Bentuknya

| | Stock Issue | Production Receipt | Production Issue | Stock Receipt |
| --- | --- | --- | --- | --- |
| Peran | pengirim | penerima | pengirim | penerima |
| Tingkat tabel | 3: header, barang, pick | 2: header, No. Stok | 2: header, No. Stok | 3: header, barang, No. Stok |
| Gudang disimpan sebagai | `warehouse_id` | **kode dan nama** | **kode dan nama** | `warehouse_id` |
| Hubungan ke pasangan | nomor | nomor | nomor | nomor |

Pasangan tidak saling menyimpan id. `prd_receipt.receipt_no` = `log_stock_issue.issue_no`
dan `log_stock_receipt.receipt_no` = `prd_issue.issue_no`. Ini sengaja: nanti ERP dan
Produksi bisa punya database sendiri (P319).

---

## 2. Stock Issue

```dbml
table log_stock_issue {
  issue_no         varchar [unique]     // BSTB_<unit>_<ddmmyy>_<NNNNN> atau SIS/YYYY/MM/NNNN
  issue_date       date                 // tanggal stok keluar dan jurnal
  status           enum('Draft','InTransit','Received','Posted','Cancelled')
  purpose          varchar              // production_issue | auxiliary_issue | disposal | sample
  warehouse_id     int                  // gudang asal
  unit_id          int                  // hanya dua tujuan produksi
  note             varchar              // wajib untuk disposal dan sample
  base_cost_amount decimal(18,2)        // Σ baris, terisi saat Kirim / Posting
  journal_id       int                  // tanpa FK
  received_at      date                 // hari Unit menerima
  cancel_reason    varchar
}

table log_stock_issue_line {            // satu per BARANG: ringkasan
  stock_issue_id   int
  line_no          int
  item_id          int                  // unik per dokumen
  uom_id           int                  // satuan dasar, uom_factor 1
  qty              decimal(18,4)        // diketik
  base_qty         decimal(18,4)
  base_cost_amount decimal(18,2)        // Σ pick
}

table log_stock_issue_tracking {        // satu per LOT yang dipilih: detail, pemegang nilai
  stock_issue_line_id int
  pick_no          int
  tracking_id      int                  // log_stock_tracking.id
  location_id      int
  tracking_no      varchar              // disalin seperti tercetak
  expiry_date      date
  qty              decimal(18,4)
  base_qty         decimal(18,4)
  base_cost_amount decimal(18,2)        // yang dilepas pool untuk pick ini
}
```

| Status | Layar | Stok sudah keluar? | Punya Production Receipt? |
| --- | --- | --- | --- |
| `Draft` | Draft | belum (tidak ada reservasi) | tidak |
| `InTransit` | Dalam Perjalanan | **ya** | ya, `InTransit` |
| `Received` | Diterima | ya | ya, `Received` |
| `Posted` | Diposting | ya (tujuan tanpa Unit) | **tidak** |
| `Cancelled` | Dibatalkan | tidak | tidak |

## 3. Production Receipt

```dbml
table prd_receipt {
  receipt_no       varchar [unique]     // = nomor Stock Issue
  purpose          varchar              // material | auxiliary
  unit_id          int
  warehouse_code   varchar              // asal, disalin dari pesan
  warehouse_name   varchar
  sent_date        date                 // tanggal Stock Issue
  status           enum('InTransit','Received')
  received_at      date                 // hari Terima = tanggal masuk buku produksi
  received_by      int
  note             varchar
}

table prd_receipt_line {                // satu per LOT yang dikirim
  receipt_id       int
  line_no          int
  item_id          int
  tracking_id      int                  // No. Stok yang sama
  qty              decimal(18,6)
  base_cost_amount decimal(18,2)        // NILAI BEKU dari Stock Issue
  job_id           int                  // lahir saat Terima; kosong untuk bahan penolong
  bucket_id        int                  // prd_balance yang diisi
}
```

## 4. Production Issue

```dbml
table prd_issue {
  issue_no         varchar [unique]     // BFG_… atau BPG_<unit>_<ddmmyy>_<NNNNN>
  purpose          varchar              // finish_goods | return
  reason           varchar              // hanya return, hanya untuk dibaca
  unit_id          int                  // Unit pengirim
  warehouse_code   varchar              // tujuan
  warehouse_name   varchar
  issue_date       date
  status           enum('InTransit','Received')
  received_at      date
  note             varchar
}

table prd_issue_line {                  // satu per bucket yang dikirim
  issue_id         int
  line_no          int
  item_id          int
  tracking_id      int
  job_id           int
  partai_id        int
  qty              decimal(18,6)
  grams            decimal(18,6)
  base_cost_amount decimal(18,2)        // NILAI BEKU saat Kirim
  from_bucket_id   int                  // saldo asal
  transit_bucket_id int                 // baris Dalam Perjalanan MILIK DOKUMEN INI
}
```

Tidak ada `Draft` dan `Cancelled`: Kirim langsung membuat dan menjalankan.

## 5. Stock Receipt

```dbml
table log_stock_receipt {
  receipt_no       varchar [unique]     // nomor pengirim; bonus: SRC/YYYY/MM/NNNN
  purpose          varchar              // finish_goods | return | purchase_bonus
  receipt_date     date                 // hari DIKIRIM, bukan hari diterima
  status           enum('InTransit','Received')
  from_unit_id     int
  warehouse_id     int
  source_doc_type_id int                // hanya bonus: Receipt Note-nya
  source_doc_id    int
  source_no        varchar
  note             varchar
  received_at      date                 // hari Terima = tanggal stok masuk dan jurnal
  received_by      int
  base_cost_amount decimal(18,2)        // Σ nilai beku
  value_mode       varchar              // carried | none, dipilih saat Terima
  base_written_off_amount decimal(18,2) // yang dibebankan oleh `none`
  journal_id       int
}

table log_stock_receipt_line {          // satu per BARANG
  stock_receipt_id int
  line_no          int
  item_id          int                  // unik per dokumen
  base_qty         decimal(18,6)        // Σ No. Stok
  base_cost_amount decimal(18,2)        // Σ No. Stok
}

table log_stock_receipt_tracking {      // satu per baris yang dikirim
  stock_receipt_line_id int
  seq              int
  tracking_no      varchar              // No. Stok yang sama masuk stok
  expiry_date      date
  job_no           varchar              // teks dari produksi, bukan id
  base_qty         decimal(18,6)
  grams            decimal(18,6)
  base_cost_amount decimal(18,2)        // nilai beku
  location_id      int                  // dipilih gudang saat Terima
  stock_status_id  int                  // dipilih gudang saat Terima
}
```

---

## 6. Buku yang ditulis

Dokumen hanya catatan. Barangnya bergerak di **buku**.

### 6.1 Identitas bersama

```dbml
table log_stock_tracking {              // SATU daftar No. Stok untuk gudang dan produksi
  tracking_no      varchar [unique]
  item_id          int
  tracking_date    date
  expiry_date      date
  source_doc_type_id int                // dokumen yang melahirkannya
  source_doc_id    int
  source_no        varchar
  source_partner_id int
}
```

### 6.2 Buku stok (ERP)

| Tabel | Kunci | Isi penting |
| --- | --- | --- |
| `log_stock_ledger` | append-only | `qty_change`, `qty_balance`, `value_change` per bucket |
| `log_stock_balance` | gudang · lokasi · lot · status | `qty_balance`. **Tanpa nilai** |
| `log_stock_valuation_ledger` | append-only | `qty_change`, `value_change`, saldo pool sesudahnya |
| `log_stock_valuation_balance` | **barang** | `qty_balance` (Q), `value_balance` (V) |

Setiap baris qty punya satu kembaran nilai.

### 6.3 Buku produksi

| Tabel | Kunci | Isi penting |
| --- | --- | --- |
| `prd_balance` | No. Stok · Unit · `stage` · `unit_step_id` · partai · Job · `qc_check_id` · dokumen transit | `qty_balance`, `value_balance`, `auxiliary` |
| `prd_ledger` | append-only | `movement`, `qty_change`, `value_change`, saldo sesudahnya |
| `prd_job` | `job_no` | No. Job yang lahir saat Terima |

Beda yang penting: **di gudang nilai melekat pada barang (pool), di produksi nilai
melekat pada bucket.** Karena itu Stock Issue harus *menghitung* nilai keluar,
sedangkan Production Issue tinggal *membawa* nilai bucketnya.

| Dokumen | `prd_ledger.movement` |
| --- | --- |
| Production Receipt, Terima | `Issued` (masuk produksi) |
| Production Issue, Kirim | `TransferOut` lalu `TransferIn` (ke Dalam Perjalanan) |
| Production Issue, saat gudang Terima | `Released` (keluar produksi) |
