# Rencana implementasi: PO → Gudang → Produksi → Gudang di aplikasi

> Status: **dijalankan (P280).** Usulan §5 dipakai sebagai asumsi kerja sampai user mengoreksi. 7.0–7.5 selesai (P280–P284, P303); berikutnya 7.6 BSTB Pengeluaran. Yang disimulasikan nanti adalah
> **aplikasi** (lokal dan Neon), bukan artifact. Artifact *Workspace Unit
> Produksi* (<https://claude.ai/artifact/TR9atVSRmuRUyh9nn9hHU7>, versi 21)
> menjadi **spesifikasi perilaku**: yang ada di sana dibangun persis, yang belum
> ada di sana ditandai sebagai keputusan baru (§5).
> Keputusan user 18/11/2026: **alur berakhir di Packing 95**; dua Gudang
> **tanpa Lokasi**; nilai barang yang kembali dipilih lewat pilihan placeholder
> yang kelak diganti alasan / tujuan.

## 1. Alur target

```
Purchase Order (Open)
  → Receipt Note ke Gudang Bahan Baku (No. Stok per lot)
  → BSTB Issue ke UGH (Ajukan mengunci, Terima → Persiapan, No. Job lahir)
  → UGH Grading + QC → Push UPC Assign + QC → Push UPY Grading
  → BSTB Penyebaran (partai lahir) → UPW Assign + QC → UCL Kerja + QC
  → UC1 Assign → USR Assign → BSTB → UDA Grading + QC (checkpoint)
  → UML Grading → Job Order → Assign + QC → UDB Grading + QC
  → BSTB → UWP Assign + QC → UBC Grading + QC (checkpoint)
  → Push → UP5 Packing 95: Kotak dari BoM per Nama Jual
  → BSTB ke Finish Goods → Gudang Finish Goods (stok kotak)

Cabang: BSTB Pengeluaran dari Unit mana pun → Gudang Bahan Baku (sisa / reject)
```

Dua Gudang, keduanya **tanpa Lokasi** (P267: Gudang tanpa lokasi menyimpan stok
dengan `location_id` kosong): **Gudang Bahan Baku** (tujuan Receipt Note, sumber
BSTB Issue, tujuan BSTB Pengeluaran) dan **Gudang Finish Goods** (tujuan BSTB ke
Finish Goods).

## 2. Status per langkah

| # | Langkah | Aplikasi sekarang | Spesifikasi artifact | Kurang |
| --- | --- | --- | --- | --- |
| 1 | PO, Receipt Note, stok per No. Stok | Ada (P124, P125, P120) | — | Tidak ada |
| 2 | BSTB Issue ke UGH dan bahan penolong ke Unit | Ada (P228) | Ada | Tidak ada |
| 3 | QC sebagai fitur Unit, biaya Unit sekali di proses terakhir | **Belum**: QC masih langkah, rate per langkah, biaya di tiap proses berbiaya (P276) | Ada (putaran 12, P279) | Rework 7.1 |
| 4 | Grading, Pengerjaan (Assign), QC Check, Push, BSTB, BSTB Penyebaran, checkpoint | Ada (P276–P278) | Ada | Menyesuaikan 7.1 |
| 5 | Kerja di UCL (Mulai → Selesai) | **Belum** (seed memakai Assign sementara) | Ada (putaran 11) | 7.2 |
| 6 | Job Order di UML | **Belum** (seed tanpa Job Order) | Ada (putaran 10) | 7.3 |
| 7 | Packing 95: Kotak dari BoM per Nama Jual, CAIQ, rekomendasi keping | **Belum** | Ada (P248–P252, putaran 10) | 7.4 |
| 8 | BSTB ke Finish Goods dari UP5 ke Gudang Finish Goods | Ada (P303) | **Hanya teks**; UP5 di artifact mengirim ke UP8 | 7.5, keputusan §5 |
| 9 | BSTB Pengeluaran ke Gudang, pilihan nilai | **Belum** | Ada form; Terima Gudang di artifact hanya menolkan barang | 7.6, keputusan §5 |
| 10 | Data master untuk menjalankan alur | Unit, Routing, Line ada (seed); Item produksi, Nama Jual, BoM, Standard Cost, dua Gudang **belum** | Data contoh | 7.0 |
| 11 | Laporan dan cek | Saldo Produksi, Kartu No. Stok, Telusur, `db:reconcile` | — | Menyesuaikan tahap QC baru dan dokumen baru, 7.7 |

Reproses (6.7) **tidak** dibutuhkan alur utama dan tidak masuk rencana ini.

## 3. Langkah implementasi

Tiap langkah: migrasi + DBML, kode, tes, `db:reconcile`, catatan di PWR dan
§12 pada commit yang sama, push, lalu `db:neon-migrate` dan seed di Neon untuk
review.

| Langkah | Isi | Selesai bila |
| --- | --- | --- |
| **7.0 Keputusan dan data simulasi** | Catat P280 (alur ini) dan jawaban §5. Seed dev `db:seed-production-showcase`: Gudang Bahan Baku dan Gudang Finish Goods (tanpa Lokasi), Item produksi bersatuan GR dengan BJL (SM-A, HLS-A/B, BJL-S, MLD-A), Item keping PCS-A, Item kotak per Nama Jual (BMK50, BMK100), bahan penolong (Gramasi, Stiker Daun, Box), satu Supplier, satu Standard Cost aktif per Unit | Data siap; tidak ada data bisnis di `prisma/seed.ts` (P11) |
| **7.1 QC fitur Unit, biaya per Unit (P279)** | Migrasi: `ref_unit.has_qc` kembali, langkah QC dihapus dari `ref_unit_step`, tahap `QcCheck` kembali (Persiapan → QC Check → Stand By), `prd_rate_version_line` kembali per Unit, `prd_cost_entry` per Unit. Biaya hanya di dokumen proses **terakhir** (gram masuk proses itu × rate Unit); proses sebelumnya hanya transformasi, penyusutan tetap berjurnal. QC Balik ke Persiapan proses pertama dengan nilai yang dibawanya; diproses ulang membayar lagi (rework). Form Unit: tanda QC; Standard Cost: satu baris per Unit; Workspace: tab QC Check | Simulasi `simulasi-beli-sampai-produksi` diubah: UGH dibebankan saat Grading, UML hanya saat Assign |
| **7.2 Kerja** | `prd_kerja(_line)` (T13): Mulai (Job + karyawan → tahap Sedang Dikerjakan), Selesai per Job (biaya bila proses terakhir, gram tetap), Batal Mulai tanpa biaya; tab *Sedang Dikerjakan* bercentang. Seed UCL = Kerja + QC | Job melewati UCL lewat Mulai / Selesai |
| **7.3 Job Order** | `prd_job_order(_line, _input)` (T7): ambil beberapa No. Stok (sebagian boleh), pilih jenis target, satu No. Stok baru `<input terbesar>-n` dengan No. Job dan Job Order; tanpa rate, tanpa jurnal, gram tetap. Seed UML = Grading → Job Order → Assign + QC | Moulding berjalan seperti artifact |
| **7.4 Packing 95** | ERP › Produksi › Master Biaya: **Nama Jual** dan **BoM Packing** (`prd_bom`, `prd_bom_component`: target gram, toleransi, jumlah keping min/maks, bahan penolong per kotak, satu versi aktif). Produksi: dokumen **Kotak** (`prd_box`, `prd_box_piece`, `prd_box_component`): pilih Nama Jual, rekomendasi keping dari seluruh Persiapan UP5 (`planBoxes` dari artifact), scan atau *Masukkan*, CAIQ unik per keping, keping manual ditandai, Tutup Kotak → No. Stok kotak baru item Nama Jual tanpa Job ke Stand By, bahan penolong terpakai, biaya UP5 per gram | Satu kotak lahir dari keping UBC, nilai = keping + biaya UP5 + bahan penolong |
| **7.5 BSTB ke Finish Goods** | ERP › Persediaan › Operasi Gudang › **BSTB ke Finish Goods** (menu sendiri di samping BSTB Issue, P254), tabel `log_production_receipt(_line)` (Bagian ERP): diajukan dari Stand By UP5 di Workspace (*Kirim ke Finish Goods*), barang Dalam Perjalanan, **Terima** oleh Gudang di ERP: keluar dari buku produksi, masuk Gudang Finish Goods lewat `receiveStock` dengan No. Stok kotak yang sama, jurnal Dr Persediaan (kategori Item kotak) / Cr WIP | Stok Finish Goods bertambah; WIP UP5 berkurang sebesar nilai kotak |
| **7.6 BSTB Pengeluaran** | Dokumen yang sama (`purpose`: `finish_goods` / `return`), dari Persiapan atau Stand By Unit mana pun ke Gudang Bahan Baku; Draft → Ajukan → Terima Gudang (P238), nomor `BPG_<unit>_…`. **Pilihan nilai placeholder** di Terima: *Nilai terbawa* (Dr Persediaan / Cr WIP), *Hanya nilai bahan* dan *Tanpa nilai* (selisih ke akun §5) | Barang sisa kembali ke stok dengan nilai sesuai pilihan |
| **7.7 Laporan dan cek** | Saldo Produksi dan Kartu No. Stok membaca tahap QC baru, Sedang Dikerjakan dan Dalam Perjalanan; Telusur sampai kotak dan Gudang Finish Goods; `db:reconcile`: stok Gudang + WIP + Beban Pemusnahan = pembelian + biaya Unit, kotak = keping + bahan + biaya, buku produksi = dokumen | Semua cek hijau |
| **7.8 Simulasi aplikasi** | Tes end-to-end `simulasi-po-sampai-finish-goods`: PO → Receipt → BSTB Issue → seluruh routing → Kotak → BSTB ke Finish Goods, plus satu BSTB Pengeluaran; lalu walk-through di browser (lokal, kemudian Neon) dengan data 7.0 | Tes lulus; alur dijalankan lewat layar tanpa SQL |

Urutan: 7.0 → 7.1 → 7.2 → 7.3 → 7.4 → 7.5 → 7.6 → 7.7 → 7.8. 7.2 dan 7.3
bisa ditukar; 7.6 bisa dikerjakan sebelum 7.4 karena tidak bergantung pada Packing.

## 4. Yang dibuang dari rencana lama

- Packing 98 dan *BSTB + QC ke Finish Goods* dari UP8 (P232): alur berakhir di
  Packing 95, jadi BSTB ke Finish Goods berangkat dari UP5.
- Rencana mengubah artifact menjadi simulasi Gudang (versi sebelumnya dokumen
  ini): yang disimulasikan sekarang aplikasinya.

## 5. Keputusan yang dibutuhkan

1. **BSTB ke Finish Goods dari UP5 tanpa QC?** UP5 di artifact tidak ber-QC, dan
   QC sebelum Finish Goods dulu ada di Packing 98 (P232). Usulan: tanpa QC;
   bila perlu, UP5 diberi fitur QC (7.1 sudah memungkinkan).
2. **Ke mana selisih nilai pada pilihan *Hanya nilai bahan* dan *Tanpa nilai*?**
   Usulan: ke **Beban Pemusnahan Produksi**, karena itu satu-satunya akun
   produksi untuk nilai yang tidak diteruskan.
3. **Gudang tujuan dipilih di mana?** Usulan: di dokumen saat Ajukan (hanya
   Gudang tanpa Lokasi), Gudang hanya menekan Terima; BSTB ke Finish Goods
   mengusulkan Gudang Finish Goods, BSTB Pengeluaran Gudang Bahan Baku.
4. **Nomor dan Item kotak.** Usulan: Item kotak = Item Nama Jual (Barang,
   Kelola Stok, satuan PCS), No. Stok `KTK-<ddmmyy>-<nnn>` seperti artifact,
   satu kotak satu No. Stok.
5. **Rate UP5** dihitung per gram keping (seperti artifact) dan bahan penolong
   masuk nilai kotak.
