# Satuan Alternatif dan Timbangan di Pembelian: Rencana

> Status: **putaran 9, 24/11/2026; semua keputusan terjawab (§6), langkah 1–3 dibangun (P320), langkah 4–6 dibangun (P321), langkah 7–8 dibangun (P322); uji alur bersama user menunggu**. Isinya memuat koreksi user (qty PO diketik dalam satuan pesanan,
> konversi adalah perkalian) dan konsep timbangan dari tiga screenshot modal
> *Penimbangan*. Skema §3.4 mengikuti gambaran DBML user.

## 1. Satuan per dokumen

| Dokumen | Satuan yang diketik | Yang disimpan |
| --- | --- | --- |
| Purchase Request | Satuan Dasar saja (tetap) | qty dasar |
| **Purchase Order** | **Satuan Dasar atau satuan di Konversi Satuan Item** | qty + satuan + faktor |
| Receipt Note | Satuan baris PO | qty PO + qty dasar |
| Stok | Selalu Satuan Dasar | qty dasar |
| Invoice Pembelian | Satuan baris PO | qty diterima × harga PO |

**Qty dasar = qty × faktor.** Satuan dasar PCS, pilih BOX (isi 12), ketik 9: yang
dibeli 9 BOX = 108 PCS. Harga adalah harga per BOX. Bila PR meminta 100 PCS, PR
terpenuhi 100 dan 8 PCS menjadi *melebihi PR* (B15, tetap).

## 2. Keadaan sekarang dan perbaikan satuan

Pilihan satuan sudah ada di PO (B14, P124), tetapi hanya muncul bila Item punya
Konversi Satuan; di database lokal hanya BK-001, BK-002 dan BK-003 (dari yang
dapat dibeli). Ke-13 baris PO lokal semuanya Satuan Dasar.

| # | Temuan | Yang dibangun |
| --- | --- | --- |
| T1 | Tanpa konversi, satuan hanya teks | Tetap teks, dengan petunjuk *tambahkan di Konversi Satuan Item* |
| T2 | Ganti satuan membiarkan Qty dan Harga lama, 100 PCS bisa tersimpan sebagai 100 BOX | **Qty dan Harga dikosongkan** saat satuan diganti, user mengetik yang baru; server menolak yang kosong. Tidak ada konversi otomatis |
| T3 | Setara dasar tidak terlihat | `= 108 PCS` di bawah Qty pada PO dan Receipt Note (baris, picker, dialog lot); tidak di Invoice |
| T4 | PR baru untuk Item yang barisnya sudah BOX membuat baris kedua | Masuk ke baris itu; Qty BOX tidak diubah otomatis |
| T5 | Mencabut PR dari baris BOX mengurangi Qty-nya dengan pecahan | Qty baris bersatuan alternatif tidak disentuh |
| T6 | Lot diketik di satuan PO dan qty dasarnya dibulatkan sendiri | Lot diketik dalam **Satuan Dasar** (pola Delivery Note, P268), jumlahnya tepat `base_qty` baris; nilai lot dibagi menurut qty dasar |
| T7 | **Satuan Dasar Item bisa diubah setelah ada stok** | Terkunci setelah dipakai di dokumen atau punya gerak stok |

Semua ini tanpa perubahan skema.

### 2.1 Qty pecahan: satu aturan untuk semua satuan
Desimal per satuan **ditunda** (user). Semua satuan diperlakukan sama:

1. Qty yang diketik: paling banyak **4 desimal**, seperti hari ini.
2. Qty dasar: **4 desimal**. Qty komersial turunan (hasil timbang): **6 desimal**.
3. Hasil timbang untuk Qty Terima (di bawah toleransi) dan Bonus **dibulatkan ke bawah pada
   desimal ke-4**, tidak ke bilangan utuh. Akibat yang diterima: stok PCS bisa pecahan
   (57,324 PCS) sampai desimal per satuan dibangun.

### 2.2 Perhitungan: kuantitas komersial dan kuantitas stok
Pola ERP mainstream (SAP: order unit dan base unit; Business Central: *Quantity* dan
*Quantity (Base)*, masing-masing dengan sisa sendiri): **dua kuantitas, disimpan
berdampingan**, tidak dihitung ulang satu dari yang lain pada dokumen berikutnya.

