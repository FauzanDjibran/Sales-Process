# Rencana Produksi 03: Planning dan Realisasi

ERP › Produksi › Perencanaan › **Planning Produksi**, bentuknya seperti form harian PPIC. Produksi hanya membaca.
Langkah simulasi 5 dan 16.

## 1. Membaca papan

| Bagian | Arti |
| --- | --- |
| Tab | Workstation. Angka di tab = baris Perintah berjalan yang belum selesai dijadwalkan |
| Baris | Satu Perintah dan satu jenis, urut prioritas, dengan batas tanggalnya |
| Sel atas | Plan hari itu |
| Sel bawah | Realisasi dan pencapaian; merah bila di luar 90–110 % |
| *terbit n* | Plan dasar berbeda dari plan sekarang |
| Plan berwarna kuning tua | Di luar batas Perintah |
| Abu-abu | Libur |
| Dijadwalkan | Jumlah terjadwal dari target; *belum n* bila kurang |

*Per Item* menjumlah Perintah berjenis sama untuk dilihat saja. Mengubah jadwal hanya di *Per Perintah*, karena **tiap sel milik satu Perintah**.

## 2. Mengisi

| Cara | Hasil |
| --- | --- |
| **Bagi Otomatis** | Sisa yang belum dijadwalkan dibagi rata ke paling banyak 5 hari kerja dalam batas tahap |
| Klik sel | Plan, Analisa, Solusi; menampilkan realisasi dan plan dasar |
| **Terbitkan Minggu** | Plan dasar seluruh workstation minggu itu disimpan |

Ditolak: hari libur, dan jumlah melebihi target Perintah. Sesudah terbit plan masih boleh digeser; pergeseran tercatat di
Riwayat Perintah dan plan dasar tidak berubah.

## 3. Realisasi dibaca, tidak diketik

| Workstation | Dari |
| --- | --- |
| Grading Halus | Gram input No. Grading |
| Penyebaran | Gram BSTB Penyebaran yang diterima |
| Cleaning | Gram Kerja selesai |
| Moulding | Gram Job Order |
| Packing | Kotak ditutup |

Contoh: Issue dikerjakan 24/11 sementara plan 27/11. Papan menunjukkan realisasi di 24/11 tanpa plan dan plan 27/11 yang 0 %,
jadi pengerjaan yang mendahului jadwal terlihat.

## 4. Batas tanggal

Hari kerja mundur dari Tanggal Kirim. Contoh kirim 12/01/2027, libur Minggu, 25/12 dan 01/01:

| Tahap | Dari | Sampai |
| --- | --- | --- |
| Beli bahan | 20/11/2026 | — |
| Grading (D−37 → D−31) | 27/11/2026 | 04/12/2026 |
| Proses (D−31 → D−16) | 04/12/2026 | 22/12/2026 |
| Packing (D−16 → D−12) | 22/12/2026 | 28/12/2026 |

Sesudah FG 12 hari kerja untuk back stiker, PSI dan karantina (SOP.PPIC.01.01). Lewat batas menjadi *Terlambat*, tidak ditolak.

## 5. Rencana vs Realisasi

Per Perintah: target, dijadwalkan, realisasi, selisih dan pencapaian tiap workstation. Jenis di luar target (misalnya Job Order
MLD-B) tampil sebagai baris *di luar target*.
