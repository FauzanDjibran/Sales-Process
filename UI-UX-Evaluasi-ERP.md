# Evaluasi UI/UX — Aplikasi ERP

> 23/11/2026. **Analisa saja; belum ada kode yang diubah.**
> Lingkup: Dashboard, Penjualan, Pembelian, Persediaan, Finance, Accounting,
> Master, Pengaturan. Di luar lingkup: aplikasi Produksi, modul ERP › Produksi,
> Master › Produksi, dan Pajak (disembunyikan).
> Batas solusi: tampilan dan alur saja — tanpa mengubah perhitungan, posting,
> status yang tersimpan, atau hak akses.

**Cara memeriksa.** Semua daftar, form baru, halaman dokumen, dan laporan dibuka
di build yang berjalan (`localhost:3110`) pada 1440 px; 19 layar diulang pada
1366, 768 dan 390 px. Hasilnya dibandingkan dengan `knowledge/design-convention.md`
(ditulis **DC**), dengan Journal sebagai layar acuan, lalu dicek ke kode.

**Prioritas.** **P1** menghambat kerja atau menyembunyikan informasi · **P2**
tidak konsisten antar menu · **P3** penyempurnaan.
**Ukuran.** S = beberapa jam · M = 1–2 hari · L = lebih dari 2 hari.
**◆** = menyentuh keputusan atau konvensi yang ada; perlu persetujuan dulu (§5).

---

## 1. Kesimpulan

Fondasinya sudah baik dan seragam: shell, token warna, kontrol, pager, riwayat,
konfirmasi, breadcrumb kembali, urutan tombol (bahaya → netral → utama), status
Draft di atas, dan `Batal` yang bertanya bila ada perubahan. Halaman juga tidak
pernah bergeser menyamping, termasuk di layar ponsel.

Masalahnya mengelompok pada empat akar:

| Akar | Akibat |
| --- | --- |
| **A. Daftar dokumen ditulis satu per satu** (23 komponen daftar) | Kolom No, ikon aksi, filter, urutan kolom dan nama tombol berbeda-beda |
| **B. Bentuk dokumen baru dipakai sebagian** — `DocumentHeader` + `Amount` hanya di Journal, Opening Balance, Delivery Note, Credit Note, Sales Return, BSTB, dan Receipt Note retur | Dokumen lain punya urutan field, label dan penempatan referensi sendiri |
| **C. Status dan kata kerja didefinisikan per dokumen** (±20 berkas workflow), bukan satu peta (DC §10.3) | Arti sama, kata dan warna berbeda |
| **D. Alur antar dokumen hanya dibangun di Penjualan** | Pembelian dan Finance: user menutup dokumen, pindah menu, lalu mencari lagi dokumen yang sama |

Memperbaiki A–D di komponen bersama menyelesaikan sebagian besar temuan sekaligus,
dan layar baru otomatis ikut.

---

## 2. Temuan

### 2.1 Alur kerja (paling berdampak pada efisiensi)

