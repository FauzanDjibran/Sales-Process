# Plan Implementasi Produksi Walet: Sampai Barcoding

> Sumber: `Produksi Walet (Real).md`. Rujukan W, V, A dan § menunjuk ke dokumen itu.
> Disusun 05/11/2026. **Status: rencana.** Berisi 14 menu yang disetujui di Fase 1, urut sesuai flow.

---

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

## Keputusan dan Asumsi yang Dipakai

Disetujui user 05/11/2026 dan dicatat di `Produksi Walet (Real).md`: asumsi 1 = W81, 2 = W82, 5 = W83, 6 = W84, 7 dan 13 = W85, 8 = W86, 10 = W87, 11 = W88, 12 = W89, 14 = W90, 15 = W91. Nomor 3, 4 dan 9 hanya batas penulisan plan ini, jadi tetap di sini.

| # | Asumsi | Menu |
| --- | --- | --- |
| 1 | Routing Reguler sampai UP5; UP5 dibuat sebagai master, dan barang berhenti di Persiapan UP5 sampai Packing dibangun. Mengubah routing §12 yang berakhir di UBC | 1, 8 |
| 2 | Biaya Packing yang ditagih masuk varians, karena Standar hanya sampai Barcoding | 12, 13 |
| 3 | Sales Planning dan Rencana Produksi ditunda karena targetnya Nama Jual | — |
| 4 | Plan ini menulis target lengkap tiap menu, tanpa gap dengan yang sudah dibangun | Semua |
| 5 | Reproses hanya ke unit sebelumnya pada routing yang sama, jadi barang berpartai tidak mundur ke UGH, UPC, UPY | 10 |
| 6 | Reject sebelum partai lahir tidak punya penyerap, jadi Dr Beban Pemusnahan Produksi | 11 |
| 7 | BSTB Pengeluaran tanpa QC: Draft → Ajukan → Terima oleh Logistik | 11 |
| 8 | Layar memakai "Kartu No. Stok" (W5); Tipe Unit "Gudang" tidak dipetakan karena tak ada unit yang memakainya | 1, 14 |
| 9 | Pengguna selain PPIC, Admin Bahan Baku, QC, Logistik dan admin adalah perkiraan | Semua |
| 10 | **A26 berbunyi "60 g dari 100 g Balik QC", padahal W65 memutuskan utuh per baris.** W65 yang dipakai: 60 g itu satu baris sendiri dari total No. Stok 100 g, bukan baris 100 g yang dipecah | 7 |
| 11 | No. Partai dan No. Job BSTB lahir saat **Terima**, bersama gerakan buku (W20). Dokumen hanya menyebut "lahir dari BSTB" | 9 |
| 12 | Tanda Balik QC hilang begitu barang pindah lewat Dokumen Reproses, karena di unit tujuan ia barang biasa | 10 |
| 13 | Nomor BSTB Pengeluaran memakai kode unit asal, karena tujuannya Logistik, bukan unit | 11 |
| 14 | Checklist Closing juga menolak Dokumen Grading, Pengerjaan Unit, QC Check, Dokumen Reproses dan BSTB Pengeluaran yang belum selesai. §10 hanya menyebut BSTB dan Dokumen Push | 13 |
| 15 | "Boleh dilewati" pada routing tersimpan tetapi tidak dipakai di Reguler; dokumen belum menjelaskan akibatnya | 1, 8, 9 |

## Aturan Bersama

Berlaku di semua menu dan tidak diulang di tiap bagian.

| Aturan | Isi |
| --- | --- |
| Tahap barang | Persiapan → proses → QC Check (bila unitnya punya) → Stand By (W29, W65) |
| Bucket | No. Stok · Unit · Tahap · Partai · Job; baris Balik QC terpisah dari saldo No. Stok yang sama (W66) |
| Nomor | `<JENIS>_<unit>_<ddmmyy>_<NNNNN>` harian (W11); unit tujuan untuk perpindahan |
| Draft | Tidak menyentuh buku, jurnal, atau reservasi. Batalkan hanya untuk Draft |
| Satu partai | Satu dokumen untuk satu partai; tidak berlaku sebelum partai lahir (W76) |
| Nilai | Rupiah bulat, rate `Decimal(18,6)`, sisa pembagian ke bagian terbesar. BJL selalu 0, non-BJL menurut gram (W32) |
| Gram | Berubah hanya lewat grading (W19, W47) |
| Hak akses | Setiap aksi lewat permission; perubahan master hanya admin (§5) |
| UI | Mengikuti `knowledge/design-convention.md`. Tiap Posting, Ajukan dan Terima punya konfirmasi yang menyatakan akibatnya; yang memposting jurnal menampilkan barisnya |

