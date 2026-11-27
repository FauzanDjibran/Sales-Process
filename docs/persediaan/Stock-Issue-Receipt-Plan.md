# Stock Issue dan Stock Receipt: Dua Menu Bertujuan Banyak

> **Disetujui user 27/11/2026 (P339), semua keputusan §6 sesuai usulan. Belum dibangun.** Dasar: `main` @ `a667ca6`,
> `stock-issue-purposes.ts`, `stock-issue-workflow.ts`, `stock-receipt-purposes.ts`,
> `stock-receipt.ts`, `Goods-Movement-Plan.md` (P316–P318), P321, P324, P319.
> Pemicunya: user bertanya kenapa Stock Receipt tidak punya tombol Buat. Konsep user: Stock
> Receipt dibuat oleh gudang, dengan memilih dokumen yang diterima.

## 1. Ringkas

1. **Keduanya satu bentuk.** Stock Issue = barang keluar gudang tanpa partner. Stock Receipt =
   barang masuk gudang tanpa partner. Masing-masing punya katalog tujuan di kode (P106), dan
   tujuan itu yang menentukan sumber, langkah, nilai dan jurnal. Produksi hanya salah satu tujuan.
2. **Setiap dokumen dibuat dari menunya sendiri dengan *Buat*.** Pengguna memilih tujuan dulu.
   Kalau tujuan itu punya sumber, pilih sumbernya; kalau tidak, barang diketik.
3. **Stock Issue sudah begitu.** Yang berubah hanya Stock Receipt. Sekarang ia tidak pernah
   dibuat pengguna: dibuat Kirim dari produksi atau posting Receipt Note.
4. **Tujuan baru yang diusulkan:** *Penerimaan Lain-lain* di Stock Receipt. Cerminnya di Stock
   Issue, *Pengeluaran Lain-lain*, menjadi pilihan (§6, SI-4).

## 2. Satu bentuk untuk dua menu

Setiap tujuan menyatakan tujuh hal. Tujuh hal ini sama untuk Issue dan Receipt.

| Hal | Arti | Contoh |
| --- | --- | --- |
| **Sumber** | Dokumen yang menjadi dasar, atau tidak ada | Production Issue, Receipt Note, tidak ada |
| **Pihak lain** | Siapa yang mengirim atau menerima | Unit, tidak ada |
| **Langkah** | Siklus dokumen | Draft → Posting, Draft → Kirim → Diterima |
| **Nilai** | Asal nilai barang | Rata-rata saat keluar, dibawa sumber, 0, diketik |
| **Jurnal** | Akun lawan Persediaan | WIP, Beban per tujuan, akun Account Mapping |
| **Nomor** | Seri | `BSTB_…`, `BFG_…` harian per Unit; `SIS/…`, `SRC/…` bulanan |
| **Barang** | Dari mana barisnya | Dipilih dari stok (Issue), dari sumber, atau diketik |

Aturan bersama tidak berubah: posting menggerakkan stok per No. Stok lewat `issueStock` /
`receiveStock` (P120); tiap tujuan memasang postingnya sendiri (P268); akses per gudang (P301);
periode ditahan dalam transaksi (P222); konfirmasi menampilkan jurnal lewat dry run (P103).

## 3. Katalog tujuan

### 3.1 Stock Issue (sudah ada, tidak berubah)

| Tujuan | Sumber | Pihak lain | Langkah | Nilai | Jurnal |
| --- | --- | --- | --- | --- | --- |
| BSTB Issue · Bahan ke Produksi | — | Unit pertama routing | Draft → Kirim → Diterima | Rata-rata saat Kirim | Dr WIP / Cr Persediaan |
| BSTB Issue · Bahan Penolong | — | Unit mana pun | sama | sama | sama |
| Pemusnahan | — | — | Draft → Posting | Rata-rata | Dr Beban Pemusnahan / Cr Persediaan |
| Pengambilan Sampel | — | — | Draft → Posting | Rata-rata | Dr Beban Pengambilan Sampel / Cr Persediaan |
| *calon:* Pengeluaran Lain-lain | — | — | Draft → Posting | Rata-rata | Dr akun Account Mapping / Cr Persediaan |

