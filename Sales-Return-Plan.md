# Sales Return — Plan & Outline Implementasi

> Status: **disetujui 19/11/2026 (P287), semua rekomendasi SR1–SR10.** Belum dibangun.
> Setiap titik keputusan diberi nomor **SR1…** dan pertanyaan terbuka **QR1…**.
> Setelah disetujui, keputusan masuk `Claude-ERP.md` §12 sebagai P2xx dan
> langkah build dicatat satu per satu saat selesai.

---

## 1. Ringkasan

User ingin **Sales Return menjadi dokumen sendiri** yang:

1. merujuk ke **satu Customer Order**,
2. lalu ke **Delivery Note** (yang sudah diposting) di dalam Customer Order itu,
3. dan menjadi **dasar Receipt Note purpose `sales_return`** — dokumen yang
   memasukkan barang kembali ke gudang.

Usulan plan ini memakai pola mainstream ERP (SAP: *Returns Order → Returns
Delivery → Credit Memo*; Odoo: *Return picking → Credit Note*) yang juga
cocok dengan aturan proyek yang sudah ada:

| Langkah | Dokumen | Modul | Posting |
| --- | --- | --- | --- |
| 1 | **Sales Return** (`SR/…`) | Penjualan | **tidak ada** — dokumen perintah / persetujuan, seperti Customer Order dan Delivery Order |
| 2 | **Receipt Note** purpose `sales_return` (`RN/…`) | Persediaan | stock masuk kembali + **Dr Persediaan / Cr HPP** di nilai saat barang keluar |
| 3 | **Credit Note Penjualan** (`CNS/…`) — hanya bila barangnya **sudah ditagih** | Finance › Invoice | **Dr Retur Penjualan · Dr PPN Keluaran / Cr Piutang Usaha**, AR item *Retur*, dan (nanti) catatan Nota Retur di modul Pajak |

Alasan dipisah tiga (bukan Sales Return atau Receipt Note yang memposting
semuanya):

- **P106** — dokumen logistik hanya mengurus kuantitas dan nilai stock, tidak
  pernah harga jual atau pajak. Jadi Receipt Note tidak boleh memposting
  pendapatan / PPN / piutang.
- **P107** — modul Penjualan hanya memegang order; yang menagih atau
  menyelesaikan uang adalah Finance. Jadi Sales Return tidak memposting
  piutang. Credit Note adalah cermin Invoice Penjualan di Finance.
- Retur barang yang **belum ditagih** tidak punya piutang, pendapatan, atau
  PPN untuk dikoreksi — cukup langkah 1 dan 2, dan Invoice nantinya menagih
  kuantitas bersih.

---

## 2. Analisa akuntansi

### 2.1 Dua kasus yang perlakuannya berbeda

**Kasus A — barang sudah dikirim (Delivery Note posted) tetapi belum
ditagih.** Saat pengiriman yang tercatat hanya Dr HPP / Cr Persediaan (P94).
Belum ada pendapatan, PPN, atau piutang. Maka retur hanya membalik sisi
persediaan:

```
Receipt Note (sales_return)
  Dr Persediaan (kategori item)      nilai saat keluar
     Cr HPP (kategori item)               nilai saat keluar
```

Tidak ada Credit Note dan tidak ada dokumen pajak. Invoice Penjualan yang
dibuat kemudian menagih **qty Delivery Note − qty yang sudah diretur**.

**Kasus B — barang sudah ditagih (Invoice Penjualan posted).** Pendapatan,
PPN Keluaran dan piutang sudah diakui. Maka selain jurnal persediaan di atas,
Credit Note membalik sisi penjualan:

```
Credit Note Penjualan
  Dr Retur Penjualan (kontra pendapatan)   DPP bagian yang diretur
  Dr PPN Keluaran                          PPN bagian yang diretur
     Cr Piutang Usaha (nama customer)          DPP + PPN
```

### 2.2 Nilai persediaan yang kembali

