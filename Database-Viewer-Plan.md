# Aplikasi Database: rancangan dan uji kelayakan

> **Status: dibangun 23/11/2026 (P313) sesuai mockup putaran 3 (§11).** §4 dan §9–§10 adalah riwayat. Kode: `src/app/(database)`, `src/components/database`, `src/lib/erp/db-{schema,diagram,map}.ts`, `scripts/db-map.ts`.
> Pintu ketiga di *Pilih aplikasi* untuk melihat struktur database yang sedang
> dipakai, relasinya, dan tabel yang dipakai tiap menu. Hanya melihat.

## 1. Kesimpulan

**Layak.** Struktur dan relasi tinggal dibaca dari PostgreSQL. Bagian yang
paling diragukan, yaitu *menu ini memakai tabel apa*, sudah dicoba dan bisa
dibuat **otomatis dari kode**, tidak perlu diketik. Yang belum terbukti hanya
kerapian tata letak otomatis; itu diuji lewat mockup sebelum coding (langkah 0).

## 2. Hasil uji

Diukur pada schema dan database lokal, 23/11/2026, dengan skrip sekali pakai.

| Yang diuji | Hasil | Artinya |
| --- | --- | --- |
| Ukuran database | 153 tabel (+ `_prisma_migrations`), 2.053 kolom, 308 foreign key, 524 index, 37 CHECK | Seluruh metadata kolom ±214 KB JSON: cukup dikirim sekali |
| Baca struktur langsung dari PostgreSQL | Lengkap: tabel, kolom, FK, CHECK, index | Yang tampil adalah database sungguhan, lokal maupun Neon |
| Keterangan tabel dan kolom | 0 di PostgreSQL; di `DBML/erp.dbml.md` 112 dari 153 tabel dan 486 kolom | Keterangan harus diambil dari DBML |
| Kecocokan DBML dengan schema | Tidak ada tabel atau kolom yang kurang | Aman dipakai; tetapi baris *As of migration* di kepalanya sudah usang |
| Pemilik tabel (Bersama / ERP / Produksi) | Sudah ada di DBML dan dijaga `tests/module-boundaries.test.ts` | Grup aplikasi tersedia tanpa kerja baru |
| Menu di `nav.ts` | 89 menu; 57 key-nya sama dengan nama tabel utama | Pohon menu tersedia tanpa kerja baru |
| Menu → tabel, per **file** (import) | 138 tabel untuk setiap menu | **Tidak bisa dipakai** |
| Menu → tabel, per **fungsi** (TypeScript compiler yang sudah terpasang) | Hasil tepat dan sempit; 8 menu ±19 detik | **Bisa dipakai**, dijalankan saat build, bukan saat halaman dibuka |

Contoh hasil per fungsi. Tabel yang **ditulis** sesuai dengan keputusan posting:

| Menu | Ditulis | Dibaca |
| --- | --- | --- |
| Customer Order | `sal_customer_order(_line)`, `audit_log` | 19 |
| Purchase Order | `pur_order(_line, _line_request)`, `pur_request(_line)`, `audit_log` | 18 |
| Delivery Note | `log_delivery_note*`, empat buku stok, journal, `sal_delivery_order*`, `sal_order*`, `sal_customer_order*`, `audit_log` | 38 |
| Penerimaan | `fin_cash_bank_tx(_line)`, tiga buku Kas & Bank, `fin_ar_item`, `fin_ar_ledger`, journal, dua tabel pajak, `audit_log` | 45 |
| No. Grading | `prd_grading*`, `prd_balance`, `prd_ledger`, `prd_cost_entry`, journal, … (15) | 36 |

**Batas yang ditemukan:**

- Ada positif palsu. Invoice Penjualan ikut menampilkan
  `fin_ar_permit_invoice`, dan **Baca** lebih luas dari yang terasa wajar.
  Tampilan menonjolkan **Tulis**; Baca dilipat.
- Ada juga yang kurang: `_line_wht` (Penerimaan) dan `tax_faktur_line` / `_ref`
  ditulis lewat *nested create*. Pemindai uji mencatatnya sebagai baca; versi
  jadi harus membaca isi `data: { … create }`.
- Master di registry dan Laporan memakai satu halaman `[entity]` / `[report]`,
  jadi petanya harus diambil dari `entities.ts` dan `reports.ts`. **Belum diuji.**
- Hanya 8 dari 89 menu yang diuji.

## 3. Benchmark

dbdiagram dan dbdocs kini satu paket harga. dbdiagram menggambar ERD, dbdocs
menyajikan dokumentasinya.

