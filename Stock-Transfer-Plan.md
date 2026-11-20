# Transfer Stok — Plan dan Validasi Asumsi

> Status: **disetujui user 20/11/2026** (P300) — OD-1 tabel sendiri, OD-2
> Gudang Transit tidak bisa dipilih di dokumen lain, OD-3 pindah lokasi di luar
> scope, OD-4 status terbawa, OD-5 `TSK` / `TST`, OD-6 MAC tidak berubah, OD-7
> selisih tetap di transit, OD-8 langsung tanpa persetujuan, OD-9 penugasan user
> ke gudang. Belum dibangun.
>
> Permintaan user: menu *stock transfer* untuk memindah stok antar gudang;
> **menu Kirim dan Terima terpisah**; selama dalam pengiriman barang berada di
> **Gudang Transit** yang diatur di System Default. Mengangkat sebagian C34.
>
> Sumber yang dibaca: `inventory.ts` (`issueStock`, `receiveStock`,
> `reserveStock`, `stockPlace`), `system-defaults.ts`, `delivery-note-purposes.ts`,
> model `RefWarehouse`, `LogDeliveryNote`, `SysStockStatus`, konsep KB
> `inventory/stock-books` 1.0 (diadopsi), Claude-ERP.md P106, P114, P120, P136,
> P260, P267, P268, C34; dokumentasi Business Central, SAP, NetSuite, Odoo,
> ERPNext, Accurate (§6).

---

## 1. Ringkasan

Dua dokumen di Persediaan › Operasi Gudang:

| Dokumen | Fungsi | Gerak stok |
| --- | --- | --- |
| **Transfer Kirim** | Gudang asal mengirim barang ke gudang tujuan | Gudang asal (lokasi · lot · status) → **Gudang Transit** |
| **Transfer Terima** | Gudang tujuan menerima satu Transfer Kirim, boleh bertahap | **Gudang Transit** → Gudang tujuan (lokasi dipilih penerima) |

**Tidak ada journal dan MAC tidak berubah** (§3.4).

## 2. Validasi asumsi (ke kode)

| # | Asumsi | Hasil cek | Akibat ke rencana |
| --- | --- | --- | --- |
| A1 | Gudang Transit bisa dipilih di System Default | **Belum bisa.** `SystemDefaultRef` hanya `"acc_account"` | Tambah ref `ref_warehouse`, kartu baru **Persediaan** › *Gudang Transit* |
| A2 | Gudang Transit adalah gudang biasa | **Benar**, tidak ada kolom tipe. Tanpa aturan, gudang ini muncul di Receipt Note, Delivery Note, DO, PR, PO, BSTB Issue | **Diputuskan (OD-2):** ditolak di server dan disembunyikan dari picker semua dokumen itu; hanya transfer yang menyentuhnya |
| A3 | Barang di transit tetap per lot dan status | **Benar**: bucket = gudang · lokasi · lot · status | Lot dan status dibawa apa adanya; nomor lot tidak berubah (`receiveStock` menambah ke lot yang ada; `assertNewTrackingNo` hanya dipanggil Receipt Note pembelian) |
| A4 | Gudang Transit tanpa lokasi | **Wajib dijaga**: `stockPlace` menuntut lokasi di gudang yang punya lokasi | Setting menolak gudang berlokasi; Lokasi Gudang menolak lokasi pertama di Gudang Transit |
| A5 | Pindah gudang tidak butuh journal | **Benar**: pool nilai per item company-wide (P114, P120), Persediaan per Kategori Item (P122) | Kirim dan Terima tanpa journal |
| A6 | Konsep KB tidak dilanggar | **Aman**: aturan *every quantity row has one value twin* terpenuhi oleh `issueStock` + `receiveStock` | Tidak perlu deviation check |
| A7 | Draft tidak mengunci stok | **Benar** (konsep: *a draft reserves nothing*); Kirim langsung memindah ke transit saat Posting | Tanpa reservasi (`reserveStock` hanya mengenal Tersedia, tidak dipakai) |
| A8 | Pindah lokasi satu gudang ikut menu ini | P136 / P267 menjanjikannya ke "menu Transfer" | **Diputuskan (OD-3): di luar scope.** Asal = tujuan ditolak; §17 "stock cannot move between locations" tetap |
| A9 | Kirim/Terima sebagai purpose DN/RN (P106) | **Dipaksakan**: DN mewajibkan partner, alamat, sumber, dan selalu menjurnal HPP | **Diputuskan (OD-1): tabel sendiri** |
| A10 | Admin per gudang hanya menyentuh gudangnya | **Belum ada di ERP.** Tidak ada penugasan user ↔ gudang; izin hanya per menu. Satu-satunya pola sejenis: `prd_user_unit` (P260) | OD-9 |

## 3. Desain