---

## Master

### 1. Struktur Produksi

**Deskripsi & Penjelasan Singkat**

Menu admin untuk menetapkan Workstation, Unit, Line dan Routing, sehingga alur produksi adalah data dan tidak tertanam di sistem. Semua dokumen produksi membaca menu ini untuk tahu unit berikutnya dan jalur keluarnya. Menu ini berada di awal, sebelum dokumen apa pun dibuat.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Workstation | Mengelompokkan unit; menjadi penentu Push atau BSTB | Kode, Nama |
| Unit | Mendefinisikan tempat kerja dan perilakunya | Kode, Nama, Workstation, Tipe, QC Check, No. Job saat keluar |
| Line | Atribut partai dan pemilik akun varians | Nama, Akun Varians |
| Routing | Urutan unit | Line (kosong = pra-partai), urutan unit, Checkpoint, Boleh Dilewati |
| Keluar Lewat | Menampilkan hasil hitung per langkah; tidak bisa diisi | Dokumen Push atau BSTB |

**[Cara Kerja Menu]**

1. Admin membuat Workstation, lalu Unit. Satu unit tepat satu Tipe: Pass Through, Grading, atau Assembly (W73).
2. Admin menandai QC Check dan No. Job saat keluar pada Unit (§5). Keduanya atribut Unit, bukan langkah routing.
3. Admin membuat Line, lalu Routing. Routing tanpa line adalah segmen pra-partai, sama untuk semua line, dan berakhir di Penyebaran (W39, W73). Routing line dimulai sesudahnya.
4. Sistem menghitung Keluar Lewat tiap langkah: unit berikutnya satu Workstation berarti Dokumen Push, beda Workstation berarti BSTB (W64).
5. Admin menandai Checkpoint. Sementara hanya satu, pada keluar Barcoding (W71).
6. Satu line boleh punya banyak routing (W35). Begitu dipakai partai, langkahnya terkunci; urutan baru berarti routing baru.

Isi awal Reguler, dari §5 dan asumsi 1:

| Routing | Urutan |
| --- | --- |
| Pra-partai | UGH → UPC → UPY |
| Reguler | UPW → UCL → UC1 → USR → UDA → UMG → UMP → UDB → UWP → UBC (Checkpoint) → UP5 |

Output: unit dan routing yang dibaca menu 3–11.

**[Plan UI & UX]**

- **Layout:** tiga halaman daftar (Workstation, Unit, Line) dan satu halaman Routing, masing-masing dengan form sendiri.
- **Form Routing:** satu tabel langkah berurutan, dengan kolom Unit, Workstation, Keluar Lewat dan tanda Checkpoint. Kolom Keluar Lewat berubah seketika saat urutan diubah, jadi admin melihat akibatnya sebelum menyimpan.
- **Terkunci:** routing yang sudah dipakai menampilkan chip Terkunci, langkahnya berupa teks, dan ada aksi membuat routing baru dari salinannya.
- **Validasi:** unit tanpa Workstation, routing pra-partai yang tidak berakhir di Penyebaran, dan Checkpoint lebih dari satu tampil di baris terkait.
- **Kosong:** Routing belum bisa dibuat selama Unit kosong; halaman mengarahkan ke Unit.

### 2. Master Pendukung

**Deskripsi & Penjelasan Singkat**

Menu admin untuk dua data kecil yang dibaca dokumen produksi: Karyawan dan flag BJL pada Item. Karyawan menjawab siapa mengerjakan Job apa, sedangkan flag BJL menentukan siapa menerima nilai. Keduanya disiapkan sebelum pengerjaan unit dimulai.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Karyawan | Daftar pekerja yang bisa dipilih di Pengerjaan Unit | Nama, Status aktif |
| Flag BJL | Menandai Item yang selalu bernilai 0 | Ya/Tidak pada Item, status terkunci |

**[Cara Kerja Menu]**

