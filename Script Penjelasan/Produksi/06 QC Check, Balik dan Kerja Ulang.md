# Produksi 06 — QC Check, Balik dan kerja ulang

QC **hanya memutuskan lanjut atau ulang**. QC tidak mengubah barang, gram, atau
nilai, dan tidak berjurnal.

QC bukan proses: ia fitur Unit (`ref_unit.has_qc`). Hasil **proses terakhir** Unit
ber-QC menunggu di tahap `QcCheck`.

## Kode acuan

`production-qc.ts` → `check`, `transitionQcCheck`; buku `decideQcBucket`.

---

## 1. Cara pakai

1. Workspace › Unit › tab **QC Check** › **QC Check** (atau klik baris).
2. Tiap baris: **Lulus** atau **Balik**. *Lulus Semua* mengisi semuanya. Alasan Balik
   opsional.
3. **Simpan** (keputusan boleh belum lengkap) atau **Posting** (semua harus
   diputuskan).

Satu baris = satu Job, atau satu No. Stok tanpa Job. **Job diputuskan utuh**, satu
keputusan untuk semua isinya.

Izin `PRODUCTION_QC_VIEW / _CREATE / _EDIT / _POST / _CANCEL`.

---

## 2. Sumber data

`prd_balance` Unit ini dengan `stage = QcCheck`, `qty > 0`. BJL ikut diperiksa.

---

## 3. Tabel

`prd_qc_check`: `qc_no`, `qc_date`, `unit_id`, `inspector`, `note`, `status`.

`prd_qc_check_line`:

| Kolom | Isi | Catatan |
| --- | --- | --- |
| `bucket_id` | bucket QC Check | |
| `qty` | **seluruh** saldo bucket saat disimpan | berubah sebelum Posting → ditolak |
| `base_cost_amount` | Posting: nilai yang pindah | |
| `decision` | `Pass` / `Return`; kosong di Draft | |
| `reason` | hanya untuk `Return` | |
| `to_bucket_id` | Posting: bucket tujuan | |

---

## 4. Keputusan

| Keputusan | Ke | `qc_check_id` bucket baru | Nilai |
| --- | --- | --- | --- |
| **Lulus** | Stand By | kosong | tetap |
| **Balik** | Persiapan **proses pertama** Unit itu | **id QC Check ini** | tetap, termasuk biaya yang sudah dibebankan |

Ledger: `Consumed` dari bucket QC, `Produced` ke bucket tujuan, jumlah dan nilai sama.

`qc_check_id` membuat barang Balik **bucket tersendiri**: tidak bercampur dengan
barang baru, dan Workspace menandainya *Balik QC*.

### Contoh `QCK_UGH_231126_00001`

| Barang | Keputusan | Dari | Ke | Nilai |
| --- | --- | --- | --- | ---: |
| `LOTA-1` HALUS 38 g | Lulus | B5 | B9 Stand By | 41.869 |
| `LOTA-2` HALUS-B 17 g | **Balik** | B6 | **B10 Persiapan Grading**, `qc_check_id` terisi | 18.731 |
| `LOTA-3` BJL 3 g | Lulus | B7 | B11 Stand By | 0 |
| `LOTB-1` HALUS 39 g | Lulus | B8 | B12 Stand By | 40.400 |

---

## 5. Kerja ulang

Barang Balik dikerjakan lagi dengan dokumen biasa. Bedanya:

| | Barang baru | Barang Balik |
| --- | --- | --- |
| Bucket | `qc_check_id` kosong | `qc_check_id` terisi |
| Biaya Unit | dibebankan | **dibebankan lagi** |
| `prd_cost_entry.is_rework` | `false` | **`true`** |
| Nilai awal | — | nilai yang dibawa, termasuk biaya pertama |

Tanda Balik hilang begitu barang dikerjakan: hasilnya bucket baru tanpa
`qc_check_id`.

### Contoh `NG_UGH_231126_00002`

| | Hitungan | |
| --- | --- | ---: |
| Input `LOTA-2` | 17 g | 18.731 |
| Biaya ulang | `round(17 × 10)` | 170 *(is_rework)* |
| Hasil `LOTA-2-1` | 16 g (susut 1 g) | **18.901** |
| Jurnal | Dr WIP 170 / Cr Biaya Produksi Dibebankan 170 | |

Barang itu jadi menanggung biaya UGH dua kali: bagiannya dari 600 di grading pertama,
dan 170 di grading kedua. Pembebanan kedua ini **asumsi kerja** (P279), belum
dikonfirmasi.

---

## 6. Validasi utama

| Aturan | Pesan |
| --- | --- |
| Unit ber-QC | *… tidak punya QC.* |
| Baris masih menunggu QC | *Baris ini tidak lagi menunggu QC di unit ini.* |
| Saldo belum berubah | *Baris ini sudah berubah sejak dokumen dibuat. Buat QC Check baru.* |
| Posting: semua diputuskan | *Putuskan No. Stok …* |
| Job utuh | *No. Job … diperiksa utuh: … belum ikut.* |
| Satu keputusan per Job | *No. Job … diputuskan sekali untuk seluruh isinya.* |
| Satu partai | *Satu dokumen hanya untuk satu partai.* |

---

## 7. Cek

Bucket dengan `qc_check_id` harus berada di Persiapan, dan QC Check-nya `Posted`.

## 8. Belum ada

Mengembalikan barang ke **Unit sebelumnya** (Dokumen Reproses) belum dibangun. Kasus
parah dikeluarkan lewat BSTB Pengeluaran (bagian 10).
