# Produksi 02 — Buku produksi: bucket, ledger, identitas dan nilai

**Bagian terpenting.** Semua dokumen produksi menulis lewat satu modul,
`production-ledger.ts`. Dokumen tidak pernah mengubah `prd_balance` sendiri.

```
dokumen (Grading, Push, Kotak, …)
   │  memanggil
   ▼
production-ledger.ts  ──►  prd_balance        saldo sekarang, satu baris per bucket
                      ──►  prd_ledger         riwayat, hanya bertambah
                      ──►  prd_job, prd_partai, prd_tracking_info     identitas
                      ──►  prd_tracking_link  silsilah
                      ──►  prd_cost_entry     biaya Unit
   │  kembali dengan nilai
   ▼
dokumen memposting jurnalnya sendiri (acc_journal)
```

Buku produksi **tidak menulis jurnal**.

---

## 1. Bucket — `prd_balance`

Satu bucket = satu baris saldo untuk kombinasi ini:

```
No. Stok · Unit · Tahap · Proses · Partai · Job · QC yang membalikkan
```

### 1.1 Kolom

| Kolom | Isi | Diisi dari |
| --- | --- | --- |
| `tracking_id` | No. Stok | `log_stock_tracking.id` |
| `unit_id` | Unit tempat barang | Unit dokumen / Unit tujuan |
| `stage` | tahap | `destinationAfter` atau jenis gerakan |
| `unit_step_id` | proses yang ditunggu; **terisi hanya** di `Preparation` dan `Working` | `ref_unit_step.id` |
| `partai_id` | partai, boleh kosong | `prd_partai.id` |
| `job_id` | No. Job, boleh kosong | `prd_job.id` |
| `qc_check_id` | QC Check yang membalikkan barang ini, selain itu kosong | `prd_qc_check.id` |
| `auxiliary` | `true` = bahan penolong milik Unit | tujuan BSTB Issue |
| `item_id`, `uom_id` | barang dan satuan dasarnya | `m_item` |
| `qty_balance` | jumlah sekarang (satuan dasar) | Σ `prd_ledger.qty_change` |
| `value_balance` | nilai sekarang, rupiah utuh | Σ `prd_ledger.base_cost_amount_change` |
| `entered_at` | kapan terakhir naik dari kosong (*Sejak* di Workspace) | tanggal dokumen |
| `transit_doc_type_id`, `transit_doc_id` | dokumen yang membawa barang, hanya di Dalam Perjalanan | dokumen kirim |

**Kunci unik** (`NULLS NOT DISTINCT`): `tracking_id, unit_id, stage, unit_step_id,
partai_id, job_id, qc_check_id`. Karena `NULL` dianggap sama, dua barang tanpa Job
di tempat yang sama **bergabung** di bucket yang sama.

Barang yang pindah tahap **pindah bucket**. Bucket lama tinggal dengan saldo 0 dan
tidak dihapus, karena ledger menunjuknya.

### 1.2 Aturan saldo

| Aturan | Ditolak dengan |
| --- | --- |
| jumlah dan nilai tidak negatif | *Saldo produksi tidak boleh negatif.* |
| jumlah 0 berarti nilai 0 | *Saldo produksi yang kosong tidak boleh bernilai.* |
| tidak mengambil lebih dari yang ada | *Saldo produksi … tidak cukup: tersedia …, diminta …* |
| jumlah paling banyak 6 desimal | *Jumlah paling banyak 6 angka desimal.* |
| periode yang sudah di-costing tidak menerima mutasi | pesan `costedPeriodRefusal` |

---

## 2. Ledger — `prd_ledger`

Satu baris per perubahan bucket, ditulis **dalam transaksi yang sama** dengan
saldonya. Tidak pernah diubah atau dihapus.