1. Admin menambah Karyawan (W26). Karyawan tanpa biaya tenaga kerja dan tanpa gram; ia hanya pilihan di menu 6. Karyawan tidak dihapus, hanya dinonaktifkan.
2. Admin menandai flag BJL pada Item bertipe Barang (W32).
3. Flag terkunci begitu Item dipakai di produksi; perubahan sesudahnya ditolak (A20).
4. Target Job Order adalah Item biasa (W69), jadi tidak butuh data tambahan di sini.

Output: Karyawan aktif untuk menu 6, flag BJL untuk pembagian nilai menu 5, 6 dan 11.

**[Plan UI & UX]**

- **Karyawan:** daftar dengan pencarian nama dan filter status; form satu kartu.
- **Flag BJL:** satu saklar di form Item, dengan keterangan singkat "Selalu bernilai 0, gram tetap dihitung".
- **Terkunci:** saklar menjadi teks dengan chip Terkunci dan alasannya.
- **Kosong:** daftar Karyawan kosong menampilkan ajakan menambah, karena Pengerjaan Unit tidak bisa diposting tanpa karyawan.

### 3. Standard Cost

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

Output: versi aktif untuk menu 5, 6 dan 9, serta Standar di menu 13.

**[Plan UI & UX]**

- **Layout:** halaman daftar versi dengan versi aktif di paling atas.
- **Form:** satu tabel berisi semua unit, urut routing, dengan satu kolom rate. Kolom rate memuat enam desimal.
- **Konfirmasi:** menyebut versi aktif yang akan ditutup permanen. Setelah tersimpan versi tidak bisa diubah, jadi langkah ini harus terasa tegas.
- **Kosong:** sebelum ada versi aktif, halaman memberi tahu bahwa biaya unit tidak bisa dihitung.

---

## Masuk Produksi

### 4. BSTB Issue

**Deskripsi & Penjelasan Singkat**

Dokumen pengiriman barang dari Gudang ke unit, dan satu-satunya gerbang masuk produksi. Admin Bahan Baku mengajukan, unit penerima menerima. Menu ini adalah titik awal flow; hasilnya masuk ke Persiapan Grading Halus atau menjadi saldo bahan penolong unit.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Header | Menyatakan tujuan pengiriman | No. BSTB, Tanggal, Tujuan Pemakaian, Gudang, Unit Tujuan, Catatan |
| Baris Barang | Menyatakan apa yang dikirim | Item, Qty, Gram, No. Stok yang diambil |
| Pilih No. Stok | Memilih stok | No. Stok, saldo tersedia |
| Status dan Terima | Menampilkan posisi dokumen dan konfirmasi penerima | Draft, Diajukan, Diterima; penerima dan tanggal Terima |

**[Cara Kerja Menu]**

1. Admin Bahan Baku membuat Draft dan memilih Tujuan Pemakaian. Cold Storage dicatat sebagai Gudang (W41).
2. **Bahan ke Produksi** hanya boleh ke unit pertama routing, yaitu Grading Halus. **Bahan Penolong** boleh ke unit mana pun (W37).
3. **Ajukan** memeriksa stok dan mengunci barang sebagai reservasi, sehingga dokumen lain tidak bisa mengambilnya (W37). Sesudah ini dokumen tidak bisa dibatalkan (W67).
4. Unit penerima melakukan **Terima**. Terima hanya konfirmasi: yang diterima tepat isi dokumen, tanpa selisih (W57). Tidak ada QC (W46).
5. Terima menggerakkan buku, dengan nilai MAC (V8) dan tanggal dokumen, walau Terima dilakukan hari lain (W37).
6. Jurnal: Dr WIP / Cr Persediaan.
7. Bahan ke Produksi masuk Persiapan unit. Bahan penolong menjadi saldo unit, bukan isi partai (A1).

Output: barang untuk menu 5; saldo bahan penolong untuk menu 5 dan 6. Skenario: A1.

**[Plan UI & UX]**

- **Layout:** daftar dokumen dengan filter Status dan Unit Tujuan; form header lalu tabel baris.
- **Antrean Terima:** penerima membuka daftar yang tersaring "Menunggu Terima" untuk unitnya, sehingga tidak perlu mencari.
- **Pilih No. Stok:** dialog daftar No. Stok berikut saldo yang masih bebas dari reservasi.
- **Unit Tujuan:** untuk Bahan ke Produksi terisi otomatis dan terkunci.
- **Konfirmasi Ajukan:** menyatakan barang akan terkunci dan dokumen tidak bisa dibatalkan.
- **Validasi:** qty melebihi saldo tampil di baris dan menahan Ajukan.
- **Kosong:** picker yang kosong menyebut "Belum ada stok untuk Item ini di Gudang".

