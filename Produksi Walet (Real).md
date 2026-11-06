# Produksi Walet (Real)

> **Dokumen informasi utama produksi ERP.** Setiap keputusan dan perubahan produksi diperbarui di sini dalam commit yang sama (W63). Disusun 04/11/2026 dari tiga sumber dan seluruh jawaban user, sehingga
> tidak ada pertanyaan yang harus dijawab sebelum build. Yang sengaja ditunda ada di bagian 15.
>
> **Status:** langkah D dan 1–3 sudah dibangun (P218, P225–P230), penyesuaian master langkah 4 selesai (P239), dan Dokumen Grading, Pengerjaan Unit serta QC Check dibangun (P241); perpindahan antar unit berikutnya. Konsep Grading Halus sampai Barcoding diperbarui oleh W64–W80 dan belum dibangun; bagian 12 mencatat yang harus berubah. Dokumen ini menggantikan keputusan produksi
> `Production-Plan.md` sebatas yang tercantum di bagian 12.
>
> **Putaran kedua, 04/11/2026:** W25–W32 (grading per No. Stok, karyawan di pengerjaan unit, checkpoint partai,
> Persiapan dan Stand By, Eksekusi Produksi, No. Job per pengambilan, dan pembagian nilai BJL / bukan BJL
> yang menutup OD-1 dan OD-2).
> W25 dan W26 dikoreksi user pada hari yang sama.
>
> **Putaran ketiga, 05/11/2026:** W41–W56, hasil perbandingan dengan 45 SOP di `walet sop.md`. Yang belum diputuskan ada di bagian 15, tabel Open dari SOP.
>
> **Putaran keempat, 05/11/2026:** W57–W63. BSTB hanya konfirmasi, Dokumen Push, daftar perpindahan antar unit, No. Stok baru tiap grading, pack sebagai isi kotak, dan dokumen ini menjadi dokumen utama. Tersisa O-03 dan O-06.
>
> **Putaran kelima, 05/11/2026:** W64–W76, hasil simulasi per unit dan validasi user. Workstation menentukan Push atau BSTB, QC Check di unit, Moulding menjadi dua unit tanpa Mix, CCP-1 dan Sortir menjadi unit, checkpoint hanya di Barcoding, satu unit satu proses. Packing 95 ke atas sengaja belum disentuh.
>
> **Putaran keenam, 05/11/2026:** W77–W80. QC hanya validasi, Dokumen Reproses, Reject untuk kasus parah, dan sisa partai yang tetap jalan sampai checkpoint. Menutup O-11.
>
> **Putaran ketujuh, 05/11/2026:** W81–W91, hasil penulisan `plan-implementasi-produksi.md` sampai Barcoding: routing sampai UP5, batas Reproses dan Reject, siklus BSTB Pengeluaran, kapan identitas BSTB lahir, dan checklist Closing.

**Sumber dan bobotnya**

| Urutan | Sumber | Peran |
| --- | --- | --- |
| 1 | Keputusan user di bagian 3 | Menang atas semua sumber |
| 2 | `walet/Produksi_Walet_v5.md` | Panduan utama; bagian yang tidak disentuh dokumen ini tetap berlaku |
| 3 | `walet/Simulasi Flow Costing.xlsx`, sheet `flow` dan master pendukung | Contoh mekanik dan angka. **Datanya ilustrasi:** tanggal tidak urut dan gram tidak bersambung (Grading Halus 50 kg → 60 kg; Penyebaran 10 kg → 41,8 kg) |
| 4 | `walet/Proses Produksi - 05 Februari 2026.xlsx`, sheet Reguler, Indomie, Suchan MK | SOP lapangan, informasi pendukung |
| 5 | `walet sop.md`, ringkasan 45 SOP lapangan | Alur lapangan dan asal W41–W62 |

---

## 1. Cakupan

**Dibangun sekarang: line Reguler saja (W1).**

| Masuk | Ditunda (bagian 15) |
| --- | --- |
| Dari **Logistik ke Grading Halus** sampai **Finish Goods** | Sebelum Logistik: Grading Sampling dan pembelian tetap memakai alur yang ada (W2) |
| Master produksi, identitas, BSTB, QC Check, grading, Job Order, packing | Line Mie dan SM, termasuk routing-nya |
| Standard cost, bahan penolong, reject, reproses | Makloon Home Industry |
| Closing costing dan varians | No. Kati dan QR Caiq per keping |
| Sales Planning dan Rencana Produksi | Purchase Request dari Sales Planning |

**Asumsi bahan:** BB kotor dan BB bersih mengikuti alur yang sama, mulai dari Issue Logistik ke Grading Halus (W3).

**Unit dilihat dari apa yang masuk dan apa yang keluar (W4).** Kegiatan di dalam unit tidak dicatat sistem:

| Unit | Kegiatan SOP di dalamnya |
| --- | --- |
| Cleaning | Penirisan, Cabut. Rambang dan Titil belum dicatat (W72) |
| Sortir | Sortir, Moulding Hancuran |
| Wrapping | WIP Steam & Steam, Wrapping |
| Barcoding | Barcoding dan Final Grading |

---

## 2. Terminologi

Layar memakai istilah v5 di seluruh aplikasi; kode tetap memakai nama `tracking` (W5, mengubah P215).

| Di layar (v5) | Di sistem | Nama lama di layar |
| --- | --- | --- |
| **No. Stok** | `log_stock_tracking`, `tracking_id` | Lot |
| **Unit** | `ref_unit`: `ref_workstation` lama diganti namanya di tempat (P225), isinya master dengan jenis pekerjaan | Workstation |
| **Workstation** (pengelompok unit) | `ref_workstation` baru, arti berbeda dari yang lama | — |
| **BSTB Issue** | `log_stock_issue` | Stock Issue |
| **BSTB Penyebaran, BSTB Transfer** | `prd_transfer` per tujuan | Production Transfer |
| **Dokumen Reproses** | `prd_transfer` jenis Reproses, nomor sendiri | BSTB Transfer jenis Reproses |
| **Dokumen Push** | `prd_transfer` jenis Push, nomor sendiri | BSTB langsung |
| **BSTB Pengeluaran, BSTB ke Finish Goods** | `prd_release` per tujuan | Production Release, Pemusnahan |
| **Eksekusi Produksi**, payung semua pekerjaan di unit (W30), dengan versi dan nama per jenis: **Dokumen Grading** (No. Grading), **Pengerjaan Unit**, **Assembly** | `prd_execution` per jenis | Eksekusi Produksi (arti lama, ber-Driver) |
| **QC Check** | `prd_qc_check(_line)`, tahap baru di bucket | QC pada BSTB |
| **Job Order** | Atribut No. Job Moulding, bukan dokumen eksekusi | Job Order sebagai Eksekusi |
| **Flag BJL** | `m_item.is_bjl` | Tabel Tipe, tipe Utama / Turunan, Bobot Nilai pada Item (W32) |
| **Standard Cost** | `prd_rate_version(_line)` | — |
| **Proses tagihan biaya** | `prd_cost_bill(_line)`, sudah ada | Tagihan Biaya |
| **Closing Costing Produksi** | `prd_cost_close(...)` | Penutupan Biaya Produksi |

| Istilah bisnis | Arti |
| --- | --- |
| **Jenis** | Item / SKU |
| **BB kotor (chong)** | Bahan dibeli glondongan dan masih bercampur; perlu diurai menjadi jenis yang sesuai |
| **BB bersih** | Bahan yang saat dibeli sudah berupa jenis sesuai ketentuan; bila digrading, turunan dan deviasinya kecil |
| **Nama Jual** | Barang jadi yang dijual: **kotaknya sendiri** (W8) |
| **Kardus** | Hanya alat packing (bahan penolong), bukan stok hasil produksi dan bukan barang jual (W8) |
| **Pack** | Isi kotak yang dibentuk di Packing 95 dengan gramasi dan stiker daun; sejak itu ber-No. Stok Kotak (W61) |
| **Bahan penolong** | Kotak, gabus, stiker, kardus, dll; punya valuasi sendiri |
| **BS** | Barang yang tidak bisa dipakai |
| **G2** | Grade 2, barang tidak standar |
| **No. Kati, QR Caiq** | Identifikasi tambahan per keping, di luar No. Stok. **Ada di lapangan, belum masuk sistem** (W9) |
| **Karyawan** | Pekerja yang mengerjakan sebuah No. Job di unit Pass Through; master baru. Dicatat saat Pengerjaan Unit sebagai informasi unit itu, tidak melekat ke No. Job; tanpa biaya tenaga kerja (W26) |
| **Persiapan** | Di tiap unit: barang atau Job yang sudah diterima lewat BSTB tetapi belum dikerjakan (W29) |
| **Stand By** | Di tiap unit: barang atau Job yang selesai dikerjakan, lolos QC Check bila unitnya punya, dan menunggu dikirim dengan BSTB atau Dokumen Push (W29, W65) |
| **QC Check** | Tahap sesudah proses di unit yang punya QC. OK masuk Stand By, jelek balik ke Persiapan (W65) |
| **Balik QC** | No. Stok yang ditolak QC dan kembali ke Persiapan unit yang sama, sebagai baris sendiri; kena biaya unit lagi bila diproses (W66) |
| **Reproses** | Barang Balik QC dipindah mundur ke unit sebelumnya pada routing dengan Dokumen Reproses, lalu berjalan maju lagi (W78) |
| **Job Order** | Perintah yang dibawa satu No. Job Moulding, dengan target jenis. 1 No. Job = 1 Job Order (W69) |
| **Push** | Perpindahan antar unit **dalam satu Workstation**, tanpa Terima, selalu dengan Dokumen Push sebagai jejak (W58, W64) |
| **Checkpoint** | Langkah routing tempat seluruh isi partai harus lengkap sebelum lewat. Sementara hanya saat keluar Barcoding (W71) |
| **BJL** | Jenis (Item) yang ditandai BJL di master Item: selalu bernilai 0 tetapi tetap menyumbang qty dan gram (W32) |
| **Pembagian nilai** | Output grading non-BJL berbagi nilai menurut gramnya; BJL 0 (W32). Tidak ada tipe Utama atau Turunan |

---

## 3. Keputusan

