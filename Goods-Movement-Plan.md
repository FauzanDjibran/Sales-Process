# Pergerakan Barang: Stock Issue, Stock Receipt dan Batas Dua Database

> **Usulan 23/11/2026, menunggu keputusan user (§9). Belum ada yang dibangun dan belum ada keputusan yang berubah.**
> Dasar: kode `main` @ `413d735` (`stock-issue.ts`, `production-receipt.ts`, `production-transfer.ts`,
> `production-ledger.ts`, `inventory.ts`), `production_app_plan.md` §2.2, §5, §8,
> `Stock-Transfer-Plan.md`, `Produksi Walet (Real).md` (PWR).

## 1. Jawaban singkat

1. **Bisa dibuat generik: dua menu, Stock Issue dan Stock Receipt.** Ke dan dari produksi menjadi *tujuan* (purpose). Tiga menu hari ini (BSTB Issue, BSTB ke Finish Goods, BSTB Pengeluaran) menjadi dua. Receipt Note, Delivery Note dan Transfer tetap sendiri (§3).
2. **Gudang punya dua menu dan produksi satu `prd_transfer` karena keduanya menjawab hal yang berbeda.** `prd_transfer` memindahkan barang di dalam satu buku. Stock Issue dan Receipt masing-masing hanya **separuh** perpindahan; separuh lainnya ada di buku produksi (§2).
3. **Kekurangan sebenarnya ada di sisi produksi.** Produksi tidak punya dokumen untuk separuhnya: serah terima ditulis langsung ke tabel ERP. Dengan dua database itu tidak bisa jalan. Usul: dua dokumen sendiri, **Production Receipt** (masuk) dan **Production Issue** (keluar), cermin Stock Issue dan Stock Receipt; `prd_transfer` tetap hanya Unit → Unit (§5).
4. **Satu aturan untuk semua perpindahan: Kirim mengeluarkan dan membekukan nilai, Terima memasukkan.** Barang yang di jalan dicatat di sisi pengirim. Jurnal serah terima selalu ditulis ERP dalam transaksinya sendiri (§4).
5. **Titik terpenting: BSTB Issue harus berjurnal saat Kirim, bukan saat Terima.** Dengan aturan sekarang di dua database, nilai ERP dan produksi melenceng di seluruh simulasi (§6).

## 2. Kenapa gudang dua menu, produksi satu

### 2.1 Yang berjalan sekarang

| Perpindahan | Dokumen | Buku yang bergerak | Siapa menulis | Jurnal |
| --- | --- | --- | --- | --- |
| Unit → Unit | `prd_transfer`, satu dokumen | Produksi saja (keluar dan masuk) | Unit asal, Unit tujuan | Tidak |
| Gudang → Gudang | `log_stock_transfer` + `_receipt`, dua dokumen | Stok saja (keluar dan masuk) | Gudang asal, Gudang tujuan | Tidak |
| Gudang → Unit | `log_stock_issue`, satu dokumen di ERP | Stok **dan** produksi, satu transaksi | Gudang mengajukan, **Unit menerima** | Saat Terima, tanggal dokumen |
| Unit → Gudang | `log_production_receipt`, satu dokumen di ERP | Produksi **dan** stok, satu transaksi | **Unit membuat**, Gudang menerima | Saat Terima, tanggal Terima |

### 2.2 Alasannya

Jumlah dokumen ditentukan tiga pertanyaan, bukan oleh logistik atau produksinya.

| Pertanyaan | Unit → Unit | Gudang → Gudang | Gudang ↔ Unit |
| --- | --- | --- | --- |
| Satu buku atau dua? | Satu | Satu | **Dua** |
| Boleh diterima bertahap? | Tidak, tepat isi dokumen (W57) | Ya, jadi Terima perlu dokumen sendiri | Tidak (W57) |
| Ada jurnal? | Tidak | Tidak | Ya, Persediaan ↔ WIP |
| **Akibat** | 1 dokumen, 2 langkah | 2 dokumen | **1 dokumen di tiap sisi** |