---

## Pengerjaan di Unit

### 5. Dokumen Grading

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
| UDB | No. Job Moulding dan Job Order lepas, Partai tetap | No. Job baru terbit di menu 9 |
| UBC | No. Job dibawa | 1 No. Stok = 1 pcs dengan gram final; input baris per baris (W16) |

Output: hasil untuk menu 7, atau Stand By untuk menu 9. Skenario: A3, A11, A18, A19, A23, A10 untuk volume.

**[Plan UI & UX]**

- **Layout:** pengguna memilih unit, lalu melihat daftar Persiapan unit itu. Tombol Grading pada satu baris membuka form dengan input terisi.
- **Form:** kartu input di atas, tabel output di tengah, bahan penolong di tab kedua, Ringkasan Nilai di bawah. Ringkasan berubah seketika saat gram diketik.
- **Tanda BJL:** baris output ber-Item BJL menampilkan chip BJL dan nilai 0, sehingga operator tidak mengira ada salah hitung.
- **Peringatan:** bila semua output BJL, form menyatakan nilainya masuk Beban Pemusnahan Produksi sebelum Posting.
- **Validasi:** gram diambil melebihi saldo tampil di kartu input; output kosong menahan Posting.
- **Barcoding:** tabel output dioptimalkan untuk ketik cepat, Enter menambah baris dan fokus pindah ke kolom gram, dengan penghitung pcs dan total gram selalu terlihat. Volume ±5.000 pcs harus diuji sejak awal (§16, A10).
- **Kosong:** Persiapan kosong menyebut "Belum ada barang di Persiapan unit ini".

### 6. Pengerjaan Unit

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

1. Operator memilih satu atau beberapa No. Job dari Persiapan; semuanya dari satu partai bila sudah berpartai (W74).
2. Tiap No. Job wajib punya **tepat satu karyawan**; Job tanpa karyawan ditolak (A13). Catatan ini milik pengerjaan, tidak melekat ke No. Job, tanpa gram per karyawan dan tanpa biaya (W26).
3. Pengerjaan boleh bertahap; biaya masuk periode tanggal Posting (§8).
4. Bahan penolong boleh ditambahkan pada satu Job: nilainya masuk Job itu, gram tetap, saldo unit berkurang (W75, A28).
5. Di Pre Cleaning operator mengisi catatan hasil. Catatan tidak mengubah jenis maupun No. Job, dan dibawa ke Penyebaran (W6, W42).
6. Posting menghitung S = gram × rate versi terkunci (V1), lalu membaginya ke No. Stok non-BJL menurut gram (V2). Baris Balik QC kena V1 lagi (W66).
7. Jurnal: Dr WIP / Cr Biaya Produksi Dibebankan.
8. UPC, UPW, UCL dan UWP masuk QC Check. UC1, USR dan UMP langsung ke Stand By (W65).

Output: hasil untuk menu 7, atau Stand By untuk menu 8 dan 9. Skenario: A13, A14, A28.

**[Plan UI & UX]**

- **Layout:** pengguna memilih unit dan melihat Persiapan, dikelompokkan per partai lalu per Job, dengan centang per Job.
- **Satu partai:** begitu Job pertama dicentang, Job partai lain menjadi nonaktif, sehingga aturan ini tidak perlu berakhir sebagai pesan penolakan.
- **Karyawan:** picker dengan pencarian di tiap baris, plus aksi mengisi karyawan yang sama ke semua baris terpilih karena satu orang boleh mengerjakan banyak Job.
- **Catatan Hasil:** kartu ini hanya muncul di Pre Cleaning.
- **Validasi:** baris tanpa karyawan ditandai dan menahan Posting.
- **Balik QC:** baris bertanda chip dan menyebut nomor QCK, serta peringatan bahwa biaya unit akan masuk lagi.
- **Kosong:** sama seperti menu 5.

### 7. QC Check

**Deskripsi & Penjelasan Singkat**

Dokumen pemeriksaan QC atas hasil proses di unit yang punya QC. QC hanya memvalidasi: boleh lanjut, atau harus dikerjakan ulang. Menu ini berada di antara menu 5 atau 6 dan Stand By.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Antrean | Menampilkan hasil yang menunggu | Unit, Partai, No. Stok, gram, Dokumen Eksekusi asal |
| Keputusan Baris | Memutuskan tiap baris | OK atau Balik, Alasan |
| Header | Identitas pemeriksaan | No. QCK, Unit, Tanggal, Pemeriksa |

