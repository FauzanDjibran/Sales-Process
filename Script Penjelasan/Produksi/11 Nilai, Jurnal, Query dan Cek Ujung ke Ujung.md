# Produksi 11 — Nilai, jurnal, query dan cek ujung ke ujung

Bagian ini untuk **menelusuri angka**: dari mana nilai datang, ke mana perginya, dan
cara membuktikannya di database.

---

## 1. Semua jurnal produksi

| Kejadian | Debit | Kredit | Tanggal |
| --- | --- | --- | --- |
| BSTB Issue — Terima | WIP | Persediaan | tanggal dokumen |
| Grading, Pengerjaan, Kotak — Posting | WIP (biaya) | Biaya Produksi Dibebankan | tanggal dokumen |
| Kerja — Selesai | WIP (biaya) | Biaya Produksi Dibebankan | tanggal Selesai |
| Grading / Pengerjaan tanpa penerima nilai | Beban Pemusnahan | WIP + Biaya Produksi Dibebankan | tanggal dokumen |
| Barang pindah akun WIP (Grading, Job Order, Kotak) | WIP baru | WIP lama | tanggal dokumen |
| BSTB ke Finish Goods — Terima | Persediaan | WIP | hari Terima |
| BSTB Pengeluaran — Terima, terbawa | Persediaan | WIP | hari Terima |
| BSTB Pengeluaran — Terima, tanpa nilai | Beban Pemusnahan | WIP | hari Terima |
| **Tanpa jurnal** | QC Check, Push, BSTB, Penyebaran, Kerja Mulai / Batal, Ajukan apa pun | | |

Biaya **aktual** (gaji, listrik) datang dari Tagihan Biaya atau jurnal manual ke akun
bebannya sendiri. *Biaya Produksi Dibebankan* adalah kredit lawannya menurut tarif
standar. Selisih keduanya akan dihitung Closing Costing, yang belum dibangun.

---

## 2. Biaya Unit sepanjang cerita

| Unit | Gram | Tarif | Biaya | Dibebankan oleh |
| --- | ---: | ---: | ---: | --- |
| UGH | 117 *(60 + 40 + 17 ulang)* | 10 | 1.170 | Grading |
| UPC | 93 | 5 | 465 | Pengerjaan |
| UPY | 93 | 3 | 279 | Grading |
| UPW | 93 | 5 | 465 | Pengerjaan |
| UCL | 93 | 20 | 1.860 | Kerja |
| UC1 | 93 | 2 | 186 | Pengerjaan |
| USR | 93 | 4 | 372 | Pengerjaan |
| UDA | 93 | 6 | 558 | Grading |
| UML | 93 | 15 | 1.395 | Pengerjaan *(proses terakhir)* |
| UDB | 93 | 6 | 558 | Grading |
| UWP | 93 | 4 | 372 | Pengerjaan |
| UBC | 93 | 8 | 744 | Grading |
| UP5 | 50 *(10 keping)* | 12 | 600 | Kotak |
| **Σ** | | | **9.024** | = Σ kredit Biaya Produksi Dibebankan |

Gram yang dibebankan adalah gram **input** dokumen itu.

---

## 3. Neraca nilai

| Masuk produksi | | Keluar produksi / sisa | |
| --- | ---: | --- | ---: |
| Bahan (BSTB Issue) | 100.000 | Kotak ke gudang | 61.891 |
| Stiker (BSTB Issue) | 3.500 | Keping tanpa nilai → beban | 6.080 |
| Biaya Unit | 9.024 | Sisa 7 keping di UP5 | 42.553 |
| | | Sisa 4 stiker di UP5 | 2.000 |
| | | BJL ke gudang | 0 |
| **Σ** | **112.524** | **Σ** | **112.524** |

Dicocokkan ke buku besar:

| Akun | Debit | Kredit | Saldo | Sama dengan |
| --- | ---: | ---: | ---: | --- |
| WIP | 112.524 | 67.971 | **44.553** | Σ `prd_balance.value_balance` = 42.553 + 2.000 |
| Biaya Produksi Dibebankan | 0 | 9.024 | −9.024 | Σ `prd_cost_entry.amount` |
| Beban Pemusnahan Produksi | 6.080 | 0 | 6.080 | Σ `written_off_amount` |
| Persediaan | 166.891 | 103.500 | 63.391 | kotak 61.891 + 3 stiker 1.500 |

---

## 4. Query siap pakai

Ganti angka dan nomornya. Semua hanya membaca.

### 4.1 Isi sebuah Unit sekarang

```sql
SELECT b.stage, s.process, j.job_no, t.tracking_no, i.item_label, p.partai_no,
       b.qty_balance, b.value_balance, b.auxiliary, b.qc_check_id
  FROM prd_balance b
  JOIN ref_unit u             ON u.id = b.unit_id
  JOIN log_stock_tracking t   ON t.id = b.tracking_id
  JOIN m_item i               ON i.id = b.item_id
  LEFT JOIN ref_unit_step s   ON s.id = b.unit_step_id
  LEFT JOIN prd_job j         ON j.id = b.job_id
  LEFT JOIN prd_partai p      ON p.id = b.partai_id
 WHERE u.unit_label = 'UP5' AND b.qty_balance > 0
 ORDER BY b.stage, t.tracking_no;
```

### 4.2 Riwayat satu No. Stok

```sql
SELECT l.posting_date, l.ledger_no, l.line_no, l.source_no, l.movement,
       u.unit_label, l.stage, l.qty_change, l.value_change, l.qty_balance, l.value_balance
  FROM prd_ledger l
  JOIN ref_unit u           ON u.id = l.unit_id
  JOIN log_stock_tracking t ON t.id = l.tracking_id
 WHERE t.tracking_no = 'KTK-181126-002'
 ORDER BY l.id;
```

### 4.3 Silsilah mundur sebuah kotak

```sql
WITH RECURSIVE up AS (
  SELECT k.from_tracking_id, k.to_tracking_id, k.source_no, k.qty, k.value, 1 AS langkah
    FROM prd_tracking_link k
    JOIN log_stock_tracking t ON t.id = k.to_tracking_id
   WHERE t.tracking_no = 'KTK-181126-002'
  UNION
  SELECT k.from_tracking_id, k.to_tracking_id, k.source_no, k.qty, k.value, up.langkah + 1
    FROM prd_tracking_link k JOIN up ON k.to_tracking_id = up.from_tracking_id
   WHERE up.langkah < 20
)
SELECT up.langkah, a.tracking_no AS dari, b.tracking_no AS menjadi, up.source_no, up.qty, up.value
  FROM up
  JOIN log_stock_tracking a ON a.id = up.from_tracking_id
  JOIN log_stock_tracking b ON b.id = up.to_tracking_id
 ORDER BY up.langkah, a.tracking_no;
```

### 4.4 Biaya Unit sebuah partai

```sql
SELECT u.unit_label, SUM(c.grams) AS gram, c.rate, SUM(c.amount) AS biaya,
       SUM(c.amount) FILTER (WHERE c.is_rework) AS biaya_ulang
  FROM prd_cost_entry c
  JOIN ref_unit u   ON u.id = c.unit_id
  JOIN prd_partai p ON p.id = c.partai_id
 WHERE p.partai_no = 'P_181126_00001'
 GROUP BY u.unit_label, c.rate;
```

Biaya sebelum partai lahir tidak ikut (`partai_id` kosong).

### 4.5 Barang yang sedang Dalam Perjalanan dan dokumennya

```sql
SELECT u.unit_label AS dari, t.tracking_no, b.qty_balance, d.doc_label, b.transit_doc_id
  FROM prd_balance b
  JOIN ref_unit u           ON u.id = b.unit_id
  JOIN log_stock_tracking t ON t.id = b.tracking_id
  LEFT JOIN sys_doc_type d  ON d.id = b.transit_doc_type_id
 WHERE b.stage = 'InTransit' AND b.qty_balance > 0;
```