| # | Keputusan | Asal |
| --- | --- | --- |
| W1 | Fokus line Reguler sampai selesai; Mie dan SM ditinjau setelahnya. Mie tetap punya Wrapping dst | User |
| W2 | Titik mulai produksi adalah alur Logistik ke Grading Halus | User |
| W3 | BB kotor dan bersih satu alur | User |
| W4 | Di dalam unit hanya dicatat masuk dan keluar | User |
| W5 | Layar memakai istilah v5 | User |
| W6 | Pre Cleaning tetap Pass Through. Angka 6.900 + 100 di simulasi hanya catatan manual; jenis dan berat baru sah saat grading | User |
| W7 | ~~Biaya Moulding sekali, di Grading Moulding, atas gram input. Koreksi v5 5.2~~ **Digantikan W68:** tiap unit Moulding punya rate sendiri | User |
| W8 | FG adalah Nama Jual, yaitu kotak; kardus hanya alat packing | User |
| W9 | No. Kati dan QR Caiq ditandai, belum dibangun | User |
| W10 | **1 No. Stok = 1 stok unik seluruh sistem.** Tiap penerimaan melahirkan nomor baru, walau jenisnya sama. Mengubah P120 | User |
| W11 | Nomor dokumen produksi per unit mengikuti simulasi, harian. **Pengecualian lokal atas P15**, dicatat di `KNOWLEDGE.md` (jawaban D) | User |
| W12 | BJL dan waste adalah output grading ber-No. Stok, nilai 0; keluar lewat BSTB Pengeluaran | User |
| W13 | Reproses: partai **menunggu** barangnya kembali **Diubah W80:** sisa partai tetap jalan dan tertahan di checkpoint. | User |
| W14 | Mulai Packing 95 kotak boleh lintas partai (tetap 1 line); pindah ke Packing 98 per kotak dengan Dokumen Push (W64) | User |
| W15 | Sales Planning hanya mengecek FG; kurang berarti buat Rencana Produksi | User |
| W16 | Grading Barcoding diinput baris per baris seperti output biasa; UI yang lebih baik dibahas kemudian | User |
| W17 | Rate boleh diisi di semua unit; kosong berarti 0 | Disetujui |
| W18 | ~~Bobot awal Utama 1, Turunan 1, BJL 0 (setting Tabel Tipe)~~ **Digantikan W32** | Disetujui |
| W19 | Bahan penolong menambah nilai, bukan gram. Gram berubah hanya lewat grading. Koreksi v5 5.4 | Disetujui |
| W20 | BSTB memindahkan barang saat **Terima**; selama proses barang terkunci di pengirim, tanpa status transit | Disetujui |
| W21 | ~~Perpindahan pra-partai memakai BSTB Transfer mode langsung, tempat No. Job terbit~~ **Digantikan W58** | Disetujui |
| W22 | BSTB Issue tanpa QC, cukup Terima. ~~BSTB ke Finish Goods juga~~ **Diubah W46** | Disetujui |
| W23 | Closing tidak menyentuh WIP dan stok; varians masuk akun kelompok HPP. Periode tetap terkunci sesudahnya | Disetujui |
| W24 | FG masuk pool MAC per Nama Jual; toleransi gram hanya peringatan | Disetujui |
| W25 | **1 No. Stok input = 1 No. Grading**, di semua grading (Halus, Dry A, Moulding, Dry B, Barcoding). Boleh parsial: stok.01 10 kg, diambil 6 kg → G1, diambil 4 kg → G2; sisa tetap saldo No. Stok itu. 10 No. Stok yang dikerjakan semua menghasilkan 10 No. Grading. **Koreksi user:** aturan 1:1 berlaku di grading yang menguraikan: Grading Halus, Dry A, Dry B (dan Barcoding, W16). **Moulding bukan grading 1:1 melainkan pencampuran (Mix)**: No. Stok hasil Dry A masih membawa No. Job-nya; saat Mix No. Job hilang dan semua No. Stok isi partai beridentitas No. Moulding. Lalu Job Order mengerjakan bagian No. Moulding itu; hasilnya dibawa ke Dry B, tempat grading 1 No. Stok = 1 No. Grading terjadi. Hasil Dry B tetap di Dry B (Stand By) sampai dipanggil BSTB baru dan memperoleh No. Job baru. Mengubah bagian 6 dan 8 **Bagian Moulding digantikan W68:** Moulding (grading) adalah grading 1:1, bukan Mix. | User |
| W26 | Di unit Pass Through, **saat Pengerjaan Unit dicatat No. Job berapa dikerjakan oleh karyawan siapa** (`m_employee` baru, `prd_execution_worker`). Itu informasi unit tersebut, **tidak melekat ke No. Job**. Hanya catatan: tanpa gram per karyawan dan tanpa biaya tenaga kerja **Dipertegas W74:** satu karyawan per Job, wajib. | User |
| W27 | ~~Pembagian nilai akan memakai proses pembobotan estimasi harga (OD-2), bobot Tabel Tipe sementara~~ **Digantikan W32; OD-2 dicabut** | User |
| W28 | **Checkpoint partai** di BSTB Dry A → Moulding. Dari Grading Halus sampai Dry A, perpindahan dan pengerjaan boleh parsial. Melewati checkpoint, partai harus lengkap semua Job-nya; sesudahnya tetap lengkap sampai Barcoding. Mengubah syarat "seluruh partai" di bagian 8 **Diubah W71:** checkpoint sementara hanya saat keluar Barcoding. | User |
| W29 | **Tiap unit punya dua tahap barang: Persiapan dan Stand By.** Semua yang diterima lewat BSTB masuk **Persiapan** (kumpulan barang atau Job yang belum dikerjakan). Setelah dikerjakan, barang atau Job yang selesai masuk **Stand By** sampai diputuskan dikirim dengan BSTB. BSTB Transfer dan BSTB ke Finish Goods hanya mengirim dari Stand By; barang Persiapan berarti "belum dikerjakan". **BSTB Pengeluaran boleh dari Persiapan maupun Stand By**, di unit mana saja **Diubah W65:** unit ber-QC punya tahap QC Check di antara proses dan Stand By. | User |
| W30 | **Eksekusi Produksi adalah payung semua pekerjaan di unit**: grading, pass through, Job Order, Assembly dan proses lain. Ia hanya **dokumen yang menyatakan pekerjaan telah dilakukan**, dan di dalamnya terjadi tiga pemicu: **transformasi** (input menjadi output), **biaya** (biaya unit, V1) dan **perpindahan Persiapan ke Stand By**. Satu payung, tetapi dapat punya beberapa versi dan nama menurut jenis proses (Dokumen Grading, Pengerjaan Unit, Grading Mix di Moulding, Job Order, Assembly); Mix adalah salah satu jenis Eksekusi Produksi. Menegaskan `prd_execution` per jenis di bagian 2 **Diubah W68:** Grading Mix dan Job Order bukan lagi jenis Eksekusi Produksi. | User |
| W31 | **Pembuatan No. Job: 1 pengambilan 1 No. Stok = 1 No. Job**, mirip grading. Contoh: Stand By Grading Halus punya stok.001 100 kg jenis A; diambil 30 kg menjadi Job.001 berisi stok.001, lalu diambil 20 kg menjadi Job.002 berisi stok.001 juga; sisa 50 kg tetap di Stand By. Berlaku di semua dokumen yang menerbitkan No. Job: Dokumen Push keluar Grading Halus (W58), BSTB Penyebaran, dan BSTB Dry B. Aturan ini hanya untuk saat pembuatan: sesudah Job digrading, ia boleh berisi beberapa No. Stok turunan **Ditambah W68:** Dokumen Push keluar Moulding (grading) juga menerbitkan No. Job. **Diubah W92:** dokumen tidak lagi disebut satu per satu; No. Job dibuat di perpindahan mana pun yang barangnya belum punya No. Job. | User |
| W32 | **Pembagian nilai: hanya dua jenis, BJL dan bukan BJL**, dari grading halus sampai selesai produksi. **BJL tidak pernah bernilai (selalu 0) tetapi menyumbang qty dan gram.** Non-BJL berbagi seluruh nilai menurut gramnya: grading 1 jenis menjadi 4 (3 non-BJL, 1 BJL) dengan gram 30/30/40 membagi 30%/30%/40%, BJL 0. **Utama dan Turunan tidak dipakai.** Jenis mana yang BJL ditentukan di **master Item** (`m_item.is_bjl`, Barang saja), bukan per grading. Rinciannya: flag **terkunci setelah Item dipakai di produksi**; gram BJL **ikut dihitung dalam biaya unit** (gram input × rate), seluruhnya dibagi ke yang non-BJL; **bila semua output sebuah grading BJL**, nilai inputnya dibebankan ke Beban Pemusnahan Produksi (Dr Beban / Cr WIP). Pembagi tetap satu fungsi (`shareByWeight`, bobot 1 untuk non-BJL dan 0 untuk BJL, sisa terbesar). **Menggantikan W18 dan W27, dan menutup OD-1 dan OD-2.** Tabel Tipe (`prd_output_type`) tidak dibangun | User |
| W33 | **Unit dan Workstation adalah master; tidak ada unit di kode** (P225). Unit memuat **jenis pekerjaan yang boleh** dilakukan (satu atau lebih dari enam yang dikenal sistem). **Mode keluar, kebijakan No. Job, checkpoint dan boleh dilewati melekat pada langkah routing**, bukan pada unit, karena line lain boleh memakai unit yang sama dengan cara lain. Routing tanpa line = segmen pra-partai yang berakhir di satu unit Pembentuk Partai; routing line dimulai sesudahnya. Daftar tertutup (jenis pekerjaan, mode keluar, kebijakan Job) tetap di kode karena itu mesin; line, unit, dan urutan langkah baru cukup data. Menggantikan kolom per unit di bagian 5 **Diubah W73:** tiap Unit tepat satu jenis pekerjaan. **Diubah W92:** kebijakan Job tidak lagi berupa daftar pilihan. | User |
| W34 | ~~Satu unit satu proses, ditahan~~ **Dilepas dan digantikan W73;** BSTB hanya antar Workstation dan Push dalam Workstation kembali berlaku lewat W64, dengan Dokumen Push (W58) | User |
| W35 | **Sementara satu line boleh punya banyak routing; tiap routing tahu line-nya** (P227; satu routing per line dari P226 ditarik). Tidak berversi dan tanpa tanggal berlaku: partai menunjuk routing mana yang diikuti, dan routing yang dipakai terkunci langkahnya, jadi urutan baru berarti routing baru. Segmen pra-partai tetap satu routing tanpa line | User |
| W36 | **Standard Cost tidak bisa diedit setelah dibuat, dan hanya satu versi yang aktif** (P226). Menyimpan versi baru otomatis menutup versi yang aktif, dan versi baru itulah yang dipakai sejak saat itu; yang ditutup tidak bisa dibuka lagi. Partai dan No. Stok menyimpan id versinya, jadi menutup versi tidak mengubah barang yang sudah berjalan. Tanpa tanggal berlaku | User |
| W37 | **BSTB Issue dibukukan pada Tanggal dokumennya**, walau Terima dilakukan pada hari lain (P228). Barang terkunci sejak Ajukan sebagai reservasi di buku stok, jadi Delivery Note dan dokumen lain tidak bisa mengambilnya. Bahan ke Produksi hanya ke Unit pertama routing; Bahan Penolong ke Unit mana pun | Asumsi, perlu dikonfirmasi user |
| W38 | **No. Job lahir karena barang perlu identifikasi, bukan karena grading.** Kebutuhan identifikasi itu baru muncul saat barang keluar Grading Halus, jadi di situlah No. Job pertama terbit. Jenis pekerjaan unit tidak menentukan No. Job | User |
| W39 | **Pra-partai dan partai adalah satu produksi**, hanya cara berpikirnya seperti produksi 1 dan produksi 2: produksi 1 tanpa partai, berakhir di output Penyebaran, yang menjadi input produksi 2 berpartai. Karena itu urutan UGH → UPC → UPY tetap dicatat sebagai routing tanpa line, dan produksi tidak dipecah | User |
| W40 | **Routing hanya urutan unit** (P230). "No. Job saat keluar" dan "Keluar lewat" adalah atribut **Unit**, kembali seperti tabel bagian 5; langkah routing hanya menyimpan urutan, checkpoint dan boleh dilewati. Menggantikan bagian W33 yang menaruhnya di langkah. Line lain yang butuh aturan keluar berbeda memakai unit sendiri **Diubah W64:** Keluar Lewat dihitung otomatis. **Diubah W92:** yang disimpan di Unit hanya Lepas No. Job dan Terbitkan Job Order. | User |
| W41 | **BSTB Issue tetap menjadi titik mulai.** SOP mengambil BB dari Cold Storage tanpa dokumen; Cold Storage dicatat sebagai Gudang, Admin Bahan Baku mengajukan dan Grading Halus menerima | User, SOP |
| W42 | **Pre Cleaning tetap Pass Through dan membawa catatan.** Catatan hasil pre cleaning (jenis dan berat) tidak mengubah jenis maupun No. Job, dibawa ke Penyebaran, lalu digrading dan divalidasi di sana. Menegaskan W6 | User, SOP |
| W43 | **Di dalam produksi pembobotan memakai gram**, bukan proporsi harga pasar, dan tidak ada proporsi ulang di final grading. Menegaskan W32. Proporsi harga di WI-ACC-001 berada di Grading Kasar, sebelum produksi | User, SOP |
| W44 | **Partai tetap lahir di Penyebaran.** Nomor `Pt_…` lama hanya referensi migrasi | User, SOP |
| W45 | **Perpindahan mengikuti SOP**: per pasangan unit ditentukan cukup pindah (Push) atau perlu BSTB. Daftarnya ada di W59. Mengubah W20 dan W21 sebatas pasangan itu; dasar untuk melepas W34 **Digantikan W64:** penentunya kini Workstation. | User, SOP |
| W46 | **BSTB ke Finish Goods memakai QC, satu-satunya BSTB yang masih ber-QC (W67)**, sesuai release Packing. BSTB Issue tetap tanpa QC. Mengubah W22 | User, SOP |
| W47 | **Grading adalah pencatatan transformasi dan perubahan qty.** Jenis boleh tetap atau berubah, gram boleh berubah. Berlaku di Penyebaran dan Dry A. Hasil Penyebaran terkumpul di Stand By dengan identitas No. Stok-nya; pembentukan partai boleh mendapat tempat sendiri bila kelak perlu | User |
| W48 | ~~Gerbang lab per partai sebelum cetak~~ **Digantikan W70** | User, SOP |
| W49 | **Approval BSTB diabaikan dulu**; diterapkan setelah alur bersih | User |
| W50 | **Reproses tetap sesuai bagian 9; sisa partai menunggu.** Dry A kotor kembali ke Cabut memakai Reproses. Menegaskan W13 **Diubah W78 dan W80.** | User |
| W51 | **Semua item, termasuk BJL, tetap disimpan dengan No. Stok** | User |
| W52 | **Packing mengikuti SOP**: gramasi dan stiker daun adalah Packing 95; box dan karton adalah Packing 98 (Final Packing). Reguler tanpa karton. Mengubah bagian 5, 6, dan W14; lihat W61 | User, SOP |
| W53 | **Final Grading hanya sebutan untuk grading terakhir**, bukan proses tersendiri | User |
| W54 | **Sales Planning memakai W15, ditambah informasi stok packing 95 dan BB.** Rencana Produksi satu dokumen dengan tahap target | User, SOP |
| W55 | **Home Industri dianggap tidak ada dulu** | User |
| W56 | **FG langsung Tersedia dan produksi mencatat gram saja** untuk sementara; karantina dan kadar air dilewati dulu (W62) | User |
| W57 | **Untuk sekarang BSTB hanya konfirmasi.** Terima menerima tepat isi dokumen, tanpa barang hilang atau bertambah dan tanpa pencatatan selisih. Menutup O-01 | User |
| W58 | **Push selalu memakai dokumen sendiri, Dokumen Push**, sebagai jejak perpindahan. Draft → Posting, tanpa QC dan tanpa Terima. Saat Posting barang pindah dari Stand By unit asal ke Persiapan unit berikutnya, tanpa jurnal. **No. Job lahir di dokumen ini** bila Unit asalnya menerbitkan Job (W40): Dokumen Push keluar Grading Halus menerbitkan No. Job pertama dengan aturan W31. Syarat kelengkapan partai berlaku di checkpoint (W71). Nomor `PSH_<unit>_<ddmmyy>_<NNNNN>`, unit tujuan seperti BSTB (W11). Menutup O-09; menggantikan W21 dan Push tanpa dokumen di W34 | User |
| W59 | ~~Daftar perpindahan antar unit per pasangan~~ **Digantikan W64** | User, SOP |
| W60 | **Hasil grading selalu No. Stok baru `<induk>-<n>`, walau jenisnya sama.** Menutup O-08 | User |
| W61 | **Pack di Packing 95 adalah isi kotak.** Komposisi dan No. Stok Kotak lahir di Packing 95, bersama gramasi dan stiker daun. Packing 98 menambah box dan karton sebagai nilai; gram dan No. Stok Kotak tetap. Menutup O-07 | User |
| W62 | **Di luar scope untuk sekarang:** barang retur dan tukar barang di Cabut (O-02), kadar air (O-04), karantina sesudah FG (O-05) | User |
| W63 | **Dokumen ini adalah dokumen informasi utama produksi.** Setiap keputusan dan perubahan produksi diperbarui di sini dalam commit yang sama. `walet sop.md` tetap ringkasan SOP, dan `Production-Process.md` tetap mencatat yang sudah ada di `main` | User |
| W64 | **Dalam satu Workstation selalu Push, lintas Workstation selalu BSTB.** Keluar Lewat dihitung otomatis dari routing dan Workstation, bukan isian master Unit, jadi aturan ini tidak bisa dilanggar. Dry A → Moulding (grading) karena itu Push. Menggantikan W45 dan W59, mengubah W40 | User |
| W65 | **QC Check adalah tahap di unit, sesudah proses:** Persiapan → Proses → QC Check → Stand By. Ada di 9 unit: Grading Halus, Pre Cleaning, Pre Wash, Cleaning (QC Cabut), Dry A, Moulding (grading), Dry B, Wrapping (mencakup WIP Steam), Barcoding (QC Final Grading). Unit tanpa QC Check, sesuai bagan QC: Penyebaran, CCP-1, Sortir, Moulding (process). OK masuk Stand By; jelek balik ke Persiapan unit itu. Keputusan **utuh per baris**, alasan Balik opsional, semua hasil proses termasuk BJL ikut QC Check. Tiap pemeriksaan satu dokumen `QCK_<unit>_<ddmmyy>_<NNNNN>`, tanpa jurnal **Dipertegas W77:** QC hanya validasi. | User |
| W66 | **Barang Balik QC harus jelas No. Stok-nya.** Ia menjadi baris sendiri di Persiapan, tidak melebur dengan saldo No. Stok yang sama, dengan tanda Balik QC dan nomor dokumen QC-nya. **Diproses lagi kena biaya unit lagi**, dan biaya ulang itu tercatat pada No. Stok tersebut dan dokumen yang memprosesnya. Di unit grading, proses ulang tetap grading biasa, jadi hasilnya No. Stok baru (W60). **Reproses antar unit tetap ada** (W78) | User |
| W67 | **BSTB dan Dokumen Push murni pindah tempat.** QC pada BSTB dihapus, kecuali BSTB ke Finish Goods (W46). **BSTB yang sudah Diajukan tidak bisa dibatalkan atau ditolak;** barang salah dikoreksi sesudahnya. Batalkan tetap hanya untuk Draft | User |
| W68 | **Moulding dipecah menjadi Moulding (grading) `UMG` dan Moulding (process) `UMP`; prosesnya bukan Mix.** Barang masuk membawa Partai, Job dan No. Stok. UMG grading 1 No. Stok = 1 No. Grading seperti Penyebaran: No. Job lepas, No. Partai tetap. Dokumen Push ke UMP melahirkan **No. Job Moulding** per pengambilan (W31) dan membawa Job Order. UMP Pass Through, hasilnya di-Push ke Dry B. Dry B grading melepas No. Job Moulding dan Job Order; No. Stok lahir menurut W60. BSTB Dry B ke Wrapping memberi No. Job baru `UDB`. **No. Partai tidak pernah lepas dari No. Stok**, dan seluruh kegiatan ini dalam satu partai. No. Moulding, Grading Mix dan Job Order sebagai Eksekusi dihapus. **Tiap unit punya rate sendiri.** Menggantikan W7, V4, V5 dan bagian Moulding di W25 | User |
| W69 | **1 No. Job Moulding = 1 Job Order.** Nomor `JO_<ddmmyy>_<NNNNN>`, target jenisnya sebuah Item, ditetapkan per No. Job di Dokumen Push; satu Dokumen Push boleh membawa beberapa No. Job dengan target berbeda. Target tidak memaksa jenis: jenis tetap berubah lewat grading Dry B. Job Order ikut lepas saat Dry B | User |
| W70 | **Uji lab bukan proses utama, melainkan salah satu keputusan QC.** Tidak ada tombol atau gerbang lab; **QC Moulding** di Moulding (grading) menggantikannya. Menggantikan W48 | User |
| W71 | **Sementara checkpoint hanya saat keluar Barcoding.** Dari Grading Halus sampai Wrapping perpindahan boleh parsial; keluar Barcoding seluruh isi partai harus sudah lengkap di Stand By-nya. Mengubah W28 | User |
| W72 | **CCP-1 `UC1` dan Sortir `USR` menjadi unit sendiri**, Pass Through, sesudah Cleaning dalam Workstation Cleaning. Rate Cleaning lama terbagi ke ketiganya. **Rambang dan Titil diabaikan dulu** karena punya mekanisme khusus (O-10). Menutup O-06 | User |
| W73 | **1 Unit = 1 proses**, seluruh unit. **Pembentuk Partai bukan proses:** Penyebaran adalah Grading biasa, dan partai lahir pada dokumen pengiriman keluar Penyebaran; yang dikirim bersama menjadi 1 partai. Melepas W34, mengubah W33, menutup C36 | User |
| W74 | **Pengerjaan Unit memilih beberapa No. Job dalam satu eksekusi**, dan tiap No. Job wajib punya **tepat satu karyawan**. Mempertegas W26 | User |
| W75 | **Bahan penolong boleh dipakai di eksekusi apa pun**, termasuk Pass Through: mis. satu Job ditambahi bahan penolong saat dikerjakan. Nilainya masuk Job itu, gram tetap (W19). Simulasi tidak memodelkan ini | User |
| W76 | **Satu dokumen hanya untuk satu partai**, di semua unit berpartai sampai Barcoding: Pengerjaan Unit, Dokumen Push dan BSTB. Sebelum partai lahir aturan ini tidak berlaku | User |
| W77 | **QC hanya validasi: boleh lanjut, atau harus dikerjakan ulang.** QC tidak memutuskan Reproses dan tidak memutuskan Reject; dua keputusan itu milik unit, sesudah QC membalikkan barangnya | User |
| W78 | **Reproses memakai Dokumen Reproses.** Alurnya mengikuti proses yang ada, dan belum ada aturan baku lapangan: barang **di-Balik dulu oleh QC** (W66), lalu Dokumen Reproses memindahkannya dari Persiapan unit itu ke **Persiapan unit mana pun sebelumnya pada routing**. Boleh dibuat di **semua unit ber-QC**. Tujuan bebas, alasan diketik dan opsional; contoh di line Reguler, dari Wrapping: nitrit melebihi standar ke CCP-1, masih ada bulu halus ke Cleaning (Cabut), bentuk tidak standar ke Moulding (grading). Dari situ barang berjalan maju lagi mengikuti routing dengan semua aturan unitnya, dan kena biaya unit lagi (V9). Menggantikan W50 sebatas asal Reproses, dan mengakhiri BSTB Transfer jenis Reproses | User |
| W79 | **Kasus parah dikeluarkan dari produksi sebagai Reject** lewat BSTB Pengeluaran, sesudah QC membalikkan barangnya atau dari tahap lain yang diizinkan W29. Nilainya tetap diserap sisa partai; Beban Pemusnahan Produksi hanya bila tidak ada penyerap | User |
| W80 | **Sisa partai tidak menunggu di unit asal Reproses.** Ia boleh lanjut sampai Barcoding dan tertahan di checkpoint sampai barang reproses menyusul (W71). Mengubah W13 dan W50 | User |
| W81 | **Routing Reguler berlanjut sampai UP5**, dengan checkpoint pada UBC, supaya Dokumen Push keluar Barcoding punya tujuan. Selama Packing belum dibangun, UP5 hanya master dan barang berhenti di Persiapan UP5. Mengubah routing bagian 12 | User |
| W82 | **Biaya Packing yang ditagih sebelum Packing dibangun masuk varians**, karena Standar baru sampai Barcoding | User |
| W83 | **Reproses hanya ke unit sebelumnya pada routing yang sama.** Barang berpartai tidak mundur ke UGH, UPC, atau UPY, karena pra-partai routing terpisah (W39). Mempertegas W78 | User |
| W84 | **Reject sebelum partai lahir tidak punya penyerap**, jadi nilainya Dr Beban Pemusnahan Produksi / Cr WIP. Mempertegas W79 | User |
| W85 | **BSTB Pengeluaran tanpa QC: Draft → Ajukan → Terima oleh Logistik.** Nomornya memakai kode unit asal, karena tujuannya Logistik, bukan unit. Pengecualian atas "unit tujuan" di W11 | User |
| W86 | **Layar memakai Kartu No. Stok**, mengikuti W5. **Tipe Unit "Gudang" keluar dari daftar**, karena tidak ada unit yang memakainya | User |
| W87 | **Keputusan QC tetap utuh per baris (W65).** Skenario A26 berarti satu baris 60 g dari No. Stok yang saldonya 100 g, bukan baris 100 g yang dipecah | User |
| W88 | **No. Partai dan No. Job yang terbit di BSTB lahir saat Terima**, bersama gerakan buku (W20). No. Job di Dokumen Push tetap lahir saat Posting (W58) | User |
| W89 | **Tanda Balik QC hilang begitu barang pindah lewat Dokumen Reproses**, karena di unit tujuan ia barang biasa | User |
| W90 | **Checklist Closing juga menolak Dokumen Grading, Pengerjaan Unit, QC Check, Dokumen Reproses, dan BSTB Pengeluaran yang belum selesai**, selain BSTB dan Dokumen Push. Berlaku juga untuk hasil proses yang masih menunggu QC Check | User |
| W91 | **"Boleh dilewati" pada routing tersimpan tetapi belum berpengaruh**; tidak ada langkah Reguler yang memakainya, dan akibatnya dibahas bila kelak dibutuhkan | User |
| W92 | **Aturan No. Job berlaku sama di setiap perpindahan antar unit** (P240). Saat Dokumen Push atau BSTB Transfer, termasuk BSTB Penyebaran: bila barang punya No. Job, No. Job itu diteruskan; bila tidak punya, dibuat baru per pengambilan (W31). Karena itu Unit tidak lagi menyimpan "No. Job saat keluar", cukup tanda **Lepas No. Job**, hanya untuk Tipe Grading dan berlaku saat grading di unit itu: UPY, UMG, UDB. UGH tidak perlu ditandai karena belum ada Job. **Job Order bukan bagian aturan ini:** tanda sendiri **Terbitkan Job Order** di Unit (UMG), dan tiap No. Job yang keluar tetap mendapat Job Order sendiri (W69). Dengan aturan ini barang Reproses yang belum punya No. Job otomatis mendapatkannya di perpindahan berikutnya. **Di luar aturan:** BSTB Issue (No. Job pertama baru lahir keluar Grading Halus, W38), BSTB Pengeluaran, dan keluar Unit Assembly (No. Job berakhir di komposisi; ditinjau bersama Packing, O-12). **Menggantikan kebijakan No. Job di W33 dan W40.** | User |
| W93 | **Gram dibaca dari satuan dasar Item** (P241). Item bersatuan GR: qty adalah gramnya. Item bersatuan lain: 1 No. Stok = 1 keping (W16) dan gramnya disimpan di `prd_tracking_info`. Output grading cukup mengisi gram | Disetujui |
| W94 | **Baris QC Check adalah satu bucket** (P241). Dua Pengerjaan Unit atas No. Stok dan Job yang sama, yang menunggu QC bersamaan, diputuskan sebagai satu baris. Dipecah per eksekusi bila kelak QC perlu memutuskannya terpisah | Disetujui |
| W95 | **Catatan Hasil tampil di unit Pass Through sebelum partai**, tidak menyebut Pre Cleaning di kode, dan dibaca Dokumen Grading dari No. Job yang sama (W42). Bahan penolong ditandai pada bucket-nya, bukan dibaca dari tujuan BSTB Issue | Disetujui |

