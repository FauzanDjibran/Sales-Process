# Rencana: simulasi PO → Gudang → Produksi → kembali ke Gudang (artifact)

> Status: **usulan; keputusan user 18/11/2026 sudah masuk (§4), asumsi sisanya menunggu konfirmasi.** Target: artifact
> *Workspace Unit Produksi* (<https://claude.ai/artifact/TR9atVSRmuRUyh9nn9hHU7>,
> versi 21). Pembanding: aplikasi (`main`, P278–P279) dan artifact itu sendiri.
> Artifact adalah sumber desain: yang disepakati di sana dibangun persis di
> aplikasi, jadi bagian aplikasi yang belum ada (§2) justru perlu dirancang di
> artifact lebih dulu.

## 1. Alur yang ingin disimulasikan

```
PO (Open) → Receipt Note → stok di Gudang (per No. Stok)
  → BSTB Issue (Ajukan, Terima) → Persiapan Unit pertama → proses di Unit
  → ... → barang keluar produksi: BSTB Pengeluaran / BSTB ke Finish Goods
  → Terima Gudang → stok Gudang bertambah, WIP berkurang
```

## 2. Perbandingan langkah demi langkah

| # | Langkah | Artifact sekarang | Aplikasi sekarang | Kekurangan |
| --- | --- | --- | --- | --- |
| 1 | Purchase Order | Tidak ada; menu ERP › Pembelian bukan bagian simulasi | Ada (P124): dari PR Open, setujui, Open | **Artifact:** tidak ada PO. Perlu daftar PO dan dua PO Open contoh |
| 2 | Receipt Note | Menu abu-abu, tidak berfungsi | Ada (P125): per PO, No. Stok dibuat saat terima, nilai = DPP PO | **Artifact:** tidak ada. Stok Gudang hanya larik tetap `s.log` (dua No. Stok), bukan hasil penerimaan |
| 3 | Stok Gudang | `s.log`: dua baris tetap, tanpa Saldo Stok / Kartu Stok | Ada (P120): bucket per Gudang · Lokasi · No. Stok · status, dua buku, laporan | **Artifact:** tidak ada buku stok, saldo per No. Stok, atau laporan |
| 4 | BSTB Issue | Satu tombol *Ajukan BSTB Issue ke UGH* mengirim **seluruh** `s.log`; tanpa pilih No. Stok atau gram | Ada (P228): pilih No. Stok per lot, Ajukan mengunci (`reserved_qty`), Terima ke Persiapan, No. Job lahir | **Artifact:** tidak ada pilih lot / gram sebagian, tidak ada penguncian yang terlihat, tidak ada Bahan Penolong ke Unit dari form |
| 5 | Proses di Unit | Ada penuh (Grading, Job Order, Assign, Kerja, QC, Push, BSTB, Reproses, Packing 95) | Sampai Push / BSTB Transfer / Grading banyak Job / Pengerjaan / QC; **belum:** Kerja, Job Order, Reproses, Packing | Bukan kekurangan artifact; aplikasi menyusul (6.5–6.9) |
| 6 | Barang keluar produksi | *BSTB Pengeluaran* dari tab Stand By / Persiapan; Gudang menekan *Terima* | **Belum ada** (6.8, `log_production_return`) | **Artifact:** Terima Gudang hanya **menolkan** bucket (`gram=0, value=0`); barang **hilang**, tidak masuk stok, tanpa nilai, tanpa jurnal |
| 7 | Finish Goods | Teks saja ("BSTB ke Finish Goods"); UP8 tombol nonaktif | Belum ada; Packing 98 belum direncanakan (O-12) | **Artifact:** tidak ada Packing 98 maupun BSTB ke Finish Goods |
| 8 | Uang di sisi ERP | `V()` mati untuk seluruh artifact: tanpa Nilai dan jurnal, juga di ERP | ERP menampilkan jurnal (P103); Produksi tidak (P275) | **Artifact:** ERP Serah Terima tidak menunjukkan Nilai / jurnal; tidak ada Nilai WIP / Nilai Persediaan |
| 9 | Bukti rekonsiliasi | Tidak ada | `db:reconcile` | **Artifact:** tidak ada kartu yang membuktikan Persediaan + WIP = nilai pembelian + biaya |
| 10 | Telusur | Tidak ada | Telusur Produksi ada | **Artifact:** tidak ada jejak No. Stok dari PO sampai lokasi sekarang |
| 11 | Peran | Dewi = Admin Logistik (ERP); tidak ada Admin Pembelian | Izin per peran ada | **Artifact:** perlu satu pengguna Pembelian agar PO dan Receipt dikerjakan oleh peran yang benar |

## 3. Langkah pembangunan di artifact

Tiap langkah satu penerbitan, diperiksa lewat skrip seperti putaran 12, dan
dicatat di PWR dan §12 pada commit yang sama.

