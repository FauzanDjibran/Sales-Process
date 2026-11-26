# Seeder

Semua command dijalankan dari root project. Daftar aslinya ada di `package.json`; kalau ada seeder baru atau berubah, perbarui file ini.

- **Aman diulang:** seeder hanya menambah yang belum ada, dicocokkan lewat label atau nama. Pengecualiannya disebut di tabel.
- **Satu database, satu perusahaan:** pilih makloon **atau** walet.
- **Neon:** command `db:neon-*` menulis ke database yang di-deploy, memakai `.env.neon`.

## Cepat: mulai dari database kosong (lokal)

**Menghapus semua data lokal.**

Perusahaan makloon (kosmetik):

```powershell
npm run db:fresh-makloon
```

Perusahaan walet:

```powershell
npm run db:fresh-walet
```

## 1. Data sistem dan dasar

Bukan data demo, aman untuk instalasi sungguhan.

| Lokal | Neon | Isi | Syarat |
| --- | --- | --- | --- |
| `npm run db:seed` | `npm run db:neon-seed` | Data sistem saja: admin, permission, role, tipe akun dan kerangka akun, tipe dokumen, wilayah, Kategori Item, serta data awal Currency, Satuan, Termin dan Jenis PPh. Di Neon wajib ada `ERP_ADMIN_PASSWORD`. | Migrasi sudah jalan |
| `npm run db:seed-accounts` | `npm run db:neon-seed-accounts` | Bagan akun awal, semua Account Mapping, akun per Kategori Item dan per Jenis PPh. Hanya mengisi yang masih kosong. | `db:seed` |
| `npm run db:seed-production` | `npm run db:neon-seed-production` | Master produksi: Workstation, Unit, Line Reguler dan Mie, routing. Standard Cost tidak diisi. | `db:seed` |

## 2. Data demo

Data contoh untuk pengembangan dan review.

| Lokal | Neon | Isi | Syarat |
| --- | --- | --- | --- |
| `npm run db:seed-makloon` | `npm run db:neon-seed-makloon` | Perusahaan kosmetik: bagan akun, Gudang, 5 Kas & Bank, tahun buku, customer, supplier, master item, stok awal barang jadi. | `db:seed` |
| `npm run db:seed-cash-bank-showcase` | `npm run db:neon-seed-cash-bank-showcase` | Untuk laporan Kas & Bank: resource tambahan (Kas Kecil, Kas Besar, BNI, Kas Valas USD) dan mutasi Juli–Oktober 2026 beserta journalnya. **Mutasi dibuat sekali saja.** | `db:seed-makloon`; periode Juli–Oktober 2026 Open |
| `npm run db:seed-walet` | `npm run db:neon-seed-walet` | Perusahaan walet. Otomatis menjalankan `seed-accounts`, `seed-production` dan `seed-production-showcase`, lalu menambah Gudang, master item, Karyawan, supplier, customer, 5 Kas & Bank, Kurs USD, user demo dan stok awal. | `db:seed` |
| `npm run db:seed-production-showcase` | `npm run db:neon-seed-production-showcase` | Bahan uji alur PO sampai Packing 95: Gudang, item produksi, supplier, Standard Cost, BoM Packing, Karyawan. Sudah termasuk di `db:seed-walet`. | `db:seed`, `db:seed-accounts`, `db:seed-production` |
| `npm run db:seed-walet-ledger` | `npm run db:neon-seed-walet-ledger` | Dokumen gudang dan produksi selama 30 hari untuk mengisi laporan stok dan produksi. **Sekali per database.** | `db:seed-walet` |
| `npm run db:simulate-walet` | — | Menjalankan satu Job dari PO sampai kotak di Packing 95. **Memposting dokumen sungguhan**, jadi pakai database yang boleh diisi. | `db:seed-production`, `db:seed-production-showcase` |

### Kas & Bank di demo makloon dan walet

| Label | Mata uang | Saldo awal | Kurs |
| --- | --- | --- | --- |
| KAS (tipe Cash) | IDR | 25.000.000 | — |
| MANDIRI | IDR | 500.000.000 | — |
| BCA | IDR | 500.000.000 | — |
| MANDIRI-USD | USD | 10.000 | 16.500 |
| BCA-USD | USD | 10.000 | 15.000 |

- Saldo awal bertanggal 1 Januari tahun berjalan, tanpa journal.
- Kas & Bank yang sudah ada tidak diubah.
- Angkanya diatur di `DEMO_BANKS` (`scripts/lib/seed-common.ts`).

### User demo walet

Dibuat hanya bila passwordnya diketahui: di database lokal memakai password development, selain itu memakai `ERP_ADMIN_PASSWORD`.

## 3. Stok dari file CSV

Bukan seeder tetap: memasukkan stok dari file CSV buatan sendiri, **tanpa journal**. Tanpa `--apply` hanya memeriksa. Kolomnya dijelaskan di awal `scripts/stock-inject.ts`.

```powershell
npm run db:stock-inject -- file.csv --apply
```

Untuk Neon: `npm run db:neon-stock-inject -- file.csv --apply`.

## 4. Reset dan pengecekan

| Command | Fungsi |
| --- | --- |
| `npm run db:reset` | **Menghapus** database lokal, menjalankan migrasi, lalu `db:seed`. |
| `npm run db:neon-reset -- --confirm` | **Menghapus** database Neon. Tidak menjalankan seed, jadi lanjutkan dengan `db:neon-seed`. |
| `npm run db:neon-migrate` | Menjalankan migrasi di Neon. |
| `npm run db:reconcile` / `npm run db:neon-reconcile` | Memeriksa buku dan dokumen cocok. Hanya membaca. |

### Urutan untuk Neon dari kosong (walet)

```powershell
npm run db:neon-reset -- --confirm
```

```powershell
npm run db:neon-seed
```

```powershell
npm run db:neon-seed-walet
```

Untuk makloon, ganti langkah terakhir dengan `npm run db:neon-seed-makloon`.
