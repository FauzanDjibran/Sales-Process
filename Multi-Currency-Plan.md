# Multi-Currency Plan — ERP

> Status: **disetujui 12/11/2026** (Claude-ERP.md P270). Tahap 1 dibangun 12/11/2026 (P270), tahap 2 dan 2a 13/11/2026 (P271, P272); tahap berikutnya belum.
> Acuan: `knowledge/multi_currency_concept.md` (KB `accounting/multi-currency` 1.1,
> diadopsi sebagai `core`), `knowledge/ar_ap_open_item_concept.md`, `tax_concept.md` §8,
> P13, P37, P105 (branch `wip-multi-currency`, diparkir).
> Aturan plan diberi nomor **MC1–MC18**; asumsi yang belum diputuskan ada di §8 (**OD-1 … OD-14**).
> Setelah disetujui, tiap tahap yang selesai dicatat di `Claude-ERP.md` §12 dengan nomor P-nya sendiri.

---

## 1. Tujuan dan lingkup

**Tujuan.** Dokumen penjualan dan pembelian bisa dibuat dalam **USD** selain **IDR** (mata uang dasar).
Setiap nominal disimpan dua kali: nominal dokumen dan nominal dasar (`total_amount` dan
`base_total_amount`). Kas & Bank valuta asing dinilai pada kurs rata-rata. Selisih kurs muncul
saat pelunasan sebagai angka penyeimbang jurnal.

| Masuk lingkup | Di luar lingkup (tetap Rupiah) |
| --- | --- |
| Menu Kurs (tipe Transaksi; Penutup untuk tahap 9) | Perizinan (Pengajuan, Uang Muka, Invoice, Biaya) |
| Customer Order → Uang Muka Penjualan → Invoice Penjualan | Tagihan Biaya Produksi dan pembayarannya |
| Purchase Order → Receipt Note → Uang Muka Pembelian → Invoice Pembelian | Seluruh aplikasi Produksi dan standard cost |
| Penerimaan dan Pengeluaran Kas & Bank, termasuk selisih kurs | Pelunasan lintas currency (tagihan USD dari / ke bank IDR), diputuskan 12/11/2026 |
| **Penukaran Valas**: Pembelian Valas (IDR → USD) dan Pencairan Valas (USD → IDR) | Transfer antar Kas & Bank satu currency (C14) |
| AR item, AP item, Buku Piutang / Hutang dan laporannya | Mata uang ketiga selain IDR dan USD (mesin sudah generik, tidak diuji) |
| PPN dan PPh di dokumen transaksi valas (angka dan jurnalnya) | Revaluasi akhir periode (tahap opsional, OD-9) |
| | **Modul Pajak** (Faktur Pajak Keluaran, Bukti Potong): disembunyikan, tidak dihapus, selama proses ini (MC19) |

---

## 2. Kondisi sekarang

| Bagian | Sudah ada | Belum ada |
| --- | --- | --- |
| Mesin kurs | `fx.ts` (`originate`, `relieve`, `settle`, `fxDifference`, `carryingRate`) dan `currency.ts` (`maySettle`, `rateSource`, `needsEnteredRate`), bawaan SIBA | Belum dipanggil dokumen mana pun |
| Master Currency | `ref_currency`, bibit IDR dan USD (P62) | Tabel kurs harian |
| Kas & Bank | Resource per currency; buku menyimpan `rate`, `base_movement`, `base_balance`; rata-rata bergerak (P37); Saldo Awal valas; laporan per currency | Penerimaan / Pengeluaran menolak resource non-Rupiah |
| Jurnal | Baris jurnal punya `currency_id` + `exchange_rate`; jurnal manual valas; General Ledger menampilkan valas | Jurnal dokumen selalu IDR |
| Dokumen | — | Tidak ada `currency_id`, kurs, atau kolom `base_` di CO, PO, uang muka, invoice |
| AR / AP item | `currency_id` (selalu IDR) | Saldo dasar (`base_`) di item dan bukunya |
| Account Mapping | *Account Selisih Kurs* | — |
| Branch `wip-multi-currency` | Penjualan valas, Kurs KMK, Revaluasi Piutang, teruji pada 05/10/2026 | Dibuat sebelum P106–P266, **tidak bisa di-merge**; diambil per berkas sebagai bahan (`tax-kurs.ts`, `tests/multi-currency.test.ts`, bagian `sales-tax.ts`) |