### 3.1 Transfer Kirim (`log_stock_transfer`, `_line`, `_tracking`)

- **Header**: No., Tanggal Kirim, **Gudang Asal**, **Gudang Tujuan** (berbeda,
  keduanya bukan Gudang Transit), Gudang Transit (disalin dari System Default
  saat Posting), No. Kendaraan, Pengemudi, Catatan, status.
- **Baris**: Barang (Kelola Stok saja, P120), qty dasar, `received_qty`.
- **Tracking** (pola P268): satu baris per bucket diambil — lot, lokasi asal,
  status — `base_qty` kebenaran, baris = Σ tracking. *Pilih Lot* memakai
  `lotOptions` dengan **semua status** (OD-4), FEFO, menampilkan stok bebas.
- **Lifecycle tanpa persetujuan (OD-8)**: Draft → *Kirim* → **Dalam Perjalanan**
  → **Diterima** (otomatis saat semua diterima); *Batalkan* Draft dengan alasan.
  Posted final.
- **Posting**, satu transaksi, periode ditahan (`holdPostingPeriod`, P222): per
  tracking `issueStock` dari asal lalu `receiveStock` ke transit — lot dan status
  sama, lokasi null, nilai = yang dilepas. Stok kurang ditolak.

### 3.2 Transfer Terima (`log_stock_transfer_receipt`, `_line`, `_tracking`)

- **Header**: No., **satu Transfer Kirim** Dalam Perjalanan (dipilih sekali,
  terkunci), gudang asal dan tujuan disalin, Tanggal Terima (**tidak sebelum
  Tanggal Kirim**), Catatan.
- **Baris** dari baris Kirim yang bersisa (Qty Kirim, Sudah Diterima, Sisa),
  pola P81; **lot** per baris di dialog (pola P290): tiap lot yang dikirim, diisi
  **Lokasi tujuan** bila gudang tujuan berlokasi, dan qty; status ikut kiriman.
- **Tidak melebihi** sisa per baris tracking Kirim (Draft dan Posted Terima
  dihitung, dicek di bawah kunci dokumen Kirim).
- Draft → *Terima* → Posted; *Batalkan* Draft.
- **Posting**: per tracking `issueStock` dari transit lalu `receiveStock` ke
  tujuan; tulis `received_qty`; Kirim menjadi Diterima saat penuh.

### 3.3 Gudang Transit

- System Default › **Persediaan** › *Gudang Transit* (`transit_warehouse`, ref
  `ref_warehouse`, aktif, tanpa lokasi). Kirim menolak Posting bila kosong.
- Mengganti setting **ditolak selama gudang transit lama memegang stok**.
- Tidak bisa dinonaktifkan selama dipakai setting.

### 3.4 Valuasi: MAC tidak berubah (OD-6, diputuskan)

Gudang memakai moving average (P114), satu pool per item untuk seluruh
perusahaan; transfer **tidak boleh mengubah MAC**. Tiap hop (asal → transit,
transit → tujuan) di dalam satu transaksi dengan pool terkunci:

1. `issueStock` melepas r = round(V × q ÷ Q) (V utuh bila mengosongkan pool):
   pool menjadi (Q − q, V − r).
2. `receiveStock` memasukkan q senilai **r yang sama**: pool kembali (Q, V).

Pool sesudah = pool sebelum, **persis**, jadi MAC = V ÷ Q tidak bergeser
sesen pun, Nilai Persediaan tidak berubah, dan GL tidak disentuh. Barang di
transit tetap bagian dari pool (dan dari Nilai Persediaan = akun Persediaan).
Pembulatan r tidak berpengaruh karena angka yang sama keluar dan masuk.
Di Kartu Nilai Persediaan tiap hop tampil dua baris (−r, +r) dengan saldo
akhir sama. Nilai tidak ditampilkan di dokumen transfer; hanya qty.

`db:reconcile` membuktikannya: per dokumen transfer posted, Σ `value_change`
valuasi = 0 dan Σ `qty_change` = 0.

### 3.5 Laporan, menu, izin

- Tanpa laporan baru: Saldo Stok dan Kartu Stok membaca semua gudang, jadi
  Gudang Transit tampil sendiri. Register Kirim punya tab **Dalam Perjalanan**.
- Persediaan › Operasi Gudang: Receipt Note, Delivery Note, BSTB Issue,
  **Transfer Kirim**, **Transfer Terima**.
- Izin terpisah supaya admin gudang tujuan bisa hanya menerima:
  `STOCK_TRANSFER_VIEW / _CREATE / _EDIT / _SEND / _CANCEL` dan
  `STOCK_TRANSFER_RECEIPT_VIEW / _CREATE / _EDIT / _POST / _CANCEL`.

### 3.6 `db:reconcile`