| Kuantitas | Satuan | Presisi | Dipakai untuk |
| --- | --- | --- | --- |
| **Komersial** (`qty`) | PO | 6 desimal | Pemenuhan PO, GR/IR, Invoice, pembayaran |
| **Stok** (`base_qty`) | Dasar | 4 desimal | Lot, saldo stok, MAC |

1. **Nilai = qty komersial × harga satuan PO**, dibulatkan sekali di akhir; diskon dan
   bagian terima mengikuti kumulatif (P112). Harga per Satuan Dasar tidak pernah dibuat,
   karena pembulatannya akan ikut terkali.
2. **Biaya stok = nilai ÷ qty dasar**, hanya hasil baca (P114).
3. **Tanpa timbang selisih:** qty komersial = Qty SJ; qty dasar = × faktor.
4. **Di bawah toleransi:** qty dasar = timbangan ÷ berat satuan, dibulatkan ke bawah di desimal ke-4; qty
   komersial = qty dasar ÷ faktor, 6 desimal. Yang dibayar sama dengan yang masuk stok.
5. **Sisa PO dilacak di dua satuan** (`base_qty`, `received_base_qty` di baris PO).
   Penerimaan yang menghabiskan salah satunya mengambil sisa keduanya, jadi tidak ada sisa pecahan.
6. **Faktor dicatat di baris PO** saat disimpan, dan Receipt Note menyalin faktor PO itu, bukan
   faktor master hari penerimaan.
7. Layar memakai satu angka satuan PO, nol di belakang dibuang; tidak ada gabungan dua satuan.

| Kasus | Qty komersial | Harga | Nilai | Stok |
| --- | ---: | ---: | ---: | ---: |
| 5 BOX, timbangan setara 4,777 BOX | 4,777 BOX | 1.200.000 | 5.732.400 | 57,324 PCS |
| Sisanya dari 10 BOX | 5,223 BOX | 1.200.000 | 6.267.600 | 62,676 PCS |
| 100 BOX, timbangan setara 500 PCS | 41,666667 BOX | 1.000.000 | 41.666.667 | 500 PCS |
| Sisanya | 58,333333 BOX | 1.000.000 | 58.333.333 | 700 PCS |

**Anjuran:** Item yang rutin datang dengan berat tidak tetap dibeli dalam satuan yang
ditagih supplier (biasanya KG). BOX untuk barang yang isinya tetap; pecahan BOX adalah pengecualian.

## 3. Timbangan di Receipt Note

### 3.1 Aturan

| Angka | Asal |
| --- | --- |
| Qty PO | Baris PO, dibaca |
| **Qty SJ** | **Diketik**: jumlah di surat jalan supplier, satuan PO, tidak melebihi sisa PO (B18, tetap) |
| Berat Satuan, Toleransi | Master Item, disalin saat ditimbang |
| Qty Pembanding | Qty SJ (dasar) × Berat Satuan |
| Range Toleransi | Pembanding × (1 ± toleransi), batasnya termasuk dalam toleransi |
| **Qty Timbangan (Kg)** | **Diketik** (nanti bisa dari alat) |

| Hasil | Qty Terima | Qty Bonus |
| --- | --- | --- |
| Dalam Toleransi | Qty SJ | — |
| Di atas Toleransi | Qty SJ | (timbangan − batas atas) ÷ berat satuan |
| Di bawah Toleransi | timbangan ÷ berat satuan | — |

Dicocokkan dengan screenshot (berat satuan 1 Kg, toleransi 10 %):

| SJ | Timbangan | Range | Terima | Bonus |
| ---: | ---: | --- | ---: | ---: |
| 200 | 200 | 180–220 | 200 | — |
| 800 | 1.000 | 720–880 | 800 | 120 |
| 800 | 500 | 720–880 | 500 | — |

Akibat aturan ini, sesuai maunya toleransi:
- Timbangan 720 diterima 800, sedangkan 719 diterima 719.
- Kelebihan sampai batas atas (801–880) tidak dicatat di mana pun.

