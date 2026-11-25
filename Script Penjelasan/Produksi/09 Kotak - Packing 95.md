# Produksi 09 — Kotak (Packing 95)

Keping-keping menjadi **satu kotak siap jual** dengan No. Stok baru. Proses
`Assembly`, di UP5.

## Kode acuan

| Bagian | File / fungsi |
| --- | --- |
| Dokumen | `production-box.ts` → `check`, `closeBox` |
| Rekomendasi dan aturan (layar dan server) | `production-box-shape.ts` → `recommend`, `nearestBox`, `boxRuleErrors` |

---

## 1. Cara pakai

1. Workspace › UP5 › tab **Persiapan Assembly** › **Buat Kotak**.
2. Pilih **Nama Jual** (BoM aktif) dan **Partai Sumber** (satu partai atau lintas).
3. Layar merekomendasikan keping. Tiap keping dimasukkan lewat **scan No. Stok**
   (Enter) atau **Masukkan** / **Masukkan Semua** (ditandai *Manual*).
4. Isi **No. CAIQ** tiap keping.
5. **Tutup Kotak** setelah gram, jumlah keping, dan CAIQ lengkap.

Tidak ada Draft: kotak yang belum ditutup tidak disimpan. Izin
`PRODUCTION_BOX_VIEW / _POST`.

---

## 2. Sumber data

| Data | Sumber |
| --- | --- |
| Nama Jual, target, toleransi, keping | `prd_bom` aktif |
| Keping | `prd_balance` UP5, `Preparation`, proses Assembly, bukan penolong, punya gram |
| Bahan penolong per kotak | `prd_bom_component` × saldo `auxiliary` **Unit itu sendiri** |
| CAIQ terpakai | `prd_box_piece.caiq` (unik di seluruh sistem) |

---

## 3. Rekomendasi (`nearestBox`)

```
cari kumpulan keping dengan
  jumlah keping antara min dan max
  Σ gram ≤ target + toleransi
  Σ gram sedekat mungkin ke target
```

Dihitung dalam persepuluh gram (bilangan bulat), jadi pasti. Keping yang sudah masuk
dikunci; rekomendasi mencari sisanya. Operator **boleh memakai keping lain**.

Syarat menutup (`boxRuleErrors`), diperiksa ulang server:

| Syarat | Pesan |
| --- | --- |
| \|Σ gram − target\| ≤ toleransi | *Berat … g di luar 50 ± 1 g.* |
| min ≤ keping ≤ max | *Jumlah keping …, harus 8–13.* |
| tiap keping ber-CAIQ, tidak kembar | *Setiap keping butuh No. CAIQ.* / *… lebih dari sekali …* |
| CAIQ belum dipakai kotak lain | *No. CAIQ … sudah dipakai kotak lain.* |
| penolong cukup di Unit | *Bahan penolong … tidak cukup (kurang …).* |

---

## 4. Tabel

`prd_box`:

| Kolom | Formula | Contoh |
| --- | --- | ---: |
| `box_doc_no` | `ASM_<unit>_<ddmmyy>_` | `ASM_UP5_231126_00001` |
| `bom_id`, `item_id` | BoM dan Nama Jual | KOTAK |
| `partai_id` | partai keping bila **satu**, selain itu kosong | `P_231126_00001` |
| `tracking_id`, `tracking_no` | No. Stok kotak | `KTK-231126-001` |
| `grams`, `pieces` | Σ gram, jumlah keping | 50, 10 |
| `base_piece_amount` | Σ nilai keping | 60.791 |
| `base_process_amount` | Σ `round(gram keping × tarif UP5)` | 600 |
| `base_aux_amount` | Σ nilai penolong | 500 |
| `base_cost_amount` | `base_piece_amount + base_process_amount + base_aux_amount` | **61.891** |
| `to_bucket_id`, `journal_id` | | B150 |

`prd_box_piece`: `bucket_id`, `tracking_id`, `partai_id`, `grams`, `base_cost_amount`, `caiq`,
`is_manual`.

`prd_box_component`: `item_id`, `bucket_id`, `qty`, `base_cost_amount`.

---

## 5. Yang terjadi

```
1. registerAssembledStock   No. Stok KTK-<ddmmyy>-<nnn>, seri per hari
2. tiap keping (utuh)       consumeBucket, lockRateVersion, chargeUnit, linkTracking
3. tiap penolong            consumeBucket dari saldo Unit (boleh dari beberapa bucket)
4. recordTrackingInfo       gram kotak
5. produceIntoBucket        jumlah 1, nilai = value, tanpa Job → Stand By (UP5 tanpa QC)
6. jurnal
```

Biaya dibebankan **per keping**, jadi `prd_cost_entry` berisi 10 baris Rp 60.

### Contoh

| | Hitungan | |
| --- | --- | ---: |
| Keping | 6.080 + 9 × 6.079 | 60.791 |
| Biaya UP5 | 10 × round(5 × 12) | 600 |
| Stiker | round(2.500 × 1 ÷ 5) | 500 |
| **Kotak** | | **61.891** |

| Jurnal | Debit | Kredit |
| --- | ---: | ---: |
| WIP | 600 | |
| Biaya Produksi Dibebankan | | 600 |

Nilai keping dan stiker pindah di dalam akun WIP. Bila Kategori Item kotak, keping,
dan stiker punya akun WIP berbeda, jurnalnya juga memindahkan nilai antar akun.

---

## 6. Sesudah kotak

| Saldo UP5 | Jumlah | Nilai |
| --- | ---: | ---: |
| Kotak (Stand By) | 1 PCS | 61.891 |
| Keping (Persiapan) | 8 × 5 g | 48.633 |
| Stiker (penolong) | 4 PCS | 2.000 |

---

## 7. Cek

`base_cost_amount` = Σ keping + Σ biaya + Σ penolong, gram dalam toleransi, dan jumlah keping
sesuai BoM.