Sesuai **P114**: *retur penjualan kembali di nilai saat ia keluar* — yaitu
nilai yang disimpan di baris tracking Delivery Note (`cost_amount`, P268),
**bukan** rata-rata saat ini. Untuk retur sebagian, nilainya adalah
*cumulative share* dari `cost_amount` baris tracking itu (P112, §7.5): retur
sebelumnya + retur ini dikurangi retur sebelumnya, sehingga retur penuh
mendarat persis di nilai yang keluar dan HPP terbalik tanpa selisih.

Barang kembali dengan **No. Stok / lot yang sama** (`receiveStock` menerima
nomor yang sudah ada, P217), ke gudang dan lokasi yang dipilih, dengan status
yang dipilih (Tersedia / Karantina / Diblokir, `sys_stock_status`) — barang
rusak tidak harus langsung bisa dijual lagi.

### 2.3 Akun Retur Penjualan (SR1)

Rekomendasi: akun kontra-pendapatan **Retur Penjualan** (kelompok 4, saldo
normal debit) di Account Mapping kartu *Invoice Penjualan*, bukan langsung
mendebit akun Penjualan. Praktik umum SAK/akuntansi Indonesia (akun *Retur dan
Potongan Penjualan*) dan Laba Rugi tetap memperlihatkan penjualan bruto dan
returnya. `db:seed-accounts` menambah akun dan mapping-nya.

### 2.4 Bagian piutang yang sudah dibayar (SR2) — keputusan penting

Bila Invoice sudah dibayar (atau ditutup Uang Muka) sebagian / seluruhnya,
nilai retur bisa **lebih besar dari sisa piutang Invoice**. Ke mana
selisihnya?

`Claude-ERP.md` §10.2 aturan 12 menyatakan konsep *Kredit Pelanggan*
**diabaikan kecuali user menyatakan lain** — jadi ini perlu keputusan user.

| Opsi | Isi | Catatan |
| --- | --- | --- |
| **A (rekomendasi)** | Credit Note selalu melahirkan **satu AR item tipe *Retur*** (arah Decrease, seperti Uang Muka), lalu **langsung diterapkan** ke AR item Invoice-nya sebatas saldonya. Sisanya tetap terbuka sebagai **kredit customer**, dikembalikan lewat Pengeluaran (*Pengembalian Dana Customer*) atau dipakai Invoice berikutnya dari Customer Order yang sama | Mengikuti *one document, one item* (P214) dan pola Uang Muka diterapkan (P117). Pola yang sama dipakai SAP / Odoo (credit memo → rekonsiliasi) |
| B | Credit Note ditolak bila melebihi sisa piutang Invoice | Paling sederhana, tetapi retur barang yang sudah lunas jadi tidak bisa dicatat |

Pada opsi A, **seluruh kredit tetap di akun Piutang Usaha** (nama customer),
sehingga per customer: Piutang Usaha di GL = Σ item Invoice − Σ item Retur.
Customer yang kreditnya lebih besar dari tagihannya terlihat bersaldo kredit
di Piutang Usaha — reklasifikasi ke *Utang kepada Customer* untuk penyajian
Neraca bisa dibuat nanti (QR4), tidak diperlukan untuk pembukuan.

### 2.5 Retur atas Invoice yang memakai Uang Muka

Karena ERP ini memakai **PPN pelunasan = PPN penuh − PPN uang muka** (P113)
dan Invoice item lahir di nilai **face** (P117), setiap baris Invoice
menyimpan **DPP penuh dan PPN penuh**. Maka retur cukup mengkredit **DPP dan
PPN penuh bagian yang diretur** dari baris Invoice; uang muka yang sudah
diterapkan tidak dikembalikan ke item Uang Muka (ia sudah terpakai). Bila sisa
piutang Invoice tidak cukup, sisanya menjadi kredit customer (SR2-A). Tidak
ada perhitungan ulang uang muka.

### 2.6 Harga & angka retur

Dari baris Invoice Penjualan yang menagih baris Delivery Note tersebut, dengan
*cumulative share* (P112, `tax_concept.md` §7.5) atas kuantitas baris
Invoice: bruto, diskon, DPP, DPP Nilai Lain dan PPN. Jadi:

- retur penuh = persis angka baris Invoice;
- jumlah semua retur atas satu baris tidak pernah melebihi baris itu;
- tidak ada pembulatan bertumpuk antar retur sebagian.

### 2.7 Multi-currency

Credit Note mengikuti mata uang dan kurs **Invoice** (kurs order yang terbawa,
MC8). AR item Retur lahir di kurs itu; diterapkan ke Invoice item yang
bernilai di kurs yang sama → tidak ada selisih kurs. Selisih kurs baru timbul
bila kredit sisa dikembalikan tunai (seperti pembayaran biasa, P273).

---

## 3. Analisa perpajakan Indonesia

### 3.1 PPN — Nota Retur

- **Nota Retur** mengurangi **DPP dan PPN Keluaran pada masa pajak saat nota
  retur dibuat**, bukan masa faktur aslinya (`tax_concept.md` §5.3, ketentuan
  PPN atas pengembalian BKP — PMK 18/2021 jo. PMK 81/2024 / Coretax).
- Hanya untuk **BKP (barang)**. Untuk jasa yang batal, instrumennya **Nota
  Pembatalan**, bukan retur — di luar plan ini (Perizinan / jasa).
- Nota Retur **merujuk ke faktur pajak** (NSFP) Invoice yang barangnya
  diretur, dan tidak boleh melebihi faktur itu.
- Nota Retur **dibuat oleh pembeli PKP** (di Coretax). Penjual mencatat nomor
  dan tanggal Nota Retur pembeli → Sales Return menyimpan **No. Nota Retur
  Customer** dan tanggalnya (opsional saat Draft, lihat SR6).
- Pembeli **non-PKP**: perlakuannya ditunda (`tax_concept.md` Q15) — dicatat
  di sini sebagai QR1.
- **DPP Nilai Lain 11/12**: PPN retur mengikuti rantai yang sama dengan
  fakturnya (12 % × 11/12 × DPP), dihitung lewat cumulative share PPN baris
  Invoice, bukan rumus terpisah — sehingga tidak mungkin melebihi PPN faktur.
- **Kasus A (belum ditagih)**: belum ada faktur pajak, jadi **tidak ada Nota
  Retur**; Invoice nanti menagih kuantitas bersih dan fakturnya langsung
  bernilai bersih.

### 3.2 PPh 22 / 23

- Retur selalu barang, jadi yang relevan **PPh 22** (customer pemungut).
- **Invoice belum dibayar**: dasar PPh pada penerimaan = DPP bersih Invoice
  setelah uang muka **dan setelah retur** (P119). Penerimaan yang membaca
  Invoice harus memakai DPP yang sudah dikurangi Credit Note.
- **Invoice sudah dibayar dan PPh sudah dipotong**: bukti potong customer
  harus dibetulkan oleh customer → status *Perlu Pembetulan* di Bukti Potong
  (`tax_concept.md` §6.2). Modul Pajak sedang disembunyikan (P270, MC19), jadi
  ini **dicatat, belum dibangun** (QR2).

### 3.3 Modul Pajak

Modul Pajak disembunyikan selama multi-currency (MC19). Usulan: Credit Note
**menyimpan semua angka pajaknya** (DPP, DPP Nilai Lain, PPN per baris, NSFP
faktur yang dikoreksi, No. Nota Retur customer) sejak awal, dan catatan *Nota
Retur* di `tax_faktur` (kind `Return`, `tax_concept.md` §5.4) dibuat lewat hook
`afterPost` ketika modul Pajak dibuka lagi — sama seperti Invoice. Backfill
bisa dijalankan seperti `db:tax-backfill` (P100).

---

## 4. Dokumen 1 — Sales Return

**Tabel** `sal_return(_line)`, nomor `SR/YYYY/MM/NNNN` dan `SR-NP/…` untuk
Customer Order tanpa PPN (P109). Menu **Penjualan › Sales Return**
(`/sales/return`).

### 4.1 Header

