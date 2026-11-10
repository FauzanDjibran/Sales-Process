# Tahap 5.0: Artifact vs Aplikasi, Layar Produksi

> Disusun 11/11/2026 untuk tahap 5.0 `production_app_plan.md`. **Disetujui user 11/11/2026, D1–D6 menurut saran (P261).** Belum ada yang dibangun.
> Sumber: artifact Workspace Unit (TR9at…, versi `1794319641-bf3b`) dan aplikasi di `main` (`2734869`).
> Setelah disetujui, daftar ini menjadi acuan 5.1–5.5: yang dibangun persis seperti tertulis.

Cara membaca: **Artifact** = yang akan dibangun, **Aplikasi** = keadaan sekarang. Bagian C berisi bagian artifact yang tidak diikuti karena melanggar design convention atau hanya alat simulasi. Bagian D berisi keputusan yang perlu Anda jawab.

## A. Perbedaan per layar

### A1. Workspace Unit: daftar kartu (`/production/workspace`)

| # | Artifact | Aplikasi | Langkah |
| --- | --- | --- | --- |
| A1.1 | Satu card di atas kartu: tab Line (*Semua Line*, Reguler, …) dengan hitungan, pencarian Unit, keterangan, jumlah Unit | Tidak ada tab Line maupun pencarian | 5.2 |
| A1.2 | Kelompok pertama *Sebelum Partai · BB + PPIC*, lalu per Workstation | Per Workstation saja | 5.2 |
| A1.3 | Kartu memuat badge tipe, **badge Line** (atau *Sebelum Partai*), dan QC | Badge tipe dan QC | 5.2 |
| A1.4 | Hitungan kartu sama: Masuk, Persiapan, QC, Stand By, dengan gram | Sama | — |
| A1.5 | Subjudul: *Unit yang ditugaskan ke Anda* untuk Admin Unit | Satu kalimat untuk semua | 5.2 |

### A2. Halaman Unit (`/production/workspace/[unit]`)

| # | Artifact | Aplikasi | Langkah |
| --- | --- | --- | --- |
| A2.1 | Judul: nama Unit + badge tipe. Subjudul: Workstation · Line · QC · checkpoint · Lepas No. Job | Judul + subjudul tentang scan | 5.2 |
| A2.2 | **Tanpa kartu KPI** (W110) | Empat kartu KPI (Kiriman Masuk, Persiapan, QC Check, Stand By) | 5.2, dihapus |
| A2.3 | Tab: Masuk, Persiapan, QC Check (bila Unit ber-QC), Stand By, **Dalam Perjalanan**. Hitungan = jumlah Job | Empat tab, tanpa Dalam Perjalanan; hitungan = baris | 5.2 |
| A2.4 | Aksi di `.ph-act` sesuai tab dan pilihan, dengan `.selcount` (*n dipilih · gram*). **Persiapan**: BSTB Pengeluaran, Reproses (hanya baris Balik QC), Catat Pengerjaan (Pass Through), Buat Kotak (Packing 95). **QC Check**: Periksa. **Stand By**: BSTB Pengeluaran, *Buat Dokumen Push / Buat BSTB ke \<Unit\>* | Hanya Catat Pengerjaan | 5.2 (tombol), 5.5 (dokumennya) |
| A2.5 | Toolbar per tab: cari (No. Job, No. Stok, CAIQ, Item), filter Line (bila Unit dipakai > 1 line), filter Partai, *Pilih semua di halaman*, keterangan, hitungan *n Job · n No. Stok tanpa Job · gram* | Bar scan kuning + cari + hitungan baris | 5.2 (lihat D1) |
| A2.6 | **Dua tabel tetap** (W111): **Job** (No. Job, Partai, No. Stok *n · lihat isi* → modal, Gram, Nilai, Tujuan di Stand By, Sejak, Keterangan) dan **No. Stok tanpa Job** (No. Stok, Item + BJL + CAIQ, Partai, Gram, Nilai, Tujuan, Sejak, Keterangan). Pager masing-masing | Satu tabel per No. Stok | 5.1 (indeks, `entered_at`) + 5.2 |
| A2.7 | Keterangan: *Balik QC*, *Terkunci* + nomor BSTB, *Ada di Draft*, Job Order, pcs, catatan | Sebagian | 5.2 |
| A2.8 | Tab **Masuk**: tabel BSTB menunggu (Nomor, Jenis, Dari, Partai atau *Lahir saat Terima*, Tanggal, Baris, Gram) dengan tombol **Terima** per baris | Tabel BSTB Issue; Terima di halaman BSTB | 5.2 |
| A2.9 | Tab **Dalam Perjalanan**: BSTB yang diajukan Unit ini dan belum diterima (tampilan saja, W20) | Tidak ada | 5.2 (isi nyata setelah 5.5) |
| A2.10 | Unit **Grading**: klik baris Job langsung membuka halaman grading Job itu; centang hanya untuk Pengeluaran atau Reproses | Scan atau klik baris membuka grading **satu No. Stok** | 5.3 |
| A2.11 | Pilihan dibatasi satu partai sebelum checkpoint Barcoding; sesudahnya boleh lintas partai | Satu partai untuk Pengerjaan | 5.2 |

