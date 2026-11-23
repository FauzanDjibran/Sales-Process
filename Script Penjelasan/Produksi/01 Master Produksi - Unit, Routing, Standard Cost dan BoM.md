# Produksi 01 — Master: Unit, Routing, Standard Cost dan BoM

Master menentukan **ke mana barang berjalan**, **apa yang dikerjakan di tiap
Unit**, dan **berapa biayanya**. Tidak ada Unit yang ditulis di kode: menambah
Unit atau mengubah urutan adalah mengubah data.

## Kode acuan

| Bagian | File / fungsi |
| --- | --- |
| Aturan form (dipakai dialog dan server) | `production-master-shape.ts` |
| Cek dan simpan | `production-master.ts` |
| Definisi layar | `entities.ts` |
| Seed | `scripts/seed-production-masters.ts` |

---

## 1. Urutan mengisi

| # | Master | Menu (ERP) | Butuh |
| --: | --- | --- | --- |
| 1 | Workstation | Master › Produksi | — |
| 2 | Unit + proses | Master › Produksi | Workstation |
| 3 | Line Produksi | Master › Produksi | akun varians |
| 4 | Routing | Master › Produksi | Unit, Line |
| 5 | Item, flag BJL, akun Kategori Item | Master / Accounting › Pengaturan | — |
| 6 | Standard Cost | Produksi › Master Biaya | Unit |
| 7 | BoM Packing | Produksi › Master Biaya | Item kotak |
| 8 | Karyawan | aplikasi Produksi › Master | — |
| 9 | Unit per user, Gudang per user | Pengaturan › User | Unit, Gudang |

Langkah 1–4 bisa diisi sekaligus dengan `npm run db:seed-production`.

---

## 2. Workstation dan Unit

**Workstation** hanya **pengelompok Unit**. Gunanya satu: menentukan Push atau
BSTB (§4.3).

### 2.1 Tabel `ref_unit`

| Kolom | Label di layar | Isi | Dipakai oleh |
| --- | --- | --- | --- |
| `unit_code` | — | `unit.NNNN`, otomatis | — |
| `unit_label` | Kode Unit | `UGH`; **terkunci** setelah disimpan | nomor dokumen dan No. Job |
| `unit_name` | Nama Unit | `Grading Halus` | layar |
| `workstation_id` | Workstation | → `ref_workstation` | Push atau BSTB |
| `has_qc` | QC | hasil proses terakhir menunggu QC Check | `destinationAfter` |
| `allow_reproses` | Reproses | disimpan, **belum dipakai** | — |

### 2.2 Tabel `ref_unit_step` — proses Unit

| Kolom | Isi |
| --- | --- |
| `unit_id` | Unit pemilik |
| `seq` | urutan, mulai 1 |
| `process` | `Grading`, `JobOrder`, `Assign`, `Kerja`, `Assembly` |

Contoh UML: `1 Grading`, `2 JobOrder`, `3 Assign`, dan `has_qc = true`.

| Proses | Dokumen | Yang terjadi pada barang | Bagian |
| --- | --- | --- | --- |
| Grading | No. Grading | menjadi No. Stok baru; No. Job dilepas | 04 |
| JobOrder | Job Order | beberapa No. Stok menjadi satu, dengan No. Job baru | 07 |
| Assign | Pengerjaan Unit | No. Stok dan gram tetap | 05 |
| Kerja | Kerja (Mulai / Selesai) | No. Stok dan gram tetap, ada waktu kerja | 05 |
| Assembly | Kotak | keping menjadi satu kotak | 09 |

**Aturan** (`unitStepRuleErrors`):

| Aturan | Pesan |
| --- | --- |
| minimal satu proses | *Unit butuh minimal satu proses.* |
| satu proses sekali per Unit | *Satu proses hanya boleh sekali per Unit. …* |
| Assembly sendirian | *Assembly berdiri sendiri, tanpa proses lain.* |
| proses yang pernah dilewati barang tidak bisa dihapus | `unitStepHasHistory` |