---

## 4. Hasil Crosscheck

| # | Temuan | v5 | SOP | Simulasi | Hasil |
| --- | --- | --- | --- | --- | --- |
| 1 | Biaya unit = gram input × rate | Ya | — | Terbukti di 5 unit | Dipakai (bagian 7) |
| 2 | Nilai 1 input → 1 output utuh, gram turun, HPP/gram naik | Ya | — | Dry A 41.865 g → 27.223 g, nilai tetap 303,2 jt | Dipakai |
| 3 | Mix partai menjadi satu No. Moulding | Ya | — | 4 Job → 1 stok UML | Digantikan W68 |
| 4 | Biaya Moulding | Dua tempat | — | Di Grading Moulding | W68, rate per unit |
| 5 | Pre Cleaning menghasilkan KK/SRB | Pass through | Waste dicatat | Catatan 6.900 + 100 | W6 |
| 6 | No. Job di Moulding s.d. Dry B | Tidak ada | — | Kolom `UML_070426_00001` | Digantikan W68: ada No. Job Moulding, dan Job Order bernomor sendiri (W69) |
| 7 | Dokumen pra-partai | Tanpa dokumen | — | Ada BSTB_UGH, BSTB_UPC | W58 |
| 8 | Packing 98 | Assembly kardus | Packing tersier | Tanpa assembly | W8, W61 |
| 9 | Grading Dry A menaikkan biaya | Rate per unit | — | Rate 0, Dry B tanpa rate | Rate boleh 0 (W17) |
| 10 | Tipe output (Utama, Turunan, BJL) | Ada | — | Tidak tampil; BS bernilai dan lanjut ke N-NL-KR | Digantikan W32: hanya BJL dan bukan BJL. BS simulasi diperlakukan sebagai non-BJL |
| 11 | Jenis N-NL (Natural Noodle) lewat rute Reguler | — | Indomie | Ya | Hanya ilustrasi mekanik |
| 12 | Grading Sampling, Home Industry, Bahan Bersih | Tidak ada | Ada | GS ada | W2, W3, bagian 15 |
| 13 | Workstation Packing | WIP Packing | Dipisah WIP Packing dan Packing | — | Ikut v5 |
| 14 | QC pra-partai | Tidak ada | Ada | — | QC Check di unit (W65) |
| 15 | Status akuntansi | Issue = masuk produksi | Bahan Baku s.d. Steam, WIP mulai Pre Wash | — | Ikut v5: WIP mulai saat Issue |

