# Plan Implementasi Produksi Walet: Sampai Barcoding

> Sumber: `Produksi Walet (Real).md`. Rujukan W, V, A dan § menunjuk ke dokumen itu.
> Disusun 05/11/2026, dipecah per menu 06/11/2026. **Status: menu 1–11 dibangun (P239, P241), sisanya rencana.** Berisi 24 menu dalam 9 kelompok, urut sesuai flow.

---

## Daftar Menu

| Kelompok | Menu |
| --- | --- |
| Struktur Produksi | 1. Workstation · 2. Unit · 3. Line · 4. Routing |
| Master Pendukung | 5. Karyawan · 6. Flag BJL |
| Standard Cost | 7. Standard Cost |
| Masuk Produksi | 8. BSTB Issue |
| Pengerjaan di Unit | 9. Dokumen Grading · 10. Pengerjaan Unit · 11. QC Check |
| Perpindahan Antar Unit | 12. Dokumen Push · 13. BSTB Penyebaran · 14. BSTB Transfer · 15. Dokumen Reproses |
| Keluar Produksi | 16. BSTB Pengeluaran |
| Biaya | 17. Jenis Biaya · 18. Tagihan Biaya · 19. Closing Costing Produksi · 20. Proyeksi Varians |
| Laporan | 21. Saldo Produksi · 22. Kartu No. Stok · 23. Susut per Partai · 24. Telusur |

Dokumen Grading dan Pengerjaan Unit tidak dipecah per unit, karena unit adalah data (W33). Perilaku tiap unit ada sebagai tabel di dalam menunya.

## Batas Plan

**Mulai:** BSTB Issue dari Gudang. **Selesai:** Dokumen Push keluar Barcoding, yang menaruh barang di Persiapan Packing 95.

| Batas | Yang terjadi di luar plan | Yang dipakai plan ini |
| --- | --- | --- |
| Sebelum | Pembelian, Grading Sampling, Receipt Note | No. Stok akar di Gudang |
| Sesudah | Packing 95 mengerjakan barang | Barang di Persiapan UP5 |
| Samping | Pembayaran Biaya Produksi di Finance, jurnal manual | Aktual pada akun Jenis Biaya |
| Samping | Stok Logistik | Tujuan BSTB Pengeluaran |

**Ditunda:** Assembly, BoM Packing, BSTB ke Finish Goods, Nama Jual, alasan Pcs sisa, Sales Planning dan Rencana Produksi.

**Tetap belum masuk (§15):** barcode dan scan (O-03), Rambang dan Titil (O-10), QC Packing (O-12), hal-hal W62.

## Asumsi Penulisan

Aturan yang muncul saat menyusun plan ini sudah menjadi keputusan W81–W91. Yang tersisa hanya batas penulisan:

| Asumsi | Isi |
| --- | --- |
| Target lengkap | Plan menulis target lengkap tiap menu, tanpa gap dengan yang sudah dibangun |
| Pengguna | Pengguna selain PPIC, Admin Bahan Baku, QC, Logistik dan admin adalah perkiraan |
| Sales Planning | Ditunda karena targetnya Nama Jual, yaitu kotak hasil Packing |

## Aturan Bersama

Berlaku di semua menu dan tidak diulang di tiap bagian.

| Aturan | Isi |
| --- | --- |
| Tahap barang | Persiapan → proses → QC Check (bila unitnya punya) → Stand By (W29, W65) |
| Bucket | No. Stok · Unit · Tahap · Partai · Job; baris Balik QC terpisah dari saldo No. Stok yang sama (W66) |
| Nomor | `<JENIS>_<unit>_<ddmmyy>_<NNNNN>` harian (W11); unit tujuan untuk perpindahan |
| Draft | Tidak menyentuh buku, jurnal, atau reservasi. Batalkan hanya untuk Draft |
| Siklus BSTB | Ajukan mengunci barang di pengirim tanpa status transit (W20); sesudahnya tidak bisa dibatalkan atau ditolak (W67). Terima hanya konfirmasi: tepat isi dokumen, tanpa selisih (W57), dan barulah buku bergerak |
| Tujuan otomatis | Unit tujuan BSTB dan Dokumen Push selalu unit berikutnya pada routing (§5) |
| Satu partai | Satu dokumen untuk satu partai; tidak berlaku sebelum partai lahir (W76) |
| Nilai | Rupiah bulat, rate `Decimal(18,6)`, sisa pembagian ke bagian terbesar. BJL selalu 0, non-BJL menurut gram (W32) |
| Gram | Berubah hanya lewat grading (W19, W47) |
| Hak akses | Setiap aksi lewat permission; perubahan master hanya admin (§5) |
| UI | Mengikuti `knowledge/design-convention.md`. Tiap Posting, Ajukan dan Terima punya konfirmasi yang menyatakan akibatnya; yang memposting jurnal menampilkan barisnya |

---

## Kelompok: Struktur Produksi

### 1. Workstation

**Deskripsi & Penjelasan Singkat**

Menu admin untuk mengelompokkan unit. Workstation bukan tempat barang; fungsinya menentukan jalur perpindahan, karena dalam satu Workstation selalu Push dan lintas Workstation selalu BSTB (W64). Menu ini dibuat paling awal, sebelum Unit.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Daftar Workstation | Menampilkan semua Workstation | Kode, Nama, Jumlah Unit, Status |
| Form Workstation | Membuat dan mengubah | Kode, Nama |
| Unit Anggota | Menampilkan unit di dalamnya | Kode dan nama unit (teks) |

**[Cara Kerja Menu]**

1. Admin membuat Workstation. Isi awal: BB + PPIC, Cleaning, Moulding, WIP Packing (§5).
2. Anggotanya terbentuk saat Unit memilih Workstation; menu ini tidak menambah unit.
3. Sistem membaca Workstation untuk menghitung Keluar Lewat pada Routing (W64).

Output: pengelompok untuk menu Unit dan Routing.

**[Plan UI & UX]**

- **Layout:** daftar satu tabel, form satu kartu.
- **Peringatan:** bila unit anggota sudah ada di routing, form mengingatkan bahwa perubahan Workstation mengubah jalur Push atau BSTB.
- **Kosong:** ajakan membuat Workstation pertama.

### 2. Unit

**Deskripsi & Penjelasan Singkat**

Menu admin untuk mendefinisikan tempat kerja produksi dan perilakunya. Satu unit menjalankan satu jenis proses, sehingga tipe unit menentukan menu pengerjaannya. Menu ini dibaca semua dokumen produksi.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Daftar Unit | Menampilkan unit per Workstation | Kode, Nama, Workstation, Tipe, QC Check, Status |
| Form Unit | Membuat dan mengubah | Kode, Nama, Workstation, Tipe, QC Check, Lepas No. Job (Tipe Grading saja), Terbitkan Job Order |