- Pembanding `prd_transfer` di gudang adalah **Transfer**, bukan Issue dan Receipt.
- Pembanding Issue dan Receipt di produksi **belum ada**. Dalam satu database hal ini tertutupi karena Unit boleh menulis tabel ERP langsung.
- Produksi cukup satu tabel dan satu register, karena orang lantai bekerja dari Workspace. Gudang memisah menu karena orang, izin, urutan kerja dan efek stoknya berbeda.

### 2.3 Tujuh tempat yang putus bila database dipisah

| # | Temuan di kode | Akibat dengan dua database |
| --- | --- | --- |
| T1 | Terima BSTB Issue menggerakkan stok, jurnal dan produksi dalam satu transaksi | Tidak ada transaksi lintas database |
| T2 | Kirim BFG/BPG membuat baris di `log_production_receipt`, tabel ERP | Produksi tidak bisa menulis ke ERP |
| T3 | Baris receipt menyimpan `from_bucket_id` dan `transit_bucket_id`; baris issue menyimpan `prd_bucket_id` | Id baris database lain tidak bermakna |
| T4 | No. Stok satu register (`log_stock_tracking`); grading dan kotak mendaftar langsung ke sana | Dua penerbit nomor |
| T5 | Lima dokumen produksi memanggil `postJournal` sendiri: Grading, Pengerjaan, Kerja, Job Order, Kotak; `prd_cost_entry` juga milik ERP | Produksi tidak punya buku jurnal |
| T6 | Produksi bertanya ke periode fiskal (`holdPostingPeriod`, `costedPeriodRefusal`) dan Standard Cost saat posting | Perlu salinan lokal |
| T7 | ERP membaca produksi: kunci BJL Item, kunci Routing dan proses Unit, penjaga tutup tahun, Unit pertama routing | Perlu penanda yang dikirim balik |

## 3. Stock Issue dan Stock Receipt yang generik

### 3.1 Garis batasnya

| Keluarga | Dokumen | Ciri |
| --- | --- | --- |
| Dengan partner | Delivery Note, Receipt Note | Punya pesanan sumber, alamat, HPP atau GR/IR, lalu ditagih |
| **Tanpa partner** | **Stock Issue, Stock Receipt** | Barang keluar atau masuk Persediaan karena sebab internal |
| Antar gudang | Transfer Kirim, Transfer Terima | Persediaan tidak berubah, tanpa jurnal |

**Tidak digabung dengan Delivery Note dan Receipt Note.** Penggabungan menghasilkan kolom partner, alamat dan sumber yang kosong di separuh baris, dan tetap dua posting berbeda. Bentuk usulan ini sama dengan ERPNext (Stock Entry *Material Issue / Receipt* terpisah dari Delivery Note dan Purchase Receipt). SAP memakai satu mesin movement type, tetapi pengiriman ke customer tetap dokumen Delivery. Business Central memisahkan Item Journal dari Shipment. Garis DN/RN ini dari pengetahuan umum; pembanding sisi produksi ada di §5.3.

### 3.2 Katalog tujuan

| Menu | Tujuan | Pihak lain | Langkah | Nilai | Jurnal |
| --- | --- | --- | --- | --- | --- |
| Issue | `production_issue` BSTB Issue, bahan | Unit pertama routing | Draft → Kirim → Diterima | Rata-rata saat Kirim | Dr WIP / Cr Persediaan |
| Issue | `auxiliary_issue` BSTB Issue, bahan penolong | Unit mana pun | sama | sama | sama |
| Receipt | `finish_goods` BSTB ke Finish Goods | Unit akhir line | Menunggu → Terima | Terbawa | Dr Persediaan / Cr WIP |
| Receipt | `return` BSTB Pengeluaran | Unit mana pun | Menunggu → Terima | Terbawa atau tanpa nilai | sama, atau Dr Beban Pemusnahan |
| Issue | *calon:* Pemakaian Internal, Pemusnahan | tidak ada | Draft → Posting | Rata-rata | Dr Beban / Cr Persediaan |
| Receipt | *calon:* Stok Awal (pengganti `db:stock-inject`) | tidak ada | Draft → Posting | Diketik | Dr Persediaan / Cr akun pembuka |
| Issue, Receipt | *calon:* Selisih Opname | tidak ada | dari dokumen hitung | Rata-rata | Dr/Cr Selisih Persediaan |

