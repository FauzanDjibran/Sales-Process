# Estimasi Harga — ringkasan konsep penyebaran biaya

> Sumber: sheet **Estimasi Harga** di `AKUI SIMULATION.xlsx` (diekspor user, 04/11/2026).
> Ringkasan konsep saja — **belum ada keputusan** dan belum ada yang diubah di
> `Produksi Walet (Real).md` atau `Claude-ERP.md`. Ini bahan untuk OD-2 / W-ruling
> "pembobotan berdasarkan estimasi harga" (P220), yang sementara memakai bobot Tabel Tipe.

## 1. Masalah yang dijawab

Satu barang dibeli dengan **satu modal**, lalu dipecah (grading) menjadi beberapa
jenis hasil: Utama, Turunan, dan BJL (barang jadi lain / sisa). Modal itu harus
**dibagi ke setiap jenis hasil** sehingga tiap jenis punya HPP per gram, dan **jumlah
modal seluruh hasil sama persis dengan modal awal**. Dasar pembagiannya bukan berat
semata, tetapi **nilai pasar standar** tiap jenis.

## 2. Alur sheet, langkah demi langkah

| Step | Isi | Contoh di sheet |
| --- | --- | --- |
| 0 | **Harga pasar standar** per jenis (Rp/gram) | Utama 1 = 7.300 · Utama 2 = 5.700 · Turunan 1 = 4.000 · Turunan 2 = 2.000 · Turunan 3 = 1.000 · BJL 1 = 0 |
| 1 | **Terima PO (GRN)**: qty, harga, total | CHONG 100.000 gr, total Rp 400.000.000 (4.000/gr) |
| 2 | **Berat kering**: qty setelah dikeringkan. Total modal **tidak berubah**, harga per gram naik | 95.000 gr → Rp 4.210,53/gr |
| 3 | **Grading Kasar**: pecah berat kering ke jenis hasil, lalu sebarkan modal | lihat §3 |

Susut kering (5.000 gr) tidak punya nilai sendiri; ia hanya membuat modal
tertanggung oleh gram yang tersisa. Total qty hasil grading harus sama dengan
berat kering (95.000 gr).

## 3. Cara hitung (kolom pada tabel Step 3)

Untuk tiap jenis hasil *i*:

| Kolom | Rumus | Arti |
| --- | --- | --- |
| Qty | input hasil grading | gram jenis ini |
| Kontribusi | Qty ÷ Σ Qty | porsi berat |
| Harga Estimasi | harga pasar standar (Step 0) | Rp/gram |
| **Total Estimasi** | Qty × Harga Estimasi | nilai pasar jenis ini |
| Nilai L/R (%) | (Σ Total Estimasi − Modal) ÷ Modal | selisih estimasi vs modal, satu angka untuk semua jenis (−5,11 % di contoh) |
| Nilai dari total keuntungan | Total Estimasi × Nilai L/R | |
| Estimasi setelah L/R | Total Estimasi + kolom di atas | |
| **Prosentase** | Estimasi setelah L/R ÷ Σ-nya | **bobot nilai** jenis ini |
| Selisih L/R (Rp) | Prosentase × Selisih P/L | bagian jenis ini dari selisih total |
| Selisih L/R per gram | Selisih L/R ÷ Qty | |
| **HPP / gram** | Harga Estimasi − Selisih L/R per gram | |
| **Total Modal** | HPP/gram × Qty | **Σ harus = Modal awal** |

Selisih P/L = Σ Total Estimasi − Modal (contoh: 379.542.500 − 400.000.000 = **−20.457.500**,
estimasi lebih kecil dari modal, jadi rugi). Selisih itu dibagi ke jenis menurut Prosentase;
jenis bernilai besar menanggung bagian besar.

## 4. Hasil contoh (modal Rp 400.000.000)

| Jenis | Qty (gr) | Harga estimasi | Total estimasi | Prosentase | HPP/gr | Total modal |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Utama 1 | 23.450 | 7.300 | 171.185.000 | 45,10 % | 7.693,47 | 180.411.943 |
| Utama 2 | 18.275 | 5.700 | 104.167.500 | 27,45 % | 6.007,23 | 109.782.172 |
| Turunan 1 | 14.830 | 4.000 | 59.320.000 | 15,63 % | 4.215,60 | 62.517.373 |
| Turunan 2 | 16.190 | 2.000 | 32.380.000 | 8,53 % | 2.107,80 | 34.125.296 |
| Turunan 3 | 12.490 | 1.000 | 12.490.000 | 3,29 % | 1.053,90 | 13.163.216 |
| BJL 1 | 9.765 | 0 | 0 | 0 % | 0 | 0 |
| **Jumlah** | **95.000** | | **379.542.500** | 100 % | | **400.000.000** |

## 5. Pengamatan (untuk dibahas, bukan keputusan)

1. **Rumus ringkasnya**: karena Nilai L/R sama untuk semua jenis, kolom "setelah L/R" hanya
   mengalikan semua baris dengan faktor yang sama, sehingga Prosentase = Total Estimasi ÷
   Σ Total Estimasi. Hasilnya setara dengan
   **HPP/gram = Harga Estimasi × (Modal ÷ Σ Total Estimasi)** (7.300 × 400 / 379,5425 = 7.693,47 ✓).
   Artinya modal dibagi **sebanding nilai pasar**; jenis yang harganya nol tidak menanggung biaya.
2. **BJL berharga 0 menerima modal 0**: 9.765 gr hasil tanpa nilai, seluruh modal ditanggung
   jenis lain. Ini sama dengan prinsip "output tanpa nilai" (R6 lama / bobot 0), tetapi
   di sheet ini pembobotnya **harga pasar**, bukan Bobot Nilai pada Item.
3. **Laba juga bisa**: bila Σ Total Estimasi > Modal, Selisih P/L positif dan HPP/gram turun di
   bawah harga pasar dengan mekanisme yang sama.
4. **Ini penyebaran modal bahan (Step 1–3)**; biaya konversi lain belum muncul di sheet.
   Baris 108–110 di sheet (Fiscal Year / Periode Ini / Sampai Dengan Periode Ini) hanya
   sisa catatan, tidak terkait perhitungan.
5. Hubungan ke rencana: ini adalah **fungsi pembagian nilai satu tempat** yang dijanjikan
   P220 (OD-2) — masukannya nilai input + daftar (qty, harga pasar standar), keluarannya
   nilai per hasil dengan sisa pembulatan ke baris terbesar; sementara dipakai Tabel Tipe.

## 6. Pertanyaan terbuka sebelum ada yang diubah

- Dari mana **harga pasar standar** diambil di sistem: master per jenis/Tipe, versioned, atau diketik per grading?
- Pembulatan: nilai rupiah utuh dengan sisa ke baris terbesar (selaras P114) atau tetap 6 desimal per gram seperti sheet?
- Apakah berat kering (Step 2) menjadi dokumen/langkah sendiri, atau hanya qty input grading?
- Apakah BJL selalu bernilai 0, atau bisa diberi harga bila nanti dijual?