**[Cara Kerja Menu]**

1. Admin membuat Unit dan memilih Workstation.
2. Tipe tepat satu: Pass Through, Grading, atau Assembly (W73, W86).
3. Admin menandai QC Check, Lepas No. Job dan Terbitkan Job Order. Semuanya atribut Unit, bukan langkah routing (§5, W92).
4. Kode unit masuk ke nomor dokumen (W11), jadi dibuat pendek dan tetap.

Isi awal, dari §5 dan W81:

| Workstation | Unit | Tipe | QC Check | Lepas No. Job | Job Order |
| --- | --- | --- | --- | --- | --- |
| BB + PPIC | UGH Grading Halus | Grading | Ya | — | — |
| BB + PPIC | UPC Pre Cleaning | Pass Through | Ya | — | — |
| BB + PPIC | UPY Penyebaran | Grading | — | Ya | — |
| Cleaning | UPW Pre Wash | Pass Through | Ya | — | — |
| Cleaning | UCL Cleaning | Pass Through | Ya | — | — |
| Cleaning | UC1 CCP-1 | Pass Through | — | — | — |
| Cleaning | USR Sortir | Pass Through | — | — | — |
| Moulding | UDA Dry A | Grading | Ya | — | — |
| Moulding | UMG Moulding (grading) | Grading | Ya | Ya | Ya |
| Moulding | UMP Moulding (process) | Pass Through | — | — | — |
| Moulding | UDB Dry B | Grading | Ya | Ya | — |
| WIP Packing | UWP Wrapping | Pass Through | Ya | — | — |
| WIP Packing | UBC Barcoding | Grading | Ya | — | — |
| WIP Packing | UP5 Packing 95 | Assembly | Belum ditinjau | — | — |

UP5 hanya tujuan akhir plan ini (W81). Setiap Push atau BSTB antar unit meneruskan No. Job yang ada, atau membuat yang baru bila barang belum punya (W92).

Output: unit untuk Routing dan semua menu dokumen.

**[Plan UI & UX]**

- **Layout:** daftar dengan filter Workstation dan Tipe; form satu kartu.
- **Isian tertutup:** Tipe berupa pilihan, bukan teks bebas; Lepas No. Job hanya tampil untuk Tipe Grading.
- **Validasi:** Workstation dan Tipe wajib; kode ganda tampil di field.
- **Kosong:** bila Workstation belum ada, form mengarahkan ke menu Workstation.

### 3. Line

**Deskripsi & Penjelasan Singkat**

Menu admin untuk Line Produksi. Line menjadi atribut partai dan menyimpan akun varians. Untuk sekarang hanya Reguler (W1).

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Daftar Line | Menampilkan semua line | Kode, Nama, Akun Varians, Status |
| Form Line | Membuat dan mengubah | Kode, Nama, Akun Varians |
| Routing Milik Line | Menampilkan routing line ini | Kode routing (teks) |

**[Cara Kerja Menu]**

1. Admin membuat Line dan memilih Akun Varians dari kelompok HPP (W23).
2. Partai memilih Line saat BSTB Penyebaran; 1 partai = 1 line (§6).
3. Closing memakai akun ini untuk jurnal varians (§10).

Output: Line untuk Routing, BSTB Penyebaran dan Closing.

**[Plan UI & UX]**

- **Layout:** daftar satu tabel, form satu kartu.
- **Akun:** picker akun yang sudah tersaring ke kelompok HPP.
- **Kosong:** ajakan membuat Line; BSTB Penyebaran tidak bisa dibuat tanpa Line.

### 4. Routing

**Deskripsi & Penjelasan Singkat**

Menu admin untuk urutan unit. Routing hanya urutan (W40); dokumen memakainya untuk tahu unit berikutnya dan jalur keluarnya. Ada satu routing pra-partai tanpa line, dan routing per line sesudahnya.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Daftar Routing | Menampilkan semua routing | Kode, Line, Jumlah Langkah, Status Terkunci |
| Header | Identitas | Kode, Line (kosong = pra-partai) |
| Langkah | Urutan unit | Urutan, Unit, Workstation, Checkpoint, Boleh Dilewati |
| Keluar Lewat | Hasil hitung per langkah; tidak bisa diisi | Dokumen Push atau BSTB |

**[Cara Kerja Menu]**

1. Admin membuat routing. Tanpa line berarti segmen pra-partai, sama untuk semua line, dan berakhir di Penyebaran (W39, W73). Routing line dimulai sesudahnya.
2. Admin menyusun unit. Sistem menghitung Keluar Lewat: unit berikutnya satu Workstation berarti Dokumen Push, beda Workstation berarti BSTB (W64).
3. Admin menandai Checkpoint; sementara hanya pada keluar Barcoding (W71).
4. Boleh Dilewati tersimpan tetapi belum berpengaruh (W91).
5. Satu line boleh punya banyak routing (W35). Begitu dipakai partai, langkahnya terkunci; urutan baru berarti routing baru.

Isi awal:

| Routing | Urutan |
| --- | --- |
| Pra-partai | UGH → UPC → UPY |
| Reguler | UPW → UCL → UC1 → USR → UDA → UMG → UMP → UDB → UWP → UBC (Checkpoint) → UP5 |

Output: urutan untuk Dokumen Push, BSTB, dan Dokumen Reproses.

**[Plan UI & UX]**

- **Layout:** header di atas, satu tabel langkah berurutan di bawah.
- **Akibat terlihat:** kolom Keluar Lewat berubah seketika saat urutan diubah, jadi admin melihat akibatnya sebelum menyimpan.
- **Terkunci:** routing yang dipakai menampilkan chip Terkunci, langkahnya berupa teks, dan ada aksi membuat routing baru dari salinannya.
- **Validasi:** routing pra-partai yang tidak berakhir di Penyebaran dan Checkpoint lebih dari satu tampil di barisnya.
- **Kosong:** selama Unit kosong, halaman mengarahkan ke menu Unit.

---

## Kelompok: Master Pendukung

### 5. Karyawan

**Deskripsi & Penjelasan Singkat**

Menu admin untuk daftar pekerja yang bisa dipilih di Pengerjaan Unit. Fungsinya mencatat siapa mengerjakan Job apa, sebagai informasi unit (W26). Tidak ada biaya tenaga kerja di sini.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Daftar Karyawan | Menampilkan semua pekerja | Nama, Status |
| Form Karyawan | Membuat dan mengubah | Nama, Status |

**[Cara Kerja Menu]**

1. Admin menambah Karyawan.
2. Karyawan aktif muncul sebagai pilihan di Pengerjaan Unit.
3. Karyawan tidak dihapus, hanya dinonaktifkan.

