# Produksi 00 — Baca dulu: peta dan cerita contoh

Seri ini menjelaskan produksi dari **bahan keluar gudang** sampai **kotak masuk
Gudang Finish Goods**: cara pakai, logika sistem, isi setiap kolom, dan dari
mana angkanya. Ditulis menurut kode per 23/11/2026 (P306).

**Semua angka contoh berasal dari menjalankan kode asli** di database lokal,
satu cerita dari awal sampai akhir (§6). Nomor dokumen dan rupiahnya sama di
semua bagian, jadi bagian mana pun bisa dicocokkan dengan bagian lain.

---

## 1. Urutan membaca

| Bagian | Isi | Dibaca bila |
| --- | --- | --- |
| **00** | Peta, istilah, cerita contoh | mulai dari sini |
| **01** | Master: Workstation, Unit, Line, Routing, Standard Cost, BoM, akun | menyiapkan data |
| **02** | **Buku produksi**: bucket, ledger, identitas, rumus nilai | **wajib** sebelum 03–10 |
| **03** | BSTB Issue: bahan dari gudang ke Unit | barang masuk produksi |
| **04** | No. Grading | barang dipecah menjadi No. Stok baru |
| **05** | Pengerjaan Unit dan Kerja | barang dikerjakan, gram tetap |
| **06** | QC Check, Balik, dan kerja ulang | barang diperiksa |
| **07** | Job Order | beberapa No. Stok digabung |
| **08** | Push, BSTB, Penyebaran, partai, checkpoint | barang pindah Unit |
| **09** | Kotak (Packing 95) | keping menjadi kotak |
| **10** | BSTB ke Finish Goods dan BSTB Pengeluaran | barang keluar produksi |
| **11** | Nilai dan jurnal ujung ke ujung, query, cek | menelusuri angka |

Yang paling penting dipahami: **bagian 02**. Semua dokumen produksi hanya cara
yang berbeda untuk memanggil buku yang sama.

---

## 2. Peta besar

```
 GUDANG (buku stok)                    PRODUKSI (buku produksi)                      GUDANG
 log_stock_*                           prd_balance / prd_ledger                      log_stock_*
 ─────────────────                     ──────────────────────────────                ───────────
 Receipt Note ─► stok ─► BSTB Issue ─► Unit ─► Unit ─► … ─► UP5 ─► BSTB ke FG ─────► stok
                         (bagian 03)    │                     │     (bagian 10)
                                        └─ BSTB Pengeluaran ──┘──────────────────────► stok
```

Di **dalam satu Unit** barang berjalan menurut tahap:

```
 Terima / Push          proses 1 … proses terakhir         QC (bila ada)        Kirim
 ───────────► PERSIAPAN ─────────────────────────► QC CHECK ─────────► STAND BY ─────► DALAM PERJALANAN
              (per proses)     │        ▲             │ Balik                            (BSTB saja)
                               ▼        │             ▼
                        SEDANG DIKERJAKAN      kembali ke PERSIAPAN proses pertama
                           (Kerja saja)
```

| Tahap di layar | `prd_balance.stage` | Artinya |
| --- | --- | --- |
| Persiapan *(proses)* | `Preparation` | sudah diterima, menunggu proses itu |
| Sedang Dikerjakan | `Working` | Kerja sudah Mulai, belum Selesai |
| QC Check | `QcCheck` | proses terakhir selesai, menunggu keputusan QC |
| Stand By | `StandBy` | selesai, siap dikirim |
| Dalam Perjalanan | `InTransit` | sudah dikirim, belum diterima |

Persiapan **hanya** ditinggalkan lewat dokumen pengerjaan (Grading, Pengerjaan,
Kerja, Job Order, Kotak) atau BSTB Pengeluaran. Stand By hanya ditinggalkan
lewat kiriman.

---

## 3. Routing yang dipakai contoh

Dari `npm run db:seed-production`. `+QC` berarti Unit itu punya QC Check.