| Kolom | Isi |
| --- | --- |
| `ledger_no`, `line_no` | `MP/2026/11/NNNN`; **satu nomor per dokumen posting**, baris 1..n |
| `posting_date` | tanggal dokumen |
| `source_doc_type_id`, `source_doc_id`, `source_no` | dokumen penyebab, referensi lemah tanpa FK |
| `movement` | jenis gerakan (§2.1) |
| `bucket_id` | bucket yang berubah |
| `tracking_id`, `unit_id`, `stage`, `unit_step_id`, `partai_id`, `job_id`, `item_id` | **salinan identitas bucket**, supaya laporan tidak perlu join |
| `qty_change`, `value_change` | bertanda: + masuk, − keluar |
| `qty_balance`, `value_balance` | saldo bucket **sesudah** baris ini |

Nomor `MP` diambil dari `sys_number_counter` (satu baris per seri), di dalam
transaksi posting, jadi posting yang gagal mengembalikan nomornya.

### 2.1 Jenis gerakan

| `movement` | Tanda | Dipakai oleh |
| --- | --- | --- |
| `Issued` | + | Production Receipt (Terima): masuk dari gudang |
| `Consumed` | − | Grading, Pengerjaan, Job Order, Kotak, Kerja (Mulai dan Selesai), QC Check |
| `Produced` | + | pasangan `Consumed` |
| `TransferOut` | − | Push, BSTB, kirim ke gudang |
| `TransferIn` | + | pasangan `TransferOut` |
| `Released` | − | Terima BSTB ke Finish Goods / Pengeluaran: keluar produksi |

Nilai hanya **masuk** produksi lewat `Issued` dan biaya Unit, dan hanya **keluar**
lewat `Released` dan beban grading/pengerjaan. Sisanya perpindahan di dalam. Itulah
cek neraca di `db:reconcile` (bagian 11).

### 2.2 Fungsi → gerakan

| Fungsi | Dari → ke | Baris ledger |
| --- | --- | --- |
| `enterProduction` | gudang → Persiapan proses pertama | `Issued` |
| `consumeBucket` | Persiapan → habis | `Consumed` |
| `produceIntoBucket` | → Persiapan berikutnya / QC Check / Stand By | `Produced` |
| `moveKerja` | Persiapan ↔ Sedang Dikerjakan → tujuan | `Consumed` + `Produced` |
| `decideQcBucket` | QC Check → Stand By / Persiapan | `Consumed` + `Produced` |
| `sendInTransit` | Stand By (atau Persiapan) → Dalam Perjalanan | `TransferOut` + `TransferIn` |
| `transferBucket` | Stand By / Dalam Perjalanan → Persiapan Unit tujuan | `TransferOut` + `TransferIn` |
| `takeFromBucket` | Dalam Perjalanan → keluar produksi | `Released` |

---

## 3. Rumus nilai yang dilepas

Dipakai setiap kali barang **keluar** dari bucket:

```
q = jumlah diambil,  Q = saldo jumlah,  V = saldo nilai

q = Q  →  nilai = V              (bucket kosong melepas semuanya)
q < Q  →  nilai = round(V × q ÷ Q)     half up, rupiah utuh
```

Kali dulu, bagi belakangan, bulatkan sekali. Bucket yang habis **selalu** berakhir
0 / 0.

Contoh stiker di UP5 (5 PCS, Rp 2.500), dipakai 1: `round(2.500 × 1 ÷ 5)` = **500**;
sisa 4 PCS, Rp 2.000.

Nilai **tidak** disimpan per satuan. Tidak ada harga rata-rata yang dikalikan lagi.

---

## 4. Pembagian nilai (`shareByWeight`)

Membagi rupiah utuh menurut bobot, **largest remainder**:

```
1. bagian[i] = floor(total × bobot[i] ÷ Σ bobot)
2. rupiah yang tersisa diberikan satu-satu ke pecahan terbesar (seri: yang lebih dulu)
```

Jumlah bagian selalu sama persis dengan total.

Contoh UBC: Rp 109.424 ke 18 keping sama berat. `109.424 ÷ 18` = 6.079 sisa 2, jadi
dua keping pertama 6.080 dan 16 keping 6.079.

---

## 5. Identitas

### 5.1 No. Stok — `log_stock_tracking` (milik buku stok)