### 3.2 Alur
1. Field Qty baris Receipt Note Item bertimbang **membuka modal Penimbangan** (P328);
   Qty SJ diketik di modal, Qty Terima tidak bisa diketik. Item tanpa timbangan tetap seperti sekarang.
2. Modal *Penimbangan* (tata letak screenshot, komponen desain aplikasi) menghitung
   langsung saat diketik; **Simpan** mengisi `qty` dan `base_qty` baris.
3. Lot dibagi atas qty dasar yang diterima, dalam Satuan Dasar. Mengubah Qty SJ menghapus hasil
   timbang baris itu, dan lot dibagi ulang.
4. Draft boleh belum ditimbang; **Posting menolak** baris yang belum, dan server
   menghitung ulang hasilnya dengan fungsi yang sama.
5. Posting memakai `qty` untuk nilai, GR/IR, sisa PO dan Invoice, `base_qty` untuk stok. Qty
   Terima 0 ditolak: barisnya dihapus.
6. Bila ada bonus, posting yang sama membuat **satu Stock Receipt
   berstatus Diterima** untuk semua bonus note itu, langsung masuk stok. Di Draft, bonus tampil sebagai informasi di baris.

**Di bawah toleransi:** sisa PO tetap terbuka (§3.5).

### 3.3 Stock Receipt untuk bonus
Tujuan baru **`purchase_bonus`** di `log_stock_receipt` (`stock-receipt-purposes.ts`),
menyebut Receipt Note asalnya.
- **Nilai 0**: supplier tidak menagihnya, tanpa jurnal, tanpa GR/IR; moving average
  Item turun (yang dibiarkan terbuka oleh P114).
- **Langsung Diterima** pada posting Receipt Note, bertanggal sama, tanpa Terima.
  No. Stok baru otomatis (W10), status Tersedia; lokasi dan kadaluarsa mengikuti lot
  pertama barisnya, karena tidak ada langkah untuk memilihnya.
- Receipt Note dan Stock Receipt saling menautkan. Nomor `SRC/YYYY/MM/NNNN` (hari ini
  Stock Receipt menyalin nomor dokumen produksi).
- Invoice Pembelian dan sisa PO tidak pernah membaca bonus.
- Tujuan ini tanpa pilihan nilai (P304) dan tanpa *Dalam Perjalanan*; register Stock
  Receipt menampilkannya dengan filter Tujuan.

### 3.4 Skema

```dbml
Table m_item_weighting {
  id int [pk, increment]
  item_id int [unique, not null, ref: > m_item.id, note: 'ada baris = Item ditimbang']
  receiving_tolerance decimal(18,6) [not null, default: 0, note: 'persen']
  item_weight decimal(18,6) [not null, note: 'Kg per Satuan Dasar, > 0']
}

Table log_receipt_note_weighting {
  id int [pk, increment]
  receipt_line_id int [unique, not null, ref: > log_receipt_note_line.id]
  qty_sj decimal(18,6) [not null]
  uom_id int [not null, note: 'satuan PO']
  uom_factor decimal(18,6) [not null, note: 'ditambah: berat milik Satuan Dasar']
  item_weight decimal(18,6) [not null, note: 'snapshot']
  qty_calculated decimal(18,6) [not null, note: 'qty_sj × uom_factor × item_weight, Kg']
  receiving_tolerance decimal(18,6) [not null, default: 0, note: 'snapshot, persen']
  lower_tolerance decimal(18,6) [not null]
  upper_tolerance decimal(18,6) [not null]
  qty_weighting decimal(18,6) [not null, note: 'diketik, Kg']
  weighting_result enum [not null, note: 'Within | Above | Below di sistem; teks Indonesia di layar']
  qty_received decimal(18,6) [not null, note: 'satuan PO; ditarik ke line.qty']
  qty_bonus decimal(18,6) [not null, default: 0, note: 'Satuan Dasar; dasar Stock Receipt']
  // created/updated seperti tabel lain
}
```

Beda dari gambaran user: id `int` (konvensi §9), `uom_factor` ditambah, dan
`qty_bonus` dalam Satuan Dasar karena menjadi Stock Receipt.

