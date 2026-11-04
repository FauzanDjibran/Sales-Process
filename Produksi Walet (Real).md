# Produksi Walet (Real)

> **Dasar pengembangan produksi ERP.** Disusun 04/11/2026 dari tiga sumber dan seluruh jawaban user, sehingga
> tidak ada pertanyaan yang harus dijawab sebelum build. Yang sengaja ditunda ada di bagian 15.
>
> **Status:** rencana, belum dibangun. Saat disetujui, dokumen ini menggantikan keputusan produksi
> `Production-Plan.md` sebatas yang tercantum di bagian 12.
>
> **Putaran kedua, 04/11/2026:** W25–W32 (grading per No. Stok, karyawan di pengerjaan unit, checkpoint partai,
> Persiapan dan Stand By, Eksekusi Produksi, No. Job per pengambilan, dan pembagian nilai BJL / bukan BJL
> yang menutup OD-1 dan OD-2).
> W25 dan W26 dikoreksi user pada hari yang sama.

**Sumber dan bobotnya**

| Urutan | Sumber | Peran |
| --- | --- | --- |
| 1 | Jawaban user 04/11/2026 (W1–W24, bagian 3) | Menang atas semua sumber |
| 2 | `walet/Produksi_Walet_v5.md` | Panduan utama; bagian yang tidak disentuh dokumen ini tetap berlaku |
| 3 | `walet/Simulasi Flow Costing.xlsx`, sheet `flow` dan master pendukung | Contoh mekanik dan angka. **Datanya ilustrasi:** tanggal tidak urut dan gram tidak bersambung (Grading Halus 50 kg → 60 kg; Penyebaran 10 kg → 41,8 kg) |
| 4 | `walet/Proses Produksi - 05 Februari 2026.xlsx`, sheet Reguler, Indomie, Suchan MK | SOP lapangan, informasi pendukung |

---

## 1. Cakupan

**Dibangun sekarang: line Reguler saja (W1).**

| Masuk | Ditunda (bagian 15) |
| --- | --- |
| Dari **Logistik ke Grading Halus** sampai **Finish Goods** | Sebelum Logistik: Grading Sampling dan pembelian tetap memakai alur yang ada (W2) |
| Master produksi, identitas, BSTB + QC, grading, Job Order, packing | Line Mie dan SM, termasuk routing-nya |
| Standard cost, bahan penolong, reject, reproses | Makloon Home Industry |
| Closing costing dan varians | No. Kati dan QR Caiq per keping |
| Sales Planning dan Rencana Produksi | Purchase Request dari Sales Planning |

**Asumsi bahan:** BB kotor dan BB bersih mengikuti alur yang sama, mulai dari Issue Logistik ke Grading Halus (W3).

**Unit dilihat dari apa yang masuk dan apa yang keluar (W4).** Kegiatan di dalam unit tidak dicatat sistem:

| Unit | Kegiatan SOP di dalamnya |
| --- | --- |
| Cleaning | Penirisan, Cabut, Rambang, Titil, CCP-1, Sortir, Moulding Hancuran |
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
| **BSTB Pengeluaran, BSTB ke Finish Goods** | `prd_release` per tujuan | Production Release, Pemusnahan |
| **Eksekusi Produksi**, payung semua pekerjaan di unit (W30), dengan versi dan nama per jenis: **Dokumen Grading** (No. Grading), **Pengerjaan Unit**, **Job Order**, **Assembly** | `prd_execution` per jenis | Eksekusi Produksi (arti lama, ber-Driver) |
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
| **Bahan penolong** | Kotak, gabus, stiker, kardus, dll; punya valuasi sendiri |
| **BS** | Barang yang tidak bisa dipakai |
| **G2** | Grade 2, barang tidak standar |
| **No. Kati, QR Caiq** | Identifikasi tambahan per keping, di luar No. Stok. **Ada di lapangan, belum masuk sistem** (W9) |
| **Karyawan** | Pekerja yang mengerjakan sebuah No. Job di unit Pass Through; master baru. Dicatat saat Pengerjaan Unit sebagai informasi unit itu, tidak melekat ke No. Job; tanpa biaya tenaga kerja (W26) |
| **Persiapan** | Di tiap unit: barang atau Job yang sudah diterima lewat BSTB tetapi belum dikerjakan (W29) |
| **Stand By** | Di tiap unit: barang atau Job yang selesai dikerjakan dan menunggu diputuskan dikirim dengan BSTB (W29) |
| **Checkpoint** | Langkah routing tempat partai harus lengkap semua Job-nya sebelum lewat; sebelum itu perpindahan parsial boleh (W28) |
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
| W7 | Biaya Moulding sekali, di Grading Moulding, atas gram input. Koreksi v5 5.2 | User |
| W8 | FG adalah Nama Jual, yaitu kotak; kardus hanya alat packing | User |
| W9 | No. Kati dan QR Caiq ditandai, belum dibangun | User |
| W10 | **1 No. Stok = 1 stok unik seluruh sistem.** Tiap penerimaan melahirkan nomor baru, walau jenisnya sama. Mengubah P120 | User |
| W11 | Nomor dokumen produksi per unit mengikuti simulasi, harian. **Pengecualian lokal atas P15**, dicatat di `KNOWLEDGE.md` (jawaban D) | User |
| W12 | BJL dan waste adalah output grading ber-No. Stok, nilai 0; keluar lewat BSTB Pengeluaran | User |
| W13 | Reproses: partai **menunggu** barangnya kembali | User |
| W14 | Mulai Packing 95 kotak boleh lintas partai (tetap 1 line); BSTB per kotak | User |
| W15 | Sales Planning hanya mengecek FG; kurang berarti buat Rencana Produksi | User |
| W16 | Grading Barcoding diinput baris per baris seperti output biasa; UI yang lebih baik dibahas kemudian | User |
| W17 | Rate boleh diisi di semua unit; kosong berarti 0 | Disetujui |
| W18 | ~~Bobot awal Utama 1, Turunan 1, BJL 0 (setting Tabel Tipe)~~ **Digantikan W32** | Disetujui |
| W19 | Bahan penolong menambah nilai, bukan gram. Gram berubah hanya lewat grading. Koreksi v5 5.4 | Disetujui |
| W20 | BSTB memindahkan barang saat **Terima**; selama proses barang terkunci di pengirim, tanpa status transit | Disetujui |
| W21 | Perpindahan pra-partai memakai BSTB Transfer mode langsung, tempat No. Job terbit | Disetujui |
| W22 | BSTB Issue dan BSTB ke Finish Goods tanpa QC, cukup Terima | Disetujui |
| W23 | Closing tidak menyentuh WIP dan stok; varians masuk akun kelompok HPP. Periode tetap terkunci sesudahnya | Disetujui |
| W24 | FG masuk pool MAC per Nama Jual; toleransi gram hanya peringatan | Disetujui |
| W25 | **1 No. Stok input = 1 No. Grading**, di semua grading (Halus, Dry A, Moulding, Dry B, Barcoding). Boleh parsial: stok.01 10 kg, diambil 6 kg → G1, diambil 4 kg → G2; sisa tetap saldo No. Stok itu. 10 No. Stok yang dikerjakan semua menghasilkan 10 No. Grading. **Koreksi user:** aturan 1:1 berlaku di grading yang menguraikan: Grading Halus, Dry A, Dry B (dan Barcoding, W16). **Moulding bukan grading 1:1 melainkan pencampuran (Mix)**: No. Stok hasil Dry A masih membawa No. Job-nya; saat Mix No. Job hilang dan semua No. Stok isi partai beridentitas No. Moulding. Lalu Job Order mengerjakan bagian No. Moulding itu; hasilnya dibawa ke Dry B, tempat grading 1 No. Stok = 1 No. Grading terjadi. Hasil Dry B tetap di Dry B (Stand By) sampai dipanggil BSTB baru dan memperoleh No. Job baru. Mengubah bagian 6 dan 8 | User |
| W26 | Di unit Pass Through, **saat Pengerjaan Unit dicatat No. Job berapa dikerjakan oleh karyawan siapa** (`m_employee` baru, `prd_execution_worker`). Itu informasi unit tersebut, **tidak melekat ke No. Job**. Hanya catatan: tanpa gram per karyawan dan tanpa biaya tenaga kerja | User |
| W27 | ~~Pembagian nilai akan memakai proses pembobotan estimasi harga (OD-2), bobot Tabel Tipe sementara~~ **Digantikan W32; OD-2 dicabut** | User |
| W28 | **Checkpoint partai** di BSTB Dry A → Moulding. Dari Grading Halus sampai Dry A, perpindahan dan pengerjaan boleh parsial. Melewati checkpoint, partai harus lengkap semua Job-nya; sesudahnya tetap lengkap sampai Barcoding. Mengubah syarat "seluruh partai" di bagian 8 | User |
| W29 | **Tiap unit punya dua tahap barang: Persiapan dan Stand By.** Semua yang diterima lewat BSTB masuk **Persiapan** (kumpulan barang atau Job yang belum dikerjakan). Setelah dikerjakan, barang atau Job yang selesai masuk **Stand By** sampai diputuskan dikirim dengan BSTB. BSTB Transfer dan BSTB ke Finish Goods hanya mengirim dari Stand By; barang Persiapan berarti "belum dikerjakan". **BSTB Pengeluaran boleh dari Persiapan maupun Stand By**, di unit mana saja | User |
| W30 | **Eksekusi Produksi adalah payung semua pekerjaan di unit**: grading, pass through, Job Order, Assembly dan proses lain. Ia hanya **dokumen yang menyatakan pekerjaan telah dilakukan**, dan di dalamnya terjadi tiga pemicu: **transformasi** (input menjadi output), **biaya** (biaya unit, V1) dan **perpindahan Persiapan ke Stand By**. Satu payung, tetapi dapat punya beberapa versi dan nama menurut jenis proses (Dokumen Grading, Pengerjaan Unit, Grading Mix di Moulding, Job Order, Assembly); Mix adalah salah satu jenis Eksekusi Produksi. Menegaskan `prd_execution` per jenis di bagian 2 | User |
| W31 | **Pembuatan No. Job: 1 pengambilan 1 No. Stok = 1 No. Job**, mirip grading. Contoh: Stand By Grading Halus punya stok.001 100 kg jenis A; diambil 30 kg menjadi Job.001 berisi stok.001, lalu diambil 20 kg menjadi Job.002 berisi stok.001 juga; sisa 50 kg tetap di Stand By. Berlaku di semua BSTB yang menerbitkan No. Job (Grading Halus, Penyebaran, Dry B). Aturan ini hanya untuk saat pembuatan: sesudah Job digrading, ia boleh berisi beberapa No. Stok turunan | User |
| W32 | **Pembagian nilai: hanya dua jenis, BJL dan bukan BJL**, dari grading halus sampai selesai produksi. **BJL tidak pernah bernilai (selalu 0) tetapi menyumbang qty dan gram.** Non-BJL berbagi seluruh nilai menurut gramnya: grading 1 jenis menjadi 4 (3 non-BJL, 1 BJL) dengan gram 30/30/40 membagi 30%/30%/40%, BJL 0. **Utama dan Turunan tidak dipakai.** Jenis mana yang BJL ditentukan di **master Item** (`m_item.is_bjl`, Barang saja), bukan per grading. Rinciannya: flag **terkunci setelah Item dipakai di produksi**; gram BJL **ikut dihitung dalam biaya unit** (gram input × rate), seluruhnya dibagi ke yang non-BJL; **bila semua output sebuah grading BJL**, nilai inputnya dibebankan ke Beban Pemusnahan Produksi (Dr Beban / Cr WIP). Pembagi tetap satu fungsi (`shareByWeight`, bobot 1 untuk non-BJL dan 0 untuk BJL, sisa terbesar). **Menggantikan W18 dan W27, dan menutup OD-1 dan OD-2.** Tabel Tipe (`prd_output_type`) tidak dibangun | User |
| W33 | **Unit dan Workstation adalah master; tidak ada unit di kode** (P225). Unit memuat **jenis pekerjaan yang boleh** dilakukan (satu atau lebih dari enam yang dikenal sistem). **Mode keluar, kebijakan No. Job, checkpoint dan boleh dilewati melekat pada langkah routing**, bukan pada unit, karena line lain boleh memakai unit yang sama dengan cara lain. Routing tanpa line = segmen pra-partai yang berakhir di satu unit Pembentuk Partai; routing line dimulai sesudahnya. Daftar tertutup (jenis pekerjaan, mode keluar, kebijakan Job) tetap di kode karena itu mesin; line, unit, dan urutan langkah baru cukup data. Menggantikan kolom per unit di bagian 5 | User |