Output: pilihan karyawan untuk Pengerjaan Unit.

**[Plan UI & UX]**

- **Layout:** daftar dengan pencarian nama dan filter Status; form satu kartu.
- **Kosong:** ajakan menambah, karena Pengerjaan Unit tidak bisa diposting tanpa karyawan.

### 6. Flag BJL

**Deskripsi & Penjelasan Singkat**

Penanda pada master Item yang menyatakan jenis itu BJL: selalu bernilai 0, tetapi tetap menyumbang qty dan gram (W32). Ini satu isian di form Item, bukan halaman sendiri. Flag ini menentukan siapa menerima nilai pada setiap pembagian.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Saklar BJL | Menandai Item | Ya/Tidak, hanya Barang |
| Status Terkunci | Menyatakan flag tidak bisa diubah | Chip dan alasannya |

**[Cara Kerja Menu]**

1. Admin menandai flag pada Item bertipe Barang.
2. Flag terkunci begitu Item dipakai di produksi; perubahan sesudahnya ditolak (A20).
3. Dokumen Grading, Pengerjaan Unit dan BSTB Pengeluaran membaca flag ini saat membagi nilai.

Output: penanda untuk pembagian nilai W32.

**[Plan UI & UX]**

- **Layout:** satu saklar di form Item, dengan keterangan "Selalu bernilai 0, gram tetap dihitung".
- **Terkunci:** saklar menjadi teks dengan chip Terkunci.

---

## Kelompok: Standard Cost

### 7. Standard Cost

**Deskripsi & Penjelasan Singkat**

Menu untuk menetapkan rate per gram tiap unit dalam versi yang tidak bisa diedit. Hanya satu versi aktif, jadi operator tidak memilih rate. Menu ini dibaca setiap kali biaya unit dihitung dan menjadi pembanding saat Closing.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Daftar Versi | Menampilkan seluruh riwayat versi | Nomor versi, Status, Tanggal dibuat, Pembuat |
| Form Versi Baru | Mengisi rate semua unit | Unit, Rate per gram |
| Detail Versi | Menampilkan versi tersimpan sebagai teks | Rate per unit, Status |

**[Cara Kerja Menu]**

1. Pengguna membuat versi baru dan mengisi rate. Unit yang kosong berarti 0 (W17). UMG dan UMP punya rate masing-masing (W68).
2. Menyimpan versi otomatis menutup versi aktif dan mengaktifkan versi baru. Versi yang ditutup tidak bisa dibuka lagi (W36).
3. Versi tidak bisa diedit dan tidak punya tanggal berlaku.
4. Barang memakai versi yang terkunci padanya, sehingga menutup versi tidak mengubah barang berjalan:

| Barang | Versi yang dipakai |
| --- | --- |
| Pra-partai | Aktif saat No. Stok mulai di Grading Halus |
| Sesudah partai sampai Barcoding | Aktif saat partai terbentuk |

Output: versi aktif untuk Dokumen Grading, Pengerjaan Unit dan BSTB Penyebaran.

**[Plan UI & UX]**

- **Layout:** daftar versi dengan versi aktif di paling atas.
- **Form:** satu tabel berisi semua unit, urut routing, dengan satu kolom rate enam desimal.
- **Konfirmasi:** menyebut versi aktif yang akan ditutup permanen, karena versi tersimpan tidak bisa diubah.
- **Kosong:** sebelum ada versi aktif, halaman memberi tahu bahwa biaya unit tidak bisa dihitung.

---

## Kelompok: Masuk Produksi

### 8. BSTB Issue

**Deskripsi & Penjelasan Singkat**

Dokumen pengiriman barang dari Gudang ke unit, dan satu-satunya gerbang masuk produksi. Admin Bahan Baku mengajukan, unit penerima menerima. Menu ini adalah titik awal flow.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Header | Menyatakan tujuan pengiriman | No. BSTB, Tanggal, Tujuan Pemakaian, Gudang, Unit Tujuan, Catatan |
| Baris Barang | Menyatakan apa yang dikirim | Item, Qty, Gram, No. Stok yang diambil |
| Pilih No. Stok | Memilih stok | No. Stok, saldo tersedia |
| Status dan Terima | Posisi dokumen dan konfirmasi penerima | Draft, Diajukan, Diterima; penerima dan tanggal Terima |

**[Cara Kerja Menu]**

1. Admin Bahan Baku membuat Draft dan memilih Tujuan Pemakaian. Cold Storage dicatat sebagai Gudang (W41).
2. **Bahan ke Produksi** hanya boleh ke unit pertama routing, yaitu Grading Halus. **Bahan Penolong** boleh ke unit mana pun (W37).
3. **Ajukan** memeriksa stok dan mengunci barang sebagai reservasi, sehingga dokumen lain tidak bisa mengambilnya (W37).
4. Unit penerima melakukan **Terima**, tanpa QC (W46).
5. Buku bergerak dengan nilai MAC (V8) dan tanggal dokumen, walau Terima dilakukan hari lain (W37).
6. Jurnal: Dr WIP / Cr Persediaan.
7. Bahan ke Produksi masuk Persiapan unit. Bahan penolong menjadi saldo unit, bukan isi partai (A1).

Output: barang untuk Dokumen Grading; saldo bahan penolong untuk Dokumen Grading dan Pengerjaan Unit. Skenario: A1.

**[Plan UI & UX]**

- **Layout:** daftar dokumen dengan filter Status dan Unit Tujuan; form header lalu tabel baris.
- **Antrean Terima:** penerima membuka daftar tersaring "Menunggu Terima" untuk unitnya.
- **Pilih No. Stok:** dialog daftar No. Stok berikut saldo yang masih bebas dari reservasi.
- **Unit Tujuan:** untuk Bahan ke Produksi terisi otomatis dan terkunci.
- **Validasi:** qty melebihi saldo tampil di baris dan menahan Ajukan.
- **Kosong:** picker kosong menyebut "Belum ada stok untuk Item ini di Gudang".

---

## Kelompok: Pengerjaan di Unit

### 9. Dokumen Grading

**Deskripsi & Penjelasan Singkat**

Dokumen Eksekusi Produksi untuk unit bertipe Grading: UGH, UPY, UDA, UMG, UDB dan UBC. Operator mencatat satu No. Stok input menjadi output baru, dan di sinilah jenis serta gram berubah. Menu ini mengubah Persiapan menjadi hasil yang menunggu QC Check atau Stand By.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Header | Identitas pengerjaan | No. Grading, Unit, Tanggal, Partai dan Job (teks) |
| Input | Menyatakan yang digrading | Satu baris Persiapan, gram diambil, sisa saldo, tanda Balik QC |
| Output | Menyatakan hasil | Item, Qty, Gram, No. Stok baru (otomatis), penanda BJL |
| Bahan Penolong | Memakai saldo unit | Item, Qty, nilai |
| Ringkasan Nilai | Pratinjau hitungan | Nilai input, biaya unit, bahan penolong, susut gram, nilai per output |
| Catatan Pre Cleaning | Referensi di Penyebaran | Jenis dan berat (teks) |