| Field | Isi |
| --- | --- |
| Customer Order | dipilih sekali lalu terkunci; Open **atau** Ditutup (barang dari order yang sudah tertutup tetap boleh kembali) |
| Customer, Alamat | dari Customer Order; alamat boleh alamat customer mana pun (alamat jemput), mulai dari alamat CO |
| Tanggal | tanggal dokumen |
| Alasan Retur (SR3) | pilihan tetap di kode: *Rusak*, *Salah Kirim*, *Kadaluarsa*, *Tidak Sesuai Pesanan*, *Lainnya* + keterangan |
| No. / Tgl Nota Retur Customer | opsional; wajib sebelum Credit Note diposting bila customer PKP dan barang sudah ditagih (SR6) |
| Catatan | bebas |

### 4.2 Baris

Dipilih dari **baris Delivery Note posted** (purpose `sales_delivery`) milik
Customer Order itu, di dialog *Pilih Delivery Note* (pola P81): No. SJ,
Tanggal Kirim, Barang, Qty Kirim, *Sudah Diretur*, *Sisa*, dan **Ditagih**
(No. Invoice bila sudah ditagih — hanya informasi, P82).

Per baris: barang (baca), **qty retur dalam satuan dasar** (P108), batasnya
sebagai petunjuk. **Lot tidak dipilih di sini** — lot urusan logistik dan
dipilih di Receipt Note, seperti Delivery Order (qty) → Delivery Note (lot).

Aturan: total Sales Return yang hidup (semua kecuali Dibatalkan / Ditolak)
atas satu baris Delivery Note ≤ `base_qty` baris itu; dicek saat simpan dan
saat Ajukan dengan baris Customer Order terkunci.

### 4.3 Siklus (SR4)

```
Draft ─Ajukan─► Diajukan ─Setujui─► Open ─(diterima penuh)─► Ditutup
  └─Batalkan (alasan)       └─Tolak (alasan)     └─Tutup (alasan) ─► Ditutup
```

- Rekomendasi **dengan persetujuan** (retur menyentuh pendapatan dan stock).
  Bila user tidak mau persetujuan: Draft → *Terbitkan* → Open, seperti
  Delivery Order.
- **Open** = boleh dibuatkan Receipt Note.
- Menutup sendiri saat semua baris diterima penuh (*Ditutup — seluruhnya
  diterima*); *Tutup* manual melepas kuantitas yang tidak pernah datang.
- Tutup manual ditolak selama ada Receipt Note Draft atas Sales Return ini.
- **Tidak memposting apa pun.**

Izin: `SALES_RETURN_VIEW / _CREATE / _EDIT / _SUBMIT / _APPROVE / _CANCEL / _CLOSE`.

### 4.4 Yang ditulis balik

- `received_qty` di `sal_return_line` — ditulis oleh Receipt Note lewat fungsi
  modul Sales Return (`recordSalesReturnReceived`, §3.1).
- `returned_qty` di `log_delivery_note_line` — ditulis oleh posting Receipt
  Note lewat `recordDeliveryNoteReturned` milik modul Delivery Note. Inilah
  yang dibaca Invoice untuk menagih qty bersih (Kasus A) dan oleh Credit Note.

### 4.5 Penggantian barang (SR5)

Apakah retur **membuka kembali kuantitas Customer Order** supaya barang bisa
dikirim ulang (tukar barang)?

- **Rekomendasi tahap pertama: tidak.** Sales Return hanya retur untuk kredit.
  Penggantian dibuat sebagai Customer Order / Sales Order baru. `delivered_qty`
  Customer Order tidak diturunkan.
- Opsi lanjut: Tindak Lanjut *Ganti Barang* yang menurunkan `delivered_qty`
  baris SO / CO sehingga sisa bisa dikirim lagi lewat DO / DN — ini menyentuh
  penutupan otomatis CO (P97) dan pembagian kumulatif Invoice (P112), jadi
  disarankan sebagai fase terpisah.

---

## 5. Dokumen 2 — Receipt Note purpose `sales_return`

Receipt Note sudah standalone dengan purpose (P106, P125). Tambah purpose
kedua.

