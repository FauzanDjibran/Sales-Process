# Produksi 07 — Job Order

Di Moulding (UML), beberapa No. Stok digabung menjadi **satu No. Stok baru** dengan
**No. Job sendiri**. Kebalikan dari grading: banyak menjadi satu.

## Kode acuan

`production-job-order.ts` → `check`, `postJobOrder`.

---

## 1. Cara pakai

1. Workspace › UML › tab **Persiapan Job Order** › **Buat Job Order**.
2. Baris input: pilih No. Stok, isi gram yang diambil (boleh sebagian) → masuk
   keranjang *Akan jadi satu Job*.
3. Pilih **Jenis** hasil (satuan gram), tekan **Buat Job**. Ulangi untuk Job lain.
4. **Posting**. Tidak ada Draft.

Izin `PRODUCTION_JOB_ORDER_VIEW / _POST`.

---

## 2. Sumber data

| Isian | Sumber |
| --- | --- |
| No. Stok | `prd_balance` UML, `Preparation`, proses `JobOrder` |
| Jenis | `m_item` Barang aktif bersatuan **GR** |

Satu No. Stok boleh dibagi ke beberapa Job dalam satu dokumen, asal totalnya tidak
melebihi saldo.

---

## 3. Tabel

`prd_job_order`: `job_order_doc_no` (`JOD_…`), `doc_date`, `unit_id`,
`unit_step_id`, `partai_id`, `journal_id`, `note`.

`prd_job_order_line` — satu baris per Job:

| Kolom | Isi | Contoh |
| --- | --- | ---: |
| `target_item_id` | Jenis | MOULD |
| `job_order_no` | `JO_<no job>` | `JO_UML_231126_00001` |
| `job_id` | Job yang lahir | `UML_231126_00001` |
| `tracking_id`, `tracking_no` | No. Stok baru | `LOTB-1-1-1-1-1` |
| `grams` | Σ gram input | 93 |
| `base_cost_amount` | Σ nilai input | 106.355 |
| `to_bucket_id` | bucket tujuan | B85 |

`prd_job_order_input` — satu baris per No. Stok yang diambil: `bucket_id`,
`tracking_id`, `qty`, `grams`, `base_cost_amount`.

---

## 4. Perhitungan

```
gram hasil  = Σ gram input          (tidak ada susut)
nilai hasil = Σ nilai input         (tidak ada biaya Unit)
No. Stok    = <input dengan gram terbesar>-<n>
No. Job     = baru, diterbitkan UML
```

**Tanpa biaya** karena Job Order bukan proses terakhir UML; biaya Moulding
dibebankan di Assign sesudahnya (bagian 01 §2.3). `chargeUnit` bahkan tidak
dipanggil.

### Contoh `JOD_UML_231126_00001`

| Input | Gram | Nilai |
| --- | ---: | ---: |
| `LOTA-1-1-1-1` | 38 | 44.579 |
| `LOTA-2-1-1-1-1` | 16 | 19.621 |
| `LOTB-1-1-1-1` **(terbesar)** | 39 | 42.155 |
| **Hasil `LOTB-1-1-1-1-1` MOULD** | **93** | **106.355** |

Induk dipilih dari gram terbesar (39 g), jadi nomornya dari LOTB, walau isinya
campuran LOT-A dan LOT-B. Telusurnya tetap lengkap lewat `prd_tracking_link`.

---

## 5. Yang ditulis

| Tabel | Baris |
| --- | --- |
| `prd_ledger` | `Consumed` per input, `Produced` per Job |
| `log_stock_tracking` | 1 per Job |
| `prd_tracking_info` | 1 per Job; tarif dan routing dari input terbesar |
| `prd_job` | 1 per Job, dengan partai |
| `prd_tracking_link` | 1 per input |
| `acc_journal` | **hanya bila akun WIP input dan hasil berbeda** |

Hasil masuk **Persiapan Assign** (proses berikutnya UML). Lalu Pengerjaan UML
membebankan Rp 1.395 (93 g × 15), dan nilainya menjadi 107.750.

---

## 6. Validasi utama

| Aturan | Pesan |
| --- | --- |
| Unit punya proses Job Order | *… tidak punya proses Job Order.* |
| Jenis bersatuan gram | *… tidak bersatuan gram.* |
| Ada No. Stok di tiap Job | *Pilih No. Stok yang dicampur.* |
| Tidak melebihi saldo | *… melebihi saldo (…).* |
| Satu partai | *Satu dokumen hanya untuk satu partai.* |

## 7. Cek

Tiap baris Job Order: `grams` dan `base_cost_amount` = Σ inputnya.