| Langkah | Isi | Selesai bila |
| --- | --- | --- |
| **A. Buku stok Gudang** | Ganti `s.log` dengan `s.stock` (No. Stok, item, gram, nilai, Gudang, terkunci). ERP › Persediaan › *Saldo Stok* dan *Kartu Stok* sederhana yang membaca buku itu | Stok awal tampil per No. Stok; semua perubahan stok lewat satu fungsi |
| **B. PO dan Receipt Note** | ERP › Pembelian › *Purchase Order* (daftar, dua PO Open dengan harga per gram); ERP › Persediaan › *Receipt Note* (pilih PO, isi No. Stok dan gram, Terima). Terima menambah `s.stock` bernilai harga PO, PO menutup sendiri bila penuh. Pengguna *Admin Pembelian* baru | Dari PO Open sampai stok bertambah, angka cocok |
| **C. BSTB Issue per No. Stok** | Form Issue: pilih No. Stok dan gram sebagian, Unit tujuan; Ajukan mengunci (kolom Terkunci di Saldo Stok); Terima di Produksi seperti sekarang (No. Job per ambilan). Sisa tetap di Gudang | Issue sebagian: stok berkurang tepat sebesar yang diterima Unit |
| **D. Uang di ERP** | `V()` per aplikasi: ERP menampilkan Nilai dan jurnal (Dr WIP / Cr Persediaan saat Terima Issue), Produksi tetap tanpa harga. ERP › Produksi › *Nilai WIP per Unit* | Nilai WIP per Unit = jumlah bucket Unit itu |
| **E. Kembali ke Gudang** | *Terima Gudang* sungguhan: pilih Gudang, barang masuk `s.stock` dengan No. Stok yang sama, WIP berkurang, jurnal Dr Persediaan / Cr WIP, Kartu Stok mencatat. Dua jenis: **Sisa** (barang belum diproses atau lebih) dan **Reject** (nilai ikut partai bila sudah berpartai, Beban Pemusnahan bila belum). **Nilai dipilih lewat satu pilihan placeholder** di form Terima Gudang: *Nilai terbawa*, *Hanya nilai bahan*, *Tanpa nilai*; di aplikasi nanti pilihan ini diganti alasan / tujuan yang menentukan nilainya | Satu putaran penuh: stok Gudang bertambah persis sebesar yang keluar, dan jurnal mengikuti pilihan nilai |
| **F. Rekap rekonsiliasi dan Telusur** | Kartu *Rekap Simulasi*: nilai pembelian + biaya Unit = Persediaan + WIP (+ Beban Pemusnahan); *Telusur* satu No. Stok dari PO sampai lokasi sekarang | Kartu hijau di akhir; Telusur menampilkan semua dokumennya |
| **G. Finish Goods (dalam lingkup)** | Packing 98 (UP8): Assembly yang mengambil kotak dari Packing 95 dan menambah Box dan Karton sebagai bahan penolong bernilai; UP8 ber-QC (fitur Unit); *BSTB ke Finish Goods* dari Stand By UP8; Terima di **Gudang Finish Goods** (Gudang kedua) sebagai stok barang jadi bernomor kotak, nilai terbawa (atau pilihan nilai E) | Dari PO sampai satu kotak tercatat sebagai stok Finish Goods, angka cocok |
| **H. Panduan** | Kartu panduan berisi daftar langkah (PO → Receipt → Issue → proses → keluar), tombol loncat ke tiap layar, tombol *Mulai Ulang* | Satu orang bisa menjalankan seluruh alur dari panduan |

Urutan: A → B → C → D → E → G → F → H (F dan H terakhir supaya mencakup G).

## 4. Keputusan dan asumsi

**Sudah diputuskan user (18/11/2026)**
1. **Lingkup sampai Finish Goods**, bukan hanya sisa dan reject (langkah G ikut).
2. **Nilai barang yang kembali dipilih di simulasi** lewat pilihan placeholder
   (Nilai terbawa / Hanya nilai bahan / Tanpa nilai). Di aplikasi nanti **alasan
   atau tujuan** yang menentukan nilainya, bukan pilihan bebas.

**Asumsi saya, mohon dikonfirmasi atau dikoreksi**
3. **Packing 98 belum punya aturan** (O-12). Untuk simulasi: Assembly yang
   menerima kotak dari Packing 95 (Push), menambah Box dan Karton (bahan
   penolong, jumlah tetap per kotak di data contoh), lalu QC sebagai fitur Unit
   (selaras putaran 12) sebelum BSTB ke Finish Goods. Bila aturan lapangan
   berbeda, G berubah, bukan A–F.
4. **Dua Gudang** di simulasi: Bahan Baku (tujuan Receipt Note dan sumber BSTB
   Issue) dan Finish Goods (tujuan BSTB ke Finish Goods). Sisa dan reject
   kembali ke Gudang yang dipilih saat Terima. Lokasi Gudang tidak dimodelkan.
5. **Mulai dari PO**, bukan PR (sesuai permintaan); PR hanya disebut di PO
   sebagai asalnya.
6. **ERP menampilkan harga dan jurnal; Produksi tidak** (P275 hanya mengikat
   layar Produksi).
7. **Aplikasi tidak disentuh.** Bagian yang belum ada di aplikasi (6.5–6.9,
   BSTB Pengeluaran, Packing, BSTB ke Finish Goods) menunggu hasil simulasi.