| Hal | `purchase_receipt` (ada) | `sales_return` (baru) |
| --- | --- | --- |
| Sumber | Purchase Order Open | **Sales Return Open** |
| Partner | Supplier | Customer |
| Nomor | `RN/…`, `RN-NP/…` mengikuti PO | `RN/…`, `RN-NP/…` mengikuti Sales Return (atau seri sendiri `RNR/…`, SR7) |
| Gudang | Gudang Tujuan PO | default gudang Delivery Note asal; boleh diganti |
| Lot | dibuat di sini | **dipilih dari baris tracking Delivery Note asal** — hanya lot yang keluar di baris itu, masing-masing ≤ keluar − sudah kembali |
| Lokasi / status | lokasi; status Tersedia | lokasi (P267) **dan status** Tersedia / Karantina / Diblokir |
| Nilai | cumulative share DPP PO | **cumulative share `cost_amount` baris tracking DN** (P114) |
| Jurnal | Dr Persediaan / Beban, Cr Barang Diterima Belum Ditagih | **Dr Persediaan / Cr HPP** (akun kategori item, fallback Account Mapping *Pengiriman Barang* — persis kebalikan DN) |
| Tulis balik | `received_qty` PO | `received_qty` Sales Return, `returned_qty` baris DN |

Lainnya sama: Draft → Posting → Posted, Batalkan Draft dengan alasan, preview
jurnal dry run (P103), satu transaksi di bawah kunci Sales Return, tidak boleh
melebihi sisa Sales Return.

Kode: `receipt-note.ts` saat ini memegang `PURCHASE_RECEIPT` sebagai konstanta.
Ikuti pola P268 di Delivery Note: buat `receipt-note-purposes.ts` (katalog) dan
pisahkan posting per purpose (`PURPOSE_POSTING`) — bagian bersama
(`receiveStock` per tracking row, jumlah baris & header) tetap satu.

Tabel: `log_receipt_note_line.source_doc_line_id` menunjuk baris Sales Return;
`log_receipt_note_tracking` mendapat `stock_status_id` dan, untuk retur,
`source_tracking_id` (baris tracking DN asalnya, weak) supaya cumulative share
nilainya bisa dihitung dan dicek.

---

## 6. Dokumen 3 — Credit Note Penjualan

Hanya untuk barang yang **sudah ditagih**. Penamaan (SR8): **Credit Note
Penjualan** (`fin_ar_credit_note(_line)`, `CNS/…` dan `CNS-NP/…`, Finance ›
Invoice › *Credit Note Penjualan*). Sengaja **bukan** "Nota Retur" — di
Indonesia Nota Retur adalah dokumen pajak buatan pembeli; sama seperti P99
memisahkan *Invoice* dari *Faktur*.

### 6.1 Isi

- Satu **Sales Return** (sumber) dan satu **Invoice Penjualan** yang dikoreksi
  (SR9: satu Credit Note per Invoice; bila barang retur tersebar di dua
  Invoice, dibuat dua Credit Note).
- Baris = **baris Receipt Note `sales_return` yang posted**, yang baris DN-nya
  ditagih Invoice posted tersebut; masing-masing dikredit paling banyak sekali
  oleh Credit Note yang hidup (pola P97).
- Angka per baris dari baris Invoice dengan cumulative share (§2.6); header =
  jumlah baris. Disimpan: bruto, diskon, DPP, DPP Nilai Lain, PPN, kurs dan
  `base_` (P271).
- Tanggal = tanggal jurnal, tidak sebelum Receipt Note. Referensi: NSFP faktur
  Invoice (dibaca dari modul Pajak), No. Nota Retur customer (dari Sales
  Return).

> **Sebagaimana dibangun (P292):** baris Credit Note adalah **baris Invoice**,
> bukan baris Receipt Note: ruangnya = yang kembali setelah ditagih (`returned_qty`
> DN di atas yang sudah ditagih bersih, P291) dikurangi Credit Note hidup lain.
> Credit Note tidak merujuk Sales Return; No. Nota Retur customer diketik di
> Credit Note. Hasil akuntansinya sama, dan satu Invoice bisa dikredit beberapa kali.

### 6.2 Posting

Satu transaksi, di bawah kunci Customer Order (seperti Invoice):