### 3.2 Stock Receipt (usulan)

| Tujuan | Sumber | Pihak lain | Langkah | Nilai | Jurnal |
| --- | --- | --- | --- | --- | --- |
| BSTB ke Finish Goods | Production Issue yang menunggu | Unit akhir line | Draft → Terima → Diterima | Dibawa sumber | Dr Persediaan / Cr WIP |
| BSTB Pengeluaran | Production Issue yang menunggu | Unit mana pun | sama | Mengikuti sumber: *Nilai terbawa* atau *Tanpa nilai*, dipilih Unit saat Kirim | Terbawa: Dr Persediaan / Cr WIP. Tanpa nilai: stok masuk 0, Dr Beban Pemusnahan Produksi / Cr WIP |
| Bonus Pembelian | Receipt Note Diposting yang bonusnya belum diterima | (supplier, sebagai sumber lot) | sama | 0 | tidak ada |
| **Penerimaan Lain-lain** (baru) | — | — | Draft → Posting → Diposting | Diketik per No. Stok | Dr Persediaan / Cr akun baru *Penerimaan Stok Lain-lain* |
| *calon:* Stok Awal | — | — | Draft → Posting | Diketik | Dr Persediaan / Cr akun pembuka (pengganti `db:stock-inject`) |

**Calon tidak dibangun tanpa instruksi** (C34).

### 3.3 Nilai ditentukan tujuan, bukan pengguna

Setiap tujuan menyatakan **aturan nilai** di katalognya (`valueRule`). Form mengikuti aturan itu:
kolom Nilai tampil terkunci, atau terbuka untuk diisi. Server memakai aturan yang sama dan
mengabaikan nilai yang dikirim form bila aturannya bukan *Diketik*.

| Aturan | Arti | Di form | Tujuan |
| --- | --- | --- | --- |
| **Rata-rata** | Nilai keluar = round(V × q ÷ Q) saat posting (P114) | Tidak ada kolom Nilai; jurnal di konfirmasi | Semua tujuan Stock Issue |
| **Dari sumber** | Nilai beku yang dibawa dokumen sumber; termasuk 0 bila sumber menyatakan *Tanpa nilai* (§5.1) | Terkunci, terisi dari sumber | BSTB ke Finish Goods, BSTB Pengeluaran |
| **Nol** | Selalu 0; tanpa jurnal | Terkunci 0 | Bonus Pembelian |
| **Diketik** | Diisi pengguna per No. Stok, wajib, ≥ 0 | Terbuka | Penerimaan Lain-lain, *calon* Stok Awal |

Jadi pengguna Stock Receipt tidak pernah memilih *bernilai atau tidak*. Pilihan itu sudah melekat
di tujuannya, atau di dokumen sumbernya.

## 4. Alur Buat Stock Receipt

1. *Buat Stock Receipt* → pilih **Gudang** (hanya gudang milik pengguna) dan **Tujuan**.
2. **Tujuan bersumber** → *Pilih Sumber* menampilkan yang menunggu untuk gudang itu:
   - Dari produksi: Production Issue yang dikirim ke gudang itu dan belum diterima, dengan Unit,
     tanggal kirim, jumlah No. Stok dan gram.
   - Bonus: Receipt Note Diposting di gudang itu yang `qty_bonus`-nya belum diterima.

   Satu sumber per dokumen, diterima **utuh** (W57). Baris terisi dari sumber dan tidak bisa
   diubah jumlahnya. Yang diisi gudang: lokasi (bila gudang punya lokasi) dan status stok per No.
   Stok, nomor lot dan kadaluarsa untuk bonus. **Gudang tidak memilih nilai.** Stock Receipt
   hanya menerima nilai yang dibawa sumbernya (§5.1).