| Tabel lain | Perubahan |
| --- | --- |
| `m_item` | Tidak berubah; tab *Timbangan* di form menulis `m_item_weighting` |
| `pur_order_line` | `base_qty`, `received_base_qty`; `received_qty` → `Decimal(18,6)` |
| `fin_ap_invoice_line` | `qty` → `Decimal(18,6)` |
| `log_receipt_note_line` (dan `_tracking`) | Baris: presisi `qty` / `base_qty` → `Decimal(18,6)`, diisi dari hasil timbang. Tracking: `qty` dibuang, `base_qty` menjadi acuan |
| `log_stock_receipt` | pasangan sumber lemah `source_doc_type_id` / `source_doc_id`, dengan `from_unit_id` kosong |

### 3.5 SJ parsial dan sisi supplier: dicoba apa adanya
Tidak ada angka *Kurang*, baris pengganti, atau sisa kirim versi supplier. Hari ini dan seterusnya:
sisa PO = Qty PO − Qty Terima; Qty SJ berikutnya mulai dari sisa itu dan bisa diganti; PO menutup
saat diterima penuh atau dengan *Tutup*; Invoice menagih Qty Terima dan menolak total supplier di
luar toleransi. Yang diamati saat mencoba (§4 langkah 6): K1 sisa 5,223 BOX sedangkan SJ supplier
5 BOX; K2 PO tersisa 0,223 BOX; K3 supplier menagih 5 BOX penuh.

## 4. Langkah

Tiap langkah: migrasi bila perlu, `DBML/erp.dbml.md`, `db:map`, test, build, lint, commit, Neon,
lalu **berhenti untuk diperiksa user**.

### Langkah 1 (selesai, P320) — Kunci Satuan Dasar
- Satuan Dasar Item Terkunci setelah dipakai (dokumen atau gerak stok), dijaga di
  `checkItemBaseUom` dan ditampilkan di form. Tanpa migrasi.
- **Periksa:** Satuan Dasar Item berstok tidak bisa diganti; Item baru masih bisa.

### Langkah 2 (selesai, P320) — Purchase Order dalam satuan alternatif
- Migrasi `po_base_qty`: `pur_order_line.base_qty` (= qty × faktor), `received_base_qty`
  (dari Receipt Note posted), `received_qty` 6 desimal.
- `purchase-order.ts`: simpan `base_qty` dan faktor; bagian PR, Tutup dan Tolak membaca
  Satuan Dasar; tutup otomatis saat sisa habis.
- `purchase-order-form.tsx`: T1–T5 (petunjuk, kosongkan saat ganti satuan, `= 108 PCS`, gabung dan cabut PR).
- **Periksa:** PR 100 PCS → PO 9 BOX @ harga per BOX: nilai 9 × harga, PR tertutup, *melebihi PR* 8 PCS.

### Langkah 3 (selesai, P320) — Receipt Note dan Invoice dua kuantitas
- Migrasi `receipt_two_qty`: presisi 6 desimal (baris RN, baris Invoice), `tracking.qty` dibuang.
- `receipt-note.ts`: `qty` untuk nilai, `base_qty` untuk stok; penerimaan yang menghabiskan sisa
  mengambil sisa keduanya; lot dalam Satuan Dasar. Penerimaan retur ikut dialog yang sama, angkanya tetap.
- Dialog lot, form dan picker menampilkan satuan dasar; Invoice hanya satuan PO.
- `db:reconcile`: baris = Σ lot; diterima di PO = Σ Receipt Note posted, di kedua satuan.
- **Periksa:** PO 10 BOX diterima 4 lalu 6 BOX; stok 120 PCS; GR/IR nol setelah Invoice.

### Langkah 4 (selesai, P321) — Master Timbangan
- Migrasi `item_weighting`: `m_item_weighting`. Tab *Timbangan* di form Item (Barang dengan Kelola
  Stok saja): *Ditimbang saat Terima*, Berat Satuan (Kg), Toleransi (%). Satu audit dengan Item.
- **Periksa:** nilai tersimpan; Item tanpa timbangan tidak berubah di mana pun.