---

## 5. Struktur

**Tipe Unit** tertutup: Pass Through, Grading, Assembly (W86). **Satu Unit satu tipe** (W73).

| Workstation | Unit | Kode | Tipe | QC Check | Lepas No. Job | Keluar lewat |
| --- | --- | --- | --- | --- | --- | --- |
| BB + PPIC | Grading Halus | UGH | Grading | Ya | — | Dokumen Push |
| BB + PPIC | Pre Cleaning | UPC | Pass Through | Ya | — | Dokumen Push |
| BB + PPIC | Penyebaran | UPY | Grading | — | Ya | BSTB Penyebaran, melahirkan partai (W73) |
| Cleaning | Pre Wash | UPW | Pass Through | Ya | — | Dokumen Push |
| Cleaning | Cleaning | UCL | Pass Through | Ya, QC Cabut | — | Dokumen Push |
| Cleaning | CCP-1 | UC1 | Pass Through | — | — | Dokumen Push |
| Cleaning | Sortir | USR | Pass Through | — | — | BSTB |
| Moulding | Dry A | UDA | Grading | Ya | — | Dokumen Push |
| Moulding | Moulding (grading) | UMG | Grading | Ya, QC Moulding | Ya; tiap No. Job yang keluar membawa Job Order | Dokumen Push |
| Moulding | Moulding (process) | UMP | Pass Through | — | — | Dokumen Push |
| Moulding | Dry B | UDB | Grading | Ya | Ya, Job Order ikut lepas | BSTB |
| WIP Packing | Wrapping | UWP | Pass Through | Ya | — | Dokumen Push |
| WIP Packing | Barcoding | UBC | Grading (output pcs) | Ya, QC Final Grading | — | Dokumen Push, checkpoint |
| WIP Packing | Packing 95 | UP5 | Assembly | Belum ditinjau | Berakhir di komposisi | Dokumen Push per kotak |
| WIP Packing | Packing 98 | UP8 | Assembly box dan karton | Belum ditinjau | — | BSTB ke Finish Goods + QC |

**No. Job tidak diatur per unit saat keluar (W92):** setiap Push atau BSTB antar unit meneruskan No. Job yang ada, atau membuat yang baru bila barang belum punya. No. Job hanya hilang di unit bertanda Lepas No. Job.

**"QC Check", "Lepas No. Job" dan "Terbitkan Job Order" adalah atribut Unit**, disimpan di master Unit bersama kode, nama, workstation dan tipe. **"Keluar lewat" dihitung otomatis** (W64): unit berikutnya pada routing satu Workstation berarti Dokumen Push, beda Workstation berarti BSTB. Routing hanya urutan.

**Line** adalah master (Reguler dulu), menjadi atribut partai, dan menyimpan akun varians.

**Routing** adalah urutan unit, melekat pada line; sementara satu line boleh banyak routing (W35). Routing tanpa line mencatat urutan sebelum partai (W39). Partai menunjuk routing yang diikutinya, dan langkah routing terkunci begitu dipakai. Segmen pra-partai sama untuk semua line. Unit tujuan BSTB dan Dokumen Push selalu unit berikutnya pada routing; hanya Dokumen Reproses yang boleh mundur (W78). Perubahan master unit, tipe unit dan routing hanya oleh admin (lewat permission).

**Checkpoint (W71)** adalah tanda pada langkah routing. Sementara satu: keluar Barcoding. Sebelumnya bagian-bagian satu partai boleh berada di unit yang berbeda; di checkpoint seluruh isi partai harus sudah berkumpul di Barcoding, lolos QC Check, dan ada di Stand By.

---

## 6. Identitas