3. **Tujuan tanpa sumber** (Penerimaan Lain-lain) → baris diketik: barang (Kelola Stok saja),
   No. Stok baru (W10), kadaluarsa, lokasi, status, qty dasar, nilai. **Alasan wajib.**
4. **Simpan Draft** atau **Simpan & Terima / Posting** (P309). Draft memegang sumbernya: satu
   sumber hanya boleh ada di satu Stock Receipt hidup.
5. **Terima / Posting**: stok masuk, jurnal ditulis, sumber ditandai diterima (untuk produksi,
   lewat pesan `ReceiptReceived`). Final. **Batalkan** hanya Draft, dengan alasan, dan
   mengembalikan sumbernya ke daftar menunggu.

**Register**: semua Stock Receipt (Draft, Diterima, Diposting, Dibatalkan), filter Tujuan dan
Status. Di atasnya kartu **Menunggu Diterima**: jumlah kiriman produksi dan bonus yang belum
dibuatkan Stock Receipt, membuka *Buat* dengan tujuannya.

## 5. Yang berubah dari sekarang

| Hal | Sekarang | Usulan |
| --- | --- | --- |
| Siapa membuat Stock Receipt | Kirim produksi (`takeReceiptSent`), posting Receipt Note (`createBonusReceipt`) | Gudang, lewat *Buat* |
| Siklus | Dalam Perjalanan → Diterima | Draft → Terima / Posting → Diterima / Diposting; Batalkan Draft |
| Bonus | Masuk stok otomatis saat Receipt Note diposting (P321) | Menunggu di Receipt Note sampai gudang menerimanya |
| Penerimaan umum | Tidak ada | Penerimaan Lain-lain |
| Nilai BSTB Pengeluaran | Dipilih gudang saat Terima (P304) | Dipilih Unit di Production Issue saat Kirim; Stock Receipt mengikutinya (§5.1) |
| Izin | `STOCK_RECEIPT_VIEW`, `_RECEIVE` | tambah `_CREATE`, `_EDIT`, `_CANCEL`; `_RECEIVE` tetap untuk Terima / Posting |
| Account Mapping | — | *Penerimaan Stok Lain-lain* (`stock_other_receipt_account`), di starter chart |

### 5.1 Nilai ditentukan pengirim, penerima hanya menerima

Yang tahu barang itu reject, sisa, atau masih layak adalah Unit, bukan gudang. Karena itu
**pilihan nilai pindah ke Production Issue** (BSTB Pengeluaran), di form Kirim, dengan alasannya:

| Pilihan di Production Issue | Arti | Yang terjadi saat gudang Terima |
| --- | --- | --- |
| **Nilai terbawa** | Barang masih bernilai | Stok masuk senilai yang dibekukan saat Kirim; Dr Persediaan / Cr WIP |
| **Tanpa nilai** | Barang tidak bernilai lagi | Stok masuk bernilai 0 (menurunkan rata-rata barang, W106); nilainya Dr Beban Pemusnahan Produksi / Cr WIP |

- Pilihan ikut tersalin dalam pesan `ReceiptSent` (kolom `value_mode` pindah ke salinan kiriman).
  Stock Receipt membacanya dan **tidak bisa mengubahnya**. Konfirmasi Terima hanya menyebut
  pilihan itu dan jurnalnya.
- **Jurnal tetap ditulis ERP saat Terima** (aturan 5, `Goods-Movement-Plan.md` §4). Produksi hanya
  menyatakan pilihannya, tanpa angka.
- Layar produksi tetap tanpa harga (P275): Unit memilih *bernilai / tidak bernilai*, bukan angka.
- BSTB ke Finish Goods selalu *Nilai terbawa*; pilihan hanya ada di BSTB Pengeluaran.
- Pola yang sama berlaku untuk tujuan bersumber lain: **nilai selalu tersirat dari sumbernya**.
  Bonus = 0 karena tidak ditagih. Hanya Penerimaan Lain-lain yang nilainya diketik di Stock
  Receipt, karena tidak punya sumber.

### 5.2 Kiriman produksi menunggu di mana