### Langkah 5 (selesai, P321) — Penimbangan di Receipt Note
- Migrasi `receipt_weighting`: `log_receipt_note_weighting` dan enum hasilnya.
- `receipt-weighting.ts` client-safe: satu fungsi hitung, dipakai modal, simpan dan Posting.
- Modal *Penimbangan* (P328): isian Qty SJ dan Qty Timbangan; kotak Pembanding dan kotak Hasil Timbangan
  dengan badge hasil, Qty terima, bonus dan Qty stock.
- Baris: field Qty membuka modal dan menampilkan Qty Terima; urutan SJ → timbang → lot (§3.2).
- Bonus dihitung dan tampil di Draft. **Posting dengan bonus ditolak sampai langkah 6**, supaya
  barang tidak hilang dari catatan.
- Test: tiga contoh screenshot; 720, 719, 880, 881; 4,777 BOX → 57,324 PCS; 41,666667 BOX; timbangan 0.
- **Periksa:** ketiga warna modal dan isinya sama dengan screenshot.

### Langkah 6 (selesai, P321; uji bersama user menunggu) — Bonus, bukti dan uji alur
- Migrasi `receipt_bonus`: sumber di `log_stock_receipt`; tujuan `purchase_bonus`, `SRC/…`, nilai 0,
  langsung Diterima dalam posting Receipt Note (§3.3); saling menautkan.
- `db:reconcile`: baris posted bertimbang = hasil timbangnya; bonus = Stock Receipt-nya, bernilai 0.
- Seed walet dan makloon: contoh konversi dan timbangan. Test alur penuh PR → PO BOX → dua SJ
  parsial → Invoice → stok dan GR/IR.
- **Uji bersama user di Neon**: dalam, di atas, di bawah toleransi; parsial; catat K1–K3 dan
  kendala lain, baru diputuskan apakah *Kurang* atau Debit Note Pembelian diperlukan.

### Langkah 7 (selesai, P322) — Script penjelasan di `Script Penjelasan/Purchasing/`
Format script yang ada (apa yang terjadi, file kode, tabel dan kolom, rumus, query, contoh).
**Angka contoh dari menjalankan kode asli**, bukan hitungan tangan. Tiap script ditulis di langkah
yang membangunnya; sisanya di sini. Script 07 (Receipt Note) dan bagian pembeliannya di 02, 03, 10
diperbarui, dan 07 dipindah ke folder ini sebagai 04.

| Script | Isi | Ditulis di |
| --- | --- | --- |
| 00 Baca Dulu | Peta PR → PO → RN → Invoice → Pengeluaran, tabel dan statusnya, satu cerita contoh | 7 |
| 01 Purchase Request | Satuan dasar, Tanggal Dibutuhkan, tutup sendiri | 7 |
| 02 Purchase Order | Satuan alternatif, faktor, `base_qty`, pembagian ke PR, pajak, approval | 2 |
| 03 Penimbangan | Rumus toleransi, tiga hasil, snapshot, bonus | 5, 6 |
| 04 Receipt Note | Dua kuantitas, nilai, lot, jurnal, SJ parsial | 3 |
| 05 Uang Muka Pembelian | Tagihan, Pengeluaran, AP item Uang Muka | 7 |
| 06 Invoice Pembelian | GR/IR, selisih supplier, PPh, potongan uang muka, jurnal | 7 |
| 07 AP Item dan Buku Hutang | Pengisian tabel, saldo, laporan | 7 |
| 08 Nilai, Query dan Cek | Alur ujung ke ujung, query, reconcile | 7 |

## 5. Pembaruan sales yang belum ada di purchasing

Dicek ke kode 24/11/2026. Yang sudah setara tidak didaftar: multi-currency, AP item, laporan AP,
DocumentRegister, tab form, Simpan & Posting, PPh selalu dipotong, tutup otomatis, lot di dialog.