| # | P | Temuan | Menu terlibat | Potensi solusi | Ukuran |
| --- | --- | --- | --- | --- | --- |
| **F1** | P1 | **Rantai dokumen terputus.** Tombol "langkah berikutnya" hanya ada di: CO → Sales Order, CO → Invoice, SO → DO, DO → Delivery Note, Sales Return → Receipt Note, Transfer Kirim → Terima. **Tidak ada** di 12 sambungan lain: CO → Uang Muka; CO → Sales Return; PR → PO; PO → Receipt Note; PO → Uang Muka; PO / RN → Invoice Pembelian; Delivery Note → Invoice; Uang Muka / Invoice Penjualan → Penerimaan; Uang Muka / Invoice Pembelian → Pengeluaran; Invoice → Credit Note; Pengajuan Perizinan → Uang Muka dan Invoice Perizinan; Credit Note → Pengembalian Dana | Penjualan, Pembelian, Persediaan, Finance | Satu aksi pada kartu dokumen turunan: **Buat \<Dokumen\>**, terbuka dengan sumber sudah terpilih (`?po=`, `?rn=`, `?bill=` …). Polanya sudah ada (`?co=`, `?so=`, `?do=`). Tampil hanya bila statusnya memungkinkan dan user punya izin | L (bertahap per modul) |
| **F2** | P1 | **Kartu dokumen turunan berbeda nama, isi dan ada-tidaknya.** *Jadwal Sales Order*, *Perintah Kirim*, *Pengiriman*, *Penerimaan & Tagihan*, *Penerimaan Gudang*, *Dokumen Terkait* — semuanya hal yang sama. CO tidak menampilkan Uang Muka dan Sales Return-nya; **PR tidak menampilkan PO-nya sama sekali**; baris PO menyebut nomor PR sebagai teks, bukan tautan | CO, SO, DO, Sales Return, PR, PO, RN, Delivery Note, Uang Muka, Invoice, Credit Note | Satu kartu bersama **Dokumen Terkait** (Jenis · Nomor · Tanggal · Status · aksi Buat), posisinya selalu tepat di atas Riwayat. Tabel progres (Dipesan / Terkirim / Sisa) tetap di kartunya sendiri | M |
| **F3** | P1 | **Selalu dua langkah: Simpan, lalu buka dokumen, lalu Ajukan / Posting**, di semua dokumen ERP. Aplikasi Produksi sudah bisa Simpan Draft **dan** Posting langsung dari form (P286) | Semua form dokumen | Di form baru dan ubah: `Batal · Simpan Draft · Ajukan / Posting`. Tombol kedua menyimpan Draft lalu membuka konfirmasi yang sama (dengan journal bila ada). Server dan aturannya tidak berubah | M |
| **F4** | P1 | **Dashboard kosong**, dengan teks usang ("setelah proses penjualan dibangun"). Padahal ini halaman pertama setelah masuk | Dashboard | **Pekerjaan Menunggu** sesuai izin user: menunggu persetujuan, Draft milik saya, tagihan lewat jatuh tempo, barang menunggu diterima. Tiap baris membuka daftar yang sudah terfilter. Selama belum ada, arahkan ke menu pertama ◆ | M |
| **F5** | P2 | **Filter hilang setelah membuka dokumen lalu kembali.** Filter tersimpan di URL hanya pada Journal, Penerimaan, Pengeluaran | 20 daftar lain | Pakai `use-register-params` yang sudah ada di semua daftar; pencarian sisi server menyusul per kebutuhan | M |
| **F6** | P2 | **Penyaring daftar terlalu sedikit**: hampir semua hanya Status. Tidak ada tanggal, customer / supplier, atau *Belum Dibayar / Lewat Jatuh Tempo* | Semua daftar dokumen; terutama Invoice dan Uang Muka | Standar: cari · Status · Periode · Partner; untuk tagihan ditambah **Pembayaran**. Bentuk filter yang sudah ada | M |
| **F7** | P2 | **Meninggalkan form lewat menu, breadcrumb, atau menutup tab membuang isian tanpa peringatan** (hanya `Batal` yang bertanya) | Semua form | Peringatan saat tab ditutup / dimuat ulang. Untuk menu dan breadcrumb: DC §8.7 sengaja tidak menjaga ◆ | S |
| **F8** | P2 | **Barang, Jasa dan "Tambah baris" memakai cara berbeda**: ada yang membuka dialog, ada yang menambah baris kosong (CO, PR, BSTB Issue, Transfer Kirim, Journal). DC §8.8: baris lewat dialog | CO, PR, BSTB Issue, Transfer Kirim | Dialog pilih banyak item sekaligus untuk CO, PR, BSTB Issue, Transfer Kirim; Journal dan Transfer bank tetap baris kosong sebagai pengecualian yang dicatat | M |
| **F9** | P3 | **Master tidak punya jalan ke transaksinya** (Partner, Item). Hanya Cash & Bank yang menautkan bukunya | Partner, Item, Gudang | Tombol netral di header: Partner → Buku Piutang / Hutang; Item → Kartu Stok; Gudang → Saldo Stok. Parameter laporannya sudah ada | S |

### 2.2 Daftar dokumen