| Routing | Unit (urut) | Workstation | Proses |
| --- | --- | --- | --- |
| **PRA-PARTAI** (belum punya line) | UGH Grading Halus | BB + PPIC | Grading +QC |
| | UPC Pre Cleaning | BB + PPIC | Assign +QC |
| | UPY Penyebaran | BB + PPIC | Grading |
| **REG-1** (line Reguler) | UPW Pre Wash | CL | Assign +QC |
| | UCL Cleaning | CL | Kerja +QC |
| | UC1 CCP-1 | CL | Assign |
| | USR Sortir | CL | Assign |
| | UDA Dry A *(checkpoint)* | ML | Grading +QC |
| | UML Moulding | ML | Grading → Job Order → Assign +QC |
| | UDB Dry B | ML | Grading +QC |
| | UWP Wrapping | WP | Assign +QC |
| | UBC Barcoding *(checkpoint)* | WP | Grading +QC |
| | UP5 Packing 95 | WP | Assembly |

Partai **lahir** di antara UPY dan UPW. Satu Workstation → **Push**; beda
Workstation → **BSTB** (bagian 08).

---

## 4. Istilah

| Istilah | Arti | Disimpan di |
| --- | --- | --- |
| **No. Stok** | identitas fisik barang; satu nomor satu stok di seluruh sistem | `log_stock_tracking.tracking_no` |
| **No. Job** | satu ambilan barang yang berjalan bersama; selalu utuh | `prd_job.job_no` |
| **Partai** | sekumpulan barang satu line yang mengikuti satu routing | `prd_partai.partai_no` |
| **Bucket** | satu baris saldo: No. Stok · Unit · tahap · proses · Partai · Job | `prd_balance` |
| **BJL** | barang yang punya gram tetapi **selalu bernilai 0** | `m_item.is_bjl` |
| **Bahan penolong** | stiker, kotak, gabus: saldo milik Unit, bukan isi partai | `prd_balance.auxiliary = true` |
| **Standard Cost** | tarif rupiah per gram per Unit | `prd_rate_version(_line)` |
| **WIP** | nilai barang di produksi = Σ `prd_balance.value_balance` | akun WIP di Kategori Item |

Di kode lama dan tabel, No. Stok disebut *lot* atau *tracking* (P215). Artinya sama.

---

## 5. Dua aplikasi

| | Aplikasi **Produksi** | Aplikasi **ERP** |
| --- | --- | --- |
| Dipakai | Unit (lantai produksi) | Gudang, keuangan, master |
| Menu | Workspace Unit; No. Grading, Pengerjaan Unit, Job Order, Kotak, Kerja, QC Check, Push dan BSTB; laporan; Karyawan | Stock Issue, Stock Receipt, Stock Adjustment; Unit, Workstation, Line, Routing; Standard Cost, BoM Packing, Jenis Biaya, Tagihan Biaya |
| Harga / jurnal | **tidak pernah tampil** (P275) | tampil |

Nilai tetap dihitung dan dijurnal saat dokumen Produksi diposting; hanya tidak
diperlihatkan.

**Akses per Unit:** user hanya membuka Unit di `prd_user_unit`, kecuali punya izin
`PRODUCTION_UNIT_ALL` (*Buka semua Unit*). Gudang: `log_user_warehouse` atau
`INVENTORY_WAREHOUSE_ALL`.

**Cara kerja sehari-hari:** buka *Workspace Unit* → pilih Unit → pilih tab tahap →
klik baris atau tombol aksi. Form diisi lewat **satu baris input**: pilih atau scan
No. Job / No. Stok → isi gram bila barangnya boleh diambil sebagian → Tambah.

---

## 6. Cerita contoh (dipakai semua bagian)

Data awal:

| | |
| --- | --- |
| Pembelian | 100 g sarang mentah Rp 1.000/g (LOT-A 60 g, LOT-B 40 g); 10 stiker Rp 500 (STK) |
| Item gram | MENTAH, HALUS, HALUS-B, BJL *(is_bjl)*, MOULD, KEPING |
| Item PCS | KOTAK (Nama Jual), STIKER (bahan penolong) |
| BoM Packing | KOTAK 50 g ± 1 g, 8–13 keping, 1 STIKER per kotak |
| Tanggal | 23/11/2026 (`231126`) |

Standard Cost (rupiah per gram):

| UGH | UPC | UPY | UPW | UCL | UC1 | USR | UDA | UML | UDB | UWP | UBC | UP5 |
| --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| 10 | 5 | 3 | 5 | 20 | 2 | 4 | 6 | 15 | 6 | 4 | 8 | 12 |