**[Cara Kerja Menu]**

1. Hasil proses masuk tahap QC Check. Unit ber-QC: Grading Halus, Pre Cleaning, Pre Wash, Cleaning (QC Cabut), Dry A, Moulding (grading) yaitu QC Moulding, Dry B, Wrapping (mencakup WIP Steam), Barcoding (QC Final Grading).
2. QC memilih baris dalam satu partai dan memutuskan **utuh per baris**. Semua hasil ikut, termasuk BJL (W65).
3. Alasan Balik opsional. Uji lab bukan langkah tersendiri, hanya salah satu dasar keputusan QC (W70).
4. Posting: **OK** masuk Stand By. **Balik** kembali ke Persiapan unit yang sama sebagai baris sendiri, dengan tanda Balik QC dan nomor QCK (W66).
5. Tanpa jurnal; biaya ulang masuk saat barang diproses lagi.
6. QC tidak memutuskan Reproses atau Reject; keduanya milik unit, sesudah barang di-Balik (W77).

Output: Stand By untuk menu 8 dan 9; baris Balik QC untuk menu 5, 6, 10 atau 11. Skenario: A25, A26 (lihat asumsi 10).

**[Plan UI & UX]**

- **Layout:** antrean per unit, dengan jumlah baris menunggu; QC memilih satu partai lalu membuka formnya.
- **Keputusan:** dua tombol OK dan Balik pada tiap baris, plus aksi menandai sisanya OK. Posting ditahan sampai semua baris terpilih punya keputusan.
- **Balik:** baris Balik diberi warna peringatan dan kolom alasan terbuka, tanpa wajib diisi.
- **Keterangan baris:** QC melihat gram dan dokumen asal, supaya bisa mencocokkan dengan barang fisik.
- **Kosong:** "Tidak ada hasil yang menunggu QC di unit ini".

---

## Perpindahan Antar Unit

### 8. Dokumen Push

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

1. Pengguna memilih Unit Asal. Sistem menetapkan Unit Tujuan, yaitu unit berikutnya pada routing. Menu ini hanya untuk pasangan satu Workstation (W64); selain itu memakai menu 9.
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

Output: Persiapan unit berikutnya, ditangani menu 5 atau 6. Keluar Barcoding berhenti di Persiapan UP5 (asumsi 1). Skenario: A12, A15, A17, A21, A27.

**[Plan UI & UX]**

- **Layout:** daftar dokumen per unit; form dibuka dari Stand By unit, dengan barang yang dicentang langsung menjadi baris.
- **Tujuan:** tampil sebagai teks "Tujuan: Pre Cleaning (otomatis)", tanpa pilihan, supaya tidak ada salah kirim.
- **Pengambilan:** gram dipindah terisi penuh dan bisa dikurangi; sisa di Stand By terlihat di baris.
- **Job Order:** kolom Target muncul hanya saat Unit Asal UMG, memakai picker Item, wajib per No. Job.
- **Panel Checkpoint:** menampilkan bagian partai yang belum siap beserta unit, tahap dan tautan dokumennya. Tombol Posting nonaktif dengan alasan tertulis, karena operator perlu tahu apa yang menahan, bukan sekadar ditolak.
- **Kosong:** "Belum ada barang di Stand By unit ini".

### 9. BSTB Transfer

**Deskripsi & Penjelasan Singkat**

Dokumen perpindahan antar unit lintas Workstation, dengan Terima oleh unit tujuan. BSTB Penyebaran adalah bentuk khususnya, tempat partai lahir. Menu ini menghubungkan Stand By UPY, USR dan UDB dengan Persiapan unit berikutnya.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Header | Identitas perpindahan | No. BSTB, Unit Asal, Unit Tujuan (otomatis), Tanggal, Partai (teks) |
| Pembentukan Partai | Khusus keluar Penyebaran | Line, Routing, Standard Cost aktif (teks) |
| Baris Barang | Menyatakan yang dipindah | No. Stok, No. Job, gram tersedia, gram dipindah |
| No. Job Baru | Khusus keluar UPY dan UDB | Pengambilan, No. Job |
| Status dan Terima | Posisi dokumen dan konfirmasi penerima | Draft, Diajukan, Diterima; penerima |