Empat baris pertama sudah ada perilakunya. **Calon tidak dibangun tanpa instruksi** (C34).

Katalog tetap di kode (P106) dan tiap tujuan punya postingnya sendiri (P268). Satu tujuan menyatakan: nama, pihak lain, langkah, sumber nilai, seri nomor, status stok yang boleh, izin Terima. Posting bersama hanya menggerakkan stok per lot dan menjumlahkan.

### 3.3 Tabel dan layar

| Hal | Sekarang | Usulan |
| --- | --- | --- |
| Issue | `log_stock_issue(_line, _tracking)` | Nama tetap; `unit_id` hanya diisi tujuan produksi; `unit_cost` dibuang (P213) |
| Receipt | `log_production_receipt(_line)` | Ganti nama di tempat menjadi **`log_stock_receipt(_line, _tracking)`**, pola P268: baris = barang, tracking = lot · lokasi · status |
| Gudang tujuan | Hanya gudang tanpa Lokasi | Gudang berlokasi boleh; **lokasi dan status dipilih saat Terima** |
| Nomor | `BSTB_`, `BFG_`, `BPG_` harian per Unit | Tetap untuk tujuan produksi; tujuan lain `SIS/` dan `SRC/YYYY/MM/NNNN` (P15) |
| Menu Operasi Gudang | 7 menu | 6: Receipt Note, Delivery Note, **Stock Issue**, **Stock Receipt**, Transfer Kirim, Transfer Terima. Register punya filter Tujuan; yang menunggu diterima di atas |
| Akses gudang | Hanya Transfer dan BFG/BPG | Issue memeriksa gudang asal, Receipt gudang tujuan (P301) |

Nama **BSTB Issue, BSTB ke Finish Goods, BSTB Pengeluaran** tetap dipakai sebagai nama tujuan dan judul dokumen, sehingga orang lapangan tidak kehilangan istilahnya. Yang berubah hanya menunya. Ini **mengubah P254** (*BSTB Issue menu keeps its name*; dokumen lain menu sendiri) dan menu P303 / P304.

## 4. Konsep pergerakan barang

**Lima aturan, sama di dalam dan antar database.**

1. **Barang selalu dihitung tepat satu kali.** Kirim mengeluarkannya dari saldo bebas pengirim; barang di jalan dihitung di sisi pengirim sampai Terima.
2. **Nilai dibekukan saat Kirim** dan dibawa dokumen. Penerima tidak menghitung ulang.
3. **Terima tepat isi dokumen** (W57), satu Kirim satu Terima. Bertahap hanya di Transfer gudang.
4. **Tiap buku hanya ditulis pemiliknya.** Sisi lain hanya menerima salinan dokumen, dikenali dari nomor, bukan id.
5. **Jurnal serah terima ditulis ERP dalam transaksi ERP sendiri:** Issue saat Kirim, Receipt saat Terima. Tidak pernah menunggu kabar produksi.

| Perpindahan | Kirim | Di jalan tercatat di | Terima | Jurnal |
| --- | --- | --- | --- | --- |
| Unit → Unit (Push) | keluar dan masuk sekaligus | tidak ada | langsung | tidak |
| Unit → Unit (BSTB) | Stand By → Dalam Perjalanan | bucket Unit pengirim | → Persiapan tujuan | tidak |
| Gudang → Gudang | stok → Gudang Transit | stok Gudang Transit | → gudang tujuan, boleh bertahap | tidak |
| **Gudang → Unit** | **stok keluar** | **dokumen Issue berstatus Dalam Perjalanan** | → Persiapan, No. Job lahir (W98) | **saat Kirim: Dr WIP / Cr Persediaan** |
| **Unit → Gudang** | Persiapan atau Stand By → Dalam Perjalanan | bucket Unit pengirim | stok masuk; bucket dikosongkan oleh kabar Terima | **saat Terima: Dr Persediaan / Cr WIP** |