Jalannya:

| # | Kejadian | Dokumen | Nilai barang utama sesudahnya | Bagian |
| --: | --- | --- | ---: | --- |
| 1 | 60 g dan 40 g masuk UGH; stiker ke UPC (2) dan UP5 (5) | `BSTB_UGH_231126_00001/2`, `BSTB_UPC…`, `BSTB_UP5…` | 100.000 | 03 |
| 2 | Grading: 100 g → 38 + 17 + 3 BJL + 39 g | `NG_UGH_231126_00001` | 101.000 | 04 |
| 3 | QC: HALUS-B 17 g **Balik** | `QCK_UGH_231126_00001` | 101.000 | 06 |
| 4 | HALUS-B digrading ulang → 16 g | `NG_UGH_231126_00002` | 101.170 | 06 |
| 5 | BJL 3 g keluar ke gudang, nilai 0 | `BPG_UGH_231126_00001` | 101.170 | 10 |
| 6 | Push ke UPC; dikerjakan, 2 stiker dipakai | `PSH_UGH…`, `KRJ_UPC_231126_00001` | 102.635 | 08, 05 |
| 7 | Push ke UPY; grading | `NG_UPY_231126_00001` | 102.914 | 04 |
| 8 | BSTB Penyebaran → partai lahir di UPW | `BST_UPW_231126_00001` | 102.914 | 08 |
| 9 | UPW, UCL (Kerja), UC1, USR, UDA | | 106.355 | 05, 04 |
| 10 | UML: grading, Job Order (3 → 1 No. Stok), Assign | `JOD_UML_231126_00001` | 107.750 | 07 |
| 11 | UDB, UWP, UBC: 93 g → 18 keping 5 g | `NG_UBC_231126_00001` | 109.424 | 04 |
| 12 | Kotak 10 keping + 1 stiker | `ASM_UP5_231126_00001` | kotak 61.891 | 09 |
| 13 | Kotak ke Gudang Finish Goods | `BFG_UP5_231126_00001` | stok 61.891 | 10 |
| 14 | Satu keping keluar Tanpa nilai | `BPG_UP5_231126_00002` | beban 6.080 | 10 |
| | Sisa di UP5: 7 keping dan 4 stiker | | 42.553 + 2.000 | 11 |

---

## 7. Kode acuan

| Bagian | File |
| --- | --- |
| Buku produksi | `src/lib/erp/production-ledger.ts` |
| Pembagian nilai | `production-execution.ts` (`shareByWeight`, `shareGrading`, `shareWork`) |
| Alat bersama, jurnal | `production-doc.ts` (`postToErp`) → `production-posting.ts` (jurnal dan biaya Unit, P318) |
| Dokumen | `stock-issue.ts`, `production-grading.ts`, `production-work.ts`, `production-kerja.ts`, `production-qc.ts`, `production-job-order.ts`, `production-transfer.ts`, `production-box.ts`, `production-receipt.ts` |
| Master | `production-master.ts`, `production-master-shape.ts` |
| Workspace | `production-workspace.ts` |
| Laporan | `production-report.ts` |
| Skema | `prisma/schema.prisma`, `DBML/erp.dbml.md` |
| Tes seluruh alur | `tests/simulasi-po-sampai-finish-goods.test.ts` |

Keputusan bisnisnya ada di `Produksi Walet (Real).md` (W…) dan `Claude-ERP.md`
§12 (P…).

---

## 8. Yang belum ada

| Belum dibangun | Akibat sekarang |
| --- | --- |
| Dokumen Reproses (kembali ke Unit sebelumnya) | Balik QC hanya sampai proses pertama Unit yang sama |
| Closing Costing Produksi | selisih biaya aktual dan standar belum dihitung; tahun fiskal dengan aktivitas produksi belum bisa ditutup |
| Nilai WIP di ERP | nilai hanya terbaca dari database dan jurnal |
| Packing 98, QC Packing, Sales Planning | alur berakhir di Packing 95 |
| Penyerapan nilai Reject oleh sisa partai | Reject bernilai memakai *Tanpa nilai* → Beban Pemusnahan |
| Draft untuk Kirim, Kerja, Job Order, Kotak | dokumen itu langsung berlaku |
| Pembatalan BSTB yang sudah Diajukan | harus diterima dulu |