**[Cara Kerja Menu]**

1. Operator memilih **satu** baris dari Persiapan unit, sebab 1 No. Stok input = 1 No. Grading (W25).
2. Operator mengisi gram diambil. Boleh sebagian; sisanya tetap saldo. Satu No. Stok yang diambil dua kali menghasilkan dua No. Grading (A11).
3. Operator mengisi output. Jenis boleh tetap atau berubah, dan gram boleh berubah (W47). Tiap output selalu No. Stok baru `<induk>-<n>`, berlanjut lintas pengambilan (W60).
4. Bila perlu, operator memakai bahan penolong dari saldo unit: terpakai = round(V × q ÷ Q). Ia menambah nilai, bukan gram (W19, W75).
5. Posting menghitung biaya unit S = gram input × rate versi terkunci (V1). Gram BJL ikut dihitung (W32). Baris Balik QC kena V1 lagi, dan biaya ulang itu tercatat pada No. Stok dan dokumennya (W66).
6. Nilai input + S + bahan penolong dibagi ke output non-BJL menurut gram, dalam lingkup satu No. Grading (V3).
7. Jurnal: Dr WIP / Cr Biaya Produksi Dibebankan untuk biaya unit; Dr WIP output / Cr WIP input hanya bila akunnya berbeda. **Bila semua output BJL:** Dr Beban Pemusnahan Produksi / Cr WIP.
8. Output masuk QC Check bila unitnya punya; Penyebaran langsung ke Stand By (W65).

Perilaku per unit:

| Unit | Identitas | Catatan |
| --- | --- | --- |
| UGH | No. Job belum ada | Versi rate dicatat saat No. Stok mulai di sini |
| UPY | No. Job lepas | Membaca catatan Pre Cleaning; hasil grading memvalidasinya (W42) |
| UDA | No. Job tetap | Susut gram terlihat |
| UMG | No. Job lepas, Partai tetap | QC Moulding sesudahnya (W70) |
| UDB | No. Job Moulding dan Job Order lepas, Partai tetap | No. Job baru terbit di BSTB Transfer |
| UBC | No. Job dibawa | 1 No. Stok = 1 pcs dengan gram final; input baris per baris (W16) |

Output: hasil untuk QC Check, atau Stand By untuk BSTB Penyebaran. Skenario: A3, A10, A11, A18, A19, A23.

**[Plan UI & UX]**

- **Layout:** pengguna memilih unit, lalu melihat daftar Persiapan unit itu. Tombol Grading pada satu baris membuka form dengan input terisi.
- **Form:** kartu input di atas, tabel output di tengah, bahan penolong di tab kedua, Ringkasan Nilai di bawah. Ringkasan berubah seketika saat gram diketik.
- **Tanda BJL:** baris output ber-Item BJL menampilkan chip BJL dan nilai 0, sehingga operator tidak mengira ada salah hitung.
- **Peringatan:** bila semua output BJL, form menyatakan nilainya masuk Beban Pemusnahan Produksi sebelum Posting.
- **Validasi:** gram diambil melebihi saldo tampil di kartu input; output kosong menahan Posting.
- **Barcoding:** tabel output dioptimalkan untuk ketik cepat, Enter menambah baris, dengan penghitung pcs dan total gram selalu terlihat. Volume ±5.000 pcs harus diuji sejak awal (§16).
- **Kosong:** "Belum ada barang di Persiapan unit ini".

### 10. Pengerjaan Unit

**Deskripsi & Penjelasan Singkat**

Dokumen Eksekusi Produksi untuk unit Pass Through: UPC, UPW, UCL, UC1, USR, UMP dan UWP. Operator menyatakan Job sudah dikerjakan dan oleh siapa; barang dan gramnya tetap, hanya nilainya bertambah. Menu ini mengubah Persiapan menjadi hasil yang menunggu QC Check atau Stand By.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Header | Identitas pengerjaan | No. KRJ, Unit, Tanggal, Partai (teks) |
| Daftar Job | Menyatakan Job yang dikerjakan | No. Job, No. Stok, gram, tanda Balik QC, Karyawan |
| Bahan Penolong | Menambah nilai pada Job | No. Job, Item, Qty, nilai |
| Catatan Hasil | Khusus Pre Cleaning | Jenis, berat |
| Ringkasan Biaya | Pratinjau hitungan | Total gram, biaya unit, bahan penolong |

**[Cara Kerja Menu]**

1. Operator memilih satu atau beberapa No. Job dari Persiapan (W74).
2. Tiap No. Job wajib punya **tepat satu karyawan**; Job tanpa karyawan ditolak (A13). Catatan ini milik pengerjaan, tidak melekat ke No. Job, tanpa gram per karyawan dan tanpa biaya (W26).
3. Pengerjaan boleh bertahap; biaya masuk periode tanggal Posting (§8).
4. Bahan penolong boleh ditambahkan pada satu Job: nilainya masuk Job itu, gram tetap, saldo unit berkurang (W75, A28).
5. Di Pre Cleaning operator mengisi catatan hasil. Catatan tidak mengubah jenis maupun No. Job, dan dibawa ke Penyebaran (W6, W42).
6. Posting menghitung S = gram × rate versi terkunci (V1), lalu membaginya ke No. Stok non-BJL menurut gram (V2). Baris Balik QC kena V1 lagi (W66).
7. Jurnal: Dr WIP / Cr Biaya Produksi Dibebankan.
8. UPC, UPW, UCL dan UWP masuk QC Check. UC1, USR dan UMP langsung ke Stand By (W65).

Output: hasil untuk QC Check, atau Stand By untuk perpindahan. Skenario: A13, A14, A28.

**[Plan UI & UX]**

- **Layout:** pengguna memilih unit dan melihat Persiapan, dikelompokkan per partai lalu per Job, dengan centang per Job.
- **Satu partai:** begitu Job pertama dicentang, Job partai lain menjadi nonaktif, sehingga aturan ini tidak perlu berakhir sebagai pesan penolakan.
- **Karyawan:** picker dengan pencarian di tiap baris, plus aksi mengisi karyawan yang sama ke semua baris terpilih.
- **Catatan Hasil:** kartu ini hanya muncul di Pre Cleaning.
- **Validasi:** baris tanpa karyawan ditandai dan menahan Posting.
- **Balik QC:** baris bertanda chip dan menyebut nomor QCK, serta peringatan bahwa biaya unit akan masuk lagi.
- **Kosong:** "Belum ada barang di Persiapan unit ini".