| Identitas | Aturan |
| --- | --- |
| **No. Stok** | Unik seluruh sistem (W10), 1 jenis, universal di Logistik dan Produksi. No. Stok akar lahir di Receipt Note: 1 lot, 1 supplier. Setiap hasil grading dan transformasi melahirkan nomor baru `<induk>-<n>`, walau jenisnya sama (W60). Mulai Barcoding 1 No. Stok = 1 pcs dengan gram final |
| **No. Job** | Pengelompok No. Stok yang bergerak. **Saat dibuat, 1 No. Job = 1 pengambilan 1 No. Stok** (W31); sesudah digrading ia boleh berisi beberapa No. Stok turunan. Format `<kode unit>_<ddmmyy>_<NNNNN>`. Terbit pertama di Dokumen Push keluar Grading Halus (W58). Dilepas saat grading Penyebaran dan terbit lagi di BSTB Penyebaran. Dilepas saat grading Moulding, terbit sebagai **No. Job Moulding** di Dokumen Push keluar UMG, dilepas saat grading Dry B, dan terbit lagi di BSTB keluar Dry B (W68). |
| **No. Partai** | Lahir dari BSTB Penyebaran saat Terima (W88): 1 BSTB = 1 partai = 1 line, dan yang dikirim bersama menjadi 1 partai (W73); format `P_<ddmmyy>_<NNNNN>`. **Tidak pernah lepas dari No. Stok** sampai Packing (W68). Satu dokumen satu partai (W76). Tidak diasumsikan 1 supplier. Menyimpan id routing yang diikuti (milik line-nya, W35) dan id Standard Cost yang aktif (W36) |
| **No. Grading** | Dokumen `NG_<unit>_<ddmmyy>_<NNNNN>`; penghubung stok lama dan baru. **1 No. Stok input = 1 No. Grading** (W25); satu No. Stok yang diambil beberapa kali menghasilkan No. Grading tiap pengambilan dan sisanya tetap saldo. Grading ulang sesudah Reproses punya No. Grading sendiri |
| **Dokumen QC Check** | `QCK_<unit>_<ddmmyy>_<NNNNN>`; mencatat No. Stok yang diperiksa, hasilnya, dan alasan bila Balik (W65) |
| **Dokumen Reproses** | `RPR_<unit>_<ddmmyy>_<NNNNN>`, unit tujuan seperti BSTB (W11, W78); menyimpan unit asal, unit tujuan, No. Stok dan alasan |
| **Job Order** | Dibawa satu No. Job Moulding: 1 No. Job = 1 Job Order (W69), nomor `JO_<ddmmyy>_<NNNNN>`, target jenisnya sebuah Item (sheet `job_order_moulding` menjadi Item). Terbit di Dokumen Push keluar UMG, lepas saat grading Dry B |
| **No. Stok Kotak** | Stok baru hasil Packing 95, lahir saat pack dibentuk, item = Nama Jual, qty 1, gram = Σ pcs; tetap sampai FG (W61) |
| **No. Kardus** | Pengelompok kotak, **bukan stok** (W8) |

**Satu No. Stok boleh ada di beberapa partai**, karena BSTB Penyebaran boleh sebagian qty. Karena itu bucket produksi adalah **No. Stok · Unit · Tahap · Partai · Job**, partai dan job boleh kosong.

**Atribut produksi tiap No. Stok** disimpan di `prd_tracking_info`, bukan di tabel buku stok (§3.1 Claude-ERP): versi rate, gram, dan penanda pcs atau kotak. BJL atau bukan dibaca dari Item (W32), tidak disimpan di sini.

**Dokumen yang tidak terikat unit** (Rencana Produksi, Tagihan Biaya) tetap memakai P15. Pengecualian W11 mencakup: `BSTB_<unit>_…`, `PSH_<unit>_…`, `NG_<unit>_…`, `KRJ_<unit>_…`, `ASM_<unit>_…`, `QCK_<unit>_…`, `RPR_<unit>_…`, dan `JO_…`.

---

## 7. Valuasi

**Aturan umum.** Nilai disimpan rupiah bulat per bucket; rate `Decimal(18,6)`; pembagian memakai sisa terbesar sehingga total selalu pas; HPP/gram hanya hasil hitung. Simulasi tidak membulatkan, jadi selisih ≤ Rp1 per langkah dianggap benar.

**Pembagian nilai (W32).** Setiap pembagian di V2–V7 dan Reject memakai gram, hanya ke No. Stok yang Itemnya bukan BJL; BJL selalu 0 tetapi gramnya tetap dihitung sebagai qty dan dalam biaya unit. Satu fungsi (`shareByWeight`, bobot 1 untuk non-BJL dan 0 untuk BJL). Pembagian grading terjadi dalam lingkup satu No. Grading (satu No. Stok input, W25). Bila tidak ada penerima (semua output BJL), nilainya masuk Beban Pemusnahan Produksi. Angka skenario A3 tidak berubah, karena simulasi tidak memuat BJL.

| # | Peristiwa | Perhitungan |
| --- | --- | --- |
| V1 | Biaya unit | S = gram input × rate versi yang terkunci; satu kali per gram per lintasan unit; **Balik QC yang diproses lagi kena V1 lagi** (W66) |
| V2 | Pass Through | S dibagi ke No. Stok dikerjakan yang bukan BJL menurut gramnya (W32); gram BJL ikut dalam S. Bahan penolong yang dipakai menambah nilai Job itu (W75). Tanpa BJL hasilnya sama dengan simulasi: gram × rate |
| V3 | Grading | Nilai input + S + bahan penolong dibagi ke output non-BJL menurut gramnya, dalam lingkup satu No. Grading (W32). BJL selalu 0; bila semua output BJL, nilainya Dr Beban Pemusnahan Produksi / Cr WIP |
| V4 | ~~Grading Moulding~~ | Digantikan W68: Moulding (grading) memakai V3, rate unit sendiri |
| V5 | ~~Job Order~~ | Digantikan W68: Moulding (process) memakai V2, rate unit sendiri |
| V6 | Assembly Packing 95 | Σ nilai pcs + bahan penolong + biaya unit atas gram pcs |
| V7 | Assembly Packing 98 | Nilai box dan karton + biaya unit dibagi ke kotak isinya menurut gram; gram dan No. Stok Kotak tetap (W61) |
| V8 | Bahan penolong | Masuk ke unit lewat BSTB Issue pada nilai MAC; boleh dipakai di eksekusi apa pun (W75). Terpakai = round(V × q ÷ Q) dari bucketnya. Sisa kembali membawa nilainya |
| V9 | Reproses | V1 lagi di tiap unit yang dilewati ulang, mulai unit tujuan Dokumen Reproses, memakai versi partai. Balik QC mengikuti aturan yang sama di unitnya (W66) |

**Penguncian versi rate.** "Aktif" berarti satu-satunya versi aktif (W36); dokumen menyimpan id-nya.

| Barang | Versi dipakai |
| --- | --- |
| Pra-partai | Yang aktif saat No. Stok mulai di Grading Halus |
| Sesudah partai s.d. Barcoding | Yang aktif saat partai terbentuk |
| Packing 95 dan 98 | Yang aktif saat kotak atau kardus dibuat |

**Jurnal**

| Peristiwa | Jurnal |
| --- | --- |
| BSTB Issue, saat Terima | Dr WIP / Cr Persediaan |
| Biaya unit | Dr WIP / Cr Biaya Produksi Dibebankan |
| Grading, Assembly | Dr WIP output / Cr WIP input, hanya bila akunnya berbeda |
| BSTB Transfer, Dokumen Push | Tidak ada |
| Dokumen Reproses | Tidak ada; biaya ulang masuk lewat Biaya unit di tiap unit yang dilewati |
| QC Check, OK maupun Balik | Tidak ada; biaya ulang masuk lewat Biaya unit saat diproses lagi |
| BSTB ke Finish Goods | Dr Persediaan / Cr WIP |
| BSTB Pengeluaran | Lihat bagian 9 |

---

## 8. Alur Line Reguler

| # | Unit | Masuk | Dokumen | Keluar | Syarat keluar |
| --- | --- | --- | --- | --- | --- |
| 0 | Logistik | Stok Logistik | BSTB Issue | No. Stok di unit tujuan; bahan penolong menjadi saldo unit | Terima oleh unit |
| 1 | Grading Halus | No. Stok akar | 1 No. Grading per No. Stok, boleh parsial (W25); lalu Dokumen Push | No. Stok turunan; No. Job terbit di Dokumen Push (W58); sisa tetap saldo | Versi rate dicatat |
| 2 | Pre Cleaning | No. Stok + Job | Pengerjaan Unit, pilih Job dan karyawannya (W74), dan catatan hasil (W42); QC Check; lalu Dokumen Push | Sama, gram tetap (W6); catatan dibawa ke Penyebaran | Lolos QC Check, ada di Stand By |
| 3 | Penyebaran | No. Stok + Job | 1 No. Grading per No. Stok (W25), No. Job lepas; lalu BSTB Penyebaran | No. Partai + No. Job baru + line; versi rate dan routing terkunci; boleh sebagian qty | Ada di Stand By, Terima |
| 4 | Pre Wash | Partai | Pengerjaan Unit (W74); QC Check; lalu Dokumen Push | Sama | Lolos QC Check; parsial boleh |
| 5 | Cleaning | Partai | Pengerjaan Unit (W74); QC Cabut; lalu Dokumen Push | Sama | Lolos QC Check; parsial boleh |
| 6 | CCP-1 | Partai | Pengerjaan Unit (W74); lalu Dokumen Push | Sama | Ada di Stand By; parsial boleh |
| 7 | Sortir | Partai | Pengerjaan Unit (W74); lalu BSTB | Sama | Ada di Stand By, Terima; parsial boleh |
| 8 | Dry A | Partai | 1 No. Grading per No. Stok (W25); QC Check; lalu Dokumen Push | No. Stok turunan, Job tetap; susut terlihat | Lolos QC Check; parsial boleh |
| 9 | Moulding (grading) | Partai | 1 No. Grading per No. Stok (W25), No. Job lepas; QC Moulding (W70); lalu Dokumen Push | No. Stok turunan, Partai tetap; No. Job Moulding dan Job Order terbit (W68, W69) | Lolos QC Check; parsial boleh |
| 10 | Moulding (process) | Partai + No. Job Moulding | Pengerjaan Unit (W74); lalu Dokumen Push | Sama, Job Order dibawa | Ada di Stand By; parsial boleh |
| 11 | Dry B | Partai + No. Job Moulding | 1 No. Grading per No. Stok (W25), No. Job Moulding dan Job Order lepas; QC Check; lalu BSTB | No. Stok turunan, Partai tetap; No. Job baru terbit di BSTB | Lolos QC Check, Terima; parsial boleh |
| 12 | Wrapping | Partai | Pengerjaan Unit (W74); QC Check; lalu Dokumen Push | Sama | Lolos QC Check; parsial boleh |
| 13 | Barcoding | Partai | 1 No. Grading per No. Stok (W16, W25); QC Final Grading; lalu Dokumen Push | Pcs: 1 No. Stok per keping, gram final | **Checkpoint:** seluruh isi partai lolos QC Check dan di Stand By (W71) |
| 14 | Packing 95 | Pcs, bahan penolong | Assembly mengacu BoM Packing: gramasi dan stiker daun (W61) | Kotak + komposisi; pcs sisa tetap saldo | Dokumen Push per kotak |
| 15 | Packing 98 | Kotak, box, karton | Assembly box dan karton (W61) | Kotak yang sama, dengan No. Kardus bila ada | BSTB ke Finish Goods, QC PASS (W46) |
| 16 | Finish Goods | Kotak | Terima | Stok Logistik berstatus Tersedia (W56), pool MAC Nama Jual, No. Stok tetap | Produksi selesai |

**Pengerjaan Unit** boleh bertahap, biaya masuk periode tanggal postingnya. Satu eksekusi boleh memilih beberapa No. Job dari Persiapan, semuanya dari satu partai (W76), dan tiap No. Job punya tepat satu karyawan (W74); catatan itu milik pengerjaan, bukan atribut No. Job.