1. Stok di Gudang Transit = Σ (qty kirim − qty diterima posted) Kirim Dalam
   Perjalanan, per item · lot · status.
2. Baris Kirim = Σ trackingnya; `received_qty` = Σ Terima posted, ≤ qty.
3. Kirim Diterima ⇔ seluruh baris diterima.
4. Per dokumen transfer posted: Σ qty dan Σ nilai valuasi = 0, tanpa journal.

## 4. Pembanding: ERP lain dan admin per gudang

| ERP | Bentuk | Transit | Nilai | Admin per gudang |
| --- | --- | --- | --- | --- |
| **Business Central** | Satu Transfer Order, diposting **Ship** lalu **Receive** (dokumen posted terpisah: Transfer Shipment / Receipt); *Direct Transfer* tanpa transit | Lokasi *In-Transit* di Transfer Route, tanpa bin | Biaya ikut barang; tanpa laba | **Warehouse Employee**: user diberi lokasi default, dan aktivitas gudang hanya bisa dikerjakan di lokasi itu; lokasi lain hanya bisa dilihat |
| **SAP S/4HANA** | Dua langkah: **303** keluar dari plant asal, **305** masuk ke plant tujuan (satu langkah: 301); atau Stock Transport Order | *Stock in transfer* di plant tujuan | Bila satu valuation area, nilai tetap; antar plant beda valuasi ada posting FI | Otorisasi per plant (`M_MSEG_WWA`), plant penerima diperiksa terpisah (`M_MSEG_WWE`). Catatan: 303 dan 305 **tidak saling terkait** di database |
| **NetSuite** | Transfer Order → **Item Fulfillment** (asal) → **Item Receipt** (tujuan), boleh bertahap | Akun *Inventory in Transit* | Biaya per lokasi, jadi selisih biaya → Gain/Loss | Role dibatasi per lokasi; receipt tidak boleh bertanggal sebelum shipment |
| **Odoo** | Dua picking: OUT di gudang asal, IN di gudang tujuan | *Inter-warehouse transit* | Nilai per company tidak berubah | Batasan gudang lewat aturan akses / modul tambahan |
| **ERPNext** | Material Transfer *Add to Transit* lalu *End Transit* (entri kedua merujuk entri pertama) | Gudang bertipe **Transit** | Sesuai valuasi gudang | User Permission per gudang, tapi diketahui **tidak membatasi baris anak** dan sebagian laporan — butuh validasi server sendiri |
| **Accurate** | Pemindahan Barang (permintaan, pemindahan) | Tidak terdokumentasi jelas | — | — |

**Yang dipelajari untuk rencana ini:**

1. **Dua dokumen yang saling terkait** (BC, NetSuite, ERPNext) lebih baik dari
   dua gerak lepas (SAP 303/305): Terima merujuk Kirim, jadi sisa di jalan
   selalu jelas per kiriman. Rencana ini sudah begitu.
2. **Gudang transit bertipe khusus** (BC *In-Transit*, ERPNext *Transit*)
   tidak bisa dipakai dokumen biasa dan tanpa bin — sama dengan A2 / A4.
3. **Admin per gudang dijaga di server, per sisi**: pengirim harus berhak atas
   gudang asal, penerima atas gudang tujuan (SAP memeriksa plant pengirim dan
   penerima terpisah; BC lewat lokasi default Warehouse Employee). ERPNext
   menunjukkan risikonya bila hanya difilter di layar: baris anak dan laporan
   bocor.
4. **Penerima harus melihat kiriman yang menuju gudangnya** walau tidak berhak
   atas gudang asal — di BC dan NetSuite Transfer Order terlihat dari kedua
   sisi. Pengirim memilih gudang tujuan tetapi tidak melihat stoknya.
5. **Selisih tidak ditolak di Terima**: penerima mencatat yang benar-benar
   datang; sisanya tetap di transit dan terlihat kedua sisi sampai ditangani
   (BC: sisa outstanding; SAP: *stock in transfer* tetap sampai 305 atau
   pembalikan).
6. **Tanggal Terima ≥ Tanggal Kirim** (NetSuite) — sudah di §3.2.
7. **Nilai**: ERP yang menilai per lokasi (NetSuite) perlu akun in-transit dan
   laba/rugi transfer; ERP ini menilai per item company-wide, jadi tidak perlu
   keduanya — cocok dengan §3.4.

## 5. Keputusan