| # | P | Temuan | Menu terlibat | Potensi solusi | Ukuran |
| --- | --- | --- | --- | --- | --- |
| **L1** | P1 | **Kolom penting terpotong** dan baru terlihat bila digeser. Pada 1440 px / 1366 px: Journal 280 / 325 px (Kredit, **Status**, aksi); Uang Muka Penjualan 166 / 240 px (Total, **Pembayaran**); Invoice Penjualan 73 / 147 px (**Pembayaran**); Cash & Bank 77 / 151 px (aksi); Umur Piutang 126 / 200 px (**Posisi Bersih**) | Journal, Uang Muka, Invoice, Cash & Bank, Umur Piutang / Hutang | (1) Dahulukan kolom keputusan; gabung yang sekunder jadi dua baris (Customer + CO; Tanggal + Jatuh Tempo); buang DPP / PPN dari daftar Uang Muka. (2) Status Journal pindah ke kolom ke-3. (3) Kunci kolom Nomor di kiri dan aksi di kanan saat digeser | M |
| **L2** | P2 | **Kolom `No`** hanya di Journal, Opening Balance, Delivery Note, Credit Note, Sales Return, Transfer Kirim / Terima, BSTB, dan master; **ikon aksi baris** hanya di empat daftar dokumen | 15+ daftar tanpa keduanya | Satu komponen **`DocumentRegister`** (judul, toolbar, tabel, pager, kosong). Daftar cukup memberi kolom dan data | L (sekali) |
| **L3** | P2 | **Aksi dari daftar** (menu ⋯) hanya di Journal. Menyetujui 10 PO berarti membuka 10 halaman | Semua daftar dokumen ber-lifecycle | Menu ⋯ dari tabel transisi yang sudah ada, berakhir di konfirmasi yang sama (DC §9.5) | M (ikut L2) |
| **L4** | P2 | **Status disaring dengan dua cara**: dropdown di hampir semua daftar, tab berjumlah di BSTB dan Transfer | Semua daftar | Pilih satu. Saran: **tab status** untuk semua dokumen ber-lifecycle — jumlah antrean langsung terlihat — dan dropdown untuk sisanya ◆ | ikut L2 |
| **L5** | P2 | **Nama tombol buat** berbeda: *Customer Order Baru*, *Uang Muka Baru* (tiga menu, sama persis), *Journal Manual*, *Penerimaan Retur*, *Tambah Account*. DC: `Tambah <Entitas>` / `Buat Dokumen` | Semua | Master: **Tambah \<Entitas\>**; dokumen: **Buat \<nama lengkap dokumen\>** | S |
| **L6** | P2 | **Letak dan nama kolom berbeda** untuk arti sama: Status ke-2 (umum), ke-3 (berkolom No), terakhir (Journal); *Tanggal / Tanggal Kirim / Tgl Kirim*; *Total / Total Tagihan / Nilai / Jumlah / Dana Diterima*; partner kadang chip + nama, kadang teks (Penerimaan) | Semua daftar | Urutan baku: No · Nomor · Status · Tanggal · Partner · Dokumen sumber · info khusus · Nilai · Pembayaran · aksi. Judul *Nilai* untuk semua; partner selalu chip + nama | ikut L2 |
| **L7** | P2 | **Hitungan data** berbeda: "1 CUSTOMER ORDER", "1 TAGIHAN", "1 DOKUMEN", "405 DARI 405 JOURNAL", "8 DARI 8 DATA" | Semua | `N dari M dokumen` / `data` sesuai DC §5.4 | S |
| **L8** | P2 | **`Bersihkan filter` tidak ada** di Receipt Note, Invoice Pembelian, Invoice Perizinan, Transfer Kirim / Terima, BSTB (Finish Goods, Pengeluaran) dan Role. **Role juga tanpa pencarian dan filter** | yang disebut | Ikut L2; Role memakai toolbar daftar User | S |
| **L9** | P3 | **Subjudul 2 baris, sampai ±246 karakter**, berisi aturan sistem ("Tidak memposting apa pun…"), berulang di setiap kunjungan. Ada juga yang tanpa subjudul (Account Mapping, System Default) | Semua daftar dokumen | Satu kalimat ≤ 90 karakter: apa isinya. Aturan posting pindah ke konfirmasi, tempat keputusan dibuat | S |
| **L10** | P3 | **Kartu Saldo Kas & Bank memakan 145 px** sebelum daftar, dan tidak ada di Transfer, yang sama-sama butuh saldo | Penerimaan, Pengeluaran, Transfer | Satu baris ringkas per currency, di ketiga menu | S |
| **L11** | P3 | **Halaman kosong** kadang punya tombol buat, kadang tidak (Transfer Kirim, Transfer Terima, Invoice Perizinan) | yang disebut | Selalu tampil bila user berizin (DC §11) | S |
| **L12** | P3 | **Urut kolom** bisa di master, tidak di User dan Role; tanda ▲ menempel di judul semua kolom sehingga ramai | Master, User, Role | User / Role ikut daftar master; ▲ muncul saat disorot atau aktif | S |