### 2.3 Tiga fungsi yang dipakai semua dokumen

| Fungsi | Menjawab | Logika |
| --- | --- | --- |
| `firstStep(unit)` | barang yang diterima masuk ke mana | proses `seq` terkecil |
| `destinationAfter(step)` | setelah proses ini ke mana | ada proses berikutnya → **Persiapan** proses itu; tidak ada dan `has_qc` → **QC Check**; selain itu → **Stand By** |
| `isLastStep(step)` | apakah biaya Unit dibebankan | tidak ada `seq` yang lebih besar |

Contoh UML:

| Selesai | Ke | Biaya Unit dibebankan? |
| --- | --- | --- |
| Grading | Persiapan Job Order | tidak (bukan terakhir) |
| Job Order | Persiapan Assign | tidak |
| Assign | QC Check | **ya** |

---

## 3. Line Produksi — `prd_line`

| Kolom | Isi | Dipakai |
| --- | --- | --- |
| `line_label`, `line_name` | `REG` Reguler, `MIE` Mie | partai |
| `variance_account_id` | akun varians (kelompok Harga Pokok Penjualan) | Closing, **belum dibangun** |

---

## 4. Routing — `prd_routing`, `prd_routing_step`

### 4.1 Isi

| Tabel.kolom | Isi |
| --- | --- |
| `prd_routing.line_id` | line pemilik; **kosong = segmen sebelum partai** (hanya boleh satu) |
| `prd_routing_step.seq` | urutan Unit |
| `.unit_id` | Unit, sekali per routing |
| `.is_checkpoint` | barang hanya boleh keluar Unit ini **bersama seluruh isi partai** |
| `.is_skippable` | disimpan, **belum berefek** |

### 4.2 Aturan (`stepRuleErrors`)

| Aturan | Alasan |
| --- | --- |
| routing tanpa line berakhir di Unit Grading | BSTB keluarnya melahirkan partai |
| routing line tidak memuat Unit akhir segmen, dan mulai di Workstation lain | partai lahir pada **BSTB**, bukan Push |
| langkah pertama bukan checkpoint | belum ada yang ditunggu |
| routing yang sudah dipakai: langkahnya terkunci | barang berjalan di atasnya; buat routing baru lewat *Salin* |

*Sudah dipakai* = ada `prd_partai.routing_id` atau `prd_tracking_info.routing_id`.

### 4.3 Cara keluar tidak diketik

`exitRoutes` menghitungnya dari Workstation:

```
langkah i dan i+1 di Workstation yang sama  → Dokumen Push
berbeda                                     → BSTB
langkah terakhir segmen sebelum partai      → BSTB (melahirkan partai)
langkah terakhir routing line               → tidak ada; barang ke Finish Goods (endsLine)
```

| Dari → ke | Workstation | Cara |
| --- | --- | --- |
| UGH → UPC | BB + PPIC → BB + PPIC | Push |
| UPY → UPW | BB + PPIC → CL | BSTB Penyebaran |
| USR → UDA | CL → ML | BSTB |
| UP5 → gudang | akhir line | BSTB ke Finish Goods |

### 4.4 Routing mana yang diikuti barang

```
barang punya partai  → routing partai itu        (prd_partai.routing_id)
belum punya partai   → segmen sebelum partai      (prd_routing.line_id IS NULL)
```

Unit pertama segmen itu (`firstProductionUnit`) adalah satu-satunya pintu masuk
bahan (bagian 03).

---

## 5. Standard Cost — `prd_rate_version`, `prd_rate_version_line`

| Tabel.kolom | Isi | Contoh |
| --- | --- | --- |
| `prd_rate_version.rate_label` | label versi | SC-2026-11 |
| `.status` | **satu saja `Active`** (indeks unik parsial) | Active |
| `prd_rate_version_line.unit_id` | Unit | UGH |
| `.rate` | rupiah **per gram**, sampai 6 desimal | 10 |

**Aturan penting**