---

## 4. Hasil Crosscheck

| # | Temuan | v5 | SOP | Simulasi | Hasil |
| --- | --- | --- | --- | --- | --- |
| 1 | Biaya unit = gram input × rate | Ya | — | Terbukti di 5 unit | Dipakai (bagian 7) |
| 2 | Nilai 1 input → 1 output utuh, gram turun, HPP/gram naik | Ya | — | Dry A 41.865 g → 27.223 g, nilai tetap 303,2 jt | Dipakai |
| 3 | Mix partai menjadi satu No. Moulding | Ya | — | 4 Job → 1 stok UML | Dipakai |
| 4 | Biaya Moulding | Dua tempat | — | Di Grading Moulding | W7 |
| 5 | Pre Cleaning menghasilkan KK/SRB | Pass through | Waste dicatat | Catatan 6.900 + 100 | W6 |
| 6 | No. Job di Moulding s.d. Dry B | Tidak ada | — | Kolom `UML_070426_00001` | Tetap tanpa No. Job. Nomor UML dibaca sebagai **nomor Job Order** |
| 7 | Dokumen pra-partai | Tanpa dokumen | — | Ada BSTB_UGH, BSTB_UPC | W21 |
| 8 | Packing 98 | Assembly kardus | Packing tersier | Tanpa assembly | W8 |
| 9 | Grading Dry A menaikkan biaya | Rate per unit | — | Rate 0, Dry B tanpa rate | Rate boleh 0 (W17) |
| 10 | Tipe output (Utama, Turunan, BJL) | Ada | — | Tidak tampil; BS bernilai dan lanjut ke N-NL-KR | Digantikan W32: hanya BJL dan bukan BJL. BS simulasi diperlakukan sebagai non-BJL |
| 11 | Jenis N-NL (Natural Noodle) lewat rute Reguler | — | Indomie | Ya | Hanya ilustrasi mekanik |
| 12 | Grading Sampling, Home Industry, Bahan Bersih | Tidak ada | Ada | GS ada | W2, W3, bagian 15 |
| 13 | Workstation Packing | WIP Packing | Dipisah WIP Packing dan Packing | — | Ikut v5 |
| 14 | QC pra-partai | Tidak ada | Ada | — | Di luar sistem; QC hanya pada BSTB |
| 15 | Status akuntansi | Issue = masuk produksi | Bahan Baku s.d. Steam, WIP mulai Pre Wash | — | Ikut v5: WIP mulai saat Issue |

---

## 5. Struktur

**Tipe Unit** tertutup (v5 2.6): Pass Through, Grading, Grading Pembentuk Partai, Grading Mix, Job Order, Assembly, Gudang. Unit Moulding memakai **Grading Mix lalu Job Order** dalam satu unit dan satu rate.

| Workstation | Unit | Kode | Tipe | No. Job saat keluar | Keluar lewat |
| --- | --- | --- | --- | --- | --- |
| BB + PPIC | Grading Halus | UGH | Grading | Terbit | BSTB langsung |
| BB + PPIC | Pre Cleaning | UPC | Pass Through | Dibawa | BSTB langsung |
| BB + PPIC | Penyebaran | UPY | Grading Pembentuk Partai | Lama dilepas, baru terbit di BSTB | BSTB Penyebaran + QC |
| Cleaning | Pre Wash | UPW | Pass Through | Dibawa | BSTB + QC |
| Cleaning | Cleaning | UCL | Pass Through | Dibawa | BSTB + QC |
| Moulding | Dry A | UDA | Grading | Dibawa | BSTB + QC |
| Moulding | Moulding | UML | Grading Mix + Job Order | Tidak ada | BSTB + QC |
| Moulding | Dry B | UDB | Grading | Terbit (No. Job Dry B) | BSTB + QC |
| WIP Packing | Wrapping | UWP | Pass Through | Dibawa | BSTB + QC |
| WIP Packing | Barcoding | UBC | Grading (output pcs) | Dibawa | BSTB + QC |
| WIP Packing | Packing 95 | UP5 | Assembly | Berakhir di komposisi | BSTB per kotak |
| WIP Packing | Packing 98 | UP8 | Assembly kardus, atau lewat | — | BSTB ke Finish Goods |