### A3. Grading (No. Grading per Job)

| # | Artifact | Aplikasi | Langkah |
| --- | --- | --- | --- |
| A3.1 | **Satu halaman = satu Job, diambil utuh** (W97, W107); nomornya No. Grading | Satu No. Stok, boleh sebagian (P241) | 5.1 (`prd_grading.job_id`, `prd_grading_input`) + 5.3 |
| A3.2 | Card atas: Unit, Tanggal, No. Job, Partai, Catatan | Unit dipilih, No. Stok dipilih, jumlah diambil | 5.3 |
| A3.3 | Card **Hasil Grading** bergaya timbangan: Jenis tetap terpilih, Gram, Enter = Tambah; daftar output terbaru di atas; ringkasan per jenis; kotak Diambil (utuh) · Output · Susut | Tabel output biasa | 5.3 |
| A3.4 | Tabel No. Stok input Job (No. Stok, Item, Partai, Gram), catatan Balik QC, catatan hasil Job sebelumnya | Satu input | 5.3 |
| A3.5 | Output menjadi No. Stok `<asal>-n` dari No. Stok asal Job | `<induk>-n` dari No. Stok yang di-grading | 5.3 |
| A3.6 | Card **Bahan Penolong**: *Tambah Bahan Penolong* lalu isi qty, yang tidak dipakai tidak tampil | Ada; dicek ulang bentuknya | 5.3 |
| A3.7 | Card **Nilai**: nilai input, biaya unit (gram × rate), bahan penolong, ke Beban Pemusnahan, dibagi ke output | Ada di form; dicek ulang | 5.3 |

### A4. QC Check

| # | Artifact | Aplikasi | Langkah |
| --- | --- | --- | --- |
| A4.1 | Dibuka dari tab QC Check dengan **Periksa** untuk baris tercentang | Dibuka per baris dari scan atau klik | 5.3 |
| A4.2 | Satu baris = satu Job (No. Stok di bawahnya); keputusan **Lulus / Balik** per baris, Alasan Balik opsional, *Lulus Semua*, *Tambah Baris* (modal), Posting aktif setelah semua diputuskan | Baris per No. Stok | 5.3 |

### A5. Pengerjaan Unit

| # | Artifact | Aplikasi | Langkah |
| --- | --- | --- | --- |
| A5.1 | Baris per Job, satu karyawan per Job, *Samakan dengan Baris Pertama*, *Tambah No. Job* (modal), Catatan Hasil | Hampir sama (P241); ditambah *Samakan* dan *Tambah No. Job* | 5.3 |
| A5.2 | Ringkasan Gram dan card Nilai terpisah | Dicek ulang | 5.3 |

### A6. Dokumen perpindahan dan keluar (dokumen baru)

| # | Artifact | Langkah |
| --- | --- | --- |
| A6.1 | **Dokumen Push / BSTB Transfer / BSTB Penyebaran** lewat form: Dari, Ke (+ *Push, tanpa Terima* atau *BSTB, menunggu Terima*), Tanggal, Partai; Penyebaran memilih **Line Partai** (partai dan No. Job lahir saat Terima). Tabel Barang Dikirim; baris tanpa Job boleh diambil sebagian (kecuali pcs); *Tambah Baris*. Push = Posting, BSTB = Ajukan | 5.5 |
| A6.2 | **Checkpoint Barcoding**: Push dari UBC wajib seluruh isi partai | 5.5 |
| A6.3 | **Dokumen Reproses**: dari baris Balik QC ke Unit lebih awal pada routing partai, alasan opsional | 5.5 (lihat D3) |
| A6.4 | **BSTB Pengeluaran**: dari Persiapan atau Stand By ke Logistik, terkunci sampai Logistik Terima | Tahap 6 (dokumen batas ERP), tombolnya di 5.2 dinonaktifkan sampai itu |
| A6.5 | **Kotak Packing 95** (Buat Kotak dengan rekomendasi, Masukkan / Masukkan Semua, Pilih Manual, CAIQ) | Bersama Packing, setelah rencana Packing (di luar 5.0–5.5) |

