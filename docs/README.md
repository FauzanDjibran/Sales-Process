# Dokumen Project

Pedoman utama: [Claude-ERP.md](Claude-ERP.md). Semua keputusan ada di §12.

Dokumen baru ditaruh di folder areanya lalu ditambahkan ke daftar ini. Nama file tidak diubah, karena kode dan keputusan menyebut dokumen dengan nama filenya.

Dua draf yang belum di-commit juga sudah dipindah dan belum didaftar: `penjualan/Sales-Overview-Plan.md` dan `pembelian/Purchase-Return-Plan.md`.

## Panduan

| Dokumen | Isi |
| --- | --- |
| [git_command.md](panduan/git_command.md) | Referensi command |
| [Seeder.md](panduan/Seeder.md) | Semua seeder dan command-nya |
| [Seed-Walet-Plan.md](panduan/Seed-Walet-Plan.md) | Rencana seed perusahaan walet |

## Umum

| Dokumen | Isi |
| --- | --- |
| [IMPLEMENTATION-PLAN.md](umum/IMPLEMENTATION-PLAN.md) | Rencana implementasi per fase |
| [UI-UX-Plan.md](umum/UI-UX-Plan.md) | Standarisasi UI/UX |
| [UI-UX-Evaluasi-ERP.md](umum/UI-UX-Evaluasi-ERP.md) | Temuan evaluasi UI/UX |
| [Database-Viewer-Plan.md](umum/Database-Viewer-Plan.md) | Aplikasi Database |
| [Value-Naming-Plan.md](umum/Value-Naming-Plan.md) | Penyeragaman nama kolom nilai |

## Penjualan

| Dokumen | Isi |
| --- | --- |
| [Sales-Process-Concept.md](penjualan/Sales-Process-Concept.md) | Customer Order sampai Piutang |
| [Sales-Return-Plan.md](penjualan/Sales-Return-Plan.md) | Retur, Credit Note dan Penerapan Kredit |
| [Perizinan-Concept.md](penjualan/Perizinan-Concept.md) | Pengajuan sampai Invoice Perizinan |

## Pembelian

| Dokumen | Isi |
| --- | --- |
| [Purchasing-Concept.md](pembelian/Purchasing-Concept.md) | Purchase Request sampai Hutang |
| [Purchase-UOM-Plan.md](pembelian/Purchase-UOM-Plan.md) | Satuan alternatif dan timbangan |

## Persediaan

| Dokumen | Isi |
| --- | --- |
| [Goods-Movement-Plan.md](persediaan/Goods-Movement-Plan.md) | Stock Issue, Stock Receipt, Stock Adjustment |
| [Stock-Issue-Receipt-Plan.md](persediaan/Stock-Issue-Receipt-Plan.md) | Stock Issue dan Stock Receipt bertujuan banyak, Buat Stock Receipt (disetujui, P339) |
| [Stock-Transfer-Plan.md](persediaan/Stock-Transfer-Plan.md) | Transfer antar gudang |
| [Warehouse-Location-Plan.md](persediaan/Warehouse-Location-Plan.md) | Lokasi gudang |
| [Stock-Reports-Plan.md](persediaan/Stock-Reports-Plan.md) | Kartu Stok dan Saldo Stok |
| [Stock-Report-UI-Plan.md](persediaan/Stock-Report-UI-Plan.md) | Tampilan laporan stok |
| [Stock-Position-Report-Plan.md](persediaan/Stock-Position-Report-Plan.md) | Laporan stok gudang dan produksi dua tingkat |

## Keuangan

| Dokumen | Isi |
| --- | --- |
| [Cash-Bank-Transfer-Plan.md](keuangan/Cash-Bank-Transfer-Plan.md) | Transfer Kas & Bank |
| [Multi-Currency-Plan.md](keuangan/Multi-Currency-Plan.md) | Dokumen mata uang asing |
| [One-Doc-One-Item-Plan.md](keuangan/One-Doc-One-Item-Plan.md) | Satu dokumen satu item AR/AP |

## Produksi

**Dokumen utama:** [Produksi Walet (Real).md](<produksi/Produksi Walet (Real).md>). Setiap keputusan produksi diperbarui di sana dan nilainya di atas dokumen produksi lain.

| Dokumen | Isi |
| --- | --- |
| [walet sop.md](<produksi/walet sop.md>) | SOP lapangan produksi walet |
| [estimasi harga.md](<produksi/estimasi harga.md>) | Konsep penyebaran biaya |
| [production_app_plan.md](produksi/production_app_plan.md) | Dua aplikasi, satu login |
| [plan-implementasi-produksi.md](produksi/plan-implementasi-produksi.md) | Menu produksi sampai Barcoding |
| [Production-Unit-Workspace-Plan.md](produksi/Production-Unit-Workspace-Plan.md) | Workspace Unit dan beban data |
| [Workspace-Unit-Diff.md](produksi/Workspace-Unit-Diff.md) | Perbedaan artifact dan aplikasi |
| [Workspace-Unit-Plan-r11.md](produksi/Workspace-Unit-Plan-r11.md) | Langkah Workspace putaran 7–11 |
| [Simulasi-Gudang-Produksi-Plan.md](produksi/Simulasi-Gudang-Produksi-Plan.md) | Alur PO, Gudang, Produksi, Gudang |
| [Perintah-Produksi-Concept.md](produksi/Perintah-Produksi-Concept.md) | Usulan konsep Perintah Produksi |
| [Perintah-Produksi-Plan.md](produksi/Perintah-Produksi-Plan.md) | Rencana, Perintah dan Planning Produksi |
| [Simulasi-Rencana-Produksi-Plan.md](produksi/Simulasi-Rencana-Produksi-Plan.md) | Simulasi Rencana Produksi |
| [Production-Report-Plan.md](produksi/Production-Report-Plan.md) | Laporan stok produksi |
| [Production-Process.md](produksi/Production-Process.md) | Proses produksi |
| [Production-Plan.md](produksi/Production-Plan.md) | Rencana restart produksi (sebagian sudah diganti) |
| [Production-Baseline-Analysis.md](produksi/Production-Baseline-Analysis.md) | Analisa awal produksi |

## Di luar folder ini

| Lokasi | Isi |
| --- | --- |
| [`../knowledge/`](../knowledge/) | Salinan konsep yang diikuti, termasuk [tax_concept.md](../knowledge/tax_concept.md) |
| [`../Script Penjelasan/`](<../Script Penjelasan/>) | Script penjelasan perhitungan dan alur |
| [`../DBML/`](../DBML/) | Skema database |
| [`../Initialization/`](../Initialization/) | Bahan awal, hanya dibaca |
| `../KNOWLEDGE.md`, `../README.md` | Tetap di root |