**Kolom "No. Job saat keluar" dan "Keluar lewat" di tabel ini adalah isi langkah routing Reguler (W33), bukan atribut unit.** Unit hanya memuat kode, nama, workstation dan jenis pekerjaan yang boleh.

**Line** adalah master (Reguler dulu), menjadi atribut partai, dan menyimpan akun varians.

**Routing** melekat pada line, berversi, dan dikunci saat partai terbentuk. Segmen pra-partai sama untuk semua line. Unit tujuan BSTB selalu unit berikutnya pada routing; hanya Reproses yang boleh mundur. Perubahan master unit, tipe unit dan routing hanya oleh admin (lewat permission).

**Checkpoint (W28)** adalah tanda pada langkah routing. Sekarang satu: Dry A → Moulding. Sebelumnya (Grading Halus s.d. Dry A) bagian-bagian satu partai boleh berada di unit yang berbeda; di checkpoint seluruh Job partai harus sudah berkumpul di Dry A dan selesai digrading.

---

## 6. Identitas

| Identitas | Aturan |
| --- | --- |
| **No. Stok** | Unik seluruh sistem (W10), 1 jenis, universal di Logistik dan Produksi. No. Stok akar lahir di Receipt Note: 1 lot, 1 supplier. Transformasi melahirkan nomor baru `<induk>-<n>`. Mulai Barcoding 1 No. Stok = 1 pcs dengan gram final |
| **No. Job** | Pengelompok No. Stok yang bergerak. **Saat dibuat, 1 No. Job = 1 pengambilan 1 No. Stok** (W31); sesudah digrading ia boleh berisi beberapa No. Stok turunan. Format `<kode unit>_<ddmmyy>_<NNNNN>`. Dilepas saat Mix; tidak ada selama Moulding, Job Order dan Dry B; terbit lagi di BSTB keluar Dry B. |
| **No. Partai** | Lahir dari BSTB Penyebaran: 1 BSTB = 1 partai = 1 line; format `P_<ddmmyy>_<NNNNN>`. Tidak diasumsikan 1 supplier. Mengunci versi rate dan routing |
| **No. Grading** | Dokumen `NG_<unit>_<ddmmyy>_<NNNNN>`; penghubung stok lama dan baru. **1 No. Stok input = 1 No. Grading** (W25); satu No. Stok yang diambil beberapa kali menghasilkan No. Grading tiap pengambilan dan sisanya tetap saldo. Reproses punya No. Grading sendiri |
| **No. Moulding** | No. Stok hasil Grading Moulding, format `<No. Partai>_<kode barang>` |
| **Job Order** | Perintah mengerjakan bagian dari 1 No. Moulding, nomor `UML_<ddmmyy>_<NNNNN>`, target jenisnya sebuah Item (sheet `job_order_moulding` menjadi Item) |
| **No. Stok Kotak** | Stok baru hasil Packing 95, item = Nama Jual, qty 1, gram = Σ pcs |
| **No. Kardus** | Pengelompok kotak, **bukan stok** (W8) |

**Satu No. Stok boleh ada di beberapa partai**, karena sebelum Moulding bisa masuk sebagian. Karena itu bucket produksi adalah **No. Stok · Unit · Partai · Job**, partai dan job boleh kosong.

**Atribut produksi tiap No. Stok** disimpan di `prd_tracking_info`, bukan di tabel buku stok (§3.1 Claude-ERP): versi rate, gram, dan penanda pcs atau kotak. BJL atau bukan dibaca dari Item (W32), tidak disimpan di sini.

**Dokumen yang tidak terikat unit** (Rencana Produksi, Tagihan Biaya) tetap memakai P15. Pengecualian W11 mencakup: `BSTB_<unit>_…`, `NG_<unit>_…`, `KRJ_<unit>_…`, `ASM_<unit>_…`, dan nomor Job Order.

---

## 7. Valuasi

**Aturan umum.** Nilai disimpan rupiah bulat per bucket; rate `Decimal(18,6)`; pembagian memakai sisa terbesar sehingga total selalu pas; HPP/gram hanya hasil hitung. Simulasi tidak membulatkan, jadi selisih ≤ Rp1 per langkah dianggap benar.

**Pembagian nilai (W32).** Setiap pembagian di V2–V7 dan Reject memakai gram, hanya ke No. Stok yang Itemnya bukan BJL; BJL selalu 0 tetapi gramnya tetap dihitung sebagai qty dan dalam biaya unit. Satu fungsi (`shareByWeight`, bobot 1 untuk non-BJL dan 0 untuk BJL). Pembagian grading terjadi dalam lingkup satu No. Grading (satu No. Stok input, W25). Bila tidak ada penerima (semua output BJL), nilainya masuk Beban Pemusnahan Produksi. Angka skenario A3 tidak berubah, karena simulasi tidak memuat BJL.