### A7. Register Dokumen (menu Dokumen)

| # | Artifact | Aplikasi | Langkah |
| --- | --- | --- | --- |
| A7.1 | Tab status (Draft, Diajukan, Posted, Diterima, Semua) dengan hitungan | Filter status lain | 5.3 |
| A7.2 | Kolom: Nomor, Status, Tanggal, Unit (*Dari → Ke* untuk BSTB), Partai, Baris, Gram | Nomor, tanggal, status, Unit, baris, nilai | 5.3 |
| A7.3 | Subjudul: *Dokumen dari Unit yang ditugaskan ke Anda. Dokumen dibuat dari Workspace Unit.* | Subjudul per dokumen | 5.3 |
| A7.4 | Halaman dokumen: card info (Dokumen, Unit, Tanggal, Partai, Catatan), card per No. Grading atau Baris, Bahan Penolong, Journal | Form mode lihat | 5.3 |

## B. Database yang dibutuhkan

Sudah ada di plan 5.1 dan 5.5; perbandingan ini tidak menambah apa pun:
- `prd_balance`: indeks parsial `(unit_id, stage, job_id) WHERE qty_balance > 0`, kolom `entered_at` (kolom **Sejak**).
- `prd_job.tracking_id` dan `partai_id` boleh kosong.
- `prd_grading.job_id` + `prd_grading_input`.
- No. Job pertama lahir di BSTB Issue ke Grading Halus.
- Tabel dokumen baru lahir bersama dokumennya di 5.5.

## C. Yang tidak diikuti dari artifact

| # | Di artifact | Alasan | Yang dibangun |
| --- | --- | --- | --- |
| C1 | Panduan simulasi, menu *Masuk sebagai*, *Coba buka Unit lain*, *Uji layar tanpa nilai*, *Reset simulasi*, tombol *Simulasi: pilah semua / isi CAIQ kosong* | Alat simulasi | Tidak ada |
| C2 | Kotak peringatan *Ditandai O-13* di halaman Moulding | Soal terbuka, bukan informasi untuk operator | Tidak ada; O-13 tetap di PWR |
| C3 | Breadcrumb dokumen *Produksi / Workspace Unit / UGH / Grading Baru* | Convention §3.6: *MODUL / ENTITAS / CURRENT*, entitas menaut ke register | *Dokumen / No. Grading / Baru* (lihat D4) |
| C4 | Tombol *Batal* biasa di header form | Convention: `CancelButton`, menanyakan sebelum membuang perubahan | `CancelButton`, kembali ke tab Unit asalnya |
| C5 | BSTB Pengeluaran dan Reproses dibuat dari dialog konfirmasi | P246: Push dan BSTB lewat form; dokumen berbaris tidak dibuat dari dialog | Form, seperti Push (lihat D3) |
| C6 | Pemilahan ke baki A–E dan sisa Isi Wadah / CAIQ sebagai Unit | Sudah dicabut (W115, P248) | Tidak ada |
| C7 | Lebar kolom dan jarak lewat `style` inline | Convention melarang warna inline; lebar memakai pola tabel yang ada | Pola `minWidth` tabel yang ada (P149) |
| C8 | KPI *Rincian* per partai (fungsi masih ada di artifact) | KPI sudah dicabut (W110) | Tidak ada |

## D. Keputusan yang dibutuhkan

| # | Pertanyaan | Saran |
| --- | --- | --- |
| D1 | **Scan.** Artifact hanya punya kotak cari; aplikasi punya bar scan kuning yang langsung membuka form (P242). | Satu kotak cari saja seperti artifact; Enter pada No. Job atau No. Stok yang persis cocok membuka pekerjaannya, jadi scanner tetap bisa dipakai |
| D2 | **Posting dari form baru.** Artifact: *Simpan Draft* dan *Posting* langsung dari form. Aplikasi: simpan dulu, Posting di halaman dokumen. | Ikuti artifact: *Posting* menyimpan Draft lalu membuka konfirmasi berisi journal (dry run, P103), dalam satu klik |
| D3 | **BSTB Pengeluaran dan Reproses:** dialog (artifact) atau form (C5)? | Form |
| D4 | **Breadcrumb dokumen** dari Workspace (C3). | Convention: *Dokumen / No. Grading / NG_…*; *Batal* dan selesai Posting kembali ke tab Unit |
| D5 | **Tab Line** di daftar Unit saat baru ada line Reguler. | Bangun sekarang; tampil *Semua Line · Reguler*, line baru muncul sendiri |
| D6 | **Nilai** di tabel Workspace dan grading. | Tetap tampil di kolom dan card sendiri (keputusan 07/11/2026) |