### 11. QC Check

**Deskripsi & Penjelasan Singkat**

Dokumen pemeriksaan QC atas hasil proses di unit yang punya QC. QC hanya memvalidasi: boleh lanjut, atau harus dikerjakan ulang. Menu ini berada di antara pengerjaan dan Stand By.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Antrean | Menampilkan hasil yang menunggu | Unit, Partai, No. Stok, gram, Dokumen Eksekusi asal |
| Keputusan Baris | Memutuskan tiap baris | OK atau Balik, Alasan |
| Header | Identitas pemeriksaan | No. QCK, Unit, Tanggal, Pemeriksa |

**[Cara Kerja Menu]**

1. Hasil proses masuk tahap QC Check. Unit ber-QC: Grading Halus, Pre Cleaning, Pre Wash, Cleaning (QC Cabut), Dry A, Moulding (grading) yaitu QC Moulding, Dry B, Wrapping (mencakup WIP Steam), Barcoding (QC Final Grading).
2. QC memutuskan **utuh per baris** (W65, W87). Semua hasil ikut, termasuk BJL.
3. Alasan Balik opsional. Uji lab bukan langkah tersendiri, hanya salah satu dasar keputusan QC (W70).
4. Posting: **OK** masuk Stand By. **Balik** kembali ke Persiapan unit yang sama sebagai baris sendiri, dengan tanda Balik QC dan nomor QCK (W66).
5. Tanpa jurnal; biaya ulang masuk saat barang diproses lagi.
6. QC tidak memutuskan Reproses atau Reject; keduanya milik unit, sesudah barang di-Balik (W77).

Output: Stand By untuk perpindahan; baris Balik QC untuk kerja ulang, Dokumen Reproses, atau BSTB Pengeluaran. Skenario: A25, A26.

**[Plan UI & UX]**

- **Layout:** antrean per unit dengan jumlah baris menunggu; QC memilih satu partai lalu membuka formnya.
- **Keputusan:** dua tombol OK dan Balik pada tiap baris, plus aksi menandai sisanya OK. Posting ditahan sampai semua baris punya keputusan.
- **Balik:** baris Balik diberi warna peringatan dan kolom alasan terbuka, tanpa wajib diisi.
- **Keterangan baris:** QC melihat gram dan dokumen asal, supaya bisa mencocokkan dengan barang fisik.
- **Kosong:** "Tidak ada hasil yang menunggu QC di unit ini".

---

## Kelompok: Perpindahan Antar Unit

### 12. Dokumen Push

**Deskripsi & Penjelasan Singkat**

Dokumen jejak perpindahan antar unit dalam satu Workstation, tanpa Terima. Di sini No. Job pertama, No. Job Moulding dan Job Order lahir, dan Checkpoint keluar Barcoding ditegakkan. Menu ini menghubungkan Stand By satu unit dengan Persiapan unit berikutnya.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Header | Identitas perpindahan | No. PSH, Unit Asal, Unit Tujuan (otomatis), Tanggal, Partai (teks) |
| Baris Barang | Menyatakan yang dipindah | No. Stok, No. Job, gram tersedia, gram dipindah |
| No. Job Baru | Menampilkan Job yang akan terbit | Pengambilan, No. Job |
| Job Order | Khusus keluar UMG | No. Job Moulding, Target (Item), No. JO |
| Panel Checkpoint | Khusus keluar UBC | Isi partai, posisi tiap bagian, status siap |

**[Cara Kerja Menu]**

1. Pengguna memilih Unit Asal. Menu ini hanya untuk pasangan satu Workstation (W64).
2. Pengguna memilih barang dari **Stand By** saja (W29). Sebelum keluar Barcoding boleh sebagian isi partai (W71).
3. Kelahiran identitas mengikuti Unit Asal:

| Unit Asal | Yang terjadi |
| --- | --- |
| UGH | No. Job pertama terbit; 1 pengambilan 1 No. Stok = 1 No. Job (W31, W58) |
| UMG | No. Job Moulding terbit per pengambilan; tiap No. Job membawa satu Job Order `JO_…` dengan target Item (W68, W69) |
| UBC | Checkpoint (langkah 5) |
| Lainnya | No. Job dibawa |

4. Satu Dokumen Push boleh membawa beberapa No. Job dengan target berbeda. Target tidak memaksa jenis; jenis berubah lewat grading Dry B (W69).
5. **Checkpoint keluar Barcoding.** Dokumen wajib berisi seluruh isi partai, dihitung sesudah dikurangi barang yang sudah keluar produksi. Ditolak bila ada isi yang belum dikerjakan, sedang di QC Check, Balik QC, atau sedang reproses (W71, W80).
6. **Posting** memindahkan barang ke Persiapan unit tujuan, tanpa QC, tanpa Terima, tanpa jurnal (W58).

Output: Persiapan unit berikutnya. Keluar Barcoding berhenti di Persiapan UP5 (W81). Skenario: A12, A15, A17, A21, A27.

**[Plan UI & UX]**

- **Layout:** daftar dokumen per unit; form dibuka dari Stand By unit, dengan barang yang dicentang langsung menjadi baris.
- **Tujuan:** tampil sebagai teks "Tujuan: Pre Cleaning (otomatis)", tanpa pilihan, supaya tidak ada salah kirim.
- **Pengambilan:** gram dipindah terisi penuh dan bisa dikurangi; sisa di Stand By terlihat di baris.
- **Job Order:** kolom Target muncul hanya saat Unit Asal UMG, memakai picker Item, wajib per No. Job.
- **Panel Checkpoint:** menampilkan bagian partai yang belum siap beserta unit, tahap dan tautan dokumennya. Tombol Posting nonaktif dengan alasan tertulis, karena operator perlu tahu apa yang menahan.
- **Kosong:** "Belum ada barang di Stand By unit ini".

### 13. BSTB Penyebaran

**Deskripsi & Penjelasan Singkat**

Dokumen pengiriman keluar Penyebaran ke Pre Wash, tempat partai lahir. Ia mengakhiri segmen pra-partai dan memulai segmen berpartai (W39). Yang dikirim bersama menjadi satu partai (W73).

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Header | Identitas pengiriman | No. BSTB, Unit Asal, Unit Tujuan (otomatis), Tanggal |
| Pembentukan Partai | Menetapkan atribut partai | Line, Routing, Standard Cost aktif (teks) |
| Baris Barang | Menyatakan yang dikirim | No. Stok, gram tersedia, gram dikirim |
| No. Job Baru | Menampilkan Job yang akan terbit | Pengambilan, No. Job |
| Status dan Terima | Posisi dokumen dan konfirmasi penerima | Draft, Diajukan, Diterima; No. Partai, penerima |