| # | Peristiwa | Perhitungan |
| --- | --- | --- |
| V1 | Biaya unit | S = gram input × rate versi yang terkunci; satu kali per gram per lintasan unit |
| V2 | Pass Through | S dibagi ke No. Stok dikerjakan yang bukan BJL menurut gramnya (W32); gram BJL ikut dalam S. Tanpa BJL hasilnya sama dengan simulasi: gram × rate |
| V3 | Grading | Nilai input + S + bahan penolong dibagi ke output non-BJL menurut gramnya, dalam lingkup satu No. Grading (W32). BJL selalu 0; bila semua output BJL, nilainya Dr Beban Pemusnahan Produksi / Cr WIP |
| V4 | Grading Moulding | Sama seperti V3 atas seluruh isi partai di unit |
| V5 | Job Order | Nilai bagian diambil = round(V × q ÷ Q) dari No. Moulding, + bahan penolong, dibagi ke output. **Tanpa rate** (W7) |
| V6 | Assembly kotak | Σ nilai pcs + bahan penolong + biaya unit atas gram pcs |
| V7 | Kardus | Nilai kardus + biaya unit dibagi ke kotak isinya menurut gram; No. Stok Kotak tetap. Kotak tanpa kardus lewat tanpa biaya |
| V8 | Bahan penolong | Masuk ke unit lewat BSTB Issue pada nilai MAC. Terpakai = round(V × q ÷ Q) dari bucketnya. Sisa kembali membawa nilainya |
| V9 | Reproses | V1 lagi di tiap unit yang dilewati ulang, memakai versi partai |

**Penguncian versi rate**

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
| Grading, Job Order, Assembly | Dr WIP output / Cr WIP input, hanya bila akunnya berbeda |
| BSTB Transfer | Tidak ada |
| BSTB ke Finish Goods | Dr Persediaan / Cr WIP |
| BSTB Pengeluaran | Lihat bagian 9 |

---

## 8. Alur Line Reguler

| # | Unit | Masuk | Dokumen | Keluar | Syarat keluar |
| --- | --- | --- | --- | --- | --- |
| 0 | Logistik | Stok Logistik | BSTB Issue | No. Stok di unit tujuan; bahan penolong menjadi saldo unit | Terima oleh unit |
| 1 | Grading Halus | No. Stok akar | 1 No. Grading per No. Stok, boleh parsial (W25) | No. Stok turunan + tipe; sisa tetap saldo | Versi rate dicatat |
| 2 | Pre Cleaning | No. Stok + Job | Pengerjaan Unit, mencatat karyawan per Job (W26) | Sama, gram tetap (W6) | Sudah dieksekusi, ada di Stand By |
| 3 | Penyebaran | No. Stok + Job | 1 No. Grading per No. Stok (W25); lalu BSTB Penyebaran | No. Partai + No. Job baru + line; versi rate dan routing terkunci; boleh sebagian qty | QC PASS, Terima |
| 4 | Pre Wash | Partai | Pengerjaan Unit, mencatat karyawan per Job (W26) | Sama | Sudah dieksekusi (Stand By); BSTB parsial boleh (W28) |
| 5 | Cleaning | Partai | Pengerjaan Unit, mencatat karyawan per Job (W26) | Sama | Sudah dieksekusi (Stand By); BSTB parsial boleh (W28) |
| 6 | Dry A | Partai | 1 No. Grading per No. Stok (W25) | No. Stok turunan, Job tetap; susut terlihat | Parsial boleh. **BSTB ke Moulding = checkpoint:** seluruh Job partai sudah di Dry A dan digrading (W28) |
| 7 | Moulding | Partai | Grading Moulding = pencampuran: No. Job hilang, semua No. Stok isi partai beridentitas No. Moulding (W25); lalu Job Order bertahap | No. Moulding, lalu No. Stok Moulding | Saldo No. Moulding nol |
| 8 | Dry B | Hasil Job Order | 1 No. Grading per No. Stok (W25) | No. Stok turunan; No. Job Dry B terbit di BSTB | Seluruh partai digrading dan di Stand By |
| 9 | Wrapping | Partai | Pengerjaan Unit, mencatat karyawan per Job (W26) | Sama | Seluruh partai dieksekusi dan di Stand By |
| 10 | Barcoding | Partai | 1 No. Grading per No. Stok (W16, W25) | Pcs: 1 No. Stok per keping, gram final | Seluruh partai digrading dan di Stand By |
| 11 | Packing 95 | Pcs, bahan penolong | Assembly mengacu BoM Packing | Kotak + komposisi; pcs sisa tetap saldo | BSTB per kotak |
| 12 | Packing 98 | Kotak | Assembly kardus, atau lewat | Kotak (dengan No. Kardus) | BSTB ke Finish Goods |
| 13 | Finish Goods | Kotak | Terima | Stok Logistik, pool MAC Nama Jual, No. Stok tetap | Produksi selesai |

**Pengerjaan Unit** boleh bertahap, biaya masuk periode tanggal postingnya. Di unit Pass Through, Pengerjaan Unit mencatat No. Job mana dikerjakan karyawan siapa, satu atau lebih (W26); catatan itu milik pengerjaan, bukan atribut No. Job.