| # | Sudah di sales | Purchasing sekarang | Usulan |
| --- | --- | --- | --- |
| G1 | Sales Return + Receipt Note retur (P287–P289) | Tidak ada retur ke supplier | Paket sendiri: **Purchase Return** + Delivery Note `purchase_return` |
| G2 | Credit Note Penjualan (P292–P294) | Tidak ada; Invoice penuh dari supplier ditolak | Paket sendiri: **Debit Note Pembelian** (P298), bersama G1 |
| G3 | Kredit dipakai Invoice lain / refund (P295) | Tidak ada | Setelah G2 |
| G4 | Invoice Penjualan menampilkan status bayar dan daftar penerimaannya di halaman | Invoice Pembelian: status hanya di register, tanpa daftar Pengeluaran | **Masuk langkah 8** |
| G5 | Delivery Note menampilkan *Ditagih* per baris | Receipt Note tidak menampilkan Invoice yang menagih | **Masuk langkah 8** |
| G6 | Baris Invoice Penjualan menyimpan bruto dan diskon (P111) | Invoice Pembelian hanya DPP dan harga; diskon PO tidak terlihat | **Masuk langkah 8, tampilan dari PO**; tanpa kolom |
| G7 | Lot dalam satuan dasar, baris = Σ lot (P268) | RN: lot di satuan PO | **Sudah di langkah 3** |
| G8 | Layar Delivery Note final dan dijaga test (P269) | Receipt Note belum di `DOCUMENT_SCREENS` | **Masuk langkah 8** |
| G9 | Salin Customer Order | PO tanpa Salin (P124) | Nanti; baris PO wajib dari PR, jadi yang disalin hanya header |
| G10 | Customer Order / Sales Order menampilkan dokumen turunannya (Jadwal, Delivery Order) | PO menampilkan Receipt Note dan Invoice, bukan Uang Muka; PR tidak menampilkan PO yang memakainya | **Masuk langkah 8** |
| G11 | Alamat customer dipilih di order dan terkunci (P53) | PO tanpa alamat supplier dan alamat kirim cetak | Nanti, bersama cetak PO |
| G12 | Faktur Pajak dan Bukti Potong otomatis (P100) | Faktur Masukan dan Bukti Potong terbitan kita tidak ada (B33) | Menunggu modul Pajak dibuka (MC19) |
| G13 | Sales Order: jadwal kirim bertahap per tanggal | PO satu Tanggal Kirim Diharapkan | Nanti; perlu jadwal per baris |

Gudang per user (P301) belum ada di Receipt Note maupun Delivery Note, jadi bukan perbedaan sales–purchasing.

### Langkah 8 (selesai, P322) — Menyamakan tampilan (G4, G5, G6, G8, G10)
Hanya membaca dan menautkan, tanpa migrasi dan tanpa perubahan posting. Retur dan Debit Note (G1–G3)
direncanakan terpisah setelah uji langkah 6.

## 5a. Di luar rencana
Koneksi ke alat timbang, bruto / tara, timbang di Transfer dan Stock Issue,
persetujuan atas hasil di luar toleransi, retur ke supplier, pencatatan Kurang dan
penggantinya (Q10), Debit Note Pembelian (P298).

## 6. Keputusan user 24/11/2026

| # | Keputusan |
| --- | --- |
| Q1 | Bonus bernilai 0 |
| Q2 | Stock Receipt bonus langsung diposting; tujuan baru `purchase_bonus` |
| Q3 | Desimal per satuan **ditunda**; satu aturan universal 4 desimal (§2.1) |
| Q4 | Satu timbangan per baris item |
| Q5 | Berat Satuan dan Toleransi di Master Item (`m_item_weighting`, DBML user) |
| Q6 | Item bersatuan berat (GR, KG) tetap lewat timbang |
| Q7 | Timbang dulu untuk mendapat Qty Terima, baru lot |
| Q9 | Disetujui: qty komersial boleh koma; `base_qty` dan faktor master saat PO disimpan ikut dicatat; dua kuantitas, nilai = qty satuan PO × harga (§2.2) |
| Q10 | Angka *Kurang*, baris pengganti dan sisa kirim versi supplier **tidak dibuat**; alur dicoba dulu apa adanya (§3.5) |
| Q11 | Yang ditagih tetap satuan pembelian (dipesan sekian, dibayar sekian); base fungsi utamanya di Receipt Note, konversi dari yang dibeli ke yang diterima |
| Q8 | Ganti satuan di PO mengosongkan Qty dan Harga |