| Aturan | Cara kerjanya |
| --- | --- |
| Versi tidak pernah diubah | tombol ubah tidak ada; perubahan = versi baru |
| Versi baru menutup yang lama | satu transaksi: lama `Inactive`, baru `Active` |
| Unit yang tidak ditulis | tarif 0 |
| Dibebankan **sekali per Unit** | hanya dokumen **proses terakhir** (P281) |

**Versi dikunci per barang**, supaya pergantian tarif tidak mengubah barang yang
sedang berjalan (`lockRateVersion`):

```
barang punya partai → versi partai           prd_partai.rate_version_id   (dikunci saat partai lahir)
belum punya partai  → versi No. Stok         prd_tracking_info.rate_version_id
                      (dikunci saat No. Stok pertama kali dikerjakan = versi Active hari itu;
                       hasil grading mewarisi versi inputnya)
```

Biaya Unit:

```
biaya = round(gram × tarif)      rupiah utuh, half up
```

Contoh: 60 g × Rp 10 di UGH = **Rp 600**.

---

## 6. BoM Packing — `prd_bom`, `prd_bom_component`

| Kolom | Label | Isi contoh |
| --- | --- | --- |
| `item_id` | Nama Jual | KOTAK: **Item kotak itu sendiri**, Barang Kelola Stok |
| `target_grams` | Gram per Kotak | 50 |
| `tolerance_grams` | Toleransi | 1 |
| `min_pieces`, `max_pieces` | Keping Minimal / Maksimal | 8 / 13 |
| `prd_bom_component.item_id`, `.qty` | Bahan Penolong per kotak | STIKER, 1 |

Satu versi `Active` per Nama Jual. Dibaca hanya oleh Kotak (bagian 09).

---

## 7. Item dan akun

### 7.1 Syarat Item

| Syarat | Kolom | Kenapa |
| --- | --- | --- |
| Barang dengan Kelola Stok | `m_item.item_type`, `track_stock` | hanya itu yang boleh masuk buku produksi |
| Satuan dasar **GR** untuk barang curah | `m_item.base_uom_id` | gram = jumlahnya |
| BJL | `m_item.is_bjl` | nilai selalu 0; terkunci setelah dipakai produksi |

**Gram barang** (`gramsOf`):

```
satuan GR     → gram = jumlah
bukan GR      → gram = jumlah × prd_tracking_info.grams No. Stok itu
tidak keduanya → ditolak ("… tidak bersatuan GR dan No. Stok-nya tidak punya gram")
```

### 7.2 Akun

| Akun | Diatur di | Kolom / kunci | Dipakai saat |
| --- | --- | --- | --- |
| Persediaan | Account Kategori Item (cadangan: Account Mapping) | `acc_item_category_account.inventory_account_id` / `inventory_account` | BSTB Issue, BSTB ke FG, Pengeluaran |
| **WIP** | Account Kategori Item, **tanpa cadangan** | `wip_account_id` | semua dokumen bernilai |
| Biaya Produksi Dibebankan | Account Mapping › Produksi | `production_absorbed_account` | biaya Unit (kredit) |
| Beban Pemusnahan Produksi | Account Mapping › Produksi | `production_scrap_account` | nilai tanpa penerima, Tanpa nilai |

Kategori tanpa akun WIP **menolak posting**: *Lengkapi Account Kategori Item …*.

---

## 8. Dari mana tiap dokumen membaca master

| Yang dibutuhkan | Sumber |
| --- | --- |
| Boleh tidaknya dokumen di Unit ini | `ref_unit_step.process` |
| Barang yang bisa dipilih | `prd_balance` di Unit, `stage`, dan `unit_step_id` proses itu |
| Tujuan setelah selesai | `ref_unit_step.seq` berikutnya, `ref_unit.has_qc` |
| Unit berikutnya | `prd_routing_step.seq + 1` |
| Push atau BSTB | `ref_unit.workstation_id` kedua Unit |
| Harus sekaligus satu partai? | `prd_routing_step.is_checkpoint` |
| Tarif | `prd_rate_version_line` versi yang dikunci |
| Akun WIP | Kategori Item barang |