**Persiapan dan Stand By (W29).** Di tiap unit, BSTB Terima memasukkan barang ke **Persiapan**. Perpindahan dari Persiapan ke **Stand By** hanya terjadi lewat **Eksekusi Produksi** (W30): Pengerjaan Unit, Grading, Job Order atau Assembly mengambil dari Persiapan, memicu transformasi dan biaya, dan menaruh hasilnya di Stand By. BSTB Transfer dan BSTB ke Finish Goods hanya mengirim dari Stand By; BSTB Pengeluaran boleh dari keduanya. Persiapan di simulasi (saldo No. Moulding sebelum diambil Job Order) hanyalah satu contoh dari tahap ini. "Belum dikerjakan" di aturan BSTB berarti masih di Persiapan.

**BoM Packing:** 1 BoM = 1 Nama Jual: kotak, bahan penolong, jenis dan berat isi. Hanya rencana, tidak pernah menolak; kasus berbeda dibuat BoM baru.

### Siklus BSTB

| Mode | Dipakai | Alur |
| --- | --- | --- |
| Langsung | Pra-partai | Draft → Posting |
| Tanpa QC | BSTB Issue, Packing 95 ke 98 (v5 7.2), BSTB ke Finish Goods | Draft → Ajukan → Terima |
| Dengan QC | Selain itu | Draft → Ajukan → QC **PASS** → Terima; **REJECT** = BSTB batal, barang tetap |

- Barang terkunci sejak Ajukan, dan buku hanya bergerak saat Terima (W20). Batalkan hanya untuk Draft.
- **Sebelum checkpoint (W28)**, yaitu perpindahan dari Grading Halus sampai Dry A, BSTB boleh berisi sebagian isi partai.
- **Mulai checkpoint (Dry A → Moulding) sampai Barcoding**, BSTB wajib berisi seluruh isi partai di unit itu; dicek saat Ajukan dan saat Terima. Bagian partai yang tertinggal di unit sebelumnya menahan checkpoint.
- Pada BSTB yang wajib lengkap, ditolak bila masih ada isi partai di unit itu yang belum dikerjakan, atau sedang reproses (W13).
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

Reject yang tidak punya penyerap dibebankan ke Beban Pemusnahan Produksi (W32). Pcs rusak sesudah Barcoding memakai alasan Reject.

**Reproses** adalah BSTB Transfer jenis Reproses:

1. Boleh sebagian isi partai, ke unit mana pun sebelumnya pada routing.
2. Barang tetap di partainya, No. Stok tetap, sampai digrading ulang; stok hasilnya terhubung ke induk.
3. Barang mengikuti routing sampai kembali ke unit asal, dengan biaya V9.
4. **Sisa partai menunggu di unit itu** (W13), lalu pindah bersama sebagai partai lengkap.

---

## 10. Closing Costing Produksi

Satu periode bulan = satu closing. Checklist P210 tetap, ditambah tidak ada BSTB yang belum Terima. Bersifat final dan mengunci periode (W23).

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

Menu baru untuk PPIC, membaca baris Sales Order berstatus Open yang belum terkirim seluruhnya.

| Kolom | Isi |
| --- | --- |
| Sales Order | Nomor, customer, Tanggal Kirim |
| Nama Jual, Qty | Sisa belum terkirim |
| FG Tersedia | Saldo stok Tersedia, dibagi ke baris dengan Tanggal Kirim terdekat lebih dulu |
| Hasil | **FG cukup:** tidak perlu rencana, lanjut Delivery Order. **FG kurang:** tombol Buat Rencana Produksi |

**Rencana Produksi** (`prd_plan(_line)`, `RP/YYYY/MM/NNNN`): Nama Jual, Qty, Tanggal Mulai, dan baris Sales Order yang ditutupinya. Draft → Terbit → Selesai. Tidak memposting apa pun dan tidak mereservasi stok. BSTB Penyebaran boleh menyebut Rencana sebagai referensi laporan.

---

## 12. Dampak ke Sistem

| Yang ada | Tindakan |
| --- | --- |
| Tagihan Biaya, Pembayaran Biaya Produksi, Jenis Biaya, Account WIP | **Tetap** |
| `inventory.ts`, buku stok, MAC | Tetap; `log_stock_tracking` unik seluruh sistem (W10). Nomor baru tiap penerimaan ditegakkan di Receipt Note dan `db:stock-inject`; `receiveStock` tetap menerima nomor yang sudah ada, karena BSTB ke Finish Goods dan Pengeluaran membawa No. Stok yang sama kembali ke Logistik |
| `production-ledger.ts` | Tetap sebagai buku; kunci bucket jadi No. Stok · Unit · Partai · Job |
| `prd_tracking_link` | Tetap; ditambah komposisi `prd_composition` |
| `period-lock.ts`, checklist closing | Tetap. Guard tahun buku R28 ditulis ulang agar membaca `prd_ledger`, bukan Eksekusi |
| Telusur, Kartu Lot, Saldo Produksi | Tetap, diubah: Partai dan Job, himpunan supplier setelah mix, komposisi kotak |
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
| `prd_execution(_input, _output)`, `production-run.ts`, `PRODUCTION_EXECUTION_*` | Satu jenis ber-Driver menjadi lima jenis dengan rate, flag BJL, bahan penolong, Partai dan Job | Langkah 4–8 |
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