1. Jurnal: **Dr Retur Penjualan** (DPP) · **Dr PPN Keluaran** (PPN) /
   **Cr Piutang Usaha** (DPP + PPN, nama customer).
2. AR item **tipe `Return`** (tampil *Retur*, arah Decrease), sumber = Credit
   Note, scope = Customer Order (P140), lahir di total Credit Note.
3. Diterapkan ke AR item Invoice sebatas saldonya — dua event, cermin P117:
   `ReturnApplied` di item Invoice (turun), `ReturnUsed` di item Retur (turun).
4. Sisa item Retur tetap terbuka = kredit customer (SR2-A).
5. `afterPost` hook untuk Nota Retur di modul Pajak — kosong selama modul
   Pajak disembunyikan (§3.3).

Lifecycle: Draft → Posting → Posted (final), Batalkan Draft. Izin
`SALES_CREDIT_NOTE_VIEW / _CREATE / _EDIT / _POST / _CANCEL`. Konfirmasi
Posting memperlihatkan jurnal lewat dry run (P103).

### 6.3 Dampak ke dokumen lain

- **Penerimaan dari Customer**: sisa Invoice = saldo item Invoice (sudah
  turun oleh `ReturnApplied`). Basis positional share PPh memakai total
  Invoice **dikurangi** Credit Note (§3.2) — perlu dicek di
  `settleBillFromCash` / pembacaan `before`.
- **Invoice Penjualan** (Kasus A): baris Invoice menagih `base_qty −
  returned_qty` baris DN; baris yang sudah diretur penuh tidak bisa dipilih.
- **Laporan**: Buku Piutang dan Saldo Piutang menampilkan item Retur di buku
  Piutang Usaha; Umur Piutang menampilkan kredit Retur seperti kolom Uang Muka
  (tidak di-aging).

---

## 7. Kredit customer sisa (fase lanjut)

Di luar build pertama, tetapi perlu disepakati arahnya (SR10):

- **Pengeluaran purpose `customer_refund`** (*Pengembalian Dana Customer*):
  membayar item Retur terbuka — Dr Piutang Usaha / Cr Kas & Bank, event
  `Payment` di item Retur. Mesin yang sama bisa dipakai untuk *Pengembalian
  Uang Muka* yang juga belum dibangun (§17).
- **Dipakai Invoice berikutnya** dari Customer Order yang sama: picker *Pilih
  Uang Muka* di Invoice ikut menampilkan item Retur (tanpa PPN — PPN-nya sudah
  dibalik di Credit Note).

---

## 8. Skema (ringkas)

| Tabel / kolom | Baru / ubah |
| --- | --- |
| `sal_return` (header §4.1, status, `status_reason`, nomor) | baru |
| `sal_return_line` (`delivery_note_id`, `delivery_note_line_id` weak, item, `base_qty`, `received_qty`) | baru |
| `log_delivery_note_line.returned_qty` | baru, default 0, CHECK ≤ `base_qty` |
| `log_receipt_note_tracking.stock_status_id`, `source_tracking_id` | baru |
| `fin_ar_credit_note(_line)` (angka + `base_`, `invoice_id`, `sales_return_id`, `journal_id`) | baru |
| enum `ArItemType` + `Return`; enum `ArEvent` + `ReturnApplied`, `ReturnUsed` | ubah |
| `ReturnStatus`, `CreditNoteStatus` | baru |
| `sys_doc_type`: Sales Return, Credit Note Penjualan | seed |
| Account Mapping: *Account Retur Penjualan* | seed / mapping |

`DBML/erp.dbml.md` diperbarui di commit yang sama dengan migrasinya (§9).
`tests/module-boundaries.test.ts`: `sal_return` milik modul Penjualan, dibaca
Receipt Note dan Credit Note lewat fungsi bernama; Credit Note membaca DN dan
Invoice lewat fungsi modulnya.

---

## 9. Langkah build

Masing-masing satu commit, berhenti untuk review (memory: *phase review gate*).