---

## 3. Aturan (MC1–MC18)

Semua mengikuti konsep KB; nomor di kurung menunjuk bagian konsepnya.

**Dasar**

- **MC1.** Nominal dokumen dan nominal dasar adalah dua fakta yang sama-sama disimpan; nominal dasar tidak pernah dihitung ulang saat dibaca (§1, invarian 1).
- **MC2.** Dokumen IDR memakai jalur yang sama dengan kurs `1`, sehingga `base_x = x` dan selisih kurs pasti nol (§2.4). Tidak ada cabang kode "jika valas".
- **MC3.** Satu dokumen, satu currency, dipilih di header dan terkunci setelah ada baris. Dokumen turunan mengikuti currency sumbernya dan tidak bisa mengubahnya.
- **MC4.** Semua komponen satu baris dikonversi pada kurs yang sama; total dokumen adalah jumlah nilai baris yang tersimpan (§3.1, §9.4).
- **MC5.** Pembulatan: nominal valas dua desimal; nominal dasar dua desimal (sen) lewat `roundBase` di `fx.ts`, sama dengan buku Kas & Bank; kurs `Decimal(18,6)`. Angka pajak tetap rupiah utuh (`tax_concept.md` §7).

**Asal nilai dasar**

- **MC6.** Kurs transaksi hanya ada di **Customer Order dan Purchase Order** (OD-2, diputuskan 12/11/2026). Ia diusulkan dari menu Kurs (tipe Transaksi) pada tanggal dokumen, bisa diubah selama Draft, dan disimpan di dokumen; tanpa kurs di menu, pengguna wajib mengetiknya. Kurs rata-rata (carrying rate) tidak pernah diusulkan dan tidak pernah disimpan (§4.2). Kurs per tempat:

  | Kurs | Dipakai di | Sumber |
  | --- | --- | --- |
  | Transaksi | Customer Order, Purchase Order | Usulan menu Kurs, bisa diubah, disimpan di dokumen |
  | Terima dan rata-rata bank | Penerimaan, Pengeluaran, Penukaran Valas | MC11, MC11a: diketik saat masuk, rata-rata saat keluar; tidak pernah dari menu |
  | KMK | Belum dipakai: hanya untuk Faktur Pajak dan Bukti Potong saat modul Pajak dibuka lagi | — |
  | Penutup | Revaluasi (tahap 9) | Hanya dari menu Kurs (tipe Penutup) |
- **MC7.** Pembelian: PO membawa kurs; Receipt Note mewarisi nilai dasar PO; Invoice Pembelian mewarisi nilai dasar Receipt Note. Persediaan dan *Barang Diterima Belum Ditagih* tetap rupiah pada kurs PO (§3.2).
- **MC8.** Penjualan mengikuti konsep apa adanya (OD-1, diputuskan 12/11/2026): Customer Order membawa kurs; **Invoice Penjualan mewarisi nilai dasar baris Customer Order** dan tidak punya kurs transaksi sendiri. Bagian parsial memakai pembagian kumulatif (P112) atas `base_` baris order.
- **MC9.** Uang Muka tidak punya kurs sendiri. Nilai dasarnya lahir dari pergerakan kas yang membayarnya, tanpa selisih kurs (§5.3 *create*).

**Pelunasan**