**Tabel baru:** `ref_unit`, `ref_workstation` (arti baru), `prd_execution(_input, _output)`, `prd_transfer(_line)`, `prd_release(_line)`, `prd_cost_close`, `prd_line`, `prd_routing(_step)`, `prd_rate_version(_line)`, `m_item_sale_spec`, `prd_bom_packing(_line)`, `prd_partai`, `prd_job`, `prd_tracking_info`, `prd_cost_entry`, `prd_composition`, `prd_carton(_line)`, `prd_cost_close_line`, `prd_plan(_line)`, `m_employee`, `prd_execution_worker`. Bucket produksi mendapat tahap (Persiapan / Stand By), W29. `m_item` mendapat flag BJL, `is_bjl` (W32); `prd_output_type` tidak dibangun.

**Sumber salvage dari branch `walet`** (ambil per file, tidak di-merge): Partai dan Job (P163), BSTB + QC tanpa transit (P167), pass-through dan mix (P169), Rencana Produksi (P168), laporan (P171). Bucket `walet` tidak mencakup komposisi dan standard cost versi ini.

**Master awal dari simulasi:** kode unit dari sheet `units`, target Job Order dari `job_order_moulding`, Nama Jual dari `nama_jual`, jenis per tahap dari `items_*`, supplier dan customer dari sheet masing-masing. Rate simulasi (UPW 182,8637; UCL 733,3605; UDA 0; UML 190,8726; UWP 27,1341; UBC 41,5452) hanya contoh; rate resmi diisi user.

---

## 13. Tahapan Build

Tiap langkah: satu commit ke `main`, migrasi dan DBML bersamaan, `npm run build`, `lint`, `test` hijau, `db:reconcile` ditambah bila menulis buku, keputusan P2xx dicatat, `Production-Process.md` diperbarui, push, migrasi Neon, lalu **user review di Neon sebelum langkah berikutnya**.

| Langkah | Isi | Selesai bila |
| --- | --- | --- |
| 0 | Catat keputusan di `Claude-ERP.md` (§1.4, §12), pengecualian di `KNOWLEDGE.md`, tandai `Production-Plan.md`, reset data produksi Neon setelah disetujui | Dokumen selaras |
| D | **Selesai (P218).** Satu commit drop (bagian 12, P217), kecuali Workstation: tabel dan kode, permission dan jenis dokumen lewat migrasi, tes `production-run`, `production-move`, `production-close`; pangkas `production-ledger`, `production-report`; hapus 6 dari 12 cek produksi `db:reconcile`; tulis ulang guard R28 | Build, lint, test, `db:reconcile` hijau; menu yang tersisa berjalan |
| 1 | **Selesai (P225).** Istilah di layar; drop `ref_workstation` lama, Unit + Workstation baru dalam satu migrasi; Tipe Unit, Line, Routing versi, flag BJL pada master Item (terkunci setelah dipakai), Standard Cost versi; master Karyawan; tanda checkpoint pada langkah Routing; No. Stok unik | Master bisa dibuat di browser; penerimaan kedua jenis sama mendapat nomor baru |
| 2 | Identitas dan buku: bucket baru, Partai, Job, `prd_tracking_info`, `prd_cost_entry` | Test buku hijau |
| 3 | BSTB Issue + Terima; bahan penolong ke unit | Skenario A1 |
| 4 | Grading Halus (1 No. Grading per No. Stok, parsial), Pre Cleaning dengan karyawan per Job saat pengerjaan, BSTB langsung dari Stand By | Job terbit; V1–V3 benar (BJL 0, non-BJL menurut gram); skenario A11, A13, A14 |
| 5 | Penyebaran, BSTB + QC, pembentukan partai | Skenario A2 |
| 6 | Pre Wash, Cleaning, Dry A, BSTB parsial dan checkpoint Dry A → Moulding | Angka sampai Dry A sama simulasi; skenario A12 |
| 7 | Grading Moulding, Job Order, Dry B, Wrapping | Angka sampai Wrapping sama simulasi |
| 8 | Barcoding pcs, BoM Packing, Packing 95, Packing 98, BSTB ke Finish Goods, Nama Jual | Skenario A3, A4 |
| 9 | BSTB Pengeluaran, Reject, Reproses | Skenario A5, A6 |
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
| A2 | No. Stok 10 kg masuk partai 7 kg | Sisa 3 kg tetap saldo No. Stok sama; QC REJECT membuat BSTB batal dan barang tetap |
| A3 | Angka simulasi: 4 Job, 41.865 g, 264.847.610 | Pre Wash +7.655.587; Cleaning +30.702.136; Dry A tetap dengan gram 27.223; Moulding +5.196.124; Wrapping +738.672; Barcoding +1.130.985; total **310.271.114**, HPP/gram 11.397,39 |
| A4 | Kotak berisi pcs dua partai 1 line | Lolos; komposisi menyebut partai per pcs; dua line ditolak; gram di luar toleransi hanya peringatan |
| A5 | Reject sebagian di Cleaning | Keluar nilai 0; sisa partai naik sebesar nilainya; total nilai partai tetap; tercatat di laporan susut |
| A6 | Reproses dari Wrapping ke Cleaning | Sisa partai tidak bisa pindah; biaya Cleaning dan unit sesudahnya terbebani lagi dengan versi partai |
| A7 | S = 45.423.504; Tagihan Biaya 50.000.000 | Varians 4.576.496: Dr Varians Produksi / Cr Biaya Produksi Dibebankan; WIP dan stok tidak berubah; periode terkunci |
| A8 | Telusur dari satu pcs | Kotak → pcs → Dry B → No. Moulding → seluruh stok Dry A partai → akar → himpunan supplier partai |
| A9 | Sales Order 10 kotak, FG 4 | Sales Planning menampilkan kurang 6; Rencana Produksi terbuat, menunjuk baris Sales Order |
| A10 | Posting Grading Barcoding 5.000 pcs | Selesai dalam batas waktu fungsi Vercel dengan penulisan massal; bila tidak, dibahas sebelum langkah 9 |
| A11 | No. Stok 10 kg di Grading Halus: ambil 6 kg, lalu 4 kg | Dua No. Grading (G1, G2) dari satu No. Stok; sisa 4 kg tetap saldo setelah G1; nomor turunan `<induk>-<n>` berlanjut; 10 No. Stok yang dikerjakan semua menghasilkan 10 No. Grading |
| A12 | Partai dengan 4 Job; 3 Job sudah di Dry A, 1 Job masih di Cleaning | BSTB parsial Cleaning → Dry A lolos; BSTB Dry A → Moulding ditolak sampai keempat Job berada di Dry A dan selesai digrading |
| A13 | Pengerjaan Unit di Pre Wash atas dua No. Job | Tiap Job tercatat dikerjakan karyawan siapa pada pengerjaan itu; No. Job sendiri tidak menyimpannya; tanpa gram dan tanpa biaya tenaga kerja |
| A14 | BSTB Terima di Cleaning, dikerjakan sebagian lewat Eksekusi Produksi | Barang masuk Persiapan; hanya yang dieksekusi pindah ke Stand By (bersama biayanya); BSTB Transfer hanya bisa mengirim dari Stand By |
| A16 | BSTB Pengeluaran atas barang yang masih di Persiapan, dan atas barang di Stand By | Keduanya lolos; barang membawa No. Stok dan partai asal ke Logistik |
| A17 | Stand By Grading Halus: stok.001 100 kg. BSTB mengambil 30 kg, lalu BSTB lain 20 kg | Job.001 berisi 30 kg stok.001, Job.002 berisi 20 kg stok.001; sisa 50 kg tetap di Stand By; dua Job tidak digabung |
| A18 | Grading 1 jenis menjadi 4: 3 non-BJL (30, 30, 40 g) dan 1 BJL | Nilai terbagi 30% / 30% / 40% ke tiga non-BJL; BJL bernilai 0 tetapi gramnya tetap tercatat; sisa pembulatan ke bagian terbesar, total pas |
| A19 | Grading yang seluruh outputnya BJL | Nilai input Dr Beban Pemusnahan Produksi / Cr WIP; tidak ada output bernilai |
| A20 | Mengubah flag BJL pada Item yang sudah dipakai di produksi | Ditolak |
| A15 | Mix lalu Job Order lalu Dry B | Saat Mix No. Job hilang dan semua stok beridentitas No. Moulding; hasil Job Order dibawa ke Dry B, digrading 1 No. Stok = 1 No. Grading, tetap di Dry B sampai BSTB baru memberi No. Job baru |