| Kemampuan | dbdiagram / dbdocs | Aplikasi Database | Putusan |
| --- | --- | --- | --- |
| ERD: zoom, geser, kotak tabel, garis relasi | Ada | Ada | Ambil |
| Detail Level | Ada (berbayar) | Nama · Kunci (PK/FK) · Lengkap | Ambil |
| Table Group, buka / tutup | Ada (berbayar) | Otomatis: Aplikasi, Modul, Prefiks | Ambil, tanpa input |
| Diagram Views | Disusun tangan; Free 1, Pro tak terbatas | **Satu view otomatis per menu** | Ambil, jadi inti |
| Pencarian | Ada | Tabel, kolom, menu | Ambil |
| Halaman dokumentasi per tabel | dbdocs | Panel detail tabel | Ambil |
| Sorot relasi saat tabel dipilih | Tidak ditemukan di dokumentasi yang dibaca | Ada | Ambil |
| **Menu → tabel (tulis / baca)** | **Tidak ada** | **Ada** | Nilai utama |
| Referensi lemah `(doc_type_id, doc_id)` | Tidak bisa: bukan FK | Ditandai | Nilai tambah |
| Selalu sama dengan database berjalan | Harus impor atau publish ulang | Dibaca langsung | Nilai tambah |
| Ekspor SVG / PNG / PDF | Ada | Nanti | Tunda |
| Changelog schema | dbdocs (Free 14 hari) | Nanti; git dan migrasi sudah menyimpan | Tunda |
| Data Sample, SQL editor | Ada | **Tidak** | Data perusahaan tidak ditampilkan |
| Edit DBML, AI, kolaborasi, sticky notes | Ada | **Tidak** | Viewer saja |

**Mengapa tidak memakai dbdiagram / dbdocs saja?** Schema harus dikirim ke luar
setiap migrasi, tidak mengenal menu dan permission ERP, dan Table Group serta
Detail Level untuk database besar berbayar. Keduanya tetap pilihan termurah bila
yang dibutuhkan hanya gambar ERD.

## 4. Rancangan layar

**Pilih aplikasi:** kartu ketiga **Database** (tanda `DB`), *Struktur tabel dan
relasi yang dipakai aplikasi. Hanya melihat.*

**Rail:** tiga modul — **Diagram**, **Menu & Tabel**, **Daftar Tabel**.

```
┌──┬───────────────────┬──────────────────────────────┬───────────────────┐
│DB│ Cari…             │ Penjualan › Customer Order   │ sal_customer_order│
│  │ ▾ Penjualan       │ [Kunci ▾] [Baca ○] − 100% +  │ Pesanan customer… │
│  │   ● Customer Order│  ┌─────────┐   ┌──────────┐  │ Kolom · Relasi ·  │
│  │   ○ Sales Order   │  │m_partner│◄──┤sal_cust… │  │ Index · Menu      │
│  │ ▸ Pembelian       │  └─────────┘   └────▲─────┘  │                   │
│  │ ▸ Persediaan      │                ┌────┴─────┐  │ Dipakai menu:     │
│  │ ▸ Finance         │                │…_line    │  │ ✎ Customer Order  │
└──┴───────────────────┴──────────────────────────────┴───────────────────┘
```

1. **Diagram.** Panel kiri memilih *Kelompok: Menu | Modul | Aplikasi | Prefiks*,
   lalu cakupannya. Memilih menu hanya menampilkan tabel menu itu. Seluruh
   database tampil sebagai kotak grup yang bisa dibuka, bukan 153 tabel sekaligus.
2. **Menu & Tabel.** Per menu: **Tulis**, **Baca**, tabel utamanya. Arah balik:
   pilih tabel, lihat menu mana yang menulis dan membacanya.
3. **Daftar Tabel.** Semua tabel dengan pemilik, jumlah kolom dan relasi, filter
   dan Pager.

**Agar diagram terbaca.** Delapan tabel hub (`m_partner` 31 relasi, `m_item` 26,
dan lainnya) membuat garis menumpuk. Menyembunyikan garis ke delapan hub
menurunkan 308 garis menjadi 209. Karena itu garis ke hub tampil sebagai label
kecil pada kolomnya dan baru digambar saat tabelnya dipilih. Referensi lemah
(23 kolom `…doc_id` tanpa FK) memakai lencana putus-putus.

Alamat halaman menyimpan pilihan (`?menu=…&level=…`) agar bisa dibagikan.

## 5. Rancangan teknis