- **MC10.** AR / AP item menyimpan saldo valas dan saldo dasar; setiap entri Buku Piutang / Hutang menyimpan dua gerakan. Pelepasan memakai `round(valas × saldo_dasar ÷ saldo_valas)` dalam satu ekspresi; pelunasan penuh melepas sisa saldo dasar persis (§5.3, invarian 15–17).
- **MC11.** Kas & Bank memakai logika SIBA yang sudah ada di `currency.ts` (`maySettle`, `rateSource`), diputuskan 12/11/2026. **Uang keluar** dari resource valas dinilai pada **rata-rata resource saat Posting** dan kursnya tidak bisa diketik (P37). **Uang masuk** valas menulis **kurs transaksi** yang diketik pengguna, yang ikut membentuk rata-rata resource. Kurs kas tidak pernah diusulkan dari menu Kurs (§5.2):

  | Tagihan | Kas & Bank | Masuk | Keluar |
  | --- | --- | --- | --- |
  | IDR | IDR | kurs 1 | kurs 1 |
  | USD | USD | kurs transaksi diketik | rata-rata bank USD |
  | USD | IDR | ditolak untuk sekarang | ditolak untuk sekarang |
  | IDR | USD | ditolak | ditolak |

  Satu-satunya perpindahan antar currency adalah **Penukaran Valas** (MC11a). Untuk menolak tagihan USD dari bank IDR, `maySettle` di `currency.ts` dipersempit menjadi "currency sama saja"; logika `entered` untuk lintas currency tetap di kode untuk nanti.

- **MC11a. Penukaran Valas** adalah dokumen sendiri di Finance › Kas & Bank, dua tujuan, satu Kas & Bank IDR dan satu USD, tanpa partner. Pengguna mengetik nominal IDR dan nominal USD dari rekening koran; kursnya = IDR ÷ USD, ditampilkan, tidak disimpan sebagai input terpisah.
  - **Pembelian Valas** (IDR → USD): IDR keluar pada kurs 1; USD masuk dengan nilai dasar = IDR yang keluar. **Tidak ada selisih kurs** (§5.3 *create*); rata-rata bank USD bergerak ke kurs beli.
  - **Pencairan Valas** (USD → IDR): USD keluar pada **rata-rata bank USD saat Posting**; IDR masuk sebesar yang diterima. Bedanya **selisih kurs terealisasi**, angka penyeimbang jurnal (§5.4). Biaya bank (OD-12) ke Beban Bank.
  - Jurnal: Dr Kas & Bank tujuan / Cr Kas & Bank asal, ± Selisih Kurs. Kedua Buku Kas & Bank ditulis dalam transaksi yang sama.
- **MC12.** Selisih kurs dihitung **per baris pelunasan**, disimpan per baris, dan menjadi angka penyeimbang jurnal ke *Account Selisih Kurs*; sisinya tidak pernah dipilih (§5.4, §5.6).
- **MC13.** Uang Muka yang dipakai Invoice adalah pelunasan tanpa kas: Piutang / Hutang dilepas pada rata-ratanya, Uang Muka pada rata-ratanya, bedanya selisih kurs (§5.5).
- **MC14.** Satu Penerimaan / Pengeluaran melunasi tagihan **satu currency** saja, sama dengan currency Kas & Bank-nya (OD-5, MC11). *Pilih Tagihan* hanya menampilkan tagihan currency itu. Lebih bayar tetap ditolak.

**Pajak**

- **MC15.** **Modul Pajak tidak ikut update ini** (diputuskan 12/11/2026). Faktur Pajak dan Bukti Potong untuk dokumen valas tidak dibuat; konversinya ke rupiah pada Kurs KMK (`tax_concept.md` §8) dibangun saat modul Pajak dibuka lagi.
- **MC16.** **Kurs jurnal sama dengan kurs transaksi** (diputuskan 12/11/2026, menggantikan opsi 1 OD-3). Setiap baris jurnal sebuah dokumen memakai kurs dokumen itu sendiri, untuk DPP, PPN dan PPh sekaligus (konsep §3.1, invarian 13). Tidak ada kurs pajak terpisah dan tidak ada selisih kurs karena pajak. Kurs per dokumen: Invoice memakai nilai dasar yang diwarisi dari order (kurs order); Penerimaan memakai kurs terima, termasuk PPh yang dipotong pelanggan; Pengeluaran dari bank USD memakai rata-rata bank. Satu-satunya pengecualian adalah pelepasan saldo yang sudah ada (Piutang, Hutang, Uang Muka), yang dilepas pada rata-ratanya sendiri (konsep §5.3, §5.5); bedanya selalu selisih kurs. Piutang dan Hutang tidak punya kurs: mereka punya saldo valas dan saldo dasar. Saat modul Pajak dibuka lagi, beda antara rupiah jurnal dan rupiah KMK di Faktur Pajak dibahas di sana.
- **MC19.** **Modul Pajak disembunyikan, tidak dihapus**, selama proses multi-currency (diputuskan 12/11/2026). Menu Pajak hilang dari rail dan beranda lewat `hidden: true` di `nav.ts`; tautan ke dokumen pajak di Referensi Penerimaan dan Invoice, serta NSFP di laporan, ikut disembunyikan. Halaman, permission, tabel dan data tetap ada; dokumen IDR tetap membuat catatan pajaknya seperti sekarang (OD-16). Dibuka lagi dengan menghapus satu tanda.

