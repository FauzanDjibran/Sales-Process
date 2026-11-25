# Rencana Produksi 04: empat gerbang

Langkah simulasi 6 sampai 15.

## 1. Ringkas

| # | Dokumen | Wajib | Yang terisi sendiri | Ditolak bila |
| --: | --- | --- | --- | --- |
| 1 | Stock Issue · Bahan ke Produksi | Perintah, tahap Grading dirilis | Tujuan, line, SO, prioritas, batas | Tanpa Perintah, jenis lain, melebihi sisa, stok kurang |
| 2 | BSTB Penyebaran | Perintah, tahap Proses dirilis | **Line** | Sama, memakai sisa sebar |
| 3 | Job Order | Ikut partai | Jenis target | **Tidak ditolak**; jenis lain diberi peringatan |
| 4 | Kotak | Perintah, tahap Packing dirilis | Nama Jual, isi kotak | Melebihi jumlah Perintah, keping kurang |

Setiap gerbang menampilkan kotak **Barang ini untuk**: item dan jumlah, line, Sales Order, prioritas, batas tahap.

## 2. Coba sendiri

| Coba | Hasil |
| --- | --- |
| Stock Issue baru, langsung *Simpan & Kirim* | *Pilih Perintah Produksi. Bahan tidak boleh keluar tanpa perintah.* |
| Isi 700 g untuk BMK50 | *SM-A diisi 700 g, melebihi sisa PP/2026/11/0001 yaitu 667 g.* |
| Buka pilihan Perintah | Yang belum dirilis pudar, bertanda *belum dirilis* |
| Job Order pilih MLD-B | Peringatan; boleh dilanjutkan dan muncul di luar target |
| Tutup kotak ke-15 | *PP/2026/11/0001 sudah punya 14 kotak, sesuai jumlahnya.* |
| Tutup Sales Order yang dilayani | *Sales Order dilayani … yang masih berjalan.* |

## 3. Urutan pengerjaan

| Unit | Layar | Yang terjadi |
| --- | --- | --- |
| Grading Halus | Workspace › Penerimaan › Terima, lalu klik baris | Jenis dan gram hasil nyata; jenis lain bertanda *hasil lain*; output tidak boleh melebihi input |
| Pre Cleaning | Klik baris | Lolos QC, siap Penyebaran; dihitung sebagai hasil tahap Grading |
| Penyebaran | *Kirim* | Pilih Perintah; barang Perintah lain boleh dan ditandai |
| Pre Wash | Penerimaan › Terima | **Partai lahir**, mengikuti line Perintah |
| Pre Wash sampai Barcoding | Klik baris | Gram hasil diketik; Moulding memilih jenis Job Order |
| Packing 95 | *Buat Kotak* | Keping disarankan, milik Perintah sendiri dulu |
| Kotak | *Kirim ke Finish Goods* | BSTB ke Finish Goods per Perintah |
| Gudang FG | Stock Receipt › Terima | Capaian bertambah; penuh menjadi **Selesai** |

Workspace mengurutkan barang menurut prioritas. Mengerjakan yang bukan teratas boleh, dengan pemberitahuan.

## 4. Memakai barang Perintah lain

PP-A menggrading HLS-A, lalu PP-B menyebarnya:

1. Baris bertanda *milik Perintah lain, boleh dipakai*.
2. Sesudah dikirim, barang itu terhitung untuk PP-B.
3. Tab Kebutuhan PP-A langsung berkurang. Bila menjadi kurang, PPIC menambah gram atau menutup kurang.

## 5. Selesai

| Diterima FG | Perintah | Sales Order |
| --- | --- | --- |
| Sebagian | Tetap Dirilis | Bagian itu *Siap Kirim* |
| Seluruhnya | **Selesai**; barang sisa menjadi stok siap pakai | *Siap Kirim* untuk seluruh bagian |

FG **belum dikunci** untuk Sales Order (OD-4, langkah tersendiri). Simulasi hanya mencatat jatahnya.
