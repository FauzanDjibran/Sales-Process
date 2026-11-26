# Proses Produksi Baseline — Analisa & Rencana Build

> **Status 01/11/2026:** keputusan K1–K6 sudah dijawab dan dituangkan sebagai
> R20–R29 di `Production-Plan.md`, yang kini menjadi plan yang berlaku. Dokumen
> ini tetap sebagai latar analisa. Yang berbeda dari usulan di bawah: BoM per
> item per workstation (bukan Formula + Routing berlangkah), Perintah yang
> dirilis dibekukan, dan aturan kapasitas normal PSAK 14 masuk fase lanjutan.

> Tahap analisa dan perencanaan; **tidak ada kode yang diubah**. Bertumpu pada
> desain yang sudah dibangun di `main` (P201–P207, `Production-Plan.md` R1–R19,
> `Production-Process.md`). Setiap usulan yang mengubah keputusan yang ada
> ditandai **[UBAH Rxx]** dengan alasan dan dampaknya ke G1–G3. Tanggal: 01/11/2026.
>
> Tanda klaim: **[V#]** terverifikasi, sumber nomor # di §11; **[A]** asumsi
> (pengetahuan umum, belum diverifikasi dari dokumentasi resmi pada sesi ini).

---

## 1. Matriks perbandingan ERP

ERP pembanding kelima: **ERPNext** (open source, dokumen Job Card per
workstation paling dekat dengan model lot · workstation di sini).

| Dim. | Zahir | SAP (PP + CO/ML) | Odoo (MRP) | Business Central | ERPNext |
| --- | --- | --- | --- | --- | --- |
| **A. Master** | Formula produksi (BoM satu level) [V10]; versi, varian, substitusi, routing tidak ditemukan [A] | BoM alternatif + change number, routing, work center dengan activity type [A]; Material Ledger untuk actual costing [V1][V2] | BoM, by-product pada BoM, work center dengan biaya/jam [V6][A]; versi lewat PLM [A] | Production BOM & Routing (dengan versi), work/machine center [V8]; costing Standard/Average/FIFO [A] | BOM multi-level dengan operations, workstation hour rate [A] |
| **B. Dokumen & status** | Satu transaksi produksi: bahan berkurang, barang jadi bertambah [V10] | Production order CRTD→REL→CNF→DLV→TECO [A]; master dibaca **sekali saat release** [V4] | MO Draft→Confirmed→In Progress→Done, work order per operasi [A] | Order Planned→Firm Planned→Released→Finished [A]; consumption & output journal, flushing [V8] | Work Order → Job Card per operasi → Stock Entry *Material Transfer for Manufacture* / *Manufacture* [V11] |
| **C. WIP selama periode** | Tidak ada WIP; langsung bahan → barang jadi [V10][A] | Biaya aktual terkumpul di order; WIP dihitung akhir periode lalu di-*settle* ke FI [V2] | Default tanpa WIP; nilai pindah saat MO Done; jurnal WIP **manual on demand** [V6] | Konsumsi & kapasitas diposting saat terjadi; output dinilai *expected cost* [V7] | Material dipindah ke gudang WIP, tetap persediaan sampai *Manufacture* [V11][A] |
| **D. Labor & overhead** | Biaya produksi ditambahkan ke HPP barang jadi [V10]; dasar alokasi [A] | Activity type × tarif cost center saat konfirmasi; overhead lewat costing sheet [A]; tarif aktual dihitung akhir periode [V3] | Biaya work center/jam × durasi work order [V6][A] | Biaya kapasitas/jam + overhead rate di work/machine center [A] | Hour rate workstation × waktu Job Card; *additional costs* di Stock Entry [A] |
| **E. Closing** | Tidak ada costing akhir periode khusus [A] | Alokasi → tarif aktivitas aktual → WIP → variance → settlement → **actual costing run** multi-level [V3][V1] | Tidak ada; biaya final saat MO Done [A] | **Adjust Cost – Item Entries**, hanya order Finished [V7] | Tidak ada; repost valuation bila backdated [A] |
| **F. Valuasi FG tengah periode** | Final saat transaksi [A] | Harga standar/provisional; ML merevaluasi stok & konsumsi akhir periode [V1][A] | Aktual saat MO Done [A] | Expected (standar) sampai Finished, lalu adjust [V7] | Rate komponen + operating cost saat Manufacture [A] |
| **G. Jurnal** | Persediaan bahan → Persediaan barang jadi [V10] | GI: Dr order/Cr stok; konfirmasi: Dr order/Cr cost center; GR: Dr stok/Cr order; settlement: WIP & variance ke FI [V2][A] | Done: Dr FG/Cr komponen (+ biaya work center); WIP entry opsional [V6] | Dr WIP/Cr stok & kapasitas; Dr FG/Cr WIP; variance per komponen biaya [V7] | Dr WIP-warehouse/Cr stok; Dr FG/Cr WIP + expense [A] |
| **H. Traceability** | Tidak ditemukan [A] | Batch management; where-used MB56, cockpit BMBC, rebuild MB57 [V5] | Lot/serial, laporan upstream/downstream [A] | **Item Tracing** Usage→Origin dan Origin→Usage [V9] | Batch di Stock Entry; laporan bug batch tak terbawa (v13) [V12]; posisi per operasi di Job Card [V11] |
| **I. Fleksibilitas** | Tidak ada routing [A] | Ubah komponen di order, tidak dianjurkan setelah issue; *Read PP master data* ulang [V4] | Ubah komponen/operasi di MO, konsumsi lebih/kurang [A] | *Refresh* order dari BOM/routing; routing link per operasi [V8] | Job Card per operasi; *Skip Material Transfer* [V11] |

**Pola yang sama.** (1) Master rencana (BoM, routing) **disalin ke order**;
perubahan master tidak menyentuh order yang sudah dirilis [V4][V8].
(2) Yang dinilai adalah **konsumsi aktual**, bukan rencana. (3) Trace lot
dibaca dari **mutasi persediaan**, bukan dari BoM [V5][V9].

**Yang berbeda.** (1) **Kapan nilai final**: saat selesai (Odoo, Zahir,
ERPNext) atau akhir periode (SAP ML, BC Adjust Cost). (2) **Labor/overhead**:
per transaksi dengan tarif (SAP, BC, Odoo, ERPNext) atau tidak dimodelkan
(Zahir). **G1 (WIP material saja + overhead dialokasikan saat closing) tidak
ada yang menjalankannya persis**; yang paling dekat adalah SAP ML (nilai final
periodik, multi-level) [V1][V3]. Desain di sini sudah memilih jalur itu (R10–R15).

---

## 2. Proses baseline end-to-end

Langkah baru diberi tanda ★ (usulan); lainnya sudah dibangun atau sudah
direncanakan.

| # | Langkah | Pemicu | Dokumen | Status | Posisi barang | Stok | Jurnal |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ★ Rencana | Sales Order Pra-SO/Open, atau kebutuhan stok | **Perintah Produksi** (salin Formula + Routing) | Draft → Dirilis | — | — | — |
| 2 | Kirim bahan | Perintah dirilis / kebutuhan stasiun | Stock Issue (opsional merujuk Perintah) | Draft → Posted | Gudang → Workstation, lot sama | Keluar dari buku stok AVCO; masuk buku produksi | Dr WIP / Cr Persediaan |
| 3 | Pindah antar stasiun | Langkah berikut | Production Transfer | Draft → Posted | WS A → WS B | Hanya buku produksi | — |
| 4 | Proses | Pekerjaan selesai di stasiun | Eksekusi Produksi (★ wajib merujuk Perintah + langkah) | Draft → Posted | Input habis, lot output baru di WS | Buku produksi; genealogi `prd_lot_link` | Dr WIP output / Cr WIP input, hanya bila akun berbeda |
| 5 | Ulang/lewati langkah | Keputusan produksi | Eksekusi tambahan / tidak ada | — | — | — | — |
| 6 | Hasil masuk gudang | Lot siap | Production Release *Penerimaan Hasil Produksi* (juga sisa bahan kembali) | Draft → Posted | WS → Gudang (lokasi), lot sama | Buku stok masuk pada nilai yang dilepas | Dr Persediaan / Cr WIP |
| 7 | Pemusnahan | Rusak abnormal | Production Release *Pemusnahan* | Draft → Posted | WS → keluar | Buku produksi keluar | Dr Beban Pemusnahan / Cr WIP |
| 8 | ★ Selesai | Semua output diterima | Perintah: *Selesai* → *Ditutup* | Dirilis → Selesai → Ditutup | — | — | — |
| 9 | Biaya non-material | Tagihan, gaji, penyusutan | Tagihan Biaya; jurnal manual | Posted | — | — | Dr Beban Jenis Biaya / Cr Hutang Biaya Produksi (atau akun lawan jurnal) |
| 10 | Jual | Delivery Note | Delivery Note | Posted | Gudang → customer | AVCO, **provisional** (material saja) | Dr HPP / Cr Persediaan |
| 11 | Closing | Setelah hari terakhir bulan | Penutupan Biaya Produksi | Final, mengunci periode | — | Revaluasi nilai, qty 0 | §7 baris *Closing* |

---

## 3. Katalog dokumen minimum

| Dokumen | Fungsi | Field inti | Status | Relasi |
| --- | --- | --- | --- | --- |
| ★ **Formula** (master, `m_formula`, `_line`, `_output`) | Resep per item | item utama, versi, berlaku dari, qty dasar; baris komponen (item, qty per qty dasar, langkah opsional, grup substitusi); baris output tambahan (co/by-product) | Draft → Aktif → Usang | Dipakai Perintah |
| ★ **Routing** (master, `m_routing`, `_step`) | Urutan langkah | item/Formula, versi; langkah: urutan, nama, workstation default, wajib/opsional | Draft → Aktif → Usang | Dipakai Perintah |
| ★ **Perintah Produksi** (`prd_order`, `_component`, `_step`, `_output`) | Jangkar trace dan rencana | nomor `PP/…`, item, qty rencana, tanggal, sumber (Sales Order, opsional), **salinan** komponen, langkah, output | Draft → Dirilis → Selesai → Ditutup; Batalkan dari Draft | Sumber: Sales Order (weak); dirujuk Stock Issue, Eksekusi, Release |
| Stock Issue ✅ | Bahan ke stasiun | gudang, workstation, lot + qty; ★ Perintah opsional | Draft → Posted | Lot dari buku stok |
| Eksekusi Produksi ✅ | Transformasi | workstation, Driver, input (bucket, qty), output (item, qty, lot, expiry); ★ Perintah + langkah | Draft → Posted | Genealogi input → output |
| Production Transfer ✅ | Pindah stasiun | dari/ke workstation, lot + qty | Draft → Posted | — |
| Production Release ✅ | Keluar produksi | tujuan (gudang / pemusnahan), lot + qty, alasan; ★ Perintah opsional | Draft → Posted | Masuk buku stok |
| Tagihan Biaya ✅ | Biaya non-material | supplier, baris Jenis Biaya + jumlah | Draft → Posted | Dibayar Pengeluaran |
| Penutupan Biaya Produksi 🔜 | Costing akhir bulan | periode, pool, alokasi per eksekusi, hasil revaluasi | Final | Membaca semua di atas |

---

## 4. Model costing akhir bulan

**Metode valuasi**: moving average (AVCO, P114). FIFO tidak ditawarkan;
menambahkannya mengubah buku stok, bukan produksi.

**Selama bulan (G1).** WIP hanya material aktual. Untuk setiap akun WIP dan
setiap bulan:

```
WIP awal + Stock Issue (AVCO aktual) + alokasi closing
  − Release ke gudang − Pemusnahan = WIP akhir
Σ akun WIP = Σ prd_balance.value_balance   (cek reconcile, sudah ada P203)
```

Eksekusi tidak menambah nilai: Σ nilai input = Σ nilai output (P205).

**Alokasi labor/overhead (default = R11).**
`Pool = Σ debit bersih bulan itu pada akun beban Jenis Biaya` (R10).
`Bagian eksekusi e = Pool × Driver_e ÷ Σ Driver` (sisa terbesar).
Lalu bagian itu dibagi ke output e menurut qty × Bobot Nilai dan **diikuti
maju** menurut qty (R12): masih di WS → WIP; dipakai eksekusi lain → turun ke
outputnya; sudah di gudang → dipisah terjual (HPP) vs stok akhir menurut barang
tersedia; dimusnahkan → Beban Pemusnahan. Tanpa eksekusi → seluruh pool ke HPP (R14).

Alternatif (fase lanjutan): (b) pool per workstation dengan driver per
workstation (pola tarif aktivitas SAP/BC [A]); (c) driver otomatis = Σ bobot
output, tanpa input manual.

**FG tengah bulan.** Masuk gudang pada nilai material yang dilepas
(provisional); terjual pada AVCO itu. Closing menambah nilai (qty 0) ke pool
persediaan untuk bagian yang masih ada dan ke HPP untuk bagian terjual. Tidak
ada pembalikan jurnal sebelumnya.

**Variance.** Tanpa biaya standar tidak ada variance harga yang diposting;
pool selalu terserap habis, jadi tidak ada under/over-absorption. Yang ada
adalah **selisih rencana vs aktual** per Perintah (qty dan nilai komponen,
output) — laporan, bukan jurnal.

**Scrap.** Normal (susut dalam proses): tidak dicatat sebagai output, nilainya
terserap output baik. Abnormal: Pemusnahan (Dr Beban Pemusnahan).

**Co/by-product.** Co-product: Bobot Nilai relatif. By-product: Bobot 0 (tidak
mendapat nilai); metode NRV adalah fase lanjutan.

**WIP akhir periode.** Bucket di WS membawa material + bagian pool bulan itu;
bulan berikut nilai itu ikut terbawa tanpa dihitung ulang (pool hanya diikuti
maju dalam bulannya sendiri).

---

## 5. Model traceability

**Entitas.** Lot (`log_stock_tracking`, unik per item) · bucket lot ·
workstation (`prd_balance`) · mutasi (`prd_ledger`, juga stok `log_stock_ledger`)
· genealogi (`prd_lot_link`: dari bucket/lot → ke lot, qty, nilai) · ★ Perintah
+ langkah pada dokumen produksi · dokumen sumber/tujuan (Receipt Note →
supplier, Delivery Note → customer).

```
Supplier ─RN→ lot bahan ─SI→ [lot @WS] ─EKS(PP, langkah)→ lot antara ─PT→ … ─EKS→ lot FG ─PHP→ gudang ─SJ→ customer
```

**Event wajib per workstation** (semuanya sudah baris `prd_ledger`): masuk
(Issued / Transfer in), konsumsi, output, keluar (Transfer out / Release /
Scrap). ★ Tambahan: Perintah dan langkah dibaca dari dokumen sumber baris
ledger — tidak perlu kolom baru di ledger.

**Query.** CTE rekursif atas `prd_lot_link`:
mundur `to_lot_id = X → from_lot_id`, berulang sampai lot tanpa link, lalu
`log_stock_ledger` lot itu → Receipt Note / injeksi; maju kebalikannya sampai
Release → Delivery Note. Genealogi bersifat **mass-balance**: di eksekusi
multi-input multi-output, tiap output tertaut ke tiap input secara proporsional.

**Laporan.** ★ **Telusur Lot** (Mundur | Maju; pohon dengan Perintah, langkah,
workstation, tanggal, qty); **Saldo Produksi** (posisi WIP per WS/lot);
**Kartu Lot**; ★ **Riwayat Perintah** (semua mutasi per Perintah).

---

## 6. Model fleksibilitas

**Master vs snapshot.** Formula dan Routing punya versi; saat *Rilis*,
Perintah menyalin versi aktif ke `prd_order_component/_step/_output`.
Perubahan master **tidak** menyentuh Perintah yang dirilis (pola SAP [V4]).

**Perubahan saat produksi berjalan** (Perintah *Dirilis*): komponen, langkah
dan output boleh ditambah/diubah/dihapus dengan alasan dan audit; tidak boleh
di bawah yang sudah dikonsumsi/diproduksi. *Muat ulang dari master* hanya
selama belum ada eksekusi.

**Eksekusi bebas, rencana sebagai panduan.**

| Kasus | Aturan | Costing | Trace |
| --- | --- | --- | --- |
| Urutan berbeda, paralel | Eksekusi boleh merujuk langkah mana saja kapan saja | Tak terpengaruh | Tercatat langkah aktual |
| Lewati langkah | Langkah tanpa eksekusi; opsional = ok, wajib = peringatan saat *Selesai* | — | — |
| Ulang langkah | Beberapa eksekusi per langkah | Driver tiap eksekusi | Tiap eksekusi tertaut |
| Pindah workstation | Eksekusi di WS selain default → ditandai | Tak terpengaruh | WS aktual |
| Substitusi | Input item lain; bila ada di grup substitusi → "substitusi", lainnya "di luar formula" (peringatan, bukan tolak) | Nilai aktual input | Lot pengganti tertaut |
| Multi-level | Satu Perintah per level; komponen setengah jadi berasal dari lot Perintah lain | Ikuti maju lintas Perintah (R12) | Rantai lintas Perintah |
| Co/by-product | Baris output tambahan di Formula/Perintah | Bobot Nilai | Lot output |

**Kenapa G3 tidak merusak G1/G2:** biaya dan genealogi hanya dibaca dari
dokumen aktual (input, output, mutasi); rencana tidak pernah dipakai dalam
perhitungan.

**Trade-off.** Fleksibilitas vs trace: eksekusi tanpa Perintah memutus rantai
lot → Perintah → **rekomendasi: Perintah wajib di Eksekusi**, opsional di
dokumen pemindahan (bucket lot · WS bisa melayani beberapa Perintah).
Fleksibilitas vs kontrol: input bebas bisa salah ambil → peringatan + laporan
rencana vs aktual, bukan penolakan.

---

## 7. Skema jurnal per event

| Event | Debit | Kredit | Kapan |
| --- | --- | --- | --- |
| Stock Issue | WIP (kategori item) | Persediaan (kategori, else mapping) | Posting |
| Eksekusi | WIP kategori output | WIP kategori input | Posting, bersih per akun, hanya bila beda |
| Production Transfer | — | — | — |
| Penerimaan Hasil Produksi | Persediaan | WIP | Posting |
| Pemusnahan | Beban Pemusnahan Produksi | WIP | Posting |
| Tagihan Biaya | Beban per Jenis Biaya | Hutang Biaya Produksi | Posting |
| Pembayaran Biaya Produksi | Hutang Biaya Produksi | Kas & Bank | Posting |
| Jurnal manual (penyusutan, gaji) | Beban Jenis Biaya | Akumulasi / Hutang Gaji | Posting |
| Delivery Note (FG) | HPP | Persediaan | Posting |
| **Closing** | WIP / Persediaan / HPP / Beban Pemusnahan (sesuai posisi bagian pool) | **Biaya Produksi Dibebankan** (= pool) | Sekali per bulan, setelah hari terakhir, mengunci periode |

Laba rugi: Beban Jenis Biaya − Biaya Produksi Dibebankan = 0 setelah closing;
biaya muncul di HPP / Beban Pemusnahan, sisanya di neraca (WIP, Persediaan).

---

## 8. Gap analysis terhadap desain yang ada

| Bagian | Sikap | Alasan / dampak |
| --- | --- | --- |
| R3 lot · workstation, R4/R7 langsung, R5/R6 transformasi + Bobot Nilai | **Pertahankan** | Sudah memenuhi G1 (material saja) dan G2 (mutasi + genealogi) |
| R10–R15 closing, R16 WIP per kategori | **Pertahankan** (belum dibangun) | Inti G1 |
| R17 nomor lot output | Pertahankan | — |
| Production Release *to_stock* | Pertahankan, **dipakai juga untuk sisa bahan kembali ke gudang** | Tidak perlu dokumen retur |
| **R19** — "Perintah / Rencana Produksi, BoM, Routing, Telusur tidak diadopsi" | **[UBAH R19]** adopsi Formula, Routing, Perintah Produksi (snapshot, non-mengikat) dan Telusur Lot | G2 meminta lot → production order → langkah; G3 meminta BoM/routing berversi. Dampak G1: nol (rencana tidak masuk costing) |
| `production_plan` §5 "Telusur tidak dibangun" | **[UBAH]** dibangun | G2 |
| Eksekusi | **Tambah** `production_order_id` (wajib) + `order_step_id` (opsional) | G2 |
| Stock Issue, Release | **Tambah** `production_order_id` opsional | Konteks trace; bukan kunci bucket |
| Bucket lot · WS | **Tidak** ditambah dimensi Perintah | Menjaga R3 sederhana; trace lewat eksekusi |
| R11 Driver diketik | Pertahankan; ★ prefill dari langkah Routing bila diisi | Mengurangi salah input |
| Status QC / karantina di lantai produksi, serial number, subkontrak, standar cost, MRP | **Fase lanjutan** | Tidak dibutuhkan G1–G3 baseline |

---

## 9. Rencana build bertahap

Setiap fase = satu commit di `main` dengan migrasi + DBML, build/lint/test
hijau, cek `db:reconcile`, keputusan P2xx, `Production-Process.md` diperbarui,
Neon dimigrasi, review pengguna di Neon (kebiasaan langkah 1–7).

| Fase | Isi | Dependensi | Selesai bila |
| --- | --- | --- | --- |
| F1 (= langkah 8) | Laporan Saldo Produksi, Kartu Lot, Rekap Produksi | P203–P207 | Saldo = `prd_balance`, Kartu Lot = `prd_ledger` |
| F2 (= langkah 9) | Penutupan Biaya Produksi (R10–R15) | F1 | Skenario G1 lulus di test dan browser |
| F3 | Telusur Lot mundur/maju (tanpa Perintah) | F1 | Skenario G2 sampai level lot · WS |
| F4 | Master Formula + Routing berversi | — | Buat, aktifkan, usangkan versi |
| F5 | Perintah Produksi (snapshot, ubah saat berjalan, Selesai/Ditutup); rujukan di Eksekusi/Issue/Release; laporan Rencana vs Aktual; Telusur menampilkan Perintah + langkah | F3, F4 | Skenario G3 lulus |
| F6 (= langkah 10) | Showcase produksi + satu test E2E gabungan G1–G3 | F2, F5 | Neon membawa satu bulan tertutup |

F1–F3 dan F4 independen; F4 bisa dikerjakan paralel.

**Skenario uji.**

*G1 — WIP material saja, closing benar.* Lot BB-1 100 kg @ Rp10.000 (Rp1.000.000).
Issue 100 kg ke WS-A → WIP 1.000.000. EKS-1 (Driver 10): 100 kg → SJ-1 80 kg,
nilai 1.000.000. Transfer ke WS-B. Issue BK-1 200 pcs (Rp200.000). EKS-2
(Driver 30): SJ-1 + BK-1 → FG-1 200 pcs, 1.200.000. Release 100 pcs ke gudang
(600.000); jual 50 (HPP 300.000). Cek sebelum closing: WIP = 600.000 =
Σ bucket; tidak ada nilai non-material di WIP. Tagihan Biaya Rp400.000. Closing:
EKS-1 100.000 + EKS-2 300.000 → semua mengalir ke FG-1 (400.000): 100 pcs di WS
→ WIP +200.000; 50 terjual → HPP +100.000; 50 di gudang → Persediaan +100.000;
Cr Biaya Produksi Dibebankan 400.000. Beban − Dibebankan = 0; reconcile hijau;
periode terkunci (posting backdated ditolak).

*G2 — trace.* Mundur dari FG-1: EKS-2 @WS-B (PP/…, langkah 2) ← SJ-1 + BK-1;
SJ-1 ← EKS-1 @WS-A (langkah 1) ← BB-1 ← Receipt Note/supplier. Maju dari BB-1
sampai Delivery Note/customer. Qty di tiap simpul = baris ledger; posisi sisa
(100 pcs @WS-B) tampil.

*G3 — perubahan di tengah.* Perintah dirilis dari Formula v1; Formula v2
diaktifkan → Perintah tidak berubah. Di Perintah: 30 kg BB-1 diganti BB-ALT
(substitusi), langkah 2 diulang dua kali, langkah 3 opsional dilewati, satu
eksekusi di WS-C. Hasil: nilai = input aktual (BB-ALT pada AVCO-nya), pool dibagi
ke tiga eksekusi menurut Driver, Telusur menampilkan BB-ALT dan WS-C, laporan
Rencana vs Aktual menandai substitusi/ulang/lewati, semua cek reconcile hijau.

---

## 10. Keputusan terbuka

| # | Pertanyaan | Rekomendasi default |
| --- | --- | --- |
| K1 | Mengubah R19: adopsi Formula, Routing, Perintah Produksi dan Telusur? | **Ya**, sebagai snapshot non-mengikat (§6) |
| K2 | Perintah wajib di Eksekusi? | **Wajib** di Eksekusi; opsional di Issue/Transfer/Release |
| K3 | Input di luar Formula | **Peringatan**, bukan penolakan |
| K4 | Multi-level | **Satu Perintah per level**, tanpa phantom / Perintah anak otomatis |
| K5 | Dasar alokasi | **Tetap R11** (satu pool, Driver diketik, prefill dari Routing); pool per workstation di fase lanjutan |
| K6 | Urutan fase | **G1 dulu** (F1→F2), lalu F3, F4–F5 |

---

## 11. Sumber

1. [SAP Help — Value Flow into Actual Costing/Material Ledger](https://help.sap.com/saphelp_46c/helpdata/en/cd/0f0739edfcb03ae10000000a11402f/content.htm)
2. [SAP Help — Settlement in Product Cost by Order or Period](https://help.sap.com/doc/21ccd8530439414de10000000a174cb4/2.6/en-US/5c35d85275c8d142e10000000a4450e5.html)
3. [SAP Community — S/4 period-end closing, ML and actual costing](https://groups.community.sap.com:443/t5/enterprise-resource-planning-q-a/s-4-period-end-closing-material-ledger-and-actual-costing/qaq-p/12646169) (praktisi)
4. [SAP KBA 3328953 — master data read at release](https://userapps.support.sap.com/sap/support/knowledge/en/3328953)
5. [SAP Insider — Batch Information Cockpit](https://sapinsider.org/?p=15468); [SAP Answers — MB56](https://answers.sap.com/questions/12672224/sap-traceability-system-for-fg.html)
6. [Odoo 19 — Work-in-progress costs](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/basic_setup/work_in_progress.html)
7. [Business Central — About finished production order costs](https://learn.microsoft.com/en-us/dynamics365/business-central/finance-about-finished-production-order-costs)
8. [BC — Flush components according to operation output](https://learn.microsoft.com/en-us/dynamics365/business-central/production-how-to-flush-components-according-to-operation-output); [BC — Create routings](https://learn.microsoft.com/en-us/dynamics365/business-central/production-how-to-create-routings); [BC — Work and machine centers](https://learn.microsoft.com/en-us/dynamics365/business-central/production-how-to-set-up-work-and-machine-centers)
9. [BC — Trace item-tracked items](https://learn.microsoft.com/pl-pl/dynamics365/business-central/inventory-how-to-trace-item-tracked-items); [walkthrough](https://learn.microsoft.com/en-us/dynamics365/business-central/walkthrough-tracing-serial-lot-numbers)
10. [Zahir — Manufaktur](https://zahiraccounting.com/id/produk/solusi-per-bidang-usaha/manufaktur/); [Zahir — Perhitungan HPP](https://zahiraccounting.com/id/perhitungan-hpp/) (halaman vendor)
11. [ERPNext — Work Order](https://docs.frappe.io/erpnext/user/manual/en/work-order); [Job Card](https://docs.frappe.io/erpnext/v14/user/manual/en/manufacturing/job-card)
12. [Frappe forum — batch not linked on work order closure](https://discuss.frappe.io/t/batch-numbers-are-not-linked-to-start-finish-stock-entries-when-closure-of-work-orders/124249)