**Menjaga yang lama**

- **MC17.** Dokumen lama diisi migrasi: currency IDR, kurs 1, `base_x = x`. Tidak ada angka yang berubah.
- **MC18.** `db:reconcile` membuktikan: dokumen IDR punya `base = nominal`; saldo dasar item = jumlah entrinya; item dengan saldo valas 0 punya saldo dasar 0; akun Piutang / Hutang / Uang Muka di General Ledger = jumlah saldo dasar item; total selisih kurs baris = akun Selisih Kurs.

---

## 4. Perubahan per lapisan

### 4.1 Master dan pengaturan

| Perubahan | Rincian |
| --- | --- |
| **Kurs** (baru, Master › Referensi) | Satu menu, `ref_exchange_rate`: currency, **tipe** (Transaksi; Penutup di tahap 9; KMK saat modul Pajak dibuka), tanggal, kurs ke IDR (MC6) |
| Partner | Currency Default di tab Penjualan dan Pembelian (OD-11) |
| Cash & Bank | Tidak berubah: currency per resource sudah ada |
| Account Mapping | Tidak berubah: *Account Selisih Kurs* dipakai (OD-8) |

### 4.2 Skema: kolom `base_`

Aturan penamaan: setiap kolom uang `x` mendapat pasangan `base_x` dengan tipe `Decimal(18,2)`.
Header dokumen mendapat `currency_id` dan `exchange_rate`. Daftar kolom persis per tabel ditulis
di migrasi tiap tahap dan di `DBML/erp.dbml.md`.

| Tabel | Tambahan |
| --- | --- |
| `sal_customer_order(_line)` | `currency_id`, `exchange_rate`; `base_` untuk bruto, diskon, DPP, PPN, total |
| `fin_ar_advance` | `currency_id` saja: tagihan tidak melahirkan nilai dasar; nilai dasar uang muka ada di item AR yang lahir dari pembayaran (MC9) |
| `fin_ar_invoice(_line, _advance_deduction)` | `currency_id` (tanpa `exchange_rate`: nilai dasar diwarisi, MC8); `base_` semua nominal; nilai dasar Uang Muka yang dipakai |
| `pur_order(_line)` | seperti Customer Order |
| `log_receipt_note(_line, _tracking)` | Tidak ada kolom baru: nilainya sudah rupiah, kini dihitung dari `base_` PO |
| `fin_ap_advance` | `currency_id` saja, seperti `fin_ar_advance` |
| `fin_ap_invoice(_line, _advance_deduction)` | seperti Invoice Penjualan |
| `fin_ar_item`, `fin_ap_item` | `base_original_amount`, `base_current_balance` |
| `fin_ar_ledger`, `fin_ap_ledger` | `base_movement` |
| `fin_cash_bank_tx` | `currency_id` dokumen, `exchange_rate` (kurs terima / kurs bank) |
| `fin_cash_bank_tx_line(_wht)` | `base_settled_amount`, `transaction_base_amount`, `fx_difference` |

Tidak disentuh: `tax_faktur(_line, _ref)`, `tax_withholding_slip` (MC15), Sales Order, Delivery Order, Delivery Note (tanpa harga), buku stok, buku produksi, Perizinan.

### 4.3 Mesin dan buku