### 2.3 Form dan halaman dokumen

| # | P | Temuan | Menu terlibat | Potensi solusi | Ukuran |
| --- | --- | --- | --- | --- | --- |
| **D1** | P1 | **Kolom Kredit terpotong saat mengisi Journal Manual** (134 px di 1440, 208 px di 1366): user tidak melihat Debit dan Kredit berdampingan. Kolom Kurs tetap ada walau IDR | Journal Manual | Kurs tetap kolom sendiri (jawaban user); Partner muncul di bawah Account bila account memintanya | M |
| **D2** | P1 | **Isi utama terdorong ke bawah.** Pada halaman CO dan Invoice, tabel barang baru mulai di ±790 px — di bawah layar 1366×768. Penyebab: field kosong tetap makan baris ("tidak diisi"), Currency satu baris sendiri, Catatan kosong | CO, PO, Uang Muka, Invoice, Pengajuan Perizinan | Mode lihat: sembunyikan field opsional yang kosong; gabung Currency · Kurs · PPN · Mode Harga satu baris; tambah **baris ringkas** di header: Partner · Tanggal · Total · sisa tagihan | M |
| **D3** | P2 | **Data sama tampil berbeda**: PPN = lencana hijau pekat *KENA PPN* (CO, Uang Muka), lencana abu (PO), teks *Ya* (Invoice). Mode harga = chip (CO) / teks (Invoice). Termin = chip + nama (CO) / chip saja (Invoice). Gudang = chip saja (PO) / chip + nama (RN). Label *Kena PPN* / *PPN* | CO, PO, Uang Muka, Invoice | Satu komponen bagian **Harga & Pajak** untuk semua; referensi selalu chip + nama (DC §8.5) | M |
| **D4** | P2 | **Letak referensi berbeda.** Delivery Note punya bagian *Referensi*; Invoice menaruh Journal di antara Alamat dan Pembayaran; Uang Muka menaruh nomor BKM di field Pembayaran; Credit Note menampilkan nomor Surat Jalan tanpa tautan | Semua dokumen posted | Bagian **Referensi** baku, terakhir di kartu header: sumber · journal. Semua nomor dokumen adalah tautan | S |
| **D5** | P2 | **Judul kartu pertama**: sebagian berjudul (Journal), sebagian langsung field; kartu baris bernama *Barang Dipesan, Barang Dikirim, Barang Keluar, Diterima, Ditagih, Dasar Uang Muka* | Semua dokumen | Kartu header selalu berjudul + satu baris tujuan; kartu baris `Barang <kata kerja>` / `Jasa <kata kerja>` (*Barang Diterima*, *Barang Ditagih*) | S |
| **D6** | P2 | **Tombol tambah baris**: *Tambah Baris / Tambah Item / Pilih dari PO / Pilih Surat Jalan / Pilih Receipt Note / Pilih Tagihan / Tambah Tujuan*; ada yang tombol utama (gelap), ada yang netral; ikon berbeda. Sebagian form jadi punya dua tombol utama (Simpan + Tambah), melanggar DC §10.2 | Semua form berbaris | Selalu **netral**, ikon `+`: **Pilih \<sumber\>** bila dari dokumen, **Tambah Item** bila dari master | S |
| **D7** | P2 | **"Surat Jalan" dan "Delivery Note"** dipakai bergantian untuk dokumen yang sama; nomor *Lot* / *No. Stok*; *Kas & Bank* / *Cash & Bank* / *Cash Bank*; *Tutup* / *Tutup Pesanan* | Invoice, Delivery Note, Receipt Note, Master, Laporan | Daftar istilah tunggal (§4) | S |
| **D8** | P2 | **Lencana pekat dipakai untuk yang bukan status**: KENA PPN, TERJADWAL, PENAGIHAN, PENGIRIMAN. DC §10.3: pekat = status | CO, SO, DO, Partner, Uang Muka | Ganti ke lencana tipis (`t-*`) | S |
| **D9** | P2 | **Dokumen final**: ada chip gembok (SO, PO, Invoice), CO Ditutup hanya *Salin*, sebagian menjelaskan lewat catatan di bawah kartu | CO dan dokumen final lain | Selalu: chip gembok + alasan, lalu aksi yang masih mungkin (Salin, Buat …) | S |
| **D10** | P2 | **Nama barang terpotong padahal ada ruang** — baris Invoice menulis "Serum Wajah Vi…", sementara Diskon kosong lebar. Teks bantu field juga terpotong ("PPN yang terutang saat uang muka dite…") | Invoice, Account Mapping, System Default, Transfer Kirim | Kolom barang jadi kolom lentur; kolom Diskon hilang bila semua kosong; teks bantu ≤ 30 karakter | S |
| **D11** | P2 | **Ringkasan lot sempit**: pada Receipt Note teks lot 9 px patah tiga baris di samping tombol *Atur Lot* | Receipt Note, Transfer Terima | Samakan dengan Delivery Note: tombol yang menyebut `n lot`, rincian di dialog | S |
| **D12** | P3 | **Judul master mengulang label**: "C-001 – PT Sentosa…" + chip C-001 + label C-001 di field pertama | Semua master | Judul = nama, lalu chip label + kode (DC §4.2) | S |
| **D13** | P3 | **Dampak Transaksi** (saldo sebelum / sesudah) ada di Penerimaan dan Pengeluaran, tidak di Transfer | Transfer | Tambah kartu yang sama untuk asal dan tujuan | S |
| **D14** | P3 | **Kotak nilai**: urutan, nama dan rincian berbeda (Subtotal + DPP bernilai sama; DPP Nilai Lain ada di CO, hilang di Invoice) | CO, PO, Uang Muka, Invoice | Satu komponen kotak nilai: Bruto · Diskon · DPP · DPP Nilai Lain · PPN · Total; baris yang tidak berlaku atau sama disembunyikan. Angkanya tidak berubah | M |
| **D15** | P3 | Cetak tebal *Catatan* dua baris di sebagian, satu baris di Transfer; bagian Riwayat selalu terbuka panjang | Semua | Catatan selalu 2 baris, selebar kartu. Riwayat tetap; sudah dibatasi 10 | S |