**[Cara Kerja Menu]**

1. Pengguna memilih Line dan Routing milik Line itu (W35).
2. Pengguna memilih barang dari Stand By Penyebaran. Boleh sebagian qty: sisanya tetap saldo No. Stok yang sama, dan satu No. Stok boleh ada di beberapa partai (A2, §6).
3. Pengguna melakukan **Ajukan**.
4. Pre Wash melakukan **Terima**. Saat itu No. Partai `P_<ddmmyy>_<NNNNN>` lahir (W88): 1 BSTB = 1 partai = 1 line.
5. Partai menyimpan routing dan Standard Cost aktif (W35, W36).
6. No. Job baru terbit saat Terima, per pengambilan (W31, W88).
7. Barang masuk Persiapan Pre Wash, tanpa jurnal.

Output: partai di Persiapan Pre Wash, untuk Pengerjaan Unit. Skenario: A2, A22.

**[Plan UI & UX]**

- **Layout:** daftar dokumen dengan filter Status; form dengan kartu Pembentukan Partai di atas baris.
- **Routing:** picker hanya menawarkan milik Line terpilih; Standard Cost tampil sebagai teks.
- **Antrean Terima:** Pre Wash membuka daftar "Menunggu Terima".
- **Konfirmasi Ajukan:** menyatakan barang terkunci, dokumen tidak bisa dibatalkan, dan partai baru terbentuk saat Terima.
- **Terima:** penerima melihat isi dokumen sebagai teks dan satu tombol, tanpa kolom selisih.
- **Kosong:** "Belum ada barang di Stand By Penyebaran".

### 14. BSTB Transfer

**Deskripsi & Penjelasan Singkat**

Dokumen perpindahan antar unit lintas Workstation untuk barang yang sudah berpartai. Menu ini dipakai di dua pasangan: Sortir → Dry A dan Dry B → Wrapping. Barang berpindah saat unit tujuan Terima.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Header | Identitas perpindahan | No. BSTB, Unit Asal, Unit Tujuan (otomatis), Tanggal, Partai (teks) |
| Baris Barang | Menyatakan yang dipindah | No. Stok, No. Job, gram tersedia, gram dipindah |
| No. Job Baru | Khusus keluar UDB | Pengambilan, No. Job |
| Status dan Terima | Posisi dokumen dan konfirmasi penerima | Draft, Diajukan, Diterima; penerima |

**[Cara Kerja Menu]**

1. Pengguna memilih Unit Asal. Menu ini hanya untuk pasangan beda Workstation (W64).
2. Pengguna memilih barang dari Stand By; boleh sebagian qty (W71). Tanpa QC (W67).
3. Pengguna melakukan **Ajukan**, lalu unit tujuan melakukan **Terima**. Barang masuk Persiapan, tanpa jurnal.
4. Perilaku menurut Unit Asal:

| Unit Asal | Yang terjadi |
| --- | --- |
| USR | No. Job dibawa |
| UDB | No. Job baru `UDB` terbit saat Terima, per pengambilan (W68, W88) |

5. Barang salah kirim tidak punya jalan balik; ia diterima dulu lalu dikoreksi sesudahnya (§16).

Output: Persiapan Dry A atau Wrapping. Skenario: A15, A22, A27.

**[Plan UI & UX]**

- **Layout:** daftar dokumen dengan filter Status dan Unit; antrean "Menunggu Terima" untuk unit tujuan.
- **Tujuan:** teks otomatis, tanpa pilihan.
- **Konfirmasi Ajukan:** menyatakan barang terkunci dan dokumen tidak bisa dibatalkan.
- **Terima:** isi dokumen sebagai teks dan satu tombol, tanpa kolom selisih.
- **Kosong:** "Belum ada barang di Stand By unit ini".

### 15. Dokumen Reproses

**Deskripsi & Penjelasan Singkat**

Dokumen pemindahan barang Balik QC mundur ke unit sebelumnya pada routing, keputusan milik unit asal. Barang kemudian berjalan maju lagi seperti barang biasa. Menu ini menyambung baris Balik QC dengan pengerjaan di unit tujuan.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Header | Identitas | No. RPR, Unit Asal, Unit Tujuan, Tanggal, Partai (teks), Mode (otomatis) |
| Baris Barang | Menyatakan yang direproses | Baris Balik QC, No. QCK, gram tersedia, gram direproses |
| Alasan | Menjelaskan masalah | Teks, opsional |
| Status dan Terima | Hanya bila lintas Workstation | Draft, Diajukan, Diterima |

**[Cara Kerja Menu]**

1. Dokumen boleh dibuat dari semua unit ber-QC, hanya atas baris **Balik QC** di Persiapan. Barang yang belum Balik QC ditolak (W78, A32).
2. Unit Tujuan bebas ke unit mana pun sebelumnya pada routing yang sama; unit sesudahnya ditolak (W83, A32). Boleh sebagian qty (§9).
3. Mode dihitung otomatis: satu Workstation seperti Dokumen Push (Posting), lintas Workstation seperti BSTB tanpa QC (Ajukan, lalu Terima) (W64, W78).
4. Barang masuk Persiapan unit tujuan tanpa tanda Balik QC (W89), tetap di partainya, dan No. Stok tetap sampai digrading ulang (§9). Tanpa jurnal.
5. Dari sana barang maju mengikuti routing dengan semua aturan unit. Biaya unit masuk lagi di tiap unit yang dilewati, memakai versi partai (V9).
6. Barang yang melewati UMG mendapat No. Job Moulding dan Job Order baru; barang yang langsung ke UMP tidak membawa Job Order (§9).
7. Sisa partai tidak menunggu; ia lanjut sampai Barcoding dan tertahan di Checkpoint sampai barang reproses menyusul (W80).

Output: Persiapan unit tujuan. Skenario: A6, A30, A32.

**[Plan UI & UX]**

- **Layout:** dibuka dari baris Balik QC di Persiapan unit, tempat unit memutuskan kerja ulang, Reproses, atau Reject.
- **Unit Tujuan:** picker hanya menawarkan unit sebelumnya pada routing, urut terdekat dulu. Tidak ada daftar masalah baku karena aturan lapangan belum baku (W78).
- **Mode:** tampil sebagai teks dan menentukan tombol: Posting, atau Ajukan.
- **Konfirmasi:** menyebut unit yang akan dilewati ulang dan bahwa biaya unitnya masuk lagi.
- **Kosong:** "Tidak ada barang Balik QC di unit ini".

---

## Kelompok: Keluar Produksi

### 16. BSTB Pengeluaran

**Deskripsi & Penjelasan Singkat**