| Bagian | Usulan |
| --- | --- |
| Struktur | Server Component membaca `pg_catalog`, hanya `SELECT` metadata, schema `public`, tanpa membaca baris data |
| Keterangan, pemilik, menu → tabel | Skrip `npm run db:map` membaca DBML, `nav.ts` dan kode, menulis satu berkas hasil yang di-commit |
| Tetap mutakhir | Satu test gagal bila tabel schema tidak ada di peta atau menu tidak punya hasil |
| Diagram | HTML dan SVG sendiri, **tanpa dependensi baru**; tata letak berlapis dari kiri (induk) ke kanan (baris) |
| Rute | `src/app/(database)/database/…` dengan layout dan `requireApp` sendiri |
| Permission | `MENU_DATABASE_ACCESS` (aplikasi) dan `DATABASE_VIEW`. Awalnya hanya role administrator |
| Penyesuaian | `APPS`, `appOfModule` (kini hanya dua nilai), `appsOf`, shell, matriks role, `tests/apps.test.ts` |
| Skema aplikasi | Tidak berubah; migrasi hanya menambah permission |

Pengguna yang memegang ERP dan Database akan mendapat halaman *Pilih aplikasi*
yang sebelumnya dilewati. Ini aturan P256, tidak diubah.

## 6. Risiko

| Risiko | Tingkat | Penanganan |
| --- | --- | --- |
| Tata letak otomatis kusut pada menu besar (Penerimaan: 45 tabel dibaca) | **Sedang, belum diuji** | Mockup langkah 0; awalnya hanya Tulis + induknya. Bila gagal, pertimbangkan `elkjs` |
| Peta menu kurang tepat | Sedang | Tonjolkan Tulis; periksa 89 menu sekali; koreksi tersimpan di satu tempat |
| Struktur DB terbaca orang yang salah | Rendah | Permission sendiri, cek di server, tanpa data |
| Peta usang | Rendah | Test di atas |
| Build lebih lama | Rendah | Peta dibuat di mesin lokal, bukan di Vercel |

## 7. Langkah

0. **Mockup artifact** dengan schema asli: Customer Order, Delivery Note,
   Penerimaan, dan seluruh database. Menentukan apakah tata letaknya layak.
1. Skrip peta menu → tabel, 89 menu, test.
2. Pintu aplikasi, permission, Daftar Tabel dan detail tabel.
3. Diagram per menu dan per grup.
4. Menu & Tabel dua arah, pencarian, alamat yang bisa dibagikan.

Langkah 1 dan 2 tidak saling menunggu. Setelah langkah 2 sudah berguna.

## 8. Keputusan yang diperlukan

| # | Pertanyaan | Rekomendasi |
| --- | --- | --- |
| D1 | Lanjut ke mockup artifact dulu? | **Ya** |
| D2 | Siapa yang boleh masuk? | Administrator saja |
| D3 | Tersedia juga di Neon, atau lokal saja? | Keduanya, karena Neon tempat meninjau |
| D4 | Grup otomatis saja, atau bisa menyimpan grup buatan sendiri? | Otomatis dulu; menyimpan grup perlu tabel baru |
| D5 | Tampilkan perkiraan jumlah baris per tabel? | Ya, dari statistik PostgreSQL |
| D6 | Tanpa isi data sama sekali? | Ya |

## 9. Hasil langkah 0: mockup

Mockup memakai `globals.css` aplikasi apa adanya, markup komponen aplikasi,
dan data asli (153 tabel, 308 relasi, 89 menu).

**Hasil ukur.** 89 menu × 2 tingkat × dengan / tanpa Tabel dibaca, ditambah tiga
tingkat seluruh aplikasi: tidak ada kotak tabel yang bertumpuk. Gambar terlama
258 ms, termasuk seluruh halaman. Seluruh 153 tabel muat dalam satu layar pada
±27 %. Tanpa pustaka diagram. Peta seluruh menu dibuat ±26 detik; hanya
`sys_session` yang tidak dipakai menu mana pun.

**Berubah dari §4 karena konvensi:** satu modul di rail dengan tiga leaf (Diagram,
Tabel, Menu & Tabel); tanpa pohon menu di kiri (submenu maksimal dua tingkat,
§3.4) — menu dipilih lewat dropdown yang bisa dicari; tanpa panel kanan (drawer
dan side card tidak dipakai, D22) — detail tabel dibuka di dialog, lalu halaman.

**Pemetaan ke kode:** `layout.js` → `src/lib/erp/db-diagram.ts` (fungsi murni);
`additions.css` → blok tambahan `globals.css` (kelas `.dbv`, `.dbt`, `.dbg`,
`.dbl`, `.tags`); selebihnya komponen yang sudah ada: AppShell, DocumentHeader,
SearchField, Select, Pager, FormTabs, Field, Dialog, ExpandAll.