**Persamaan yang selalu benar** dan menjadi cek `db:reconcile`:

```
WIP di GL = nilai di buku produksi (termasuk Dalam Perjalanan)
          + Issue yang sudah Kirim, belum diterima Unit
          − Receipt yang sudah diterima gudang, kabarnya belum sampai ke produksi
```

Suku ketiga selalu nol selama satu database.

**Yang berubah dari aturan sekarang**, hanya pada Gudang → Unit:

| Aturan | Sekarang | Usulan |
| --- | --- | --- |
| W20, P228 | Ajukan mengunci stok (`reserved_qty`), Terima menggerakkan | Kirim menggerakkan stok; `reserveStock`, `releaseReservation` dan `reserved_qty` dihapus karena hanya dipakai di sini |
| Jurnal | Saat Terima, bertanggal dokumen | Saat Kirim, bertanggal dokumen. Terima tanpa jurnal |
| WIP | Barang yang sudah diterima Unit | Termasuk barang yang sedang menuju Unit |
| Tanggal di buku produksi | Tanggal dokumen | Tanggal Terima, tidak sebelum Kirim |

## 5. Sisi produksi: tiga dokumen

> Direvisi 23/11/2026 atas masukan user. Usulan pertama (dua jenis baru di `prd_transfer`) ditarik: alasan yang memisahkan
> Delivery Note dari Stock Issue (§3.1) berlaku sama di sini, dan keluar masuk produksi punya banyak alasan.

| Dokumen | Tabel | Mengubah WIP? | Pasangan di ERP |
| --- | --- | --- | --- |
| **Production Receipt** | `prd_receipt(_line)` | Bertambah | Stock Issue |
| **Transfer** (Push, BSTB, BSTB Penyebaran) | `prd_transfer(_line)`, **tidak berubah** | Tetap | tidak ada |
| **Production Issue** | `prd_issue(_line)` | Berkurang | Stock Receipt, bila ada gudang |

### 5.1 Tujuan

| Dokumen | Tujuan | Dari / ke | Aturan sendiri |
| --- | --- | --- | --- |
| Receipt | Bahan | Gudang → Unit pertama routing | No. Job lahir saat Terima (W98) |
| Receipt | Bahan penolong | Gudang → Unit mana pun | Tanpa Job dan partai |
| Receipt | *calon:* Rework dari Finish Goods atau retur customer | Gudang → Unit yang dipilih | Silsilah ke kotak lama; partai dan rate ditentukan saat itu |
| Receipt | *calon:* Koreksi tambah (opname lantai) | tidak ada | Sumber nilai harus diputuskan |
| Issue | Finish Goods | Unit akhir line → Gudang | Stand By, utuh |
| Issue | Pengeluaran (reject, sisa, bahan penolong) | Unit mana pun → Gudang | Persiapan atau Stand By; nilai dipilih gudang |
| Issue | *calon:* Pemusnahan di tempat | Unit → **tidak ada** | Dr Beban; tidak ada gudang yang menerima |
| Issue | *calon:* Sampel lab, koreksi kurang | Unit → tidak ada | Akun beban per tujuan |

Baris tanpa gudang adalah alasan terkuat memisahkan: di `prd_transfer` keduanya tidak punya Unit tujuan sama sekali.

**Tujuan atau alasan?** Menjadi *tujuan* hanya bila posting, pihak lain, atau aturan pilih barangnya berbeda. Selain itu cukup kolom **alasan** (misalnya reject bulu, pecah, sisa produksi), supaya katalog tidak membengkak.