| Modul | Perubahan |
| --- | --- |
| `fx.ts`, `currency.ts` | Dipakai apa adanya |
| `sales-tax.ts` | Pembulatan mengikuti currency (2 desimal valas, rupiah utuh IDR); fungsi konversi baris ke dasar |
| `ar-item.ts`, `ap-item.ts` | Setiap penulis entri menerima dan menulis gerakan dasar; pelepasan lewat `relieve` |
| `cash-bank-tx.ts`, `cash-payment.ts` | Penolakan "Hanya kas & bank Rupiah" dicabut; kernel `settle` per baris; baris jurnal selisih kurs |
| `tax-document.ts` | Tidak diubah. Hook `afterPost` dilewati untuk dokumen valas (OD-16) |
| `kurs.ts` (baru) | Mencari kurs per tipe dan tanggal untuk usulan di Customer Order dan Purchase Order |
| `nav.ts` | `NavModule.hidden` dan `TAX_MODULE_HIDDEN`: modul yang ditandai tidak tampil di rail dan beranda; permission-nya tetap ada di matriks role (MC19) |
| `journal.ts` | Tidak berubah: baris jurnal sudah membawa currency dan kurs |
| `cash-bank.ts` | Tidak berubah: rata-rata bergerak sudah ada |

---

## 5. Dampak per menu

| Modul | Menu | Dampak |
| --- | --- | --- |
| Master | Kurs | **Baru**, satu menu bertipe (Transaksi dulu) |
| Master | Partner | Field Currency Default |
| Master | Cash & Bank | Kartu buku menampilkan kurs rata-rata (sudah ada, diperiksa) |
| Penjualan | Customer Order | Pilih Currency dan Kurs di header; kotak total menampilkan nominal dokumen dan setara IDR |
| Penjualan | Sales Order, Delivery Order | Tidak berubah |
| Pembelian | Purchase Request | Tidak berubah |
| Pembelian | Purchase Order | Pilih Currency dan Kurs; setara IDR |
| Persediaan | Receipt Note | Nilai masuk = bagian `base_` PO; layar tidak berubah |
| Persediaan | Delivery Note, BSTB Issue, laporan stok | Tidak berubah |
| Finance | Uang Muka Penjualan / Pembelian | Currency mengikuti order; rekening pembayaran boleh bank currency itu |
| Finance | Invoice Penjualan | Currency dan nilai dasar mengikuti order; jurnal dalam valas + dasar; selisih kurs saat memakai Uang Muka |
| Finance | Invoice Pembelian | Sama; nilai dasar baris diwarisi dari Receipt Note; toleransi selisih tagihan (OD-7) |
| Finance | Penerimaan, Pengeluaran | Resource valas diizinkan; field kurs muncul sesuai MC11; *Pilih Tagihan* menyaring satu currency; kotak total dan *Dampak Transaksi* per currency; baris jurnal selisih kurs di konfirmasi Posting |
| Finance | Penukaran Valas | **Baru** (Kas & Bank): Pembelian Valas dan Pencairan Valas, permission `CASH_EXCHANGE_*` |
| Finance | Buku / Saldo / Umur Piutang dan Hutang, Uang Muka Customer / Supplier | Dikelompokkan per currency, kolom setara IDR; pencocokan ke General Ledger memakai saldo dasar |
| Finance | Buku dan Saldo Kas & Bank | Tidak berubah |
| Pajak | Faktur Pajak, Bukti Potong | **Disembunyikan** (MC19); halaman, permission dan data tetap |
| Finance | Penerimaan, Invoice Penjualan | Tautan Referensi ke dokumen pajak dan NSFP disembunyikan bersama modulnya |
| Accounting | Journal, General Ledger | Tidak berubah; jurnal dokumen valas kini muncul dengan currency-nya |
| Accounting | Trial Balance, Laba Rugi, Neraca | Tidak berubah (membaca nominal dasar) |
| Accounting | Account Mapping | Tidak berubah |
| Pengaturan | System Default | Tidak berubah |
| Aplikasi Produksi, ERP › Produksi, Perizinan | semua | Tidak berubah |

---

## 6. Tahapan

Setiap tahap berakhir dengan `build`, `lint`, `test`, pemeriksaan di browser, lalu berhenti untuk
review pengguna. Tahap 1–2 tidak mengubah satu angka pun.