| # | Pertanyaan | Status |
| --- | --- | --- |
| OD-1 | Tabel sendiri atau purpose DN/RN | **Tabel sendiri** (user) |
| OD-2 | Gudang Transit di dokumen lain | **Tidak bisa dipilih** (user) |
| OD-3 | Pindah lokasi satu gudang | **Di luar scope** (user) |
| OD-4 | Status barang | **Ikut terbawa**, semua status boleh dikirim (user) |
| OD-5 | Penomoran | **`TSK/YYYY/MM/NNNN`** (Kirim), **`TST/…`** (Terima), satu seri (user) |
| OD-6 | Valuasi | **MAC tidak berubah** (user); `issueStock` + `receiveStock` per hop, §3.4 |
| OD-7 | Selisih di jalan | **Terima boleh bertahap; yang hilang/rusak tetap di transit** sampai stock opname / penyesuaian (C34), tanpa *Tutup Kirim* yang menghapus stok (user) |
| OD-8 | Persetujuan / Transfer Order | **Langsung tanpa persetujuan** (user) |
| OD-9 | Admin per gudang | **Penugasan user ke gudang** (user), di bawah |

**OD-9 — penugasan user ke gudang**, pola `prd_user_unit` (P260):

- Tabel `log_user_warehouse` (user, gudang); izin **`INVENTORY_WAREHOUSE_ALL`**
  (*Buka semua Gudang*) tanpa baris, diberikan migrasi ke role yang sekarang
  memegang izin dokumen gudang, supaya tidak ada yang kehilangan akses.
  Diatur di form User, tab *Gudang*, oleh `USER_ROLE_ASSIGN`, tidak untuk diri
  sendiri.
- **Kirim**: hanya untuk gudang asal milik user (dicek di action dan server).
  Gudang Tujuan dipilih dari semua gudang aktif, tanpa melihat stoknya.
- **Terima**: hanya untuk Kirim yang **tujuannya** gudang milik user.
- **Register**: Kirim menampilkan yang berasal dari **atau** menuju gudang user
  (penerima melihat yang akan datang); Terima menampilkan yang masuk ke gudang
  user. Disaring di database, bukan di layar.
- **Scope**: diterapkan ke dua dokumen transfer dulu. Receipt Note, Delivery
  Note, BSTB Issue dan laporan stok memakai aturan yang sama di langkah
  terpisah — tanpa itu, admin gudang A masih bisa membuat Delivery Note dari
  gudang B.

## 6. Langkah build

0. Penugasan user ↔ gudang: migrasi, `warehouse-access.ts`
   (`warehouseIdsOf`, `assertWarehouse`), tab Gudang di form User, test.
1. **Setting**: ref `ref_warehouse` di System Default, kartu Persediaan, aturan
   A2 / A4 di Gudang, Lokasi Gudang dan picker dokumen gudang lain; test.
2. **Transfer Kirim**: migrasi tiga tabel + izin + tipe dokumen (di akhir daftar
   seed), modul, workflow, form, register bertab status, posting ke transit;
   test posting, stok kurang, MAC sama sebelum dan sesudah.
3. **Transfer Terima**: migrasi, modul, form dengan dialog lot/lokasi, posting,
   status Diterima; test bertahap, over-receive ditolak, tanggal sebelum Kirim
   ditolak.
4. **`db:reconcile`** empat cek; DBML, Claude-ERP.md (P3xx, §1.5, §17), harvest
   ke KB (`stock-books` masih *draft* tanpa transfer).

Setiap langkah: build, lint, test, dicoba di browser, baris dicek di Postgres;
migrate + seed Neon setelah push.

## Sumber

- Business Central: [Transfer inventory between locations](https://learn.microsoft.com/en-NZ/dynamics365/business-central/inventory-how-transfer-between-locations), [Set up warehouse employees](https://learn.microsoft.com/en-us/dynamics365/business-central/warehouse-how-to-set-up-warehouse-employees)
- SAP: [Performing stock transfers between plants](https://learning.sap.com/courses/inventory-management-and-physical-inventory-in-sap-s-4hana/performing-stock-transfers-between-plants), [303/305 not linked](https://archive.sap.com/discussions/thread/3357879), [Stock in transfer vs in transit](https://groups.community.sap.com:443/t5/enterprise-resource-planning-blogs-by-sap/stock-in-transfer-vs-stock-in-transit-where-to-find-it-how-to-remove-it/bc-p/13577568), [M_MSEG_WWA](https://help.sap.com/saphelp_afs64/helpdata/en/1a/83a441b8632e7be10000000a1550b0/content.htm)
- NetSuite: [Inventory Transfer Orders](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2308766.html), [Receiving Transfer Orders](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2312912.html)
- Odoo: [Inter-warehouse replenishment](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/resupply_warehouses.html)
- ERPNext: [Material transfers and goods in transit](https://docs.frappe.io/erpnext/how-to-manage-material-transfers-and-goods-in-transit), [Isolating warehouses per department](https://discuss.frappe.io/t/single-company-several-departments-how-do-you-isolate-warehouses-per-department-v16/164886)
- Accurate: [Fitur Persediaan](https://accurate.id/online/fitur/persediaan/)