### 5.2 Bentuk

- Header: nomor, tanggal, Unit, tujuan, alasan, pihak lain (`counterpart_no`, `warehouse_code`, kosong bila tanpa gudang), status. Baris: No. Stok, Job, partai, qty, gram, nilai, bucket.
- Yang lahir lebih dulu adalah dokumen pengirim; dokumen penerima merujuk nomornya. Kolom `counterpart_no` unik per tujuan, sehingga salinan kembar ditolak.
- Dengan gudang: Receipt *Menunggu → Diterima*, Issue *Dalam Perjalanan → Diterima*. Tanpa gudang: *Draft → Posting*; jurnalnya lewat `ProductionPosted`.
- Tab **Masuk** di Workspace membaca Receipt dan Transfer yang menunggu; tab **Dalam Perjalanan** membaca Issue dan Transfer. Dua tabel digabung di satu pembaca (`unitBoard`), yang hari ini juga sudah menggabungkan BSTB Issue dan Transfer.
- Menu Produksi › Dokumen mendapat dua register. Operator tetap bekerja dari Workspace. Register *Push dan BSTB* tidak berubah.
- P275 tetap: nilai disimpan, tidak ditampilkan.

Biayanya dibanding usulan pertama: empat tabel, dua register dan dua kelompok izin tambahan. Imbalannya: tidak ada kolom Unit yang kosong, aturan routing tidak perlu pengecualian, dan tujuan baru tidak menyentuh Transfer.

### 5.3 Pembanding

| ERP | Masuk produksi | Di dalam produksi | Keluar produksi | Pelajaran |
| --- | --- | --- | --- | --- |
| **Oracle WIP** | *WIP component issue* (dan *return*) | *Move transaction* antar operasi; scrap adalah move ke langkah Scrap dengan akun scrap | *WIP assembly completion* (dan *return*) | Paling dekat dengan usulan ini: tiga keluarga transaksi |
| **SAP** | 261 pengeluaran ke order; di EWM *Production Material Request* | Konfirmasi operasi (dari pengetahuan umum) | 101 masuk hasil, 531 by-product, 551 scrap | Satu mesin, alasan dipisah kode gerakan. Di EWM, PMR tidak mencakup goods receipt, jadi masuk dan keluar dua alur |
| **Dynamics 365** | *Picking list journal* | *Route card* / *job card journal* | *Report as finished journal* | Tiap jenis kejadian punya jurnal sendiri |
| **Odoo** (3 langkah) | Transfer *Pick Components* (`WH/PC`) | Manufacturing / work order | Transfer *Store Finished Product* (`WH/SFP`) | Dua operation type terpisah dari MO |
| **ERPNext** | Stock Entry *Material Transfer for Manufacture* | Job Card | Stock Entry *Manufacture* | Satu doctype, dipisah purpose; kerja antar operasi tetap dokumen lain |

**Yang sama di kelimanya:** gerak antar operasi tidak satu dokumen dengan keluar masuk produksi. **Yang berbeda dari kita:** umumnya hanya gudang yang menyimpan buku stoknya, sehingga satu transaksi ERP cukup. Cermin dua sisi dibutuhkan di sini karena produksi punya buku sendiri dan kelak database sendiri; itu bukan pola umum di dalam satu ERP, melainkan pola integrasi dua sistem.