**[Cara Kerja Menu]**

1. Pengguna memilih Unit Asal; sistem menetapkan Unit Tujuan dari routing. Menu ini hanya untuk pasangan beda Workstation (W64).
2. Pengguna memilih barang dari Stand By; boleh sebagian qty (W71). Tanpa QC (W67).
3. **Ajukan** mengunci barang di pengirim, tanpa status transit (W20). Sesudah ini dokumen tidak bisa dibatalkan atau ditolak (W67).
4. **Terima** oleh unit tujuan hanya konfirmasi: tepat isi dokumen, tanpa selisih (W57). Barang masuk Persiapan unit tujuan, tanpa jurnal.
5. Perilaku menurut Unit Asal:

| Unit Asal | Yang terjadi |
| --- | --- |
| UPY (BSTB Penyebaran) | Yang dikirim bersama menjadi 1 partai = 1 line, `P_<ddmmyy>_<NNNNN>`. Partai menyimpan routing dan Standard Cost aktif (W35, W36, W73). No. Job baru per pengambilan (W31) |
| USR | No. Job dibawa |
| UDB | No. Job baru `UDB` per pengambilan (W68) |

6. BSTB Penyebaran boleh sebagian qty: sisanya tetap saldo No. Stok yang sama, dan satu No. Stok boleh ada di beberapa partai (A2, §6).
7. Barang salah kirim tidak punya jalan balik; ia diterima dulu lalu dikoreksi sesudahnya (§16).

Output: Persiapan UPW, UDA atau UWP, ditangani menu 5 atau 6. Skenario: A2, A15, A22, A27.

**[Plan UI & UX]**

- **Layout:** daftar dokumen dengan filter Status dan Unit; antrean "Menunggu Terima" untuk unit tujuan, seperti menu 4.
- **Form Penyebaran:** kartu Pembentukan Partai muncul di atas baris; Routing hanya menawarkan milik Line terpilih, dan Standard Cost tampil sebagai teks.
- **Tujuan:** teks otomatis, sama seperti menu 8.
- **Konfirmasi Ajukan:** menyatakan barang terkunci dan dokumen tidak bisa dibatalkan. Untuk Penyebaran, juga menyatakan partai baru akan terbentuk saat Terima.
- **Terima:** penerima melihat isi dokumen sebagai teks dan satu tombol, tanpa kolom selisih.
- **Kosong:** sama seperti menu 8.

### 10. Dokumen Reproses

**Deskripsi & Penjelasan Singkat**

Dokumen pemindahan barang Balik QC mundur ke unit sebelumnya pada routing, keputusan milik unit asal. Barang kemudian berjalan maju lagi seperti barang biasa. Menu ini menyambung baris Balik QC dengan menu pengerjaan di unit tujuan.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Header | Identitas | No. RPR, Unit Asal, Unit Tujuan, Tanggal, Partai (teks), Mode (otomatis) |
| Baris Barang | Menyatakan yang direproses | Baris Balik QC, No. QCK, gram tersedia, gram direproses |
| Alasan | Menjelaskan masalah | Teks, opsional |
| Status dan Terima | Hanya bila lintas Workstation | Draft, Diajukan, Diterima |

**[Cara Kerja Menu]**

1. Dokumen boleh dibuat dari semua unit ber-QC, hanya atas baris **Balik QC** di Persiapan. Barang yang belum Balik QC ditolak (W78, A32).
2. Unit Tujuan bebas ke unit mana pun sebelumnya pada routing yang sama; unit sesudahnya ditolak (A32, asumsi 5). Boleh sebagian qty (§9).
3. Mode dihitung otomatis: satu Workstation seperti Dokumen Push (Posting), lintas Workstation seperti BSTB tanpa QC (Ajukan, lalu Terima) (W64, W78).
4. Barang masuk Persiapan unit tujuan, tetap di partainya, dan No. Stok tetap sampai digrading ulang (§9). Tanpa jurnal.
5. Dari sana barang maju mengikuti routing dengan semua aturan unit. Biaya unit masuk lagi di tiap unit yang dilewati, memakai versi partai (V9), lewat menu 5 dan 6.
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

## Keluar Produksi

### 11. BSTB Pengeluaran

**Deskripsi & Penjelasan Singkat**