| Cara lahir | Nomor | Fungsi |
| --- | --- | --- |
| Receipt Note | diketik, atau otomatis | `receiveStock` |
| Grading | `<induk>-<n>` | `registerDerivedStock` |
| Job Order | `<input terbesar>-<n>` | `registerDerivedStock` |
| Kotak | `KTK-<ddmmyy>-<nnn>` | `registerAssembledStock` |

`n` melanjutkan anak terbesar dari induk yang sama. Contoh `LOTA` → `LOTA-1`,
`LOTA-2`, `LOTA-3`; `LOTA-2` → `LOTA-2-1`. Kolom `source_doc_*` menyebut dokumen
pembuatnya, `expiry_date` diwarisi dari induk.

### 5.2 No. Job — `prd_job`

| Kolom | Isi |
| --- | --- |
| `job_no` | `<kode unit>_<ddmmyy>_<NNNNN>`, Unit **yang menerbitkan** |
| `unit_id` | Unit penerbit |
| `tracking_id` | No. Stok yang diambil |
| `partai_id` | partai saat lahir |
| `source_*` | dokumen penyebab |

| Kejadian | No. Job |
| --- | --- |
| BSTB Issue *Bahan ke Produksi* diterima | **lahir**, satu per ambilan |
| Grading | **dilepas**, selalu |
| Push / BSTB, barang punya Job | diteruskan |
| Push / BSTB, barang tanpa Job | **lahir baru**, per ambilan, di Unit pengirim |
| … kecuali BSTB Penyebaran dan Unit tujuan Assembly | tetap tanpa Job |
| Job Order | **lahir baru**, satu per baris |
| Pengerjaan, Kerja, QC | tetap |
| Kotak | kotak lahir tanpa Job |
| BSTB Pengeluaran | berakhir |

**Job selalu utuh:** setiap dokumen mengambil semua No. Stok Job itu yang ada di
tahap dan proses tersebut.

### 5.3 Partai — `prd_partai`

| Kolom | Isi | Sumber |
| --- | --- | --- |
| `partai_no` | `P_<ddmmyy>_<NNNNN>` | otomatis |
| `line_id` | line | dipilih di BSTB Penyebaran |
| `routing_id` | routing yang diikuti | routing line itu dengan Unit pertama = tujuan |
| `rate_version_id` | Standard Cost yang dikunci | versi `Active` saat Terima |
| `source_*` | dokumen BSTB Penyebaran | |

Lahir saat **Terima**, bukan saat kirim. Satu dokumen hanya memuat satu partai.

### 5.4 `prd_tracking_info` — yang dikunci No. Stok

| Kolom | Isi |
| --- | --- |
| `tracking_id` | No. Stok, unik |
| `rate_version_id` | Standard Cost yang dipakai sebelum partai |
| `routing_id` | segmen yang diikuti |
| `grams` | gram saat dibuat; dipakai untuk barang bukan GR |
| `form` | `Bulk` (GR) atau `Piece` |

Ditulis **sekali**; panggilan berikutnya mengembalikan yang sudah ada.

### 5.5 `prd_tracking_link` — silsilah

Satu baris per (input → output): `from_bucket_id`, `from_tracking_id`,
`to_tracking_id`, `qty`, `base_cost_amount`, `source_*`. Ditulis oleh Grading, Job Order, dan
Kotak. Dibaca Telusur Produksi. Hanya **keterangan**: tidak pernah dijumlah menjadi
saldo.

### 5.6 `prd_cost_entry` — biaya Unit

| Kolom | Isi |
| --- | --- |
| `posting_date`, `source_*` | dokumen |
| `unit_id` | Unit yang membebankan |
| `rate_version_id`, `rate` | versi dan tarif yang dipakai, **disalin** |
| `tracking_id` | No. Stok **input** yang dikerjakan |
| `partai_no`, `line_id` | partai dan line-nya, kosong sebelum partai |
| `grams` | gram yang dibebankan |
| `amount` | `round(grams × rate)` |
| `is_rework` | barang ini hasil Balik QC, biaya kedua kalinya |

Ditulis hanya bila prosesnya **terakhir** di Unit. Proses sebelumnya tidak menulis
baris (biaya 0).

---