Sumber (hasil pencarian, dibaca ringkasannya, bukan halaman penuh):
[Oracle WIP](https://docs.oracle.com/cd/E18727_01/doc.121/e13678/T228107T228116.htm),
[SAP movement types](https://community.sap.com/t5/technology-blog-posts-by-members/sap-good-movement-types-list-of-sap-movement-types/ba-p/13551698),
[SAP EWM staging](https://blogs.sap.com/2021/07/02/staging-to-production-in-sap-extended-warehouse-management-overview/),
[Dynamics 365](https://learn.microsoft.com/en-us/dynamics365/supply-chain/production-control/tasks/report-production-order-finished),
[Dynamics production journals](https://technet.microsoft.com/EN-US/library/aa496978.aspx),
[Odoo](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing/basic_setup/three_step_manufacturing.html),
[ERPNext](https://docs.frappe.io/erpnext/stock-entry-purpose).

## 6. Simulasi

### 6.1 Satu putaran dengan angka

Stok STK-0001 10.000 g senilai Rp100.000.000. Issue 6.000 g ke UGH, lalu 2.000 g kembali sebagai BSTB Pengeluaran.

| Langkah | Stok ERP | WIP di GL | Buku produksi | Koreksi di jalan | Cocok |
| --- | --- | --- | --- | --- | --- |
| Awal | 10.000 g · 100 jt | 0 | 0 | 0 | ya |
| ERP Kirim Issue | 4.000 g · 40 jt | 60 jt | 0 | + Issue 60 jt | 60 = 0 + 60 |
| *Pembelian 4.000 g · 60 jt* (rata-rata 10.000 → 12.500) | 8.000 g · 100 jt | 60 jt | 0 | + Issue 60 jt | ya |
| Unit Terima | 8.000 g · 100 jt | 60 jt | 6.000 g · **60 jt** | 0 | 60 = 60 |
| Unit Kirim 2.000 g | 8.000 g · 100 jt | 60 jt | 6.000 g · 60 jt (2.000 g Dalam Perjalanan) | 0 | 60 = 60 |
| Gudang Terima, nilai terbawa 20 jt | 10.000 g · 120 jt | 40 jt | 60 jt, kabar belum sampai | − Receipt 20 jt | 40 = 60 − 20 |
| Kabar sampai | 10.000 g · 120 jt | 40 jt | 4.000 g · 40 jt | 0 | 40 = 40 |

**Dengan aturan sekarang** (nilai dilepas saat Terima) di dua database: pesan ke produksi menyebut 60 jt, pembelian masuk, lalu ERP melepas 6.000 ÷ 14.000 × 160 jt = **68.571.429**. Produksi memegang 60 jt dan GL 68,57 jt: selisih 8.571.429 tanpa kesalahan siapa pun. Dalam satu database masalah ini tidak muncul karena pelepasan dan penerimaan satu transaksi.

### 6.2 Uji acak

Model kecil dengan dua database dan pipa yang menunda, mengacak urutan dan menggandakan pesan (30%); 2.000 putaran, 400 kejadian per putaran. Ini model konsep, **bukan kode aplikasi**. Kolom kanan adalah putaran yang WIP di GL tidak sama dengan produksi **setelah semua pesan sampai**.

| Aturan | Putaran yang berakhir salah |
| --- | --- |
| Nilai dilepas saat Terima (aturan sekarang), pesan kembar diabaikan | 2.000 / 2.000 |
| **Nilai dibekukan saat Kirim, pesan kembar diabaikan** | **0 / 2.000**, dan persamaan §4 benar di setiap saat |
| Nilai dibekukan saat Kirim, pesan kembar **tidak** diabaikan | 2.000 / 2.000 |

Dua syarat sama-sama wajib: nilai beku saat Kirim, dan penerima yang mengabaikan pesan kembar.

### 6.3 Kejadian buruk

| Kejadian | Perilaku |
| --- | --- |
| Pesan Kirim terlambat | Barang Dalam Perjalanan di pengirim; tidak hilang dan tidak bisa dipakai dua kali |
| Pesan Kirim ganda | Diabaikan lewat id pesan |
| Kabar Terima terlambat | Suku koreksi di persamaan §4; hanya status di pengirim yang tertinggal |
| Master belum sampai (Item, Unit) | Pesan tertahan di antrean *Gagal diproses* dan dicoba lagi. Tidak ditolak |
| Kirim 30/11, Terima 01/12 | Jurnal 30/11. Akhir bulan, barang di jalan terhitung WIP |
| Periode dikunci ERP sebelum Unit Terima | Tidak masalah untuk GL: Terima tanpa jurnal |
| Kabar Grading November sampai setelah November dikunci | **Masalah nyata**, diatur §7.4 |
| Barang salah kirim | Terima lalu BSTB Pengeluaran, seperti sekarang. Batal setelah Kirim tidak disediakan: pembatalan lintas database berlomba dengan Terima |

## 7. Perpindahan data antar database

### 7.1 Pesan

| Arah | Pesan | Isi | Akibat |
| --- | --- | --- | --- |
| ERP → Produksi | `IssueSent` | no, tujuan, kode Unit, per lot: No. Stok, kode Item, qty, gram, kadaluarsa, **nilai** | Production Receipt menunggu |
| Produksi → ERP | `IssueReceived` | no, tanggal | Issue menjadi Diterima |
| Produksi → ERP | `ReceiptSent` (dari Production Issue) | no, tujuan, Unit, gudang, per lot: sama, plus partai | `log_stock_receipt` menunggu |
| ERP → Produksi | `ReceiptReceived` | no, tanggal | Bucket Dalam Perjalanan dikosongkan |
| Produksi → ERP | `ProductionPosted` | no dokumen, tanggal, biaya per Unit × versi rate, gerak nilai per Kategori Item, beban | ERP menjurnal dan mencatat `prd_cost_entry` |
| ERP → Produksi | Master | Item (dengan BJL), Satuan, Unit, Workstation, Line, Routing, Standard Cost, Gudang, periode | Salinan baca |
| Produksi → ERP | Penanda pakai | Item dan Routing yang sudah dipakai, aktivitas per periode | Mengganti bacaan T7 |

Pesan memakai **kode dan nomor**, tidak pernah id.

### 7.2 Cara kirim

- **Outbox dan inbox** di tiap database. Pesan ditulis dalam transaksi yang sama dengan buku; pengirim mencoba ulang; inbox unik per id pesan dan diproses dalam satu transaksi dengan bukunya. Urutan per dokumen dijaga, antar dokumen tidak perlu.
- Antrean *Gagal diproses* tampil sebagai layar, bukan log.
- Tidak perlu broker: volumenya dokumen, bukan sensor. Satu endpoint dan cron cukup.

### 7.3 Siapa memiliki apa

| Hal | Pemilik | Catatan |
| --- | --- | --- |
| Nilai stok, jurnal, WIP di GL | ERP | |
| Nilai per No. Stok di dalam produksi | **Produksi menghitung**, ERP menjurnal totalnya | Pembagian nilai grading dan kotak butuh buku bucket. Menghitungnya di ERP berarti ERP menyalin seluruh buku produksi |
| No. Stok | Tiap database punya register sendiri, dikenali dari nomor | ERP menerbitkan nomor pembelian; Produksi menerbitkan `<induk>-<n>` dan `KTK-…`. ERP menolak nomor ketikan berbentuk keduanya agar tidak bentrok |
| No. Partai, No. Job, Kerja, silsilah | Produksi | Telusur dari ERP membuka halaman Produksi |
| Routing, Unit, Standard Cost | ERP | P254 |

### 7.4 Tutup periode

1. ERP meminta Produksi menutup tanggal sampai akhir bulan (cut-off).
2. Produksi menolak dokumen bertanggal di bulan itu, menghabiskan outbox, lalu menyatakan selesai sampai nomor pesan sekian.
3. ERP memproses sampai nomor itu, mencocokkan persamaan §4 per akhir bulan, baru mengunci.

Jurnal dari `ProductionPosted` **menyusul** gerak bukunya. Ini menyimpang dari prinsip *Post adalah satu transaksi* (`Claude-ERP.md` §2 rule 6 dan 8, KB `accounting/books-and-posting`, `foundations/document-lifecycle`). **Deviation check wajib dilakukan saat pemisahan diputuskan.** Serah terima gudang tidak menyimpang karena jurnalnya di transaksi ERP sendiri.

## 8. Langkah pembangunan

Satu database tetap (P245). Yang dibangun sekarang **bentuknya**, bukan pipanya: isi pesan dikirim sebagai pemanggilan fungsi dalam transaksi yang sama, sehingga saat dipisah hanya pengirimannya yang diganti.

| Langkah | Isi | Migrasi | Selesai bila |
| --- | --- | --- | --- |
| **G1** | Issue berjurnal saat Kirim: status Dalam Perjalanan, hapus reservasi, Terima tanpa jurnal. Cek WIP di `db:reconcile` memakai persamaan §4 | Ya; menolak bila masih ada Issue Diajukan (diselesaikan dulu) | Simulasi §6.1 menjadi tes; `simulasi-po-sampai-finish-goods` hijau |
| **G2** | `log_stock_receipt` generik; menu Stock Issue dan Stock Receipt; URL lama dialihkan; Receipt ke gudang berlokasi; akses per gudang | Ya, ganti nama di tempat | Nomor, jurnal dan role lama utuh |
| **G3** | `prd_receipt` dan `prd_issue` dengan registernya; satu modul kontrak `handover.ts`; id bucket keluar dari tabel `log_` | Ya, dokumen lama diisi mundur | Tes batas modul: Stock Issue dan Stock Receipt tidak lagi mengimpor `production-ledger`, dan modul produksi tidak menulis tabel `log_stock_issue` / `log_stock_receipt` |
| **G4** | Lima dokumen produksi menjurnal lewat satu fungsi berisi `ProductionPosted`; penolakan nomor `<induk>-<n>` dan `KTK-` di Receipt Note | Tidak | `postJournal` tidak dipanggil modul produksi mana pun selain fungsi itu |
| **G5** | Tujuan tambahan (Pemakaian Internal, Pemusnahan, Stok Awal, Opname) | Per tujuan | Hanya atas instruksi |
| **Nanti** | Outbox, inbox, salinan master, dua register No. Stok, cut-off | | Saat database benar-benar dipisah |

G1 dan G2 berdiri sendiri. G3 membutuhkan keduanya. Bila hanya ingin menu generik, cukup G2.

## 9. Keputusan yang diminta

| # | Pertanyaan | Usulan |
| --- | --- | --- |
| GM-1 | Menu generik Stock Issue dan Stock Receipt, nama BSTB menjadi nama tujuan (mengubah P254, P303, P304) | Ya |
| GM-2 | Nama menu | **Stock Issue** / **Stock Receipt** (bukan *Penerimaan*, sudah dipakai Kas & Bank) |
| GM-3 | Delivery Note, Receipt Note, Transfer tetap sendiri | Ya |
| GM-4 | Issue bergerak dan berjurnal saat Kirim; barang menuju Unit terhitung WIP (mengubah W20, P228) | Ya. Pilihan lain: akun sendiri *Barang Dalam Perjalanan ke Produksi* dengan jurnal kedua saat Terima; WIP lebih ketat, tetapi Terima kembali berjurnal dan bergantung periode |
| GM-5 | Sisi produksi: Production Receipt dan Production Issue tersendiri, `prd_transfer` hanya Unit → Unit | Ya |
| GM-6 | Nilai per No. Stok tetap dihitung Produksi setelah dipisah | Ya |
| GM-7 | Tujuan tambahan mana yang dibangun | Belum ada sampai diminta, di gudang maupun produksi |
| GM-8 | Cakupan yang dijalankan sekarang | G1–G3; G4 boleh menyusul |

Setelah disetujui, keputusan dicatat di `Claude-ERP.md` §12 dan PWR dalam commit yang sama.

## 10. Yang tidak diperiksa

- Jumlah BSTB Issue berstatus Diajukan di Neon (dicek sebelum migrasi G1).
- Beban nyata outbox; tidak diuji beban.
- Closing Costing Produksi belum dibangun, jadi pengaruh GM-4 pada varians dinilai dari persamaan, bukan dari kodenya.