Dokumen pengeluaran barang dari produksi ke Logistik di luar jalur normal, dari unit mana saja. Alasannya menentukan nilai keluar dan ke mana nilainya pergi. Keputusan mengeluarkan barang milik unit, termasuk kasus parah sesudah Balik QC.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Header | Identitas dan alasan | No. BSTB (kode unit asal, W85), Unit Asal, Tanggal, Alasan, Partai (teks), Gudang Tujuan |
| Baris Barang | Menyatakan yang keluar | No. Stok, Tahap, gram tersedia, gram keluar, tanda Balik QC |
| Dampak Nilai | Pratinjau | Nilai keluar, nilai diserap sisa partai, jurnal bila ada |
| Status dan Terima | Posisi dokumen | Draft, Diajukan, Diterima |

**[Cara Kerja Menu]**

1. Pengguna memilih barang dari **Persiapan atau Stand By**, boleh sebagian qty (W29, §9).
2. Alasan menentukan perhitungan:

| Alasan | Nilai keluar | Ke mana nilainya | Jurnal |
| --- | --- | --- | --- |
| Reject | 0 | Diserap sisa isi partai non-BJL menurut gram | Tanpa jurnal bila akun WIP sama |
| Reject tanpa penyerap | 0 | Beban Pemusnahan Produksi (W32, W84) | Dr Beban Pemusnahan Produksi / Cr WIP |
| Hasil samping (BJL, waste) | 0 | Sudah 0 sejak grading (W12) | Tidak ada |
| Sisa bahan penolong | Nilai bucketnya | Kembali ke Persediaan (V8) | Dr Persediaan / Cr WIP |

3. **Ajukan**, lalu Logistik melakukan **Terima** (W85). Barang membawa No. Stok dan partai asalnya (§9).
4. Reject tercatat per partai sebagai susut, untuk laporan Susut per Partai.
5. Barang yang sudah keluar tidak lagi dihitung sebagai isi partai saat Checkpoint (§8).

Output: stok di Logistik. Skenario: A5, A16, A31.

**[Plan UI & UX]**

- **Layout:** daftar dokumen dengan filter Alasan dan Unit; form dibuka dari Persiapan, Stand By, atau baris Balik QC.
- **Alasan dulu:** Alasan dipilih sebelum baris, karena menentukan barang yang boleh dipilih dan isi Dampak Nilai.
- **Dampak Nilai:** untuk Reject, form menyatakan besar nilai yang diserap dan HPP per gram sisa partai sesudahnya, karena kerugian ini tidak terlihat sebagai beban (§16).
- **Peringatan:** bila Reject tak punya penyerap, form menyebut akun Beban Pemusnahan Produksi sebelum Ajukan.
- **Kosong:** "Tidak ada barang yang bisa dikeluarkan dari unit ini".

---

## Kelompok: Biaya

### 17. Jenis Biaya

**Deskripsi & Penjelasan Singkat**

Menu master untuk mengelompokkan biaya produksi aktual dan menunjuk akun bebannya. §12 menetapkannya "tetap", jadi rincian di bawah mengikuti P201. Akun-akun ini menjadi sumber Aktual saat Closing.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Daftar Jenis Biaya | Menampilkan semua jenis | Kode, Nama, Akun, Status |
| Form Jenis Biaya | Membuat dan mengubah | Kode, Nama, Akun Beban |

**[Cara Kerja Menu]**

1. Pengguna membuat Jenis Biaya dan memilih akun bebannya. Akun tetap setelah dipilih (P201).
2. Tagihan Biaya memakai Jenis Biaya pada tiap barisnya.
3. Closing membaca debit bersih akun-akun ini sebagai Aktual (§10).

Output: Jenis Biaya untuk Tagihan Biaya dan Closing.

**[Plan UI & UX]**

- **Layout:** daftar satu tabel, form satu kartu.
- **Akun:** picker akun beban.
- **Kosong:** ajakan membuat, karena Tagihan Biaya membutuhkannya.

### 18. Tagihan Biaya

**Deskripsi & Penjelasan Singkat**

Dokumen pencatatan biaya produksi aktual dari supplier. Menu ini tidak menyentuh barang; ia hanya mengisi sisi Aktual pada Closing. §12 menetapkannya "tetap", jadi rincian di bawah mengikuti P202.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Header | Identitas tagihan | Nomor, Supplier, Tanggal |
| Baris Biaya | Rincian biaya | Jenis Biaya, Jumlah |
| Total dan Status | Ringkasan | Total, Draft atau Posted |

**[Cara Kerja Menu]**

1. Pengguna membuat Draft tagihan dengan supplier dan baris biaya.
2. Posting menulis jurnal Dr akun Jenis Biaya / Cr Hutang Biaya Produksi. Nomor mengikuti P15, karena dokumen ini tidak terikat unit (§6).
3. Bahan penolong tidak lewat menu ini; nilainya masuk WIP lewat BSTB Issue (§10).
4. Biaya Packing yang ditagih tetap dicatat di sini dan masuk varians (W82).

Output: debit akun Jenis Biaya untuk Closing. Pembayaran di Finance.

**[Plan UI & UX]**

- **Layout:** daftar tagihan dengan filter Status dan Supplier; form header lalu tabel baris.
- **Validasi:** baris tanpa Jenis Biaya atau jumlah nol ditandai di barisnya.
- **Kosong:** "Belum ada tagihan biaya".

### 19. Closing Costing Produksi

**Deskripsi & Penjelasan Singkat**

Proses akhir bulan yang membandingkan biaya Aktual dan Standar, lalu mencatat selisihnya sebagai varians. Closing tidak menyentuh WIP maupun stok, dan mengunci periode. Menu ini menutup siklus biaya bulanan.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Daftar Periode | Menampilkan status tiap bulan | Periode, Status, Tanggal closing |
| Checklist | Memeriksa kesiapan | Tiap syarat, hasil, dokumen penahan |
| Angka Closing | Hitungan | Aktual, Standar, Varians |

**[Cara Kerja Menu]**

1. Satu bulan satu Closing (§10). Pengguna membuka periode dan melihat Checklist.
2. Checklist memakai syarat P210, ditambah tidak ada BSTB yang belum Terima, tidak ada Dokumen Push yang masih Draft (§10), dan dokumen lain di W90.
3. Sistem menghitung:

| Angka | Sumber |
| --- | --- |
| Aktual (A) | Debit bersih periode pada akun Jenis Biaya, dari Tagihan Biaya dan jurnal manual |
| Standar (S) | Σ biaya unit periode = kredit Biaya Produksi Dibebankan |
| Varians | A − S |