**Persiapan, QC Check dan Stand By (W29, W65).** Di tiap unit, Terima BSTB atau Dokumen Push memasukkan barang ke **Persiapan**. Barang keluar dari Persiapan hanya lewat **Eksekusi Produksi** (W30): Pengerjaan Unit, Grading atau Assembly memicu transformasi dan biaya. Di unit ber-QC hasilnya masuk **QC Check**: OK ke **Stand By**, jelek balik ke Persiapan sebagai baris sendiri (W66). Di unit tanpa QC hasilnya langsung ke Stand By. BSTB Transfer, Dokumen Push dan BSTB ke Finish Goods hanya mengirim dari Stand By; BSTB Pengeluaran boleh dari Persiapan dan Stand By. "Belum dikerjakan" di aturan BSTB berarti masih di Persiapan.

**BoM Packing:** 1 BoM = 1 Nama Jual: kotak, bahan penolong, jenis dan berat isi. Hanya rencana, tidak pernah menolak; kasus berbeda dibuat BoM baru.

### Siklus BSTB dan Dokumen Push

| Mode | Dipakai | Alur |
| --- | --- | --- |
| Dokumen Push | Antar unit dalam satu Workstation (W64) | Draft → Posting; tanpa Terima; buku bergerak saat Posting |
| BSTB tanpa QC | BSTB Issue, dan antar unit lintas Workstation (W64, W67) | Draft → Ajukan → Terima |
| BSTB dengan QC | Hanya BSTB ke Finish Goods (W46) | Draft → Ajukan → QC **PASS** → Terima; **REJECT** = BSTB batal, barang tetap |
| Dokumen Reproses | Barang Balik QC mundur pada routing (W78) | Dalam satu Workstation seperti Dokumen Push; lintas Workstation seperti BSTB tanpa QC (W64) |
| BSTB Pengeluaran | Keluar ke Logistik (W85) | Draft → Ajukan → Terima oleh Logistik |

- Barang terkunci sejak Ajukan, dan buku hanya bergerak saat Terima (W20). Batalkan hanya untuk Draft; BSTB yang sudah Diajukan tidak bisa dibatalkan atau ditolak (W67).
- **Untuk sekarang BSTB hanya konfirmasi (W57):** Terima menerima tepat isi dokumen. Gram berubah hanya lewat grading (W47).
- **Sampai sebelum keluar Barcoding**, BSTB dan Dokumen Push boleh berisi sebagian isi partai (W71).
- **Keluar Barcoding adalah checkpoint**: Dokumen Push wajib berisi seluruh isi partai. Bagian partai yang tertinggal di unit sebelumnya menahan checkpoint.
- Satu dokumen hanya untuk satu partai (W76).
- Di checkpoint, ditolak bila masih ada isi partai yang belum dikerjakan, sedang di QC Check, Balik QC, atau sedang reproses (W80).
- Isi partai dihitung setelah dikurangi barang yang sudah keluar produksi.

---

## 9. Pengeluaran dan Reproses

**BSTB Pengeluaran** bisa dari unit mana saja, dari **Persiapan maupun Stand By** (W29), dan boleh sebagian qty. Barang membawa No. Stok dan partai asal ke Logistik.

| Alasan | Nilai keluar | Ke mana nilainya | Jurnal |
| --- | --- | --- | --- |
| **Reject** | 0 | Diserap sisa isi partai yang bukan BJL menurut gramnya; dicatat per partai sebagai susut | Tanpa jurnal bila akun WIP sama |
| **Hasil samping** (BJL, waste) | 0 | Sudah 0 sejak grading (W12) | Tidak ada |
| **Sisa bahan penolong** | Nilai bucketnya | Kembali ke Persediaan | Dr Persediaan / Cr WIP |
| **Pcs sisa** | Dipilih: 0, atau nilai saat itu | Bila 0, seperti Reject | Bila bernilai: Dr Persediaan / Cr WIP |

Reject yang tidak punya penyerap, termasuk Reject sebelum partai lahir (W84), dibebankan ke Beban Pemusnahan Produksi (W32). Pcs rusak sesudah Barcoding memakai alasan Reject.

**Reject** untuk kasus yang sangat parah memakai BSTB Pengeluaran di atas (W79). Keputusannya milik unit, bukan QC (W77).

**Balik QC** dan **Reproses** berbeda (W66, W78). Balik QC mengembalikan barang ke Persiapan unit yang sama. Reproses memindahkan barang yang sudah Balik QC itu mundur ke unit sebelumnya.

| Langkah | Aturan |
| --- | --- |
| 1. QC Check | Barang di-Balik QC ke Persiapan unit itu, sebagai baris sendiri (W66) |
| 2. Keputusan unit | Dikerjakan ulang di unit itu, dibuatkan Dokumen Reproses, atau dikeluarkan sebagai Reject |
| 3. Dokumen Reproses | Dari unit ber-QC mana pun, atas baris Balik QC, boleh sebagian qty, ke unit mana pun sebelumnya pada routing yang sama (W83); alasan opsional |
| 4. Di unit tujuan | Barang masuk Persiapan tanpa tanda Balik QC (W89), tetap di partainya, No. Stok tetap sampai digrading ulang; stok hasilnya terhubung ke induk |
| 5. Berjalan maju | Mengikuti routing dengan semua aturan unit, termasuk QC Check, biaya V9, dan aturan No. Job. Barang yang melewati UMG mendapat No. Job Moulding dan Job Order baru; barang yang langsung ke UMP tidak membawa Job Order |
| 6. Sisa partai | Tetap jalan sampai Barcoding, tertahan di checkpoint sampai barang reproses menyusul (W80) |

**Contoh line Reguler dari Wrapping** (bagan Alur Reproses):

| Masalah | Kembali ke |
| --- | --- |
| Kandungan nitrit melebihi standar | CCP-1 |
| Masih ada bulu halus | Cleaning (Cabut) |
| Bentuk tidak standar | Moulding (grading) |

Daftar ini contoh, bukan batasan: tujuan bebas ke unit sebelumnya (W78).

---

## 10. Closing Costing Produksi

Satu periode bulan = satu closing. Checklist P210 tetap, ditambah tidak ada BSTB yang belum Terima, tidak ada Dokumen Push yang masih Draft, dan dokumen lain di W90. Bersifat final dan mengunci periode (W23).

| Angka | Sumber |
| --- | --- |
| **Aktual (A)** | Debit bersih periode pada akun Jenis Biaya: dari Tagihan Biaya dan jurnal manual, sama seperti sekarang |
| **Standar (S)** | Σ `prd_cost_entry` periode = kredit Biaya Produksi Dibebankan |
| **Varians** | A − S |

```
A > S:  Dr Varians Produksi (akun HPP milik line) / Cr Biaya Produksi Dibebankan
A < S:  Dr Biaya Produksi Dibebankan / Cr Varians Produksi
```

Sesudahnya akun biaya dikurangi Biaya Produksi Dibebankan = 0.

- **Bahan penolong tidak ikut**, karena sudah masuk WIP sebesar MAC, bukan lewat akun Jenis Biaya.
- **Tidak ada alokasi ke WIP atau FG:** Driver, revaluasi maju dan `revaluePool` dihapus.
- **HPP line** = HPP Delivery Note kotak line itu + varians line. Dengan satu line, seluruh S dan A milik Reguler, termasuk pra-partai.
- **Proyeksi Varians** menggantikan Costing Sementara: kalkulasi yang sama, tanpa menulis apa pun.

---

## 11. Sales Planning

Menu baru untuk PPIC, membaca baris Sales Order berstatus Open yang belum terkirim seluruhnya. Stok Packing 95 dan BB ditampilkan sebagai informasi (W54).

| Kolom | Isi |
| --- | --- |
| Sales Order | Nomor, customer, Tanggal Kirim |
| Nama Jual, Qty | Sisa belum terkirim |
| FG Tersedia | Saldo stok Tersedia, dibagi ke baris dengan Tanggal Kirim terdekat lebih dulu |
| Hasil | **FG cukup:** tidak perlu rencana, lanjut Delivery Order. **FG kurang:** tombol Buat Rencana Produksi |

**Rencana Produksi** (`prd_plan(_line)`, `RP/YYYY/MM/NNNN`): satu dokumen dengan tahap target (W54); Nama Jual, Qty, Tanggal Mulai, dan baris Sales Order yang ditutupinya. Draft → Terbit → Selesai. Tidak memposting apa pun dan tidak mereservasi stok. BSTB Penyebaran boleh menyebut Rencana sebagai referensi laporan.

---

## 12. Dampak ke Sistem

| Yang ada | Tindakan |
| --- | --- |
| Tagihan Biaya, Pembayaran Biaya Produksi, Jenis Biaya, Account WIP | **Tetap** |
| `inventory.ts`, buku stok, MAC | Tetap; `log_stock_tracking` unik seluruh sistem (W10). Nomor baru tiap penerimaan ditegakkan di Receipt Note dan `db:stock-inject`; `receiveStock` tetap menerima nomor yang sudah ada, karena BSTB ke Finish Goods dan Pengeluaran membawa No. Stok yang sama kembali ke Logistik |
| `production-ledger.ts` | Tetap sebagai buku; kunci bucket jadi No. Stok · Unit · Tahap · Partai · Job (P227) |
| `exit_mode` di `ref_unit`, seed P229 | **Selesai (P239).** Kolom dibuang, Keluar Lewat dihitung dari routing dan Workstation (W64); seed berisi 14 unit sampai UP5 (W81), UP8 menyusul bersama Packing |
| `ref_unit.processes`, `PrdProcessKind`, `entities.ts`, `production-master-shape.ts` | **Selesai (P239).** Satu jenis pekerjaan per Unit (W73). `GradingMix`, `JobOrder` dan `PartaiFormer` dibuang; aturan "pra-partai berakhir di unit Pembentuk Partai" diganti: berakhir di Penyebaran, yang keluar lewat BSTB |
| `ref_unit` | **Selesai (P239).** Ditambah penanda QC Check, `has_qc` (W65) |
| `PrdStage`, `prd_balance`, `prd_ledger` | Ditambah tahap QC Check; bucket Balik QC harus terpisah dari saldo No. Stok yang sama (W66) |
| Routing REG-1 di seed | **Selesai (P239).** UPW → UCL → UC1 → USR → UDA → UMG → UMP → UDB → UWP → UBC, checkpoint pindah dari UDA ke UBC (W71), lalu berlanjut ke UP5 (W81). Belum ada partai memakainya, jadi langkahnya diganti di tempat; routing yang sudah dipakai dibiarkan terkunci |
| `prd_tracking_link` | Tetap; ditambah komposisi `prd_composition` |
| `period-lock.ts`, checklist closing | Tetap. Guard tahun buku R28 ditulis ulang agar membaca `prd_ledger`, bukan Eksekusi |
| Telusur, Kartu No. Stok (W86), Saldo Produksi | Tetap, diubah: Partai dan Job, himpunan supplier setelah mix, komposisi kotak |
| `log_stock_issue` | Diubah: tambah Terima dan tujuan bahan penolong ke unit. Struktur baris dan pick tetap |
| `production-doc.ts`, `production-doc-workflow.ts` | Tetap; konstanta Transfer dan Release dibuang |
| Akun Beban Pemusnahan Produksi, Biaya Produksi Dibebankan | Tetap. Yang pertama dipakai bila tidak ada penerima nilai (W32); yang kedua kini dikredit saat biaya unit dicatat |
| R3–R8, R10–R14, R17, R19–R26 (Production-Plan) | **Dicabut.** R27: Rencana vs Aktual dicabut, Telusur tetap. Langkah 12–15 lama dibatalkan |
| R9, R15, R16, R18, R28 | Tetap |