| # | Langkah | Selesai bila |
| --- | --- | --- |
| 0 | Keputusan SR1–SR10 dicatat di `Claude-ERP.md` §12 — **selesai 19/11/2026 (P287)** | user setuju |
| 1 | **Sales Return** — skema, modul, workflow, form + dialog pilih DN, list, izin, menu — **selesai 19/11/2026 (P288)** | buat → ajukan → setujui di browser; batas qty dicek |
| 2 | **Receipt Note `sales_return`** — **selesai 19/11/2026 (P289)** — katalog purpose, posting per purpose, pilih lot dari tracking DN, status stock, `returned_qty` DN, `received_qty` SR, tutup otomatis SR | stock kembali di lot yang sama; jurnal Dr Persediaan / Cr HPP = nilai keluar; Kartu Stok & Nilai Persediaan benar |
| 3 | **Invoice menagih qty bersih** (Kasus A) — **selesai 19/11/2026 (P291)** | DN yang diretur sebagian ditagih sisanya; diretur penuh tidak bisa dipilih |
| 4 | **Credit Note Penjualan** — skema, AR item `Return`, event, posting, preview, list — **selesai 19/11/2026 (P292)**; baris per baris Invoice (lihat §6.1) | jurnal dan AR item benar untuk: belum dibayar, dibayar sebagian, lunas (kredit sisa), Invoice ber-uang-muka, USD |
| 5 | **Penerimaan & laporan** — basis PPh setelah retur, Buku/Saldo/Umur Piutang | penerimaan atas Invoice yang diretur sebagian benar |
| 6 | **`db:reconcile`** — Piutang Usaha = item Invoice − item Retur per customer; HPP dibalik = nilai keluar; retur ≤ kirim; Credit Note ≤ baris Invoice; `returned_qty` = Σ Receipt Note retur posted | semua cek hijau |
| 7 | (lanjut) Pengembalian Dana Customer, kredit dipakai Invoice berikutnya, Nota Retur di modul Pajak, Perlu Pembetulan bukti potong | sesuai keputusan saat itu |

Tes: satu suite end-to-end `tests/sales-return-flow.test.ts` (Kasus A, Kasus
B lunas & belum lunas, uang muka, retur sebagian dua kali → retur penuh tepat
di angka Invoice, USD).

---

## 10. Titik keputusan untuk user

| # | Pertanyaan | Rekomendasi |
| --- | --- | --- |
| SR1 | Tiga dokumen (Sales Return → Receipt Note → Credit Note) | Ya — mengikuti P106 / P107 dan SAP / Odoo |
| SR2 | Bagian yang sudah dibayar → kredit customer sebagai AR item *Retur* | Opsi A (ubah §10.2 aturan 12: Kredit Pelanggan kini dimodelkan) |
| SR3 | Alasan retur: daftar tetap di kode + keterangan | Ya |
| SR4 | Sales Return dengan persetujuan (Ajukan → Setujui) | Ya |
| SR5 | Penggantian barang di fase pertama | Tidak; pakai order baru |
| SR6 | No. Nota Retur customer wajib sebelum Credit Note diposting (customer PKP) | Ya, tapi tunggu modul Pajak dibuka; sementara opsional |
| SR7 | Receipt Note retur pakai seri `RN/…` yang sama atau `RNR/…` | Seri yang sama (P106: satu seri per dokumen) |
| SR8 | Nama *Credit Note Penjualan*, prefix `CNS` | Ya |
| SR9 | Satu Credit Note per Invoice | Ya |
| SR10 | Kredit sisa: refund lewat Pengeluaran dan/atau dipakai Invoice berikutnya | Keduanya, fase 7 |

## 11. Pertanyaan terbuka (verifikasi konsultan pajak)

| # | Hal |
| --- | --- |
| QR1 | Nota Retur untuk pembeli non-PKP di Coretax (siapa yang membuat, `tax_concept.md` Q15) |
| QR2 | Batas waktu pembuatan Nota Retur dan pembetulan bukti potong PPh 22 |
| QR3 | Retur atas faktur yang belum diberi NSFP (Invoice posted tapi faktur belum diupload) — cukup koreksi di sumber? (`tax_concept.md` §5.3 baris kedua) |
| QR4 | Penyajian saldo kredit customer di Neraca (reklasifikasi ke liabilitas) |