### 4.6 Dari dokumen ke jurnalnya

Tiap dokumen menyimpan `journal_id` (Kerja di barisnya). Dari jurnal ke dokumen:

```sql
SELECT j.journal_no, j.description, a.account_name, l.debit_amount, l.kredit_amount
  FROM acc_journal j
  JOIN acc_journal_line l ON l.journal_id = j.id
  JOIN acc_account a      ON a.id = l.account_id
 WHERE j.id = (SELECT journal_id FROM prd_box WHERE tracking_no = 'KTK-181126-002')
 ORDER BY l.id;
```

---

## 5. Laporan di aplikasi

| Laporan | Alamat | Membaca | Menjawab |
| --- | --- | --- | --- |
| Saldo Produksi | `/production/report/wip-balance` | `prd_ledger` (saldo terakhir sebelum tanggal) | apa yang ada di Unit pada tanggal itu, per tahap |
| Kartu No. Stok | `/production/report/lot-card` | `prd_ledger`, buku stok | semua mutasi satu No. Stok |
| Telusur Produksi | `/production/report/trace` | `prd_tracking_link`, saldo, Delivery Note | asal dan tujuan |

Semuanya tanpa nilai (P275). Nilai dibaca lewat query §4 atau jurnal.

---

## 6. Cek `npm run db:reconcile`

| Yang dibuktikan | Bila gagal, periksa |
| --- | --- |
| bucket = Σ ledger-nya; saldo berjalan benar | ada yang menulis `prd_balance` di luar buku |
| identitas ledger = bucket | sama |
| nilai produksi = `Issued` + biaya − `Released` − beban | dokumen yang setengah jalan |
| tiap dokumen pindah bersaldo 0 | Push / BSTB |
| akun WIP = nilai yang dipegang | akun WIP kategori diganti, atau jurnal manual ke WIP |
| Grading, Pengerjaan, Kotak, Job Order seimbang | dokumen itu |
| biaya dokumen = `prd_cost_entry` (Grading, Pengerjaan) | `recordCostEntry` |
| Sedang Dikerjakan = baris Kerja terbuka | `closeKerja` |
| BSTB Issue dan BSTB dari produksi = stok = jurnal | buku stok |
| Balik QC ada di Persiapan | `decideQcBucket` |

---

## 7. Bila angka terasa aneh

| Gejala | Penyebab yang wajar |
| --- | --- |
| Harga per gram naik padahal tidak ada biaya | **susut**: nilai sama dibagi gram lebih sedikit |
| Hasil bernilai 0 | Item BJL |
| Keping sama berat beda 1 rupiah | sisa pembulatan ke pecahan terbesar (bagian 02 §4) |
| Grading tanpa biaya | bukan proses terakhir Unit (UML), atau tarif Unit 0 |
| Biaya dua kali di Unit yang sama | Balik QC (`is_rework`) |
| Tarif tidak berubah walau Standard Cost baru | versi terkunci di partai atau No. Stok |
| Nomor No. Stok dari lot lain | Job Order memakai input gram terbesar |
| No. Job hilang | grading melepas Job |
| No. Job berkode Unit lain | kode = Unit **penerbit**, bukan Unit sekarang |
| Barang tidak bisa dikirim dari UDA / UBC | checkpoint: partai belum lengkap |
| Rata-rata stok turun | BSTB Pengeluaran *Tanpa nilai*, atau BJL masuk gudang |

---

## 8. Coba sendiri

```powershell
npm run db:seed-production
```

```powershell
node --env-file-if-exists=.env --conditions=react-server --import tsx --test tests/simulasi-po-sampai-finish-goods.test.ts
```

Tes itu menjalankan seluruh routing dengan angkanya sendiri, memeriksa neracanya, lalu
membersihkan datanya.