### Drop dan deprecated (P217)

**Aturan:** yang namanya sama tetapi isinya berbeda terlalu jauh di-drop dulu, lalu ditambahkan lagi saat langkahnya tiba. Tidak ada kode yang dibiarkan menggantung.

**Drop lalu dibangun ulang**

| Yang di-drop | Alasan | Dibangun lagi |
| --- | --- | --- |
| `ref_workstation`, `WORKSTATION_*` | Artinya berubah dari tempat barang menjadi pengelompok Unit | Langkah 1, dalam satu migrasi dengan `ref_unit` |
| `prd_execution(_input, _output)`, `production-run.ts`, `PRODUCTION_EXECUTION_*` | Satu jenis ber-Driver menjadi tiga jenis dengan rate, flag BJL, bahan penolong, Partai dan Job | Langkah 4–8 |
| `prd_transfer(_line)`, `production-transfer.ts`, `PRODUCTION_TRANSFER_*` | Perpindahan langsung menjadi siklus BSTB dengan mode, QC, Terima dan syarat partai | Langkah 4–5, 9 |
| `prd_release(_line)`, `production-release.ts`, `production-release-purposes.ts`, `PRODUCTION_RELEASE_*` | Dua purpose menjadi BSTB ke Finish Goods dan Pengeluaran beralasan | Langkah 8–9 |
| `prd_cost_close(_pool, _share, _dest, _item)`, bagian hitung `production-close.ts`, layar Penutupan | Alokasi maju menjadi Aktual dibanding Standar. `_pool` diganti `prd_cost_close_line` | Langkah 10 |

**Drop permanen**

| Yang di-drop | Alasan |
| --- | --- |
| `m_item.value_weight` | Diganti flag BJL pada Item (`m_item.is_bjl`, W32) |
| `driver`, `outputWeight` | Biaya diserap per gram × rate saat produksi |
| `production-close-shape.ts`, `revaluePool`, `revalueBucket`, `poolFlows`, `lotFates`, `postedRunsInRange` | Hanya melayani revaluasi maju |
| Movement `Revalued` | Closing tidak menulis ke buku |
| Costing Sementara, `REPORT_COSTING_SO_FAR_VIEW`, `CostingCards` | Diganti Proyeksi Varians |
| Purpose `scrap`; seri `PMS/…`, `EKS/…`, `PT/…`, `PHP/…` | Dilebur ke Reject; nomor mengikuti W11 |
| Nomor lot `<eksekusi>-<n>` dan nomor ketikan (R17) | Diganti `<induk>-<n>` |
| Perintah Produksi, BoM per workstation, Routing per item, Rencana vs Aktual | Belum dibangun; cukup dicabut dari rencana |

**Deprecated, hidup sampai penggantinya siap**

| Yang ada | Sampai | Alasan |
| --- | --- | --- |
| `ref_workstation` | Langkah 1 | `log_stock_issue`, `prd_balance` dan `prd_ledger` masih mengacu padanya |
| Posting langsung Stock Issue, seri `SI/…` | Langkah 3 | Diganti Ajukan → Terima |
| `produce()` | Drop di langkah D, ditulis ulang di langkah 4 | Masih memakai Bobot Nilai; `shareByWeight` tetap, bobotnya 1 atau 0 dari flag BJL (W32) |
| Rekap Produksi | Drop di langkah D, kembali di langkah 11 | Membaca Eksekusi dan Driver; kembali sebagai laporan susut per partai |
| `Production-Plan.md`, `Production-Baseline-Analysis.md` | Tetap sebagai arsip | R9, R15, R16, R18, R28 masih berlaku |

**Sesudah langkah D (selesai, P218)**, `main` tetap berjalan dengan Tagihan Biaya, Pembayaran Biaya Produksi, Stock Issue, Saldo Produksi, Kartu Lot dan Telusur. Sampai langkah 10, tahun buku dengan aktivitas produksi tidak bisa ditutup.

**Tabel baru:** `ref_unit`, `ref_workstation` (arti baru), `prd_execution(_input, _output)`, `prd_transfer(_line)`, `prd_release(_line)`, `prd_cost_close`, `prd_line`, `prd_routing(_step)`, `prd_rate_version(_line)`, `m_item_sale_spec`, `prd_bom_packing(_line)`, `prd_partai`, `prd_job`, `prd_tracking_info`, `prd_cost_entry`, `prd_composition`, `prd_carton(_line)`, `prd_cost_close_line`, `prd_plan(_line)`, `m_employee`, `prd_execution_worker` (satu karyawan per Job, W74), `prd_qc_check(_line)`. Bucket produksi mendapat tahap (Persiapan / QC Check / Stand By), W29 dan W65. Biaya ulang Balik QC tercatat per No. Stok (W66). `m_item` mendapat flag BJL, `is_bjl` (W32); `prd_output_type` tidak dibangun.

**Sumber salvage dari branch `walet`** (ambil per file, tidak di-merge): Partai dan Job (P163), BSTB + QC tanpa transit (P167), pass-through dan mix (P169), Rencana Produksi (P168), laporan (P171). Bucket `walet` tidak mencakup komposisi dan standard cost versi ini.

**Master awal dari simulasi:** kode unit dari sheet `units`, target Job Order dari `job_order_moulding`, Nama Jual dari `nama_jual`, jenis per tahap dari `items_*`, supplier dan customer dari sheet masing-masing. Rate simulasi (UPW 182,8637; UCL 733,3605; UDA 0; Moulding 190,8726; UWP 27,1341; UBC 41,5452) hanya contoh; rate resmi diisi user.

---

## 13. Tahapan Build

Tiap langkah: satu commit ke `main`, migrasi dan DBML bersamaan, `npm run build`, `lint`, `test` hijau, `db:reconcile` ditambah bila menulis buku, keputusan P2xx dicatat, `Production-Process.md` diperbarui, push, migrasi Neon, lalu **user review di Neon sebelum langkah berikutnya**.

| Langkah | Isi | Selesai bila |
| --- | --- | --- |
| 0 | Catat keputusan di `Claude-ERP.md` (§1.4, §12), pengecualian di `KNOWLEDGE.md`, tandai `Production-Plan.md`, reset data produksi Neon setelah disetujui | Dokumen selaras |
| D | **Selesai (P218).** Satu commit drop (bagian 12, P217), kecuali Workstation: tabel dan kode, permission dan jenis dokumen lewat migrasi, tes `production-run`, `production-move`, `production-close`; pangkas `production-ledger`, `production-report`; hapus 6 dari 12 cek produksi `db:reconcile`; tulis ulang guard R28 | Build, lint, test, `db:reconcile` hijau; menu yang tersisa berjalan |
| 1 | **Selesai (P225), kecuali istilah Lot → No. Stok di layar, yang belum dikerjakan.** Istilah di layar; drop `ref_workstation` lama, Unit + Workstation baru dalam satu migrasi; Tipe Unit, Line, Routing versi, flag BJL pada master Item (terkunci setelah dipakai), Standard Cost versi; master Karyawan; tanda checkpoint pada langkah Routing; No. Stok unik | Master bisa dibuat di browser; penerimaan kedua jenis sama mendapat nomor baru |
| 2 | **Selesai (P227).** Identitas dan buku: bucket baru, Partai, Job, `prd_tracking_info`, `prd_cost_entry` | Test buku hijau |
| 3 | **Selesai (P228).** BSTB Issue + Terima; bahan penolong ke unit | Skenario A1 |
| 4 | Penyesuaian master **selesai (P239)**, kecuali tahap QC Check di bucket yang ikut dokumen QC Check. Lalu Grading Halus (1 No. Grading per No. Stok, parsial), Pre Cleaning dengan pilih Job dan karyawan, QC Check dengan Balik QC, Dokumen Push dari Stand By | Job terbit di Dokumen Push; V1–V3 benar (BJL 0, non-BJL menurut gram); skenario A11, A13, A14, A21, A23, A25, A26 |
| 5 | Penyebaran, BSTB tanpa QC, pembentukan partai saat kirim | Skenario A2, A22 |
| 6 | Pre Wash, Cleaning, CCP-1, Sortir, Dry A, BSTB parsial | Angka sampai Dry A sama simulasi; skenario A27 |
| 7 | Moulding (grading), Moulding (process), Job Order pada No. Job, Dry B, Wrapping, bahan penolong pada Pengerjaan Unit | Angka sampai Wrapping sama simulasi; skenario A15, A28 |
| 8 | Barcoding pcs, checkpoint keluar Barcoding, BoM Packing, Packing 95 dengan komposisi, Packing 98 box dan karton, BSTB ke Finish Goods + QC, Nama Jual | Skenario A3, A4, A12, A24 |
| 9 | BSTB Pengeluaran, Reject, Dokumen Reproses | Skenario A5, A6, A30, A31 |
| 10 | Closing dan Proyeksi Varians | Skenario A7 |
| 11 | Laporan dan Telusur | Skenario A8 |
| 12 | Sales Planning dan Rencana Produksi | Skenario A9 |
| 13 | Showcase dan satu tes ujung ke ujung | Neon berisi satu bulan contoh yang sudah di-closing |

**Pembagian nilai (W32).** Langkah 4–8 memakai satu fungsi pembagi (`shareByWeight`) dengan bobot 1 untuk non-BJL dan 0 untuk BJL, dibaca dari flag pada master Item. Tidak ada langkah yang menunggu konsep lain.

---

## 14. Skenario Penerimaan