ERP tidak boleh membaca tabel produksi (§3.1, `tests/module-boundaries.test.ts`). Jadi kiriman
yang menunggu tetap harus ada di sisi ERP. Ini persis konsep P319: dokumen pengirim **disalin ke
sisi penerima**, dan dokumen penerima dibuat dari salinan itu.

- **Usulan (SR-2 A):** satu database dulu, tanpa tabel baru. `ReceiptSent` tetap mencatat
  kiriman, tetapi sebagai **salinan yang menunggu**, bukan Stock Receipt. Wujudnya: tabel
  `log_stock_receipt_inbox(_line)` kecil berisi nomor, Unit, gudang, tujuan, dan per No. Stok
  qty, gram, nilai beku. *Buat* membaca dari sana. Saat database dipisah, tabel ini tetap.
- Pilihan lain (B): baris `log_stock_receipt` berstatus *Menunggu* tetap dibuat Kirim, dan *Buat*
  hanya membukanya. Tanpa tabel baru, tetapi dokumennya tetap lahir di produksi, bukan di gudang,
  jadi tidak sesuai konsep user. P319 ("tanpa tabel replika") perlu diubah bila A dipilih.

## 6. Keputusan yang diminta

| # | Pertanyaan | Usulan |
| --- | --- | --- |
| SR-1 | Stock Receipt selalu dibuat gudang lewat *Buat*, untuk semua tujuan | Ya |
| SR-2 | Tempat kiriman produksi menunggu | A: tabel salinan `log_stock_receipt_inbox` (mengubah P319) |
| SR-3 | Bonus Pembelian menunggu sampai gudang membuat Stock Receipt (mengubah P321) | Ya, dengan kartu Menunggu Diterima agar tidak terlupa |
| SR-4 | Tujuan Penerimaan Lain-lain dengan satu akun lawan di Account Mapping | Ya |
| SR-5 | Stock Receipt punya Draft | Ya, seperti Stock Issue |
| SR-6 | Nilai BSTB Pengeluaran dipilih Unit di Production Issue saat Kirim; Stock Receipt hanya menerima (mengubah P304) | Ya — arahan user 27/11/2026 |
| SR-7 | Aturan nilai melekat pada tujuan: Rata-rata, Dari sumber, Nol, Diketik (§3.3) | Ya — arahan user 27/11/2026 |
| SI-4 | Cermin di Stock Issue: Pengeluaran Lain-lain | Nanti, bila diminta. Pemusnahan dan Sampel sudah menutup kebutuhan sekarang |
| PR-1 | Production Receipt di sisi produksi mengikuti pola yang sama (Unit *Buat* dari Stock Issue yang menunggu, bukan lahir saat Kirim) | Ditunda. Unit bekerja dari Workspace, dan tombol Terima di tab Masuk sudah seperti itu bagi pengguna |

## 7. Langkah bangun (setelah disetujui)

1. Katalog tujuan: `valueRule` per tujuan di `stock-receipt-purposes.ts` (menggantikan
   `asksValue`). Skema: status Draft / Cancelled, `status_reason`, `reason`, tabel inbox; migrasi memindahkan
   Stock Receipt *Dalam Perjalanan* yang ada ke inbox.
2. `ReceiptSent` menulis inbox, membawa pilihan nilai dari Production Issue; form Kirim BSTB
   Pengeluaran di Workspace mendapat pilihan *Nilai terbawa / Tanpa nilai*; `createBonusReceipt`
   berhenti dipanggil Receipt Note.
3. Form *Buat* per tujuan, simpan, Terima / Posting, Batalkan; register dengan kartu Menunggu.
4. Penerimaan Lain-lain: Account Mapping, starter chart, posting.
5. `db:reconcile`: inbox yang diterima = Stock Receipt Diterima; bonus diterima ≤ `qty_bonus`;
   Penerimaan Lain-lain berjurnal sebesar nilainya.
6. Tes per tujuan; `Script Penjelasan` dan `Claude-ERP.md` §12.