### 2.4 Status dan istilah

| # | P | Temuan | Menu terlibat | Potensi solusi | Ukuran |
| --- | --- | --- | --- | --- | --- |
| **S1** | P2 | **Selesai diposting punya dua nama**: *Posted* (Journal, Penerimaan, Pengeluaran, Transfer) dan *Diposting* (Delivery Note, Receipt Note, Invoice, Credit Note). Aksinya *Post* (Journal) dan *Posting* | yang disebut | Label **Diposting**, aksi **Posting** ◆ (DC menulis *Posted* / *Post*) | S |
| **S2** | P2 | **Disetujui punya dua nama**: *Open* (CO, SO, PO, Sales Return) dan *Disetujui* (Pengajuan Perizinan) | yang disebut | **Open** di semua | S |
| **S3** | P2 | **Diterbitkan dua warna**: biru (Uang Muka), hijau (Delivery Order). Uang Muka Pembelian: aksi *Catat* tetapi status *Diterbitkan* | Uang Muka, DO | Hijau untuk "berlaku"; biru hanya untuk "menunggu pihak lain". Nama aksi dan status sekata | S |
| **S4** | P2 | **Batas bahasa tidak jelas**: Receipt Note / Delivery Note / Sales Return berbahasa Inggris, di sebelahnya Transfer Kirim / Terima, BSTB Pengeluaran; Opening Balance / Trial Balance tetapi Neraca / Laba Rugi; Account Mapping tetapi Termin Pembayaran | Semua menu | Aturan: nama dokumen dan buku standar boleh Inggris, sisanya Indonesia; catat di §4 ◆ | S |
| **S5** | P2 | **Peta status tersebar** di ±20 berkas workflow | — (sumber S1–S3) | Satu berkas peta status → label → warna, dengan tes agar tidak menyimpang lagi | S |

### 2.5 Laporan

