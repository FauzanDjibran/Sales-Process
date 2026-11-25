# Produksi 05 — Pengerjaan Unit dan Kerja

Dua dokumen untuk Unit yang **tidak mengubah No. Stok dan gram**. Nilainya bertambah
biaya Unit.

| | **Pengerjaan Unit** (proses `Assign`) | **Kerja** (proses `Kerja`) |
| --- | --- | --- |
| Unit | UPC, UPW, UC1, USR, UML, UWP | UCL |
| Dicatat | sekali, sesudah selesai | dua kali: **Mulai**, lalu **Selesai** |
| Tahap antara | tidak ada | Sedang Dikerjakan |
| Draft | ada | tidak; Mulai langsung berlaku |
| Bahan penolong | bisa | tidak |
| Nomor | `KRJ_…` | `KJ_…` |
| Karyawan | satu per No. Job | satu per No. Job |

## Kode acuan

| Bagian | File / fungsi |
| --- | --- |
| Pengerjaan | `production-work.ts`; nilai `shareWork` |
| Kerja | `production-kerja.ts` → `startKerja`, `closeKerja`; buku `moveKerja` |

---

# A. Pengerjaan Unit

## A1. Cara pakai

1. Workspace › Unit › tab **Persiapan Assign** › **Catat Pengerjaan** atau klik baris.
2. Pilih Job (utuh) atau No. Stok tanpa Job (boleh sebagian).
3. Pilih **Karyawan** per Job (*Samakan dengan Baris Pertama* mengisi semuanya).
4. Opsional: Bahan Penolong, **Catatan Hasil** (terbaca nanti di Penyebaran).
5. **Simpan** atau **Posting**.

Izin `PRODUCTION_WORK_VIEW / _CREATE / _EDIT / _POST / _CANCEL`.

## A2. Sumber data

| Isian | Sumber |
| --- | --- |
| Baris | `prd_balance` Unit ini, `Preparation`, proses `Assign`, bukan penolong |
| Karyawan | `m_employee` aktif |
| Penolong | `prd_balance` `auxiliary` Unit ini |

## A3. Tabel

`prd_work`:

| Kolom | Formula | Contoh `KRJ_UPC_231126_00001` |
| --- | --- | ---: |
| `work_no`, `work_date`, `unit_id`, `result_note` | diketik / seri | "bulu halus" |
| `rate` | tarif baris terakhir, keterangan | 5 |
| `base_process_amount` | Σ biaya baris | 465 |
| `base_aux_amount` | Σ nilai penolong | 1.000 |
| `base_scrap_amount` | nilai tanpa penerima | 0 |
| `journal_id` | | |

`prd_work_line` — satu baris per **bucket**:

| Kolom | Isi | Contoh baris 1 |
| --- | --- | ---: |
| `bucket_id`, `job_id`, `employee_id` | dipilih | B16, `UGH_…00003` |
| `qty`, `grams` | jumlah; gram saat Posting | 38 |
| `base_input_amount` | nilai yang dilepas bucket | 41.869 |
| `base_process_amount` | `round(38 × 5)` | 190 |
| `base_aux_amount` | penolong untuk baris ini | 1.000 |
| `base_cost_amount` | nilai hasil | 43.059 |
| `to_bucket_id` | bucket tujuan | B19 |

`prd_aux_use`: `work_id`, `bucket_id`, `job_id` (Job yang memakainya), `qty`, `base_cost_amount`.

## A4. Perhitungan (`shareWork`)

```
baris biasa  : nilai = input + biaya sendiri
baris BJL    : nilai = input (0)
               biaya BJL dibagi ke baris bukan BJL menurut gram
penolong     : ke Job-nya, dibagi menurut gram baris bukan BJL Job itu
               (tanpa Job, atau Job-nya BJL semua → ke seluruh baris bukan BJL)
tidak ada penerima sama sekali → base_scrap_amount
```

| Baris | Input | Biaya | Penolong | Nilai |
| --- | ---: | ---: | ---: | ---: |
| `LOTA-1` 38 g | 41.869 | 190 | 1.000 | **43.059** |
| `LOTA-2-1` 16 g | 18.901 | 80 | 0 | **18.981** |
| `LOTB-1` 39 g | 40.400 | 195 | 0 | **40.595** |
| Σ | 101.170 | 465 | 1.000 | **102.635** |