| # | Tahap | Isi | Selesai bila |
| --- | --- | --- | --- |
| 0 | Keputusan | Menjawab §8 (OD-1, 2, 3, 5, 10 sudah); catat di §12 | Semua OD terjawab |
| 1 | Master dan sembunyikan Pajak | Modul Pajak disembunyikan (MC19); menu Kurs bertipe, permission, Currency Default di Partner | **Selesai 12/11/2026.** Kurs bisa diisi; belum dipakai dokumen |
| 2 | Fondasi skema | Kolom `currency_id`, kurs dan `base_` di semua tabel §4.2 dengan isi MC17; AR / AP item dan bukunya menulis gerakan dasar; cek MC18 di `db:reconcile` | **Selesai 13/11/2026.** Semua tes lama lulus; reconcile setuju (78 cek) |
| 2a | Penukaran Valas | Dokumen Pembelian Valas dan Pencairan Valas (MC11a) | **Selesai 13/11/2026 (P272).** Bank USD terisi dari bank IDR; pencairan memposting selisih kurs; reconcile setuju (79 cek). `maySettle` dipersempit di tahap 4, bersama pemanggil pertamanya; biaya bank belum ada |
| 3 | Penjualan valas | Customer Order, Uang Muka Penjualan, Invoice Penjualan dalam USD; semua baris jurnal pada kurs order; tanpa faktur pajak | Invoice USD terposting; Piutang di GL = saldo dasar item |
| 4 | Penerimaan valas | Penerimaan dari Customer untuk tagihan USD ke bank USD; `maySettle` dipersempit ke currency sama; selisih kurs; PPh pada kurs terima, tanpa Bukti Potong | Skenario lampiran konsep tanpa langkah bank IDR menjadi tes dan lulus |
| 5 | Pembelian valas | Purchase Order, Receipt Note mewarisi, Uang Muka Pembelian, Invoice Pembelian | *Barang Diterima Belum Ditagih* habis persis pada kurs PO |
| 6 | Pengeluaran valas | Pembayaran ke Supplier dari bank USD pada rata-ratanya; selisih kurs | Bank USD berkurang pada rata-ratanya; reconcile setuju |
| 7 | Laporan | Laporan piutang, hutang dan uang muka per currency dengan setara IDR; XLSX yang sudah ada mengikuti | Tiap laporan cocok dengan GL |
| 8 | Penutup | Showcase USD, `Script Penjelasan`, DBML, `KNOWLEDGE.md` (harvest), migrasi Neon | Neon siap direview |
| 9 | Revaluasi akhir periode (opsional, OD-9) | Dokumen Revaluasi untuk Piutang, Hutang dan bank valas pada kurs penutup | Diputuskan terpisah |

Ketergantungan: 1 → 2 → 2a → (3 → 4) dan (5 → 6) → 7 → 8. Tahap 2a hanya butuh tahap 1 (Kas & Bank sudah punya kolom dasar), jadi bisa dikerjakan paralel dengan tahap 2. Jalur penjualan dan pembelian tidak saling menunggu setelah tahap 2.

---

## 7. Risiko yang diketahui

- **Luas perubahan.** Tahap 2 menyentuh ±15 tabel dan dua buku. Karena itu ia tidak mengubah perilaku, hanya menambah kolom dan mengisinya.
- **P113 / P118.** PPN Uang Muka yang dikurangkan Invoice dibukukan pada rupiah saat uang muka diterima, bukan pada kurs Invoice (OD-4), supaya PPN Keluaran per uang muka habis persis. Rupiah PPN di jurnal bisa berbeda dari rupiah KMK di faktur pajak nanti; dibahas saat modul Pajak dibuka.
- **Tagihan USD hanya bisa dilunasi dari / ke bank USD.** Pelanggan yang mentransfer rupiah atas invoice USD belum bisa dicatat sampai pelunasan lintas currency dibuka.
- **Kode branch P105 sudah usang.** Hanya gagasan dan tesnya yang dipakai.

---

## 8. Open discuss

Setiap butir adalah asumsi yang dipakai plan ini sampai dijawab.