4. Jurnal: bila A > S, Dr Varians Produksi / Cr Biaya Produksi Dibebankan. Bila A < S, kebalikannya. Akun varians milik Line.
5. Sesudahnya akun biaya dikurangi Biaya Produksi Dibebankan = 0.
6. Closing final dan mengunci periode; WIP dan stok tidak berubah (W23). Bahan penolong tidak ikut (§10).
7. Dengan satu line, seluruh A dan S milik Reguler, termasuk pra-partai (§10).
8. Tahun buku tidak bisa ditutup selama ada periode beraktivitas produksi yang belum di-Closing (§12, R28).

Output: jurnal varians dan periode terkunci. Skenario: A7.

**[Plan UI & UX]**

- **Layout:** daftar periode; satu halaman per periode berisi Checklist, Angka Closing, lalu tombol Closing.
- **Checklist:** tiap syarat gagal menautkan ke dokumen penahannya. Tombol Closing nonaktif selama ada yang gagal, dengan alasan tertulis.
- **Konfirmasi:** menampilkan jurnal varians dan menyatakan Closing final serta periode terkunci.
- **Kosong:** periode tanpa aktivitas menyatakan tidak ada yang perlu dihitung.

### 20. Proyeksi Varians

**Deskripsi & Penjelasan Singkat**

Laporan yang menjalankan kalkulasi Closing tanpa menulis apa pun (§10). Fungsinya memberi gambaran varians sebelum akhir bulan. Menu ini menggantikan Costing Sementara.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Parameter | Memilih titik hitung | Sampai Tanggal |
| Angka Proyeksi | Hasil hitung | Aktual, Standar, Varians |

**[Cara Kerja Menu]**

1. Pengguna memilih tanggal dalam periode yang masih terbuka.
2. Sistem menjalankan hitungan Closing sampai tanggal itu, dari sumber yang sama.
3. Tidak ada jurnal dan tidak ada penguncian.
4. Periode yang sudah di-Closing menyatakan hal itu dan menunjuk ke Closing-nya.

Output: informasi. Skenario: A7 sebagai pembanding.

**[Plan UI & UX]**

- **Layout:** satu halaman laporan, parameter di atas, tanggal diisi hari ini.
- **Penanda:** judul menyebut "Sementara", supaya angkanya tidak dikira final.
- **Kosong:** "Tidak ada aktivitas sampai tanggal ini".

---

## Kelompok: Laporan

### 21. Saldo Produksi

**Deskripsi & Penjelasan Singkat**

Laporan posisi barang di produksi pada satu tanggal. PPIC melihat di mana saja isi partai berada, termasuk bagian yang belum sampai (§16). Laporan ini membaca buku produksi dan tidak menulis apa pun.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Parameter | Membatasi laporan | Tanggal, Unit, Partai, pengelompokan |
| Tabel Saldo | Menampilkan posisi | Unit, Tahap, Partai, Job, No. Stok, gram, nilai, tanda Balik QC |

**[Cara Kerja Menu]**

1. Pengguna memilih tanggal dan pengelompokan Per Unit atau Per Partai.
2. Sistem membaca saldo per bucket pada tanggal itu.
3. Total nilai per kelompok ditampilkan; HPP per gram hanya hasil hitung (§7).

Output: informasi.

**[Plan UI & UX]**

- **Layout:** parameter di atas, tabel berkelompok yang bisa dibuka dan ditutup.
- **Per Partai:** menunjukkan semua unit dan tahap tempat isi partai berada.
- **Tautan:** No. Stok menuju Kartu No. Stok.
- **Kosong:** "Tidak ada saldo pada tanggal ini".

### 22. Kartu No. Stok

**Deskripsi & Penjelasan Singkat**

Laporan riwayat satu No. Stok, dari produksi sampai stok. Pengguna melihat setiap gerakan dan dokumennya. Laporan ini menjawab apa yang terjadi pada satu No. Stok.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Parameter | Memilih No. Stok | No. Stok, Periode |
| Tabel Gerakan | Menampilkan riwayat | Tanggal, dokumen, unit, tahap, gerakan, saldo |

**[Cara Kerja Menu]**

1. Pengguna mengetik atau memilih No. Stok.
2. Sistem menampilkan seluruh gerakan, termasuk Dokumen Push (A21) dan biaya ulang Balik QC (W66).

Output: informasi. Skenario: A21.

**[Plan UI & UX]**

- **Layout:** parameter di atas, satu tabel urut tanggal.
- **Tautan:** nomor dokumen menuju dokumennya; tombol Telusur menuju menu Telusur.
- **Kosong:** "No. Stok tidak ditemukan".

### 23. Susut per Partai

**Deskripsi & Penjelasan Singkat**

Laporan gram dan nilai per partai, menggantikan Rekap Produksi (§12). Reject diserap sisa partai sehingga tidak terlihat sebagai beban; di sinilah kerugian itu terlihat (§16).

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Parameter | Membatasi laporan | Periode, Partai |
| Ringkasan Partai | Angka per partai | Gram masuk, gram keluar, Reject, susut, HPP per gram |
| Rincian per Unit | Susut per unit | Unit, gram masuk, gram keluar, susut |

**[Cara Kerja Menu]**

1. Pengguna memilih periode atau partai.
2. Sistem menghitung gram masuk dan keluar per unit dari buku produksi.
3. Reject dan pengeluaran lain dari BSTB Pengeluaran tampil per partai (W79).

Output: informasi. Skenario: A5.

**[Plan UI & UX]**

- **Layout:** tabel partai yang bisa dibuka menjadi rincian per unit.
- **Tautan:** Reject menuju dokumen BSTB Pengeluaran-nya.
- **Kosong:** "Tidak ada partai pada periode ini".

### 24. Telusur

**Deskripsi & Penjelasan Singkat**

Laporan asal dan turunan barang. Dari satu pcs atau No. Stok, pengguna menelusuri rantainya sampai akar dan himpunan supplier (A8). Laporan ini tidak mengasumsikan satu partai berasal dari satu supplier (§6).

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Parameter | Memilih titik awal | No. Stok |
| Rantai Mundur | Asal barang | No. Stok induk, dokumen, unit |
| Rantai Maju | Turunan barang | No. Stok anak, posisi sekarang |
| Himpunan Supplier | Sumber bahan | Supplier, No. Stok akar |

**[Cara Kerja Menu]**

1. Pengguna memasukkan No. Stok.
2. Mundur: pcs → Dry B → Moulding (grading) → Dry A → seluruh stok partai asalnya → akar → himpunan supplier (A8).
3. Maju: dari No. Stok ke turunannya, masing-masing dengan posisi sekarang.
4. Bagian kotak ikut saat Packing dibangun.

Output: informasi. Skenario: A8.

**[Plan UI & UX]**

- **Layout:** satu kolom pencarian dan susunan pohon yang bisa dibuka per langkah.
- **Tautan:** tiap simpul menuju dokumen dan Kartu No. Stok-nya.
- **Kosong:** "No. Stok tidak ditemukan".