Dokumen pengeluaran barang dari produksi ke Logistik di luar jalur normal, dari unit mana saja. Alasannya menentukan nilai keluar dan ke mana nilainya pergi. Keputusan mengeluarkan barang milik unit, termasuk kasus parah sesudah Balik QC.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Header | Identitas dan alasan | No. BSTB, Unit Asal, Tanggal, Alasan, Partai (teks), Gudang Tujuan |
| Baris Barang | Menyatakan yang keluar | No. Stok, Tahap, gram tersedia, gram keluar, tanda Balik QC |
| Dampak Nilai | Pratinjau | Nilai keluar, nilai diserap sisa partai, jurnal bila ada |
| Status dan Terima | Posisi dokumen | Draft, Diajukan, Diterima |

**[Cara Kerja Menu]**

1. Pengguna memilih barang dari **Persiapan atau Stand By**, boleh sebagian qty (W29, §9).
2. Alasan menentukan perhitungan:

| Alasan | Nilai keluar | Ke mana nilainya | Jurnal |
| --- | --- | --- | --- |
| Reject | 0 | Diserap sisa isi partai non-BJL menurut gram | Tanpa jurnal bila akun WIP sama |
| Reject tanpa penyerap | 0 | Beban Pemusnahan Produksi (W32, asumsi 6) | Dr Beban Pemusnahan Produksi / Cr WIP |
| Hasil samping (BJL, waste) | 0 | Sudah 0 sejak grading (W12) | Tidak ada |
| Sisa bahan penolong | Nilai bucketnya | Kembali ke Persediaan (V8) | Dr Persediaan / Cr WIP |

3. **Ajukan** mengunci barang, lalu Logistik melakukan **Terima**, yang menggerakkan buku (asumsi 7). Barang membawa No. Stok dan partai asalnya (§9).
4. Reject tercatat per partai sebagai susut untuk menu 14.
5. Barang yang sudah keluar tidak lagi dihitung sebagai isi partai saat Checkpoint (§8).

Output: stok di Logistik. Skenario: A5, A16, A31.

**[Plan UI & UX]**

- **Layout:** daftar dokumen dengan filter Alasan dan Unit; form dibuka dari Persiapan, Stand By, atau baris Balik QC.
- **Alasan dulu:** Alasan dipilih sebelum baris, karena menentukan barang yang boleh dipilih dan isi Dampak Nilai.
- **Dampak Nilai:** untuk Reject, form menyatakan besar nilai yang diserap dan HPP per gram sisa partai sesudahnya, karena kerugian ini tidak terlihat sebagai beban (§16).
- **Peringatan:** bila Reject tak punya penyerap, form menyebut akun Beban Pemusnahan Produksi sebelum Ajukan.
- **Kosong:** "Tidak ada barang yang bisa dikeluarkan dari unit ini".

---

## Biaya

### 12. Proses Tagihan Biaya

**Deskripsi & Penjelasan Singkat**

Dokumen pencatatan biaya produksi aktual dari supplier per Jenis Biaya. Menu ini tidak menyentuh barang; ia hanya mengisi sisi Aktual pada Closing. §12 menetapkannya "tetap", jadi rincian di bawah mengikuti P202.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Jenis Biaya | Master pengelompok biaya | Nama, akun beban |
| Header | Identitas tagihan | Nomor, Supplier, Tanggal |
| Baris Biaya | Rincian biaya | Jenis Biaya, Jumlah |
| Total dan Status | Ringkasan | Total, Draft atau Posted |

**[Cara Kerja Menu]**

1. Pengguna menetapkan Jenis Biaya beserta akunnya.
2. Pengguna membuat Draft tagihan dengan supplier dan baris biaya.
3. Posting menulis jurnal Dr akun Jenis Biaya / Cr Hutang Biaya Produksi. Nomor mengikuti P15, karena dokumen ini tidak terikat unit (§6).
4. Bahan penolong tidak lewat menu ini; nilainya masuk WIP lewat menu 4 (§10).
5. Biaya Packing yang ditagih tetap dicatat di sini dan masuk varians (asumsi 2).

Output: debit akun Jenis Biaya untuk menu 13. Pembayaran di Finance.

**[Plan UI & UX]**

- **Layout:** daftar tagihan dengan filter Status dan Supplier; form header lalu tabel baris.
- **Konfirmasi Posting:** menampilkan baris jurnal.
- **Validasi:** baris tanpa Jenis Biaya atau jumlah nol ditandai di barisnya.
- **Kosong:** Jenis Biaya yang belum ada mengarahkan pengguna membuatnya dulu.