## 6. Urutan satu posting

Semua dokumen mengikuti pola yang sama, dalam **satu transaksi database**:

```
1. holdPostingPeriod   periode akuntansi harus terbuka, ditahan selama posting
2. check()             semua aturan diperiksa ulang di dalam transaksi
3. status Draft → Posted dengan updateMany(where status = Draft); bila 0 baris → ditolak
4. ambil barang        consumeBucket / takeFromBucket  (bucket dikunci FOR UPDATE)
5. kunci tarif         lockRateVersion
6. biaya Unit          chargeUnit
7. buat identitas      No. Stok / Job / Partai baru
8. taruh hasil         produceIntoBucket / transferBucket
9. silsilah            linkTracking
10. jurnal             postToErp → production-posting (jurnal dan prd_cost_entry)
11. angka di dokumen   base_cost_amount, base_process_amount, to_bucket_id, journal_id
12. audit_log
```

Gagal di langkah mana pun → semuanya batal, termasuk nomor `MP`.

**Pratinjau jurnal** di ERP = posting yang sama, lalu dibatalkan
(`PostingDryRun`). Tidak ada rumus kedua.

### 6.1 Kunci

| Yang dikunci | Cara |
| --- | --- |
| bucket | `SELECT … FOR UPDATE` |
| seri nomor harian | `pg_advisory_xact_lock(hashtext(seri))` |
| stok dan produksi sekaligus | masing-masing transaksinya sendiri; nilai beku di dokumen (P317) |

---

## 7. Nomor dokumen

`<JENIS>_<unit>_<ddmmyy>_<NNNNN>`, seri per hari per Unit.

| Dokumen | Nomor | Unit pada nomor |
| --- | --- | --- |
| BSTB Issue | `BSTB_UGH_231126_00001` | Unit tujuan |
| No. Grading | `NG_UGH_…` | Unit kerja |
| Pengerjaan Unit | `KRJ_UPC_…` | Unit kerja |
| Kerja | `KJ_UCL_…` | Unit kerja |
| QC Check | `QCK_UGH_…` | Unit kerja |
| Job Order | `JOD_UML_…`; tiap Job `JO_<no job>` | Unit kerja |
| Push | `PSH_UGH_…` | Unit **asal** |
| BSTB | `BST_UPW_…` | Unit **tujuan** |
| Kotak | `ASM_UP5_…` | Unit kerja |
| BSTB ke Finish Goods | `BFG_UP5_…` | Unit asal |
| BSTB Pengeluaran | `BPG_UGH_…` | Unit asal |
| Partai | `P_231126_00001` | — |
| No. Job | `UGH_231126_00001` | Unit penerbit |
| Buku produksi | `MP/2026/11/0001` | per bulan |

---

## 8. Contoh membaca: perjalanan LOT-B di ledger

| Dokumen | `movement` | Bucket | Unit, tahap | qty | nilai | Job |
| --- | --- | --- | --- | ---: | ---: | --- |
| `BSTB_UGH_…00002` | Issued | B2 | UGH Persiapan Grading | +40 | +40.000 | `UGH_…00002` |
| `NG_UGH_…00001` | Consumed | B2 | UGH Persiapan Grading | −40 | −40.000 | `UGH_…00002` |
| `NG_UGH_…00001` | Produced | B8 | UGH QC Check (`LOTB-1`) | +39 | +40.400 | — |
| `QCK_UGH_…00001` | Consumed | B8 | UGH QC Check | −39 | −40.400 | — |
| `QCK_UGH_…00001` | Produced | B12 | UGH Stand By | +39 | +40.400 | — |
| `PSH_UGH_…00001` | TransferOut | B12 | UGH Stand By | −39 | −40.400 | — |
| `PSH_UGH_…00001` | TransferIn | B18 | UPC Persiapan Assign | +39 | +40.400 | `UGH_…00005` |

Baca: 40 g masuk senilai 40.000; grading menambah biaya 400 (40 g × 10), membuat
No. Stok baru 39 g (susut 1 g, nilainya ikut ke 39 g), dan melepas Job; Push memberi
Job baru.
