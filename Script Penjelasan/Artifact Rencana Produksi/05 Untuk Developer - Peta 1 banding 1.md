# Rencana Produksi 05: peta 1:1 ke aplikasi

## 1. Isi berkas

`rencana-produksi.html` satu halaman: `globals.css` utuh, blok `ADDITIONS START/END` (kelas `.pln-*`, pindah ke blok additions),
ikon aplikasi, **mesin aturan** di antara `// ENGINE START` dan `// ENGINE END`, komponen, layar. React 18 dan htm hanya untuk
artifact; markup dan nama komponen sama dengan aplikasi, sehingga layar dipindah ke TSX tanpa digambar ulang.

## 2. Layar

| Layar artifact | Di aplikasi | Dibangun dari |
| --- | --- | --- |
| Rencana register | `/costing/plan` | `DocumentRegister` + kotak antrean |
| Rencana form dan halaman | `/costing/plan/new`, `/[id]` | `DocumentHeader`, `FormTabs`, dialog Pilih Sales Order, dialog Bahan dan Rendemen |
| Perintah | `/costing/order`, dibaca juga di `/production/order` | `DocumentRegister`, tab Tahap, Kebutuhan, Untuk, Jadwal, Dokumen |
| Planning | `/costing/planning`, `/production/planning` (baca) | `table.grid.pln`, dialog sel |
| Rencana vs Realisasi | `/costing/report/plan-vs-actual` | `ReportView`, blok `.cbh` |
| Kotak *Barang ini untuk* | komponen `GateBox`, dipakai empat dokumen | `.pln-gate` |
| Stock Issue, BSTB Penyebaran, Kotak | form yang ada + field Perintah Produksi | Combobox Perintah, `GateBox` |
| Workspace | `unit-board.tsx` + kolom Prioritas dan Perintah | — |

**Bukan untuk dibangun:** bilah simulasi, tombol *(diringkas)*, dialog *Pengerjaan* satu klik, *Isi contoh hasil meleset*.
Di Penyebaran, aplikasi tetap menggrading dulu (No. Grading UPY) sebelum mengirim; artifact meringkasnya.

## 3. Aturan di mesin dan calon rumahnya

| Fungsi | Isi | Modul |
| --- | --- | --- |
| `queueOf`, `planLines` | Antrean, gabung per item, FG, prioritas | `production-plan.ts` |
| `materials` | Hitungan mundur | `production-plan-shape.ts` (murni, client-safe) |
| `approvePlan` | Menerbitkan Perintah dan Purchase Request, satu transaksi | `production-plan.ts` |
| `orderStatus`, `projection`, `addGrams`, `closeShort` | Perintah | `production-order.ts` |
| `windows`, `workDays` | Kalender dan batas mundur | `work-calendar.ts` (murni) |
| `setCell`, `autoSchedule`, `publish`, `realOf` | Planning | `production-schedule.ts` |
| `gateIssue`, `gateSpread`, `gateBox`, `jobOrderWarning` | Gerbang | dipanggil di dalam posting masing-masing |

Di aplikasi setiap gerbang diperiksa **ulang di transaksi posting** dengan baris Perintah dikunci, karena dua Issue bisa berbarengan.

## 4. Tabel

`Perintah-Produksi-Plan.md` §6. Tambahan yang terlihat dari simulasi:

| Kebutuhan | Saran |
| --- | --- |
| Campuran dan rendemen per Perintah | kolom rendemen di `prd_order`, persen di `prd_order_stage_item` |
| Stok siap pakai yang diperhitungkan saat terbit | `prd_order_use` (titik, item, gram, sisa) |
| Riwayat Tambah Gram | `prd_order_addition` |
| Plan dasar dan plan kini | dua kolom di `prd_order_schedule` |
| Minggu yang diterbitkan | `prd_schedule_release` (minggu, oleh, kapan) |
| Capaian per baris Sales Order | `received_qty` di `prd_order_demand` |

Realisasi **tidak** disimpan: dihitung dari dokumen produksi lewat Partai, Job dan No. Stok yang menyebut Perintah.

## 5. Uji yang sudah dijalankan pada mesin

| Uji | Hasil |
| --- | --- |
| Issue tanpa Perintah, melebihi sisa antrean | Ditolak |
| SO 10 + 8, FG 4 | Perintah 14; FG menjadi jatah SO terawal |
| BSD50 3, FG 3 | Tanpa Perintah, *Siap Kirim* |
| Bahan Mie kurang | Menunggu Bahan, lalu Siap setelah diterima |
| Grading meleset sampai Perintah selesai dengan Tambah Gram | 14 dari 14 |
| Tiga Perintah selesai, Rencana Selesai, empat SO terkirim, FG tidak minus | Lolos |
| Plan digeser setelah terbit | Plan dasar tetap |
| Hari libur, melebihi target | Ditolak |
| Tutup Kurang | 6 kotak kembali ke antrean |

Di browser: 16 langkah dijalankan lewat semua layar tanpa error, gerbang 1 dan kotak ke-15 dicoba lewat tombol, lebar 1366 px dan 375 px.

## 6. Batas simulasi yang perlu diingat

- Kotak terkecil butuh keping utuh 5 g, jadi gram sangat kecil habis oleh pembulatan keping. Tambahan gram sebaiknya dilebihkan.
- Perkiraan memakai rendemen rata-rata, bukan janji.
- BJL hilang dari stok simulasi; di aplikasi tetap ber-No. Stok (W51).
- Tanpa izin per user, kunci data, nilai, atau jurnal.