### 13. Closing Costing Produksi

**Deskripsi & Penjelasan Singkat**

Proses akhir bulan yang membandingkan biaya Aktual dan Standar, lalu mencatat selisihnya sebagai varians. Closing tidak menyentuh WIP maupun stok, dan mengunci periode. Menu ini menutup siklus biaya bulanan dan menyediakan Proyeksi Varians sebelum Closing dijalankan.

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Daftar Periode | Menampilkan status tiap bulan | Periode, Status, Tanggal closing |
| Checklist | Memeriksa kesiapan | Tiap syarat, hasil, dokumen penahan |
| Angka Closing | Hitungan | Aktual, Standar, Varians |
| Proyeksi Varians | Hitungan sementara tanpa menulis | Angka yang sama per tanggal |

**[Cara Kerja Menu]**

1. Satu bulan satu Closing (§10). Pengguna membuka periode dan melihat Checklist.
2. Checklist memakai syarat P210, ditambah tidak ada BSTB yang belum Terima dan tidak ada Dokumen Push yang masih Draft (§10), serta dokumen lain pada asumsi 14.
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
9. Proyeksi Varians menjalankan kalkulasi yang sama tanpa menulis apa pun.

Output: jurnal varians dan periode terkunci. Skenario: A7.

**[Plan UI & UX]**

- **Layout:** daftar periode; satu halaman per periode berisi Checklist, Angka Closing, lalu tombol Closing.
- **Checklist:** tiap syarat gagal menautkan ke dokumen penahannya, sehingga pengguna bisa langsung menyelesaikannya. Tombol Closing nonaktif selama ada yang gagal, dengan alasan tertulis.
- **Proyeksi Varians:** tampil selama periode masih terbuka, ditandai jelas sebagai sementara.
- **Konfirmasi:** menampilkan jurnal varians dan menyatakan Closing final serta periode terkunci.
- **Kosong:** periode tanpa aktivitas menyatakan tidak ada yang perlu dihitung.

---

## Pantauan

### 14. Laporan Produksi

**Deskripsi & Penjelasan Singkat**

Empat laporan yang membaca buku produksi dan stok, tanpa menulis apa pun. Pengguna melihat posisi barang, riwayat No. Stok, susut, dan asal-usul barang. Menu ini membaca semua menu dokumen dan membantu PPIC melihat bagian partai yang belum sampai (§16).

**[Fungsi Bagian-Bagian Menu]**

| Bagian/Komponen | Fungsi | Data yang ditampilkan/diinput |
| --- | --- | --- |
| Saldo Produksi | Posisi barang per tanggal | Unit, Tahap, Partai, Job, No. Stok, gram, nilai, tanda Balik QC |
| Kartu No. Stok | Riwayat satu No. Stok | Tanggal, dokumen, unit, gerakan, saldo |
| Susut per Partai | Gram dan nilai per partai | Gram masuk, gram keluar, Reject, susut per unit, HPP per gram |
| Telusur | Asal dan turunan barang | Rantai No. Stok, dokumen, himpunan supplier |

**[Cara Kerja Menu]**

1. **Saldo Produksi** menampilkan saldo per bucket sesuai tanggal yang dipilih, sehingga bagian partai yang tersebar terlihat.
2. **Kartu No. Stok** memuat seluruh gerakan, termasuk Dokumen Push (A21) dan biaya ulang Balik QC (W66).
3. **Susut per Partai** menggantikan Rekap Produksi: susut dan Reject per partai (§12, W79).
4. **Telusur** berjalan mundur dari pcs: pcs → Dry B → Moulding (grading) → Dry A → seluruh stok partai asalnya → akar → himpunan supplier (A8). Partai tidak diasumsikan satu supplier (§6). Bagian kotak ikut saat Packing dibangun.

Output: informasi. Skenario: A5, A8.

**[Plan UI & UX]**

- **Layout:** tiap laporan satu halaman dengan parameter di atas, tanggal diisi hari ini.
- **Saldo Produksi:** pengelompokan Per Unit atau Per Partai. Tampilan Per Partai menunjukkan di mana saja isi partai berada.
- **Tautan:** nomor dokumen dan No. Stok bisa diklik untuk masuk ke sumbernya atau ke Telusur.
- **Telusur:** susunan pohon yang bisa dibuka per langkah.
- **Kosong:** "Tidak ada data untuk parameter ini".