**Perlu keputusan:** kanvas diagram adalah komponen baru yang belum ada di
konvensi (§13.2 O-C hanya soal chart); halaman detail tanpa Riwayat karena tabel
bukan record; keterangan tabel dari DBML masih berbahasa Inggris dan 41 tabel
kosong; perkiraan jumlah baris (D5) belum ditampilkan.

## 10. Putaran 2 mockup: satu halaman (user, 23/11/2026)

Menggantikan §4 dan daftar leaf di §9. **Tidak ada menu Tabel dan Menu & Tabel**;
semuanya satu halaman dengan tiga kolom:

1. **Daftar tabel** (submenu, 276 px): dikelompokkan menurut *Kelompok* atau
   *Menu*, filter aplikasi, pencarian (Enter membuka hasil pertama, panah
   berpindah), jumlah kolom per tabel, Buka / Tutup Semua, *Semua Tabel*.
2. **Hierarki Relasi** (278 px, bisa disembunyikan): Kakek → Induk → Fokus → Anak
   → Cucu, 1 atau 2 tingkat. Tiap baris menyebut kolom FK-nya; klik menunjukkannya
   di diagram, ikon pin menjadikannya fokus, centang per tingkat menampilkan atau
   menyembunyikannya di diagram. Fokus tetap terlihat saat digulir. Untuk kelompok
   dan menu kolom ini berisi tabel menurut perannya.
3. **Diagram**: hanya tabel, kelompok atau menu yang dipilih; klik ganda = fokus;
   peta kecil bila tidak muat. Detail tabel (kolom, relasi, menu, index) di dialog.

Penyimpangan konvensi yang perlu dicatat bila disetujui: submenu memuat pencarian,
filter dan jumlah, dan kelompoknya bisa dilipat (§3.4); kolom di samping isi (§8
tanpa side card); kanvas diagram (belum ada). Kode: `viewer.js`, `panel.js`,
`parts.js`, `layout.js`, `additions.css`.

## 11. Putaran 3 mockup (user, 23/11/2026: konsep disetujui dengan catatan)

Menggantikan §9 dan §10 bila berbeda.

1. **Pengelompokan menurut pemilik tabel (P254, P255).** Pilihan hanya *Semua*,
   *ERP*, *Produksi*. Daftar pemilik dibaca dari `tests/module-boundaries.test.ts`
   (ERP 116, Produksi 27) dan kelompoknya dari bagian DBML. Putaran 2 menaruh
   semuanya di ERP karena pembaca daftar itu salah. Sepuluh tabel bersama (login,
   role, permission, setting, audit) tampil di kedua pilihan dengan tanda *ERP &
   Produksi*.
2. **Dialog Detail Tabel dihapus.** Isinya sudah ada di tempat lain: kolom dan tipe
   di tingkat *Lengkap* (`?` = boleh kosong, nilai enum pada tooltip), relasi di
   panel. Yang unik — **menu yang menulis dan membaca**, serta aturan unik dan cek —
   menjadi tab **Dipakai** di panel. Keterangan DBML dan index biasa tidak ditampilkan.
3. **Tata letak viewer:** daftar tabel (pohon aplikasi → kelompok / menu → tabel) |
   kanvas | panel di kanan. Tanpa rail dan header halaman; kanvas bertitik; legenda,
   zoom dan peta kecil mengambang; `/` = cari. Pada diagram kelompok, menu dan semua
   tabel, klik tabel membuka relasinya di panel tanpa meninggalkan diagram.

**Uji:** 416 susunan (153 tabel × 1 dan 2 tingkat, 89 menu, 20 kelompok, semua
tabel): tidak ada kotak bertumpuk, terlama 290 ms. **Kode:** `layout.js`,
`explorer.js`, `inspector.js`, `canvas.js`, `database.css`.

**Pengecualian konvensi (disetujui user sebagai halaman khusus):** tanpa rail dan
`.ph`, panel samping, pohon tabel di submenu, kanvas diagram, tiga ikon baru
(`table`, `panel`, `aim`). Dicatat di `KNOWLEDGE.md` (jawaban D) saat dibangun.

## Sumber

- [Working with Complex Diagrams](https://docs.dbdiagram.io/work-with-complex-diagrams)
- [Diagram Views](https://docs.dbdiagram.io/release-notes/2025-09-diagram-views)
- [Table Groups](https://docs.dbdiagram.io/table-groups)
- [Harga dan fitur](https://dbdiagram.io/pricing)
- [dbdocs](https://dbdocs.io/)