| # | Pertanyaan | Asumsi plan (rekomendasi) | Alternatif |
| --- | --- | --- | --- |
| OD-1 | Kurs mana yang melahirkan Piutang? | **Diputuskan 12/11/2026 (jawaban A): ikuti konsep.** Kurs Customer Order dibawa sampai Invoice, seperti pembelian. Deviasi dibahas lagi bila muncul pertanyaan baru | Kurs Invoice Penjualan sendiri (tidak dipakai) |
| OD-2 | Dari mana usulan kurs dokumen? | **Diputuskan 12/11/2026: hibrida** (MC6). Menu Kurs bertipe sebagai usulan untuk Customer Order dan Purchase Order, bisa diubah di dokumen; Penutup hanya dari menu; kurs kas tidak pernah dari menu | Tanpa menu Kurs transaksi, selalu diketik (tidak dipakai) |
| OD-3 | PPN dan PPh valas dibukukan pada kurs apa? | **Diputuskan 12/11/2026: kurs transaksi** (MC16). Kurs jurnal sama dengan kurs dokumen untuk semua komponen; tanpa Kurs KMK | Opsi 1, komponen pajak pada Kurs KMK (dibatalkan) |
| OD-4 | PPN uang muka yang dikurangkan Invoice (P113, Dr PPN Keluaran) dibukukan pada rupiah apa? | Rupiah yang dikreditkan saat uang muka diterima (kurs terima); PPN Keluaran per uang muka habis persis. Faktur pelunasan menyusul bersama modul Pajak | KMK tanggal Invoice; dicek ke konsultan pajak sebelum modul Pajak dibuka |
| OD-5 | Bolehkah satu Penerimaan / Pengeluaran berisi tagihan IDR dan USD? | **Diputuskan 12/11/2026:** tidak, dan tagihan harus satu currency dengan Kas & Bank-nya (MC11, MC14) | Pelunasan lintas currency, nanti |
| OD-6 | PPh pada tagihan USD: bagaimana menutup tagihan? | PPh dihitung dalam USD untuk menutup tagihan, dibukukan pada kurs terima Penerimaan; bedanya ke Selisih Kurs baris itu. Bukti Potong menyusul bersama modul Pajak | Pelanggan dianggap memotong dalam rupiah, diketik manual |
| OD-7 | Toleransi Selisih Tagihan Supplier (Rp 100) untuk invoice USD? | Dibandingkan dalam nominal dasar (rupiah) | Toleransi sendiri per currency |
| OD-8 | Satu akun Selisih Kurs, atau laba dan rugi dipisah? | Satu akun yang sudah ada | Dua akun; terealisasi dan belum terealisasi dipisah saat tahap 9 |
| OD-9 | Revaluasi akhir periode dibangun sekarang? | Belum; tahap 9 diputuskan setelah tahap 8. Uang Muka tidak direvaluasi (konsep §6.1) | Dibangun bersama, dari bahan branch P105 |
| OD-10 | Transfer IDR ↔ USD ikut plan ini? | **Diputuskan 12/11/2026:** ya, sebagai Penukaran Valas (tahap 2a, MC11a). Transfer satu currency (C14) tetap di luar | — |
| OD-11 | Currency Default per Partner perlu? | Ya, satu field opsional per sisi, hanya mengisi awal dokumen | Tidak ada; dokumen mulai di IDR |
| OD-12 | Biaya Bank pada transaksi valas dalam currency apa? | Currency resource Kas & Bank | Selalu rupiah |
| OD-13 | Harga satuan valas berapa desimal? | Tetap `Decimal(18,6)` (P111); nominal baris dua desimal | — |
| OD-14 | Nomor dokumen valas punya seri sendiri (seperti `-NP`)? | Tidak; seri sama | Seri `-USD` |
| OD-16 | Selama modul Pajak tersembunyi, apakah posting IDR tetap membuat Faktur Pajak dan Bukti Potong? | Ya, seperti sekarang, supaya tidak ada celah data saat dibuka lagi; dokumen valas tidak membuat apa pun | Hook dimatikan untuk semua dokumen selama proses |