| # | Skenario | Hasil yang diharapkan |
| --- | --- | --- |
| A1 | Issue bahan penolong dan No. Stok ke unit | Baru bergerak saat Terima; bahan penolong menjadi saldo unit, bukan isi partai |
| A2 | No. Stok 10 kg masuk partai 7 kg | Sisa 3 kg tetap saldo No. Stok sama |
| A3 | Angka simulasi: 4 Job, 41.865 g, 264.847.610 | Pre Wash +7.655.587; Cleaning, CCP-1 dan Sortir +30.702.136; Dry A tetap dengan gram 27.223; Moulding (grading) dan (process) +5.196.124; Wrapping +738.672; Barcoding +1.130.985; total **310.271.114**, HPP/gram 11.397,39 |
| A4 | Kotak berisi pcs dua partai 1 line | Lolos; komposisi menyebut partai per pcs; dua line ditolak; gram di luar toleransi hanya peringatan |
| A5 | Reject sebagian di Cleaning | Keluar nilai 0; sisa partai naik sebesar nilainya; total nilai partai tetap; tercatat di laporan susut |
| A6 | Reproses dari Wrapping ke Cleaning, sebagian isi partai | Barang harus Balik QC dulu; sisa partai lanjut sampai Barcoding dan ditolak di checkpoint sampai barang reproses menyusul; biaya Cleaning dan unit sesudahnya terbebani lagi dengan versi partai |
| A7 | S = 45.423.504; Tagihan Biaya 50.000.000 | Varians 4.576.496: Dr Varians Produksi / Cr Biaya Produksi Dibebankan; WIP dan stok tidak berubah; periode terkunci |
| A8 | Telusur dari satu pcs | Kotak → pcs → Dry B → Moulding (grading) → Dry A → seluruh stok partai asalnya → akar → himpunan supplier partai |
| A9 | Sales Order 10 kotak, FG 4 | Sales Planning menampilkan kurang 6; Rencana Produksi terbuat, menunjuk baris Sales Order |
| A10 | Posting Grading Barcoding 5.000 pcs | Selesai dalam batas waktu fungsi Vercel dengan penulisan massal; bila tidak, dibahas sebelum langkah 9 |
| A11 | No. Stok 10 kg di Grading Halus: ambil 6 kg, lalu 4 kg | Dua No. Grading (G1, G2) dari satu No. Stok; sisa 4 kg tetap saldo setelah G1; nomor turunan `<induk>-<n>` berlanjut; 10 No. Stok yang dikerjakan semua menghasilkan 10 No. Grading |
| A12 | Partai dengan 5 Job; 3 Job sudah di Barcoding, 2 Job masih di Wrapping | Dokumen Push parsial Wrapping → Barcoding lolos; Dokumen Push Barcoding → Packing 95 ditolak sampai seluruh isi partai lolos QC Check dan di Stand By Barcoding (W71) |
| A13 | Pengerjaan Unit di Pre Wash atas dua No. Job | Satu eksekusi, tiap Job tepat satu karyawan, Job tanpa karyawan ditolak (W74); No. Job sendiri tidak menyimpannya; tanpa gram per karyawan dan tanpa biaya tenaga kerja |
| A14 | Terima di Cleaning, dikerjakan sebagian lewat Eksekusi Produksi | Barang masuk Persiapan; yang dieksekusi pindah ke QC Check bersama biayanya; pengiriman hanya bisa dari Stand By, barang di QC Check ditolak |
| A16 | BSTB Pengeluaran atas barang yang masih di Persiapan, dan atas barang di Stand By | Keduanya lolos; barang membawa No. Stok dan partai asal ke Logistik |
| A17 | Stand By Grading Halus: stok.001 100 kg. BSTB mengambil 30 kg, lalu BSTB lain 20 kg | Job.001 berisi 30 kg stok.001, Job.002 berisi 20 kg stok.001; sisa 50 kg tetap di Stand By; dua Job tidak digabung |
| A18 | Grading 1 jenis menjadi 4: 3 non-BJL (30, 30, 40 g) dan 1 BJL | Nilai terbagi 30% / 30% / 40% ke tiga non-BJL; BJL bernilai 0 tetapi gramnya tetap tercatat; sisa pembulatan ke bagian terbesar, total pas |
| A19 | Grading yang seluruh outputnya BJL | Nilai input Dr Beban Pemusnahan Produksi / Cr WIP; tidak ada output bernilai |
| A20 | Mengubah flag BJL pada Item yang sudah dipakai di produksi | Ditolak |
| A15 | Moulding (grading) sampai BSTB Dry B | Grading melepas No. Job, Partai tetap; Push melahirkan No. Job Moulding dan Job Order per Job (W69); Moulding (process) hanya lewat; grading Dry B melepas No. Job Moulding dan Job Order, Partai tetap; BSTB memberi No. Job baru |
| A21 | Dokumen Push keluar Grading Halus, 30 kg lalu 20 kg dari satu No. Stok | Posting memindahkan barang dari Stand By ke Persiapan Pre Cleaning tanpa QC, Terima dan jurnal; dua No. Job terbit; kedua dokumen tercatat di Kartu No. Stok |
| A22 | BSTB sampai Terima | Yang pindah tepat isi dokumen, tanpa QC dan tanpa kolom selisih (W57, W67); BSTB Diajukan tidak bisa dibatalkan |
| A23 | Grading dengan output berjenis sama | Output mendapat No. Stok baru `<induk>-<n>`, jenis tetap, gram boleh berubah (W47, W60) |
| A24 | Packing 98 menambah box pada kotak hasil Packing 95 | Nilai kotak naik, gram dan No. Stok Kotak tetap; komposisi tidak berubah (W61) |
| A25 | QC Check atas hasil proses, termasuk BJL | OK masuk Stand By; jelek balik ke Persiapan unit itu; satu baris diputuskan utuh; alasan boleh kosong; dokumen `QCK_…` tanpa jurnal (W65) |
| A26 | Baris 60 g dari No. Stok bersaldo 100 g Balik QC dan diproses lagi (W87) | Persiapan berisi dua baris No. Stok yang sama, yang balik bertanda; biaya unit masuk lagi dan tercatat pada No. Stok itu (W66); total nilai tetap seimbang |
| A27 | Pindah antar unit sepanjang routing | Dalam Workstation selalu Dokumen Push, lintas Workstation selalu BSTB, tanpa isian Keluar Lewat (W64) |
| A28 | Pengerjaan Unit satu Job ditambahi bahan penolong | Nilai bahan penolong masuk Job itu, gram tetap, saldo bahan penolong unit berkurang (W75) |
| A29 | Dokumen berisi dua partai di unit berpartai | Ditolak (W76) |
| A30 | Reproses dari Wrapping ke Moulding (grading) | Barang digrading ulang, No. Stok baru, No. Job Moulding dan Job Order baru; Partai tetap; biaya UMG dan unit sesudahnya masuk lagi |
| A31 | Barang parah di Wrapping dikeluarkan sebagai Reject | Keluar nilai 0 lewat BSTB Pengeluaran, nilainya diserap sisa partai; tanpa sisa, Dr Beban Pemusnahan Produksi / Cr WIP |
| A32 | Dokumen Reproses atas barang yang belum Balik QC, atau ke unit sesudahnya | Ditolak (W78) |

---

## 15. Ditandai dan Ditunda

**Open discussion**

Tidak ada yang tersisa. OD-1 (lingkup penyerapan BJL dan reject) dan OD-2 (pembobotan estimasi harga) ditutup oleh W32 pada 04/11/2026.

**Open dari SOP (05/11/2026).** Sumber per SOP ada di `walet sop.md` bagian 12.3.

| # | Topik | Status |
| --- | --- | --- |
| O-01 | Selisih data BSTB, misalnya BSTB 10 Job tetapi data 11 | Ditutup untuk sekarang, W57 |
| O-02 | Barang retur dan tukar barang di Cabut | Di luar scope, W62 |
| O-03 | Barcode dan sistem scan yang berjalan sekarang | **Open**, menunggu penjelasan konsep |
| O-04 | Kadar air sebagai data | Dilewati, W62 |
| O-05 | Karantina sesudah FG | Dilewati, W62 |
| O-06 | Cabut, Rambang, Titil, CCP1, Sortir: satu Unit atau Unit sendiri | Ditutup, W72 |
| O-07 | Apakah pack di Packing 95 sama dengan isi kotak; penentu letak komposisi | Ditutup, W61 |
| O-08 | No. Stok hasil grading berjenis sama: nomor baru atau tetap | Ditutup, W60 |
| O-09 | No. Job pertama bila Grading Halus ke Pre Cleaning tanpa BSTB | Ditutup, W58 |
| O-10 | Rambang dan Titil: mekanisme khusus | **Open**, diabaikan dulu (W72) |
| O-11 | Reproses: aturan dan hubungannya dengan checkpoint | Ditutup, W78–W80. Aturan lapangan belum baku, jadi bisa ditinjau lagi |
| O-12 | Packing 95 ke atas: QC Packing, aturan Push, BSTB dan QC ke Finish Goods | **Open**, requirement sedang digali; bagian ini belum disesuaikan dengan W64–W76 |

**Scope terpisah (tidak menghalangi build)**

| Topik | Catatan |
| --- | --- |
| Line Mie dan SM | Setelah Reguler final. Catatan SOP: keduanya punya Steam BB setelah Penyebaran; Mie punya Moulding Indomie dan Sortir Kering, Dry A sesudah Moulding, dan tanpa Moulding kedua; SM punya Grading Cabut dan Moulding SMK. User: Mie tetap punya Wrapping dst. Alokasi aktual ke beberapa line (gap v5 no. 2) diputuskan bersamaan |
| Makloon Home Industry | Dibahas terpisah. SOP Reguler: Pre Wash, Cabut, Dry A, Moulding & Dry B, kembali ke WIP Steam |
| Grading Sampling | Sebelum titik mulai produksi. Simulasi: ID Stok lahir di sini dan menentukan dasar PO |
| Rute BB bersih | Sementara satu alur (W3) |
| Purchase Request dari Sales Planning | Setelah komposisi BB per line diketahui |
| No. Kati, QR Caiq, barcode | Identifikasi per keping sebelum masuk kotak |
| Tukar barang, kadar air, karantina | W62 |
| UI Grading Barcoding | Import, timbangan, pemindai untuk ribuan pcs (W16) |
| BoM Packing resmi | Struktur siap; isi dari user |

**Status gap v5 bagian 12**

| Gap | Status | Gap | Status |
| --- | --- | --- | --- |
| 1 Telusur himpunan supplier | Dibiarkan (A8) | 11 Susut pass through | Dipahami (W6) |
| 2 Varians per line | Satu line sekarang (bagian 10) | 12 Pcs rusak | Reject (bagian 9) |
| 3 Aturan mulai Packing 95 | W14 | 13 SO ke rencana | W15 |
| 4 BoM resmi | Struktur siap | 14 Routing Mie, SM | Ditunda |
| 5 Tanpa No. Job di Moulding | W68 | 15 Tagihan biaya | Yang sudah ada |
| 6 Format nomor | W11, bagian 6 | 16 Pra-partai ke HPP line | Masuk Reguler |
| 7 Bobot | W32 | 17 Menu pengeluaran | Bagian 9 |
| 8 Bahan penolong | V8 | 18 Status dokumen dan stok | W20, siklus BSTB |
| 9 Reproses | W13, bagian 9 | 19 Kotak lintas partai | W14 |
| 10 Volume stock ledger | Skenario A10 | 20 Hak akses | Permission admin |

---

## 16. Risiko yang Diketahui

- **Volume pcs.** Tiap pcs menghasilkan satu No. Stok dan beberapa baris buku; ±5.000 pcs per partai menghasilkan puluhan ribu baris. Penulisan massal wajib, dan pola kunci per baris saat ini tidak cukup. Estimasi volume nyata belum ada.
- **Delivery Note per kotak.** Tiap kotak adalah No. Stok, sehingga pengiriman besar memilih banyak baris. No. Kardus dan Isi FEFO membantu; performanya diuji di langkah 8.
- **Input manual 5.000 baris** (W16) berat bagi operator sampai UI lanjutan dibangun.
- **Satu pool MAC Nama Jual** menghapus nilai per kotak di Logistik. Telusur tetap utuh, tapi HPP per kotak yang dijual adalah rata-rata, bukan nilai kotak itu.
- **Grading parsial** (W25) dan nomor baru tiap grading (W60) memperbanyak No. Grading dan No. Stok turunan; nomor `<induk>-<n>` harus berlanjut lintas pengambilan.
- **Checkpoint** (W71) kini hanya di Barcoding, jadi bagian partai boleh tersebar lebih jauh; PPIC perlu melihat bagian partai yang belum sampai. Satu Job yang tertinggal di unit mana pun menahan partai keluar Barcoding.
- **BSTB tanpa jalan balik** (W67): BSTB yang salah Diajukan hanya bisa diterima lalu dikoreksi sesudahnya.
- **Dua QC satu unit:** bagan QC memisahkan QC WIP Steam dan QC Wrapping, sistem menggabungkannya di Wrapping karena Steam belum menjadi unit (W65).
- **Reject diserap partai** (W79): kasus parah menaikkan HPP per gram sisa partai, sehingga kerugiannya tidak terlihat sebagai beban. Laporan susut per partai menjadi tempat melihatnya.