| # | P | Temuan | Menu terlibat | Potensi solusi | Ukuran |
| --- | --- | --- | --- | --- | --- |
| **R1** | P2 | **Unduh XLSX** ada di 6 laporan, tidak ada di 12: semua laporan Persediaan (4) dan Piutang / Hutang / Uang Muka (8) | Persediaan, Finance | Tambah lewat `exportHref` yang ada. Persediaan sudah disepakati menyusul (K6) | M |
| **R2** | P2 | **Kebiasaan buka berbeda**: sebagian langsung tampil (Kartu Stok, Buku Piutang, Trial Balance), sebagian meminta pilihan dulu (General Ledger, Buku Kas & Bank, Kartu Nilai) | Laporan | Laporan yang bisa tampil untuk semua, langsung tampil dalam blok tertutup (isi blok sudah dimuat saat dibuka). General Ledger / Buku Kas & Bank ikut ◆ | M |
| **R3** | P2 | **Nilai nol** tampil `Rp 0` (Trial Balance, Saldo Kas & Bank), `-` (Umur Piutang), kosong (lain). **Angka negatif** `Rp -8.312.245` (Trial Balance), kurung (General Ledger, Journal) | Laporan Accounting, Finance | Satu aturan laporan: nol redup `—`, negatif dalam kurung ◆ (P145 memilih `Rp 0`, P148 membatasi kurung ke buku) | S |
| **R4** | P2 | **Blok biru tua `#1F3864`** tidak ada dalam token warna; 20 blok berjajar sangat berat dan menenggelamkan angkanya. Trial Balance / Neraca memakai gaya ringan | Kartu Stok, Saldo Stok, Nilai Persediaan, Buku / Saldo Piutang dan Hutang, Buku / Saldo Kas & Bank, General Ledger | Header blok terang (`brand` tipis + teks gelap), sama dengan Trial Balance ◆ (warna bawaan SIBA) | S |
| **R5** | P2 | **Chip nomor melebar** sepanjang kolom (±300 px) di Saldo Piutang; rata-rata tampil enam desimal (`Rp 37.791,563029`) | Saldo Piutang / Hutang, Nilai Persediaan | Chip selebar isinya; rata-rata 2 desimal, lengkapnya saat disorot | S |
| **R6** | P3 | **Filter 2–3 baris** (±110 px) dengan kotak sempit 150 px; "Dibuat …" kadang di header kartu, kadang di kaki | Semua laporan | Filter satu baris mengalir; waktu pembuatan selalu di kaki | S |
| **R7** | P3 | **Urutan menu Laporan Finance**: Buku Kas & Bank pertama, Saldo Kas & Bank terakhir | Finance | Kas & Bank (Buku, Saldo) → Piutang → Hutang | S |

### 2.6 Menu, pengaturan dan master

| # | P | Temuan | Menu terlibat | Potensi solusi | Ukuran |
| --- | --- | --- | --- | --- | --- |
| **M1** | P2 | **Ikon ganda**: gerigi untuk Produksi **dan** Pengaturan di rail yang sama; ikon *unduh* dipakai untuk menu user (pojok kanan atas), Penerimaan, BSTB, Transfer Terima, dan Unduh XLSX | Shell, Finance, Persediaan | Produksi → `layers`; menu user → `chev` ke bawah; Penerimaan tetap `down`, unduh memakai ikon sendiri ◆ (DC §3.2 menyebut `down`) | S |
| **M2** | P2 | **Rail hanya ikon, tanpa nama** — nama baru muncul saat disorot; user baru harus menghafal 9 ikon | Shell | Nama kecil di bawah ikon (rail 58 → 72 px) ◆ (DC §3.3) | S |
| **M3** | P2 | **Menu ganda untuk satu jenis dokumen**: PR Barang / PR Jasa, PO Barang / PO Jasa | Pembelian | Satu menu *Purchase Request* dan *Purchase Order* dengan tab Semua · Barang · Jasa; jenis dipilih saat membuat ◆ (P123, P124). Penyimpanan tetap | M |
| **M4** | P2 | **Dokumen satu alur tersebar di tiga modul.** Contoh penjualan: CO (Penjualan) → DN (Persediaan) → Invoice (Finance). Pembagian ini benar menurut P107 / P131, tetapi tanpa F1–F2 terasa memutar | Semua | Pertahankan modulnya; jalan pintas lewat F1 + F2 | — |
| **M5** | P2 | **Breadcrumb tidak seragam**: 3 tingkat (Finance / Uang Muka / …, Finance / Kas & Bank / Penerimaan, Penjualan / Perizinan / …) dan 2 tingkat (Finance / Invoice Penjualan, Finance / Transfer) untuk menu dengan kedalaman sama | Finance, Penjualan | Selalu `Modul / Menu / Nomor` (DC §3.6) | S |
| **M6** | P2 | **Pengaturan tidak punya pola yang sama**: Account Mapping dan Account Kategori Item selalu dalam mode isi, tombol Simpan baru muncul setelah ada perubahan; Profil punya dua tombol di dalam kartu; User dan Role memakai Ubah | Account Mapping, Account Kategori Item, System Default, Profil | Mode lihat + `Ubah` seperti record lain; ini juga mencegah mapping akuntansi terubah tidak sengaja | M |
| **M7** | P2 | **Account Kategori Item** 5 kolom pemilih, terpotong 174 px, nama kategori hilang ("Baha…") | Account Kategori Item | Kategori jadi dua baris (nama, kode); kolom dikunci; atau satu baris per kategori yang membuka panel | S |
| **M8** | P2 | **Lokasi Gudang**: setiap gudang tanpa lokasi memakan dua baris; daftar panjang tanpa isi | Lokasi Gudang | Gudang tanpa lokasi dilipat jadi satu baris dengan aksi *Tambah Lokasi* | S |
| **M9** | P3 | **Role**: 330 izin satu halaman panjang, kode teknis (`CUSTOMER_ORDER_VIEW`) di tiap butir, tanpa pencarian | Role, Profil | Matriks per menu (Lihat · Buat · Ubah · Posting · Batal), modul dilipat, kotak cari; kode hanya saat disorot | M |
| **M10** | P3 | **Grup berisi satu menu bernama sama**: Chart of Accounts › Chart of Accounts, Journal › Journal, Akun Saya › Profil Saya (sudah ada di menu user) | Accounting, Pengaturan | Gabung: *Buku* (Chart of Accounts, Journal); hapus grup Akun Saya dari panel | S |
| **M11** | P3 | **Konfigurasi di tiga tempat**: Accounting › Pengaturan, Pengaturan › Sistem, Master › Referensi. Gudang Transit di System Default tanpa tautan dari Transfer Kirim yang memintanya | Accounting, Pengaturan | Tempatnya tetap (P61); setiap pesan "belum diatur" diberi tautan langsung ke field-nya | S |