---

## 15. Ditandai dan Ditunda

**Open discussion**

Tidak ada yang tersisa. OD-1 (lingkup penyerapan BJL dan reject) dan OD-2 (pembobotan estimasi harga) ditutup oleh W32 pada 04/11/2026.

**Scope terpisah (tidak menghalangi build)**

| Topik | Catatan |
| --- | --- |
| Line Mie dan SM | Setelah Reguler final. Catatan SOP: keduanya punya Steam BB setelah Penyebaran; Mie punya Moulding Indomie dan Sortir Kering, Dry A sesudah Moulding, dan tanpa Moulding kedua; SM punya Grading Cabut dan Moulding SMK. User: Mie tetap punya Wrapping dst. Alokasi aktual ke beberapa line (gap v5 no. 2) diputuskan bersamaan |
| Makloon Home Industry | Dibahas terpisah. SOP Reguler: Pre Wash, Cabut, Dry A, Moulding & Dry B, kembali ke WIP Steam |
| Grading Sampling | Sebelum titik mulai produksi. Simulasi: ID Stok lahir di sini dan menentukan dasar PO |
| Rute BB bersih | Sementara satu alur (W3) |
| Purchase Request dari Sales Planning | Setelah komposisi BB per line diketahui |
| No. Kati, QR Caiq, barcode | Identifikasi per keping sebelum masuk kotak |
| UI Grading Barcoding | Import, timbangan, pemindai untuk ribuan pcs (W16) |
| BoM Packing resmi | Struktur siap; isi dari user |

**Status gap v5 bagian 12**

| Gap | Status | Gap | Status |
| --- | --- | --- | --- |
| 1 Telusur himpunan supplier | Dibiarkan (A8) | 11 Susut pass through | Dipahami (W6) |
| 2 Varians per line | Satu line sekarang (bagian 10) | 12 Pcs rusak | Reject (bagian 9) |
| 3 Aturan mulai Packing 95 | W14 | 13 SO ke rencana | W15 |
| 4 BoM resmi | Struktur siap | 14 Routing Mie, SM | Ditunda |
| 5 Tanpa No. Job di Moulding | Tetap; Crosscheck #6 | 15 Tagihan biaya | Yang sudah ada |
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
- **Grading parsial** (W25) memperbanyak No. Grading dan No. Stok turunan; nomor `<induk>-<n>` harus berlanjut lintas pengambilan.
- **Checkpoint** (W28) menahan partai bila satu Job tertinggal di Pre Wash, Cleaning atau Dry A; PPIC perlu melihat bagian partai yang belum sampai.