Dua stiker dipakai untuk Job pertama saja (`prd_aux_use.job_id`), jadi hanya baris itu
yang naik 1.000.

## A5. Yang ditulis

| Tabel | Baris |
| --- | --- |
| `prd_ledger` | `Consumed` + `Produced` per baris; `Consumed` per penolong |
| `prd_cost_entry` | 1 per baris, bila Assign proses terakhir |
| `acc_journal` | 1 |

Barang keluar Persiapan dan masuk **QC Check** (Unit ber-QC), **Stand By**, atau
Persiapan proses berikutnya. No. Stok, Job, dan partai tetap. Tidak ada
`prd_tracking_link`, karena No. Stok tidak berubah.

Jurnal: Dr WIP 465 / Cr Biaya Produksi Dibebankan 465. Penolong pindah di dalam akun
WIP, jadi tidak tampil bila akunnya sama.

## A6. Validasi utama

| Aturan | Pesan |
| --- | --- |
| Job dikerjakan utuh | *No. Job … dikerjakan utuh: …* |
| Satu Job satu karyawan | *Satu No. Job satu karyawan: …* |
| Satu dokumen satu partai | *Satu dokumen hanya untuk satu partai.* |
| Karyawan aktif | *Karyawan nonaktif.* |

---

# B. Kerja (Cleaning)

## B1. Cara pakai

| Langkah | Di mana | Yang terjadi |
| --- | --- | --- |
| **Mulai** | tab Persiapan Kerja › *Mulai Kerja* | dokumen `KJ_…` dibuat; barang pindah ke Sedang Dikerjakan |
| **Selesai** | tab Sedang Dikerjakan › centang › *Selesaikan (n)* | biaya dibebankan; barang ke tahap berikutnya |
| **Batal Mulai** | tab yang sama | kembali ke Persiapan, tanpa biaya |

Satu dokumen Kerja bisa diselesaikan bertahap. Statusnya:

| `prd_kerja.status` | Arti |
| --- | --- |
| `Running` | ada baris yang belum selesai atau batal |
| `Finished` | semua tertutup, minimal satu selesai |
| `Cancelled` | semua dibatalkan |

Izin `PRODUCTION_KERJA_VIEW / _START / _FINISH`.

## B2. Tabel `prd_kerja_line`

| Kolom | Diisi saat | Isi | Contoh `LOTA-1-1` |
| --- | --- | --- | ---: |
| `from_bucket_id` | Mulai | bucket Persiapan asal | B43 |
| `work_bucket_id` | Mulai | bucket Sedang Dikerjakan | B46 |
| `tracking_id`, `job_id`, `employee_id` | Mulai | | `UPW_…00001` |
| `qty`, `grams` | Mulai | seluruh bucket | 38 |
| `base_cost_amount` | Mulai | nilai saat mulai | 43.363 |
| `is_rework` | Mulai | barang Balik QC | false |
| `started_at` | Mulai | waktu server | |
| `finished_at` / `cancelled_at`, `closed_by` | Selesai / Batal | | |
| `base_process_amount` | Selesai | `round(38 × 20)` | 760 |
| `to_bucket_id` | Selesai / Batal | bucket tujuan | B49 |
| `journal_id` | Selesai | jurnal dokumen itu | |

## B3. Nilai dan ledger

| Langkah | `prd_ledger` | Nilai |
| --- | --- | ---: |
| Mulai | `Consumed` Persiapan −43.363, `Produced` Sedang Dikerjakan +43.363 | tetap |
| Selesai | `Consumed` Sedang Dikerjakan −43.363, `Produced` QC Check **+44.123** | + 760 |

Biaya ditambahkan **saat Selesai**, karena Kerja proses terakhir UCL.

| `KJ_UCL_231126_00001` | Debit | Kredit |
| --- | ---: | ---: |
| WIP | 1.860 | |
| Biaya Produksi Dibebankan | | 1.860 |

`1.860 = 760 + 320 + 780` (93 g × 20).

**Tanggal Selesai** tidak boleh sebelum tanggal Mulai. Jurnal bertanggal Selesai.

---

## Cek

| Cek | Rumus |
| --- | --- |
| Pengerjaan | Σ `base_input_amount` + `base_process_amount` + `base_aux_amount` = Σ `base_cost_amount` + `base_scrap_amount` |
| Sedang Dikerjakan | tiap bucket `Working` = Σ `qty` baris Kerja yang terbuka |
| Gram | gram hasil = gram input |