### 2.7 Keterbacaan dan akses

| # | P | Temuan | Menu terlibat | Potensi solusi | Ukuran |
| --- | --- | --- | --- | --- | --- |
| **A1** | P1 | **Kontras rendah**: judul kolom dan breadcrumb 9,5–10 px dengan rasio 2,6 : 1; "tidak diisi" dan nomor baris 1,5 : 1 (anjuran 4,5 : 1). Terasa pada layar kantor biasa | Semua | Gelapkan tiga token `muted` satu tingkat dan naikkan teks terkecil ke 11 px ◆ (token bersama) | S (cek visual M) |
| **A2** | P2 | **Baris tabel tidak bisa dipilih dengan keyboard**; hanya tautan di dalamnya | Semua daftar | Nomor dokumen selalu tautan (sudah), aksi baris bisa difokus; ↑ ↓ Enter di daftar (ikut L2) | S |
| **A3** | P3 | **Pintasan keyboard** belum ada (Simpan, cari, buat) | Semua form dan daftar | `Ctrl+S` Simpan, `/` fokus cari ◆ (C32: ditunda ke akhir) | S |
| **A4** | P3 | **Di ponsel** header lengket menutup ±200–250 px; tabel digeser jauh (CO 373 px, Journal 981 px) | Semua | Subjudul disembunyikan di < 640 px; daftar tampil sebagai kartu ringkas. Kerjakan hanya bila ponsel memang dipakai | M |

---

## 3. Urutan pengerjaan yang disarankan

| Tahap | Isi | Temuan | Dampak |
| --- | --- | --- | --- |
| **1. Bahasa bersama** | Peta status tunggal, istilah, nama tombol, lencana, breadcrumb, ikon, kontras | S1–S5, D6–D8, L5, L7, L9, M1, M5, A1 | Seluruh aplikasi terasa satu; kecil risikonya |
| **2. Daftar seragam** | `DocumentRegister`: kolom, filter, aksi baris, tab status, URL | L1–L4, L6, L8, L11, L12, F5, F6, A2 | Semua daftar sekaligus, dan layar baru ikut |
| **3. Halaman dokumen seragam** | `DocumentHeader` + `Amount` di semua dokumen; Harga & Pajak, Referensi, Dokumen Terkait, kotak nilai | D1–D5, D9–D11, D13, D14, F2 | Data sama selalu di tempat sama |
| **4. Alur tersambung** | Tombol langkah berikutnya, Simpan + Ajukan / Posting, dashboard, tautan master | F1, F3, F4, F7–F9, M11 | Paling banyak memangkas klik |
| **5. Laporan dan pengaturan** | Unduh, gaya blok, nol / negatif, Role, pengaturan | R1–R7, M6–M10 | — |

Tahap 2 dan 3 menambahkan layarnya ke `DOCUMENT_SCREENS` pada
`tests/design-system.test.ts`, sehingga penyimpangan baru langsung tertangkap.

**Contoh penghematan (dihitung dari alur, bukan diukur ke user).** PO Open sampai
Receipt Note tersimpan — *sekarang:* buka modul Persediaan → Receipt Note → Receipt
Note Baru → cari dan pilih PO → Pilih dari PO → isi → Simpan (7). *Setelah F1:*
Buat Receipt Note di PO → Pilih dari PO → isi → Simpan (4).

---

## 4. Usulan daftar istilah

| Dipakai | Menggantikan |
| --- | --- |
| **Diposting** / aksi **Posting** | Posted, Post |
| **Open** | Disetujui (Pengajuan) |
| **Tutup** | Tutup Pesanan |
| **Delivery Note** | Surat Jalan (di layar) |
| **Kas & Bank** | Cash & Bank, Cash Bank |
| **Buat \<Dokumen\>** / **Tambah \<Master\>** | … Baru, Journal Manual |
| **Dokumen Terkait** | Jadwal Sales Order\*, Perintah Kirim\*, Penerimaan & Tagihan |
| **Nilai** (kolom daftar) | Total, Total Tagihan, Jumlah, Dana Diterima |

\* Tabel progres per barang tetap dengan nama sendiri; hanya daftar dokumennya yang dipindah.

---

## 5. Yang perlu diputuskan (◆)

| # | Keputusan | Rekomendasi |
| --- | --- | --- |
| K1 | Status lewat **tab berjumlah** atau dropdown (L4). DC §5.4 menulis dropdown; BSTB dan Transfer sudah tab | **Dijawab: dropdown, tanpa tab status** |
| K2 | *Posted* → *Diposting* (S1) | Ya; perubahan label, bukan data |
| K3 | Blok laporan biru tua → terang (R4) | Ya; kelas baru di bagian tambahan `globals.css` |
| K4 | Nol dan negatif di laporan (R3; P145, P148) | Satu aturan: `—` redup dan kurung |
| K5 | PR / PO Barang dan Jasa jadi satu menu (M3; P123, P124) | Ya, dengan tab |
| K6 | Nama di bawah ikon rail (M2; DC §3.3) | Ya |
| K7 | Kontras token dan ukuran minimum (A1; DC §10.1) | Ya; bila disetujui berlaku untuk semua proyek |
| K8 | Dashboard berisi *Pekerjaan Menunggu* (F4). DC §4.6: Draft tidak tampil di dashboard, karena bukan angka bisnis | Ya sebagai antrean kerja, bukan angka; ini penyimpangan yang perlu disetujui |
| K9 | Pintasan keyboard sekarang (A3; C32 menunda) | Tunda, ikut C32 |
| K10 | Peringatan saat keluar lewat menu (F7; DC §8.7) | Cukup untuk tab ditutup / dimuat ulang |
| K11 | General Ledger dan Buku Kas & Bank langsung tampil (R2) | Ya, blok tertutup |
| K12 | Aturan bahasa nama menu (S4) dan ikon menu user (M1; DC §3.2) | Ya |

Setiap keputusan yang mengubah konvensi melewati *deviation check* (KNOWLEDGE.md)
sebelum dibangun.

---

## 6. Batas pemeriksaan

- Diperiksa sebagai Administrator; tampilan role terbatas belum.
- Pengajuan Perizinan, Uang Muka / Invoice Perizinan, Uang Muka / Invoice
  Pembelian, Pengeluaran, Transfer Kirim / Terima **tidak punya data**: diperiksa
  dari daftar kosong, form baru, dan kode; halaman dokumennya belum dilihat.
- Data lokal memuat sisa fixture uji (`ZZTEST…`, `TWH-…`, `TCAT-…`) yang ikut
  memanjangkan daftar; itu data, bukan temuan UI.
- Dialog pemilih, konfirmasi dan popover dicek dari kode, bukan satu per satu di layar.
- Belum ada pengamatan langsung terhadap user.
